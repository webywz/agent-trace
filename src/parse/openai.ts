import type { Trace, TraceStep } from "../types.js";
import { computeStats } from "../stats.js";
import {
  asArray,
  coerceJson,
  compactJson,
  flattenText,
  isRecord,
  parseTimestamp,
  pickNumber,
  pickString,
} from "../util.js";
import { reindex, titleFor } from "./event.js";

export function parseOpenAI(input: unknown, source?: string): Trace {
  const warnings: string[] = [];
  const steps: TraceStep[] = [];
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;

  const applyUsage = (usage: unknown) => {
    if (!isRecord(usage)) return;
    const inn = pickNumber(usage, ["prompt_tokens", "input_tokens", "tokens_in"]);
    const out = pickNumber(usage, ["completion_tokens", "output_tokens", "tokens_out"]);
    if (inn != null) tokensIn = (tokensIn ?? 0) + inn;
    if (out != null) tokensOut = (tokensOut ?? 0) + out;
  };

  if (Array.isArray(input)) {
    if (input.every((item) => isRecord(item) && (item.delta != null || item.choices != null))) {
      const merged = mergeStreamingChunks(input, warnings);
      steps.push(...merged.steps);
      applyUsage(merged.usage);
    } else {
      steps.push(...messagesToSteps(input, warnings));
    }
  } else if (isRecord(input)) {
    applyUsage(input.usage);
    if (Array.isArray(input.messages)) {
      steps.push(...messagesToSteps(input.messages, warnings));
    }
    if (Array.isArray(input.choices)) {
      for (const choice of input.choices) {
        if (!isRecord(choice)) continue;
        if (isRecord(choice.message)) {
          steps.push(...messagesToSteps([choice.message], warnings));
        } else if (isRecord(choice.delta)) {
          steps.push(...messagesToSteps([{ role: "assistant", ...choice.delta }], warnings));
        }
      }
    }
    if (Array.isArray(input.output)) {
      steps.push(...responsesOutputToSteps(input.output, warnings));
    }
    if (isRecord(input.message)) {
      steps.push(...messagesToSteps([input.message], warnings));
    }
    if (input.object === "trace" && Array.isArray(input.spans)) {
      steps.push(...spansToSteps(input.spans, warnings));
    }
    if (Array.isArray(input.data) && input.object === "list") {
      return parseOpenAI(input.data, source);
    }
  } else {
    warnings.push("openai parser expected an object or array");
  }

  const indexed = reindex(steps.filter(Boolean));
  if (indexed.length === 0) {
    warnings.push("openai parser produced no steps");
  }

  const stats = computeStats(indexed);
  if (tokensIn != null) stats.tokensIn = tokensIn;
  if (tokensOut != null) stats.tokensOut = tokensOut;

  const trace: Trace = {
    format: "openai",
    steps: indexed,
    stats,
    warnings,
  };
  if (source) trace.source = source;
  return trace;
}

