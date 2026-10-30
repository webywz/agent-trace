import type { Trace, TraceStep } from "../types.js";
import { computeStats } from "../stats.js";
import {
  coerceJson,
  compactJson,
  flattenText,
  isRecord,
  parseTimestamp,
  pickNumber,
  pickString,
} from "../util.js";
import { reindex, titleFor } from "./event.js";

const CONTENT_BLOCK_TYPES = new Set([
  "text",
  "tool_use",
  "tool_result",
  "thinking",
  "redacted_thinking",
  "image",
  "document",
  "input_json_delta",
]);

export function parseAnthropic(input: unknown, source?: string): Trace {
  const warnings: string[] = [];
  const steps: TraceStep[] = [];
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;

  const applyUsage = (usage: unknown) => {
    if (!isRecord(usage)) return;
    const inn = pickNumber(usage, ["input_tokens", "prompt_tokens", "tokens_in"]);
    const out = pickNumber(usage, ["output_tokens", "completion_tokens", "tokens_out"]);
    if (inn != null) tokensIn = (tokensIn ?? 0) + inn;
    if (out != null) tokensOut = (tokensOut ?? 0) + out;
  };

  if (Array.isArray(input)) {
    steps.push(...messagesToSteps(input, warnings, applyUsage));
  } else if (isRecord(input)) {
    if (Array.isArray(input.messages)) {
      applyUsage(input.usage);
      steps.push(...messagesToSteps(input.messages, warnings, applyUsage));
    } else if (isAnthropicMessageObject(input)) {
      steps.push(...messagesToSteps([input], warnings, applyUsage));
    } else if (Array.isArray(input.content) || typeof input.content === "string") {
      // SDK-ish single message / response without type:"message"
      if (typeof input.role === "string" || hasAnthropicContentBlocks(input.content)) {
        steps.push(...messagesToSteps([{ role: input.role ?? "assistant", ...input }], warnings, applyUsage));
      } else {
        warnings.push("anthropic parser expected messages[], a Message object, or content blocks");
      }
    } else if (Array.isArray(input.data)) {
      return parseAnthropic(input.data, source);
    } else {
      warnings.push("anthropic parser expected an object or array");
    }
  } else {
    warnings.push("anthropic parser expected an object or array");
  }

  const indexed = reindex(steps.filter(Boolean));
  if (indexed.length === 0) {
    warnings.push("anthropic parser produced no steps");
  }

  const stats = computeStats(indexed);
  if (tokensIn != null) stats.tokensIn = tokensIn;
  if (tokensOut != null) stats.tokensOut = tokensOut;

  const trace: Trace = {
    format: "anthropic",
    steps: indexed,
    stats,
    warnings,
  };
  if (source) trace.source = source;
  return trace;
}

