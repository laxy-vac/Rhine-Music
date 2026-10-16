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
const checkMode = process.env.RHINE_LYRICS_CHECK_MODE || 'full';
const report = {
  ok: false,
  mode: checkMode,
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

function hasExplicitNoLyricsNotice(value) {
  return String(value??'')==='无本地歌词，也暂无可用的云歌词。';
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

async function inspectFocusVisible(selector, expectedId) {
  const target = await browser('(() => {const node=document.activeElement;return{id:node?.id??null,tag:node?.tagName??null}})()');
  assert(target.id === expectedId, 'Keyboard focus must land on ' + expectedId + ': ' + JSON.stringify(target));
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

async function transportTitleSnapshot() {
  return browser(`(() => {
    const root=document.querySelector('#stage'),header=document.querySelector('#lyrics-check-header'),nav=document.querySelector('.music-topnav');
    const slot=document.querySelector('#lyrics-check-transport-title'),label=document.querySelector('#lyrics-check-transport-title-label'),anchor=document.querySelector('#lyrics-check-transport-anchor');
    const measure=label?.querySelector('.transport-title-measure'),reel=label?.querySelector('.transport-title-reel');
    const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const controls=nav?[...nav.children].flatMap(node=>node.matches('.minimal-transport')?[node,...node.querySelectorAll('button')]:[node]).map(node=>({name:node.id||node.dataset.action||node.classList[0]||node.tagName,rect:rect(node)})):[];
    const style=label?getComputedStyle(label):null,slotStyle=slot?getComputedStyle(slot):null,navStyle=nav?getComputedStyle(nav):null,scrollbarStyle=nav?getComputedStyle(nav,'::-webkit-scrollbar'):null;
    const horizontalScrollbarHeight=nav&&navStyle?Math.max(0,nav.offsetHeight-nav.clientHeight-(parseFloat(navStyle.borderTopWidth)||0)-(parseFloat(navStyle.borderBottomWidth)||0)):NaN;
    return {
      design:root?.dataset.design??null,theme:root?.dataset.theme??null,viewport:{width:innerWidth,height:innerHeight},
      cap:slot?slot.getBoundingClientRect().width:NaN,configuredCap:navStyle?.getPropertyValue('--song-cap').trim()??null,
      flexBasis:slotStyle?.flexBasis??null,maxWidth:slotStyle?.maxWidth??null,
      navOverflowX:navStyle?.overflowX??null,navScrollbarWidth:navStyle?.scrollbarWidth??null,navWebkitScrollbarDisplay:scrollbarStyle?.display??null,
      navPaddingRight:navStyle?parseFloat(navStyle.paddingRight):NaN,navMarginRight:navStyle?parseFloat(navStyle.marginRight):NaN,
      navScrollWidth:nav?.scrollWidth??0,navClientWidth:nav?.clientWidth??0,navScrollLeft:nav?.scrollLeft??0,horizontalScrollbarHeight,
      baseSize:style?parseFloat(style.getPropertyValue('--transport-title-base-size')):NaN,
      renderedSize:style?parseFloat(style.fontSize):NaN,
      fullTitle:slot?.getAttribute('aria-label')??null,titleTooltip:slot?.title??null,
      visible:slot?.classList.contains('visible')??false,disabled:slot?.disabled??true,ariaHidden:slot?.getAttribute('aria-hidden')??null,
      reelText:reel?.textContent??'',reelRect:rect(reel),measureWidth:measure?.getBoundingClientRect().width??0,labelRect:rect(label),
      slotRect:rect(slot),navRect:rect(nav),headerRect:rect(header),anchorRect:rect(anchor),controls,pageWidth:document.documentElement.scrollWidth,
    };
  })()`);
}

async function findTitleWithReducedFont(kind) {
  return browser(`(() => {
    const label=document.querySelector('#lyrics-check-transport-title-label'),measure=label?.querySelector('.transport-title-measure');
    if(!label||!measure)return null;
    const style=getComputedStyle(label),base=parseFloat(style.getPropertyValue('--transport-title-base-size'))||12,available=label.getBoundingClientRect().width;
    const context=document.createElement('canvas').getContext('2d');if(!context)return null;
    const width=(text,size)=>{context.font=style.fontStyle+' '+style.fontWeight+' '+size+'px '+style.fontFamily;return context.measureText(text).width+(parseFloat(style.letterSpacing)||0)*[...text].length;};
    const seed=${JSON.stringify(kind)}==='zh'?'中文歌曲标题':'LongEnglishSongTitle';
    for(let count=1;count<800;count++){
      const text=Array.from({length:count},(_,index)=>seed[index%seed.length]).join('');
      measure.textContent=text;
      const natural=measure.getBoundingClientRect().width;
      const atBase=Math.max(width(text,base),natural),atTen=Math.max(width(text,10),natural*10/base);
      let fittedSize=base;
      const fullWidth=size=>Math.max(width(text,size),natural*size/base);
      while(fittedSize>10&&fullWidth(fittedSize)>available+0.5)fittedSize=Math.max(10,Math.round((fittedSize-0.5)*2)/2);
      if(atBase>available+0.5&&fittedSize<base&&fullWidth(fittedSize)<=available+0.5)return{text,available,atBase,fittedSize,fittedWidth:fullWidth(fittedSize),atTen,base};
    }
    return null;
  })()`);
}

async function inspectTransportTitles() {
  const cases=[],failures=[],fitSkips=[];
  const check=(condition,label,details)=>{if(!condition)failures.push({label,details});};
  const sameControls=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((item,index)=>{
    const other=right[index];return item.name===other.name&&['left','top','width','height'].every(key=>Math.abs(item.rect[key]-other.rect[key])<0.5);
  });
  const viewports=[{width:1920,height:840,cap:240,base:12},{width:1280,height:720,cap:240,base:12},{width:900,height:720,cap:180,base:11},{width:440,height:720,cap:100,base:10}];
  for(const viewport of viewports) for(const design of ['rhine','archive']) for(const theme of ['day','night']){
    currentViewport={width:viewport.width,height:viewport.height};
    await resizeViewport(viewport.width,viewport.height);
    await browser('window.__lyricsCheckSetDesignTheme('+JSON.stringify(design)+','+JSON.stringify(theme)+')');
    await browser('window.__lyricsCheckUpdateTransportTitle("短曲",true)');
    await pause(100);
    const short=await transportTitleSnapshot();
    const effectiveCap=viewport.width>700&&viewport.width<=1300?Math.min(viewport.cap,70):viewport.cap;
    check(Math.abs(short.cap-effectiveCap)<0.75&&Math.abs(short.slotRect.width-effectiveCap)<0.75
        &&short.cap<=viewport.cap+0.75&&(effectiveCap===viewport.cap?short.maxWidth!=='70px':short.maxWidth==='70px'),
      'The production title slot must use its responsive cap and existing 70px medium-width budget',{viewport,design,theme,effectiveCap,short});
    check(Math.abs(short.baseSize-viewport.base)<0.25&&Math.abs(short.renderedSize-viewport.base)<0.25&&short.reelText==='短曲',
      'Short titles must keep the 12/11/10px production base size',{viewport,design,theme,short});
    const stableHeader={header:short.headerRect,nav:short.navRect,anchor:short.anchorRect,slotWidth:short.slotRect.width,controls:short.controls};
    if(viewport.width===1920){
      await waitForPaintStable('transport-title-'+design+'-'+theme+'-short');
      await captureScreenshot('transport-title-1920-'+design+'-'+theme+'-short');
    }

    if(viewport.base>10) for(const kind of ['zh','en']){
      const selected=await findTitleWithReducedFont(kind);
      if(!selected){fitSkips.push({viewport:viewport.width,design,theme,kind,reason:'No natural title length fits at a reduced size for this slot/baseline pair.'});continue;}
      await browser('window.__lyricsCheckUpdateTransportTitle('+JSON.stringify(selected.text)+',true)');
      await pause(280);
      const fitted=await transportTitleSnapshot();
      check(fitted.renderedSize>=10&&fitted.renderedSize<viewport.base&&Math.abs(fitted.renderedSize-selected.fittedSize)<0.25
          &&fitted.reelText===selected.text&&!fitted.reelText.endsWith('…')&&fitted.reelRect.width<=fitted.labelRect.width+0.5,
        'Mid-length '+kind+' title must use a reduced 10px-or-larger size and remain fully visible',{viewport,design,theme,selected,fitted});
      check(Math.abs(fitted.anchorRect.left-stableHeader.anchor.left)<0.5&&Math.abs(fitted.slotRect.width-stableHeader.slotWidth)<0.5,
        'Long title content must not move the following production header control',{stableHeader,fitted});
      check(sameControls(stableHeader.controls,fitted.controls),
        'Long title content must not move any production nav or playback control',{stableHeader:stableHeader.controls,fitted:fitted.controls});
      cases.push({viewport:viewport.width,design,theme,kind:'shrink-'+kind,baseSize:fitted.baseSize,renderedSize:fitted.renderedSize,reelText:fitted.reelText,
        anchorLeft:fitted.anchorRect.left,navLeft:fitted.navRect.left,slotWidth:fitted.slotRect.width,controls:fitted.controls});
    }

    const veryLong=(design==='rhine'?'極長曲名':'VeryLongEnglishTrackTitle').repeat(100);
    await browser('window.__lyricsCheckUpdateTransportTitle('+JSON.stringify(veryLong)+',true)');
    await pause(320);
    const truncated=await transportTitleSnapshot();
    check(Math.abs(truncated.renderedSize-10)<0.25&&truncated.reelText.endsWith('…')&&truncated.reelRect.width<=truncated.labelRect.width+0.5,
      'Very long title must truncate with an ellipsis at the 10px minimum',{viewport,design,theme,truncated});
    check(truncated.fullTitle===('定位歌曲：'+veryLong)&&truncated.titleTooltip===('定位歌曲：'+veryLong),
      'The complete title must remain available to assistive technology and the tooltip',{viewport,design,theme,truncated});
    check(Math.abs(truncated.anchorRect.left-stableHeader.anchor.left)<0.5&&Math.abs(truncated.navRect.left-stableHeader.nav.left)<0.5
        &&Math.abs(truncated.navRect.width-stableHeader.nav.width)<0.5&&Math.abs(truncated.slotRect.width-stableHeader.slotWidth)<0.5,
      'Short/long title content must not change header geometry',{stableHeader,truncated});
    check(sameControls(stableHeader.controls,truncated.controls),
      'Short/long title content must not move any production nav, clock, settings, play, or stop control',{stableHeader:stableHeader.controls,truncated:truncated.controls});

    if(viewport.width===1920){
      await waitForPaintStable('transport-title-'+design+'-'+theme+'-long');
      await captureScreenshot('transport-title-1920-'+design+'-'+theme+'-long');
    }

    await browser('window.__lyricsCheckUpdateTransportTitle('+JSON.stringify(veryLong)+',false)');
    await pause(100);
    const hidden=await transportTitleSnapshot();
    check(!hidden.visible&&hidden.disabled&&hidden.ariaHidden==='true'&&Math.abs(hidden.slotRect.width-stableHeader.slotWidth)<0.5
        &&Math.abs(hidden.anchorRect.left-stableHeader.anchor.left)<0.5,
      'Hiding the title must keep its responsive slot reserved and leave the header position fixed',{stableHeader,hidden});
    check(sameControls(stableHeader.controls,hidden.controls),
      'Hiding the title must keep every production nav and playback control fixed',{stableHeader:stableHeader.controls,hidden:hidden.controls});
    if(viewport.width>=701)check(hidden.pageWidth<=viewport.width,'Transport title must not create page overflow above the existing narrow overflow range',hidden);
    cases.push({viewport:viewport.width,design,theme,kind:'truncate',baseSize:truncated.baseSize,renderedSize:truncated.renderedSize,reelText:truncated.reelText,hiddenSlotWidth:hidden.slotRect.width,
      headerLeft:truncated.headerRect.left,navLeft:truncated.navRect.left,anchorLeft:truncated.anchorRect.left,slotWidth:truncated.slotRect.width,
      controls:truncated.controls,horizontalOverflow:hidden.pageWidth>viewport.width});
  }
  currentViewport={width:1100,height:720};
  await resizeViewport(1100,720);
  await browser('window.__lyricsCheckSetDesignTheme("rhine","day");window.__lyricsCheckUpdateTransportTitle("合成歌曲",true);window.__lyricsCheckTerminalLighting?.refresh()');
  await pause(180);
  report.transportTitleFixture={productionHeaderMarkup:true,productionNavigationControls:['Archive','EQ','歌词','信号','主题','搜索','在线','day/night','clock','settings','transport-title','play','stop'],archiveHeaderVisibilityForcedForSkinComparison:true};
  report.transportTitleCases=cases;
  report.transportTitleFailures=failures;
  report.transportTitleFitSkips=fitSkips;
  report.checks.transportTitleRealModuleResponsiveFitVisibilityAndTheme=failures.length===0;
}

async function inspectHeaderScrollbar() {
  const samples=[];
  const sameControls=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((item,index)=>{
    const other=right[index];return item.name===other.name&&['left','top','width','height'].every(key=>Math.abs(item.rect[key]-other.rect[key])<0.5);
  });
  const viewports=[{width:1920,height:840,overflowExpected:false},{width:1280,height:840,overflowExpected:true},{width:1100,height:840,overflowExpected:true}];
  for(const viewport of viewports)for(const theme of ['day','night']){
    currentViewport={width:viewport.width,height:viewport.height};
    await resizeViewport(viewport.width,viewport.height);
    await browser('(() => {const root=document.querySelector("#stage"),nav=document.querySelector(".music-topnav");root.dataset.design="rhine";root.dataset.theme='+JSON.stringify(theme)+';nav.scrollLeft=0;window.__lyricsCheckTerminalLighting?.refresh();window.__lyricsCheckUpdateTransportTitle("短曲",true);return true})()');
    await pause(240);
    await waitForPaintStable('header-scrollbar-'+viewport.width+'-'+theme+'-short');
    const short=await transportTitleSnapshot();
    assert(short.design==='rhine'&&short.theme===theme&&short.navOverflowX==='auto'
        &&short.navScrollbarWidth==='none'&&short.navWebkitScrollbarDisplay==='none'
        &&Math.abs(short.navPaddingRight-48)<0.5&&Math.abs(short.navMarginRight+48)<0.5
        &&short.horizontalScrollbarHeight<1,
      'Future '+theme+' navigation must hide the horizontal scrollbar while retaining its 48px light gutter: '+JSON.stringify({viewport,short}));
    assert((short.navScrollWidth>short.navClientWidth)===viewport.overflowExpected,
      'Future '+viewport.width+'px navigation overflow must match the expected full/scrollable header state: '+JSON.stringify({viewport,short}));
    await captureScreenshot('header-scrollbar-'+viewport.width+'-'+theme+'-short');

    const veryLong=('横向可达性标题 · '.repeat(48));
    await browser('window.__lyricsCheckUpdateTransportTitle('+JSON.stringify(veryLong)+',true)');
    await pause(420);
    await waitForPaintStable('header-scrollbar-'+viewport.width+'-'+theme+'-long');
    const long=await transportTitleSnapshot();
    assert(long.navScrollbarWidth==='none'&&long.navWebkitScrollbarDisplay==='none'&&long.horizontalScrollbarHeight<1
        &&long.reelText.endsWith('…')&&long.reelRect.width<=long.labelRect.width+0.5
        &&Math.abs(long.slotRect.width-short.slotRect.width)<0.5&&sameControls(short.controls,long.controls)
        &&Math.abs(long.navScrollWidth-short.navScrollWidth)<0.5&&Math.abs(long.navClientWidth-short.navClientWidth)<0.5,
      'Changing from short to long title must keep the scrollbar hidden and all Future header controls fixed: '+JSON.stringify({viewport,short,long}));
    await captureScreenshot('header-scrollbar-'+viewport.width+'-'+theme+'-long');

    const endState=await browser('(() => {const nav=document.querySelector(".music-topnav"),stop=document.querySelector("#stop-playback"),play=document.querySelector("#lyrics-check-transport-anchor"),r=nav.getBoundingClientRect(),port={left:r.left+nav.clientLeft,right:r.left+nav.clientLeft+nav.clientWidth};nav.scrollLeft=nav.scrollWidth;const s=stop.getBoundingClientRect(),p=play.getBoundingClientRect();return{scrollLeft:nav.scrollLeft,scrollWidth:nav.scrollWidth,clientWidth:nav.clientWidth,port,stop:{left:s.left,right:s.right},play:{left:p.left,right:p.right},stopVisible:s.left>=port.left-.5&&s.right<=port.right+.5,playVisible:p.left>=port.left-.5&&p.right<=port.right+.5,rightGutter:port.right-s.right,scrollbarWidth:getComputedStyle(nav).scrollbarWidth,webkitScrollbar:getComputedStyle(nav,"::-webkit-scrollbar").display,paddingRight:parseFloat(getComputedStyle(nav).paddingRight)}})()');
    assert(endState.stopVisible&&endState.playVisible&&endState.scrollbarWidth==='none'&&endState.webkitScrollbar==='none'
        &&Math.abs(endState.paddingRight-48)<0.5&&(!viewport.overflowExpected||endState.rightGutter>=40),
      'Scrolling to the far right must expose play/stop and keep the 48px soft-light gutter: '+JSON.stringify({viewport,endState}));
    await browser('document.querySelector(".music-topnav [data-action=\\"settings\\"]").focus()');
    await pause(60);
    const focusedSettings=await browser('(() => {const nav=document.querySelector(".music-topnav"),node=nav.querySelector("[data-action=settings]"),r=nav.getBoundingClientRect(),port={left:r.left+nav.clientLeft,right:r.left+nav.clientLeft+nav.clientWidth},b=node.getBoundingClientRect();return{active:document.activeElement===node,visible:b.left>=port.left-.5&&b.right<=port.right+.5,scrollLeft:nav.scrollLeft}})()');
    browserWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'TAB'});
    browserWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'TAB'});
    await pause(70);
    const focusedTitle=await browser('document.activeElement?.id??null');
    browserWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'TAB'});
    browserWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'TAB'});
    await pause(70);
    const focusedPlay=await browser('document.activeElement?.id??null');
    browserWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'TAB'});
    browserWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'TAB'});
    await pause(70);
    const focusedStop=await browser('document.activeElement?.id??null');
    const focusedState=await browser('(() => {const nav=document.querySelector(".music-topnav"),settings=nav.querySelector("[data-action=settings]"),stop=document.querySelector("#stop-playback"),r=nav.getBoundingClientRect(),port={left:r.left+nav.clientLeft,right:r.left+nav.clientLeft+nav.clientWidth},rect=node=>{const b=node.getBoundingClientRect();return{left:b.left,right:b.right}};const a=rect(settings),b=rect(stop);return{settingsVisible:a.left>=port.left-.5&&a.right<=port.right+.5,stopVisible:b.left>=port.left-.5&&b.right<=port.right+.5,scrollLeft:nav.scrollLeft,scrollbarWidth:getComputedStyle(nav).scrollbarWidth}})()');
    assert(focusedTitle==='lyrics-check-transport-title'&&focusedPlay==='lyrics-check-transport-anchor'&&focusedStop==='stop-playback'
        &&focusedSettings.active&&focusedSettings.visible&&focusedState.stopVisible&&focusedState.scrollbarWidth==='none',
      'Keyboard focus from Settings must reach title, Play, and Stop inside the scrollable header: '+JSON.stringify({viewport,focusedSettings,focusedTitle,focusedPlay,focusedStop,focusedState}));

    samples.push({viewport:viewport.width,theme,overflow:short.navScrollWidth>short.navClientWidth,
      scrollbar:{standard:short.navScrollbarWidth,webkit:short.navWebkitScrollbarDisplay,horizontalHeight:short.horizontalScrollbarHeight},
      gutter:{paddingRight:short.navPaddingRight,marginRight:short.navMarginRight,endAtScrollRight:endState.rightGutter},
      title:{shortSlotWidth:short.slotRect.width,longSlotWidth:long.slotRect.width,longRenderedSize:long.renderedSize,longText:long.reelText},
      keyboard:{focusedSettings:focusedSettings.active,focusedTitle,focusedPlay,focusedStop,settingsVisible:focusedSettings.visible,stopVisible:focusedState.stopVisible}});
  }
  report.headerScrollbarSamples=samples;
  report.checks.futureHeaderScrollbarHiddenAndOverflowKeyboardReachable=true;
}

