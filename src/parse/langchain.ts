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
import { normalizeEvent, reindex, titleFor } from "./event.js";

const LANGCHAIN_EVENTS = new Set([
  "llm_start",
  "llm_end",
  "llm_error",
  "llm_new_token",
  "chat_model_start",
  "chat_model_end",
  "chat_model_error",
  "tool_start",
  "tool_end",
  "tool_error",
  "chain_start",
  "chain_end",
  "chain_error",
  "agent_action",
  "agent_finish",
  "on_llm_start",
  "on_llm_end",
  "on_llm_error",
  "on_chat_model_start",
  "on_chat_model_end",
  "on_chat_model_stream",
  "on_chat_model_error",
  "on_tool_start",
  "on_tool_end",
  "on_tool_error",
  "on_chain_start",
  "on_chain_end",
  "on_chain_error",
  "on_agent_action",
  "on_agent_finish",
]);

export function parseLangChain(input: unknown, source?: string): Trace {
  const warnings: string[] = [];
  const steps: TraceStep[] = [];

  if (Array.isArray(input)) {
    for (const item of input) collect(item, steps, warnings);
  } else if (isRecord(input)) {
    if (Array.isArray(input.logs)) {
      for (const item of input.logs) collect(item, steps, warnings);
    } else if (Array.isArray(input.events)) {
      for (const item of input.events) collect(item, steps, warnings);
    } else if (Array.isArray(input.runs)) {
      for (const item of input.runs) collect(item, steps, warnings);
    } else {
      collect(input, steps, warnings);
    }
  } else {
    warnings.push("langchain parser expected an object or array");
  }

  const indexed = reindex(steps);
  const stats = computeStats(indexed);
  const trace: Trace = {
    format: "langchain",
    steps: indexed,
    stats,
    warnings,
  };
  if (source) trace.source = source;
  return trace;
}

function collect(node: unknown, steps: TraceStep[], warnings: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, steps, warnings);
    return;
  }
  if (!isRecord(node)) return;

  if (Array.isArray(node.child_runs) || node.run_type) {
    flattenRun(node, steps, warnings);
    return;
  }

  const event = pickString(node, ["event", "type", "kind"]);
  if (event && (LANGCHAIN_EVENTS.has(event) || LANGCHAIN_EVENTS.has(event.replace(/^on_/, "on_")))) {
    const step = fromCallback(node, event);
    if (step) steps.push(step);
    return;
  }

  if (node.tool || node.tool_input || node.log) {
    const action = fromAgentAction(node);
    if (action) steps.push(action);
    return;
  }

  const fallback = normalizeEvent(node, 0);
  if (fallback && fallback.kind !== "other") steps.push(fallback);
}

function flattenRun(run: Record<string, unknown>, steps: TraceStep[], warnings: string[]): void {
  const runType = String(run.run_type ?? "").toLowerCase();
  const name = pickString(run, ["name", "serialized"]) ?? runType;
  const ts = parseTimestamp(run.start_time ?? run.startTime ?? run.dotted_order);
  const end = parseTimestamp(run.end_time ?? run.endTime);
  const durationMs =
    pickNumber(run, ["duration_ms", "latency"]) ??
    (ts && end ? Date.parse(end) - Date.parse(ts) : undefined);
  const err = flattenText(run.error);

  if (runType === "tool" || runType === "retriever") {
    steps.push({
      index: 0,
      kind: "tool_call",
      title: titleFor("tool_call", name),
      name,
      args: run.inputs ?? run.input,
      content: compactJson(run.inputs ?? run.input),
      ts,
      durationMs,
    });
    steps.push({
      index: 0,
      kind: err ? "error" : "tool_result",
      title: titleFor(err ? "error" : "tool_result", name),
      name,
      content: flattenText(run.outputs) ?? compactJson(run.outputs) ?? err,
      result: run.outputs,
      error: err,
      ts: end ?? ts,
      durationMs,
    });
  } else if (runType === "llm" || runType === "chat_model" || runType === "prompt") {
    const inputText = flattenText(run.inputs) ?? flattenMessages(run.inputs);
    if (inputText && !steps.some((s) => s.kind === "user")) {
      // Keep prompt noise down unless it looks like the original user turn.
      const maybeUser = firstHuman(run.inputs);
      if (maybeUser) {
        steps.push({ index: 0, kind: "user", title: "user", content: maybeUser, ts });
      }
    }
    const output = flattenText(run.outputs) ?? flattenGenerations(run.outputs) ?? flattenText(run.output);
    if (output) {
      steps.push({
        index: 0,
        kind: "thought",
        title: "thought",
        content: output,
        ts: end ?? ts,
        durationMs,
        tokensIn: tokenFrom(run, "prompt"),
        tokensOut: tokenFrom(run, "completion"),
      });
    }
    if (err) {
      steps.push({
        index: 0,
        kind: "error",
        title: titleFor("error", name),
        name,
        error: err,
        content: err,
        ts: end ?? ts,
      });
    }
  } else if (err) {
    steps.push({
      index: 0,
      kind: "error",
      title: titleFor("error", name),
      name,
      error: err,
      content: err,
      ts: end ?? ts,
    });
  }

  for (const child of asArray(run.child_runs)) {
    if (isRecord(child)) flattenRun(child, steps, warnings);
    else collect(child, steps, warnings);
  }
}

