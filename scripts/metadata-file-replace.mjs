import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renameWithRetry, samePath } from './platform.mjs';

const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$operation = [Environment]::GetEnvironmentVariable('RHINE_METADATA_OPERATION', 'Process')
$stage = [Environment]::GetEnvironmentVariable('RHINE_METADATA_STAGE', 'Process')
$target = [Environment]::GetEnvironmentVariable('RHINE_METADATA_TARGET', 'Process')
$backup = [Environment]::GetEnvironmentVariable('RHINE_METADATA_BACKUP', 'Process')
try {
  switch ($operation) {
    'replace' { [IO.File]::Replace($stage, $target, $backup, $false) }
    'restore' { [IO.File]::Move($backup, $target) }
    default { throw 'Unsupported metadata replacement operation.' }
  }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;
const WINDOWS_ENCODED_COMMAND = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');

function resolvedAbsolute(file, name) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError(`${name} must be an absolute path.`);
  const resolved = path.resolve(file);
  if (process.platform === 'win32' && path.basename(resolved).includes(':')) {
    throw new TypeError(`${name} must name a file, not an alternate data stream.`);
  }
  return resolved;
}

async function assertOrdinaryFile(file, name) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${name} does not exist: ${file}`, { cause: error });
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError(`${name} must be an ordinary file: ${file}`);
}

async function existingStat(file) {
  try { return await fs.lstat(file); }
  catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function ownedBackupPath(directory) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = path.join(directory, `.rhine-metadata-${randomUUID()}.backup`);
    if (!await existingStat(candidate)) return candidate;
  }
  throw new Error('Could not reserve a unique metadata backup path.');
}

function powershellExecutable() {
  const windowsRoot = process.env.SystemRoot || process.env.windir;
  if (!windowsRoot || !path.isAbsolute(windowsRoot)) throw new Error('SystemRoot is unavailable; Windows PowerShell cannot be located safely.');
  return path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function runWindowsOperation(operation, stage, target, backup) {
  const env = {
    ...process.env,
    RHINE_METADATA_OPERATION: operation,
    RHINE_METADATA_STAGE: stage,
    RHINE_METADATA_TARGET: target,
    RHINE_METADATA_BACKUP: backup,
  };
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(powershellExecutable(), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', WINDOWS_ENCODED_COMMAND,
    ], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.stdout.on('data', chunk => { if (stdout.length < 8192) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString('utf8'); });
    child.once('error', error => finish(reject, error));
    child.once('close', (code, signal) => {
      if (code === 0) return finish(resolve);
      const detail = (stderr || stdout).trim();
      finish(reject, new Error(`Windows PowerShell ${operation} failed (${code ?? signal ?? 'unknown'}).${detail ? ` ${detail}` : ''}`));
    });
  });
}

function withBackupPath(error, backup) {
  const wrapped = new Error(`${error.message} The operation's backup is preserved at: ${backup}`, { cause: error });
  wrapped.backupPath = backup;
  return wrapped;
}

async function recoverMissingTarget(target, backup, originalError) {
  let targetStat;
  let backupStat;
  try {
    targetStat = await existingStat(target);
    backupStat = await existingStat(backup);
  } catch (inspectError) {
    const error = new Error(`${originalError.message} Recovery state could not be verified: ${inspectError.message}`, { cause: originalError });
    return { error: withBackupPath(error, backup) };
  }
  if (targetStat || !backupStat) return { error: backupStat ? withBackupPath(originalError, backup) : originalError };
  if (!backupStat.isFile() || backupStat.isSymbolicLink()) return { error: withBackupPath(originalError, backup) };
  try {
    await runWindowsOperation('restore', '', target, backup);
    const restored = await existingStat(target);
    if (!restored?.isFile() || restored.isSymbolicLink()) throw new Error('The restored target is not an ordinary file.');
    return { error: originalError };
  } catch (restoreError) {
    return { error: withBackupPath(new Error(`${originalError.message} Recovery failed: ${restoreError.message}`, { cause: originalError }), backup) };
  }
}

async function removeOwnedBackup(backup) {
  let stat;
  try { stat = await existingStat(backup); }
  catch (cause) {
    const error = new Error(`The file was replaced, but the generated backup status could not be checked: ${backup}`, { cause });
    error.committed = true;
    error.backupPath = backup;
    throw error;
  }
  if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const error = new Error(`The file was replaced, but the generated backup path is not an ordinary file: ${backup}`);
    error.committed = true;
    error.backupPath = backup;
    throw error;
  }
  try { await fs.unlink(backup); }
  catch (cause) {
    const error = new Error(`The file was replaced, but its generated backup could not be removed: ${backup}`, { cause });
    error.committed = true;
    error.backupPath = backup;
    throw error;
  }
}

/** Replace a staged metadata edit without changing the file's encoded audio data. */
export async function replaceMetadataFile(stage, target) {
  const stagePath = resolvedAbsolute(stage, 'stage');
  const targetPath = resolvedAbsolute(target, 'target');
  if (samePath(stagePath, targetPath)) throw new TypeError('stage and target must be different files.');

  const [stageDirectory, targetDirectory] = await Promise.all([
    fs.realpath(path.dirname(stagePath)), fs.realpath(path.dirname(targetPath)),
  ]);
  if (!samePath(stageDirectory, targetDirectory)) throw new TypeError('stage and target must be in the same directory.');
  await Promise.all([assertOrdinaryFile(stagePath, 'stage'), assertOrdinaryFile(targetPath, 'target')]);

  if (process.platform !== 'win32') return renameWithRetry(stagePath, targetPath);

  const backup = await ownedBackupPath(targetDirectory);
  try {
    await runWindowsOperation('replace', stagePath, targetPath, backup);
  } catch (replaceError) {
    const recovery = await recoverMissingTarget(targetPath, backup, replaceError);
    throw recovery.error;
  }

  let replacedTarget;
  try { replacedTarget = await existingStat(targetPath); }
  catch (cause) {
    const error = new Error(`Windows PowerShell reported success, but the target status could not be checked: ${cause.message}`, { cause });
    const recovery = await recoverMissingTarget(targetPath, backup, error);
    throw recovery.error;
  }
  if (!replacedTarget) {
    const recovery = await recoverMissingTarget(targetPath, backup, new Error('Windows PowerShell reported success, but the target is missing.'));
    throw recovery.error;
  }
  if (!replacedTarget.isFile() || replacedTarget.isSymbolicLink()) {
    const error = new Error(`Windows PowerShell reported success, but the target is not an ordinary file. Backup: ${backup}`);
    error.backupPath = backup;
    throw error;
  }
  await removeOwnedBackup(backup);
}
