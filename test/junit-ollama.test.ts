import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseArgs, UsageError } from "../src/args.js";
import { main } from "../src/cli.js";
import { formatJUnit, parseTrace } from "../src/index.js";

describe("parseArgs 0.9 flags", () => {
  it("parses --junit and ollama / openai-compat formats", () => {
    const args = parseArgs([
      "node",
      "agent-trace",
      "--junit",
      "out.xml",
      "--format",
      "ollama",
      "--demo",
    ]);
    assert.equal(args.junit, "out.xml");
    assert.equal(args.format, "ollama");
    const compat = parseArgs([
      "node",
      "agent-trace",
      "--format",
      "openai-compat",
      "--demo",
    ]);
    assert.equal(compat.format, "openai-compat");
    const alias = parseArgs([
      "node",
      "agent-trace",
      "--format",
      "openai_compat",
      "--demo",
    ]);
    assert.equal(alias.format, "openai-compat");
  });

  it("rejects bare --junit", () => {
    assert.throws(
      () => parseArgs(["node", "agent-trace", "--junit", "--demo"]),
      UsageError,
    );
  });
});

describe("formatJUnit", () => {
  it("emits a passing suite for clean traces", () => {
    const clean = parseTrace(
      JSON.stringify({ role: "user", content: "hi" }) +
        "\n" +
        JSON.stringify({ role: "assistant", content: "hello" }),
      { format: "openai", source: "clean.jsonl" },
    );
    const xml = formatJUnit(clean);
    assert.match(xml, /<\?xml version="1\.0"/);
    assert.match(xml, /failures="0"/);
    assert.match(xml, /classname="clean\.jsonl"/);
  });

  it("emits failure testcases for demo errors", () => {
    const trace = parseTrace(
      JSON.stringify({ role: "assistant", content: "x", error: "boom" }) + "\n",
      { format: "openai", source: "bad.jsonl" },
    );
    // force an error step if parser didn't
    if (!trace.steps.some((s) => s.error || s.kind === "error")) {
      trace.steps.push({
        index: trace.steps.length,
        kind: "error",
        title: "error",
        error: "boom",
      });
    }
    const xml = formatJUnit(trace);
    assert.match(xml, /<failure /);
    assert.match(xml, /failures="[1-9]/);
  });
});

describe("ollama / openai-compat parser", () => {
  it("merges Ollama /api/chat NDJSON", () => {
    const lines = [
      { model: "llama3.2", message: { role: "assistant", content: "Hel" }, done: false },
      {
        model: "llama3.2",
        message: { role: "assistant", content: "lo" },
        done: true,
        prompt_eval_count: 5,
        eval_count: 2,
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n");
    const trace = parseTrace(lines, { format: "ollama", source: "chat.jsonl" });
    assert.equal(trace.format, "ollama");
    const assistant = trace.steps.find((s) => s.kind === "assistant");
    assert.ok(assistant);
    assert.equal(assistant!.content, "Hello");
    assert.equal(trace.stats.tokensIn, 5);
    assert.equal(trace.stats.tokensOut, 2);
  });

  it("parses Ollama /api/generate NDJSON", () => {
    const lines = [
      { model: "llama3.2", response: "Hi", done: false },
      { model: "llama3.2", response: "!", done: true, eval_count: 2 },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n");
    const trace = parseTrace(lines, { source: "gen.jsonl" });
    assert.equal(trace.format, "ollama");
    const assistant = trace.steps.find((s) => s.kind === "assistant");
    assert.equal(assistant?.content, "Hi!");
  });

  it("delegates OpenAI-compat chat.completion.chunk rows", () => {
    const lines = [
      {
        id: "1",
        object: "chat.completion.chunk",
        choices: [{ delta: { role: "assistant", content: "Ok" }, index: 0 }],
      },
      {
        id: "1",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: "ay" }, index: 0, finish_reason: "stop" }],
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n");
    const trace = parseTrace(lines, { format: "openai-compat", source: "compat.jsonl" });
    assert.equal(trace.format, "openai-compat");
    assert.ok(trace.steps.some((s) => (s.content ?? "").includes("Ok") || (s.content ?? "").includes("ay") || s.kind === "assistant"));
  });
});

describe("CLI --junit", () => {
  it("writes junit xml", async () => {
    const dir = mkdtempSync(join(tmpdir(), "at-junit-"));
    const path = join(dir, "out.xml");
    try {
      const prev = process.exitCode;
      process.exitCode = undefined;
      const code = await main(["node", "agent-trace", "--demo", "--junit", path, "--stats"]);
      process.exitCode = prev;
      assert.equal(typeof code, "number");
      const body = readFileSync(path, "utf8");
      assert.match(body, /<testsuites /);
      assert.match(body, /<\/testsuites>/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
