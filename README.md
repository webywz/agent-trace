# agent-trace

Turn messy agent run logs into a readable timeline.

OpenAI tool-call dumps, LangChain / LangSmith trees, JSONL event streams, Cursor-ish traces — all of them are painful to skim. `agent-trace` is an offline CLI that normalizes those shapes into a numbered timeline: thoughts, tools, results, errors, durations, and a one-line autopsy.

```text
$ agent-trace examples/run.jsonl
```

```text
agent-trace  ·  examples/run.jsonl
jsonl  ·  19 steps  ·  7 tool calls  ·  1 failure  ·  15.3s
────────────────────────────────────────────────────────────────────────
  1  user          +0ms  770ms
     │  The login test is flaky on CI. Fix it. Do not sleep() your way out.
     │
  2  thought     +770ms  120ms
     │  I'll read the spec and the auth module, then look for a race — not a …
     │
  3  tool        +890ms  170ms  read_file
     │  {"path":"test/login.spec.ts"}
     │
 12  tool        +2.68s  6.61s  run_tests
     │  {"cmd":"npx playwright test test/login.spec.ts --repeat-each=8"}
     │
 13  error       +9.29s  470ms  run_tests
     │  1 failed · login.spec.ts:12: cookie sid missing on first navigation (…
     │
 19  assistant   +15.3s
     │  The flake was a cookie/redirect race, not a slow page. Cookie is now …
────────────────────────────────────────────────────────────────────────
  19 steps · 7 tool calls · 1 failure · ~1,840 in / 96 out · 15.3s
```

## Install

```bash
npm i -g @webywz/agent-trace
agent-trace examples/run.jsonl
```

Node 18+. No API key required.

```bash
npx @webywz/agent-trace examples/run.jsonl
```

## Usage

```bash
agent-trace run.jsonl
agent-trace --format auto|openai|langchain|jsonl run.jsonl
agent-trace --json run.jsonl
agent-trace --spicy run.jsonl
cat run.jsonl | agent-trace
```

| Flag | What it does |
| --- | --- |
| `-f, --format` | `auto` (default), `openai`, `langchain`, `jsonl` |
| `--json` | Normalized trace as JSON (steps, stats, warnings) |
| `--spicy` | A short narrative recap. Offline by default; uses `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` when set |
| `--ascii` | ASCII-only timeline (no box drawing) |
| `--no-color` | Disable ANSI colors (`NO_COLOR` also works) |
| `--width <n>` | Wrap width (defaults to the terminal) |
| `--max-content <n>` | Truncate args / results (default 160) |

`--spicy` never blocks the timeline. If the key is missing, the recap is local. If the LLM call fails, you still get the local recap.

## What it parses

**OpenAI** — `chat.completion` objects, `messages[]` with `tool_calls` / `role: tool`, Responses API `output[]`, and streamed JSONL chunks with `delta`.

**LangChain** — LangSmith run trees (`run_type` + `child_runs`), callback events (`on_tool_start`, `on_tool_end`, `on_chain_error`, …), `AgentAction` dumps.

**JSONL** — one event per line: `role` / `type` / `tool` / `content` / `ts`. Cursor-ish traces included. Bad lines are skipped and reported.

**Generic** — a JSON array (or `{ events: [...] }`) of `{ type, name, content, ts }`.

Auto-detect sniffs the file; `--format` forces a parser.

## Library

```ts
import { parseTrace, renderTimeline, spicyNarrative } from "@webywz/agent-trace";
import { readFile } from "node:fs/promises";

const text = await readFile("run.jsonl", "utf8");
const trace = parseTrace(text, { format: "auto", source: "run.jsonl" });
process.stdout.write(renderTimeline(trace, { color: false }));
```

`Trace.stats` always includes step / tool / failure counts, plus duration and token in/out when the log carries timestamps or usage.

## Examples

Same repo, ready to paste into a terminal:

```bash
agent-trace examples/run.jsonl
agent-trace examples/openai.json
agent-trace examples/langchain.json
agent-trace --json examples/generic.json
agent-trace --spicy examples/run.jsonl
```

## Develop

```bash
npm install
npm test
npm run build
node dist/cli.js examples/run.jsonl
```

MIT © webywz
