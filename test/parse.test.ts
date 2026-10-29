import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrace } from "../src/index.js";
import { fixture } from "./helpers.ts";

describe("parseTrace auto-detect", () => {
  it("parses the sample JSONL run", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"), { source: "examples/run.jsonl" });
    assert.equal(trace.format, "jsonl");
    assert.equal(trace.steps[0]?.kind, "user");
    assert.ok(trace.stats.toolCalls >= 6);
    assert.equal(trace.stats.failures, 1);
    assert.ok((trace.stats.durationMs ?? 0) > 10_000);
    assert.ok(trace.steps.some((s) => s.name === "run_tests" && s.kind === "error"));
    assert.equal(trace.steps.at(-1)?.kind, "assistant");
  });

  it("parses OpenAI chat.completion with tool_calls", () => {
    const trace = parseTrace(fixture("examples/openai.json"));
    assert.equal(trace.format, "openai");
    assert.ok(trace.steps.some((s) => s.kind === "thought" || s.kind === "assistant"));
    const call = trace.steps.find((s) => s.kind === "tool_call");
    assert.equal(call?.name, "search_flights");
    assert.deepEqual(call?.args, { origin: "SFO", dest: "NRT", date: "2026-11-05" });
    assert.equal(trace.stats.tokensIn, 214);
    assert.equal(trace.stats.tokensOut, 38);
  });

  it("parses OpenAI messages[] including tool results", () => {
    const trace = parseTrace(fixture("test/fixtures/openai-messages.json"), { format: "openai" });
    const names = trace.steps.filter((s) => s.kind === "tool_call").map((s) => s.name);
    assert.deepEqual(names, ["kubectl_get", "kubectl_rollout"]);
    assert.ok(trace.steps.some((s) => s.kind === "tool_result" && s.name === "kubectl_get"));
    assert.equal(trace.steps.at(-1)?.content?.includes("3/3"), true);
  });

  it("parses Responses API output[]", () => {
    const trace = parseTrace(fixture("test/fixtures/openai-responses.json"));
    assert.equal(trace.format, "openai");
    assert.ok(trace.steps.some((s) => s.kind === "thought"));
    assert.equal(trace.steps.find((s) => s.kind === "tool_call")?.name, "get_weather");
    assert.ok(trace.steps.some((s) => s.kind === "tool_result"));
    assert.equal(trace.stats.tokensIn, 80);
    assert.equal(trace.stats.tokensOut, 24);
  });

  it("merges OpenAI streaming JSONL chunks", () => {
    const trace = parseTrace(fixture("test/fixtures/openai-stream.jsonl"), { format: "jsonl" });
    const thought = trace.steps.find((s) => s.kind === "thought" || s.kind === "assistant");
    assert.equal(thought?.content, "Let me look that up.");
    const call = trace.steps.find((s) => s.kind === "tool_call");
    assert.equal(call?.name, "lookup");
    assert.deepEqual(call?.args, { q: "agent-trace" });
    assert.equal(trace.stats.tokensIn, 40);
  });

  it("flattens a LangSmith run tree", () => {
    const trace = parseTrace(fixture("examples/langchain.json"));
    assert.equal(trace.format, "langchain");
    assert.ok(trace.steps.some((s) => s.kind === "user" && s.content?.includes("deploys")));
    assert.ok(trace.steps.some((s) => s.kind === "tool_call" && s.name === "list_deploys"));
    assert.ok(trace.steps.some((s) => s.kind === "error" && s.name === "page_status"));
    assert.equal(trace.stats.failures, 1);
  });

  it("parses LangChain callback JSONL", () => {
    const trace = parseTrace(fixture("test/fixtures/langchain-events.jsonl"), { format: "jsonl" });
    assert.ok(trace.steps.some((s) => s.kind === "tool_call" && s.name === "Search"));
    assert.ok(trace.steps.some((s) => s.kind === "error" && s.name === "Browse"));
    assert.ok(trace.steps.some((s) => s.content?.includes("Nothing indexed")));
  });

  it("parses generic {type,name,content,ts} arrays", () => {
    const trace = parseTrace(fixture("examples/generic.json"));
    assert.equal(trace.format, "generic");
    assert.equal(trace.steps[0]?.kind, "user");
    assert.equal(trace.steps.find((s) => s.kind === "tool_call")?.name, "get_error_budget");
    assert.equal(trace.stats.failures, 0);
  });

  it("parses Cursor-ish JSONL", () => {
    const trace = parseTrace(fixture("test/fixtures/cursor.jsonl"));
    assert.equal(trace.steps.find((s) => s.kind === "tool_call")?.name, "Read");
    assert.equal(trace.steps.at(-1)?.content, "MIT.");
  });

  it("skips malformed JSONL lines and keeps the rest", () => {
    const trace = parseTrace(fixture("test/fixtures/malformed.jsonl"), { format: "jsonl" });
    assert.equal(trace.steps.length, 2);
    assert.ok(trace.warnings.some((w) => /line 2/.test(w)));
  });

  it("honors --format even when sniffing would disagree", () => {
    const trace = parseTrace(fixture("examples/generic.json"), { format: "generic" });
    assert.equal(trace.format, "generic");
  });

  it("throws on empty input", () => {
    assert.throws(() => parseTrace("   "), /empty trace/);
  });
});
