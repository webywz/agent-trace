import { readFile } from "node:fs/promises";
import { UsageError } from "./args.js";

export async function readInput(file: string | undefined): Promise<{ text: string; source: string }> {
  if (!file || file === "-") {
    if (process.stdin.isTTY && file !== "-") {
      throw new UsageError("missing file (pass a path, '-' for stdin, or --demo for the bundled sample)");
    }
    const text = await readStdin();
    return { text, source: "stdin" };
  }
  try {
    const text = await readFile(file, "utf8");
    return { text, source: file };
  } catch (error) {
    throw wrapIoError(error, file);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function wrapIoError(error: unknown, file: string): Error {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
  if (code === "ENOENT") return new Error(`file not found: ${file}`);
  if (code === "EISDIR") return new Error(`expected a file, got a directory: ${file}`);
  if (code === "EACCES") return new Error(`permission denied: ${file}`);
  return error instanceof Error ? error : new Error(String(error));
}
