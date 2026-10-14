const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('no-first-run');

const checkUrl = process.env.RHINE_LYRICS_CHECK_URL;
const profileDirectory = process.env.RHINE_LYRICS_CHECK_PROFILE;
const reportPath = process.env.RHINE_LYRICS_CHECK_REPORT;
const artifactDirectory = process.env.RHINE_LYRICS_CHECK_ARTIFACTS;
const report = {
  ok: false,
  checks: {},
  viewports: [],
  screenshots: [],
  syntheticDataOnly: true,
  externalNetworkRequests: [],
  browserWindowShown: false,
  electronMainMode: !!process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1',
};
let browserWindow;
let currentViewport = { width: 1280, height: 840 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browser(expression) {
  return browserWindow.webContents.executeJavaScript(expression, true);
}

async function waitBrowser(expression, label, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await browser(expression)) return;
    } catch {}
    await pause(75);
  }
  throw new Error('Timed out waiting for ' + label + '.');
}

async function mockState() {
  return browser('fetch("/__lyrics-check/state", { cache:"no-store" }).then((response) => response.json())');
}

async function waitMockState(predicate, label, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await mockState();
    if (predicate(state)) return state;
    await pause(75);
  }
  throw new Error('Timed out waiting for mocked API state: ' + label + '.');
}

async function click(selector) {
  const encodedSelector = JSON.stringify(selector);
  await browser('(() => { const node = document.querySelector(' + encodedSelector + '); if (!node) throw new Error("Missing element: " + ' + encodedSelector + '); node.click(); return true; })()');
}

async function inspectViewport(width, height) {
  currentViewport = { width, height };
  browserWindow.setContentSize(width, height);
  await waitBrowser('innerWidth === ' + width + ' && innerHeight === ' + height, width + 'x' + height + ' content size');
  const geometryExpression = [
    '(() => {',
    '  const rect = (node) => { const r = node.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };',
    '  const visible = (node) => { if (!node) return false; const s = getComputedStyle(node); const r = node.getBoundingClientRect(); return !node.hidden && s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };',
    '  const side = document.querySelector(".lyrics-left");',
    '  const body = document.querySelector(".lyrics-left .lyrics-side-body");',
    '  const bars = document.querySelector(".lyrics-left .lyrics-spectrum-bars");',
    '  const gear = document.querySelector(".lyrics-main-header [aria-label=\\"歌词选项\\"]");',
    '  const header = document.querySelector(".lyrics-main-header");',
    '  const b = bars ? rect(bars) : null;',
    '  const i = body && b ? Math.max(0, Math.min(rect(body).bottom, b.bottom) - Math.max(rect(body).top, b.top)) : -1;',
    '  return { viewport:{width:innerWidth,height:innerHeight}, side:rect(side), info:rect(body), bars:b, header:rect(header), gear:rect(gear), visible:{options:visible(gear)}, toolCount:header.querySelectorAll("button").length, iconText:gear.textContent.trim(), outsideOffsets:!!document.querySelector(".lyrics-right .lyrics-offset-section"), outsideImport:!!header.querySelector(".lyrics-import-button"), gearInsideHeader:!!(header && gear && header.contains(gear) && gear.closest(".lyrics-main-header") === header), infoBarsOverlap:i };',
    '})()',
  ].join('\n');
  const geometry = await browser(geometryExpression);
  report.viewports.push(geometry);
  const inside = geometry.bars && geometry.side
    && geometry.bars.left >= geometry.side.left - 1
    && geometry.bars.right <= geometry.side.right + 1
    && geometry.bars.top >= geometry.side.top - 1
    && geometry.bars.bottom <= geometry.side.bottom + 1;
  assert(geometry.viewport.width === width && geometry.viewport.height === height,
    'Electron content size did not match ' + width + 'x' + height + ': ' + JSON.stringify(geometry.viewport));
  assert(geometry.bars && geometry.bars.height >= 50 && inside,
    'Spectrum bars must be at least 50px tall and remain inside the left sidebar at ' + width + 'x' + height + ': ' + JSON.stringify(geometry));
  assert(geometry.infoBarsOverlap <= 1,
    'The left information scroll area overlaps the spectrum bars at ' + width + 'x' + height + ': ' + JSON.stringify(geometry));
  assert(geometry.gearInsideHeader && Math.abs(geometry.gear.width - 32) < 1 && Math.abs(geometry.gear.height - 32) < 1
      && geometry.gear.left >= geometry.header.left - 1 && geometry.gear.right <= geometry.header.right + 1
      && geometry.gear.top >= geometry.header.top - 1 && geometry.gear.bottom <= geometry.header.bottom + 1,
    'The per-track settings button must be 32px square inside the central header at ' + width + 'x' + height + ': ' + JSON.stringify(geometry));
  assert(geometry.visible.options && geometry.toolCount===1 && geometry.iconText==='' && !geometry.outsideOffsets && !geometry.outsideImport,
    'Only one text-free lyrics options icon may appear outside the dialog at ' + width + 'x' + height + ': ' + JSON.stringify(geometry));
  const image = await browserWindow.capturePage(undefined,{stayHidden:true,stayAwake:true});
  const screenshotPath = path.join(artifactDirectory, 'lyrics-page-' + width + 'x' + height + '.png');
  await fs.writeFile(screenshotPath, image.toPNG());
  report.screenshots.push(screenshotPath);
  return geometry;
}

