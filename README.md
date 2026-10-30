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
| **Normalize** | OpenAI tool-call dumps, Anthropic / Claude Messages, LangChain / LangSmith trees, JSONL, generic event arrays |
| **Timeline** | Numbered steps: thoughts, tools, results, errors, durations |
| **Filter** | `--only`, `--tool`, `--failures` for the slice you care about |
| **Export** | Markdown for PR summaries, Mermaid for flowcharts, `--json` / `--stats` for CI |
| **Offline spicy** | `--spicy` local narrative recap; `--spicy-llm` opt-in LLM rewrite |
| **CI gate** | `--fail-on-error` exits `1` when the run had tool/step failures |

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
agent-trace --only tool,error --stats --demo
agent-trace --failures --markdown traces/last-run.jsonl
agent-trace --mermaid --demo
agent-trace --fail-on-error --stats traces/ci.jsonl
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
| `-f, --format` | `auto` (default), `openai`, `anthropic`, `langchain`, `jsonl`, `generic` |
| `-j, --json` | Normalized trace as JSON |
| `--stats` | Summary + per-tool breakdown |
| `--markdown`, `--md` | GitHub-friendly Markdown report |
| `--mermaid` | Mermaid flowchart |
| `--only <kinds>` | Keep kinds: `user`, `tool`, `result`, `error`, `assistant`, … |
| `--tool <name>` | Keep steps for this tool (repeatable / comma list) |
| `--failures` | Failures and their paired tool calls/results |
| `--spicy` | **Local** narrative recap — no network |
| `--spicy-llm` | Opt-in LLM narrative via `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| `--fail-on-error` | Exit `1` if the trace has failures |
| `--demo` | Bundled sample (`examples/run.jsonl`) |
| `--ascii` | ASCII-only timeline |
| `--color` / `--no-color` | Force or disable ANSI (`NO_COLOR` also disables) |
| `--width <n>` | Wrap width |
| `--max-content <n>` | Truncate args / results (default 160) |

Use **one** of `--json`, `--stats`, `--markdown`, `--mermaid` (timeline is the default).

`--spicy` is always local. `--spicy-llm` never blocks the timeline: if the key is missing or the call fails, you still get the local recap.

| Exit | When |
| --- | --- |
| `0` | Timeline / export printed |
| `1` | I/O or parse error, or `--fail-on-error` with failures |
| `2` | Usage error |

### What it parses

- **OpenAI** — `chat.completion`, `messages[]` with `tool_calls`, Responses API `output[]`, streamed JSONL
- **Anthropic** — Claude Messages: `text`, `tool_use`, `tool_result`, `thinking` content blocks
- **LangChain** — LangSmith run trees, callback events, `AgentAction` dumps
- **JSONL** — one event per line (`role` / `type` / `tool` / `content` / `ts`)
- **Generic** — JSON array or `{ events: [...] }` of `{ type, name, content, ts }`

### Library

```ts
import {
  parseTrace,
  filterTrace,
  renderTimeline,
  renderMarkdown,
  renderMermaid,
  spicyNarrative,
} from "@webywz/agent-trace";

const trace = filterTrace(parseTrace(text, { format: "auto" }), { failures: true });
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
| **归一化** | OpenAI tool-call、Anthropic / Claude Messages、LangChain / LangSmith、JSONL、通用事件数组 |
| **时间线** | 编号步骤：思考、工具、结果、错误、耗时 |
| **过滤** | `--only`、`--tool`、`--failures`，只看关心的切片 |
| **导出** | Markdown（PR 摘要）、Mermaid（流程图）、`--json` / `--stats`（CI） |
| **离线 spicy** | `--spicy` 本地叙事；`--spicy-llm` 可选联网 LLM 重写 |
| **CI 门禁** | `--fail-on-error`：运行有失败时退出码 `1` |

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
agent-trace --only tool,error --stats --demo
agent-trace --failures --markdown traces/last-run.jsonl
agent-trace --mermaid --demo
agent-trace --fail-on-error --stats traces/ci.jsonl
agent-trace --spicy --demo          # 仅本地
agent-trace --spicy-llm run.jsonl   # 需要 OPENAI_API_KEY 或 ANTHROPIC_API_KEY
```

### 命令行要点

| 参数 | 作用 |
| --- | --- |
| `-f, --format` | `auto`（默认）/ `openai` / `anthropic` / `langchain` / `jsonl` / `generic` |
| `-j, --json` | 输出归一化 JSON |
| `--stats` | 摘要 + 按工具拆分 |
| `--markdown`, `--md` | GitHub 友好的 Markdown 报告 |
| `--mermaid` | Mermaid 流程图 |
| `--only <kinds>` | 只保留指定 kind |
| `--tool <name>` | 只保留该工具相关步骤 |
| `--failures` | 只保留失败及其配对的调用/结果 |
| `--spicy` | **本地**叙事，不联网 |
| `--spicy-llm` | 可选 LLM 叙事（需 API key） |
| `--fail-on-error` | 有失败则退出码 `1` |
| `--demo` | 使用包内示例 |

`--json` / `--stats` / `--markdown` / `--mermaid` 四选一（默认为时间线）。

`--spicy` 始终离线。`--spicy-llm` 失败时仍回退到本地叙事，不会卡住主输出。

| 退出码 | 含义 |
| --- | --- |
| `0` | 正常输出 |
| `1` | 读写/解析错误，或 `--fail-on-error` 命中失败 |
| `2` | 用法错误 |

### 能解析什么

- **OpenAI** — `chat.completion`、`tool_calls`、Responses API、流式 JSONL
- **Anthropic** — Claude Messages：`text` / `tool_use` / `tool_result` / `thinking`
- **LangChain** — LangSmith 树、回调事件、`AgentAction`
- **JSONL** — 每行一个事件
- **Generic** — JSON 数组或 `{ events: [...] }`

### 库用法

```ts
import {
  parseTrace,
  filterTrace,
  renderTimeline,
  spicyNarrative,
} from "@webywz/agent-trace";

const trace = filterTrace(parseTrace(text, { format: "auto" }), { failures: true });
process.stdout.write(renderTimeline(trace, { color: false }));
console.log(await spicyNarrative(trace)); // 默认离线；{ localOnly: false } 才联网
```

### 链接

| | |
| --- | --- |
| npm | [npmjs.com/package/@webywz/agent-trace](https://www.npmjs.com/package/@webywz/agent-trace) |
| Issues | [github.com/webywz/agent-trace/issues](https://github.com/webywz/agent-trace/issues) |
| License | [MIT](./LICENSE) © webywz |
