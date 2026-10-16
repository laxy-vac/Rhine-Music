const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const electronPath = path.join(projectRoot, '.tools', 'source-preview-electron', 'electron.exe');
const outputRoot = path.join(projectRoot, '.tools', 'unified-ui-2026-10-17', 'hidden-paint');
const isElectronChild = Boolean(process.versions.electron);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' exceeded ' + ms + ' ms')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runElectronProbe() {
  const { app, BrowserWindow } = require('electron');
  const reportPath = process.env.RHINE_HIDDEN_PAINT_REPORT;
  const profilePath = process.env.RHINE_HIDDEN_PAINT_PROFILE;
  if (!reportPath || !profilePath) throw new Error('Missing isolated output paths.');
  app.setPath('userData', profilePath);

  const report = {
    ok: false,
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    syntheticDataOnly: true,
    serviceOrAudioStarted: false,
    windowsShown: 0,
    timeoutMs: 3000,
    probes: [],
  };

  await app.whenReady();
  const cases = [
    { id: 'default', description: 'backgroundThrottling default (omitted)' },
    { id: 'disabled', description: 'setBackgroundThrottling(false) while hidden' },
  ];
  const entries = [];
  try {
    for (const testCase of cases) {
      const window = new BrowserWindow({
        width: 320,
        height: 180,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const webContents = window.webContents;
      const probe = {
        id: testCase.id,
        description: testCase.description,
        initiallyVisible: window.isVisible(),
        setBackgroundThrottlingAvailable: typeof webContents.setBackgroundThrottling === 'function',
        getBackgroundThrottlingAvailable: typeof webContents.getBackgroundThrottling === 'function',
      };
      entries.push({ testCase, window, webContents, probe });
    }

    for (const { testCase, window, webContents, probe } of entries) {
      try {
        if (testCase.id === 'disabled') {
          if (typeof webContents.setBackgroundThrottling !== 'function') {
            throw new Error('webContents.setBackgroundThrottling is unavailable in this Electron runtime.');
          }
          webContents.setBackgroundThrottling(false);
        }
        probe.configuredThrottling = typeof webContents.getBackgroundThrottling === 'function'
          ? webContents.getBackgroundThrottling()
          : null;

        const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>synthetic hidden paint probe</body></html>';
        await withTimeout(webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)), 10000, 'Synthetic data page load');

        const startedAt = Date.now();
        const initial = await webContents.executeJavaScript(`(() => {
          const state = { visibilityState: document.visibilityState, firstRafMs: null, secondRafMs: null, completed: false };
          const started = performance.now();
          window.__hiddenPaintProbe = state;
          requestAnimationFrame(() => {
            state.firstRafMs = Math.round(performance.now() - started);
            requestAnimationFrame(() => {
              state.secondRafMs = Math.round(performance.now() - started);
              state.completed = true;
            });
          });
          return { visibilityState: state.visibilityState };
        })()`, true);
        let latest = null;
        while (Date.now() - startedAt < report.timeoutMs) {
          latest = await webContents.executeJavaScript(`(() => {
            const state = window.__hiddenPaintProbe;
            return state ? {
              visibilityState: state.visibilityState,
              liveVisibilityState: document.visibilityState,
              firstRafMs: state.firstRafMs,
              secondRafMs: state.secondRafMs,
              completed: state.completed
            } : null;
          })()`, true);
          if (latest?.completed) break;
          await pause(40);
        }
        probe.visibilityState = initial?.visibilityState ?? null;
        probe.liveVisibilityState = latest?.liveVisibilityState ?? null;
        probe.firstRafMs = latest?.firstRafMs ?? null;
        probe.secondRafMs = latest?.secondRafMs ?? null;
        probe.twoRafsWithin3s = Boolean(latest?.completed && Date.now() - startedAt <= report.timeoutMs);
        probe.windowStillHidden = !window.isVisible();
      } catch (error) {
        probe.error = String(error?.stack ?? error);
      }
      report.probes.push(probe);
    }

    report.ok = report.probes.length === 2 && report.probes.every((probe) => !probe.error && probe.windowStillHidden);
  } finally {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    for (const { window } of entries) {
      if (!window.isDestroyed()) window.destroy();
    }
    app.quit();
  }
}

async function runLauncher() {
  await fs.access(electronPath);
  const runDirectory = path.join(outputRoot, 'run-' + Date.now() + '-' + process.pid);
  const profilePath = path.join(runDirectory, 'isolated-user-data');
  const reportPath = path.join(runDirectory, 'report.json');
  const electronAppDirectory = path.join(runDirectory, 'electron-app');
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.mkdir(electronAppDirectory, { recursive: true });
  const electronMain = path.relative(electronAppDirectory, __filename).split(path.sep).join('/');
  await fs.writeFile(path.join(electronAppDirectory, 'package.json'), JSON.stringify({
    name: 'rhine-hidden-paint-check',
    version: '1.0.0',
    main: electronMain,
  }, null, 2) + '\n', 'utf8');

  const environment = {
    ...process.env,
    RHINE_HIDDEN_PAINT_REPORT: reportPath,
    RHINE_HIDDEN_PAINT_PROFILE: profilePath,
  };
  delete environment.ELECTRON_RUN_AS_NODE;

  const childResult = await new Promise((resolve, reject) => {
    const child = spawn(electronPath, [electronAppDirectory], {
      cwd: projectRoot,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), 25000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });

  let report;
  try {
    report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  } catch (error) {
    report = {
      ok: false,
      error: 'Electron did not write its report: ' + String(error?.message ?? error),
      electronStdout: childResult.stdout.slice(-3000),
      electronStderr: childResult.stderr.slice(-3000),
    };
  }
  report.electronExitCode = childResult.code;
  report.electronSignal = childResult.signal;
  report.electronRunAsNodeRemoved = !Object.hasOwn(environment, 'ELECTRON_RUN_AS_NODE');
  report.electronStdout = childResult.stdout.slice(-3000);
  report.electronStderr = childResult.stderr.slice(-3000);
  if (childResult.code !== 0) {
    report.ok = false;
  }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ ...report, reportPath }, null, 2) + '\n');
  if (!report.ok) process.exitCode = 1;
}

if (isElectronChild) {
  runElectronProbe().catch(async (error) => {
    const reportPath = process.env.RHINE_HIDDEN_PAINT_REPORT;
    if (reportPath) {
      const report = { ok: false, electronVersion: process.versions.electron, error: String(error?.stack ?? error) };
      await fs.mkdir(path.dirname(reportPath), { recursive: true }).catch(() => {});
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8').catch(() => {});
    }
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
} else {
  runLauncher().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
