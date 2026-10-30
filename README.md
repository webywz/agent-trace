# agent-trace

[![npm](https://img.shields.io/npm/v/@webywz/agent-trace?style=flat-square&color=111111&labelColor=eeeeee)](https://www.npmjs.com/package/@webywz/agent-trace)
[![node](https://img.shields.io/node/v/@webywz/agent-trace?style=flat-square&color=111111&labelColor=eeeeee)](https://www.npmjs.com/package/@webywz/agent-trace)
[![license](https://img.shields.io/npm/l/@webywz/agent-trace?style=flat-square&color=111111&labelColor=eeeeee)](./LICENSE)

> **Turn messy agent runs into a readable timeline.**
>
> **把杂乱的 agent 运行日志，收成一条可读时间线。**

Offline by default. No API key. No network — unless you opt into `--spicy-llm`.

默认离线。不需要 API key，不联网 —— 除非你主动使用 `--spicy-llm`。

---

## English

### Demo

```bash
npx @webywz/agent-trace --demo --no-color
```

```text
$ npx @webywz/agent-trace --demo --stats --no-color
19 steps · 7 tool calls · 1 failure · ~1,840 in / 96 out · 15.3s
  tools: run_tests×1 6.61s 1 fail, read_file×2 …

$ npx @webywz/agent-trace --demo --only tool,error --no-color
agent-trace  ·  examples/run.jsonl
jsonl  ·  8 steps  ·  7 tool calls  ·  1 failure
────────────────────────────────────────────────────────────────────────
  1  tool        …  read_file
  …
  8  error       …  run_tests
────────────────────────────────────────────────────────────────────────
```

`--demo` ships with the package (`examples/run.jsonl`) — no clone required.

### Features

| | |
| --- | --- |
| **Normalize** | OpenAI, Anthropic / Claude Messages, Claude Code stream-json, Codex CLI JSONL, LangChain / LangSmith, Ollama / OpenAI-compat, JSONL, generic |
| **Timeline** | Numbered steps: thoughts, tools, results, errors, durations |
| **Filter** | `--only`, `--tool`, `--failures` for the slice you care about |
| **Export** | Markdown for PR summaries, Mermaid for flowcharts, self-contained `--html`, `--json` / `--stats` for CI |
| **Offline spicy** | `--spicy` local narrative recap; `--spicy-llm` opt-in LLM rewrite |
| **CI gate** | `--fail-on-error` exits `1` on failures; `--max-duration` budgets wall time (`30s` / `2m`); `--max-tokens` budgets in+out tokens; `--sarif` / `--junit` write Code Scanning SARIF / JUnit XML |
| **Redact** | `--redact` scrubs PEM / JWT / `sk-` / `ghp_` / Slack / AWS / Bearer before share |
| **TAP** | `--tap` emits TAP version 13 for `prove` / CI (exit `1` on failures) |
| **Compare** | `--compare <file>` diffs tool sequences / failures (exit `1` on differ) |
| **Step summary** | `--github-summary` appends Markdown to `$GITHUB_STEP_SUMMARY` (or a local file) |

### Install

```bash
npm i -g @webywz/agent-trace
agent-trace --demo
```

Node 18+. Or one-off: `npx @webywz/agent-trace --demo`.

### Quick start

```bash
agent-trace --demo
agent-trace run.jsonl
cat run.jsonl | agent-trace
agent-trace --format anthropic dump.json
agent-trace --format ollama dump.jsonl
agent-trace --format openai-compat dump.jsonl
agent-trace --only tool,error --stats --demo
agent-trace --failures --markdown traces/last-run.jsonl
agent-trace --mermaid --demo
agent-trace --html /tmp/at.html --demo
agent-trace --fail-on-error --stats traces/ci.jsonl
agent-trace --max-duration 30s --stats traces/ci.jsonl
agent-trace --max-tokens 8000 --stats traces/ci.jsonl
agent-trace --sarif results.sarif --demo
agent-trace --junit results.xml --demo
agent-trace --max-tokens 8000 --stats traces/ci.jsonl
agent-trace --sarif results.sarif --demo
agent-trace --redact --markdown run.jsonl
agent-trace --tap --demo
agent-trace run.jsonl --compare baseline.jsonl
agent-trace --github-summary --demo
agent-trace --spicy --demo          # local only
agent-trace --spicy-llm run.jsonl   # needs OPENAI_API_KEY or ANTHROPIC_API_KEY
```

### CLI

```
agent-trace [options] <file>
agent-trace [options] -                 # stdin
```

| Flag | What it does |
| --- | --- |
| `-f, --format` | `auto` (default), `openai`, `anthropic`, `claude-code` (aliases: `claude_code`, `claude`), `codex`, `langchain`, `ollama`, `openai-compat`, `jsonl`, `generic` |
| `-j, --json` | Normalized trace as JSON |
| `--stats` | Summary (includes detected format) + per-tool breakdown |
| `--markdown`, `--md` | GitHub-friendly Markdown report |
| `--html [path]` | Self-contained HTML timeline (stdout, or write to path; offline, no CDN) |
| `--mermaid` | Mermaid flowchart |
| `--only <kinds>` | Keep kinds: `user`, `tool`, `result`, `error`, `assistant`, … |
| `--tool <name>` | Keep steps for this tool (repeatable / comma list) |
| `--failures` | Failures and their paired tool calls/results |
| `--spicy` | **Local** narrative recap — no network |
| `--spicy-llm` | Opt-in LLM narrative via `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| `--fail-on-error` | Exit `1` if the trace has failures |
| `--max-duration <n>` | Exit `1` if run duration exceeds N (`5000`, `30s`, `2m`) |
| `--max-tokens <n>` | Exit `1` if stats in+out tokens exceed N |
| `--sarif <path>` | Write SARIF 2.1.0 for failures / tool errors (GitHub Code Scanning) |
| `--junit <path>` | Write JUnit XML for failures (CI) |
| `--redact` | Scrub secrets (PEM, JWT, `sk-`/`sk-ant-`/`sk-proj-`, `ghp_`/`gho_`/`github_pat_`, Slack, AWS `AKIA…`, Bearer/Basic) |
| `--tap` | TAP version 13 on stdout (CI; exit `1` on failures; `--stats` still ok on stderr) |
| `--compare <file>` | Diff tool sequence / failures vs another trace (exit `1` on differ) |
| `--github-summary [path]` | Append short Markdown to `$GITHUB_STEP_SUMMARY`, `path`, or `./github-step-summary.md` |
| `--demo` | Bundled sample (`examples/run.jsonl`) |
| `--ascii` | ASCII-only timeline |
| `--color` / `--no-color` | Force or disable ANSI (`NO_COLOR` also disables) |
| `--width <n>` | Wrap width |
| `--max-content <n>` | Truncate args / results (default 160) |

Use **one** of `--json`, `--markdown`, `--mermaid`, `--html`, `--tap` (timeline is the default). `--stats` alone is fine; with `--tap` it prints on stderr.

`--spicy` is always local. `--spicy-llm` never blocks the timeline: if the key is missing or the call fails, you still get the local recap.

| Exit | When |
| --- | --- |
| `0` | Timeline / export printed, or `--compare` equivalent |
| `1` | I/O or parse error; `--fail-on-error` / `--tap` with failures; `--max-duration` / `--max-tokens` exceeded; `--compare` differs |
| `2` | Usage error |

### What it parses

- **OpenAI** — `chat.completion`, `messages[]` with `tool_calls`, Responses API `output[]`, streamed JSONL
- **Ollama / OpenAI-compat** — `/api/chat` + `/api/generate` NDJSON; OpenAI-compat `chat.completion(.chunk)` JSONL
- **Anthropic** — Claude Messages: `text`, `tool_use`, `tool_result`, `thinking` content blocks
- **Claude Code** — `stream-json` lines (`assistant` / `user` / `result` with nested message content blocks)
- **Codex** — CLI JSONL (`{ timestamp, type, payload }` — `agent_message`, `function_call`, …)
- **LangChain** — LangSmith run trees, callback events, `AgentAction` dumps
- **JSONL** — one event per line (`role` / `type` / `tool` / `content` / `ts`)
- **Generic** — JSON array or `{ events: [...] }` of `{ type, name, content, ts }`

### Library

```ts
import {
  parseTrace,
  filterTrace,
  redactTrace,
  renderTimeline,
  renderMarkdown,
  renderMermaid,
  renderTap,
  spicyNarrative,
} from "@webywz/agent-trace";

const trace = redactTrace(filterTrace(parseTrace(text, { format: "auto" }), { failures: true }));
process.stdout.write(renderTimeline(trace, { color: false }));
console.log(await spicyNarrative(trace)); // offline; pass { localOnly: false } for LLM
```

### Develop

```bash
npm install && npm test && npm run build
node dist/cli.js --demo --no-color
```

### Links

| | |
| --- | --- |
| npm | [npmjs.com/package/@webywz/agent-trace](https://www.npmjs.com/package/@webywz/agent-trace) |
| Issues | [github.com/webywz/agent-trace/issues](https://github.com/webywz/agent-trace/issues) |
| License | [MIT](./LICENSE) © webywz |

---

## 中文

### 演示

```bash
npx @webywz/agent-trace --demo --no-color
```

`--demo` 使用包内自带的 `examples/run.jsonl`，无需 clone 仓库。

### 功能

| | |
| --- | --- |
| **归一化** | OpenAI、Anthropic / Claude Messages、Claude Code stream-json、Codex CLI JSONL、LangChain / LangSmith、Ollama / OpenAI-compat、JSONL、通用事件 |
| **时间线** | 编号步骤：思考、工具、结果、错误、耗时 |
| **过滤** | `--only`、`--tool`、`--failures`，只看关心的切片 |
| **导出** | Markdown PR 摘要、Mermaid 流程图、自包含 `--html`、`--json` / `--stats` 对接 CI |
| **离线 spicy** | `--spicy` 本地叙事；`--spicy-llm` 可选联网 LLM 重写 |
| **CI 门禁** | `--fail-on-error` 失败退出 `1`；`--max-duration` 限制总耗时（`30s` / `2m`）；`--max-tokens` 限制 in+out token；`--sarif` / `--junit` 写出 Code Scanning SARIF / JUnit XML |
| **脱敏** | `--redact`：分享前擦除 PEM / JWT / `sk-` / `ghp_` / Slack / AWS / Bearer |
| **TAP** | `--tap`：输出 TAP version 13，方便 `prove` / CI（有失败则退出 `1`） |
| **对比** | `--compare <file>`：对比工具序列 / 失败数（不同则退出 `1`） |
| **Step Summary** | `--github-summary`：把 Markdown 追加到 `$GITHUB_STEP_SUMMARY`（或本地文件） |

### 安装

```bash
npm i -g @webywz/agent-trace
agent-trace --demo
```

需要 Node 18+。一次性使用：`npx @webywz/agent-trace --demo`。

### 快速开始

```bash
agent-trace --demo
agent-trace run.jsonl
cat run.jsonl | agent-trace
agent-trace --format anthropic dump.json
agent-trace --format ollama dump.jsonl
agent-trace --format openai-compat dump.jsonl
agent-trace --only tool,error --stats --demo
agent-trace --failures --markdown traces/last-run.jsonl
agent-trace --mermaid --demo
agent-trace --html /tmp/at.html --demo
agent-trace --fail-on-error --stats traces/ci.jsonl
agent-trace --max-duration 30s --stats traces/ci.jsonl
agent-trace --redact --markdown run.jsonl
agent-trace --tap --demo
agent-trace run.jsonl --compare baseline.jsonl
agent-trace --github-summary --demo
agent-trace --spicy --demo          # 仅本地
agent-trace --spicy-llm run.jsonl   # 需要 OPENAI_API_KEY 或 ANTHROPIC_API_KEY
```

### 命令行要点

| 参数 | 作用 |
| --- | --- |
| `-f, --format` | `auto`（默认）/ `openai` / `anthropic` / `claude-code`（别名 `claude_code`/`claude`）/ `codex` / `langchain` / `ollama` / `openai-compat` / `jsonl` / `generic` |
| `-j, --json` | 输出归一化 JSON |
| `--stats` | 摘要（含检测到的 format）+ 按工具拆分 |
| `--markdown`, `--md` | GitHub 友好的 Markdown 报告 |
| `--html [path]` | 自包含 HTML 时间线（stdout，或写入路径；离线、无 CDN） |
| `--mermaid` | Mermaid 流程图 |
| `--only <kinds>` | 只保留指定 kind |
| `--tool <name>` | 只保留该工具相关步骤 |
| `--failures` | 只保留失败及其配对的调用/结果 |
| `--spicy` | **本地**叙事，不联网 |
| `--spicy-llm` | 可选 LLM 叙事（需 API key） |
| `--fail-on-error` | 有失败则退出码 `1` |
| `--max-duration <n>` | 总耗时超过 N 则退出 `1`（`5000` / `30s` / `2m`） |
| `--max-tokens <n>` | stats 的 in+out token 超过 N 则退出 `1` |
| `--sarif <path>` | 将失败 / 工具错误写成 SARIF 2.1.0（GitHub Code Scanning） |
| `--junit <path>` | 将失败写成 JUnit XML（CI） |
| `--redact` | 脱敏（PEM、JWT、`sk-`/`sk-ant-`/`sk-proj-`、`ghp_`/`gho_`/`github_pat_`、Slack、AWS `AKIA…`、Bearer/Basic） |
| `--tap` | 向 stdout 输出 TAP version 13（CI；有失败退出 `1`；可与 `--stats` 同用，stats 走 stderr） |
| `--compare <file>` | 与另一份 trace 对比工具序列 / 失败数（不同则退出 `1`） |
| `--github-summary [path]` | 追加短 Markdown 到 `$GITHUB_STEP_SUMMARY`、指定路径或 `./github-step-summary.md` |
| `--demo` | 使用包内示例 |

`--json` / `--markdown` / `--mermaid` / `--html` / `--tap` 五选一（默认为时间线）。`--stats` 可单独使用；与 `--tap` 同用时 stats 打到 stderr。

`--spicy` 始终离线。`--spicy-llm` 失败时仍回退到本地叙事，不会卡住主输出。

| 退出码 | 含义 |
| --- | --- |
| `0` | 正常输出，或 `--compare` 结构等价 |
| `1` | 读写/解析错误；`--fail-on-error` / `--tap` 命中失败；`--max-duration` / `--max-tokens` 超限；`--compare` 有差异 |
| `2` | 用法错误 |

### 能解析什么

- **OpenAI** — `chat.completion`、`tool_calls`、Responses API、流式 JSONL
- **Ollama / OpenAI-compat** — `/api/chat` + `/api/generate` NDJSON；OpenAI-compat `chat.completion(.chunk)` JSONL
- **Anthropic** — Claude Messages：`text` / `tool_use` / `tool_result` / `thinking`
- **Claude Code** — `stream-json`（`assistant` / `user` / `result` + 嵌套 content blocks）
- **Codex** — CLI JSONL（`{ timestamp, type, payload }`）
- **LangChain** — LangSmith 树、回调事件、`AgentAction`
- **JSONL** — 每行一个事件
- **Generic** — JSON 数组或 `{ events: [...] }`

### 库用法

```ts
import {
  parseTrace,
  filterTrace,
  redactTrace,
  renderTimeline,
  spicyNarrative,
} from "@webywz/agent-trace";

const trace = redactTrace(filterTrace(parseTrace(text, { format: "auto" }), { failures: true }));
process.stdout.write(renderTimeline(trace, { color: false }));
console.log(await spicyNarrative(trace)); // 默认离线；{ localOnly: false } 才联网
```

### 链接

| | |
| --- | --- |
| npm | [npmjs.com/package/@webywz/agent-trace](https://www.npmjs.com/package/@webywz/agent-trace) |
| Issues | [github.com/webywz/agent-trace/issues](https://github.com/webywz/agent-trace/issues) |
| License | [MIT](./LICENSE) © webywz |
