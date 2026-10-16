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
  electronRequestAttempts: [],
  electronRequestCompletions: [],
  electronRequestErrors: [],
};
process.stdout.write('[lyrics-page-check] main module loaded\n');
let browserWindow;
let currentViewport = { width: 1280, height: 840 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browser(expression) {
  return browserWindow.webContents.executeJavaScript(expression, true);
}

async function capturePageImage(label, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await browserWindow.capturePage(undefined,{stayHidden:true,stayAwake:true});
    } catch (error) {
      lastError = error;
      report.capturePageFailures ??= [];
      report.capturePageFailures.push({ label, attempt: attempt + 1, error: String(error?.stack ?? error) });
      if (attempt + 1 < attempts) await pause(100 * (attempt + 1));
    }
  }
  throw new Error('capturePage failed for ' + label + ': ' + String(lastError?.stack ?? lastError));
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

async function resizeViewport(width, height) {
  const attempts = [];
  const measure = async () => {
    const native = { contentSize: browserWindow.getContentSize(), windowSize: browserWindow.getSize(), bounds: browserWindow.getBounds() };
    let renderer;
    try { renderer = await browser('({width:innerWidth,height:innerHeight,devicePixelRatio})'); }
    catch (error) { renderer = { error: String(error?.message ?? error) }; }
    const item = { native, renderer };
    attempts.push(item);
    report.resizeDiagnostics ??= [];
    report.resizeDiagnostics.push({ requested: { width, height }, nativeContentRequest: { width, height: Math.max(1, height - 1) }, ...item });
    return renderer;
  };
  // In offscreen mode Chromium exposes a 1px taller CSS viewport than
  // BrowserWindow.getContentSize(). Compensate that measured native quirk.
  browserWindow.setContentSize(width, Math.max(1, height - 1));
  browserWindow.webContents.invalidate();
  await pause(180);
  const renderer = await measure();
  if (renderer.width === width && renderer.height === height) return;
  throw new Error('Could not resize offscreen Electron renderer to ' + width + 'x' + height + ': ' + JSON.stringify(attempts));
}

async function inspectFocusVisible(selector) {
  const target = await browser('(() => {const node=document.activeElement;return{id:node?.id??null,tag:node?.tagName??null}})()');
  assert(target.id === 'lyrics-options-settings-tab', 'A Tab key must move focus from search to settings: ' + JSON.stringify(target));
  const debuggerApi = browserWindow.webContents.debugger;
  const attachedHere = !debuggerApi.isAttached();
  let nodeId = 0;
  try {
    if (attachedHere) debuggerApi.attach();
    await debuggerApi.sendCommand('DOM.enable');
    await debuggerApi.sendCommand('CSS.enable');
    const { root } = await debuggerApi.sendCommand('DOM.getDocument');
    const queried = await debuggerApi.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
    nodeId = queried.nodeId;
    assert(nodeId > 0, 'Could not locate the keyboard focus target in the isolated renderer.');
    await debuggerApi.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] });
    const style = await browser('(() => {const node=document.activeElement,s=getComputedStyle(node);return{id:node?.id??null,focusVisible:!!node?.matches(":focus-visible"),outline:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor,borderColor:s.borderColor}})()');
    const result = { ...style, keyboardTarget: target, focusPseudoForcedForStyleCheck: true };
    report.focusPseudoChecks ??= [];
    report.focusPseudoChecks.push(result);
    return result;
  } finally {
    if (nodeId > 0) {
      try { await debuggerApi.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }); } catch {}
    }
    if (attachedHere && debuggerApi.isAttached()) {
      try { debuggerApi.detach(); } catch {}
    }
  }
}

const paintDiagnosticsExpression = [
  '(() => {',
  '  const stage=document.querySelector("#stage"), row=document.querySelector(".lyrics-line.is-active"), gear=document.querySelector(".lyrics-main-header [aria-label=\\"歌词选项\\"]"), text=row?.querySelector(".lyrics-line-text")||document.querySelector(".lyrics-line-text");',
  '  const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};',
  '  const ancestorState=(node,selector)=>{const found=node?.closest(selector);return found?{tag:found.tagName,id:found.id||null,hidden:found.hidden,inert:found.inert}:null};',
  '  const css=node=>{if(!node)return null;const s=getComputedStyle(node);return{color:s.color,backgroundColor:s.backgroundColor,borderColor:s.borderColor,boxShadow:s.boxShadow,opacity:s.opacity,transitionProperty:s.transitionProperty,transitionDuration:s.transitionDuration}};',
  '  const pixel=(color,backdrop)=>{const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const ctx=canvas.getContext("2d");ctx.fillStyle=backdrop||"#fff";ctx.fillRect(0,0,1,1);ctx.fillStyle=color||"rgba(0,0,0,0)";ctx.fillRect(0,0,1,1);const d=ctx.getImageData(0,0,1,1).data;const c=[d[0],d[1],d[2]].map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)});return{rgb:[d[0],d[1],d[2]],luminance:.2126*c[0]+.7152*c[1]+.0722*c[2]}};',
  '  const stageStyle=stage?getComputedStyle(stage):null, ink=stageStyle?.getPropertyValue("--ink").trim()||"", stageBackground=stageStyle?.backgroundColor||"transparent", textStyle=text?getComputedStyle(text):null, gearStyle=gear?getComputedStyle(gear):null;',
  '  return{theme:stage?.dataset.theme||null,documentVisibilityState:document.visibilityState,documentHidden:document.hidden,lightingMode:stage?.getAttribute("data-terminal-lighting")||null,rafCount:window.__lyricsPaintFrameStats?.count??0,lastRafTimestamp:window.__lyricsPaintFrameStats?.lastTimestamp??null,activeMatches:!!row?.matches(".lyrics-line.is-active"),activeIndex:row?.dataset.line??null,activeCount:document.querySelectorAll(".lyrics-line.is-active").length,hiddenAncestor:ancestorState(row,"[hidden]"),inertAncestor:ancestorState(row,"[inert]"),rootRect:rect(stage),rowRect:rect(row),receiverCount:document.querySelectorAll("[data-terminal-receiver]").length,rowReceiver:!!row?.hasAttribute("data-terminal-receiver"),rowShadow:row?getComputedStyle(row).boxShadow:null,ink,stageBackground,activeText:css(text),activeTextPixel:textStyle?pixel(textStyle.color,stageBackground):null,gear:css(gear),gearBackgroundPixel:gearStyle?pixel(gearStyle.backgroundColor,stageBackground):null};',
  '})()',
].join('\n');