function messagesToSteps(
  messages: unknown[],
  warnings: string[],
  onUsage?: (usage: unknown) => void,
): TraceStep[] {
  const steps: TraceStep[] = [];
  for (const raw of messages) {
    if (!isRecord(raw)) {
      warnings.push("skipped non-object message");
      continue;
    }
    if (raw.usage != null) onUsage?.(raw.usage);
    const role = String(raw.role ?? "assistant").toLowerCase();
    const ts = parseTimestamp(raw.ts ?? raw.timestamp ?? raw.created_at);
    const content = raw.content;

    if (typeof content === "string" || content == null) {
      const text = flattenText(content);
      if (role === "user") {
        if (text) steps.push({ index: 0, kind: "user", title: "user", content: text, ts });
      } else if (role === "system") {
        if (text) steps.push({ index: 0, kind: "system", title: "system", content: text, ts });
      } else if (text) {
        steps.push({ index: 0, kind: "assistant", title: "assistant", content: text, ts });
      }
      continue;
    }

    if (!Array.isArray(content)) {
      const text = flattenText(content);
      if (text) {
        const kind = role === "user" ? "user" : role === "system" ? "system" : "assistant";
        steps.push({ index: 0, kind, title: kind, content: text, ts });
      } else {
        warnings.push("skipped message with non-array/non-string content");
      }
      continue;
    }

    // Content blocks (Anthropic Messages / Claude tool-use)
    for (const block of content) {
      if (!isRecord(block)) {
        warnings.push("skipped non-object content block");
        continue;
      }
      const type = String(block.type ?? "");

      if (type === "text" || type === "") {
        const text = typeof block.text === "string" ? block.text : flattenText(block);
        if (!text) continue;
        const kind = role === "user" ? "user" : role === "system" ? "system" : "assistant";
        steps.push({ index: 0, kind, title: kind, content: text, ts });
        continue;
      }

      if (type === "thinking" || type === "redacted_thinking") {
        const text =
          typeof block.thinking === "string"
            ? block.thinking
            : type === "redacted_thinking"
              ? "[redacted thinking]"
              : flattenText(block);
        if (text) {
          steps.push({ index: 0, kind: "thought", title: "thought", content: text, ts });
        }
        continue;
      }

      if (type === "tool_use") {
        const name = pickString(block, ["name", "tool"]) ?? "tool";
        const args = coerceJson(block.input ?? block.arguments ?? block.args);
        steps.push({
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

      if (type === "tool_result") {
        const name = pickString(block, ["name", "tool"]);
        const errFlag = block.is_error === true;
        const errText = flattenText(block.error);
        const resultContent = block.content;
        const contentText =
          flattenText(resultContent) ??
          (typeof resultContent === "string" ? resultContent : compactJson(resultContent));
        const isErr = errFlag || Boolean(errText);
        steps.push({
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

      // Ignore image/document/etc. quietly; note unknown block types once-ish.
      if (!CONTENT_BLOCK_TYPES.has(type) && type) {
        warnings.push(`skipped unsupported content block type '${type}'`);
      }
    }
  }
  return steps;
}

function isAnthropicMessageObject(value: Record<string, unknown>): boolean {
  if (value.type === "message") return true;
  if (typeof value.stop_reason === "string") return true;
  if (typeof value.role === "string" && (Array.isArray(value.content) || typeof value.content === "string")) {
    return hasAnthropicContentBlocks(value.content) || looksLikeClaudeModel(value.model);
  }
  return false;
}

function hasAnthropicContentBlocks(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      isRecord(block) &&
      (block.type === "tool_use" ||
        block.type === "tool_result" ||
        block.type === "thinking" ||
        block.type === "redacted_thinking" ||
        (block.type === "text" && typeof block.text === "string")),
  );
}

function looksLikeClaudeModel(model: unknown): boolean {
  return typeof model === "string" && /claude/i.test(model);
}

export function looksLikeAnthropic(value: unknown): boolean {
  if (Array.isArray(value)) {
    const sample = value.slice(0, 12).filter(isRecord);
    if (!sample.length) return false;
    // Distinctive: content[] with tool_use / tool_result (OpenAI puts tool_calls on the message).
    const blockHits = sample.filter((item) => hasDistinctiveAnthropicBlocks(item.content)).length;
    if (blockHits > 0) return true;
    // Array of Message objects
    const messageHits = sample.filter(
      (item) => item.type === "message" || typeof item.stop_reason === "string" || looksLikeClaudeModel(item.model),
    ).length;
    return messageHits >= Math.ceil(sample.length / 2);
  }
  if (!isRecord(value)) return false;
  if (value.type === "message" && (hasAnthropicContentBlocks(value.content) || looksLikeClaudeModel(value.model))) {
    return true;
  }
  if (typeof value.stop_reason === "string" && (value.content != null || value.role === "assistant")) {
    return true;
  }
  if (looksLikeClaudeModel(value.model) && (value.content != null || Array.isArray(value.messages))) {
    return true;
  }
  if (Array.isArray(value.messages)) {
    return looksLikeAnthropic(value.messages);
  }
  if (hasDistinctiveAnthropicBlocks(value.content)) return true;
  return false;
}

/** tool_use / tool_result inside content[] — the Claude Messages signature. */
function hasDistinctiveAnthropicBlocks(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) => isRecord(block) && (block.type === "tool_use" || block.type === "tool_result"),
  );
}
