import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/args.js";
import { parseTrace } from "../src/index.js";
import { escapeHtml, renderHtml } from "../src/render/html.js";
import { fixture } from "./helpers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "src", "cli.ts");
const tsx = join(root, "node_modules", ".bin", "tsx");

function run(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [cli, ...args], {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("escapeHtml", () => {
  it("escapes angle brackets amp quotes", () => {
    assert.equal(
      escapeHtml(`<script>alert("x")</script>&'`),
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;",
    );
  });
});

describe("renderHtml", () => {
  it("emits self-contained dark timeline with markers", () => {
    const trace = parseTrace(fixture("examples/run.jsonl"), { source: "examples/run.jsonl" });
    const html = renderHtml(trace);
    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /agent-trace/);
    assert.match(html, /examples\/run\.jsonl/);
    assert.match(html, /class="timeline"/);
    assert.match(html, /kind-tool-call|kind-error/);
    assert.match(html, /Expand all/);
    assert.doesNotMatch(html, /cdn\.|unpkg|jsdelivr/i);
    assert.match(html, /read_file/);
  });

  it("escapes hostile content in steps", () => {
    const payload = JSON.stringify([
      {
        type: "assistant",
        content: `<img src=x onerror="alert(1)"> & </script>`,
      },
      { type: "error", error: `<b>boom</b>` },
    ]);
    const trace = parseTrace(payload, { format: "generic", source: "xss.json" });
    const html = renderHtml(trace);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
    assert.match(html, /&lt;b&gt;boom&lt;\/b&gt;/);
    // Escaped text may still contain the letters onerror=, but not a live attribute.
    assert.doesNotMatch(html, /\sonerror="/i);
    assert.match(html, /onerror=&quot;/);
  });
});

describe("parseArgs --html", () => {
  it("bare --html means stdout", () => {
    const args = parseArgs(["node", "agent-trace", "--html", "--demo"]);
    assert.equal(args.html, true);
    assert.equal(args.demo, true);
  });

  it("accepts --html path and --html=path", () => {
    assert.equal(
      parseArgs(["node", "agent-trace", "--html", "out.html", "--demo"]).html,
      "out.html",
    );
    assert.equal(
      parseArgs(["node", "agent-trace", "--html=out.html", "--demo"]).html,
      "out.html",
    );
  });

  it("rejects --html with --markdown", () => {
    assert.throws(
      () => parseArgs(["node", "agent-trace", "--html", "--markdown", "--demo"]),
      /only one of/,
    );
  });
});

describe("CLI --html", () => {
  it("writes a file when path is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "at-html-"));
    const out = join(dir, "trace.html");
    try {
      const result = await run(["--demo", `--html=${out}`, "--no-color"]);
      assert.equal(result.code, 0, result.stderr);
      const html = readFileSync(out, "utf8");
      assert.match(html, /<!DOCTYPE html>/i);
      assert.match(html, /agent-trace/);
      assert.match(html, /timeline/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
