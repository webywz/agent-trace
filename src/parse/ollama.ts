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
import { parseOpenAI } from "./openai.js";

/**
 * Ollama / OpenAI-compat chat JSONL (NDJSON):
 * - Ollama /api/chat stream: { model, message: { role, content }, done, … }
 * - Ollama /api/generate stream: { model, response, done, … }
 * - OpenAI-compat chat.completion / chat.completion.chunk lines (delegates to openai)
 */
export function parseOllama(input: unknown, source?: string): Trace {
  const warnings: string[] = [];
  const rows = normalizeRows(input, warnings);

  if (rows.length && looksLikeOpenAICompatRows(rows)) {
    const nested = parseOpenAI(rows, source);
    nested.format = "ollama";
    nested.warnings = [...warnings, ...nested.warnings];
    return nested;
  }

  const { steps, tokensIn, tokensOut } = mergeOllamaRows(rows, warnings);
  const indexed = reindex(steps.filter(Boolean));
  if (indexed.length === 0) {
    warnings.push("ollama parser produced no steps");
  }
  const stats = computeStats(indexed);
  if (tokensIn != null) stats.tokensIn = tokensIn;
  if (tokensOut != null) stats.tokensOut = tokensOut;

  const trace: Trace = {
    format: "ollama",
    steps: indexed,
    stats,
    warnings,
  };
  if (source) trace.source = source;
  return trace;
}

function normalizeRows(input: unknown, warnings: string[]): unknown[] {
  if (typeof input === "string") {
    const rows: unknown[] = [];
    for (const line of input.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
      try {
        rows.push(JSON.parse(trimmed) as unknown);
      } catch {
        warnings.push("skipped invalid JSONL line");
      }
    }
    return rows;
  }
  if (Array.isArray(input)) return input;
  if (isRecord(input)) return [input];
  warnings.push("ollama parser expected JSONL, an object, or an array");
  return [];
}

