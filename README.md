# agent-trace

Turn messy agent run logs into a readable timeline.

OpenAI tool-call dumps, LangChain / LangSmith trees, JSONL event streams, Cursor-ish traces — all of them are painful to skim. `agent-trace` is an offline CLI that normalizes those shapes into a numbered timeline: thoughts, tools, results, errors, durations, and a one-line autopsy.

Filter by kind or tool, export Markdown / Mermaid for PRs, and get a per-tool breakdown in `--stats`. No API key. No network. Pipe a dump, get a story.

## 30-second demo

Copy-paste. `--demo` is bundled with the package, so this works without cloning the repo.

```bash
npx @webywz/agent-trace --demo --no-color
```

```text
$ npx @webywz/agent-trace --demo --stats --no-color
19 steps · 7 tool calls · 1 failure · ~1,840 in / 96 out · 15.3s
  tools: run_tests×1 6.61s 1 fail, read_file×2 …

$ npx @webywz/agent-trace --demo --only tool,error --no-color
agent-trace  ·  examples/run.jsonl
jsonl  ·  8 steps  ·  7 tool calls  ·  1 failure  ·  …
────────────────────────────────────────────────────────────────────────
  1  tool        …  read_file
  …
  8  error       …  run_tests
────────────────────────────────────────────────────────────────────────

$ npx @webywz/agent-trace --demo --mermaid | head -8
%% agent-trace · examples/run.jsonl
flowchart TD
  S1(["1. user …"])
  S3["3. tool read_file …"]
  …
```

`--demo` is the bundled `examples/run.jsonl` (a coding agent that fails `run_tests` once, then recovers).

```bash
npx @webywz/agent-trace --demo --spicy --no-color
# spicy  The brief was “The login test is flaky…”. Then `run_tests` blew up: …
```

## Install

```bash
npm i -g @webywz/agent-trace
agent-trace --demo
```

Node 18+. No API key required.

```bash
npx @webywz/agent-trace --demo
cat run.jsonl | npx @webywz/agent-trace
```

## Usage

```bash
agent-trace --demo
agent-trace run.jsonl
agent-trace --format auto|openai|langchain|jsonl|generic run.jsonl
agent-trace --json run.jsonl | jq .stats
agent-trace --stats run.jsonl
agent-trace --only tool,error --demo
agent-trace --tool run_tests --failures --demo
agent-trace --markdown --demo > report.md
agent-trace --mermaid --demo
agent-trace --fail-on-error --stats traces/ci.jsonl
agent-trace --spicy run.jsonl
cat run.jsonl | agent-trace
```

| Flag | What it does |
| --- | --- |
| `-f, --format` | `auto` (default), `openai`, `langchain`, `jsonl`, `generic` |
| `-j, --json` | Normalized trace as JSON (steps, stats, warnings) |
| `--stats` | Summary + per-tool breakdown (good for CI logs) |
| `--markdown`, `--md` | GitHub-friendly Markdown report (table + tool stats) |
| `--mermaid` | Mermaid flowchart — paste into a ` ```mermaid ` fence |
| `--only <kinds>` | Keep kinds: `user`, `tool`, `result`, `error`, `assistant`, … |
| `--tool <name>` | Keep steps for this tool (repeatable / comma list) |
| `--failures` | Keep only failures and their paired tool calls/results |
| `--spicy` | A short narrative recap. Offline by default; uses `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` when set |
| `--fail-on-error` | Exit `1` if the run had tool/step failures |
| `--demo` | Render the bundled sample (`examples/run.jsonl`) |
| `--ascii` | ASCII-only timeline (no box drawing) |
| `--color` / `--no-color` | Force or disable ANSI colors (`NO_COLOR` also disables) |
| `--width <n>` | Wrap width (defaults to the terminal) |
| `--max-content <n>` | Truncate args / results (default 160) |

Use **one** of `--json`, `--stats`, `--markdown`, `--mermaid` (timeline is the default).

`--spicy` never blocks the timeline. If the key is missing, the recap is local. If the LLM call fails, you still get the local recap.

### Exit codes

| Code | When |
| --- | --- |
| `0` | Timeline (or JSON / stats / export) printed |
| `1` | I/O or parse error, **or** `--fail-on-error` when the trace has failures |
| `2` | Usage error (unknown flag, missing file). stderr ends with `try 'agent-trace --help'` |

CI one-liner — fail the job if the agent run had failures:

```bash
agent-trace --fail-on-error --stats traces/last-run.jsonl
```

Share a failure in a PR:

```bash
agent-trace --failures --markdown traces/last-run.jsonl >> $GITHUB_STEP_SUMMARY
agent-trace --failures --mermaid traces/last-run.jsonl
```

## What it parses

**OpenAI** — `chat.completion` objects, `messages[]` with `tool_calls` / `role: tool`, Responses API `output[]`, and streamed JSONL chunks with `delta`.

**LangChain** — LangSmith run trees (`run_type` + `child_runs`), callback events (`on_tool_start`, `on_tool_end`, `on_chain_error`, …), `AgentAction` dumps.

**JSONL** — one event per line: `role` / `type` / `tool` / `content` / `ts`. Cursor-ish traces included. Bad lines are skipped and reported.

**Generic** — a JSON array (or `{ events: [...] }`) of `{ type, name, content, ts }`.

Auto-detect sniffs the file; `--format` forces a parser.

## Library

```ts
import {
  parseTrace,
  filterTrace,
  renderTimeline,
  renderMarkdown,
  renderMermaid,
  spicyNarrative,
} from "@webywz/agent-trace";
import { readFile } from "node:fs/promises";

const text = await readFile("run.jsonl", "utf8");
const trace = filterTrace(parseTrace(text, { format: "auto", source: "run.jsonl" }), {
  failures: true,
});
process.stdout.write(renderTimeline(trace, { color: false }));
process.stdout.write(renderMarkdown(trace));
process.stdout.write(renderMermaid(trace));
```

`Trace.stats` always includes step / tool / failure counts, plus duration and token in/out when the log carries timestamps or usage. From 0.2.0 it also includes `stats.tools[]` — per-tool calls, failures, and duration.

## Examples

Same repo, ready to paste. Walkthrough: [`examples/README.md`](examples/README.md).

```bash
agent-trace --demo
agent-trace examples/run.jsonl
agent-trace examples/openai.json
agent-trace examples/langchain.json
agent-trace --json examples/generic.json
agent-trace --only tool,error --demo
agent-trace --markdown --demo
agent-trace --mermaid --demo
agent-trace --fail-on-error --stats examples/run.jsonl; echo $?
```

## Develop

```bash
npm install
npm test
npm run build
node dist/cli.js --demo --no-color
```

MIT © webywz
