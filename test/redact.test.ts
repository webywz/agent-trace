import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrace, redactText, redactTrace, redactValue, REDACTED, renderMarkdown } from "../src/index.js";

describe("redactText", () => {
  it("scrubs OpenAI / Anthropic / project API keys", () => {
    assert.equal(redactText("key=sk-abcdefghijklmnopqrstuvwxyz0123"), `key=${REDACTED}`);
    assert.equal(redactText("sk-ant-api03-abcdefghijklmnopqrst"), REDACTED);
    assert.equal(redactText("sk-proj-ABCDEFGHIJKLMNOPQRSTUV"), REDACTED);
  });

  it("scrubs GitHub and Slack tokens", () => {
    assert.match(redactText("tok=ghp_abcdefghijklmnopqrstuvwxyz0123456789"), new RegExp(REDACTED));
    assert.match(redactText("gho_abcdefghijklmnopqrstuvwxyz0123456789"), new RegExp(REDACTED));
    assert.match(redactText("github_pat_11AAAAAAA_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF"), new RegExp(REDACTED));
    assert.match(redactText("xoxb-1234567890-abcdefghij"), new RegExp(REDACTED));
    assert.match(redactText("xoxp-1234567890-abcdefghij"), new RegExp(REDACTED));
  });

  it("scrubs AWS access keys and Bearer/Basic headers", () => {
    assert.equal(redactText("AKIAIOSFODNN7EXAMPLE"), REDACTED);
    assert.equal(redactText("Authorization: Bearer eyJhbGciOi.secret.token"), `Authorization: ${REDACTED}`);
    assert.equal(redactText("Basic dXNlcjpwYXNzMTIzNDU2"), REDACTED);
  });

  it("scrubs JWT-ish tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.signaturepad";
    assert.equal(redactText(`token ${jwt} ok`), `token ${REDACTED} ok`);
  });

  it("scrubs PEM private keys", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF6PZGBw=
-----END RSA PRIVATE KEY-----`;
    assert.equal(redactText(`before\n${pem}\nafter`), `before\n${REDACTED}\nafter`);
  });

  it("leaves ordinary text alone", () => {
    assert.equal(redactText("hello skater world"), "hello skater world");
  });
});

describe("redactValue / redactTrace", () => {
  it("deep-scrubs nested args", () => {
    const value = redactValue({
      headers: { Authorization: "Bearer supersecrettokenvalue" },
      nested: ["sk-abcdefghijklmnopqrstuvwxyz"],
    });
    assert.deepEqual(value, {
      headers: { Authorization: REDACTED },
      nested: [REDACTED],
    });
  });

  it("applies to trace steps used by markdown export", () => {
    const raw = [
      JSON.stringify({
        role: "assistant",
        content: "using sk-abcdefghijklmnopqrstuvwxyz0123",
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: {
              name: "http",
              arguments: JSON.stringify({ auth: "Bearer abcdefghijklmnop" }),
            },
          },
        ],
      }),
      JSON.stringify({
        role: "tool",
        tool_call_id: "c1",
        content: "AKIAIOSFODNN7EXAMPLE ok",
      }),
    ].join("\n");
    const trace = redactTrace(parseTrace(raw, { format: "openai", source: "secret.jsonl" }));
    const md = renderMarkdown(trace);
    assert.doesNotMatch(md, /sk-abcdef/);
    assert.doesNotMatch(md, /AKIAIOSFODNN7EXAMPLE/);
    assert.doesNotMatch(md, /Bearer abcdef/);
    assert.match(md, /\[redacted\]/);
  });
});