function messagesToSteps(messages: unknown[], warnings: string[]): TraceStep[] {
  const steps: TraceStep[] = [];
  for (const raw of messages) {
    if (!isRecord(raw)) {
      warnings.push("skipped non-object message");
      continue;
    }
    const role = String(raw.role ?? "assistant").toLowerCase();
    const ts = parseTimestamp(raw.ts ?? raw.timestamp ?? raw.created_at);
    const toolCalls = asArray(raw.tool_calls);
    const content = flattenText(raw.content);

    if (role === "tool" || role === "function") {
      const name = pickString(raw, ["name", "tool", "tool_name"]);
      const err = flattenText(raw.error);
      steps.push({
        index: 0,
        kind: err ? "error" : "tool_result",
        title: titleFor(err ? "error" : "tool_result", name),
        name,
        content: content ?? compactJson(raw.content),
        result: coerceJson(raw.content),
        error: err,
        ts,
        toolCallId: pickString(raw, ["tool_call_id", "id"]),
      });
      continue;
    }

    if (role === "user") {
      steps.push({
        index: 0,
        kind: "user",
        title: "user",
        content,
        ts,
      });
      continue;
    }

    if (role === "system" || role === "developer") {
      if (content) {
        steps.push({
          index: 0,
          kind: "system",
          title: "system",
          content,
          ts,
        });
      }
      continue;
    }

    if (content) {
      steps.push({
        index: 0,
        kind: toolCalls.length ? "thought" : "assistant",
        title: toolCalls.length ? "thought" : "assistant",
        content,
        ts,
      });
    }

    if (isRecord(raw.function_call)) {
      steps.push(toolCallStep(raw.function_call, ts));
    }

    for (const call of toolCalls) {
      if (!isRecord(call)) continue;
      const fn = isRecord(call.function) ? call.function : call;
      steps.push({
        ...toolCallStep(fn, ts),
        toolCallId: pickString(call, ["id", "tool_call_id"]),
      });
    }
  }
  return steps;
}

function toolCallStep(fn: Record<string, unknown>, ts?: string): TraceStep {
  const name = pickString(fn, ["name", "tool", "function"]) ?? "function";
  const args = coerceJson(fn.arguments ?? fn.args ?? fn.input ?? fn.parameters);
  return {
    index: 0,
    kind: "tool_call",
    title: titleFor("tool_call", name),
    name,
    args,
    content: typeof args === "string" ? args : compactJson(args),
    ts,
  };
}

function responsesOutputToSteps(output: unknown[], warnings: string[]): TraceStep[] {
  const steps: TraceStep[] = [];
  for (const item of output) {
    if (!isRecord(item)) {
      warnings.push("skipped non-object Responses output item");
      continue;
    }
    const type = String(item.type ?? "");
    const ts = parseTimestamp(item.ts ?? item.timestamp);
    if (type === "message" || item.role === "assistant" || item.role === "user") {
      const role = String(item.role ?? "assistant");
      const content = flattenText(item.content) ?? flattenText(item.text);
      const kind = role === "user" ? "user" : "assistant";
      if (content) {
        steps.push({ index: 0, kind, title: kind, content, ts });
      }
      continue;
    }
    if (type === "function_call" || type === "tool_call" || type === "custom_tool_call") {
      const name = pickString(item, ["name", "tool"]) ?? "function";
      const args = coerceJson(item.arguments ?? item.input);
      steps.push({
        index: 0,
        kind: "tool_call",
        title: titleFor("tool_call", name),
        name,
        args,
        content: compactJson(args),
        ts,
        toolCallId: pickString(item, ["call_id", "id"]),
      });
      continue;
    }
    if (type === "function_call_output" || type === "tool_result" || type === "custom_tool_call_output") {
      const err = flattenText(item.error);
      steps.push({
        index: 0,
        kind: err ? "error" : "tool_result",
        title: titleFor(err ? "error" : "tool_result", pickString(item, ["name"])),
        name: pickString(item, ["name"]),
        content: flattenText(item.output ?? item.content) ?? compactJson(item.output),
        result: coerceJson(item.output ?? item.content),
        error: err,
        ts,
        toolCallId: pickString(item, ["call_id", "id"]),
      });
      continue;
    }
    if (type === "reasoning") {
      const content = flattenText(item.summary ?? item.content);
      if (content) {
        steps.push({ index: 0, kind: "thought", title: "thought", content, ts });
      }
    }
  }
  return steps;
}

