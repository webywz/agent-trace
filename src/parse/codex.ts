import type { Trace, TraceStep } from "../types.js";
import { computeStats } from "../stats.js";
import {
  coerceJson,
  compactJson,
  flattenText,
  isRecord,
  parseTimestamp,
  pickString,
  tryJsonParse,
} from "../util.js";
import { reindex, titleFor } from "./event.js";

/** Codex CLI event type → step kind (payload-aware refinements below). */
const TYPE_KIND: Record<string, TraceStep["kind"]> = {
  agent_message: "assistant",
  message: "assistant",
  agent_reasoning: "thought",
  reasoning: "thought",
  thought: "thought",
  function_call: "tool_call",
  tool_call: "tool_call",
  function_call_output: "tool_result",
  tool_result: "tool_result",
  function_output: "tool_result",
  task_started: "system",
  task_complete: "assistant",
  task_completed: "assistant",
  error: "error",
  exception: "error",
  user_message: "user",
  user: "user",
};

function splitLines(text: string): { rows: unknown[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows: unknown[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw?.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    const parsed = tryJsonParse(line);
    if (parsed === undefined) {
      warnings.push(`line ${i + 1}: skipped invalid JSON`);
      continue;
    }
    rows.push(parsed);
  }
  return { rows, warnings };
}

/**
 * Codex CLI JSONL — typically `{ timestamp, type, payload }` or `{ msg: { type, ... } }`.
 */
export function parseCodex(input: unknown, source?: string): Trace {
  const warnings: string[] = [];
  const rows = coerceRows(input, warnings);
  const steps: TraceStep[] = [];

  for (const row of rows) {
    if (!isRecord(row)) {
      warnings.push("skipped non-object Codex event");
      continue;
    }

    const { type, payload, ts } = unwrap(row);
    if (!type) {
      warnings.push("skipped Codex event without type");
      continue;
    }
    if (
      type === "task_started" ||
      type === "token_count" ||
      type === "session_meta" ||
      type === "turn_started" ||
      type === "turn_completed"
    ) {
      const note =
        flattenText(payload) ??
        (isRecord(payload) ? flattenText(payload.prompt) : undefined);
      if (type === "task_started" && note) {
        steps.push({ index: 0, kind: "system", title: "system", content: note, ts });
      }
      continue;
    }

    const step = mapEvent(type, payload, ts, warnings);
    if (step) steps.push(step);
  }

  const indexed = reindex(steps.filter(Boolean));
  if (!indexed.length) warnings.push("codex parser produced no steps");

  const trace: Trace = {
    format: "codex",
    steps: indexed,
    stats: computeStats(indexed),
    warnings,
  };
  if (source) trace.source = source;
  return trace;
}

function unwrap(row: Record<string, unknown>): {
  type: string;
  payload: unknown;
  ts: string | undefined;
} {
  const ts = parseTimestamp(row.timestamp ?? row.ts ?? row.created_at ?? row.time);
  if (isRecord(row.msg) && typeof row.msg.type === "string") {
    const msg = row.msg;
    const { type: _t, ...rest } = msg;
    return {
      type: String(msg.type).toLowerCase().replace(/[\s-]+/g, "_"),
      payload: rest,
      ts,
    };
  }
  if (isRecord(row.item) && typeof row.item.type === "string") {
    return {
      type: String(row.item.type).toLowerCase().replace(/[\s-]+/g, "_"),
      payload: row.item,
      ts,
    };
  }
  const type = String(row.type ?? row.event ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const payload = row.payload !== undefined ? row.payload : row.data !== undefined ? row.data : row;
  return { type, payload, ts };
}

function mapEvent(
  type: string,
  payload: unknown,
  ts: string | undefined,
  warnings: string[],
): TraceStep | null {
  const body = isRecord(payload) ? payload : {};

  if (
    type === "agent_message" ||
    type === "message" ||
    type === "task_complete" ||
    type === "task_completed"
  ) {
    const content =
      flattenText(body.message) ??
      flattenText(body.text) ??
      flattenText(body.content) ??
      flattenText(body.result) ??
      (typeof payload === "string" ? payload : undefined);
    if (!content) return null;
    return { index: 0, kind: "assistant", title: "assistant", content, ts };
  }

  if (type === "user_message" || type === "user") {
    const content =
      flattenText(body.message) ??
      flattenText(body.text) ??
      flattenText(body.content) ??
      (typeof payload === "string" ? payload : undefined);
    if (!content) return null;
    return { index: 0, kind: "user", title: "user", content, ts };
  }

  if (type === "agent_reasoning" || type === "reasoning" || type === "thought") {
    const content =
      flattenText(body.text) ??
      flattenText(body.reasoning) ??
      flattenText(body.content) ??
      flattenText(body.message);
    if (!content) return null;
    return { index: 0, kind: "thought", title: "thought", content, ts };
  }

  if (type === "function_call" || type === "tool_call") {
    const name =
      pickString(body, ["name", "tool", "function", "function_name"]) ??
      (isRecord(body.function) ? pickString(body.function, ["name"]) : undefined) ??
      "tool";
    const args = coerceJson(
      body.arguments ??
        body.args ??
        body.input ??
        body.parameters ??
        (isRecord(body.function) ? body.function.arguments : undefined),
    );
    return {
      index: 0,
      kind: "tool_call",
      title: titleFor("tool_call", name),
      name,
      args,
      content: typeof args === "string" ? args : compactJson(args),
      ts,
      toolCallId: pickString(body, ["call_id", "id", "tool_call_id"]),
    };
  }

  if (type === "function_call_output" || type === "tool_result" || type === "function_output") {
    const name = pickString(body, ["name", "tool", "function"]);
    const result = body.output ?? body.result ?? body.content ?? body.response;
    const errFlag = body.is_error === true || body.success === false;
    const errText = flattenText(body.error);
    const contentText =
      flattenText(result) ?? (result != null ? compactJson(coerceJson(result)) : undefined);
    const isErr = errFlag || Boolean(errText);
    return {
      index: 0,
      kind: isErr ? "error" : "tool_result",
      title: titleFor(isErr ? "error" : "tool_result", name),
      name,
      content: contentText,
      result: coerceJson(result),
      error: errText ?? (errFlag ? contentText || "tool error" : undefined),
      ts,
      toolCallId: pickString(body, ["call_id", "id", "tool_call_id"]),
    };
  }

  if (type === "error" || type === "exception") {
    const content =
      flattenText(body.error) ??
      flattenText(body.message) ??
      flattenText(body.content) ??
      flattenText(payload) ??
      "error";
    return { index: 0, kind: "error", title: "error", content, error: content, ts };
  }

  const kind = TYPE_KIND[type];
  if (kind) {
    const content = flattenText(payload) ?? flattenText(body.message) ?? flattenText(body.content);
    if (!content && kind !== "system") return null;
    return { index: 0, kind, title: kind, content: content ?? undefined, ts };
  }

  warnings.push(`skipped unsupported Codex event type '${type}'`);
  return null;
}

function coerceRows(input: unknown, warnings: string[]): unknown[] {
  if (typeof input === "string") {
    const { rows, warnings: w } = splitLines(input);
    warnings.push(...w);
    return rows;
  }
  if (Array.isArray(input)) return input;
  if (isRecord(input)) {
    if (Array.isArray(input.events)) return input.events;
    return [input];
  }
  warnings.push("codex parser expected JSONL, an array, or an object");
  return [];
}

const CODEX_MARKERS = new Set([
  "agent_message",
  "agent_reasoning",
  "function_call",
  "function_call_output",
  "function_output",
  "task_started",
  "task_complete",
  "task_completed",
  "token_count",
  "session_meta",
  "turn_started",
  "turn_completed",
  "user_message",
]);

export function looksLikeCodex(value: unknown): boolean {
  const rows = sampleRows(value);
  if (!rows.length) return false;
  let hits = 0;
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const { type } = unwrap(row);
    if (!type) continue;
    const enveloped =
      row.payload != null || row.msg != null || row.item != null;
    // Distinctive Codex type names, or a typed event wrapped in Codex envelope.
    // Do NOT treat bare tool_call/thought/error rows as Codex — those are generic JSONL.
    if (CODEX_MARKERS.has(type) || (enveloped && type in TYPE_KIND)) {
      hits += 1;
    }
  }
  return hits >= Math.min(2, rows.length) && hits >= Math.ceil(rows.length * 0.5);
}

function sampleRows(value: unknown): Record<string, unknown>[] {
  if (typeof value === "string") {
    const { rows } = splitLines(value);
    return rows.filter(isRecord).slice(0, 16);
  }
  if (Array.isArray(value)) return value.filter(isRecord).slice(0, 16);
  if (isRecord(value)) {
    if (Array.isArray(value.events)) return value.events.filter(isRecord).slice(0, 16);
    return [value];
  }
  return [];
}