function fromCallback(node: Record<string, unknown>, event: string): TraceStep | null {
  const key = event.replace(/^on_/, "");
  const name = pickString(node, ["name", "serialized"]) ?? pickNestedName(node);
  const ts = parseTimestamp(node.ts ?? node.timestamp ?? node.time);
  const data = isRecord(node.data) ? node.data : node;

  if (key.includes("tool_start") || key === "agent_action") {
    const args = data.input ?? data.inputs ?? data.tool_input ?? node.tool_input ?? node.input;
    return {
      index: 0,
      kind: "tool_call",
      title: titleFor("tool_call", name),
      name: name ?? pickString(data, ["name"]),
      args: coerceJson(args),
      content: flattenText(args) ?? compactJson(args),
      ts,
    };
  }
  if (key.includes("tool_end")) {
    const output = data.output ?? data.outputs ?? node.output;
    return {
      index: 0,
      kind: "tool_result",
      title: titleFor("tool_result", name),
      name,
      content: flattenText(output) ?? compactJson(output),
      result: coerceJson(output),
      ts,
    };
  }
  if (key.includes("error") || key.includes("tool_error")) {
    const err = flattenText(data.error ?? node.error) ?? compactJson(data.error ?? node.error);
    return {
      index: 0,
      kind: "error",
      title: titleFor("error", name),
      name,
      error: err,
      content: err,
      ts,
    };
  }
  if (key.includes("llm_end") || key.includes("chat_model_end") || key === "agent_finish") {
    const output =
      flattenText(data.output) ??
      flattenGenerations(data.output ?? data.outputs ?? node.generations) ??
      flattenText(node.output);
    if (!output) return null;
    return {
      index: 0,
      kind: "thought",
      title: "thought",
      content: output,
      ts,
    };
  }
  if (key.includes("llm_start") || key.includes("chat_model_start") || key.includes("chain_")) {
    return null;
  }
  return normalizeEvent(node, 0);
}

function fromAgentAction(node: Record<string, unknown>): TraceStep | null {
  const name = pickString(node, ["tool", "name"]);
  const input = node.tool_input ?? node.input ?? node.args;
  if (!name && input == null) return null;
  return {
    index: 0,
    kind: "tool_call",
    title: titleFor("tool_call", name),
    name,
    args: coerceJson(input),
    content: flattenText(input) ?? compactJson(input),
    ts: parseTimestamp(node.ts),
  };
}

function flattenGenerations(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const texts = value.flatMap((row) => (Array.isArray(row) ? row : [row])).map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item)) return flattenText(item.text ?? item.message ?? item.content);
      return undefined;
    });
    const joined = texts.filter(Boolean).join("\n");
    return joined || undefined;
  }
  if (isRecord(value)) {
    return flattenGenerations(value.generations) ?? flattenText(value.text ?? value.content ?? value.output);
  }
  return undefined;
}

function flattenMessages(value: unknown): string | undefined {
  if (!isRecord(value)) return flattenText(value);
  if (Array.isArray(value.messages)) {
    return value.messages
      .map((m) => flattenText(m))
      .filter(Boolean)
      .join("\n");
  }
  return flattenText(value);
}

function firstHuman(value: unknown): string | undefined {
  const messages = isRecord(value) && Array.isArray(value.messages) ? value.messages : asArray(value);
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    const role = String(msg.role ?? msg.type ?? "").toLowerCase();
    if (role === "user" || role === "human") return flattenText(msg.content ?? msg);
  }
  return undefined;
}

function tokenFrom(run: Record<string, unknown>, side: "prompt" | "completion"): number | undefined {
  const usage =
    (isRecord(run.extra) && isRecord(run.extra.metadata) && isRecord(run.extra.metadata.usage)
      ? run.extra.metadata.usage
      : undefined) ??
    (isRecord(run.outputs) && isRecord(run.outputs.llm_output) && isRecord(run.outputs.llm_output.token_usage)
      ? run.outputs.llm_output.token_usage
      : undefined);
  if (!usage) return undefined;
  return side === "prompt"
    ? pickNumber(usage, ["prompt_tokens", "input_tokens"])
    : pickNumber(usage, ["completion_tokens", "output_tokens"]);
}

function pickNestedName(node: Record<string, unknown>): string | undefined {
  const serialized = node.serialized;
  if (isRecord(serialized) && typeof serialized.name === "string") return serialized.name;
  const kwargs = isRecord(node.kwargs) ? node.kwargs : undefined;
  if (kwargs && typeof kwargs.name === "string") return kwargs.name;
  return undefined;
}

export function looksLikeLangChain(value: unknown): boolean {
  if (Array.isArray(value)) {
    const sample = value.slice(0, 10).filter(isRecord);
    if (!sample.length) return false;
    const hits = sample.filter((item) => {
      const event = pickString(item, ["event", "type"]);
      return (
        (event && LANGCHAIN_EVENTS.has(event)) ||
        item.run_type != null ||
        item.child_runs != null ||
        item.tool_input != null
      );
    }).length;
    return hits >= Math.ceil(sample.length / 2);
  }
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.child_runs) ||
    typeof value.run_type === "string" ||
    Array.isArray(value.logs) ||
    (Array.isArray(value.events) && looksLikeLangChain(value.events))
  );
}