async function saveFailureScreenshot() {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  try {
    const image = await browserWindow.capturePage(undefined,{stayHidden:true,stayAwake:true});
    const filename = 'lyrics-page-failure-' + currentViewport.width + 'x' + currentViewport.height + '.png';
    const screenshotPath = path.join(artifactDirectory, filename);
    await fs.writeFile(screenshotPath, image.toPNG());
    report.screenshots.push(screenshotPath);
  } catch (error) {
    report.screenshotError = String(error?.message ?? error);
  }
}

async function run() {
  assert(checkUrl && profileDirectory && reportPath && artifactDirectory, 'The isolated check environment is incomplete.');
  assert(report.electronMainMode, 'Electron must run as an app process; ELECTRON_RUN_AS_NODE must be unset.');
  await fs.mkdir(profileDirectory, { recursive: true });
  app.setPath('userData', path.resolve(profileDirectory));
  await app.whenReady();

  const allowedUrl = new URL(checkUrl);
  const allowedOrigin = allowedUrl.origin;
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      let allowed = false;
      try {
        const requestUrl = new URL(details.url);
        const localPort = requestUrl.hostname === '127.0.0.1' && Number(requestUrl.port) === Number(allowedUrl.port);
        allowed = localPort && (requestUrl.protocol === 'http:' || requestUrl.protocol === 'ws:');
      } catch {}
      if (!allowed) report.externalNetworkRequests.push(details.url);
      callback({ cancel: !allowed });
    },
  );
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  browserWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    useContentSize: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  browserWindow.webContents.setAudioMuted(true);
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  browserWindow.webContents.on('will-navigate', (event, destination) => {
    if (new URL(destination).origin !== allowedOrigin) event.preventDefault();
  });
  browserWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) report.consoleErrors = [...(report.consoleErrors ?? []), message];
  });

  await browserWindow.loadURL(checkUrl);
  await waitBrowser('window.__lyricsCheckReady === true', 'real lyrics page module');
  await browser('document.fonts.ready.then(()=>true)');
  await waitMockState((state) => state.requests.some((item) => item.path === '/api/lyrics/settings')
    && state.requests.some((item) => item.path === '/api/lyrics/preferences')
    && state.requests.some((item) => item.path === '/api/lyrics/track'), 'synthetic settings, preference, and cache requests');

  assert(!browserWindow.isVisible(), 'The isolated test BrowserWindow must stay hidden.');
  report.checks.hiddenElectronWindow = true;

  await inspectViewport(1280, 840);
  await inspectViewport(1100, 720);
  report.checks.geometry = true;

  const initialState = await mockState();
  assert(!initialState.requests.some((item) => item.path === '/api/lyrics/search'),
    'A lyric search ran before the user requested it.');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden && !document.querySelector("#lyrics-search-panel").hidden && !document.querySelector("#lyrics-search-panel .lyrics-primary-button").disabled',
    'lyrics options dialog opened with search controls ready');
  assert(!(await mockState()).requests.some(item=>item.path==='/api/lyrics/search'),'Opening the options dialog must not search automatically');
  await click('#lyrics-search-panel .lyrics-primary-button');
  await waitBrowser('document.querySelector(".lyrics-candidate-card") !== null',
    'multi-source search returned a candidate');

  const searchState = await mockState();
  const searchRequest = searchState.requests.find((item) => item.path === '/api/lyrics/search');
  assert(searchRequest?.body?.sourceId === 'auto',
    'The search control must explicitly request auto/multi-source search: ' + JSON.stringify(searchRequest));
  const searchUi = await browser('(() => ({ errors:[...document.querySelectorAll(".lyrics-search-outcome[data-status=\\"error\\"]")].map((node)=>node.textContent), successes:[...document.querySelectorAll(".lyrics-search-outcome[data-status=\\"ok\\"]")].map((node)=>node.textContent), candidateSource:document.querySelector(".lyrics-candidate-card > small")?.textContent ?? "", candidateTitle:document.querySelector(".lyrics-candidate-text strong")?.textContent ?? "" }))()');
  assert(searchUi.errors.some((text) => text.includes('网易云音乐'))
      && searchUi.successes.some((text) => text.includes('QQ音乐'))
      && searchUi.candidateSource.includes('QQ音乐'),
    'The panel must show a failed source and a selectable candidate with its source name: ' + JSON.stringify(searchUi));
  report.checks.autoMultiSourcePartialFailureAndCandidateSource = true;
  await pause(100);

  await click('.lyrics-candidate-card button');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden === true && document.querySelectorAll(".lyrics-line-text").length >= 2',
    'candidate selection saved lyrics and closed the options dialog');
  const selectedState = await mockState();
  const selectRequest = selectedState.requests.find((item) => item.path === '/api/lyrics/select');
  assert(selectRequest?.body?.trackId === 'synthetic-track'
      && selectRequest?.body?.candidateId === 'synthetic-qq-candidate'
      && selectedState.savedTrackIds.includes('synthetic-track'),
    'The successful candidate was not saved to the synthetic cache: ' + JSON.stringify(selectRequest));
  const lyricText = await browser('document.querySelector(".lyrics-lines")?.textContent ?? ""');
  assert(lyricText.includes('第一句合成歌词') && lyricText.includes('第二句合成歌词'),
    'Saved synthetic lyrics were not rendered: ' + lyricText);
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await click('#lyrics-options-settings-tab');
  await waitBrowser('!document.querySelector("#lyrics-track-settings").hidden && !document.querySelector(".lyrics-offset-controls input").disabled','offset controls available inside settings tab');
  await browser('document.querySelector(".lyrics-offset-controls input").value="0.5"');
  await click('.lyrics-offset-controls .lyrics-quiet-button');
  const offsetState=await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/offset'&&item.body.offsetMs===500),'offset saved from the dialog');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden && !document.querySelector(".lyrics-offset-controls .lyrics-quiet-button").disabled && document.querySelector(".lyrics-offset-controls input").value==="0.5"','completed offset save leaves the settings dialog open');
  await pause(100);
  const settingsGeometry=await browser('(() => {const dialog=document.querySelector("#lyrics-options-dialog"),body=document.querySelector("#lyrics-track-settings"),input=document.querySelector(".lyrics-offset-controls input"),r=input.getBoundingClientRect();return {hidden:dialog.hidden,display:getComputedStyle(dialog).display,bodyHidden:body.hidden,width:r.width,height:r.height,top:r.top,bottom:r.bottom}})()');
  assert(!settingsGeometry.hidden&&settingsGeometry.display!=='none'&&!settingsGeometry.bodyHidden&&settingsGeometry.width>0&&settingsGeometry.height>0,'Offset controls must remain laid out inside the open dialog: '+JSON.stringify(settingsGeometry));
  report.settingsDialogGeometry=settingsGeometry;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','Escape closes options');
  report.checks.offsetOnlyInsideDialogAndSaveRemainsOpen=true;
  assert(report.externalNetworkRequests.length === 0,
    'The isolated check attempted an external network request: ' + JSON.stringify(report.externalNetworkRequests));
  report.checks.candidateSelectedSavedRenderedAndSearchPanelClosed = true;
  report.mockApiPaths = Array.from(new Set(offsetState.requests.map((item) => item.path)));
  report.ok = true;
}

async function main() {
  try {
    await run();
  } catch (error) {
    report.ok = false;
    report.error = error?.stack ?? String(error);
    await saveFailureScreenshot();
  } finally {
    if (browserWindow && !browserWindow.isDestroyed()) {
      try { browserWindow.destroy(); } catch {}
    }
    try {
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    } catch (error) {
      report.reportWriteError = String(error?.message ?? error);
    }
    app.quit();
  }
  if (!report.ok) process.exitCode = 1;
}

void main();
