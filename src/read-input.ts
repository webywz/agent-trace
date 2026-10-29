import { readFile } from "node:fs/promises";

export async function readInput(file: string | undefined): Promise<{ text: string; source: string }> {
  if (!file || file === "-") {
    if (process.stdin.isTTY && file !== "-") {
      throw new Error("missing file (pass a path, or '-' for stdin)");
    }
    const text = await readStdin();
    return { text, source: "stdin" };
  }
  const text = await readFile(file, "utf8");
  return { text, source: file };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
