import type { Trace, TraceStep } from "../types.js";
import { computeStats } from "../stats.js";
import { asArray, isRecord } from "../util.js";
import { normalizeEvent, reindex } from "./event.js";

export function parseGeneric(input: unknown, source?: string): Trace {
  const warnings: string[] = [];
  const rawItems = collectItems(input, warnings);
  const steps: TraceStep[] = [];
  for (const item of rawItems) {
    const step = normalizeEvent(item, 0);
    if (step) steps.push(step);
  }
  const indexed = reindex(steps);
  if (!indexed.length) warnings.push("generic parser produced no steps");
  const trace: Trace = {
    format: "generic",
    steps: indexed,
    stats: computeStats(indexed),
    warnings,
  };
  if (source) trace.source = source;
  return trace;
}

function collectItems(input: unknown, warnings: string[]): unknown[] {
  if (Array.isArray(input)) return input;
  if (!isRecord(input)) {
    warnings.push("generic parser expected an array or object");
    return [];
  }
  for (const key of ["events", "steps", "trace", "items", "messages", "logs", "data"]) {
    const value = input[key];
    if (Array.isArray(value)) return value;
  }
  if (input.type != null || input.name != null || input.content != null || input.ts != null) {
    return [input];
  }
  const values = Object.values(input).filter((value) => isRecord(value) || Array.isArray(value));
  if (values.length === 1) return collectItems(values[0], warnings);
  return asArray(input.events);
}

export function looksLikeGeneric(value: unknown): boolean {
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.events)
      ? value.events
      : isRecord(value) && Array.isArray(value.steps)
        ? value.steps
        : null;
  if (!items || !items.length) return false;
  const sample = items.slice(0, 8).filter(isRecord);
  if (!sample.length) return false;
  const hits = sample.filter(
    (item) => item.type != null || item.name != null || item.content != null || item.ts != null,
  ).length;
  return hits >= Math.ceil(sample.length / 2);
}
