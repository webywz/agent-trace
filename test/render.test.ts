import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localSpicy, parseTrace, renderTimeline, spicyNarrative } from "../src/index.js";
import { fixture } from "./helpers.ts";

describe("renderTimeline", () => {
  it("prints a numbered unicode timeline with stats", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"), { source: "examples/run.jsonl" });
    const out = renderTimeline(trace, { color: false, width: 88 });
    assert.match(out, /agent-trace/);
    assert.match(out, /examples\/run\.jsonl/);
    assert.match(out, /jsonl/);
    assert.match(out, / 1 +user/);
    assert.match(out, /tool +.*read_file/);
    assert.match(out, /error +.*run_tests/);
    assert.match(out, /cookie sid missing/);
    assert.match(out, /steps/);
    assert.match(out, /fail/);
    assert.match(out, /in \/ .* out/);
    assert.doesNotMatch(out, /\u001b\[/);
  });

  it("ASCII mode avoids box drawing and unicode glyphs", () => {
    const trace = parseTrace(fixture("examples/generic.json"));
    const out = renderTimeline(trace, { color: false, ascii: true, width: 72 });
    assert.match(out, /\|/);
    assert.doesNotMatch(out, /[│─✖·▸↩]/);
  });

  it("truncates long args", () => {
    const trace = parseTrace(
      JSON.stringify([{ type: "tool", name: "echo", args: { blob: "x".repeat(400) } }]),
    );
    const out = renderTimeline(trace, { color: false, maxContent: 40, width: 60 });
    assert.match(out, /…|\.\.\./);
    assert.ok(!out.includes("x".repeat(80)));
  });

  it("highlights errors in the detail line", () => {
    const trace = parseTrace(fixture("examples/langchain.json"), { format: "langchain" });
    const out = renderTimeline(trace, { color: false });
    assert.match(out, /page_status/);
    assert.match(out, /404 incident not found/);
  });
});

describe("localSpicy", () => {
  it("names the failed tool and the brief", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"));
    const text = localSpicy(trace);
    assert.match(text, /login test/i);
    assert.match(text, /run_tests/);
  });

  it("celebrates a clean run", () => {
    const trace = parseTrace(fixture("examples/generic.json"));
    const text = localSpicy(trace);
    assert.match(text, /Clean run|Quietly competent|face-plant/i);
    assert.match(text, /get_error_budget/);
  });
});

describe("spicyNarrative", () => {
  it("defaults to localOnly even when API keys exist", async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-should-not-be-used";
    try {
      const trace = parseTrace(fixture("examples/run.jsonl"));
      const text = await spicyNarrative(trace);
      assert.equal(text, localSpicy(trace));
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});
