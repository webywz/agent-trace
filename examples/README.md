# Examples

These files ship in the npm package. After a git clone they live in `examples/`; after `npm i -g` use `--demo` or point at the files in the cloned repo.

## 30-second walkthrough: `run.jsonl`

A coding agent is told the login test is flaky. It reads the spec and auth module, patches both, fails `run_tests` once (cookie set after redirect), then recovers.

```bash
agent-trace examples/run.jsonl
agent-trace --stats examples/run.jsonl
agent-trace --fail-on-error examples/run.jsonl; echo $?   # 1 — the run had a failure
agent-trace --spicy examples/run.jsonl
```

What to look for:

- Step 13 is `error  run_tests` — the flake still reproduced.
- The footer is the autopsy: 19 steps, 7 tool calls, 1 failure, ~15s.
- `--spicy` names the failed tool locally (no network). Use `--spicy-llm` to opt into an LLM call when an API key is set.

This is the fixture `--demo` renders.

## Other shapes

| File | Shape | Why it's here |
| --- | --- | --- |
| `run.jsonl` | JSONL events (`role` / `type` / `tool`) | Realistic coding-agent debug loop |
| `openai.json` | Chat Completions `tool_calls` | Dump a `chat.completion` object as-is |
| `langchain.json` | LangSmith run tree (`child_runs`) | Flatten a nested executor trace |
| `generic.json` | `{ type, name, content, ts }[]` | Lowest-common-denominator if you emit your own log |

```bash
agent-trace examples/openai.json
agent-trace examples/langchain.json
agent-trace --json examples/generic.json
```

Pipe your own dump:

```bash
cat /tmp/agent.jsonl | agent-trace --stats
agent-trace --fail-on-error --stats traces/ci.jsonl
```