function mergeOllamaRows(
  rows: unknown[],
  warnings: string[],
): { steps: TraceStep[]; tokensIn?: number; tokensOut?: number } {
  const steps: TraceStep[] = [];
  let assistant = "";
  let assistantTs: string | undefined;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let sawStream = false;

  const flushAssistant = () => {
    if (!assistant) return;
    steps.push({
      index: 0,
      kind: "assistant",
      title: "assistant",
      content: assistant,
      ts: assistantTs,
    });
    assistant = "";
    assistantTs = undefined;
  };

  for (const row of rows) {
    if (!isRecord(row)) {
      warnings.push("skipped non-object ollama row");
      continue;
    }

    const ts =
      parseTimestamp(row.created_at ?? row.created ?? row.ts ?? row.timestamp) ?? undefined;
    const inn = pickNumber(row, ["prompt_eval_count", "prompt_tokens", "input_tokens"]);
    const out = pickNumber(row, ["eval_count", "completion_tokens", "output_tokens"]);
    if (inn != null) tokensIn = (tokensIn ?? 0) + inn;
    if (out != null) tokensOut = (tokensOut ?? 0) + out;

    // Chat request-style: messages[] on a single object
    if (Array.isArray(row.messages) && !row.message && row.response == null) {
      flushAssistant();
      for (const msg of row.messages) {
        if (!isRecord(msg)) continue;
        const role = String(msg.role ?? "assistant").toLowerCase();
        const content = flattenText(msg.content);
        const msgTs = parseTimestamp(msg.ts ?? msg.timestamp) ?? ts;
        if (role === "system" && content) {
          steps.push({ index: 0, kind: "system", title: "system", content, ts: msgTs });
        } else if (role === "user" && content) {
          steps.push({ index: 0, kind: "user", title: "user", content, ts: msgTs });
        } else if (role === "assistant" && content) {
          steps.push({ index: 0, kind: "assistant", title: "assistant", content, ts: msgTs });
        } else if (role === "tool" || role === "function") {
          const name = pickString(msg, ["name", "tool", "tool_name"]);
          const err = flattenText(msg.error);
          steps.push({
            index: 0,
            kind: err ? "error" : "tool_result",
            title: titleFor(err ? "error" : "tool_result", name),
            name,
            content: content ?? compactJson(msg.content),
            result: coerceJson(msg.content),
            error: err,
            ts: msgTs,
            toolCallId: pickString(msg, ["tool_call_id", "id"]),
          });
        }
        for (const call of asArray(msg.tool_calls)) {
          if (!isRecord(call)) continue;
          const fn = isRecord(call.function) ? call.function : call;
          const name = pickString(fn, ["name", "tool", "function"]) ?? "function";
          const args = coerceJson(fn.arguments ?? fn.args ?? fn.input);
          steps.push({
            index: 0,
            kind: "tool_call",
            title: titleFor("tool_call", name),
            name,
            args,
            content: typeof args === "string" ? args : compactJson(args),
            ts: msgTs,
            toolCallId: pickString(call, ["id", "tool_call_id"]),
          });
        }
      }
      continue;
    }

    // Ollama /api/chat stream chunk
    if (isRecord(row.message)) {
      sawStream = true;
      const role = String(row.message.role ?? "assistant").toLowerCase();
      const piece = flattenText(row.message.content) ?? "";
      if (role === "user" && piece) {
        flushAssistant();
        steps.push({ index: 0, kind: "user", title: "user", content: piece, ts });
      } else if (role === "system" && piece) {
        flushAssistant();
        steps.push({ index: 0, kind: "system", title: "system", content: piece, ts });
      } else if (piece) {
        assistant += piece;
        assistantTs ??= ts;
      }
      for (const call of asArray(row.message.tool_calls)) {
        if (!isRecord(call)) continue;
        flushAssistant();
        const fn = isRecord(call.function) ? call.function : call;
        const name = pickString(fn, ["name", "tool", "function"]) ?? "function";
        const args = coerceJson(fn.arguments ?? fn.args ?? fn.input);
        steps.push({
          index: 0,
          kind: "tool_call",
          title: titleFor("tool_call", name),
          name,
          args,
          content: typeof args === "string" ? args : compactJson(args),
          ts,
          toolCallId: pickString(call, ["id", "tool_call_id"]),
        });
      }
      if (row.done === true) flushAssistant();
      continue;
    }

    // Ollama /api/generate stream chunk
    if (typeof row.response === "string") {
      sawStream = true;
      assistant += row.response;
      assistantTs ??= ts;
      if (row.done === true) flushAssistant();
      continue;
    }

    // Plain role/content line (compat chat JSONL)
    if (typeof row.role === "string" && (row.content != null || row.tool_calls != null)) {
      flushAssistant();
      const role = row.role.toLowerCase();
      const content = flattenText(row.content);
      if (role === "user" && content) {
        steps.push({ index: 0, kind: "user", title: "user", content, ts });
      } else if (role === "system" && content) {
        steps.push({ index: 0, kind: "system", title: "system", content, ts });
      } else if (role === "assistant") {
        if (content) steps.push({ index: 0, kind: "assistant", title: "assistant", content, ts });
        for (const call of asArray(row.tool_calls)) {
          if (!isRecord(call)) continue;
          const fn = isRecord(call.function) ? call.function : call;
          const name = pickString(fn, ["name", "tool", "function"]) ?? "function";
          const args = coerceJson(fn.arguments ?? fn.args ?? fn.input);
          steps.push({
            index: 0,
            kind: "tool_call",
            title: titleFor("tool_call", name),
            name,
            args,
            content: typeof args === "string" ? args : compactJson(args),
            ts,
            toolCallId: pickString(call, ["id", "tool_call_id"]),
          });
        }
      } else if (role === "tool" || role === "function") {
        const name = pickString(row, ["name", "tool", "tool_name"]);
        const err = flattenText(row.error);
        steps.push({
          index: 0,
          kind: err ? "error" : "tool_result",
          title: titleFor(err ? "error" : "tool_result", name),
          name,
          content: content ?? compactJson(row.content),
          result: coerceJson(row.content),
          error: err,
          ts,
          toolCallId: pickString(row, ["tool_call_id", "id"]),
        });
      }
      continue;
    }

    if (!sawStream) {
      warnings.push("unrecognized ollama/openai-compat row shape");
    }
  }

  flushAssistant();
  return { steps, tokensIn, tokensOut };
}

function looksLikeOpenAICompatRows(rows: unknown[]): boolean {
  const sample = rows.slice(0, 12).filter(isRecord);
  if (!sample.length) return false;
  const hits = sample.filter(
    (row) =>
      row.object === "chat.completion" ||
      row.object === "chat.completion.chunk" ||
      (Array.isArray(row.choices) &&
        (row.object != null || row.choices.some((c) => isRecord(c) && (c.delta != null || c.message != null)))),
  ).length;
  return hits >= Math.ceil(sample.length / 2);
}

export function looksLikeOllama(value: unknown): boolean {
  const rows = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  const sample = rows.slice(0, 12).filter(isRecord);
  if (!sample.length) return false;
  const hits = sample.filter((row) => {
    if (isRecord(row.message) && (typeof row.done === "boolean" || row.model != null)) return true;
    if (typeof row.response === "string" && (typeof row.done === "boolean" || row.model != null)) {
      return true;
    }
    return false;
  }).length;
  return hits >= Math.ceil(sample.length / 2);
}
