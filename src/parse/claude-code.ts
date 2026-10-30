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

const ROW_TYPES = new Set([
  "assistant",
  "user",
  "system",
  "result",
  "error",
  "tool_progress",
  "stream_event",
]);

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
 * Claude Code `--output-format stream-json` (and close cousins).
 * Lines look like `{ type: "assistant"|"user"|"result"|"system", message?: {...} }`.
 */
export function parseClaudeCode(input: unknown, source?: string): Trace {
  const warnings: string[] = [];
  const rows = coerceRows(input, warnings);
  const steps: TraceStep[] = [];

  for (const row of rows) {
    if (!isRecord(row)) {
      warnings.push("skipped non-object Claude Code event");
      continue;
    }
    const type = String(row.type ?? "").toLowerCase();
    const ts = parseTimestamp(row.ts ?? row.timestamp ?? row.created_at);

    if (type === "system" || type === "stream_event" || type === "tool_progress") {
      const content =
        flattenText(row.message) ??
        flattenText(row.content) ??
        flattenText(row.subtype) ??
        flattenText(row.text);
      if (content && type === "system" && !/^(init|status)$/i.test(String(row.subtype ?? ""))) {
        steps.push({ index: 0, kind: "system", title: "system", content, ts });
      }
      continue;
    }

    if (type === "result") {
      const err =
        row.is_error === true ||
        String(row.subtype ?? "").toLowerCase() === "error" ||
        row.error != null;
      const content =
        flattenText(row.result) ??
        flattenText(row.content) ??
        flattenText(row.error) ??
        flattenText(row.message);
      if (err) {
        steps.push({
          index: 0,
          kind: "error",
          title: "error",
          content: content ?? "Claude Code result error",
          error: content ?? "Claude Code result error",
          ts,
        });
      } else if (content) {
        steps.push({ index: 0, kind: "assistant", title: "assistant", content, ts });
      }
      continue;
    }

    if (type === "error") {
      const content =
        flattenText(row.error) ?? flattenText(row.message) ?? flattenText(row.content) ?? "error";
      steps.push({ index: 0, kind: "error", title: "error", content, error: content, ts });
      continue;
    }

    if (type === "assistant" || type === "user") {
      steps.push(...messageToSteps(row, type, ts, warnings));
      continue;
    }

    if (isRecord(row.message) || row.content != null) {
      const role = String(
        row.role ?? (isRecord(row.message) ? row.message.role : "") ?? "assistant",
      );
      steps.push(...messageToSteps(row, role === "user" ? "user" : "assistant", ts, warnings));
      continue;
    }

    warnings.push(`skipped Claude Code event type '${type || "unknown"}'`);
  }

  const indexed = reindex(steps.filter(Boolean));
  if (!indexed.length) warnings.push("claude-code parser produced no steps");

  const trace: Trace = {
    format: "claude-code",
    steps: indexed,
    stats: computeStats(indexed),
    warnings,
  };
  if (source) trace.source = source;
  return trace;
}

function messageToSteps(
  row: Record<string, unknown>,
  fallbackRole: "assistant" | "user",
  ts: string | undefined,
  warnings: string[],
): TraceStep[] {
  const message = isRecord(row.message) ? row.message : row;
  const role = String(message.role ?? fallbackRole).toLowerCase();
  const content = message.content ?? row.content;
  const out: TraceStep[] = [];

  if (typeof content === "string" || content == null) {
    const text = flattenText(content);
    if (!text) return out;
    if (role === "user") out.push({ index: 0, kind: "user", title: "user", content: text, ts });
    else if (role === "system") out.push({ index: 0, kind: "system", title: "system", content: text, ts });
    else out.push({ index: 0, kind: "assistant", title: "assistant", content: text, ts });
    return out;
  }

  if (!Array.isArray(content)) {
    const text = flattenText(content);
    if (text) {
      const kind = role === "user" ? "user" : role === "system" ? "system" : "assistant";
      out.push({ index: 0, kind, title: kind, content: text, ts });
    } else {
      warnings.push("skipped Claude Code message with non-array content");
    }
    return out;
  }

  for (const block of content) {
    if (!isRecord(block)) {
      warnings.push("skipped non-object Claude Code content block");
      continue;
    }
    const btype = String(block.type ?? "");

    if (btype === "text" || btype === "") {
      const text = typeof block.text === "string" ? block.text : flattenText(block);
      if (!text) continue;
      const kind = role === "user" ? "user" : role === "system" ? "system" : "assistant";
      out.push({ index: 0, kind, title: kind, content: text, ts });
      continue;
    }

    if (btype === "thinking" || btype === "redacted_thinking") {
      const text =
        typeof block.thinking === "string"
          ? block.thinking
          : btype === "redacted_thinking"
            ? "[redacted thinking]"
            : flattenText(block);
      if (text) out.push({ index: 0, kind: "thought", title: "thought", content: text, ts });
      continue;
    }

    if (btype === "tool_use") {
      const name = pickString(block, ["name", "tool"]) ?? "tool";
      const args = coerceJson(block.input ?? block.arguments ?? block.args);
      out.push({
        index: 0,
        kind: "tool_call",
        title: titleFor("tool_call", name),
        name,
        args,
        content: typeof args === "string" ? args : compactJson(args),
        ts,
        toolCallId: pickString(block, ["id", "tool_use_id"]),
      });
      continue;
    }

    if (btype === "tool_result") {
      const name = pickString(block, ["name", "tool"]);
      const errFlag = block.is_error === true;
      const errText = flattenText(block.error);
      const resultContent = block.content;
      const contentText =
        flattenText(resultContent) ??
        (typeof resultContent === "string" ? resultContent : compactJson(resultContent));
      const isErr = errFlag || Boolean(errText);
      out.push({
        index: 0,
        kind: isErr ? "error" : "tool_result",
        title: titleFor(isErr ? "error" : "tool_result", name),
        name,
        content: contentText,
        result: coerceJson(typeof resultContent === "string" ? resultContent : resultContent),
        error: errText ?? (errFlag ? contentText || "tool error" : undefined),
        ts,
        toolCallId: pickString(block, ["tool_use_id", "id"]),
      });
      continue;
    }
  }

  return out;
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
    if (Array.isArray(input.messages)) return input.messages;
    return [input];
  }
  warnings.push("claude-code parser expected JSONL, an array, or an object");
  return [];
}

export function looksLikeClaudeCode(value: unknown): boolean {
  const rows = sampleRows(value);
  if (!rows.length) return false;
  // Top-level tool_call / tool_result is generic JSONL, not Claude Code stream-json.
  if (
    rows.some((row) => {
      const t = String(row.type ?? "").toLowerCase();
      return t === "tool_call" || t === "tool_result" || t === "function_call";
    })
  ) {
    return false;
  }
  let hits = 0;
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const type = String(row.type ?? "").toLowerCase();
    if (type === "result" || type === "stream_event" || type === "tool_progress") {
      hits += 2;
      continue;
    }
    const message = isRecord(row.message) ? row.message : null;
    if (!message) continue;
    // Claude Code wraps payloads in `message`; bare {type,content} is generic JSONL.
    if (Array.isArray(message.content)) {
      const blocks = message.content.filter(isRecord);
      if (
        blocks.some((b) => {
          const bt = String(b.type ?? "").toLowerCase();
          return bt === "tool_use" || bt === "tool_result" || bt === "text" || bt === "thinking";
        })
      ) {
        hits += 2;
        continue;
      }
    }
    if (message.content != null || message.role != null) {
      hits += 1;
    }
  }
  return hits >= 2;
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
