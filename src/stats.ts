import type { ToolStat, TraceStats, TraceStep } from "./types.js";
import { estimateTokens, timestampMs } from "./util.js";

export function computeStats(steps: TraceStep[]): TraceStats {
  let toolCalls = 0;
  let failures = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let hasTokenIn = false;
  let hasTokenOut = false;
  const times: number[] = [];
  const byTool = new Map<string, ToolStat>();

  const explicitIn = steps.some((step) => step.tokensIn != null);
  const explicitOut = steps.some((step) => step.tokensOut != null);

  for (const step of steps) {
    if (step.kind === "tool_call") toolCalls += 1;
    if (step.kind === "error" || step.error) failures += 1;
    if (step.tokensIn != null) {
      tokensIn += step.tokensIn;
      hasTokenIn = true;
    } else if (!explicitIn && (step.kind === "user" || step.kind === "system")) {
      tokensIn += estimateTokens(step.content);
      hasTokenIn = true;
    } else if (!explicitIn && step.kind === "tool_result") {
      tokensIn += estimateTokens(step.content ?? stringifyMaybe(step.result));
      hasTokenIn = true;
    }
    if (step.tokensOut != null) {
      tokensOut += step.tokensOut;
      hasTokenOut = true;
    } else if (
      !explicitOut &&
      (step.kind === "assistant" || step.kind === "thought" || step.kind === "tool_call")
    ) {
      tokensOut += estimateTokens(step.content ?? stringifyMaybe(step.args));
      hasTokenOut = true;
    }
    const ms = timestampMs(step.ts);
    if (ms != null) times.push(ms);

    if (step.name && (step.kind === "tool_call" || step.kind === "tool_result" || step.kind === "error")) {
      const key = step.name;
      let entry = byTool.get(key);
      if (!entry) {
        entry = { name: key, calls: 0, failures: 0 };
        byTool.set(key, entry);
      }
      if (step.kind === "tool_call") entry.calls += 1;
      if (step.kind === "error" || step.error) entry.failures += 1;
      if (step.durationMs != null && step.kind === "tool_call") {
        entry.durationMs = (entry.durationMs ?? 0) + step.durationMs;
      }
    }
  }

  // Attribute durations from adjacent timestamps when tool_call lacks durationMs
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || step.kind !== "tool_call" || !step.name || step.durationMs != null) continue;
    const entry = byTool.get(step.name);
    if (!entry) continue;
    const a = timestampMs(step.ts);
    const b = timestampMs(steps[i + 1]?.ts);
    if (a == null || b == null || b < a) continue;
    entry.durationMs = (entry.durationMs ?? 0) + (b - a);
  }

  const durationMs =
    times.length >= 2 ? Math.max(0, Math.max(...times) - Math.min(...times)) : undefined;

  const tools = [...byTool.values()]
    .filter((tool) => tool.calls > 0 || tool.failures > 0)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0) || b.calls - a.calls || a.name.localeCompare(b.name));

  return {
    steps: steps.length,
    toolCalls,
    failures,
    tokensIn: hasTokenIn ? tokensIn : undefined,
    tokensOut: hasTokenOut ? tokensOut : undefined,
    durationMs,
    tools: tools.length ? tools : undefined,
  };
}

function stringifyMaybe(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
