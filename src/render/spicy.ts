import type { SpicyOptions, Trace, TraceStep } from "../types.js";
import { collapseWs, compactJson, truncate } from "../util.js";

export async function spicyNarrative(trace: Trace, options: SpicyOptions = {}): Promise<string> {
  const local = localSpicy(trace);
  // Offline by default. Opt in with { localOnly: false } (CLI: --spicy-llm).
  if (options.localOnly !== false) return local;

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !anthropicKey) return local;

  try {
    const fromLlm = openaiKey
      ? await callOpenAI(trace, openaiKey, options)
      : await callAnthropic(trace, anthropicKey as string, options);
    const text = collapseWs(fromLlm);
    if (text) return text;
  } catch {
    return `${local}\n(spicy LLM call failed — used the local recap)`;
  }
  return local;
}

export function localSpicy(trace: Trace): string {
  const user = firstContent(trace.steps, "user");
  const final = lastContent(trace.steps, "assistant") ?? lastContent(trace.steps, "thought");
  const tools = unique(trace.steps.filter((s) => s.kind === "tool_call").map((s) => s.name ?? "tool"));
  const fails = trace.steps.filter((s) => s.kind === "error" || s.error);
  const failNames = unique(fails.map((s) => s.name ?? "unknown"));
  const firstFail = fails[0];

  const brief = user ? quote(truncate(collapseWs(user), 88)) : "an unspecified brief";
  const toolBit = tools.length
    ? `Tools: ${tools.slice(0, 6).join(", ")}${tools.length > 6 ? "…" : ""}.`
    : "No tools were called — pure vibes.";

  let take: string;
  if (!trace.steps.length) {
    take = "Empty trace. Either the agent never woke up, or the log is in a dialect we don't speak yet.";
  } else if (fails.length === 0 && final) {
    take = `Clean run. Asked for ${brief}, finished in ${trace.stats.steps} steps without a face-plant. ${toolBit} Landed on: ${quote(truncate(collapseWs(final), 120))}`;
  } else if (fails.length === 0) {
    take = `Quietly competent: ${brief}. ${toolBit} ${trace.stats.steps} steps, no errors — or at least none the log admitted to.`;
  } else if (fails.length === 1) {
    const where = firstFail?.name ? `\`${firstFail.name}\`` : "a tool call";
    const why = firstFail?.error ?? firstFail?.content ?? "unknown error";
    take = `The brief was ${brief}. ${toolBit} Then ${where} blew up: ${quote(truncate(collapseWs(why), 100))}. ${
      final ? `The agent recovered with: ${quote(truncate(collapseWs(final), 100))}` : "No recovery message. Fade to black."
    }`;
  } else {
    take = `Rough ride. ${fails.length} failures (${failNames.join(", ") || "unnamed"}) on ${brief}. ${toolBit} ${
      final ? `Final word: ${quote(truncate(collapseWs(final), 110))}` : "It never really stuck the landing."
    }`;
  }

  return take;
}

async function callOpenAI(trace: Trace, apiKey: string, options: SpicyOptions): Promise<string> {
  const base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const response = await fetchWithTimeout(
    `${base}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 280,
        messages: [
          { role: "system", content: SPICY_SYSTEM },
          { role: "user", content: spicyPrompt(trace) },
        ],
      }),
    },
    options.timeoutMs ?? 15_000,
  );
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(json.error?.message ?? `openai ${response.status}`);
  return json.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(trace: Trace, apiKey: string, options: SpicyOptions): Promise<string> {
  const base = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";
  const response = await fetchWithTimeout(
    `${base}/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 280,
        temperature: 0.7,
        system: SPICY_SYSTEM,
        messages: [{ role: "user", content: spicyPrompt(trace) }],
      }),
    },
    options.timeoutMs ?? 15_000,
  );
  const json = (await response.json()) as {
    content?: Array<{ text?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(json.error?.message ?? `anthropic ${response.status}`);
  return json.content?.map((part) => part.text ?? "").join("") ?? "";
}

const SPICY_SYSTEM =
  "You recap an AI agent trace in 4-6 sharp sentences. Name the tools. Call out the turning point and any dumb or failed call. No markdown headings, no bullet lists, no preamble.";

function spicyPrompt(trace: Trace): string {
  const compact = trace.steps.slice(0, 40).map((step) => ({
    n: step.index,
    kind: step.kind,
    name: step.name,
    text: redact(truncate(collapseWs(step.error ?? step.content ?? compactJson(step.args ?? step.result)), 400)),
  }));
  return JSON.stringify({
    format: trace.format,
    stats: trace.stats,
    steps: compact,
  });
}

function redact(text: string): string {
  return text.replace(
    /(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^"'\s,]+/gi,
    "$1=***",
  );
}

function firstContent(steps: TraceStep[], kind: TraceStep["kind"]): string | undefined {
  return steps.find((step) => step.kind === kind)?.content;
}

function lastContent(steps: TraceStep[], kind: TraceStep["kind"]): string | undefined {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.kind === kind && step.content) return step.content;
  }
  return undefined;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function quote(text: string): string {
  return `“${text}”`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
