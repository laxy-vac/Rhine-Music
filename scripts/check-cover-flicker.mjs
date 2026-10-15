import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [
  path.join(project, "scripts", "check-case-system.mjs"),
  "--cover-flicker",
  ...process.argv.slice(2),
], { cwd: project, stdio: "inherit", windowsHide: true });

child.once("error", error => {
  console.error("Unable to start the existing offline ArchiveScene fixture:", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
