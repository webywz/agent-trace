import type { StepKind, TraceStep } from "../types.js";
import {
  coerceJson,
  compactJson,
  flattenText,
  isRecord,
  looksLikeError,
  parseTimestamp,
  pickNumber,
  pickString,
  pickUnknown,
} from "../util.js";

const KIND_ALIASES: Record<string, StepKind> = {
  user: "user",
  human: "user",
  system: "system",
  thought: "thought",
  thinking: "thought",
  reasoning: "thought",
  reason: "thought",
  assistant: "assistant",
  ai: "assistant",
  bot: "assistant",
  llm: "assistant",
  model: "assistant",
  message: "assistant",
  tool: "tool_call",
  tool_call: "tool_call",
  toolcall: "tool_call",
  function_call: "tool_call",
  function: "tool_call",
  action: "tool_call",
  agent_action: "tool_call",
  tool_use: "tool_call",
  tool_result: "tool_result",
  toolresult: "tool_result",
  observation: "tool_result",
  function_output: "tool_result",
  function_call_output: "tool_result",
  tool_output: "tool_result",
  output: "tool_result",
  result: "tool_result",
  error: "error",
  fail: "error",
  failure: "error",
  exception: "error",
  stderr: "error",
};

const SKIP_TYPES = new Set([
  "ping",
  "heartbeat",
  "span_start",
  "metadata",
  "trace_start",
  "trace_end",
]);

export function normalizeEvent(value: unknown, index: number): TraceStep | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    return {
      index,
      kind: "other",
      title: "event",
      content: text,
    };
  }
  if (!isRecord(value)) return null;

  const rawType = pickString(value, ["type", "event", "kind", "role", "run_type", "object"]);
  const typeKey = rawType?.toLowerCase().replace(/[\s-]+/g, "_");
  if (typeKey && SKIP_TYPES.has(typeKey)) return null;

  let kind = (typeKey && KIND_ALIASES[typeKey]) || inferKind(value, typeKey);
  const name = pickString(value, [
    "name",
    "tool",
    "tool_name",
    "toolName",
    "function",
    "function_name",
    "action",
  ]);
  const toolCallId = pickString(value, ["tool_call_id", "toolCallId", "call_id", "id"]);

  const args = pickUnknown(value, [
    "args",
    "arguments",
    "input",
    "inputs",
    "params",
    "parameters",
    "tool_input",
  ]);
  const result = pickUnknown(value, ["result", "output", "outputs", "observation", "response"]);
  const content =
    flattenText(
      pickUnknown(value, ["content", "text", "message", "output_text", "delta"]) ??
        (kind === "tool_call" ? args : kind === "tool_result" ? result : undefined),
    ) ??
    (kind === "tool_call" && args != null ? compactJson(coerceJson(args)) : undefined) ??
    (kind === "tool_result" && result != null ? compactJson(coerceJson(result)) : undefined);

  const error =
    flattenText(value.error) ??
    flattenText(value.exception) ??
    looksLikeError(value) ??
    (kind === "error" ? content : undefined);

  if (error && kind !== "tool_call") kind = "error";

  if (!kind) {
    if (name && (args != null || value.arguments != null)) kind = "tool_call";
    else if (content) kind = "other";
    else return null;
  }

  const ts = parseTimestamp(
    pickUnknown(value, [
      "ts",
      "timestamp",
      "time",
      "created_at",
      "createdAt",
      "start_time",
      "startTime",
      "started_at",
    ]),
  );
  const durationMs = pickNumber(value, ["durationMs", "duration_ms", "duration", "latency", "latency_ms"]);
  const tokensIn = pickNumber(value, ["tokensIn", "tokens_in", "prompt_tokens", "input_tokens"]);
  const tokensOut = pickNumber(value, ["tokensOut", "tokens_out", "completion_tokens", "output_tokens"]);

  const usage = isRecord(value.usage) ? value.usage : undefined;
  const usageIn = usage ? pickNumber(usage, ["prompt_tokens", "input_tokens", "tokens_in"]) : undefined;
  const usageOut = usage
    ? pickNumber(usage, ["completion_tokens", "output_tokens", "tokens_out"])
    : undefined;

  const title = titleFor(kind, name);
  const step: TraceStep = {
    index,
    kind,
    title,
    ts,
  };
  if (name) step.name = name;
  if (content) step.content = content;
  if (args != null && kind === "tool_call") step.args = coerceJson(args);
  if (result != null && (kind === "tool_result" || kind === "error")) step.result = coerceJson(result);
  if (error) step.error = error;
  if (durationMs != null) step.durationMs = durationMs;
  if ((tokensIn ?? usageIn) != null) step.tokensIn = tokensIn ?? usageIn;
  if ((tokensOut ?? usageOut) != null) step.tokensOut = tokensOut ?? usageOut;
  if (toolCallId) step.toolCallId = toolCallId;
  return step;
}

function inferKind(value: Record<string, unknown>, typeKey: string | undefined): StepKind | "other" {
  if (typeKey?.startsWith("on_")) {
    if (typeKey.includes("error")) return "error";
    if (typeKey.includes("tool_start") || typeKey.includes("tool_call")) return "tool_call";
    if (typeKey.includes("tool_end") || typeKey.includes("tool_result")) return "tool_result";
    if (typeKey.includes("chat") || typeKey.includes("llm")) return "thought";
    if (typeKey.includes("chain")) return "other";
  }
  if (value.tool_calls || value.function_call) return "assistant";
  if (value.role === "tool" || value.role === "function") return "tool_result";
  if (typeof value.role === "string") {
    const aliased = KIND_ALIASES[value.role];
    if (aliased) return aliased;
  }
  if (value.error || value.exception) return "error";
  if (value.name && (value.arguments != null || value.args != null || value.input != null)) {
    return "tool_call";
  }
  if (value.observation != null || (value.name && value.output != null)) return "tool_result";
  return "other";
}

export function titleFor(kind: StepKind, name?: string): string {
  switch (kind) {
    case "user":
      return "user";
    case "system":
      return "system";
    case "thought":
      return "thought";
    case "assistant":
      return "assistant";
    case "tool_call":
      return name ? `tool ${name}` : "tool";
    case "tool_result":
      return name ? `result ${name}` : "result";
    case "error":
      return name ? `error ${name}` : "error";
    default:
      return name ?? "event";
  }
}

export function reindex(steps: TraceStep[]): TraceStep[] {
  return steps.map((step, i) => ({ ...step, index: i + 1 }));
}
