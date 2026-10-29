import type { ParseOptions, Trace, TraceFormat } from "../types.js";
import { tryJsonParse } from "../util.js";
import { looksLikeGeneric, parseGeneric } from "./generic.js";
import { looksLikeJsonl, parseJsonl, splitJsonl } from "./jsonl.js";
import { looksLikeLangChain, parseLangChain } from "./langchain.js";
import { looksLikeOpenAI, parseOpenAI } from "./openai.js";

export function parseTrace(input: string, options: ParseOptions = {}): Trace {
  const source = options.source;
  const trimmed = input.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw new Error("empty trace — pass a JSON/JSONL file, pipe stdin, or use --demo");
  }

  const format = options.format ?? "auto";
  if (format !== "auto") {
    return parseAs(format, trimmed, source);
  }

  const json = tryJsonParse(trimmed);
  if (json !== undefined) {
    const detected = detectJson(json);
    const trace = parseAs(detected, trimmed, source, json);
    if (trace.steps.length) return trace;
  }

  if (looksLikeJsonl(trimmed)) {
    const jsonl = parseJsonl(trimmed, source);
    if (jsonl.steps.length) return jsonl;
  }

  if (json !== undefined) {
    return parseGeneric(json, source);
  }

  const jsonl = parseJsonl(trimmed, source);
  if (jsonl.steps.length) return jsonl;

  throw new Error(
    "could not detect trace format (tried openai, langchain, jsonl, generic); pass --format to force a parser",
  );
}

function parseAs(format: Exclude<TraceFormat, "auto">, text: string, source?: string, json?: unknown): Trace {
  switch (format) {
    case "openai":
      return parseOpenAI(json ?? decode(text, format), source);
    case "langchain":
      return parseLangChain(json ?? decode(text, format), source);
    case "generic":
      return parseGeneric(json ?? decode(text, format), source);
    case "jsonl":
      return parseJsonl(text, source);
    default: {
      const _exhaustive: never = format;
      throw new Error(`unsupported format '${String(_exhaustive)}'`);
    }
  }
}

function decode(text: string, format: string): unknown {
  const json = tryJsonParse(text);
  if (json !== undefined) return json;
  const { rows } = splitJsonl(text);
  if (rows.length) return rows;
  throw new Error(`could not parse input as ${format} (not valid JSON/JSONL for that parser)`);
}

function detectJson(value: unknown): Exclude<TraceFormat, "auto"> {
  if (looksLikeOpenAI(value)) return "openai";
  if (looksLikeLangChain(value)) return "langchain";
  if (looksLikeGeneric(value)) return "generic";
  return "generic";
}

export { parseGeneric, parseJsonl, parseLangChain, parseOpenAI };
