import type { TraceStats, TraceStep } from "./types.js";
import { estimateTokens, timestampMs } from "./util.js";

export function computeStats(steps: TraceStep[]): TraceStats {
  let toolCalls = 0;
  let failures = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let hasTokenIn = false;
  let hasTokenOut = false;
  const times: number[] = [];

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
  }

  const durationMs =
    times.length >= 2 ? Math.max(0, Math.max(...times) - Math.min(...times)) : undefined;

  return {
    steps: steps.length,
    toolCalls,
    failures,
    tokensIn: hasTokenIn ? tokensIn : undefined,
    tokensOut: hasTokenOut ? tokensOut : undefined,
    durationMs,
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
