export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function pickUnknown(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

export function flattenText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((part) => {
        if (typeof part === "string") return part;
        if (!isRecord(part)) return flattenText(part);
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
        if (typeof part.output_text === "string") return part.output_text;
        if (part.type === "text" && typeof part.text === "string") return part.text;
        if (part.type === "output_text" && typeof part.text === "string") return part.text;
        return flattenText(part.content ?? part.parts);
      })
      .filter((part): part is string => Boolean(part && String(part).trim()));
    return parts.length ? parts.join("\n") : undefined;
  }
  if (isRecord(value)) {
    return flattenText(
      value.text ??
        value.content ??
        value.message ??
        value.output_text ??
        value.output ??
        value.result ??
        value.value,
    );
  }
  return undefined;
}

export function tryJsonParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function coerceJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    const parsed = tryJsonParse(trimmed);
    return parsed === undefined ? value : parsed;
  }
  return value;
}

export function compactJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return collapseWs(value);
  try {
    return collapseWs(JSON.stringify(value));
  } catch {
    return collapseWs(String(value));
  }
}

export function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function parseTimestamp(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(value.trim())) {
      return parseTimestamp(numeric);
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return value;
  }
  return undefined;
}

export function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(ms)}ms`;
  if (abs < 60_000) {
    const seconds = ms / 1000;
    return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.round((abs % 60_000) / 1000);
  const sign = ms < 0 ? "-" : "";
  return `${sign}${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

export function looksLikeError(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^(error|exception|traceback|failed)\b/i.test(trimmed)) return trimmed;
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.error) return flattenText(value.error) ?? compactJson(value.error);
  if (value.exception) return flattenText(value.exception) ?? compactJson(value.exception);
  const status = value.status ?? value.status_code ?? value.statusCode;
  if (typeof status === "number" && status >= 400) {
    return flattenText(value.message ?? value.detail) ?? `HTTP ${status}`;
  }
  return undefined;
}

export function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}
