import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs, UsageError } from "../src/args.js";
import { parseDurationMs, parseTrace, renderTap } from "../src/index.js";
import { fixture } from "./helpers.ts";

describe("parseDurationMs", () => {
  it("accepts plain ms and suffixes", () => {
    assert.equal(parseDurationMs("5000"), 5000);
    assert.equal(parseDurationMs("30s"), 30_000);
    assert.equal(parseDurationMs("2m"), 120_000);
    assert.equal(parseDurationMs("1.5s"), 1500);
    assert.equal(parseDurationMs("100ms"), 100);
  });

  it("rejects junk", () => {
    assert.throws(() => parseDurationMs("fast"), /invalid duration/);
    assert.throws(() => parseDurationMs("0"), /positive/);
    assert.throws(() => parseDurationMs("-1s"), /invalid/);
  });
});

describe("parseArgs 0.7 flags", () => {
  it("parses --redact --tap --max-duration", () => {
    const args = parseArgs([
      "node",
      "agent-trace",
      "--redact",
      "--tap",
      "--max-duration",
      "30s",
      "--demo",
    ]);
    assert.equal(args.redact, true);
    assert.equal(args.tap, true);
    assert.equal(args.maxDurationMs, 30_000);
    assert.equal(args.demo, true);
  });

  it("rejects --tap with --json", () => {
    assert.throws(
      () => parseArgs(["node", "agent-trace", "--tap", "--json", "--demo"]),
      (error: unknown) => {
        assert.ok(error instanceof UsageError);
        assert.match(error.message, /--tap/);
        return true;
      },
    );
  });

  it("allows --tap with --stats", () => {
    const args = parseArgs(["node", "agent-trace", "--tap", "--stats", "--demo"]);
    assert.equal(args.tap, true);
    assert.equal(args.stats, true);
  });
});

describe("renderTap", () => {
  it("emits not-ok for demo failures", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"), { source: "examples/run.jsonl" });
    const tap = renderTap(trace);
    assert.match(tap.text, /^TAP version 13/m);
    assert.match(tap.text, /^1\.\.\d+/m);
    assert.match(tap.text, /^not ok 1 -/m);
    assert.ok(tap.failures >= 1);
    assert.equal(tap.exitCode, 1);
  });

  it("emits empty plan for clean runs", () => {
    const clean = parseTrace(
      JSON.stringify({ role: "user", content: "hi" }) +
        "\n" +
        JSON.stringify({ role: "assistant", content: "hello" }),
      { format: "openai" },
    );
    const tap = renderTap(clean);
    assert.match(tap.text, /^1\.\.0/m);
    assert.equal(tap.failures, 0);
    assert.equal(tap.exitCode, 0);
  });
});