async function inspectLyricsLocalFallbackAndRightLighting() {
  const trackId='synthetic-track';
  const splitShadowLayers=value=>{
    const text=String(value??'none'),layers=[];
    let depth=0,start=0;
    for(let index=0;index<text.length;index+=1){
      if(text[index]==='(')depth+=1;
      else if(text[index]===')')depth=Math.max(0,depth-1);
      else if(text[index]===','&&depth===0){layers.push(text.slice(start,index).trim());start=index+1;}
    }
    layers.push(text.slice(start).trim());
    return layers;
  };
  await browser(`(() => {const input=document.querySelector('#lyrics-local-panel input[type=file]');if(!input)throw new Error('Local file input missing');window.__lyricsCheckFilePickerCalls=0;input.addEventListener('click',event=>{event.preventDefault();window.__lyricsCheckFilePickerCalls++});return true})()`);
  let state=await mockState();
  let bank=state.banks.find(item=>item.trackId===trackId);
  assert(bank?.activeKind==='cloud'&&bank.variants.cloud&&!bank.variants.local,'The targeted Local-fallback run must begin with a Cloud document: '+JSON.stringify(bank));

  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected")==="true"','Cloud options opened for the synthetic cached lyric');
  const pickerBeforeLocal=await browser('window.__lyricsCheckFilePickerCalls');
  const resolveCount=state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===trackId).length;
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId===trackId&&item.body.kind==='local'),'Local preference activated over the cached Cloud document');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeLocal),'switching to Local did not open Import');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("第一句合成歌词")','cached Cloud lyric remains displayed as Local fallback');
  const fallbackVisual=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",localSelected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),cloudSelected:document.querySelector("#lyrics-options-cloud-tab")?.getAttribute("aria-selected"),localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===trackId);
  assert(bank?.activeKind==='local'&&bank.userSelected&&bank.effectiveKind==='cloud'&&bank.usingCloudFallback===true
      &&bank.variants.cloud&&!bank.variants.local&&fallbackVisual.lines.includes('第一句合成歌词')
      &&fallbackVisual.localSelected==='true'&&fallbackVisual.cloudSelected==='false'
      &&fallbackVisual.localMessage.includes('无本地歌词，使用云歌词')&&fallbackVisual.offsetDisabled
      &&fallbackVisual.pickerCalls===pickerBeforeLocal
      &&state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===trackId).length===resolveCount,
    'Local must show a read-only Cloud fallback, preserve active Local, and wait for an explicit Import click: '+JSON.stringify({bank,fallbackVisual}));
  await waitForPaintStable('lyrics-local-fallback-cloud-preview');
  await captureScreenshot('lyrics-local-fallback-cloud-preview');

  const localText='[00:01.00]目标曲目的本地歌词\n[00:03.00]本地歌词第二句';
  await click('#lyrics-local-panel .lyrics-import-button');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeLocal+1),'explicit Import click opened only the intercepted picker');
  await browser(`(async()=>{const input=document.querySelector('#lyrics-local-panel input[type=file]'),text=${JSON.stringify(localText)},file=new File([text],'synthetic-local-import.lrc',{type:'text/plain'}),transfer=new DataTransfer();window.__lyricsCheckOriginalLocalText=text;window.__lyricsCheckOriginalLocalFile=file;transfer.items.add(file);Object.defineProperty(input,'files',{value:transfer.files,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/import'&&item.body.trackId===trackId),'explicit local import request completed');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("目标曲目的本地歌词")','Local import replaced the Cloud fallback immediately');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===trackId);
  const importRequest=state.requests.filter(item=>item.path==='/api/lyrics/import'&&item.body.trackId===trackId).at(-1);
  const originalUnchanged=await browser('window.__lyricsCheckOriginalLocalFile.arrayBuffer().then(bytes=>new TextDecoder().decode(bytes)===window.__lyricsCheckOriginalLocalText)');
  const localImportVisual=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",localSelected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true}))()');
  assert(bank?.activeKind==='local'&&bank.effectiveKind==='local'&&bank.userSelected&&bank.variants.local&&bank.variants.cloud
      &&importRequest?.body?.lrc===localText&&!Object.keys(importRequest.body).some(key=>/path|filename/i.test(key))
      &&originalUnchanged&&localImportVisual.lines.includes('目标曲目的本地歌词')&&localImportVisual.localSelected==='true'
      &&!localImportVisual.offsetDisabled&&state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===trackId).length===resolveCount,
    'Manual Local import must replace only its bank, preserve the original File bytes, and avoid another resolve: '+JSON.stringify({bank,importRequest,originalUnchanged,localImportVisual}));
  await waitForPaintStable('lyrics-local-fallback-imported-local');
  await captureScreenshot('lyrics-local-fallback-imported-local');

  await browser('document.querySelector(".lyrics-offset-controls input").value="-0.5"');
  await click('.lyrics-offset-controls .lyrics-quiet-button');
  state=await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/offset'&&item.body.trackId===trackId&&item.body.kind==='local'&&item.body.offsetMs===-500)
      &&snapshot.bankDocuments?.find(item=>item.trackId===trackId)?.variants.local?.offsetMs===-500,
    'Local offset request completed and its document snapshot was updated');
  await waitBrowser('document.querySelector(".lyrics-offset-controls input")?.value==="-0.5"','Local offset input settled after the save response');
  bank=state.banks.find(item=>item.trackId===trackId);
  const bankDocuments=state.bankDocuments.find(item=>item.trackId===trackId);
  assert(bank?.activeKind==='local'&&bank.variants.local&&bank.variants.cloud
      &&bankDocuments?.variants.local.offsetMs===-500&&bankDocuments.variants.cloud.offsetMs===0,
    'A Local offset edit must update only the Local document while the public variants remain availability flags: '+JSON.stringify({bank,bankDocuments}));

  const searchRequestsBefore=(await mockState()).requests.filter(item=>item.path==='/api/lyrics/search'&&item.body.trackId===trackId).length;
  await click('#lyrics-options-cloud-tab');
  await waitMockState(snapshot=>snapshot.requests.filter(item=>item.path==='/api/lyrics/search'&&item.body.trackId===trackId).length>searchRequestsBefore
      &&snapshot.searchResponses.length===snapshot.requests.filter(item=>item.path==='/api/lyrics/search').length,'Cloud panel searched with the global default after Local import');
  await waitBrowser('document.querySelector(".lyrics-candidate-card button")!==null','Cloud search candidate available for Use-button lighting check');
  const cloudOffsetAvailable=await browser('(() => ({selected:document.querySelector("#lyrics-options-cloud-tab")?.getAttribute("aria-selected"),disabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,heading:document.querySelector(".lyrics-offset-section .lyrics-data-heading")?.textContent.trim()??""}))()');
  assert(cloudOffsetAvailable.selected==='true'&&!cloudOffsetAvailable.disabled&&cloudOffsetAvailable.heading.includes('云歌词'),
    'Cloud calibration must be editable only after selecting the Cloud panel: '+JSON.stringify(cloudOffsetAvailable));
  await waitBrowser('document.querySelector(".lyrics-offset-controls input")?.value==="0.0"','Cloud offset input settled after switching banks');
  const cloudSearchSource=(await mockState()).searchResponses.filter(item=>item.trackId===trackId).at(-1)?.sourceId;
  assert(cloudSearchSource==='netease','Cloud tab searches the global default source in this harness: '+String(cloudSearchSource));
  await browser('document.querySelector(".lyrics-offset-controls input").value="0.5"');
  await click('.lyrics-offset-controls .lyrics-quiet-button');
  state=await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/offset'&&item.body.trackId===trackId&&item.body.kind==='cloud'&&item.body.offsetMs===500)
      &&snapshot.bankDocuments?.find(item=>item.trackId===trackId)?.variants.cloud?.offsetMs===500,
    'Cloud offset request completed and its document snapshot was updated');
  await waitBrowser('document.querySelector(".lyrics-offset-controls input")?.value==="0.5"','Cloud offset input settled after the save response');
  bank=state.banks.find(item=>item.trackId===trackId);
  const offsetBankDocuments=state.bankDocuments.find(item=>item.trackId===trackId);
  assert(bank?.activeKind==='cloud'&&bank.variants.cloud&&bank.variants.local
      &&offsetBankDocuments?.variants.cloud.offsetMs===500&&offsetBankDocuments.variants.local.offsetMs===-500,
    'Cloud calibration must preserve the Local document offset while public variants remain availability flags: '+JSON.stringify({bank,offsetBankDocuments}));
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId===trackId&&item.body.kind==='local'),'Local bank reactivated after Cloud calibration');
  const restoredLocalOffset=await browser('(() => ({selected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),offset:document.querySelector(".lyrics-offset-controls input")?.value}))()');
  assert(restoredLocalOffset.selected==='true'&&restoredLocalOffset.offset==='-0.5',
    'Switching back to Local must restore its independent offset: '+JSON.stringify(restoredLocalOffset));
  const searchesBeforeCloudLighting=(await mockState()).requests.filter(item=>item.path==='/api/lyrics/search'&&item.body.trackId===trackId).length;
  await click('#lyrics-options-cloud-tab');
  await waitMockState(snapshot=>snapshot.requests.filter(item=>item.path==='/api/lyrics/search'&&item.body.trackId===trackId).length>searchesBeforeCloudLighting
      &&snapshot.searchResponses.length===snapshot.requests.filter(item=>item.path==='/api/lyrics/search').length,'Cloud panel re-entered its explicit search flow for right-control lighting');
  report.checks.localFallbackManualImportAndScopedOffsets=true;

  await browser('window.__lyricsCheckSetTerminalFull()');
  await waitForPaintStable('lyrics-right-buttons-full-light-ready');
  const controls=[
    {key:'manage',selector:'#lyrics-cloud-panel .lyrics-source-settings-link',label:'管理来源'},
    {key:'search',selector:'#lyrics-cloud-panel .lyrics-primary-button',label:'搜索'},
    {key:'use',selector:'.lyrics-candidate-card button',label:'使用'},
  ];
  const lightingSamples=[],idleLightSamples=[];
  for(const theme of ['day','night']){
    await browser('(() => {const root=document.querySelector("#stage");root.dataset.design="rhine";root.dataset.theme='+JSON.stringify(theme)+';window.__lyricsCheckTerminalLighting?.refresh();return true})()');
    await waitForPaintStable('lyrics-right-buttons-full-'+theme);
    await browser('document.activeElement?.blur();window.__lyricsCheckTerminalLighting?.refresh()');
    await pause(80);
    const idleControls=[];
    for(const control of controls){
      const selector=JSON.stringify(control.selector);
      const before=await browser(`(() => {const node=document.querySelector(${selector});if(!node)return null;const s=getComputedStyle(node),r=node.getBoundingClientRect(),pseudo=p=>{const q=getComputedStyle(node,p);return{content:q.content,display:q.display,opacity:q.opacity,background:q.backgroundColor,backgroundImage:q.backgroundImage,boxShadow:q.boxShadow,width:q.width,height:q.height,position:q.position}};return{width:r.width,height:r.height,borderRadius:s.borderRadius,border:s.border,background:s.backgroundColor,backgroundImage:s.backgroundImage,boxShadow:s.boxShadow,textDecoration:s.textDecorationLine,receiver:node.hasAttribute("data-terminal-receiver"),before:pseudo("::before"),after:pseudo("::after")}})()`);
      assert(before&&before.width>0&&before.height>0,'Missing right-panel '+control.label+' button before full-light hover: '+JSON.stringify({theme,control,before}));
      assert(!before.receiver&&before.boxShadow==='none'&&parseFloat(before.borderRadius)===10,
        'Idle Future '+control.label+' must have no terminal receiver shadow and keep its 10px radius: '+JSON.stringify({theme,control,before}));
      idleControls.push({key:control.key,width:before.width,height:before.height,borderRadius:before.borderRadius,receiver:before.receiver,boxShadow:before.boxShadow});
      const rect=await browser(`(() => {const r=document.querySelector(${selector}).getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
      browserWindow.webContents.sendInputEvent({type:'mouseMove',x:rect.x,y:rect.y});
      await browser('window.__lyricsCheckTerminalLighting?.refresh()');
      await waitForPaintStable('lyrics-right-button-'+theme+'-'+control.key);
      const after=await browser(`(() => {const node=document.querySelector(${selector});if(!node)return null;const s=getComputedStyle(node),r=node.getBoundingClientRect(),pseudo=p=>{const q=getComputedStyle(node,p);return{content:q.content,display:q.display,opacity:q.opacity,background:q.backgroundColor,backgroundImage:q.backgroundImage,boxShadow:q.boxShadow,width:q.width,height:q.height,position:q.position}};return{width:r.width,height:r.height,borderRadius:s.borderRadius,border:s.border,background:s.backgroundColor,backgroundImage:s.backgroundImage,boxShadow:s.boxShadow,textDecoration:s.textDecorationLine,receiver:node.hasAttribute("data-terminal-receiver"),focusVisible:node.matches(":focus-visible"),before:pseudo("::before"),after:pseudo("::after")}})()`);
      const hoverShadows=splitShadowLayers(after?.boxShadow);
      assert(after&&after.receiver&&Math.abs(after.width-before.width)<0.5&&Math.abs(after.height-before.height)<0.5
          &&after.borderRadius===before.borderRadius&&!after.textDecoration.includes('underline')
          &&hoverShadows.length>0&&hoverShadows.every(value=>value.includes('inset')),
        'Full terminal hover light must stay on the 10px button edge without an outer rectangular halo: '+JSON.stringify({theme,control,before,after}));
      await captureScreenshot('lyrics-local-fallback-right-'+theme+'-'+control.key+'-hover');
      browserWindow.webContents.sendInputEvent({type:'mouseMove',x:2,y:2});
      await browser(`document.querySelector(${selector}).focus()`);
      const debuggerApi=browserWindow.webContents.debugger;
      const attachedHere=!debuggerApi.isAttached();
      let focusNodeId=0;
      let focused;
      try{
        if(attachedHere)debuggerApi.attach();
        await debuggerApi.sendCommand('DOM.enable');
        await debuggerApi.sendCommand('CSS.enable');
        const {root}=await debuggerApi.sendCommand('DOM.getDocument');
        const queried=await debuggerApi.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:control.selector});
        focusNodeId=queried.nodeId;
        assert(focusNodeId>0,'Could not locate the focused '+control.label+' control for its focus-visible paint check.');
        await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId:focusNodeId,forcedPseudoClasses:['focus-visible']});
        await browser('window.__lyricsCheckTerminalLighting?.refresh()');
        await waitForPaintStable('lyrics-right-button-focus-'+theme+'-'+control.key);
        focused=await browser(`(() => {const node=document.querySelector(${selector});if(!node)return null;const s=getComputedStyle(node),r=node.getBoundingClientRect();return{width:r.width,height:r.height,borderRadius:s.borderRadius,boxShadow:s.boxShadow,textDecoration:s.textDecorationLine,receiver:node.hasAttribute("data-terminal-receiver"),focusVisible:node.matches(":focus-visible"),outline:s.outlineStyle,outlineWidth:s.outlineWidth}})()`);
        const focusShadows=splitShadowLayers(focused?.boxShadow);
        assert(focused&&focused.focusVisible&&focused.receiver&&Math.abs(focused.width-before.width)<0.5
            &&Math.abs(focused.height-before.height)<0.5&&focused.borderRadius===before.borderRadius
            &&focusShadows.length>0&&focusShadows.every(value=>value.includes('inset')),
          'Full terminal focus-visible light must stay on the '+control.label+' edge without an outer halo: '+JSON.stringify({theme,control,before,focused}));
        await captureScreenshot('lyrics-local-fallback-right-'+theme+'-'+control.key+'-focus');
      }finally{
        if(focusNodeId>0){try{await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId:focusNodeId,forcedPseudoClasses:[]});}catch{}}
        if(attachedHere&&debuggerApi.isAttached()){try{debuggerApi.detach();}catch{}}
      }
      lightingSamples.push({theme,...control,before,hover:after,focus:focused});
      await browser('document.activeElement?.blur();window.__lyricsCheckTerminalLighting?.refresh()');
      browserWindow.webContents.sendInputEvent({type:'mouseMove',x:2,y:2});
      await pause(80);
    }
    await waitForPaintStable('lyrics-right-buttons-idle-'+theme);
    const idleAfter=await browser('(() => [...document.querySelectorAll("#lyrics-cloud-panel .lyrics-source-settings-link,#lyrics-cloud-panel .lyrics-primary-button,.lyrics-candidate-card button")].map(node=>({text:node.textContent.trim(),receiver:node.hasAttribute("data-terminal-receiver"),boxShadow:getComputedStyle(node).boxShadow,borderRadius:getComputedStyle(node).borderRadius})) )()');
    assert(idleAfter.length>=3&&idleAfter.every(item=>!item.receiver&&item.boxShadow==='none'&&parseFloat(item.borderRadius)===10),
      'After focus/hover clears, right-panel controls must return to the idle rounded style: '+JSON.stringify({theme,idleAfter}));
    await captureScreenshot('lyrics-local-fallback-right-'+theme+'-idle');
    idleLightSamples.push({theme,controls:idleControls,after:idleAfter});
  }
  report.rightPanelControlLightingSamples=lightingSamples;
  report.rightPanelIdleControls=idleLightSamples;
  report.checks.rightPanelManageSearchUseSoftLightDayNight=true;

  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','close the options dialog before checking the backdrop light');
  await browser('window.__lyricsCheckSetDesignTheme("rhine","day");window.__lyricsCheckSetCurrentTime(2.5);window.__lyricsCheckSetTerminalFull();window.__lyricsCheckTerminalLighting?.refresh()');
  await waitForPaintStable('lyrics-fallback-backdrop-before-modal');
  const backdropBefore=await browser('(() => {const row=document.querySelector(".lyrics-line.is-active"),nav=document.querySelector(".music-topnav [data-action=library]");return{mode:document.querySelector("#stage").getAttribute("data-terminal-lighting"),row:row?.dataset.line??null,rowReceiver:row?.hasAttribute("data-terminal-receiver")??false,navReceiver:nav?.hasAttribute("data-terminal-receiver")??false,dialogHidden:document.querySelector("#lyrics-options-dialog").hidden}})()');
  assert(backdropBefore.mode==='full'&&backdropBefore.dialogHidden&&backdropBefore.row!==null&&backdropBefore.rowReceiver&&backdropBefore.navReceiver,
    'The full Future mode must light the active lyric and active topnav before the options modal opens: '+JSON.stringify(backdropBefore));
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden','open the options modal over the active lyric');
  await waitForPaintStable('lyrics-fallback-modal-backdrop-light');
  const backdropInModal=await browser('(() => {const row=document.querySelector(".lyrics-line.is-active"),nav=document.querySelector(".music-topnav [data-action=library]"),dialog=document.querySelector(".lyrics-preference-dialog");return{mode:document.querySelector("#stage").getAttribute("data-terminal-lighting"),rowReceiver:row?.hasAttribute("data-terminal-receiver")??false,navReceiver:nav?.hasAttribute("data-terminal-receiver")??false,dialogReceiver:dialog?.hasAttribute("data-terminal-receiver")??false}})()');
  assert(backdropInModal.mode==='full'&&!backdropInModal.rowReceiver&&!backdropInModal.navReceiver&&backdropInModal.dialogReceiver,
    'Opening the Future dialog must clear receivers from backdrop lyrics/topnav and light only the modal surface: '+JSON.stringify(backdropInModal));
  await captureScreenshot('lyrics-local-fallback-modal-backdrop-light');
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','close the options modal and restore backdrop lights');
  await waitForPaintStable('lyrics-fallback-backdrop-after-modal');
  const backdropAfter=await browser('(() => {const row=document.querySelector(".lyrics-line.is-active"),nav=document.querySelector(".music-topnav [data-action=library]"),dialog=document.querySelector(".lyrics-preference-dialog");return{mode:document.querySelector("#stage").getAttribute("data-terminal-lighting"),rowReceiver:row?.hasAttribute("data-terminal-receiver")??false,navReceiver:nav?.hasAttribute("data-terminal-receiver")??false,dialogReceiver:dialog?.hasAttribute("data-terminal-receiver")??false}})()');
  assert(backdropAfter.mode==='full'&&backdropAfter.rowReceiver&&backdropAfter.navReceiver&&!backdropAfter.dialogReceiver,
    'Closing the dialog must restore the active lyric and topnav receivers without changing the full light level: '+JSON.stringify(backdropAfter));
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden','reopen the Cloud dialog for terminal quality mode checks');

  const fullModeControls=await browser('(() => [...document.querySelectorAll("#lyrics-cloud-panel .lyrics-source-settings-link,#lyrics-cloud-panel .lyrics-primary-button,.lyrics-candidate-card button")].map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{width:r.width,height:r.height,borderRadius:s.borderRadius}}))()');
  await browser('window.__lyricsCheckSetTerminalLocal();window.__lyricsCheckTerminalLighting?.refresh()');
  await waitForPaintStable('lyrics-fallback-local-light-mode');
  const localModeControls=await browser('(() => ({mode:document.querySelector("#stage").getAttribute("data-terminal-lighting"),controls:[...document.querySelectorAll("#lyrics-cloud-panel .lyrics-source-settings-link,#lyrics-cloud-panel .lyrics-primary-button,.lyrics-candidate-card button")].map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{width:r.width,height:r.height,borderRadius:s.borderRadius,receiver:node.hasAttribute("data-terminal-receiver")}})}))()');
  assert(localModeControls.mode==='local'&&localModeControls.controls.length===fullModeControls.length
      &&localModeControls.controls.every((item,index)=>Math.abs(item.width-fullModeControls[index].width)<0.5&&Math.abs(item.height-fullModeControls[index].height)<0.5&&item.borderRadius===fullModeControls[index].borderRadius),
    'Local terminal-light quality must preserve all right-control geometry and skin: '+JSON.stringify({fullModeControls,localModeControls}));
  const manageSelector=JSON.stringify('#lyrics-cloud-panel .lyrics-source-settings-link');
  const managePoint=await browser(`(() => {const r=document.querySelector(${manageSelector}).getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  browserWindow.webContents.sendInputEvent({type:'mouseMove',x:managePoint.x,y:managePoint.y});
  await browser('window.__lyricsCheckTerminalLighting?.refresh()');
  await waitForPaintStable('lyrics-fallback-local-light-hover');
  const localHover=await browser(`(() => {const node=document.querySelector(${manageSelector}),r=node.getBoundingClientRect(),s=getComputedStyle(node);return{width:r.width,height:r.height,borderRadius:s.borderRadius,boxShadow:s.boxShadow,receiver:node.hasAttribute('data-terminal-receiver')}})()`);
  assert(localHover.receiver&&localHover.borderRadius==='10px'&&Math.abs(localHover.width-fullModeControls[0].width)<0.5&&Math.abs(localHover.height-fullModeControls[0].height)<0.5
      &&splitShadowLayers(localHover.boxShadow).every(value=>value.includes('inset')),
    'Local terminal-light hover must retain the rounded button and use only its inset edge: '+JSON.stringify(localHover));
  browserWindow.webContents.sendInputEvent({type:'mouseMove',x:2,y:2});
  await browser('window.__lyricsCheckSetTerminalOff();window.__lyricsCheckTerminalLighting?.refresh()');
  await waitForPaintStable('lyrics-fallback-off-light-mode');
  const offModeControls=await browser('(() => ({mode:document.querySelector("#stage").getAttribute("data-terminal-lighting"),controls:[...document.querySelectorAll("#lyrics-cloud-panel .lyrics-source-settings-link,#lyrics-cloud-panel .lyrics-primary-button,.lyrics-candidate-card button")].map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{width:r.width,height:r.height,borderRadius:s.borderRadius,receiver:node.hasAttribute("data-terminal-receiver")}})}))()');
  assert(offModeControls.mode==='off'&&offModeControls.controls.length===fullModeControls.length
      &&offModeControls.controls.every((item,index)=>Math.abs(item.width-fullModeControls[index].width)<0.5&&Math.abs(item.height-fullModeControls[index].height)<0.5&&item.borderRadius===fullModeControls[index].borderRadius&&!item.receiver),
    'Off terminal-light quality must clear receivers without changing right-control geometry or skin: '+JSON.stringify({fullModeControls,offModeControls}));
  const offManagePoint=await browser(`(() => {const r=document.querySelector(${manageSelector}).getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  browserWindow.webContents.sendInputEvent({type:'mouseMove',x:offManagePoint.x,y:offManagePoint.y});
  await browser('window.__lyricsCheckTerminalLighting?.refresh()');
  await waitForPaintStable('lyrics-fallback-off-light-hover');
  const offHover=await browser(`(() => {const node=document.querySelector(${manageSelector}),s=getComputedStyle(node);return{mode:document.querySelector("#stage").getAttribute("data-terminal-lighting"),radius:s.borderRadius,receiver:node.hasAttribute('data-terminal-receiver')}})()`);
  assert(offHover.mode==='off'&&offHover.radius==='10px'&&!offHover.receiver,
    'Off terminal-light quality must keep the Future control skin without adding a hover receiver: '+JSON.stringify(offHover));

  browserWindow.webContents.sendInputEvent({type:'mouseMove',x:2,y:2});
  await browser('window.__lyricsCheckSetTerminalFull();window.__lyricsCheckSetDesignTheme("archive","day");window.__lyricsCheckTerminalLighting?.refresh()');
  await waitForPaintStable('lyrics-fallback-archive-punk-light-mode');
  const punkIdle=await browser('(() => [...document.querySelectorAll("#lyrics-cloud-panel .lyrics-source-settings-link,#lyrics-cloud-panel .lyrics-primary-button,.lyrics-candidate-card button")].map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{width:r.width,height:r.height,borderRadius:s.borderRadius,receiver:node.hasAttribute("data-terminal-receiver"),textDecoration:s.textDecorationLine}}))()');
  assert(punkIdle.length===fullModeControls.length&&punkIdle.every(item=>parseFloat(item.borderRadius)===0&&!item.receiver&&!item.textDecoration.includes('underline')),
    'The Punk/archive control skin must stay square and unlit by Future terminal receivers: '+JSON.stringify(punkIdle));
  const punkManagePoint=await browser(`(() => {const r=document.querySelector(${manageSelector}).getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  browserWindow.webContents.sendInputEvent({type:'mouseMove',x:punkManagePoint.x,y:punkManagePoint.y});
  await browser('window.__lyricsCheckTerminalLighting?.refresh()');
  await waitForPaintStable('lyrics-fallback-archive-punk-hover');
  const punkHover=await browser(`(() => {const node=document.querySelector(${manageSelector}),s=getComputedStyle(node),r=node.getBoundingClientRect();return{width:r.width,height:r.height,borderRadius:s.borderRadius,receiver:node.hasAttribute('data-terminal-receiver'),textDecoration:s.textDecorationLine}})()`);
  assert(parseFloat(punkHover.borderRadius)===0&&!punkHover.receiver&&!punkHover.textDecoration.includes('underline')
      &&Math.abs(punkHover.width-punkIdle[0].width)<0.5&&Math.abs(punkHover.height-punkIdle[0].height)<0.5,
    'Punk/archive Manage Sources hover must keep its square, stable, non-link surface: '+JSON.stringify({punkIdle,punkHover}));
  await captureScreenshot('lyrics-local-fallback-punk-right-hover');
  browserWindow.webContents.sendInputEvent({type:'mouseMove',x:2,y:2});
  await browser('window.__lyricsCheckSetDesignTheme("rhine","day");window.__lyricsCheckSetTerminalFull();window.__lyricsCheckTerminalLighting?.refresh()');
  await waitForPaintStable('lyrics-fallback-return-future-full');
  report.backdropLightingSamples={before:backdropBefore,open:backdropInModal,after:backdropAfter};
  report.terminalQualityModeSamples={full:fullModeControls,local:localModeControls,localHover,off:offModeControls,offHover};
  report.punkControlSamples={idle:punkIdle,hover:punkHover};
  report.checks.modalClearsAndRestoresBackdropReceivers=true;
  report.checks.localOffLightModesKeepControlGeometry=true;
  report.checks.punkSkinUnaffectedByFutureTerminalLighting=true;

  const resolveCountBeforeCloudSelect=(await mockState()).requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===trackId).length;
  await click('.lyrics-candidate-card button');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-track")','user explicitly selected a Cloud candidate');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===trackId);
  assert(bank?.activeKind==='cloud'&&bank.effectiveKind==='cloud'&&bank.userSelected&&bank.variants.local&&bank.variants.cloud,
    'Explicit Cloud selection must remain authoritative when a Local bank exists: '+JSON.stringify(bank));
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','Cloud selection dialog closed before page re-entry check');
  await browser('window.__lyricsCheckSetVisible(false)');
  await browser('window.__lyricsCheckSetVisible(true)');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-track")','explicit Cloud lyric remained after page re-entry');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected")==="true"','reopening after re-entry keeps explicit Cloud active');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===trackId);
  assert(bank?.activeKind==='cloud'&&bank.userSelected&&state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===trackId).length===resolveCountBeforeCloudSelect,
    'Explicit Cloud must not switch back to Local or trigger automatic resolution after re-entry: '+JSON.stringify(bank));
  report.checks.explicitCloudDoesNotReturnToLocalAfterFallback=true;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','targeted local-fallback dialog closed');

  const autoFallbackTrack='synthetic-local-auto-fallback-track';
  await browser('window.__lyricsCheckSetUnknownTrack('+JSON.stringify(autoFallbackTrack)+')');
  await waitMockState(snapshot=>snapshot.resolveResponses.some(item=>item.trackId===autoFallbackTrack),'unknown metadata produced an initial no-Cloud Local-fallback state');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected")==="true"','empty Cloud bank opened before the Local fallback resolver check');
  const pickerBeforeAutoFallback=await browser('window.__lyricsCheckFilePickerCalls');
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId===autoFallbackTrack&&item.body.kind==='local'),'Local preference persisted before Cloud fallback resolution');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeAutoFallback),'selecting an empty Local bank did not open Import');
  const resolverStateBeforeMetadata=await mockState();
  const resolveResponsesBeforeMetadata=resolverStateBeforeMetadata.resolveResponses.filter(item=>item.trackId===autoFallbackTrack).length;
  const resolveRequestsBeforeMetadata=resolverStateBeforeMetadata.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===autoFallbackTrack).length;
  await browser('window.__lyricsCheckSetKnownTrack('+JSON.stringify(autoFallbackTrack)+')');
  state=await waitMockState(snapshot=>snapshot.resolveResponses.some(item=>item.trackId===autoFallbackTrack&&item.activeKind==='local'&&item.effectiveKind==='cloud')
      &&snapshot.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===autoFallbackTrack).length>resolveRequestsBeforeMetadata,
    'metadata refresh resolved Cloud while Local remained active');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes('+JSON.stringify(autoFallbackTrack)+')','Cloud fallback lyric rendered while Local remained selected');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===autoFallbackTrack);
  const autoFallbackVisual=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",localSelected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),cloudSelected:document.querySelector("#lyrics-options-cloud-tab")?.getAttribute("aria-selected"),offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  const autoFallbackResponse=state.resolveResponses.filter(item=>item.trackId===autoFallbackTrack).at(-1);
  assert(bank?.activeKind==='local'&&bank.userSelected&&bank.effectiveKind==='cloud'&&bank.usingCloudFallback===true
      &&bank.variants.cloud&&!bank.variants.local&&autoFallbackResponse?.activeKind==='local'&&autoFallbackResponse.effectiveKind==='cloud'
      &&autoFallbackVisual.lines.includes(autoFallbackTrack)&&autoFallbackVisual.localSelected==='true'&&autoFallbackVisual.cloudSelected==='false'
      &&autoFallbackVisual.localMessage.includes('无本地歌词，使用云歌词')&&autoFallbackVisual.offsetDisabled
      &&autoFallbackVisual.pickerCalls===pickerBeforeAutoFallback
      &&state.resolveResponses.filter(item=>item.trackId===autoFallbackTrack).length===resolveResponsesBeforeMetadata+1
      &&state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===autoFallbackTrack).length===resolveRequestsBeforeMetadata+1,
    'A Cloud resolution must appear as a read-only fallback without changing the selected Local bank: '+JSON.stringify({bank,autoFallbackResponse,autoFallbackVisual}));
  report.checks.emptyLocalAutomaticallyUsesCloudFallback=true;
  await browser('window.__lyricsCheckSetVisible(false)');
  await browser('window.__lyricsCheckSetVisible(true)');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes('+JSON.stringify(autoFallbackTrack)+')','Cloud fallback remains visible after page re-entry');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-local-tab").getAttribute("aria-selected")==="true"&&document.querySelector("#lyrics-cloud-panel").hidden','page re-entry and reopening retained the Local selection');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===autoFallbackTrack);
  assert(bank?.activeKind==='local'&&bank.userSelected&&bank.effectiveKind==='cloud'&&bank.usingCloudFallback===true
      &&state.resolveResponses.filter(item=>item.trackId===autoFallbackTrack).length===resolveResponsesBeforeMetadata+1
      &&state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===autoFallbackTrack).length===resolveRequestsBeforeMetadata+1,
    'Re-entry must preserve Local selection and avoid another resolver: '+JSON.stringify(bank));
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','automatic-fallback dialog closed before empty-result checks');

  const slowVariantTrack='synthetic-slow-variant-track';
  await browser('window.__lyricsCheckSetTrack('+JSON.stringify(slowVariantTrack)+')');
  await waitMockState(snapshot=>snapshot.resolveResponses.some(item=>item.trackId===slowVariantTrack),'slow-variant track Cloud cache resolved');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes('+JSON.stringify(slowVariantTrack)+')','Cloud lyrics loaded before the delayed Local activation');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected")==="true"','Cloud selected before delayed Local activation');
  const pickerBeforeSlowVariant=await browser('window.__lyricsCheckFilePickerCalls');
  const slowVariantBefore=await mockState();
  const slowVariantResolveCount=slowVariantBefore.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length;
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId===slowVariantTrack&&item.body.kind==='local'),'delayed Local activation request started');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeSlowVariant),'delayed Local activation did not open Import');
  await browser('window.__lyricsCheckSetVisible(false)');
  await browser('window.__lyricsCheckSetVisible(true)');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','page re-entered while the Local activation was pending');
  const slowVariantPending=await mockState();
  assert(!slowVariantPending.variantResponses.some(item=>item.trackId===slowVariantTrack)
      &&slowVariantPending.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length===slowVariantResolveCount,
    'A pending Local activation must survive pagehide without an early response or competing resolver: '+JSON.stringify(slowVariantPending.variantResponses.filter(item=>item.trackId===slowVariantTrack)));
  await waitMockState(snapshot=>snapshot.variantResponses.some(item=>item.trackId===slowVariantTrack&&item.kind==='local'),'delayed Local activation completed after re-entry');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes('+JSON.stringify(slowVariantTrack)+')','delayed Local selection displayed the Cloud fallback');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===slowVariantTrack);
  const slowVariantResponse=state.variantResponses.find(item=>item.trackId===slowVariantTrack&&item.kind==='local');
  const slowVariantVisual=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  assert(bank?.activeKind==='local'&&bank.userSelected&&bank.effectiveKind==='cloud'&&bank.usingCloudFallback===true
      &&bank.variants.cloud&&!bank.variants.local&&slowVariantResponse?.activeKind==='local'&&slowVariantResponse.effectiveKind==='cloud'
      &&slowVariantResponse.usingCloudFallback&&slowVariantResponse.selectionRevision===1&&slowVariantResponse.responseDestroyed===false&&!slowVariantResponse.requestAborted
      &&slowVariantVisual.lines.includes(slowVariantTrack)&&slowVariantVisual.localMessage.includes('无本地歌词，使用云歌词')&&slowVariantVisual.offsetDisabled
      &&slowVariantVisual.pickerCalls===pickerBeforeSlowVariant
      &&state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length===slowVariantResolveCount,
    'The delayed activation must retain Local while displaying Cloud as a read-only fallback, without a picker or second resolve: '+JSON.stringify({bank,slowVariantResponse,slowVariantVisual}));
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-local-tab").getAttribute("aria-selected")==="true"&&document.querySelector("#lyrics-cloud-panel").hidden','reopening after delayed activation retained Local');
  const slowReopen=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  assert(slowReopen.lines.includes(slowVariantTrack)&&slowReopen.localMessage.includes('无本地歌词，使用云歌词')&&slowReopen.offsetDisabled
      &&slowReopen.pickerCalls===pickerBeforeSlowVariant
      &&(await mockState()).requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length===slowVariantResolveCount,
    'Reopening after the delayed activation must not switch to Cloud or issue another resolve: '+JSON.stringify(slowReopen));
  report.checks.slowVariantSurvivesPagehideWithLocalFallback=true;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','delayed-activation dialog closed before remote-miss checks');

  const pickerBefore=await browser('window.__lyricsCheckFilePickerCalls');
  for(const emptyTrackId of ['synthetic-empty-local-track','synthetic-empty-fallback-track']){
    await browser('window.__lyricsCheckSetUnknownTrack('+JSON.stringify(emptyTrackId)+')');
    await waitMockState(snapshot=>snapshot.resolveResponses.some(item=>item.trackId===emptyTrackId),'empty remote track initial response received');
    await click('.lyrics-main-header [aria-label="歌词选项"]');
    await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden','empty remote Local fallback dialog opened');
    await click('#lyrics-options-local-tab');
    await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId===emptyTrackId&&item.body.kind==='local'),'empty remote track switched to Local without Import');
    const resolveBeforeKnown=(await mockState()).resolveResponses.filter(item=>item.trackId===emptyTrackId).length;
    await browser('window.__lyricsCheckSetKnownTrack('+JSON.stringify(emptyTrackId)+')');
    await waitMockState(snapshot=>snapshot.resolveResponses.filter(item=>item.trackId===emptyTrackId).length>resolveBeforeKnown,'empty remote track attempted Cloud resolution while Local remained active');
    const emptyState=await mockState();
    bank=emptyState.banks.find(item=>item.trackId===emptyTrackId);
    const emptyUi=await browser('(() => ({lineCount:document.querySelector(".lyrics-lines")?.childElementCount??-1,notice:document.querySelector(".lyrics-notice-text")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",localSelected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
    assert(bank?.activeKind==='local'&&bank.userSelected&&bank.effectiveKind===null&&!bank.variants.local&&!bank.variants.cloud
        &&emptyUi.lineCount===0&&hasExplicitNoLyricsNotice(emptyUi.notice)&&emptyUi.localMessage.includes('无本地歌词，使用云歌词')
        &&emptyUi.localSelected==='true'&&emptyUi.pickerCalls===pickerBefore,
      'A remote miss must leave Local selected with an explicit no-lyrics notice and no picker: '+JSON.stringify({bank,emptyUi}));
    await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','empty remote dialog closed');
  }

  assert(!(await mockState()).requests.some(item=>item.path==='/api/lyrics/preferences'),'The Local/Cloud picker flow must not issue per-track source preference requests.');
  report.checks.localFallbackFlowAndNoRemoteState=true;
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

function motionBands(value) {
  return Array.from({ length: 32 }, () => value);
}

async function setMotionSpectrum(bands, available = true) {
  return browser('window.__lyricsCheckSetSpectrumSnapshot(' + JSON.stringify(bands) + ',' + JSON.stringify(available) + ')');
}

async function readMotionSpectrum() {
  return browser('window.__lyricsCheckReadSpectrumLevels()');
}

async function readMotionProbe() {
  return browser('window.__lyricsCheckReadSpectrumProbe()');
}

async function readMotionRafProbe() {
  return browser('window.__lyricsCheckReadSpectrumRafProbe()');
}

let reducedMotionDebuggerAttachedHere = false;

function assertMotionLevels(levels, label) {
  assert(Array.isArray(levels) && levels.length === 32,
    label + ' must expose exactly 32 production spectrum bars: ' + JSON.stringify({ count: levels?.length }));
  assert(levels.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
    label + ' must keep each rendered level finite and within [0, 1]: ' + JSON.stringify(levels));
}

async function emulateReducedMotion(reduced) {
  const debuggerApi = browserWindow.webContents.debugger;
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach();
    reducedMotionDebuggerAttachedHere = true;
  }
  try {
    await debuggerApi.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
    });
    const matches = await browser('matchMedia("(prefers-reduced-motion: reduce)").matches');
    assert(matches === reduced, 'Electron did not apply the requested reduced-motion media preference: ' + JSON.stringify({ reduced, matches }));
  } finally {
    if (!reduced && reducedMotionDebuggerAttachedHere && debuggerApi.isAttached()) {
      debuggerApi.detach();
      reducedMotionDebuggerAttachedHere = false;
    }
  }
}

async function inspectSpectrumMotion() {
  assert(await browser('typeof window.__lyricsCheckSetSpectrumSnapshot === "function"'),
    'The spectrum-motion harness must provide a synthetic snapshot controller.');
  assert(await browser('typeof window.__lyricsCheckCaptureSpectrumFrames === "function"'),
    'The spectrum-motion harness must capture real requestAnimationFrame samples.');

  const transition = await browser('Array.from(document.querySelectorAll(".lyrics-spectrum-bar")).map(node=>({property:getComputedStyle(node).transitionProperty,duration:getComputedStyle(node).transitionDuration}))');
  assert(transition.length === 32 && transition.every((item) => item.property === 'none' || item.duration.split(',').every((value) => Number.parseFloat(value) === 0)),
    'Production spectrum bars must not apply a second CSS transition: ' + JSON.stringify(transition));
  report.spectrumMotion ??= {};
  report.spectrumMotion.transition = transition[0] ?? null;

  await browser('window.__lyricsCheckSetPlayback(true)');
  await setMotionSpectrum(motionBands(0.12));
  await pause(650);
  const baseline = await readMotionSpectrum();
  assertMotionLevels(baseline.levels, 'settled baseline');

  const probeBeforeAttack = await readMotionProbe();
  await setMotionSpectrum(motionBands(0.88));
  const attack = await browser('window.__lyricsCheckCaptureSpectrumFrames(160)');
  const probeAfterAttack = await readMotionProbe();
  const attackValues = attack.frames.map((frame) => frame.levels[0]);
  const attackDistinct = Array.from(new Set(attackValues.map((value) => Number(value).toFixed(4))));
  assert(attack.frames.length >= 6 && attackDistinct.length >= 3,
    'A stable synthetic snapshot must produce multiple distinct intermediate production DOM values across rAF samples: ' + JSON.stringify({ durationMs: attack.durationMs, frames: attack.frames.length, values: attackValues }));
  assert(probeAfterAttack.snapshotUpdates === probeBeforeAttack.snapshotUpdates + 1
      && probeAfterAttack.callbackCalls - probeBeforeAttack.callbackCalls >= 3,
    'Intermediate motion must come from repeated rAF reads of one unchanged snapshot: ' + JSON.stringify({ probeBeforeAttack, probeAfterAttack }));
  assert(attackValues.every((value, index) => index === 0 || value + 0.0001 >= attackValues[index - 1]),
    'Attack should rise monotonically for a constant target: ' + JSON.stringify(attackValues));
  assertMotionLevels(attack.frames.at(-1).levels, 'attack');

  const probeBeforeRelease = await readMotionProbe();
  await setMotionSpectrum(motionBands(0.12));
  await waitBrowser('window.__lyricsCheckReadSpectrumProbe().callbackCalls > ' + probeBeforeRelease.callbackCalls,
    'the low spectrum snapshot to be sampled', 1000);
  const release = await browser('window.__lyricsCheckCaptureSpectrumFrames(160)');
  const releaseValues = release.frames.map((frame) => frame.levels[0]);
  assert(releaseValues.every((value, index) => index === 0 || value <= releaseValues[index - 1] + 0.0001),
    'Release should fall monotonically for a constant low target: ' + JSON.stringify(releaseValues));
  const attackDistance = attackValues.at(-1) - attackValues[0];
  const releaseDistance = releaseValues[0] - releaseValues.at(-1);
  const attackRemaining = (0.88 - attackValues.at(-1)) / (0.88 - attackValues[0]);
  const releaseRemaining = (releaseValues.at(-1) - 0.12) / (releaseValues[0] - 0.12);
  const attackReleaseDurationDeltaMs = Math.abs(attack.durationMs - release.durationMs);
  assert(attackDistance > 0.2 && releaseDistance > 0
      && attackReleaseDurationDeltaMs <= 30
      && Number.isFinite(attackRemaining) && Number.isFinite(releaseRemaining)
      && attackRemaining < releaseRemaining * 0.5,
    'Attack must close a substantially larger fraction of its initial target gap than release in near-equal windows: ' + JSON.stringify({ attackDistance, releaseDistance, attackRemaining, releaseRemaining, attackDurationMs: attack.durationMs, releaseDurationMs: release.durationMs, attackValues, releaseValues }));
  report.spectrumMotion.attack = { durationMs: attack.durationMs, frames: attack.frames.length, distinctValues: attackDistinct.length, values: attackValues, remainingFraction: attackRemaining };
  report.spectrumMotion.release = { durationMs: release.durationMs, frames: release.frames.length, values: releaseValues, remainingFraction: releaseRemaining, attackDistance, releaseDistance, durationDeltaMs: attackReleaseDurationDeltaMs };

  const stillTargets = Array.from({ length: 32 }, (_, index) => index === 0 ? 0.37 : index === 2 ? 0.73 : index % 3 === 0 ? 0 : index % 3 === 1 ? 0.2 : 0.4);
  await setMotionSpectrum(stillTargets);
  const still = await browser('window.__lyricsCheckCaptureSpectrumFrames(2200)');
  const stillTail = still.frames.filter((frame) => frame.at >= still.durationMs - 220);
  const stillMonotonicBands = stillTargets.map((_target, band) => {
    const values = still.frames.map((frame) => frame.levels[band]);
    return values.every((value, index) => index === 0 || value >= values[index - 1] - 1e-9)
      || values.every((value, index) => index === 0 || value <= values[index - 1] + 1e-9);
  });
  const settledValues = stillTail.at(-1)?.levels ?? [];
  const stableTail = stillTail.length >= 8 && stillTargets.every((target, band) => {
    const expected = Number(target.toFixed(4));
    return stillTail.every((frame) => frame.levels[band] === expected);
  });
  assert(still.frames.length >= 80 && stillTail.length >= 8 && stillMonotonicBands.every(Boolean) && stableTail,
    'A constant input must converge monotonically, then remain fixed at the target across the final 220 ms, including zero-valued neighboring bands: ' + JSON.stringify({ durationMs: still.durationMs, frames: still.frames.length, tailFrames: stillTail.length, monotonicBandCount: stillMonotonicBands.filter(Boolean).length, settledValues: settledValues.slice(0, 4), expectedValues: stillTargets.slice(0, 4) }));
  assertMotionLevels(still.frames.at(-1).levels, 'settled multi-band input');
  report.spectrumMotion.stillInput = { durationMs: still.durationMs, frames: still.frames.length, tailFrames: stillTail.length, settledValues: settledValues.slice(0, 4), targets: stillTargets.slice(0, 4) };

  await browser('window.__lyricsCheckSetSpectrumSnapshot(Array.from({length:32},(_,index)=>index===0?-8:index===1?8:index===2?Number.NaN:index===3?Number.POSITIVE_INFINITY:0.42),true)');
  await pause(220);
  const bounded = await readMotionSpectrum();
  assertMotionLevels(bounded.levels, 'NaN and out-of-range input');
  report.spectrumMotion.bounds = { count: bounded.count, minimum: Math.min(...bounded.levels), maximum: Math.max(...bounded.levels), invalidInputs: [-8, 8, 'NaN', 'Infinity'] };

  await setMotionSpectrum(motionBands(0.92));
  await pause(480);
  const beforePause = await readMotionSpectrum();
  assert(Math.max(...beforePause.levels) > 0.8, 'The active synthetic snapshot should raise the bars before pause decay.');
  await browser('window.__lyricsCheckSetPlayback(false)');
  await browser('window.__lyricsCheckSetSpectrumSnapshot(Array.from({length:32},()=>0.92),false,"paused")');
  await pause(1700);
  const afterPause = await readMotionSpectrum();
  assert(Math.max(...afterPause.levels) <= 0.01,
    'Pausing playback must let the spectrum envelope decay naturally to zero: ' + JSON.stringify(afterPause.levels));

  await browser('window.__lyricsCheckSetPlayback(true)');
  await setMotionSpectrum(motionBands(0.84));
  await pause(480);
  const beforeUnavailable = await readMotionSpectrum();
  await setMotionSpectrum(motionBands(0.84), false);
  await pause(1700);
  const afterUnavailable = await readMotionSpectrum();
  assert(Math.max(...beforeUnavailable.levels) > 0.7 && Math.max(...afterUnavailable.levels) <= 0.01,
    'Unavailable spectrum must decay its previous peak naturally to zero: ' + JSON.stringify({ before: beforeUnavailable.levels, after: afterUnavailable.levels }));
  report.spectrumMotion.decay = { pausedPeak: Math.max(...beforePause.levels), pausedFinal: Math.max(...afterPause.levels), unavailablePeak: Math.max(...beforeUnavailable.levels), unavailableFinal: Math.max(...afterUnavailable.levels) };

  await setMotionSpectrum(motionBands(0.94));
  await pause(600);
  const previousTrackPeak = Math.max(...(await readMotionSpectrum()).levels);
  await setMotionSpectrum(motionBands(0.08));
  await browser('window.__lyricsCheckSetTrack("synthetic-spectrum-next-track")');
  const trackChangeFrames = await browser('window.__lyricsCheckCaptureSpectrumFrames(90)');
  const firstTrackChangePeak = Math.max(...trackChangeFrames.frames[0].levels);
  assert(previousTrackPeak > 0.85 && firstTrackChangePeak < previousTrackPeak * 0.45,
    'Changing tracks must clear the old peak before the new track envelope builds: ' + JSON.stringify({ previousTrackPeak, firstTrackChangePeak, firstFrame: trackChangeFrames.frames[0] }));
  report.spectrumMotion.trackChange = { previousTrackPeak, firstTrackChangePeak, frames: trackChangeFrames.frames.length };

  const themeLayouts = [];
  for (const design of [{ skin: 'future', key: 'rhine' }, { skin: 'punk', key: 'archive' }]) {
    for (const theme of ['day', 'night']) {
      await browser('window.__lyricsCheckSetDesignTheme(' + JSON.stringify(design.key) + ',' + JSON.stringify(theme) + ')');
      const label = 'lyrics-spectrum-' + design.skin + '-' + theme;
      const paint = await waitForPaintStable(label);
      assert(paint.paintWait?.stabilized === true,
        'The offscreen renderer must paint the requested skin/theme before layout sampling: ' + JSON.stringify({ design, theme, paint: paint.paintWait }));
      const layout = await browser('(() => {const stage=document.querySelector("#stage"),style=getComputedStyle(stage),side=document.querySelector(".lyrics-left"),main=document.querySelector(".lyrics-main"),right=document.querySelector(".lyrics-right"),host=document.querySelector(".lyrics-spectrum-bars"),bars=Array.from(host?.children??[]),r=node=>{const x=node?.getBoundingClientRect();return x?{left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height}:null;},s=r(side),m=r(main),q=r(right),b=r(host),pressed=Array.from(document.querySelectorAll(".theme-switch [data-theme]")).find(button=>button.dataset.theme===stage.dataset.theme)?.getAttribute("aria-pressed");return{design:stage.dataset.design,theme:stage.dataset.theme,pageBg:style.getPropertyValue("--page-bg").trim().toLowerCase(),stageBackground:style.backgroundColor,stageColor:style.color,themePressed:pressed,count:bars.length,side:s,main:m,right:q,bars:b,barsInside:!!(s&&b&&b.left>=s.left-1&&b.right<=s.right+1&&b.top>=s.top-1&&b.bottom<=s.bottom+1),threeColumns:!!(s&&m&&q&&s.right<=m.left+1&&m.right<=q.left+1),noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth};})()');
      layout.skin = design.skin;
      const expectedPageBackground = theme === 'night' ? 'rgb(8, 18, 31)' : 'rgb(232, 229, 225)';
      const expectedStageBackground = theme === 'night' ? 'rgb(8, 18, 31)' : 'rgb(232, 229, 225)';
      assert(layout.design === design.key && layout.theme === theme && layout.pageBg === expectedPageBackground
          && layout.stageBackground === expectedStageBackground && layout.themePressed === 'true'
          && layout.count === 32 && layout.barsInside && layout.threeColumns && layout.noHorizontalOverflow,
        'The requested production skin must paint the correct day/night colors and preserve the lyrics layout: ' + JSON.stringify({ expectedPageBackground, expectedStageBackground, layout }));
      layout.paintWait = paint.paintWait;
      themeLayouts.push(layout);
      await captureScreenshot(label);
    }
  }
  report.spectrumMotion.themeLayouts = themeLayouts;

  await browser('window.__lyricsCheckSetDesignTheme("rhine","day")');
  await setMotionSpectrum(motionBands(0.2));
  await pause(650);
  await emulateReducedMotion(true);
  await setMotionSpectrum(motionBands(0.85));
  const reduced = await browser('window.__lyricsCheckCaptureSpectrumFrames(260)');
  const reducedValues = reduced.frames.map((frame) => frame.levels[0]);
  const reducedDistinct = Array.from(new Set(reducedValues.map((value) => Number(value).toFixed(4))));
  assert(Math.abs(reducedValues.at(-1) - 0.85) <= 0.001 && reducedDistinct.length <= 2
      && reducedValues.every((value) => Math.abs(value - 0.2) <= 0.001 || Math.abs(value - 0.85) <= 0.001),
    'Reduced motion must follow the sampled value directly without interpolation: ' + JSON.stringify({ durationMs: reduced.durationMs, reducedValues, reducedDistinct }));
  await emulateReducedMotion(false);
  report.spectrumMotion.reducedMotion = { frames: reduced.frames.length, values: reducedValues, distinctValues: reducedDistinct.length };

  await browser('window.__lyricsCheckSetDocumentHidden(false)');
  await setMotionSpectrum(motionBands(0.66));
  await browser('window.__lyricsCheckSetVisible(true)');
  await pause(150);
  const beforeHide = await readMotionProbe();
  const beforeHideRaf = await readMotionRafProbe();
  await browser('window.__lyricsCheckSetVisible(false)');
  await pause(200);
  const afterHide = await readMotionProbe();
  const afterHideRaf = await readMotionRafProbe();
  await pause(140);
  const stableHidden = await readMotionProbe();
  const stableHiddenRaf = await readMotionRafProbe();
  const hiddenLevels = await readMotionSpectrum();
  assert(afterHide.callbackCalls === stableHidden.callbackCalls
      && stableHidden.callbackCalls <= beforeHide.callbackCalls + 1
      && afterHideRaf.pending === 0 && stableHiddenRaf.pending === 0
      && afterHideRaf.invoked === stableHiddenRaf.invoked
      && afterHideRaf.scheduled === stableHiddenRaf.scheduled
      && Math.max(...hiddenLevels.levels) === 0,
    'Leaving the lyrics page must cancel the production rAF loop and clear all old levels: ' + JSON.stringify({ beforeHide, afterHide, stableHidden, beforeHideRaf, afterHideRaf, stableHiddenRaf, hiddenLevels }));
  await browser('window.__lyricsCheckSetVisible(true)');
  await pause(170);
  const afterReentry = await readMotionProbe();
  const afterReentryRaf = await readMotionRafProbe();
  const reentryFrameDelta = afterReentryRaf.invoked - stableHiddenRaf.invoked;
  assert(afterReentry.callbackCalls > stableHidden.callbackCalls
      && reentryFrameDelta >= 6 && reentryFrameDelta <= 15 && afterReentryRaf.pending === 1,
    'Re-entering must restart exactly one production rAF loop: ' + JSON.stringify({ stableHidden, afterReentry, stableHiddenRaf, afterReentryRaf, reentryFrameDelta }));
  await browser('window.__lyricsCheckSetDocumentHidden(true)');
  await pause(200);
  const afterDocumentHidden = await readMotionProbe();
  const afterDocumentHiddenRaf = await readMotionRafProbe();
  await pause(140);
  const stableDocumentHidden = await readMotionProbe();
  const stableDocumentHiddenRaf = await readMotionRafProbe();
  assert(afterDocumentHidden.callbackCalls === stableDocumentHidden.callbackCalls
      && afterDocumentHiddenRaf.pending === 0 && stableDocumentHiddenRaf.pending === 0
      && afterDocumentHiddenRaf.invoked === stableDocumentHiddenRaf.invoked
      && afterDocumentHiddenRaf.scheduled === stableDocumentHiddenRaf.scheduled,
    'A hidden document must cancel the production spectrum loop: ' + JSON.stringify({ afterDocumentHidden, stableDocumentHidden, afterDocumentHiddenRaf, stableDocumentHiddenRaf }));
  await browser('window.__lyricsCheckSetDocumentHidden(false)');
  await pause(170);
  const afterDocumentVisible = await readMotionProbe();
  const afterDocumentVisibleRaf = await readMotionRafProbe();
  const documentVisibleFrameDelta = afterDocumentVisibleRaf.invoked - stableDocumentHiddenRaf.invoked;
  assert(afterDocumentVisible.callbackCalls > stableDocumentHidden.callbackCalls
      && documentVisibleFrameDelta >= 6 && documentVisibleFrameDelta <= 15 && afterDocumentVisibleRaf.pending === 1,
    'A visible document must restart exactly one production spectrum loop: ' + JSON.stringify({ stableDocumentHidden, afterDocumentVisible, stableDocumentHiddenRaf, afterDocumentVisibleRaf, documentVisibleFrameDelta }));
  report.spectrumMotion.visibility = { beforeHide, afterHide, stableHidden, beforeHideRaf, afterHideRaf, stableHiddenRaf, afterReentry, afterReentryRaf, afterDocumentHidden, afterDocumentHiddenRaf, stableDocumentHidden, stableDocumentHiddenRaf, afterDocumentVisible, afterDocumentVisibleRaf };

  const nativeDemand = await browser('window.__lyricsCheckProbeNativeDemand()');
  const expectedNativePhases = { noDemand: 250, lyricsVisible: 100, signalKeepsDemand: 100, allDemandReleased: 250, reentered: 100, documentHidden: 250, documentVisible: 100, pageHidden: 250, destroyed: 250 };
  assert(Object.entries(expectedNativePhases).every(([key, value]) => nativeDemand.phases[key] === value),
    'The real NativeAudio poll must switch 250→100→250 ms with lyrics visibility, document visibility, signal owner coexistence, and destroy cleanup: ' + JSON.stringify(nativeDemand));
  assert(nativeDemand.nativeRequests.length === 3
      && nativeDemand.nativeRequests.every((item) => item.url.startsWith('/api/native/'))
      && !nativeDemand.nativeRequests.some((item) => item.url.includes('status')),
    'NativeAudio probing must mock all native API calls and never reach a real device or host: ' + JSON.stringify(nativeDemand.nativeRequests));
  await pause(220);
  const afterDestroy = await readMotionProbe();
  const afterDestroyRaf = await readMotionRafProbe();
  assert(afterDestroy.callbackCalls === nativeDemand.callbackCalls
      && nativeDemand.rafAfterDestroy.pending === 0
      && afterDestroyRaf.pending === 0
      && afterDestroyRaf.invoked === nativeDemand.rafAfterDestroy.invoked
      && afterDestroyRaf.scheduled === nativeDemand.rafAfterDestroy.scheduled,
    'Destroy must cancel the production rAF loop and leave no repeated callbacks: ' + JSON.stringify({ nativeDemand, afterDestroy, afterDestroyRaf }));
  report.spectrumMotion.nativeDemand = nativeDemand;
  report.spectrumMotion.afterDestroy = afterDestroy;
  report.spectrumMotion.afterDestroyRaf = afterDestroyRaf;
  report.checks = {
    ...report.checks,
    spectrumMotionFramesWithinSnapshot: true,
    spectrumAttackReleaseAndConvergence: true,
    spectrumBoundsAndDecay: true,
    spectrumTrackChangeClearsPeak: true,
    spectrumReducedMotion: true,
    spectrumVisibilityAndDestroyLifecycle: true,
    nativeSpectrumDemandCadenceAndMocking: true,
    futurePunkDayNightLayout: true,
  };
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
    && state.requests.some((item) => item.path === '/api/lyrics/resolve' && item.body.trackId === 'synthetic-track'), 'synthetic global settings, cache, and automatic-resolution requests');
  await browser('window.__lyricsCheckSyncSelects()');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("第一句合成歌词")', 'automatically resolved synthetic lyrics rendered');

  assert(!browserWindow.isVisible(), 'The isolated test BrowserWindow must stay hidden.');
  report.checks.hiddenElectronWindow = true;

  if (checkMode === 'spectrum-motion') {
    await inspectSpectrumMotion();
    assert(report.externalNetworkRequests.length === 0,
      'The isolated spectrum-motion check attempted an external network request: ' + JSON.stringify(report.externalNetworkRequests));
    const motionState = await mockState();
    report.mockApiPaths = Array.from(new Set(motionState.requests.map((item) => item.path)));
    report.checks.spectrumMotionModeOnly = true;
    report.checks.externalNetworkBlocked = true;
    report.ok = true;
    return;
  }

  if(checkMode==='header-scrollbar'){
    await inspectHeaderScrollbar();
    assert(report.externalNetworkRequests.length===0,'The isolated header-scrollbar check attempted an external network request: '+JSON.stringify(report.externalNetworkRequests));
    const headerState=await mockState();
    report.mockApiPaths=Array.from(new Set(headerState.requests.map(item=>item.path)));
    report.checks.headerScrollbarModeOnly=true;
    report.ok=true;
    return;
  }
  if(checkMode==='lyrics-local-fallback'){
    await inspectLyricsLocalFallbackAndRightLighting();
    assert(report.externalNetworkRequests.length===0,'The isolated Local-fallback check attempted an external network request: '+JSON.stringify(report.externalNetworkRequests));
    const fallbackState=await mockState();
    report.mockApiPaths=Array.from(new Set(fallbackState.requests.map(item=>item.path)));
    report.checks.lyricsLocalFallbackModeOnly=true;
    report.ok=true;
    return;
  }

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
  await inspectTransportTitles();

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
  const startupState=await mockState();
  assert(!startupState.requests.some((item) => item.path === '/api/lyrics/search'),
    'A lyric search ran before the user requested it.');
  report.checks.noSearchBeforeExplicitCloudEntry=true;

  const dialogLayouts = [];
  await browser(`(() => {const input=document.querySelector('#lyrics-local-panel input[type=file]');if(!input)throw new Error('Local file input missing');window.__lyricsCheckFilePickerCalls=0;input.addEventListener('click',event=>{event.preventDefault();window.__lyricsCheckFilePickerCalls++});return true})()`);
  for (const design of ['rhine', 'archive']) for (const theme of ['day', 'night']) {
    await browser('(() => { const stage=document.querySelector("#stage"); stage.dataset.design=' + JSON.stringify(design) + ';stage.dataset.theme=' + JSON.stringify(theme) + '; window.__lyricsCheckTerminalLighting?.refresh(); return true; })()');
    await waitForPaintStable('dialog-theme-' + design + '-' + theme);
    const searchesBefore = (await mockState()).requests.filter(item => item.path === '/api/lyrics/search').length;
    await click('.lyrics-main-header [aria-label="歌词选项"]');
    await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden && !document.querySelector("#lyrics-cloud-panel").hidden', theme + ' cloud dialog opened for the active cloud lyric');
    await waitForPaintStable('dialog-open-' + theme);
    await waitBrowser('document.querySelector("#lyrics-cloud-panel .settings-select-trigger")?.getBoundingClientRect().width > 0 && document.querySelector("#lyrics-page-content .settings-select-menu .settings-select-option")','production cloud source selector populated');
    await waitBrowser('document.querySelector("#lyrics-cloud-panel .lyrics-source-select")?.value==="netease"','global default provider applied to Cloud source selector');
    const dialogLayout = await browser(`(() => {
      const dialog=document.querySelector('#lyrics-options-dialog'),panel=document.querySelector('.lyrics-preference-dialog');
      const localTab=document.querySelector('#lyrics-options-local-tab'),cloudTab=document.querySelector('#lyrics-options-cloud-tab');
      const localPanel=document.querySelector('#lyrics-local-panel'),cloudPanel=document.querySelector('#lyrics-cloud-panel');
      const offset=document.querySelector('.lyrics-offset-section'),source=document.querySelector('#lyrics-cloud-panel .lyrics-source-select');
      const manage=[...document.querySelectorAll('#lyrics-cloud-panel button')].find(node=>node.textContent.trim()==='管理来源');
      const r=panel.getBoundingClientRect(),rect=node=>{if(!node)return null;const b=node.getBoundingClientRect();return{left:b.left,top:b.top,width:b.width,height:b.height}};
      const style=node=>{if(!node)return null;const c=getComputedStyle(node);return{color:c.color,backgroundColor:c.backgroundColor,border:c.border,borderRadius:c.borderRadius,boxShadow:c.boxShadow,textDecorationLine:c.textDecorationLine}};
      return{design:document.querySelector('#stage').dataset.design,theme:document.querySelector('#stage').dataset.theme,hidden:dialog.hidden,panel:{width:r.width,height:r.height},
        localTab:!!localTab,cloudTab:!!cloudTab,tabSiblings:!!(localTab&&cloudTab&&localTab.parentElement===cloudTab.parentElement),
        localSelected:localTab?.getAttribute('aria-selected'),cloudSelected:cloudTab?.getAttribute('aria-selected'),
        localPanelHidden:localPanel?.hidden,cloudPanelHidden:cloudPanel?.hidden,
        oldSearchTab:!!dialog.querySelector('#lyrics-options-search-tab'),oldSettingsTab:!!dialog.querySelector('#lyrics-options-settings-tab'),oldTrackSettings:!!dialog.querySelector('#lyrics-track-settings'),
        localInput:!!localPanel?.querySelector('input[type=file]'),cloudSearch:!!cloudPanel?.querySelector('.lyrics-primary-button'),cloudQueries:cloudPanel?.querySelectorAll('.lyrics-query-input').length??0,
        sourceDefault:source?.value??null,sourceTrigger:rect(cloudPanel?.querySelector('.settings-select-trigger')),
        offsetShared:!!(offset&&offset.parentElement===localPanel?.parentElement&&offset.parentElement===cloudPanel?.parentElement&&!localPanel.contains(offset)&&!cloudPanel.contains(offset)),
        offset:rect(offset),manage:rect(manage),manageStyle:style(manage),manageReceiver:manage?.hasAttribute('data-terminal-receiver')??false,
        dialogControls:dialog.querySelectorAll('button').length,gearCount:document.querySelectorAll('.lyrics-main-header [aria-label="歌词选项"]').length};
    })()`);
    assert(!dialogLayout.hidden&&dialogLayout.localTab&&dialogLayout.cloudTab&&dialogLayout.tabSiblings
      &&dialogLayout.localPanelHidden===true&&dialogLayout.cloudPanelHidden===false
      &&dialogLayout.localSelected==='false'&&dialogLayout.cloudSelected==='true'
      &&!dialogLayout.oldSearchTab&&!dialogLayout.oldSettingsTab&&!dialogLayout.oldTrackSettings
      &&dialogLayout.localInput&&dialogLayout.cloudSearch&&dialogLayout.cloudQueries>=2
      &&dialogLayout.sourceDefault==='netease'&&dialogLayout.sourceTrigger?.width>0
      &&dialogLayout.offsetShared&&dialogLayout.offset?.width>0&&dialogLayout.gearCount===1,
      'Dialog must expose same-level Local/Cloud flows, a global-default cloud source selector, and one shared external offset control: '+JSON.stringify(dialogLayout));
    assert(dialogLayout.manage?.width>0&&Math.abs(dialogLayout.manage.height-38)<1
      &&dialogLayout.manageStyle.backgroundColor!=='rgba(0, 0, 0, 0)'
      &&(design==='rhine'?parseFloat(dialogLayout.manageStyle.borderRadius)>0:parseFloat(dialogLayout.manageStyle.borderRadius)===0)
      &&!dialogLayout.manageStyle.textDecorationLine.includes('underline'),
      'Manage Sources must retain its 38px filled Future button or square Punk button without an underline: '+JSON.stringify(dialogLayout));
    browserWindow.webContents.sendInputEvent({type:'mouseMove',x:Math.round(dialogLayout.manage.left+dialogLayout.manage.width/2),y:Math.round(dialogLayout.manage.top+dialogLayout.manage.height/2)});
    await pause(100);
    await browser('window.__lyricsCheckTerminalLighting?.refresh()');
    await waitForPaintStable('manage-sources-hover-'+theme);
    const managedHover=await browser('(() => {const node=[...document.querySelectorAll("#lyrics-cloud-panel button")].find(item=>item.textContent.trim()==="管理来源");if(!node)return null;const s=getComputedStyle(node),r=node.getBoundingClientRect();return{width:r.width,height:r.height,background:s.backgroundColor,border:s.border,borderRadius:s.borderRadius,boxShadow:s.boxShadow,textDecorationLine:s.textDecorationLine,receiver:node.hasAttribute("data-terminal-receiver")}})()');
    assert(managedHover&&Math.abs(managedHover.height-dialogLayout.manage.height)<0.5
      &&Math.abs(managedHover.width-dialogLayout.manage.width)<0.5&&managedHover.borderRadius===dialogLayout.manageStyle.borderRadius
      &&managedHover.background!=='rgba(0, 0, 0, 0)'
      &&!managedHover.textDecorationLine.includes('underline')&&(!managedHover.receiver||managedHover.boxShadow!=='none'),
      'Hovering Manage Sources must preserve its geometry and skin; its normal terminal soft light may remain: '+JSON.stringify({before:dialogLayout.manageStyle,rect:dialogLayout.manage,after:managedHover}));
    await captureScreenshot('lyrics-manage-sources-hover-'+design+'-'+theme);
    browserWindow.webContents.sendInputEvent({type:'mouseMove',x:2,y:2});
    assert((await mockState()).requests.filter(item=>item.path==='/api/lyrics/search').length===searchesBefore,
      'Opening the options dialog must not start a manual cloud search.');

    const controls=[];
    for(const id of ['lyrics-options-local-tab','lyrics-options-cloud-tab']){
      await browser('document.querySelector("#'+id+'").focus()');
      const focus=await inspectFocusVisible('#'+id,id);
      assert(focus.focusVisible&&focus.outline!=='none'&&Number.parseFloat(focus.outlineWidth)>=1,
        'Both Local and Cloud entry buttons must retain a visible keyboard focus ring: '+JSON.stringify(focus));
      controls.push(focus);
    }
    dialogLayout.focus=controls;

    await click('#lyrics-cloud-panel .settings-select-trigger');
    await waitBrowser('document.querySelector("#lyrics-page-content .settings-select-menu:not([hidden]) .settings-select-option")','cloud provider dropdown opened');
    await waitForPaintStable('cloud-source-menu-' + theme);
    dialogLayout.menu=await browser('(() => {const menu=document.querySelector("#lyrics-page-content .settings-select-menu:not([hidden])"),trigger=document.querySelector("#lyrics-cloud-panel .settings-select-trigger"),r=menu.getBoundingClientRect();return{expanded:trigger.getAttribute("aria-expanded"),options:menu.querySelectorAll(".settings-select-option").length,selected:menu.querySelector(".settings-select-option[aria-selected=\\"true\\"]")?.textContent.trim()??"",menu:{width:r.width,height:r.height},background:getComputedStyle(menu).backgroundColor}})()');
    assert(dialogLayout.menu.expanded==='true'&&dialogLayout.menu.options>=2&&dialogLayout.menu.menu.width>0&&dialogLayout.menu.menu.height>0,
      'The Cloud provider list must remain an accessible enhanced select, separate from the Local/Cloud choice: '+JSON.stringify(dialogLayout.menu));
    await captureScreenshot('lyrics-source-entries-' + design + '-' + theme);
    await click('#lyrics-cloud-panel .settings-select-trigger');
    await waitBrowser('document.querySelector("#lyrics-page-content .settings-select-menu[hidden]")','cloud provider dropdown closed');

    const pickerBeforeLocal=await browser('window.__lyricsCheckFilePickerCalls');
    await click('#lyrics-options-local-tab');
    await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId==='synthetic-track'&&item.body.kind==='local'),design+' '+theme+' Local variant activation submitted');
    await waitBrowser('document.querySelector("#lyrics-local-panel").hidden===false&&document.querySelector("#lyrics-options-local-tab").getAttribute("aria-selected")==="true"&&window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeLocal),design+' '+theme+' Local panel selected without opening the picker');
    const localFallback=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",localSelected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),cloudSelected:document.querySelector("#lyrics-options-cloud-tab")?.getAttribute("aria-selected"),offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
    const localFallbackBank=(await mockState()).banks.find(item=>item.trackId==='synthetic-track');
    assert(localFallback.lines.includes('第一句合成歌词')&&localFallback.localMessage.includes('无本地歌词，使用云歌词')
        &&localFallback.localSelected==='true'&&localFallback.cloudSelected==='false'&&localFallback.offsetDisabled
        &&localFallback.pickerCalls===pickerBeforeLocal&&localFallbackBank?.activeKind==='local'
        &&localFallbackBank.effectiveKind==='cloud'&&localFallbackBank.usingCloudFallback===true,
      'Local without its own document must show cached Cloud lyrics as a read-only fallback and must not open the picker: '+JSON.stringify({localFallback,localFallbackBank}));
    await waitForPaintStable('lyrics-source-local-'+design+'-'+theme);
    await captureScreenshot('lyrics-source-local-'+design+'-'+theme);
    const searchResponsesBeforeCloud=(await mockState()).searchResponses.length;
    await click('#lyrics-options-cloud-tab');
    await waitMockState(state=>state.searchResponses.length>searchResponsesBeforeCloud,design+' '+theme+' Cloud entry search completed');
    await waitBrowser('document.querySelector("#lyrics-cloud-panel").hidden===false&&document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected")==="true"',design+' '+theme+' Cloud tab is active after search');
    await waitForPaintStable('lyrics-source-cloud-'+design+'-'+theme);
    await captureScreenshot('lyrics-source-cloud-'+design+'-'+theme);

    dialogLayouts.push(dialogLayout);
    await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden && document.activeElement?.getAttribute("aria-label")==="歌词选项"', theme + ' options dialog closed and gear focus restored');
  }
  for(const design of ['rhine','archive']){
    const day=dialogLayouts.find(item=>item.design===design&&item.theme==='day'),night=dialogLayouts.find(item=>item.design===design&&item.theme==='night');
    assert(day&&night&&Math.abs(day.panel.width-night.panel.width)<1&&Math.abs(day.panel.height-night.panel.height)<1,
      design+' day and night Local/Cloud dialog layouts must have matching geometry: '+JSON.stringify({day,night}));
  }
  await browser('(() => {const stage=document.querySelector("#stage");stage.dataset.design="rhine";stage.dataset.theme="day";window.__lyricsCheckTerminalLighting?.refresh();return true})()');
  await waitForPaintStable('dialog-restore-future-day');
  report.checks.localCloudDialogGlobalSourceManageStyleAndFocusDayNight=true;

  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden && !document.querySelector("#lyrics-cloud-panel").hidden && !document.querySelector("#lyrics-cloud-panel .lyrics-primary-button").disabled',
    'Cloud flow opened with the current active kind');
  const beforeCloudResponses=(await mockState()).searchResponses.length;
  await click('#lyrics-options-cloud-tab');
  await waitMockState(snapshot=>snapshot.searchResponses.length>beforeCloudResponses,'clicking Cloud completed a global-default search');
  await waitBrowser('document.querySelector(".lyrics-candidate-card") !== null', 'clicking Cloud searched the global-default source');
  let state=await mockState();
  let searchRequest=state.requests.filter(item=>item.path==='/api/lyrics/search').at(-1);
  assert(searchRequest?.body?.sourceId==='netease','The initial Cloud query must use the global default provider: '+JSON.stringify(searchRequest));
  await waitBrowser('document.querySelector("#lyrics-cloud-panel .settings-select-trigger")?.getBoundingClientRect().width>0','enhanced cloud provider control is visible');
  await click('#lyrics-cloud-panel .settings-select-trigger');
  await waitBrowser('document.querySelector("#lyrics-page-content .settings-select-menu:not([hidden]) .settings-select-option")','cloud source list opened');
  await browser('(() => {const option=[...document.querySelectorAll("#lyrics-page-content .settings-select-menu:not([hidden]) .settings-select-option")].find(node=>node.textContent.includes("QQ音乐"));if(!option)throw new Error("QQ source option missing");option.click();return true})()');
  await click('#lyrics-cloud-panel .lyrics-primary-button');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/search'&&item.body.sourceId==='qq'),'temporary QQ search submitted');
  await waitBrowser('document.querySelector(".lyrics-candidate-card") !== null','temporary provider search returned a candidate');
  state=await mockState();
  searchRequest=state.requests.filter(item=>item.path==='/api/lyrics/search').at(-1);
  assert(searchRequest.body.sourceId==='qq'&&!state.requests.some(item=>item.path==='/api/lyrics/preferences')
      &&!state.requests.some(item=>item.path==='/api/lyrics/settings'&&item.method==='POST'),
    'A temporary Cloud provider choice must query QQ without writing per-track or global settings: '+JSON.stringify(state.requests));
  const searchUi=await browser('(() => ({candidateSource:document.querySelector(".lyrics-candidate-card > small")?.textContent??"",candidateTitle:document.querySelector(".lyrics-candidate-text strong")?.textContent??"",dialogHidden:document.querySelector("#lyrics-options-dialog").hidden}))()');
  assert(searchUi.candidateSource.includes('QQ音乐')&&!searchUi.dialogHidden,
    'The Cloud panel must show a source-labelled candidate and keep its dialog open: '+JSON.stringify(searchUi));
  report.checks.globalDefaultCloudSearchAndTemporaryProvider=true;

  await click('.lyrics-candidate-card button');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden===false && document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-track")',
    'cloud candidate saved and displayed without closing the dialog');
  state=await mockState();
  const selectRequest=state.requests.find(item=>item.path==='/api/lyrics/select');
  let bank=state.banks.find(item=>item.trackId==='synthetic-track');
  assert(selectRequest?.body?.sourceId==='qq'&&bank?.activeKind==='cloud'&&bank.userSelected
      &&bank.variants.cloud&&bank.variants.local===false,
    'Selecting a remote candidate must persist/activate only the Cloud bank: '+JSON.stringify({selectRequest,bank}));
  report.checks.cloudSelectionPersistsCloudBank=true;

  const pickerBefore=await browser('window.__lyricsCheckFilePickerCalls');
  assert(pickerBefore===0,'Selecting Local in the Future/Punk day/night visuals must never open the native picker: '+pickerBefore);
  await browser('window.__lyricsCheckSetTrack("synthetic-empty-local-track")');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-empty-local-track'),'empty Local track automatic resolve started');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden','empty Local track dialog opened');
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.kind==='local'&&item.body.trackId==='synthetic-empty-local-track'),'empty Local selection persisted without opening picker');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBefore),'clicking Local without a cache leaves the picker closed');
  const emptyLocal=await mockState();
  bank=emptyLocal.banks.find(item=>item.trackId==='synthetic-empty-local-track');
  assert(bank?.activeKind==='local'&&bank.userSelected&&!bank.variants.local&&!bank.variants.cloud&&bank.effectiveKind===null,
    'Selecting an empty Local bank must remain an explicit selection: '+JSON.stringify(bank));
  await pause(520);
  const emptyLocalAfterAuto=await mockState();
  bank=emptyLocalAfterAuto.banks.find(item=>item.trackId==='synthetic-empty-local-track');
  const emptyLocalVisual=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",lineCount:document.querySelector(".lyrics-lines")?.childElementCount??-1,notice:document.querySelector(".lyrics-notice-text")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",noticeHidden:document.querySelector(".lyrics-notice")?.hidden??true,localSelected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),cloudSelected:document.querySelector("#lyrics-options-cloud-tab")?.getAttribute("aria-selected"),pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  assert(bank?.activeKind==='local'&&bank.userSelected&&!bank.variants.local&&!bank.variants.cloud
      &&emptyLocalVisual.lineCount===0&&hasExplicitNoLyricsNotice(emptyLocalVisual.notice)&&emptyLocalVisual.localMessage.includes('无本地歌词，使用云歌词')&&!emptyLocalVisual.noticeHidden
      &&emptyLocalVisual.localSelected==='true'&&emptyLocalVisual.cloudSelected==='false'
      &&emptyLocalVisual.pickerCalls===pickerBefore&&!emptyLocalVisual.lines.includes('自动解析结果 synthetic-empty-local-track'),
    'A remote miss must leave an explicit no-lyrics message, keep Local selected, and leave Import user-triggered: '+JSON.stringify({bank,emptyLocalVisual}));
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden&&document.activeElement?.getAttribute("aria-label")==="歌词选项"','empty Local dialog closed and focus returned to gear');
  const localReopenSearches=(await mockState()).searchResponses.length;
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-local-tab").getAttribute("aria-selected")==="true"&&document.querySelector("#lyrics-cloud-panel").hidden','reopening empty Local keeps the user-selected Local type');
  const emptyLocalReopened=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.childElementCount??-1,notice:document.querySelector(".lyrics-notice-text")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",cloudSelected:document.querySelector("#lyrics-options-cloud-tab")?.getAttribute("aria-selected"),pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  assert(emptyLocalReopened.lines===0&&hasExplicitNoLyricsNotice(emptyLocalReopened.notice)&&emptyLocalReopened.localMessage.includes('无本地歌词，使用云歌词')&&emptyLocalReopened.cloudSelected==='false'
      &&emptyLocalReopened.pickerCalls===emptyLocalVisual.pickerCalls
      &&(await mockState()).searchResponses.length===localReopenSearches,
    'Closing and reopening empty Local must keep its no-lyrics state without running search or opening Import: '+JSON.stringify(emptyLocalReopened));
  report.checks.emptyLocalPromptAndSelectionSurviveReopen=true;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','empty Local dialog closed before returning to the prior track');

  const localAutoFallbackTrack='synthetic-local-auto-fallback-track';
  await browser('window.__lyricsCheckSetUnknownTrack('+JSON.stringify(localAutoFallbackTrack)+')');
  await waitMockState(snapshot=>snapshot.resolveResponses.some(item=>item.trackId===localAutoFallbackTrack),'unknown metadata produced an initial no-Cloud Local-fallback state');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden','Local auto-fallback dialog opened');
  const pickerBeforeAutoFallback=await browser('window.__lyricsCheckFilePickerCalls');
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId===localAutoFallbackTrack&&item.body.kind==='local'),'Local preference selected before metadata refresh');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeAutoFallback),'selecting Local without a bank must not open Import');
  const resolvesBeforeMetadata=(await mockState()).requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===localAutoFallbackTrack).length;
  await browser('window.__lyricsCheckSetKnownTrack('+JSON.stringify(localAutoFallbackTrack)+')');
  await waitMockState(snapshot=>snapshot.resolveResponses.filter(item=>item.trackId===localAutoFallbackTrack).length>resolvesBeforeMetadata,'metadata refresh resolved Cloud while Local stayed active');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes('+JSON.stringify(localAutoFallbackTrack)+')','automatic Cloud lyrics rendered beneath the selected Local preference');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===localAutoFallbackTrack);
  const localAutoFallbackVisual=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",localSelected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),cloudSelected:document.querySelector("#lyrics-options-cloud-tab")?.getAttribute("aria-selected"),localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  const localAutoFallbackResolve=state.resolveResponses.filter(item=>item.trackId===localAutoFallbackTrack).at(-1);
  assert(bank?.activeKind==='local'&&bank.userSelected&&bank.effectiveKind==='cloud'&&bank.usingCloudFallback===true
      &&bank.variants.cloud&&!bank.variants.local&&localAutoFallbackResolve?.activeKind==='local'&&localAutoFallbackResolve.effectiveKind==='cloud'
      &&localAutoFallbackVisual.lines.includes(localAutoFallbackTrack)&&localAutoFallbackVisual.localSelected==='true'
      &&localAutoFallbackVisual.cloudSelected==='false'&&localAutoFallbackVisual.localMessage.includes('无本地歌词，使用云歌词')
      &&localAutoFallbackVisual.offsetDisabled&&localAutoFallbackVisual.pickerCalls===pickerBeforeAutoFallback
      &&state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===localAutoFallbackTrack).length===resolvesBeforeMetadata+1,
    'Metadata-triggered Cloud resolution must supply a read-only fallback without changing the user-selected Local tab: '+JSON.stringify({bank,localAutoFallbackResolve,localAutoFallbackVisual}));
  await browser('window.__lyricsCheckSetVisible(false)');
  await browser('window.__lyricsCheckSetVisible(true)');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes('+JSON.stringify(localAutoFallbackTrack)+')','Cloud fallback remains visible after leaving and re-entering the page');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-local-tab").getAttribute("aria-selected")==="true"&&document.querySelector("#lyrics-cloud-panel").hidden','reopening after page re-entry keeps Local active');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===localAutoFallbackTrack);
  assert(bank?.activeKind==='local'&&bank.userSelected&&bank.effectiveKind==='cloud'&&bank.usingCloudFallback===true
      &&state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===localAutoFallbackTrack).length===resolvesBeforeMetadata+1,
    'Page re-entry and dialog reopen must not move activeKind from Local or start another resolver: '+JSON.stringify(bank));
  report.checks.metadataResolveAndPageReentryKeepLocalWithCloudFallback=true;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','Local fallback dialog closed before returning to cached Cloud track');

  const emptyFallbackTrack='synthetic-empty-fallback-track';
  await browser('window.__lyricsCheckSetUnknownTrack('+JSON.stringify(emptyFallbackTrack)+')');
  await waitMockState(snapshot=>snapshot.resolveResponses.some(item=>item.trackId===emptyFallbackTrack),'unknown metadata produced an initial empty Cloud result');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden','empty remote fallback dialog opened');
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId===emptyFallbackTrack&&item.body.kind==='local'),'empty Local selection persisted before retrying Cloud resolve');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBefore),'empty Local selection still leaves Import user-triggered');
  const emptyFallbackResolves=(await mockState()).resolveResponses.filter(item=>item.trackId===emptyFallbackTrack).length;
  await browser('window.__lyricsCheckSetKnownTrack('+JSON.stringify(emptyFallbackTrack)+')');
  await waitMockState(snapshot=>snapshot.resolveResponses.filter(item=>item.trackId===emptyFallbackTrack).length>emptyFallbackResolves,'known metadata attempted Cloud fallback but found no lyric');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===emptyFallbackTrack);
  const emptyFallbackVisual=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.childElementCount??-1,notice:document.querySelector(".lyrics-notice-text")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,localSelected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),cloudSelected:document.querySelector("#lyrics-options-cloud-tab")?.getAttribute("aria-selected"),pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  assert(bank?.activeKind==='local'&&bank.userSelected&&bank.effectiveKind===null&&!bank.variants.cloud&&!bank.variants.local
      &&emptyFallbackVisual.lines===0&&hasExplicitNoLyricsNotice(emptyFallbackVisual.notice)&&emptyFallbackVisual.localMessage.includes('无本地歌词，使用云歌词')
      &&emptyFallbackVisual.offsetDisabled&&emptyFallbackVisual.localSelected==='true'&&emptyFallbackVisual.cloudSelected==='false'
      &&emptyFallbackVisual.pickerCalls===pickerBefore,
    'When the Cloud resolver also misses, Local remains selected with a clear no-lyrics state and no implicit picker: '+JSON.stringify({bank,emptyFallbackVisual}));
  const emptyFallbackResolveCount=state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===emptyFallbackTrack).length;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','empty Cloud fallback dialog closed before reopening');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-local-tab").getAttribute("aria-selected")==="true"&&document.querySelector("#lyrics-cloud-panel").hidden','empty Cloud fallback reopen keeps Local selected');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId===emptyFallbackTrack);
  assert(bank?.activeKind==='local'&&bank.userSelected&&bank.effectiveKind===null
      &&state.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===emptyFallbackTrack).length===emptyFallbackResolveCount,
    'Reopening after a remote miss must not switch to Cloud or launch another resolver: '+JSON.stringify(bank));
  report.checks.emptyCloudFallbackKeepsLocalSelectionAndNoLyricsMessage=true;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','empty Cloud fallback dialog closed before returning to cached Cloud track');

  const resolvesBeforeReturn=(await mockState()).resolveResponses.filter(item=>item.trackId==='synthetic-track').length;
  await browser('window.__lyricsCheckSetTrack("synthetic-track")');
  await waitMockState(snapshot=>snapshot.resolveResponses.filter(item=>item.trackId==='synthetic-track').length>resolvesBeforeReturn,'previous synthetic track reselected');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-track")','selected Cloud version restored on track revisit');
  report.checks.emptyLocalSelectionBlocksLateAutoAndCloudReactivates=true;

  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected")==="true"','Cloud dialog reopened before testing the separate Local import');
  const pickerBeforeManualImport=await browser('window.__lyricsCheckFilePickerCalls');
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId==='synthetic-track'&&item.body.kind==='local'),'empty Local bank activated without opening the picker');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeManualImport),'clicking Local without a cache leaves the picker closed');
  const fallbackBeforeImport=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",message:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true}))()');
  bank=(await mockState()).banks.find(item=>item.trackId==='synthetic-track');
  assert(bank?.activeKind==='local'&&bank.effectiveKind==='cloud'&&bank.usingCloudFallback===true&&fallbackBeforeImport.lines.includes('手动选择结果 synthetic-track')
      &&fallbackBeforeImport.message.includes('无本地歌词，使用云歌词')&&fallbackBeforeImport.offsetDisabled,
    'The Local tab must display its cached Cloud fallback without opening Import and keep Local offset disabled: '+JSON.stringify({bank,fallbackBeforeImport}));
  await click('#lyrics-local-panel .lyrics-import-button');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeManualImport+1),'explicit Import click opens the intercepted file picker');
  await browser(`(() => { const input=document.querySelector('#lyrics-local-panel input[type=file]'); const text=Array.from({length:20},(_,index)=>'[00:'+String(index+1).padStart(2,'0')+'.00]'+(index===0?'手动导入结果 synthetic-track':'本地导入歌词第 '+(index+1)+' 行')).join(String.fromCharCode(10)); const file=new File([text],'synthetic-manual.lrc',{type:'text/plain'}); const transfer=new DataTransfer();transfer.items.add(file);Object.defineProperty(input,'files',{value:transfer.files,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return true; })()`);
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/import'&&item.body.trackId==='synthetic-track'),'local synthetic LRC import submitted');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden===false && document.querySelector(".lyrics-lines")?.textContent.includes("手动导入结果 synthetic-track")','local import displayed without closing the dialog');
  state=await mockState();
  const importRequest=state.requests.find(item=>item.path==='/api/lyrics/import'&&item.body.trackId==='synthetic-track');
  bank=state.banks.find(item=>item.trackId==='synthetic-track');
  assert(importRequest?.body?.lrc&&!Object.keys(importRequest.body).some(key=>/path|filename/i.test(key))
      &&bank?.activeKind==='local'&&bank.userSelected&&bank.variants.local&&bank.variants.cloud,
    'Local import must send text only, activate its own bank, and retain the Cloud bank: '+JSON.stringify({importRequest,bank}));
  const localOffsetHeading=await browser('document.querySelector(".lyrics-offset-section .lyrics-data-heading")?.textContent.trim()??""');
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.filter(item=>item.path==='/api/lyrics/variant'&&item.body.trackId==='synthetic-track'&&item.body.kind==='local').length>=2,'cached Local bank reactivated');
  await pause(100);
  const pickerOnCachedLocal=await browser('window.__lyricsCheckFilePickerCalls');
  assert(pickerOnCachedLocal===pickerBeforeManualImport+1,'Clicking Local with an existing cache must restore it without opening Import.');
  await waitBrowser('document.querySelector("#lyrics-local-panel .lyrics-import-button")&&!document.querySelector("#lyrics-local-panel .lyrics-import-button").hidden','cached Local panel exposes a re-import action');
  await click('#lyrics-local-panel .lyrics-import-button');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeManualImport+2),'the separate re-import action opens the picker for a cached Local bank');

  await browser('document.querySelector(".lyrics-offset-controls input").value="-0.5"');
  await click('.lyrics-offset-controls .lyrics-quiet-button');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/offset'&&item.body.kind==='local'&&item.body.offsetMs===-500),'Local offset posted with the active bank kind');
  let offsetState=await mockState();
  assert(offsetState.banks.find(item=>item.trackId==='synthetic-track')?.activeKind==='local','Saving Local offset must leave Local active.');

  const searchCountBeforeCloudRestore=(await mockState()).requests.filter(item=>item.path==='/api/lyrics/search'&&item.body.trackId==='synthetic-track').length;
  await click('#lyrics-options-cloud-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId==='synthetic-track'&&item.body.kind==='cloud'),'existing Cloud bank reactivated');
  await waitMockState(snapshot=>snapshot.requests.filter(item=>item.path==='/api/lyrics/search'&&item.body.trackId==='synthetic-track').length>searchCountBeforeCloudRestore
      &&snapshot.searchResponses.length===snapshot.requests.filter(item=>item.path==='/api/lyrics/search').length,'Cloud search completed after restoring the existing bank');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-track")','Cloud lyrics restored while Cloud search flow remains open');
  const cloudOffsetHeading=await browser('document.querySelector(".lyrics-offset-section .lyrics-data-heading")?.textContent.trim()??""');
  assert(localOffsetHeading&&cloudOffsetHeading&&localOffsetHeading!==cloudOffsetHeading,
    'The shared offset section heading must follow the active Local/Cloud bank: '+JSON.stringify({localOffsetHeading,cloudOffsetHeading}));
  const cloudOffsetInput=await browser('document.querySelector(".lyrics-offset-controls input")?.value??null');
  await browser('document.querySelector(".lyrics-offset-controls input").value="0.5"');
  await click('.lyrics-offset-controls .lyrics-quiet-button');
  offsetState=await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/offset'&&item.body.kind==='cloud'&&item.body.offsetMs===500),'Cloud offset posted with the Cloud bank kind');
  const cloudLocalState=await browser('(() => ({dialogHidden:document.querySelector("#lyrics-options-dialog").hidden,active:document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected"),offset:document.querySelector(".lyrics-offset-controls input").value}))()');
  assert(!cloudLocalState.dialogHidden&&cloudLocalState.active==='true'&&cloudOffsetInput==='0.0'&&cloudLocalState.offset==='0.5',
    'Cloud offset must update independently and keep the dialog open: '+JSON.stringify({cloudOffsetInput,cloudLocalState}));
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId==='synthetic-track'&&item.body.kind==='local'),'Local bank reactivated after Cloud offset');
  const separateOffsets=await browser('(() => ({kind:document.querySelector("#lyrics-options-local-tab").getAttribute("aria-selected"),offset:document.querySelector(".lyrics-offset-controls input").value}))()');
  assert(separateOffsets.kind==='true'&&separateOffsets.offset==='-0.5','Reopening Local must restore its own offset: '+JSON.stringify(separateOffsets));
  report.checks.localCloudBanksAndOffsetsIndependent=true;

  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden&&document.activeElement?.getAttribute("aria-label")==="歌词选项"','Escape closes options and restores the gear focus');
  const searchesBeforeReopen=(await mockState()).requests.filter(item=>item.path==='/api/lyrics/search').length;
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-local-tab").getAttribute("aria-selected")==="true"&& !document.querySelector("#lyrics-local-panel").hidden','reopening the dialog selects the active Local bank');
  assert((await mockState()).requests.filter(item=>item.path==='/api/lyrics/search').length===searchesBeforeReopen,
    'Reopening the dialog for the active Local bank must not start another search.');
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','reopened Local dialog closed');

  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitMockState(snapshot=>snapshot.searchResponses.length===snapshot.requests.filter(item=>item.path==='/api/lyrics/search').length,'all earlier Cloud searches settled before reopen test');
  const cloudSearchRequestsBeforeExplicitSelection=(await mockState()).requests.filter(item=>item.path==='/api/lyrics/search'&&item.body.trackId==='synthetic-track').length;
  await click('#lyrics-options-cloud-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId==='synthetic-track'&&item.body.kind==='cloud'),'Cloud selected again while both banks exist');
  await waitMockState(snapshot=>snapshot.requests.filter(item=>item.path==='/api/lyrics/search'&&item.body.trackId==='synthetic-track').length>cloudSearchRequestsBeforeExplicitSelection
      &&snapshot.searchResponses.length===snapshot.requests.filter(item=>item.path==='/api/lyrics/search').length,'Cloud re-entry search completed before closing the dialog');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden===false&&document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected")==="true"','Cloud remains in its search flow');
  const cloudSearchRequestCount=(await mockState()).requests.filter(item=>item.path==='/api/lyrics/search').length;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden&&document.activeElement?.getAttribute("aria-label")==="歌词选项"','Cloud dialog closed before reopening its active kind');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected")==="true"&&!document.querySelector("#lyrics-cloud-panel").hidden&&document.querySelector("#lyrics-local-panel").hidden','reopening Cloud keeps the user-selected type although a Local bank exists');
  state=await mockState();
  bank=state.banks.find(item=>item.trackId==='synthetic-track');
  assert(bank?.activeKind==='cloud'&&bank.userSelected&&bank.variants.cloud&&bank.variants.local
      &&state.requests.filter(item=>item.path==='/api/lyrics/search').length===cloudSearchRequestCount,
    'Reopening an explicitly Cloud track must leave Cloud active and avoid another search: '+JSON.stringify({bank,searchRequests:state.requests.filter(item=>item.path==='/api/lyrics/search').length,cloudSearchRequestCount}));
  report.checks.cloudSelectionSurvivesDialogReopenWithLocalBank=true;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','Cloud flow closed before resolve persistence test');

  const slowVariantTrack='synthetic-slow-variant-track';
  await browser('window.__lyricsCheckSetTrack('+JSON.stringify(slowVariantTrack)+')');
  await waitMockState(snapshot=>snapshot.resolveResponses.some(item=>item.trackId===slowVariantTrack),'slow-variant track initial cloud cache resolved');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes('+JSON.stringify(slowVariantTrack)+')','initial Cloud lyrics loaded before the slow Local activation');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-cloud-tab").getAttribute("aria-selected")==="true"','Cloud selection dialog opened before slow Local activation');
  const pickerBeforeSlowVariant=await browser('window.__lyricsCheckFilePickerCalls');
  const slowVariantBefore=await mockState();
  const slowVariantResolveCount=slowVariantBefore.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length;
  await click('#lyrics-options-local-tab');
  await waitMockState(snapshot=>snapshot.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId===slowVariantTrack&&item.body.kind==='local'),'slow Local activation request started');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeSlowVariant),'slow Local tab activation leaves Import user-triggered');
  await browser('window.__lyricsCheckSetVisible(false)');
  await browser('window.__lyricsCheckSetVisible(true)');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','re-entered lyrics page while slow Local activation remained pending');
  const slowVariantPending=await mockState();
  assert(!slowVariantPending.variantResponses.some(item=>item.trackId===slowVariantTrack)
      &&slowVariantPending.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length===slowVariantResolveCount,
    'A pending Local activation must survive page hide/re-entry without resolving or completing early: '+JSON.stringify({variantResponses:slowVariantPending.variantResponses.filter(item=>item.trackId===slowVariantTrack),resolveRequests:slowVariantPending.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack)}));
  await waitMockState(snapshot=>snapshot.variantResponses.some(item=>item.trackId===slowVariantTrack&&item.kind==='local'),'slow Local activation completed after page re-entry');
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes('+JSON.stringify(slowVariantTrack)+')','completed empty Local selection displayed the cached Cloud fallback');
  const slowVariantCompleted=await mockState();
  bank=slowVariantCompleted.banks.find(item=>item.trackId===slowVariantTrack);
  const slowVariantResponse=slowVariantCompleted.variantResponses.find(item=>item.trackId===slowVariantTrack&&item.kind==='local');
  const slowVariantVisual=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  assert(bank?.activeKind==='local'&&bank.effectiveKind==='cloud'&&bank.usingCloudFallback===true&&bank.userSelected&&bank.variants.cloud&&!bank.variants.local
      &&slowVariantResponse?.activeKind==='local'&&slowVariantResponse.effectiveKind==='cloud'&&slowVariantResponse.usingCloudFallback&&slowVariantResponse.selectionRevision===1
      &&slowVariantResponse.responseDestroyed===false&&!slowVariantResponse.requestAborted
      &&slowVariantVisual.lines.includes(slowVariantTrack)&&slowVariantVisual.localMessage.includes('无本地歌词，使用云歌词')&&slowVariantVisual.offsetDisabled
      &&slowVariantVisual.pickerCalls===pickerBeforeSlowVariant
      &&slowVariantCompleted.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length===slowVariantResolveCount,
    'The delayed Local selection response must remain live, preserve Cloud as a read-only fallback, and avoid a second resolve or picker: '+JSON.stringify({bank,slowVariantResponse,slowVariantVisual,resolveCount:slowVariantCompleted.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length}));
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden&&document.querySelector("#lyrics-options-local-tab").getAttribute("aria-selected")==="true"&&document.querySelector("#lyrics-cloud-panel").hidden','reopening the dialog after slow activation must retain Local');
  const slowVariantReopened=await browser('(() => ({lines:document.querySelector(".lyrics-lines")?.textContent??"",localMessage:document.querySelector("#lyrics-local-panel > .lyrics-help")?.textContent??"",offsetDisabled:document.querySelector(".lyrics-offset-controls input")?.disabled??true,localSelected:document.querySelector("#lyrics-options-local-tab")?.getAttribute("aria-selected"),cloudSelected:document.querySelector("#lyrics-options-cloud-tab")?.getAttribute("aria-selected"),pickerCalls:window.__lyricsCheckFilePickerCalls}))()');
  const slowVariantReopenedState=await mockState();
  assert(slowVariantReopened.lines.includes(slowVariantTrack)&&slowVariantReopened.localMessage.includes('无本地歌词，使用云歌词')&&slowVariantReopened.offsetDisabled
      &&slowVariantReopened.localSelected==='true'&&slowVariantReopened.cloudSelected==='false'
      &&slowVariantReopened.pickerCalls===pickerBeforeSlowVariant
      &&slowVariantReopenedState.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length===slowVariantResolveCount,
    'Closing and reopening after slow activation must keep the Local preference while showing read-only Cloud fallback, with no picker or auto-resolve: '+JSON.stringify({slowVariantReopened,resolveCount:slowVariantReopenedState.requests.filter(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId===slowVariantTrack).length}));
  report.checks.slowVariantSurvivesPagehideAndReentryWithoutAutoResolve=true;
  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden','slow-variant Local dialog closed before track persistence test');

  const priorSyntheticResolves=(await mockState()).resolveResponses.filter(item=>item.trackId==='synthetic-track').length;
  await browser('window.__lyricsCheckSetTrack("synthetic-other-track")');
  await waitMockState(snapshot=>snapshot.resolveResponses.some(item=>item.trackId==='synthetic-other-track'),'other track resolves');
  await browser('window.__lyricsCheckSetTrack("synthetic-track")');
  await waitMockState(snapshot=>snapshot.resolveResponses.filter(item=>item.trackId==='synthetic-track').length>priorSyntheticResolves,'explicit Cloud choice restored after another track was played');
  const cloudOnReturn=await mockState();
  bank=cloudOnReturn.banks.find(item=>item.trackId==='synthetic-track');
  assert(bank?.activeKind==='cloud'&&bank.userSelected&&bank.variants.cloud&&bank.variants.local,
    'Next automatic resolve must honor explicit Cloud selection even while a local bank exists: '+JSON.stringify(bank));
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-track")','explicit Cloud lyrics remain active after re-resolution');

  const noLegacyRequests=!(await mockState()).requests.some(item=>item.path==='/api/lyrics/preferences');
  assert(noLegacyRequests,'The new Local/Cloud flows must not read or write per-track source preferences.');
  report.checks.noPerTrackPreferenceRequests=true;

  await browser('window.__lyricsCheckSetTrack("synthetic-slow-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-slow-track'),'slow track resolve started');
  await browser('window.__lyricsCheckSetTrack("synthetic-fast-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-fast-track'),'replacement track resolve started');
  await waitMockState(state=>state.resolveResponses.some(item=>item.trackId==='synthetic-fast-track'),'replacement track resolve completed');
  await pause(520);
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("synthetic-fast-track")','new track lyrics remain rendered after the superseded request would have completed');
  const staleState=await mockState();
  assert(staleState.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-slow-track')
      &&staleState.resolveResponses.some(item=>item.trackId==='synthetic-fast-track'),
    'The prior slow request must be superseded while the replacement track completes: '+JSON.stringify(staleState));
  const staleText=await browser('document.querySelector(".lyrics-lines")?.textContent ?? ""');
  assert(staleText.includes('synthetic-fast-track')&&!staleText.includes('synthetic-slow-track'),'A superseded previous-track result must not replace the current track lyrics: '+staleText);
  report.checks.staleTrackResultRejected=true;

  await browser('window.__lyricsCheckSetTrack("synthetic-pending-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-pending-track'),'pending automatic resolution started');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden && !document.querySelector("#lyrics-cloud-panel").hidden','Cloud selection dialog opened while auto-resolution is pending');
  await click('#lyrics-options-cloud-tab');
  await waitBrowser('document.querySelector(".lyrics-candidate-card") !== null','manual cloud candidate available during automatic resolution');
  await click('.lyrics-candidate-card button');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden && document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-pending-track")','manual selection displayed while automatic resolution is pending');
  await pause(520);
  await waitBrowser('document.querySelector(".lyrics-lines")?.textContent.includes("手动选择结果 synthetic-pending-track")','manual lyrics remain after the late automatic result');
  const manualRaceText=await browser('document.querySelector(".lyrics-lines")?.textContent ?? ""');
  assert(manualRaceText.includes('手动选择结果 synthetic-pending-track')&&!manualRaceText.includes('自动解析结果 synthetic-pending-track'),
    'A late automatic result must not replace the user-selected candidate: '+manualRaceText);
  report.checks.manualSelectionWinsAutomaticRace=true;

  await browser('window.__lyricsCheckSetTrack("synthetic-import-pending-track")');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/resolve'&&item.body.trackId==='synthetic-import-pending-track'),'import-race automatic resolution started');
  await click('.lyrics-main-header [aria-label="歌词选项"]');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden','import dialog opened while auto-resolution is pending');
  const pickerBeforeRaceImport=await browser('window.__lyricsCheckFilePickerCalls');
  await click('#lyrics-options-local-tab');
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/variant'&&item.body.trackId==='synthetic-import-pending-track'&&item.body.kind==='local'),'empty Local bank selected during automatic resolution');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeRaceImport),'Local tab leaves the picker closed during the pending automatic result');
  await click('#lyrics-local-panel .lyrics-import-button');
  await waitBrowser('window.__lyricsCheckFilePickerCalls==='+String(pickerBeforeRaceImport+1),'explicit Import click opened the intercepted picker during the race');
  await browser(`(() => { const input=document.querySelector('#lyrics-local-panel input[type=file]'); const text=Array.from({length:20},(_,index)=>'[00:'+String(index+1).padStart(2,'0')+'.00]'+(index===0?'手动导入结果 synthetic-import-pending-track':'导入歌词第 '+(index+1)+' 行')).join(String.fromCharCode(10)); const file=new File([text],'synthetic-manual.lrc',{type:'text/plain'}); const transfer=new DataTransfer();transfer.items.add(file);Object.defineProperty(input,'files',{value:transfer.files,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return true; })()`);
  await waitMockState(state=>state.requests.some(item=>item.path==='/api/lyrics/import'&&item.body.trackId==='synthetic-import-pending-track'),'manual synthetic LRC import submitted');
  await waitBrowser('!document.querySelector("#lyrics-options-dialog").hidden && document.querySelector(".lyrics-lines")?.textContent.includes("手动导入结果 synthetic-import-pending-track")','imported lyrics displayed while the dialog remains open');
  await pause(520);
  const importedRaceText=await browser('document.querySelector(".lyrics-lines")?.textContent ?? ""');
  assert(importedRaceText.includes('手动导入结果 synthetic-import-pending-track')&&!importedRaceText.includes('自动解析结果 synthetic-import-pending-track'),
    'A late automatic result must not replace imported lyrics: '+importedRaceText);
  report.checks.importedLocalBankWinsAutomaticRace=true;

  await browser('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitBrowser('document.querySelector("#lyrics-options-dialog").hidden&&document.activeElement?.getAttribute("aria-label")==="歌词选项"','import dialog closed and focus returned before scroll gesture test');
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
  report.checks.localCloudFlowsVariantsAndManualPrecedence = true;
  report.mockApiPaths = Array.from(new Set(knownMetadataState.requests.map((item) => item.path)));
  if(report.transportTitleFailures?.length) throw new Error('Transport title regression checks failed: '+JSON.stringify(report.transportTitleFailures));
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
