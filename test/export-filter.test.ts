import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterTrace,
  parseKindList,
  parseTrace,
  renderMarkdown,
  renderMermaid,
  statsReport,
} from "../src/index.js";
import { fixture } from "./helpers.ts";

describe("parseKindList", () => {
  it("accepts aliases", () => {
    assert.deepEqual(parseKindList("tool,error,result"), ["tool_call", "error", "tool_result"]);
  });

  it("rejects unknown kinds", () => {
    assert.throws(() => parseKindList("tool,banana"), /unknown kind/);
  });
});

describe("filterTrace", () => {
  it("keeps only selected kinds", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"));
    const filtered = filterTrace(trace, { only: ["tool_call", "error"] });
    assert.ok(filtered.steps.every((s) => s.kind === "tool_call" || s.kind === "error"));
    assert.equal(filtered.stats.toolCalls, filtered.steps.filter((s) => s.kind === "tool_call").length);
    assert.equal(filtered.steps[0]?.index, 1);
  });

  it("filters by tool name", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"));
    const filtered = filterTrace(trace, { tools: ["run_tests"] });
    assert.ok(filtered.steps.length >= 1);
    assert.ok(filtered.steps.every((s) => s.name?.toLowerCase() === "run_tests"));
  });

  it("keeps failures and paired tool calls", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"));
    const filtered = filterTrace(trace, { failures: true });
    assert.ok(filtered.stats.failures >= 1);
    assert.ok(filtered.steps.some((s) => s.kind === "error"));
    assert.ok(filtered.steps.some((s) => s.kind === "tool_call" && s.name === "run_tests"));
    assert.ok(!filtered.steps.some((s) => s.kind === "user"));
  });
});

describe("stats.tools", () => {
  it("breaks down tools on the demo run", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"));
    assert.ok(trace.stats.tools?.length);
    const runTests = trace.stats.tools?.find((t) => t.name === "run_tests");
    assert.ok(runTests);
    assert.equal(runTests?.failures, 1);
    const report = statsReport(trace);
    assert.match(report, /format \w+/);
    assert.match(report, /19 steps/);
    assert.match(report, /tools:/);
    assert.match(report, /run_tests/);
  });
});

describe("renderMarkdown", () => {
  it("emits a table with tool stats", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"), { source: "examples/run.jsonl" });
    const md = renderMarkdown(trace);
    assert.match(md, /^# agent-trace · examples\/run\.jsonl/m);
    assert.match(md, /\| Tool \| Calls \|/);
    assert.match(md, /run_tests/);
    assert.match(md, /\| # \| Kind \|/);
    assert.match(md, /cookie sid missing/);
  });
});

describe("renderMermaid", () => {
  it("emits a flowchart with styled error nodes", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"), { source: "examples/run.jsonl" });
    const out = renderMermaid(trace);
    assert.match(out, /flowchart TD/);
    assert.match(out, /S1\(/);
    assert.match(out, /S\d+ -->/);
    assert.match(out, /style S\d+ fill:#fee2e2/);
    assert.match(out, /run_tests|error/);
  });
});