function spansToSteps(spans: unknown[], warnings: string[]): TraceStep[] {
  const steps: TraceStep[] = [];
  for (const span of spans) {
    if (!isRecord(span)) continue;
    const type = String(span.type ?? span.span_type ?? "");
    const ts = parseTimestamp(span.started_at ?? span.start_time ?? span.ts);
    const name = pickString(span, ["name", "tool"]);
    if (type === "function" || type === "tool") {
      const err = flattenText(span.error);
      steps.push({
        index: 0,
        kind: "tool_call",
        title: titleFor("tool_call", name),
        name,
        args: span.input ?? span.arguments,
        content: compactJson(span.input ?? span.arguments),
        ts,
      });
      steps.push({
        index: 0,
        kind: err ? "error" : "tool_result",
        title: titleFor(err ? "error" : "tool_result", name),
        name,
        content: flattenText(span.output) ?? compactJson(span.output),
        result: span.output,
        error: err,
        ts: parseTimestamp(span.ended_at ?? span.end_time) ?? ts,
      });
    } else if (type === "generation" || type === "llm" || type === "response") {
      const content = flattenText(span.output) ?? flattenText(span.content);
      if (content) {
        steps.push({ index: 0, kind: "assistant", title: "assistant", content, ts });
      }
    } else if (Array.isArray(span.spans)) {
      steps.push(...spansToSteps(span.spans, warnings));
    }
  }
  return steps;
}

function mergeStreamingChunks(
  chunks: unknown[],
  warnings: string[],
): { steps: TraceStep[]; usage?: unknown } {
  let content = "";
  const toolArgs: Record<number, { name?: string; arguments: string; id?: string }> = {};
  let usage: unknown;
  let role = "assistant";
  for (const chunk of chunks) {
    if (!isRecord(chunk)) continue;
    if (chunk.usage) usage = chunk.usage;
    const choices = asArray(chunk.choices);
    const delta = isRecord(choices[0])
      ? (choices[0].delta ?? choices[0].message)
      : isRecord(chunk.delta)
        ? chunk.delta
        : chunk;
    if (!isRecord(delta)) continue;
    if (typeof delta.role === "string") role = delta.role;
    if (typeof delta.content === "string") content += delta.content;
    for (const call of asArray(delta.tool_calls)) {
      if (!isRecord(call)) continue;
      const index = typeof call.index === "number" ? call.index : 0;
      const slot = (toolArgs[index] ??= { arguments: "", id: pickString(call, ["id"]) });
      const fn = isRecord(call.function) ? call.function : call;
      if (typeof fn.name === "string") slot.name = fn.name;
      if (typeof fn.arguments === "string") slot.arguments += fn.arguments;
    }
  }
  const messages: Record<string, unknown>[] = [];
  if (content || Object.keys(toolArgs).length === 0) {
    messages.push({ role, content });
  } else if (content) {
    messages.push({ role, content });
  }
  const tool_calls = Object.values(toolArgs).map((slot, i) => ({
    id: slot.id,
    index: i,
    function: { name: slot.name, arguments: slot.arguments },
  }));
  if (tool_calls.length) {
    if (!messages.length) messages.push({ role: "assistant", content: "" });
    const last = messages[messages.length - 1];
    if (last) last.tool_calls = tool_calls;
  }
  if (!content && !tool_calls.length) warnings.push("streaming chunks had no content");
  return { steps: messagesToSteps(messages, warnings), usage };
}

export function looksLikeOpenAI(value: unknown): boolean {
  if (Array.isArray(value)) {
    const sample = value.slice(0, 8).filter(isRecord);
    if (!sample.length) return false;
    const hits = sample.filter(
      (item) =>
        typeof item.role === "string" ||
        item.tool_calls != null ||
        item.delta != null ||
        (item.choices != null && Array.isArray(item.choices)),
    ).length;
    return hits >= Math.ceil(sample.length / 2);
  }
  if (!isRecord(value)) return false;
  if (value.object === "chat.completion" || value.object === "response" || value.object === "thread") {
    return true;
  }
  if (Array.isArray(value.choices) || Array.isArray(value.messages) || Array.isArray(value.output)) {
    return true;
  }
  return typeof value.role === "string" && (value.content != null || value.tool_calls != null);
}
