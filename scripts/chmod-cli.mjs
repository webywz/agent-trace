import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
await chmod(cli, 0o755);
