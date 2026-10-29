import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function fixture(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

export function fixturePath(rel: string): string {
  return join(root, rel);
}
