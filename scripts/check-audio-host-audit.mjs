import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nativeSourceManifest } from "./native-source-manifest.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolsRoot = path.join(project, ".tools");
const cacheRoot = path.join(toolsRoot, "zig-cache");
const auditCache = path.join(cacheRoot, "audio-host-audit");
const outputDirectory = path.join(toolsRoot, "audit-tests");
const executable = path.join(outputDirectory, "audio-host-audit-check.exe");
const fixture = path.join(project, "scripts", "fixtures", "audio-host-audit-check.cpp");
const compiler = path.join(project, ".tools", "walkman", "compiler", "zig-x86_64-windows-0.15.2", "zig.exe");
const vendorInclude = path.join(project, "vendor", "audio", "windows-x64", "include");

async function requireDirectory(directory, create = false) {
  let info;
  try {
    info = await fs.lstat(directory);
  } catch (error) {
    if (error.code !== "ENOENT" || !create) throw error;
    await fs.mkdir(directory);
    info = await fs.lstat(directory);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Audit build path must be a real directory: ${directory}`);
  }
}

async function requireFile(file) {
  const info = await fs.lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Audit build input must be a regular file: ${file}`);
  }
}

function run(program, args, options, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, options);
    child.once("error", reject);
    child.once("close", code => code === 0
      ? resolve()
      : reject(new Error(`${label} failed with exit code ${code}`)));
  });
}

if (process.platform !== "win32") {
  throw new Error("This fixture uses Windows callback types and the project-local Windows Zig target.");
}

await requireDirectory(toolsRoot);
await requireDirectory(cacheRoot);
await requireDirectory(outputDirectory, true);
await requireDirectory(auditCache, true);
await requireDirectory(path.join(auditCache, "local"), true);
await requireDirectory(path.join(auditCache, "global"), true);
await requireFile(compiler);
await requireFile(fixture);
await requireDirectory(vendorInclude);

const inputs = await nativeSourceManifest(project);
const arguments_ = [
  "c++", "-target", "x86_64-windows-gnu", "-std=c++17", "-O2", "-fno-fast-math", "-static", "-pthread",
  "-I", vendorInclude,
  ...inputs.includeDirectories.flatMap(directory => ["-I", directory]),
  fixture,
  ...inputs.buildSources,
  "-o", executable,
  "-lole32", "-luuid", "-lavrt",
];
const environment = {
  ...process.env,
  ZIG_LOCAL_CACHE_DIR: path.join(auditCache, "local"),
  ZIG_GLOBAL_CACHE_DIR: path.join(auditCache, "global"),
};

await run(compiler, arguments_, { cwd: project, windowsHide: true, stdio: "inherit", env: environment }, "Audio host fixture compilation");
await run(executable, [], { cwd: project, windowsHide: true, stdio: "inherit", env: process.env }, "Audio host offline audit");
