import type { Trace, TraceStep } from "../types.js";
import { computeStats } from "../stats.js";
import { isRecord, tryJsonParse } from "../util.js";
import { normalizeEvent, reindex } from "./event.js";
import { looksLikeClaudeCode, parseClaudeCode } from "./claude-code.js";
import { looksLikeCodex, parseCodex } from "./codex.js";
import { looksLikeLangChain, parseLangChain } from "./langchain.js";
import { looksLikeOpenAI, parseOpenAI } from "./openai.js";

export function splitJsonl(text: string): { rows: unknown[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows: unknown[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
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

export function parseJsonl(text: string, source?: string): Trace {
  const { rows, warnings } = splitJsonl(text);
  if (!rows.length) {
    const trace: Trace = {
      format: "jsonl",
      steps: [],
      stats: computeStats([]),
      warnings: warnings.length ? warnings : ["jsonl parser found no events"],
    };
    if (source) trace.source = source;
    return trace;
  }

  if (looksLikeClaudeCode(rows)) {
    const nested = parseClaudeCode(rows, source);
    nested.warnings = [...warnings, ...nested.warnings];
    return nested;
  }
  if (looksLikeCodex(rows)) {
    const nested = parseCodex(rows, source);
    nested.warnings = [...warnings, ...nested.warnings];
    return nested;
  }
  if (looksLikeOpenAI(rows) && rows.some((row) => isRecord(row) && (row.delta != null || row.choices != null))) {
    const nested = parseOpenAI(rows, source);
    nested.format = "jsonl";
    nested.warnings = [...warnings, ...nested.warnings];
    return nested;
  }
  if (looksLikeLangChain(rows)) {
    const nested = parseLangChain(rows, source);
    nested.format = "jsonl";
    nested.warnings = [...warnings, ...nested.warnings];
    return nested;
  }
  if (looksLikeOpenAI(rows)) {
    const nested = parseOpenAI(rows, source);
    nested.format = "jsonl";
    nested.warnings = [...warnings, ...nested.warnings];
    return nested;
  }

  const steps: TraceStep[] = [];
  for (const row of rows) {
    const step = normalizeEvent(row, 0);
    if (step) steps.push(step);
  }
  const indexed = reindex(steps);
  const trace: Trace = {
    format: "jsonl",
    steps: indexed,
    stats: computeStats(indexed),
    warnings,
  };
  if (source) trace.source = source;
  return trace;
}

export function looksLikeJsonl(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));
  if (lines.length < 2) return false;
  let ok = 0;
  for (const line of lines.slice(0, 12)) {
    if (tryJsonParse(line) !== undefined) ok += 1;
  }
  return ok >= Math.min(2, lines.length) && ok >= Math.ceil(Math.min(lines.length, 12) * 0.6);
}