async function startPaintFrameCounter() {
  await browser('(() => { if(window.__lyricsPaintFrameStats)return true;const stats=window.__lyricsPaintFrameStats={count:0,lastTimestamp:null};const tick=timestamp=>{stats.count+=1;stats.lastTimestamp=timestamp;requestAnimationFrame(tick)};requestAnimationFrame(tick);return true;})()');
}

async function waitForPaintStable(label, timeoutMs = 4000) {
  const startedAt = Date.now();
  const before = await browser(paintDiagnosticsExpression);
  const offscreenPaintFrameCountBefore = report.offscreenPainting?.frameCount ?? 0;
  let initialCaptureError = null;
  try {
    await capturePageImage(label + '-immediate-paint', 1);
  } catch (error) {
    initialCaptureError = String(error?.message ?? error);
  }
  let previousSignature = '';
  let stableSamples = 0;
  let latest = before;
  let frameDelta = 0;
  let retryCaptureAttempted = false;
  while (Date.now() - startedAt < timeoutMs) {
    await pause(60);
    latest = await browser(paintDiagnosticsExpression);
    frameDelta = latest.rafCount - before.rafCount;
    const signature = JSON.stringify({
      theme: latest.theme,
      lightingMode: latest.lightingMode,
      ink: latest.ink,
      stageBackground: latest.stageBackground,
      text: { color: latest.activeText?.color, backgroundColor: latest.activeText?.backgroundColor, opacity: latest.activeText?.opacity },
      gear: { color: latest.gear?.color, backgroundColor: latest.gear?.backgroundColor, borderColor: latest.gear?.borderColor, opacity: latest.gear?.opacity },
      activeIndex: latest.activeIndex,
      activeMatches: latest.activeMatches,
      rowRect: latest.rowRect,
      receiverCount: latest.receiverCount,
      rowReceiver: latest.rowReceiver,
    });
    if (signature === previousSignature) stableSamples += 1;
    else stableSamples = 0;
    previousSignature = signature;
    if (initialCaptureError && frameDelta >= 4 && !retryCaptureAttempted) {
      retryCaptureAttempted = true;
      try {
        await capturePageImage(label + '-after-render-frames', 1);
        initialCaptureError = null;
      } catch (error) {
        initialCaptureError = String(error?.message ?? error);
      }
    }
    if (frameDelta >= 4 && stableSamples >= 2) break;
    await pause(80);
  }
  latest.paintWait = {
    label,
    elapsedMs: Date.now() - startedAt,
    rafCountBefore: before.rafCount,
    rafCountAfter: latest.rafCount,
    rafDelta: frameDelta,
    stableSamples,
    offscreenPaintFrameCountBefore,
    offscreenPaintFrameCountAfter: report.offscreenPainting?.frameCount ?? 0,
    offscreenPaintFrameDelta: (report.offscreenPainting?.frameCount ?? 0) - offscreenPaintFrameCountBefore,
    stabilized: frameDelta >= 4 && stableSamples >= 2
      && (report.offscreenPainting?.frameCount ?? 0) > offscreenPaintFrameCountBefore,
    initialCaptureError,
    retryCaptureAttempted,
  };
  report.paintWaits ??= [];
  report.paintWaits.push(latest.paintWait);
  return latest;
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

async function inspectViewport(width, height, theme = 'day') {
  currentViewport = { width, height };
  await resizeViewport(width, height);
  await browser('(() => { const stage=document.querySelector("#stage"); stage.dataset.theme=' + JSON.stringify(theme) + '; window.__lyricsCheckTerminalLighting?.refresh(); return true; })()');
  const paint = await waitForPaintStable('viewport-' + width + 'x' + height + '-' + theme);
  const geometryExpression = [
    '(() => {',
    '  const rect = (node) => { const r = node.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };',
    '  const visible = (node) => { if (!node) return false; const s = getComputedStyle(node); const r = node.getBoundingClientRect(); return !node.hidden && s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };',
    '  const stage = document.querySelector("#stage");',
    '  const side = document.querySelector(".lyrics-left");',
    '  const main = document.querySelector(".lyrics-main");',
    '  const right = document.querySelector(".lyrics-right");',
    '  const body = document.querySelector(".lyrics-left .lyrics-side-body");',
    '  const bars = document.querySelector(".lyrics-left .lyrics-spectrum-bars");',
    '  const gear = document.querySelector(".lyrics-main-header [aria-label=\\"歌词选项\\"]");',
    '  const header = document.querySelector(".lyrics-main-header");',
    '  const inactiveLine = document.querySelector(".lyrics-line:not(.is-active) .lyrics-line-button") || document.querySelector(".lyrics-line:not(.is-active)");',
    '  const b = bars ? rect(bars) : null;',
    '  const i = body && b ? Math.max(0, Math.min(rect(body).bottom, b.bottom) - Math.max(rect(body).top, b.top)) : -1;',
    '  const sr=getComputedStyle(stage), pr=getComputedStyle(document.querySelector("#music-lyrics-page"));',
    '  const inactiveStyle=inactiveLine?getComputedStyle(inactiveLine):null, gearStyle=getComputedStyle(gear), beforeStyle=inactiveLine?getComputedStyle(inactiveLine,"::before"):null, afterStyle=inactiveLine?getComputedStyle(inactiveLine,"::after"):null;',
    '  return { viewport:{width:innerWidth,height:innerHeight,theme:stage.dataset.theme}, side:rect(side), main:rect(main), right:rect(right), info:rect(body), bars:b, header:rect(header), gear:rect(gear), visible:{options:visible(gear),left:visible(side),main:visible(main),right:visible(right)}, toolCount:header.querySelectorAll("button").length, iconText:gear.textContent.trim(), outsideOffsets:!!document.querySelector(".lyrics-right .lyrics-offset-section"), outsideImport:!!header.querySelector(".lyrics-import-button"), gearInsideHeader:!!(header && gear && header.contains(gear) && gear.closest(".lyrics-main-header") === header), infoBarsOverlap:i, threeColumns:!!(side&&main&&right&&rect(side).right<=rect(main).left+1&&rect(main).right<=rect(right).left+1), noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth, terminalLighting:sr.getPropertyValue("--terminal-lighting")||stage.dataset.terminalLighting||null, lightingMode:stage.getAttribute("data-terminal-lighting"), gearLightingReceiver:gear.hasAttribute("data-terminal-receiver"), pageBackground:pr.backgroundColor, stageBackground:sr.backgroundColor, inactiveStyles:{line:inactiveStyle?{backgroundColor:inactiveStyle.backgroundColor,backgroundImage:inactiveStyle.backgroundImage,appearance:inactiveStyle.appearance,boxShadow:inactiveStyle.boxShadow,borderColor:inactiveStyle.borderColor,terminalReceiver:inactiveLine.hasAttribute("data-terminal-receiver")}:null,lineBefore:beforeStyle?{content:beforeStyle.content,backgroundColor:beforeStyle.backgroundColor,boxShadow:beforeStyle.boxShadow}:null,lineAfter:afterStyle?{content:afterStyle.content,backgroundColor:afterStyle.backgroundColor,boxShadow:afterStyle.boxShadow}:null,gear:{backgroundColor:gearStyle.backgroundColor,backgroundImage:gearStyle.backgroundImage,appearance:gearStyle.appearance,boxShadow:gearStyle.boxShadow,borderColor:gearStyle.borderColor}} };',
    '})()',
  ].join('\n');
  const geometry = await browser(geometryExpression);
  geometry.paint = paint;
  report.viewports.push(geometry);
  const screenshotLabel = 'lyrics-page-' + width + 'x' + height + '-' + theme + '-local';
  await captureScreenshot(screenshotLabel);
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
  assert(geometry.noHorizontalOverflow, 'The lyrics page must not create horizontal page overflow at ' + width + 'x' + height + ': ' + JSON.stringify(geometry));
  assert(paint.paintWait.stabilized,
    'Theme/layout did not reach stable computed styles across requestAnimationFrame before screenshot at ' + width + 'x' + height + ': ' + JSON.stringify(paint));
  const textLuminance = paint.activeTextPixel?.luminance;
  const gearLuminance = paint.gearBackgroundPixel?.luminance;
  if (theme === 'day') {
    assert(Number.isFinite(textLuminance) && textLuminance < 0.14 && Number.isFinite(gearLuminance) && gearLuminance > 0.55,
      'Stable day rendering must keep lyric text dark and the gear on a light surface: ' + JSON.stringify({ paint, geometry: geometry.inactiveStyles.gear }));
  } else if (theme === 'night') {
    assert(Number.isFinite(textLuminance) && textLuminance > 0.35 && Number.isFinite(gearLuminance) && gearLuminance < 0.16,
      'Stable night rendering must use light lyric text and a dark gear surface, not an interpolated day palette: ' + JSON.stringify({ paint, geometry: geometry.inactiveStyles.gear }));
  }
  if (width >= 1600 && height >= 900) {
    assert(geometry.threeColumns && geometry.visible.left && geometry.visible.main && geometry.visible.right,
      'The 1920-class Future page must render all three columns without overlap: ' + JSON.stringify(geometry));
    assert(geometry.lightingMode === 'local',
      'The real terminal-lighting controller must be active in the Future page: ' + JSON.stringify(geometry));
    assert(geometry.inactiveStyles.line && !geometry.inactiveStyles.line.terminalReceiver && geometry.inactiveStyles.line.boxShadow === 'none',
      'Inactive lyric rows must not become terminal-light receivers or carry a shadow: ' + JSON.stringify(geometry.inactiveStyles));
  }
  return geometry;
}

async function captureScreenshot(label) {
  const image = await capturePageImage(label);
  const screenshotPath = path.join(artifactDirectory, label + '.png');
  await fs.writeFile(screenshotPath, image.toPNG());
  report.screenshots.push(screenshotPath);
  return screenshotPath;
}

async function saveFailureScreenshot() {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  try {
    const image = await capturePageImage('failure-' + currentViewport.width + 'x' + currentViewport.height);
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
  process.stdout.write('[lyrics-page-check] waiting for Electron ready\n');
  await app.whenReady();
  process.stdout.write('[lyrics-page-check] Electron ready\n');

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
      report.electronRequestAttempts.push({ url: details.url, allowed });
      if (report.electronRequestAttempts.length <= 32) process.stdout.write('[lyrics-page-check] request ' + (allowed ? 'allow ' : 'block ') + details.url + '\n');
      if (!allowed) report.externalNetworkRequests.push(details.url);
      callback({ cancel: !allowed });
    },
  );
  session.defaultSession.webRequest.onCompleted({ urls: ['http://*/*'] }, details => {
    if (!details.url.startsWith(allowedOrigin + '/')) return;
    const entry = { url: details.url, statusCode: details.statusCode, fromCache: details.fromCache };
    report.electronRequestCompletions.push(entry);
    if (report.electronRequestCompletions.length <= 32) process.stdout.write('[lyrics-page-check] completed ' + details.statusCode + ' ' + details.url + '\n');
  });
  session.defaultSession.webRequest.onErrorOccurred({ urls: ['http://*/*'] }, details => {
    const entry = { url: details.url, error: details.error };
    report.electronRequestErrors.push(entry);
    process.stdout.write('[lyrics-page-check] request error ' + details.error + ' ' + details.url + '\n');
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  browserWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    useContentSize: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  browserWindow.webContents.setAudioMuted(true);
  report.offscreenPainting = {
    requested: true,
    frameRate: 60,
    active: false,
    windowVisible: browserWindow.isVisible(),
    frameCount: 0,
    lastFrameAt: null,
  };
  browserWindow.webContents.on('paint', () => {
    report.offscreenPainting.frameCount += 1;
    report.offscreenPainting.lastFrameAt = Date.now();
  });
  browserWindow.webContents.setFrameRate(60);
  browserWindow.webContents.startPainting();
  report.offscreenPainting.active = browserWindow.webContents.isPainting();
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  browserWindow.webContents.on('will-navigate', (event, destination) => {
    if (new URL(destination).origin !== allowedOrigin) event.preventDefault();
  });
  browserWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) report.consoleErrors = [...(report.consoleErrors ?? []), message];
  });
  browserWindow.webContents.on('did-start-navigation', (_event, destination, inPlace, isMainFrame) => {
    process.stdout.write('[lyrics-page-check] navigation ' + (isMainFrame ? 'main ' : 'subframe ') + destination + '\n');
  });
  browserWindow.webContents.on('dom-ready', () => process.stdout.write('[lyrics-page-check] DOM ready\n'));
  browserWindow.webContents.on('did-finish-load', () => process.stdout.write('[lyrics-page-check] did-finish-load\n'));
  browserWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    report.loadFailure = { code, description, url };
    process.stdout.write('[lyrics-page-check] did-fail-load ' + code + ' ' + description + ' ' + url + '\n');
  });
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    report.renderProcessGone = details;
    process.stdout.write('[lyrics-page-check] renderer gone ' + JSON.stringify(details) + '\n');
  });

  process.stdout.write('[lyrics-page-check] loading local Vite harness\n');
  let loadTimer;
  try {
    await Promise.race([
      browserWindow.loadURL(checkUrl),
      new Promise((_, reject) => { loadTimer = setTimeout(() => reject(new Error('Timed out waiting for local harness navigation.')), 20000); }),
    ]);
  } finally {
    clearTimeout(loadTimer);
  }
  process.stdout.write('[lyrics-page-check] local Vite harness loaded\n');
  await waitBrowser('window.__lyricsCheckReady === true', 'real lyrics page module');
  await startPaintFrameCounter();
  await browser('document.fonts.ready.then(()=>true)');
  await waitMockState((state) => state.requests.some((item) => item.path === '/api/lyrics/settings')
    && state.requests.some((item) => item.path === '/api/lyrics/preferences')
    && state.requests.some((item) => item.path === '/api/lyrics/resolve' && item.body.trackId === 'synthetic-track'), 'synthetic settings, preference, cache, and automatic-resolution requests');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("第一句合成歌词")', 'automatically resolved synthetic lyrics rendered');

  assert(!browserWindow.isVisible(), 'The isolated test BrowserWindow must stay hidden.');
  report.checks.hiddenElectronWindow = true;

  await inspectViewport(1920, 1080, 'day');
  await inspectViewport(1920, 1080, 'night');
  await resizeViewport(1920, 1080);
  await browser('window.__lyricsCheckSetTerminalFull()');
  await waitForPaintStable('terminal-lighting-full-quality');
  const fullLightingSamples=[];
  for(const theme of ['day','night']) {
    await browser('(() => {const stage=document.querySelector("#stage");stage.dataset.theme='+JSON.stringify(theme)+';window.__lyricsCheckTerminalLighting?.refresh();return true})()');
    const themePaint=await waitForPaintStable('terminal-full-theme-'+theme);
    await browser('window.__lyricsCheckSetCurrentTime(2.5)');
    const activePaint=await waitForPaintStable('terminal-full-active-row-'+theme);
    const fullSample=await browser('(() => {const row=document.querySelector(".lyrics-line.is-active"),inactive=document.querySelector(".lyrics-line:not(.is-active) .lyrics-line-button"),button=row?.querySelector(".lyrics-line-button");return{theme:document.querySelector("#stage").dataset.theme,mode:document.querySelector("#stage").getAttribute("data-terminal-lighting"),activeIndex:row?.dataset.line??null,activeMatches:!!row?.matches(".lyrics-line.is-active"),activeReceiver:row?.hasAttribute("data-terminal-receiver")??false,activeShadow:row?getComputedStyle(row).boxShadow:null,activeButtonReceiver:button?.hasAttribute("data-terminal-receiver")??false,inactiveReceiver:inactive?.hasAttribute("data-terminal-receiver")??false,inactiveShadow:inactive?getComputedStyle(inactive).boxShadow:null,diagnostics:'+JSON.stringify({themePaint,activePaint})+'}})()');
    assert(fullSample.mode==='full'&&fullSample.activeIndex==='1'&&fullSample.activeReceiver&&fullSample.activeShadow!=='none'&&!fullSample.activeButtonReceiver
      &&fullSample.activeMatches&&fullSample.diagnostics.activePaint.hiddenAncestor===null&&fullSample.diagnostics.activePaint.inertAncestor===null
      &&fullSample.diagnostics.activePaint.rowRect?.width>0&&fullSample.diagnostics.activePaint.rowRect?.height>0
      &&!fullSample.inactiveReceiver&&fullSample.inactiveShadow==='none',
      'Full-quality '+theme+' terminal lighting must shadow only the active row: '+JSON.stringify(fullSample));
    if(theme==='night') assert(fullSample.diagnostics.activePaint.activeTextPixel?.luminance>0.35&&fullSample.diagnostics.activePaint.gearBackgroundPixel?.luminance<0.16,
      'Full-quality night palette must settle before capture: '+JSON.stringify(fullSample.diagnostics.activePaint));
    else assert(fullSample.diagnostics.activePaint.activeTextPixel?.luminance<0.14&&fullSample.diagnostics.activePaint.gearBackgroundPixel?.luminance>0.55,
      'Full-quality day palette must settle before capture: '+JSON.stringify(fullSample.diagnostics.activePaint));
    fullLightingSamples.push(fullSample);
    await captureScreenshot('lyrics-page-1920x1080-'+theme+'-full-light');
    await browser('window.__lyricsCheckSetCurrentTime(3.5)');
    await waitForPaintStable('terminal-full-next-row-'+theme);
    const moved=await browser('(() => ({old:document.querySelector(".lyrics-line[data-line=\\"1\\"]")?.hasAttribute("data-terminal-receiver")??false,current:document.querySelector(".lyrics-line.is-active")?.dataset.line??null,currentReceiver:document.querySelector(".lyrics-line.is-active")?.hasAttribute("data-terminal-receiver")??false}))()');
    assert(!moved.old&&moved.current==='2'&&moved.currentReceiver,'Full-quality active row light must move and clear at '+theme+': '+JSON.stringify(moved));
    await browser('window.__lyricsCheckSetCurrentTime(0.5)');
    await waitForPaintStable('terminal-full-no-active-row-'+theme);
    const cleared=await browser('document.querySelector(".lyrics-line[data-line=\\"2\\"]")?.hasAttribute("data-terminal-receiver")??false');
    assert(cleared===false,'Full-quality inactive lyric rows must clear their receiver at '+theme+'.');
  }
  report.fullLightingSamples=fullLightingSamples;
  report.checks.fullTerminalLightingDayNightActiveAndInactive=true;
  await browser('window.__lyricsCheckSetTerminalLocal()');
  await waitForPaintStable('terminal-lighting-local-quality');
  await inspectViewport(1100, 720, 'day');
  report.checks.geometry = true;

  const initialState = await mockState();
  const initialResolveCount = initialState.requests.filter((item) => item.path === '/api/lyrics/resolve' && item.body.trackId === 'synthetic-track').length;
  assert(initialResolveCount === 1, 'The recognized initial track must trigger exactly one background resolve: ' + JSON.stringify(initialState.requests));
  await browser('window.__lyricsCheckRepeatUpdate(); window.__lyricsCheckRepeatUpdate(); window.__lyricsCheckRepeatUpdate();');
  await pause(120);
  const repeatedState = await mockState();
  assert(repeatedState.requests.filter((item) => item.path === '/api/lyrics/resolve' && item.body.trackId === 'synthetic-track').length === 1,
    'Repeated state/time updates for the same track must deduplicate automatic resolution.');
  report.checks.backgroundResolveAndSameTrackDedup = true;
  await browser('window.__lyricsCheckSetCurrentTime(2.5)');
  await pause(160);
  const activeReceiver=await browser('(() => {const row=document.querySelector(".lyrics-line.is-active"),button=row?.querySelector(".lyrics-line-button");return{index:row?.dataset.line??null,rowReceiver:row?.hasAttribute("data-terminal-receiver")??false,buttonReceiver:button?.hasAttribute("data-terminal-receiver")??false,rowShadow:row?getComputedStyle(row).boxShadow:null,buttonShadow:button?getComputedStyle(button).boxShadow:null}})()');
  assert(activeReceiver.index==='1'&&activeReceiver.rowReceiver&&!activeReceiver.buttonReceiver&&activeReceiver.rowShadow!=='none',
    'Terminal light must give a visible shadow to the active lyric row, not the lyric button: '+JSON.stringify(activeReceiver));
  await browser('window.__lyricsCheckSetCurrentTime(3.5)');
  await pause(160);
  const movedReceiver=await browser('(() => ({old:document.querySelector(".lyrics-line[data-line=\\"1\\"]")?.hasAttribute("data-terminal-receiver")??false,current:document.querySelector(".lyrics-line.is-active")?.dataset.line??null,currentReceiver:document.querySelector(".lyrics-line.is-active")?.hasAttribute("data-terminal-receiver")??false}))()');
  assert(!movedReceiver.old&&movedReceiver.current==='2'&&movedReceiver.currentReceiver,
    'Moving the active lyric must clear the old receiver and light only the new row: '+JSON.stringify(movedReceiver));
  await browser('window.__lyricsCheckSetCurrentTime(0.5)');
  await pause(160);
  const clearedReceiver=await browser('document.querySelector(".lyrics-line[data-line=\\"2\\"]")?.hasAttribute("data-terminal-receiver")??false');
  assert(clearedReceiver===false,'Leaving an active lyric must remove its terminal-light receiver state.');
  report.checks.activeTerminalLightFollowsAndClears = true;
  assert(!initialState.requests.some((item) => item.path === '/api/lyrics/search'),
    'A lyric search ran before the user requested it.');

  const dialogLayouts = [];
  for (const theme of ['day', 'night']) {
    await browser('(() => { const stage=document.querySelector("#stage"); stage.dataset.theme=' + JSON.stringify(theme) + '; window.__lyricsCheckTerminalLighting?.refresh(); return true; })()');
    await waitForPaintStable('dialog-theme-' + theme);
    await click('.lyrics-main-header [aria-label="歌词选项"]');
    await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden && !document.querySelector("#lyrics-search-panel").hidden', theme + ' options dialog opened');
    await waitForPaintStable('dialog-open-' + theme);
    const dialogLayout = await browser('(() => { const dialog=document.querySelector("#lyrics-options-dialog"), panel=document.querySelector(".lyrics-preference-dialog"), toolbar=document.querySelector(".lyrics-dialog-toolbar"), search=document.querySelector("#lyrics-search-panel"), settings=document.querySelector("#lyrics-track-settings"); const r=panel.getBoundingClientRect(); const style=s=>{const n=document.querySelector(s);if(!n)return null;const c=getComputedStyle(n);return{backgroundColor:c.backgroundColor,backgroundImage:c.backgroundImage,appearance:c.appearance,boxShadow:c.boxShadow,borderColor:c.borderColor,color:c.color}}; return {theme:document.querySelector("#stage").dataset.theme,hidden:dialog.hidden,panel:{width:r.width,height:r.height},searchTab:!!dialog.querySelector("#lyrics-options-search-tab"),settingsTab:!!dialog.querySelector("#lyrics-options-settings-tab"),importInsideToolbar:!!(toolbar&&toolbar.contains(dialog.querySelector(".lyrics-import-button"))),searchInsideDialog:dialog.contains(search),settingsInsideDialog:dialog.contains(settings),offsetsOutside:!!document.querySelector(".lyrics-right .lyrics-offset-section"),gearCount:document.querySelectorAll(".lyrics-main-header [aria-label=\\"歌词选项\\"]").length,computed:{inactiveTab:style("#lyrics-options-settings-tab"),import:style(".lyrics-dialog-toolbar .lyrics-import-button"),nativeSource:style("#lyrics-search-panel .lyrics-source-select"),customSource:style("#lyrics-search-panel .settings-select-trigger"),searchButton:style("#lyrics-search-panel .lyrics-primary-button")}}; })()');
    assert(!dialogLayout.hidden && dialogLayout.searchTab && dialogLayout.settingsTab && dialogLayout.importInsideToolbar
      && dialogLayout.searchInsideDialog && dialogLayout.settingsInsideDialog && !dialogLayout.offsetsOutside && dialogLayout.gearCount === 1,
      'The per-track dialog must contain the same search, import, and settings controls in ' + theme + ': ' + JSON.stringify(dialogLayout));
    await waitBrowser('document.querySelector("#lyrics-search-panel .settings-select-trigger")?.getBoundingClientRect().width > 0 && document.querySelector("#lyrics-page-content .settings-select-menu .settings-select-option")','production custom source selector populated');
    dialogLayout.searchControls=await browser('(() => { const rect=s=>{const n=document.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect();return{visible:!n.hidden&&getComputedStyle(n).display!=="none",width:r.width,height:r.height}};return{source:rect("#lyrics-search-panel .settings-select-trigger"),query:rect("#lyrics-search-panel .lyrics-search-fields input"),search:rect("#lyrics-search-panel .lyrics-primary-button"),import:rect(".lyrics-dialog-toolbar .lyrics-import-button")};})()');
    assert(Object.values(dialogLayout.searchControls).every(item=>item&&item.visible&&item.width>0&&item.height>0),
      'Search, source, and import controls must be laid out inside the dialog: '+JSON.stringify(dialogLayout.searchControls));
    await click('#lyrics-search-panel .settings-select-trigger');
    await waitBrowser('document.querySelector("#lyrics-page-content .settings-select-menu:not([hidden]) .settings-select-option")','custom source dropdown opened');
    await waitForPaintStable('custom-source-menu-' + theme);
    const menuLayout=await browser('(() => {const menu=document.querySelector("#lyrics-page-content .settings-select-menu:not([hidden])"),trigger=document.querySelector("#lyrics-search-panel .settings-select-trigger"),r=menu.getBoundingClientRect(),t=trigger.getBoundingClientRect();return{menu:{width:r.width,height:r.height,top:r.top,bottom:r.bottom},trigger:{width:t.width,height:t.height,expanded:trigger.getAttribute("aria-expanded")},options:menu.querySelectorAll(".settings-select-option").length,active:menu.querySelector(".settings-select-option.is-active")?.textContent.trim()??"",background:getComputedStyle(menu).backgroundColor,shadow:getComputedStyle(menu).boxShadow}})()');
    assert(menuLayout.trigger.width>0&&menuLayout.trigger.height>0&&menuLayout.trigger.expanded==='true'&&menuLayout.options>=2&&menuLayout.menu.width>0&&menuLayout.menu.height>0,
      'The production source-selector trigger and popover menu must be visible and sized: '+JSON.stringify(menuLayout));
    dialogLayout.menu=menuLayout;
    await captureScreenshot('lyrics-options-' + theme + '-source-menu');
    await click('#lyrics-search-panel .settings-select-trigger');
    await waitBrowser('document.querySelector("#lyrics-page-content .settings-select-menu[hidden]")','custom source dropdown closed');
    await click('#lyrics-options-settings-tab');
    await waitBrowser('!document.querySelector("#lyrics-track-settings").hidden && document.querySelector(".lyrics-offset-controls input")', theme + ' in-dialog offset controls');
    await waitForPaintStable('dialog-settings-' + theme);
    dialogLayout.settingsControls=await browser('(() => { const rect=s=>{const n=document.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect(),c=getComputedStyle(n);return{visible:!n.hidden&&c.display!=="none",width:r.width,height:r.height,backgroundColor:c.backgroundColor,appearance:c.appearance,boxShadow:c.boxShadow}};return{nativeSource:rect("#lyrics-track-settings .lyrics-source-select"),offset:rect(".lyrics-offset-controls input"),save:rect(".lyrics-offset-controls .lyrics-quiet-button"),reset:rect(".lyrics-offset-controls .lyrics-offset-nudge:last-child")};})()');
    const settingsControlsOk=dialogLayout.settingsControls.nativeSource?.visible&&dialogLayout.settingsControls.nativeSource.width>100&&dialogLayout.settingsControls.nativeSource.height>=38
      &&Object.entries(dialogLayout.settingsControls).filter(([key])=>key!=='nativeSource').every(([,item])=>item&&item.visible&&item.width>0&&item.height>0);
    assert(settingsControlsOk,
      'The intentional native per-track source select and offset controls must be fully sized inside settings: '+JSON.stringify(dialogLayout.settingsControls));
    await captureScreenshot('lyrics-options-' + theme + '-settings');
    await browser('document.querySelector("#lyrics-options-search-tab").focus()');
    browserWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'TAB' });
    browserWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'TAB' });
    const focusState = await inspectFocusVisible('#lyrics-options-settings-tab');
    assert(focusState.focusVisible
        && focusState.outline !== 'none' && Number.parseFloat(focusState.outlineWidth) >= 2,
      'The keyboard focus target must receive the production focus-visible ring in the ' + theme + ' dialog: ' + JSON.stringify(focusState));
    dialogLayouts.push(dialogLayout);
    await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden', theme + ' options dialog closed');
  }
  assert(Math.abs(dialogLayouts[0].panel.width - dialogLayouts[1].panel.width) < 1
      && Math.abs(dialogLayouts[0].panel.height - dialogLayouts[1].panel.height) < 1,
    'Day and night dialog control layouts must have matching geometry: ' + JSON.stringify(dialogLayouts));
  report.checks.dialogControlsAndFocusDayNight = true;

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

  await browser('window.__lyricsCheckSetTrack("synthetic-slow-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-slow-track'),'slow track resolve started');
  await browser('window.__lyricsCheckSetTrack("synthetic-fast-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-fast-track'),'replacement track resolve started');
  await waitMockState(state=>state.resolveResponses.some(item=>item.trackId==='synthetic-fast-track'),'replacement track resolve completed');
  await waitMockState(state=>state.resolveResponses.some(item=>item.trackId==='synthetic-slow-track'),'stale track resolve completed');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("synthetic-fast-track")','new track lyrics rendered after stale request completion');
  const staleText=await browser('document.querySelector(".lyrics-lines")?.textContent ?? ""');
  assert(staleText.includes('synthetic-fast-track')&&!staleText.includes('synthetic-slow-track'),'A late previous-track result must not replace the current track lyrics: '+staleText);
  report.checks.staleTrackResultRejected=true;

  await browser('window.__lyricsCheckSetTrack("synthetic-pending-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-pending-track'),'pending automatic resolution started');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden && !document.querySelector("#lyrics-search-panel").hidden','manual selection dialog opened while auto-resolution is pending');
  await click('#lyrics-search-panel .lyrics-primary-button');
  await waitBrowser('document.querySelector(".lyrics-candidate-card") !== null','manual candidate available during automatic resolution');
  await click('.lyrics-candidate-card button');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden && document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-pending-track")','manual selection displayed while automatic resolution is pending');
  await waitMockState(state=>state.resolveResponses.some(item=>item.trackId==='synthetic-pending-track'),'pending automatic result completed after manual selection');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-pending-track")','manual lyrics remain after the late automatic result');
  const manualRaceText=await browser('document.querySelector(".lyrics-lines")?.textContent ?? ""');
  assert(manualRaceText.includes('手动选择结果 synthetic-pending-track')&&!manualRaceText.includes('自动解析结果 synthetic-pending-track'),
    'A late automatic result must not replace the user-selected candidate: '+manualRaceText);
  report.checks.manualSelectionWinsAutomaticRace=true;

  await browser('window.__lyricsCheckSetTrack("synthetic-import-pending-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-import-pending-track'),'import-race automatic resolution started');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden','import dialog opened while auto-resolution is pending');
  await browser('(() => { const input=document.querySelector(".lyrics-import-button input"); const file=new File([Array.from({length:20},(_,index)=>`[00:${String(index+1).padStart(2,"0")}.00]${index===0?"手动导入结果 synthetic-import-pending-track":`导入歌词第 ${index+1} 行`}`).join("\\n")],"synthetic-manual.lrc",{type:"text/plain"}); const transfer=new DataTransfer(); transfer.items.add(file); Object.defineProperty(input,"files",{value:transfer.files,configurable:true}); input.dispatchEvent(new Event("change",{bubbles:true})); return true; })()');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/import'&&item.body.trackId==='synthetic-import-pending-track'),'manual synthetic LRC import submitted');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden && document.querySelector(".lyrics-lines")?.textContent.includes("手动导入结果 synthetic-import-pending-track")','imported lyrics displayed');
  await waitMockState(state=>state.resolveResponses.some(item=>item.trackId==='synthetic-import-pending-track'),'late automatic result after import completed');
  const importedRaceText=await browser('document.querySelector(".lyrics-lines")?.textContent ?? ""');
  assert(importedRaceText.includes('手动导入结果 synthetic-import-pending-track')&&!importedRaceText.includes('自动解析结果 synthetic-import-pending-track'),
    'A late automatic result must not replace imported lyrics: '+importedRaceText);
  report.checks.importCancelsAutomaticResult=true;

  await browser('window.__lyricsCheckSetCurrentTime(18)');
  await pause(700);
  let followState=await browser('(() => ({checked:document.querySelector(".lyrics-follow-control input")?.checked,scrollTop:document.querySelector(".lyrics-scroller")?.scrollTop}))()');
  assert(followState.checked===true&&followState.scrollTop>0,'Programmatic smooth-follow scrolling must finish without pausing follow: '+JSON.stringify(followState));
  const scrollPoint=await browser('(() => {const r=document.querySelector(".lyrics-scroller").getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()');
  browserWindow.webContents.sendInputEvent({type:'mouseWheel',x:scrollPoint.x,y:scrollPoint.y,deltaY:480,deltaX:0,canScroll:true});
  await pause(180);
  followState=await browser('(() => ({checked:document.querySelector(".lyrics-follow-control input")?.checked,scrollTop:document.querySelector(".lyrics-scroller")?.scrollTop}))()');
  assert(followState.checked===false&&followState.scrollTop>0,'A real wheel gesture should pause follow while scrolling lyrics: '+JSON.stringify(followState));
  report.checks.programmaticFollowAndWheelPause=true;

  await browser('window.__lyricsCheckSetTrack("synthetic-follow-reset-track")');
  await waitMockState(state=>state.resolveResponses.some(item=>item.trackId==='synthetic-follow-reset-track'),'follow reset track resolved');
  let followChecked=await browser('document.querySelector(".lyrics-follow-control input")?.checked');
  assert(followChecked===true,'Changing tracks must reset follow to enabled.');
  await browser('window.__lyricsCheckSetCurrentTime(18)');
  const resetScrollPoint=await browser('(() => {const r=document.querySelector(".lyrics-scroller").getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()');
  browserWindow.webContents.sendInputEvent({type:'mouseWheel',x:resetScrollPoint.x,y:resetScrollPoint.y,deltaY:480,deltaX:0,canScroll:true});
  await pause(150);
  followChecked=await browser('document.querySelector(".lyrics-follow-control input")?.checked');
  assert(followChecked===false,'The wheel gesture must pause follow before the page re-entry check.');
  await browser('window.__lyricsCheckSetVisible(false)');
  await browser('window.__lyricsCheckSetVisible(true)');
  followChecked=await browser('document.querySelector(".lyrics-follow-control input")?.checked');
  assert(followChecked===true,'Re-entering the lyrics page must reset follow to enabled.');
  report.checks.followResetsOnTrackAndPageEntry=true;

  await browser('window.__lyricsCheckSetTrack("synthetic-leave-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-leave-track'),'off-page automatic resolve started');
  await browser('window.__lyricsCheckSetVisible(false)');
  await waitMockState(state=>state.resolveResponses.some(item=>item.trackId==='synthetic-leave-track'),'off-page automatic resolve completed');
  await browser('window.__lyricsCheckSetVisible(true)');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("synthetic-leave-track")','off-page automatic lyrics loaded on re-entry');
  const leaveState=await mockState();
  assert(leaveState.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-leave-track').length===1,
    'Leaving and re-entering the lyrics page must not duplicate the current track automatic resolve.');
  report.checks.backgroundResolveContinuesOffPage=true;

  await browser('window.__lyricsCheckSetVisible(false)');
  await browser('window.__lyricsCheckSetTrack("synthetic-background-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-background-track'),'background-only track resolve started while page is hidden');
  await waitMockState(state=>state.resolveResponses.some(item=>item.trackId==='synthetic-background-track'),'background-only track resolve completed while page is hidden');
  await browser('window.__lyricsCheckSetVisible(true)');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("synthetic-background-track")','background-resolved lyrics shown after entering the page');
  const hiddenResolveState=await mockState();
  assert(hiddenResolveState.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-background-track').length===1,
    'A current-track change while away from the lyrics page must resolve once in the background.');
  report.checks.resolveWhilePageHidden=true;

  await browser('window.__lyricsCheckSetUnknownTrack("synthetic-metadata-track")');
  await pause(100);
  const unknownMetadataState=await mockState();
  const metadataRequestsBefore=unknownMetadataState.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-metadata-track').length;
  await browser('window.__lyricsCheckSetKnownTrack("synthetic-metadata-track")');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("synthetic-metadata-track")','same-track metadata refresh triggered automatic matching');
  const knownMetadataState=await mockState();
  const metadataRequestsAfter=knownMetadataState.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-metadata-track').length;
  assert(metadataRequestsAfter>metadataRequestsBefore,'New title/artist metadata on the same track id must allow automatic matching to retry.');
  report.checks.sameTrackMetadataRefreshResolves=true;

  await browser('window.__lyricsCheckSetTrack("synthetic-offset-track")');
  await waitMockState(state=>state.resolveResponses.some(item=>item.trackId==='synthetic-offset-track'),'offsetInText track resolved');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("偏移验证")','offsetInText lyrics rendered');
  await browser('window.__lyricsCheckSetCurrentTime(1.5)');
  const offsetCurrent=await browser('(() => ({active:document.querySelectorAll(".lyrics-line.is-active").length,offset:document.querySelector(".lyrics-lines")?.textContent.includes("偏移验证")}))()');
  assert(offsetCurrent.active===0&&offsetCurrent.offset,'offsetInText current-time matching must not add the stored user offset twice: '+JSON.stringify(offsetCurrent));
  await click('.lyrics-line-button');
  const seekPosition=await browser('window.__lyricsCheckSeek.at(-1)');
  assert(Math.abs(seekPosition-1.9)<0.01,'offsetInText line seeking must not subtract the user offset a second time: '+seekPosition);
  report.checks.offsetInTextCurrentTimeAndSeek=true;

  assert(report.externalNetworkRequests.length === 0,
    'The isolated check attempted an external network request: ' + JSON.stringify(report.externalNetworkRequests));
  report.checks.candidateSelectedSavedRenderedAndSearchPanelClosed = true;
  report.mockApiPaths = Array.from(new Set(knownMetadataState.requests.map((item) => item.path)));
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
