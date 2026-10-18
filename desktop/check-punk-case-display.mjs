import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const closeTo = (left, right, tolerance = 0.001) => Number.isFinite(Number(left)) &&
  Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) <= tolerance;
const smoothStep = (value, start, end) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const expectedPhase = q => ({
  power: 1 - smoothStep(q, 0.72, 0.92),
  scan: 1 - smoothStep(q, 0.22, 0.68),
});
const vectorLength = value => Math.hypot(Number(value?.[0]), Number(value?.[1]), Number(value?.[2]));
const pointFromMatrix = (matrix, x, y, z) => [
  matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
  matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
  matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
];
const maxDifference = (left, right) => Math.max(...left.map((value, index) => Math.abs(Number(value) - Number(right[index]))));

export async function checkPunkCaseDisplay({ browserWindow, outputDirectory, probeReport, getPreferences }) {
  const wc = browserWindow.webContents;
  const screenshotDirectory = path.join(outputDirectory, 'punk-case-display');
  const result = {
    ok: false,
    cases: [],
    screenshots: [],
    assertions: {},
    renderPipelineSnapshots: [],
    transitions: [],
    paletteSamples: [],
    textureSamples: [],
  };
  const evaluate = script => wc.executeJavaScript(script, true);
  const stateScript = String.raw`(() => {
    const stage = document.querySelector('#stage');
    const app = window.rhineMusic;
    let stats = null;
    try { stats = app?.stats?.() ?? null; } catch {}
    const box = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
    };
    const selected = app?.selectedAlbum ?? null;
    const design = app?.design ?? {};
    const display = stats?.punkDisplay ?? null;
    const cssAccent = getComputedStyle(stage).getPropertyValue('--accent').trim().toLowerCase();
    const rgbAccent = cssAccent.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    const styleAccent = rgbAccent ? '#' + rgbAccent.slice(1, 4).map(value =>
      Math.round(Number(value)).toString(16).padStart(2, '0')).join('') : cssAccent;
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}'); } catch {}
    return {
      page:stage?.dataset.page ?? null,
      mode:stage?.dataset.mode ?? null,
      design:design.design ?? stage?.dataset.design ?? null,
      scheme:design.scheme ?? stored.style?.scheme ?? null,
      viewLayout:stats?.displayLayout?.requested ?? stage?.dataset.musicLayout ?? null,
      caseStructure:stats?.caseStructure ?? null,
      styleAccent,
      selectedAlbumId:stats?.selectedAlbumId ?? selected?.id ?? null,
      selectedAlbumTitle:selected?.title ?? null,
      archiveCount:stats?.archiveCount ?? null,
      libraryAlbumCount:app?.library?.albums?.length ?? null,
      submittedInstances:stats?.submittedInstances ?? null,
      entry:app?.entry ?? null,
      presentation:app?.presentation ?? null,
      detailHidden:document.querySelector('#music-detail')?.hidden ?? null,
      canvasRect:box(document.querySelector('#three-scene canvas')),
      viewport:{ width:innerWidth, height:innerHeight },
      stats:stats ? {
        punkDisplay:display,
        displayLayout:stats.displayLayout ?? null,
        layoutTransition:stats.layoutTransition ?? null,
        renderPipeline:stats.renderPipeline ?? null,
        cameraPosition:stats.cameraPosition ?? null,
        cameraAim:stats.cameraAim ?? null,
        cameraDistance:stats.cameraDistance ?? null,
        fieldOfView:stats.fieldOfView ?? null,
        projectedCenter:stats.projectedCenter ?? null,
        frameTime:stats.frameTime ?? null,
        drawCalls:stats.drawCalls ?? null,
        selectionLight:stats.selectionLight ?? null,
      } : null,
    };
  })()`;
  const state = () => evaluate(stateScript);
  const savedPreferences = () => getPreferences?.() ?? {};
  const record = (name, ok, detail = null) => {
    result.assertions[name] = Boolean(ok);
    result.cases.push({ name, ok:Boolean(ok), ...(detail === null ? {} : { detail }) });
    if (!ok) throw new Error(`Punk case display check failed: ${name}${detail === null ? '' : ` — ${JSON.stringify(detail).slice(0, 2200)}`}`);
  };
  const waitFor = async (predicate, label, timeoutMs = 14000, intervalMs = 50) => {
    const deadline = Date.now() + timeoutMs;
    let latest;
    while (Date.now() < deadline) {
      latest = await state();
      if (latest && predicate(latest)) return latest;
      await pause(intervalMs);
    }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(latest)?.slice(0, 2600)}`);
  };
  const click = async selector => {
    const clicked = await evaluate(`(() => {
      const selector = ${JSON.stringify(selector)};
      const nodes = Array.from(document.querySelectorAll(selector));
      const node = nodes.find(item => {
        const r = item.getBoundingClientRect(), s = getComputedStyle(item);
        return !item.disabled && r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      });
      if (!node) return false;
      node.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Missing visible Punk display control: ${selector}`);
  };
  const layoutSelector = layout => `.foobar-catalog-tools .foobar-tool-group[data-field="layout"] [data-music-layout="${layout}"], .foobar-catalog-tools .foobar-tool-group[data-field="layout"] [data-value="${layout}"], #music-browse [data-music-layout="${layout}"]`;
  const clickLayout = layout => click(layoutSelector(layout));
  const pipelineTypes = current => Array.isArray(current?.stats?.renderPipeline)
    ? current.stats.renderPipeline.map(pass => String(pass?.type ?? pass?.name ?? 'unknown')) : [];
  const recordPipeline = (name, current) => {
    const passes = current?.stats?.renderPipeline;
    const snapshot = Array.isArray(passes) ? passes.map(pass => ({ type:pass?.type ?? pass?.name ?? null, enabled:pass?.enabled ?? null })) : null;
    result.renderPipelineSnapshots.push({ name, passes:snapshot });
    return snapshot;
  };
  const captureScreenshot = async (name, current = null, { cropCanvas = false, immediate = false } = {}) => {
    const capturedState = current ?? await state();
    if (!immediate) await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    let image;
    if (cropCanvas && capturedState.canvasRect) {
      const rect = capturedState.canvasRect;
      const width = Math.max(1, Math.min(900, Math.floor(rect.width)));
      const height = Math.max(1, Math.min(640, Math.floor(rect.height)));
      const projected = capturedState.stats?.projectedCenter;
      const centerX = rect.x + (Array.isArray(projected) && Number.isFinite(Number(projected[0])) ? Number(projected[0]) : rect.width / 2);
      const centerY = rect.y + (Array.isArray(projected) && Number.isFinite(Number(projected[1])) ? Number(projected[1]) : rect.height / 2);
      const x = Math.max(0, Math.min(capturedState.viewport.width - width, Math.round(centerX - width / 2)));
      const y = Math.max(0, Math.min(capturedState.viewport.height - height, Math.round(centerY - height / 2)));
      image = await browserWindow.capturePage({ x, y, width, height });
    } else image = await browserWindow.capturePage();
    const file = path.join(screenshotDirectory, `${name}.png`);
    await fs.writeFile(file, image.toPNG());
    result.screenshots.push({ name, file, size:image.getSize(), state:{
      page:capturedState.page, design:capturedState.design, scheme:capturedState.scheme,
      viewLayout:capturedState.viewLayout, caseStructure:capturedState.caseStructure,
      selectedAlbumId:capturedState.selectedAlbumId, selectedAlbumTitle:capturedState.selectedAlbumTitle,
      punkDisplay:capturedState.stats?.punkDisplay ?? null,
      layoutTransition:capturedState.stats?.layoutTransition ?? null,
    } });
    process.stdout.write(`PUNK_CASE_DISPLAY_SCREENSHOT:${file}\n`);
    return file;
  };
  const verifyMount = mount => {
    const boundsOkay = bounds => Array.isArray(bounds?.min) && Array.isArray(bounds?.max) &&
      bounds.min.length === 3 && bounds.max.length === 3 &&
      [...bounds.min, ...bounds.max].every(value => Number.isFinite(Number(value))) &&
      bounds.min.every((value, index) => Number(value) <= Number(bounds.max[index]));
    if (!mount || !Array.isArray(mount.corners) || mount.corners.length !== 4 ||
        !Array.isArray(mount.currentMatrix) || mount.currentMatrix.length !== 16 ||
        !boundsOkay(mount.frameBounds) || !boundsOkay(mount.clipBounds)) return { ok:false, reason:'missing finite mount geometry' };
    const cornersOkay = mount.corners.every(point => Array.isArray(point) && point.length === 3 && point.every(value => Number.isFinite(Number(value))));
    if (!cornersOkay || !mount.currentMatrix.every(value => Number.isFinite(Number(value)))) return { ok:false, reason:'non-finite mount matrix or corners' };
    const halfWidth = Number(mount.width) / 2, halfDepth = Number(mount.depth) / 2;
    const localCorners = [[-halfWidth,-halfDepth],[halfWidth,-halfDepth],[halfWidth,halfDepth],[-halfWidth,halfDepth]];
    const matrixCorners = localCorners.map(([x, z]) => pointFromMatrix(mount.currentMatrix, x, z, 0));
    const matrixMatchesCorners = matrixCorners.every((point, index) => maxDifference(point, mount.corners[index]) < 0.0005);
    const cornerY = mount.corners.map(point => Number(point[1]));
    const averageY = cornerY.reduce((sum, value) => sum + value, 0) / cornerY.length;
    const topGap = averageY - Number(mount.frameBounds.max[1]);
    const rightEdgeX = (Number(mount.corners[1][0]) + Number(mount.corners[2][0])) / 2;
    const clipAttachment = rightEdgeX - Number(mount.clipBounds.min[0]);
    const depthMin = Math.min(...mount.corners.map(point => Number(point[2])));
    const depthMax = Math.max(...mount.corners.map(point => Number(point[2])));
    const widthMeasured = vectorLength(mount.corners[1].map((value, i) => Number(value) - Number(mount.corners[0][i])));
    const depthMeasured = vectorLength(mount.corners[3].map((value, i) => Number(value) - Number(mount.corners[0][i])));
    const checks = {
      positiveDimensions:Number(mount.width) > 0.05 && Number(mount.depth) > 0.05,
      matrixMatchesCorners,
      planeGapMatchesFrameTop:closeTo(topGap, mount.gapY, 0.0015) && Number(mount.gapY) > 0 && Number(mount.gapY) <= 0.003,
      rightEdgeAttachesToTopClip:closeTo(clipAttachment, mount.attachmentOverlap, 0.002) && Number(mount.attachmentOverlap) > 0,
      screenFitsFrameDepth:depthMin >= Number(mount.frameBounds.min[2]) - 0.002 && depthMax <= Number(mount.frameBounds.max[2]) + 0.002,
      reportedWidthAndDepthMatchCorners:closeTo(widthMeasured, mount.width, 0.002) && closeTo(depthMeasured, mount.depth, 0.002),
    };
    return { ok:Object.values(checks).every(Boolean), checks, measured:{ topGap, clipAttachment, widthMeasured, depthMeasured,
      frameBounds:mount.frameBounds, clipBounds:mount.clipBounds, corners:mount.corners, currentMatrix:mount.currentMatrix } };
  };
  const checkNoDisplay = (current, label, expectedStructure) => {
    const display = current?.stats?.punkDisplay;
    const okay = current?.design === 'rhine' && current?.viewLayout === 'shelf' &&
      (expectedStructure === undefined || current?.caseStructure === expectedStructure) &&
      display?.eligible === false && display?.arrayVisible === false && display?.selectedVisible === false &&
      Number(display?.power) === 0 && Number(display?.scan) === 0;
    record(label, okay, { design:current?.design, layout:current?.viewLayout,
      caseStructure:current?.caseStructure, display });
  };
  const preferenceTransformValue = (preferences, design, structure, part, axis) =>
    Number(preferences?.caseProfiles?.[design]?.appearances?.[structure]?.transforms?.[part]?.offset?.[axis] ?? 0);
  const waitForPreference = async (predicate, label, timeoutMs = 7000) => {
    const deadline = Date.now() + timeoutMs;
    let latest;
    while (Date.now() < deadline) {
      latest = savedPreferences();
      if (predicate(latest)) return latest;
      await pause(60);
    }
    throw new Error(`Timed out waiting for Punk display preference: ${label}: ${JSON.stringify(latest)?.slice(0, 1400)}`);
  };
  const setPartOffsetX = async (part, target) => {
    const saveCount = probeReport.preferenceSaves?.length ?? 0;
    const changed = await evaluate(`(() => {
      const root = document.querySelector('#theme-case-editor .case-editor');
      const details = root?.querySelector('[data-transform-editor]');
      if (!root || !details) return false;
      details.open = true;
      const part = root.querySelector('[data-part="${part}"]');
      if (!part) return false;
      part.click();
      const input = root.querySelector('[data-transform-value="offset"][data-axis="0"]');
      if (!input) return false;
      input.value = ${JSON.stringify(String(target))};
      input.dispatchEvent(new Event('change', { bubbles:true }));
      return true;
    })()`);
    if (!changed) throw new Error(`Could not edit the Punk ${part} offset through the STYLE case editor.`);
    await waitForPreference(preferences => closeTo(preferenceTransformValue(preferences, 'archive', 'punk', part, 0), target, 0.005) &&
      (probeReport.preferenceSaves?.length ?? 0) > saveCount, `${part} transform save`);
  };
  const installTextureWatch = async () => evaluate(`(() => {
    const canvas = document.querySelector('#three-scene canvas');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl') || null;
    if (!gl) return { ok:false, reason:'WebGL context unavailable' };
    const probe = { glKind:typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
      patched:[], errors:[], active:false, counts:{}, originals:[] };
    for (const name of ['texImage2D','texSubImage2D','texImage3D','texSubImage3D']) {
      if (typeof gl[name] !== 'function') continue;
      try {
        let owner = gl, descriptor = Object.getOwnPropertyDescriptor(owner, name);
        if (!descriptor) {
          owner = Object.getPrototypeOf(gl);
          while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, name))) owner = Object.getPrototypeOf(owner);
        }
        if (!owner || !descriptor || descriptor.configurable === false) throw new Error('WebGL upload method cannot be wrapped safely.');
        const original = gl[name].bind(gl);
        const wrapper = function(...args) {
          if (probe.active) probe.counts[name] = (probe.counts[name] || 0) + 1;
          return original(...args);
        };
        Object.defineProperty(owner, name, { ...descriptor, value:wrapper });
        probe.originals.push({ owner, name, descriptor });
        probe.patched.push(name);
      } catch (error) { probe.errors.push({ name, message:String(error?.message ?? error) }); }
    }
    probe.begin = () => { probe.counts = {}; probe.active = true; };
    probe.end = () => { probe.active = false; return { ...probe.counts }; };
    probe.restore = () => {
      probe.active = false;
      for (const item of probe.originals) {
        try { Object.defineProperty(item.owner, item.name, item.descriptor); } catch {}
      }
      delete window.__punkCaseDisplayTextureWatch;
    };
    Object.defineProperty(window, '__punkCaseDisplayTextureWatch', { configurable:true, value:probe });
    return { ok:probe.patched.includes('texImage2D') && probe.patched.includes('texSubImage2D'), glKind:probe.glKind, patched:probe.patched, errors:probe.errors };
  })()`);
  const beginTextureWatch = () => evaluate(`window.__punkCaseDisplayTextureWatch?.begin?.() ?? false`);
  const endTextureWatch = () => evaluate(`window.__punkCaseDisplayTextureWatch?.end?.() ?? null`);
  const waitForPaintStable = async (label, minimumPaintCount = null, timeoutMs = 9000) => {
    const deadline = Date.now() + timeoutMs;
    let last = null, stable = 0;
    while (Date.now() < deadline) {
      const current = await state();
      const count = Number(current?.stats?.punkDisplay?.paintCount);
      if (Number.isFinite(count) && (minimumPaintCount === null || count >= minimumPaintCount)) {
        if (count === last) stable++; else stable = 0;
        last = count;
        if (stable >= 3) return current;
      }
      await pause(120);
    }
    throw new Error(`Timed out waiting for stable Punk display painting: ${label}; last=${JSON.stringify(last)}`);
  };
  const measureIdleTextureActivity = async (label, durationMs = 800) => {
    const before = await state();
    await beginTextureWatch();
    await pause(durationMs);
    const uploads = await endTextureWatch();
    const after = await state();
    const uploadCount = Object.values(uploads ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const sample = { label, durationMs, uploads, uploadCount,
      paintBefore:before?.stats?.punkDisplay?.paintCount, paintAfter:after?.stats?.punkDisplay?.paintCount,
      layout:after?.viewLayout, power:after?.stats?.punkDisplay?.power, scan:after?.stats?.punkDisplay?.scan };
    result.textureSamples.push(sample);
    return { sample, unchanged:sample.paintBefore === sample.paintAfter && uploadCount === 0 };
  };
  const switchScheme = async scheme => {
    const current = await state();
    const beforeAccent = current.stats?.punkDisplay?.accent;
    const paintBefore = Number(current.stats?.punkDisplay?.paintCount);
    await beginTextureWatch();
    await click('[data-action="theme"]');
    await waitFor(value => value.page === 'theme' && value.design === 'archive', 'open Archive STYLE colour studies');
    await click(`[data-style-scheme="${scheme}"]`);
    await waitFor(value => value.page === 'theme' && value.design === 'archive' && value.scheme === scheme &&
      value.styleAccent && value.stats?.punkDisplay?.accent &&
      value.styleAccent === String(value.stats.punkDisplay.accent).toLowerCase(), `${scheme} palette mapped to Punk display`);
    await click('[data-action="library"]');
    const inLibrary = await waitFor(value => value.page === 'music' && value.design === 'archive' &&
      value.viewLayout === 'shelf' && value.caseStructure === 'punk' && value.presentation?.archiveReady === true &&
      value.stats?.punkDisplay?.eligible === true && value.stats?.punkDisplay?.accent === value.styleAccent,
      `return to Punk ARRAY after ${scheme} palette`, 18000);
    const stable = await waitForPaintStable(`${scheme} palette`, paintBefore + 1);
    const uploads = await endTextureWatch();
    const uploadCount = Object.values(uploads ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const palette = { scheme, accent:inLibrary.stats.punkDisplay.accent, styleAccent:inLibrary.styleAccent,
      previousAccent:beforeAccent, paintBefore, paintAfter:stable.stats.punkDisplay.paintCount, uploads, uploadCount };
    result.paletteSamples.push(palette);
    record(`${scheme} Color Studies accent matches the live Punk display`,
      palette.accent === palette.styleAccent && palette.accent !== beforeAccent && Number(palette.paintAfter) > paintBefore,
      palette);
    record(`${scheme} updates the cached canvas texture on content change`, uploadCount > 0, palette);
    await captureScreenshot(`color-studies-${scheme.toLowerCase()}`, stable);
    return stable;
  };
  const sampleTransition = async (targetLayout, label) => {
    const source = await state();
    const targetQ = targetLayout === 'shelf' ? 0 : 1;
    const sourceQ = targetLayout === 'shelf' ? 1 : 0;
    record(`${label} begins at the expected layout endpoint`, closeTo(source?.stats?.layoutTransition?.q, sourceQ, 0.001) &&
      source?.stats?.layoutTransition?.active === false, { layout:source?.viewLayout, q:source?.stats?.layoutTransition?.q,
        power:source?.stats?.punkDisplay?.power, scan:source?.stats?.punkDisplay?.scan });
    await clickLayout(targetLayout);
    const started = Date.now();
    const samples = [];
    let sawActive = false, whiteScreenshot = false, scanScreenshot = false, settled = null;
    while (Date.now() - started < 16000) {
      const current = await state();
      const transition = current?.stats?.layoutTransition;
      const display = current?.stats?.punkDisplay;
      if (transition?.active === true && Number.isFinite(Number(transition.q))) {
        sawActive = true;
        const sample = { q:Number(transition.q), power:Number(display?.power), scan:Number(display?.scan),
          layout:current.viewLayout, frameTime:current.stats?.frameTime };
        samples.push(sample);
        if (targetLayout === 'shelf' && !whiteScreenshot && sample.power > 0.08 && sample.scan < 0.01) {
          whiteScreenshot = true;
          await captureScreenshot(`${label}-white-base`, current, { immediate:true });
        }
        if (targetLayout === 'shelf' && !scanScreenshot && sample.scan > 0.18 && sample.scan < 0.82) {
          scanScreenshot = true;
          await captureScreenshot(`${label}-scan-in-progress`, current, { immediate:true });
        }
      }
      if (sawActive && transition?.active === false && current?.viewLayout === targetLayout &&
          closeTo(transition?.q, targetQ, 0.001)) { settled = current; break; }
      await pause(16);
    }
    if (!settled) settled = await waitFor(value => value.viewLayout === targetLayout &&
      value.stats?.layoutTransition?.active === false && closeTo(value.stats?.layoutTransition?.q, targetQ, 0.001),
    `${label} settled endpoint`, 9000, 50);
    result.transitions.push({ label, sourceLayout:source.viewLayout, targetLayout, samples,
      start:{ q:source?.stats?.layoutTransition?.q, power:source?.stats?.punkDisplay?.power, scan:source?.stats?.punkDisplay?.scan },
      end:{ q:settled?.stats?.layoutTransition?.q, power:settled?.stats?.punkDisplay?.power, scan:settled?.stats?.punkDisplay?.scan } });
    const formulaErrors = samples.map(sample => {
      const expected = expectedPhase(sample.q);
      return Math.max(Math.abs(sample.power - expected.power), Math.abs(sample.scan - expected.scan));
    });
    const maxFormulaError = formulaErrors.length ? Math.max(...formulaErrors) : Infinity;
    const powerDiffs = samples.slice(1).map((sample, index) => sample.power - samples[index].power);
    const scanDiffs = samples.slice(1).map((sample, index) => sample.scan - samples[index].scan);
    const forward = targetLayout === 'shelf';
    const whiteSeen = samples.some(sample => sample.power > 0.08 && sample.scan < 0.01);
    record(`${label} samples the fixed q phase functions`, sawActive && samples.length >= 5 &&
      maxFormulaError <= 0.035 && Math.abs(samples[0]?.q - sourceQ) < 0.08 &&
      Math.abs(samples.at(-1)?.q - targetQ) < 0.08,
      { sampleCount:samples.length, maxFormulaError, first:samples[0], last:samples.at(-1) });
    record(`${label} phase values move monotonically with the reversed canonical q`,
      powerDiffs.length > 0 && scanDiffs.length > 0 && powerDiffs.every(value => forward ? value >= -0.015 : value <= 0.015) &&
      scanDiffs.every(value => forward ? value >= -0.015 : value <= 0.015), { powerDiffs, scanDiffs });
    if (forward) {
      record('M to A shows a white display before the name sweep', whiteSeen && whiteScreenshot,
        { whiteSeen, whiteScreenshot, firstWhite:samples.find(sample => sample.power > 0.08 && sample.scan < 0.01) });
      record('M to A completes the name sweep at the ARRAY endpoint', closeTo(settled?.stats?.punkDisplay?.power, 1, 0.001) &&
        closeTo(settled?.stats?.punkDisplay?.scan, 1, 0.001) && scanScreenshot,
        { endpoint:{ power:settled?.stats?.punkDisplay?.power, scan:settled?.stats?.punkDisplay?.scan }, scanScreenshot });
      await captureScreenshot('punk-array-lit-endpoint', settled);
    } else {
      record('A to M reverses the phase and clears the Punk MATRIX display',
        closeTo(settled?.stats?.punkDisplay?.power, 0, 0.001) && closeTo(settled?.stats?.punkDisplay?.scan, 0, 0.001) &&
        settled?.stats?.punkDisplay?.arrayVisible === false && settled?.stats?.punkDisplay?.selectedVisible === false,
        { endpoint:{ power:settled?.stats?.punkDisplay?.power, scan:settled?.stats?.punkDisplay?.scan,
          arrayVisible:settled?.stats?.punkDisplay?.arrayVisible, selectedVisible:settled?.stats?.punkDisplay?.selectedVisible } });
    }
    return settled;
  };

  try {
    await fs.mkdir(screenshotDirectory, { recursive:true });
    const initial = await waitFor(value => value.page === 'music' && value.design === 'archive' && value.scheme === 'archive' &&
      value.viewLayout === 'shelf' && value.caseStructure === 'punk' && value.presentation?.archiveReady === true &&
      value.stats?.punkDisplay?.eligible === true, 'initial Punk ARRAY fixture', 45000, 80);
    const initialPrefs = savedPreferences();
    result.startCamera = { distance:initial.stats?.cameraDistance ?? null,
      fieldOfView:initial.stats?.fieldOfView ?? null, position:initial.stats?.cameraPosition ?? null,
      aim:initial.stats?.cameraAim ?? null };
    record('isolated fixture starts archive Punk ARRAY with automatic entry off',
      initialPrefs.entryOnOpen === false && initialPrefs.style?.design === 'archive' && initialPrefs.view?.layout === 'shelf' &&
      initialPrefs.caseProfiles?.archive?.structure === 'punk' && initialPrefs.caseProfiles?.rhine?.structure === 'punk',
      { entryOnOpen:initialPrefs.entryOnOpen, style:initialPrefs.style, view:initialPrefs.view,
        archiveStructure:initialPrefs.caseProfiles?.archive?.structure, futureStructure:initialPrefs.caseProfiles?.rhine?.structure });
    const firstSelectedId = initial.selectedAlbumId;
    const firstSelectedTitle = initial.selectedAlbumTitle;
    await click('.music-navigation [data-action="next"]');
    const selected = await waitFor(value => value.design === 'archive' && value.viewLayout === 'shelf' &&
      value.selectedAlbumId && value.selectedAlbumId !== firstSelectedId && value.stats?.punkDisplay?.title === value.selectedAlbumTitle,
    'selected Punk title follows the next album', 10000);
    record('multiple ARRAY cases and the selected case show their matching titles',
      selected.libraryAlbumCount === 36 && Number(selected.stats?.punkDisplay?.instanceCount) >= 3 &&
      selected.stats?.punkDisplay?.arrayVisible === true &&
      selected.stats?.punkDisplay?.selectedVisible === true && selected.stats?.punkDisplay?.title === selected.selectedAlbumTitle &&
      selected.selectedAlbumId !== firstSelectedId,
      { firstSelectedId, firstSelectedTitle, selectedAlbumId:selected.selectedAlbumId,
        selectedAlbumTitle:selected.selectedAlbumTitle, displayTitle:selected.stats?.punkDisplay?.title,
        instanceCount:selected.stats?.punkDisplay?.instanceCount, libraryAlbumCount:selected.libraryAlbumCount });
    const initialMount = verifyMount(selected.stats?.punkDisplay?.mount);
    record('top display is mounted on the frame and attached to the right clip', initialMount.ok, initialMount);
    record('Punk ARRAY uses an unlit depth-tested display material without display shadows or PBR',
      selected.stats?.punkDisplay?.material?.type === 'MeshBasicMaterial' &&
      selected.stats?.punkDisplay?.material?.fog === false && selected.stats?.punkDisplay?.material?.toneMapped === false &&
      selected.stats?.punkDisplay?.material?.depthTest === true && selected.stats?.punkDisplay?.material?.depthWrite === true &&
      selected.stats?.punkDisplay?.material?.castShadow === false && selected.stats?.punkDisplay?.material?.receiveShadow === false &&
      selected.stats?.punkDisplay?.material?.pbr === false && selected.stats?.punkDisplay?.material?.reflection === false &&
      selected.stats?.punkDisplay?.material?.refraction === false &&
      selected.stats?.punkDisplay?.material?.renderPass === false && selected.stats?.punkDisplay?.material?.renderTarget === false,
      selected.stats?.punkDisplay?.material);
    const punkArrayPipeline = recordPipeline('Punk ARRAY', selected);
    record('Punk ARRAY uses the six existing renderer passes', Array.isArray(punkArrayPipeline) && punkArrayPipeline.length === 6,
      punkArrayPipeline);
    await captureScreenshot('punk-array-overview', selected);

    const textureWatch = await installTextureWatch();
    record('live WebGL texture upload calls can be observed', textureWatch.ok === true &&
      textureWatch.patched?.includes('texImage2D') && textureWatch.patched?.includes('texSubImage2D'), textureWatch);

    const matrixBeforeEdit = selected.stats?.punkDisplay?.mount?.currentMatrix ?? [];
    await click('[data-action="theme"]');
    await waitFor(value => value.page === 'theme' && value.design === 'archive', 'open Punk STYLE case editor');
    await setPartOffsetX('frame', 0.04);
    await setPartOffsetX('clip', 0.03);
    await click('[data-action="library"]');
    const edited = await waitFor(value => value.page === 'music' && value.design === 'archive' && value.viewLayout === 'shelf' &&
      value.caseStructure === 'punk' && value.stats?.punkDisplay?.eligible === true && value.stats?.punkDisplay?.mount?.currentMatrix,
    'return to Punk ARRAY after frame and clip edits', 18000);
    const editedMount = verifyMount(edited.stats.punkDisplay.mount);
    const matrixMoved = matrixBeforeEdit.length === 16 && maxDifference(matrixBeforeEdit, edited.stats.punkDisplay.mount.currentMatrix) > 0.02;
    const editedPrefs = savedPreferences();
    record('editing frame and clip through STYLE moves the display while preserving both attachments',
      matrixMoved && editedMount.ok && closeTo(preferenceTransformValue(editedPrefs, 'archive', 'punk', 'frame', 0), 0.04, 0.005) &&
      closeTo(preferenceTransformValue(editedPrefs, 'archive', 'punk', 'clip', 0), 0.03, 0.005),
      { matrixMoved, frameOffsetX:preferenceTransformValue(editedPrefs, 'archive', 'punk', 'frame', 0),
        clipOffsetX:preferenceTransformValue(editedPrefs, 'archive', 'punk', 'clip', 0), editedMount });
    await click('.album-actions [data-action="open"]');
    const detail = await waitFor(value => value.page === 'music' && value.presentation?.phase === 'detail' &&
      value.detailHidden === false && value.design === 'archive' && value.caseStructure === 'punk',
    'open the selected Punk case in the native detail view', 18000);
    const rect = detail.canvasRect;
    if (rect && rect.width > 100 && rect.height > 100) {
      const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
      wc.sendInputEvent({ type:'mouseMove', x, y });
      wc.sendInputEvent({ type:'mouseDown', button:'left', clickCount:1, modifiers:['leftbuttondown'], x, y });
      const endX = x + Math.min(86, Math.floor(rect.width * 0.12)), endY = y + 16;
      for (let step = 1; step <= 4; step++) {
        const nextX = Math.round(x + (endX - x) * step / 4), nextY = Math.round(y + (endY - y) * step / 4);
        wc.sendInputEvent({ type:'mouseMove', button:'left', modifiers:['leftbuttondown'], movementX:nextX - x, movementY:nextY - y, x:nextX, y:nextY });
        await pause(18);
      }
      wc.sendInputEvent({ type:'mouseUp', button:'left', clickCount:1, modifiers:[], x:endX, y:endY });
    }
    await pause(700);
    const detailAfterDrag = await state();
    record('selected Punk case remains open for a real detail and seam inspection',
      detailAfterDrag.presentation?.phase === 'detail' && detailAfterDrag.detailHidden === false &&
      detailAfterDrag.stats?.punkDisplay?.title === detailAfterDrag.selectedAlbumTitle,
      { presentation:detailAfterDrag.presentation, title:detailAfterDrag.stats?.punkDisplay?.title,
        selectedAlbumTitle:detailAfterDrag.selectedAlbumTitle });
    await captureScreenshot('punk-detail-frame-glass-and-inner-panel', detailAfterDrag, { cropCanvas:true });
    await click('#music-detail [data-action="back"]');
    await waitFor(value => value.page === 'music' && value.presentation?.phase === 'archive' && value.detailHidden === true &&
      value.viewLayout === 'shelf', 'return from Punk detail to the ARRAY');

    let paletteState = await switchScheme('hazard');
    paletteState = await switchScheme('field');
    const idle = await measureIdleTextureActivity('Punk ARRAY after the Field palette settles', 850);
    record('stable idle Punk ARRAY does not repaint or upload textures per frame', idle.unchanged, idle.sample);

    await clickLayout('array');
    const matrix = await waitFor(value => value.page === 'music' && value.design === 'archive' && value.viewLayout === 'array' &&
      value.stats?.layoutTransition?.active === false && value.caseStructure === 'punk', 'Punk MATRIX endpoint');
    record('Punk MATRIX has no top display', matrix.stats?.punkDisplay?.arrayVisible === false && matrix.stats?.punkDisplay?.selectedVisible === false &&
      Number(matrix.stats?.punkDisplay?.power) === 0 && Number(matrix.stats?.punkDisplay?.scan) === 0,
      { display:matrix.stats?.punkDisplay, q:matrix.stats?.layoutTransition?.q });
    const punkMatrixPipeline = recordPipeline('Punk MATRIX', matrix);
    record('Punk MATRIX keeps the same six renderer passes as Punk ARRAY', pipelineTypes(matrix).join('|') === pipelineTypes(selected).join('|') &&
      punkMatrixPipeline?.length === 6, { array:pipelineTypes(selected), matrix:pipelineTypes(matrix) });
    await captureScreenshot('punk-matrix-no-display', matrix);

    await sampleTransition('shelf', 'punk-m-to-a');
    const reversed = await sampleTransition('array', 'punk-a-to-m');
    record('Punk ARRAY to MATRIX reversal ends with no residual display', reversed.stats?.punkDisplay?.arrayVisible === false &&
      reversed.stats?.punkDisplay?.selectedVisible === false &&
      reversed.stats?.punkDisplay?.power === 0 && reversed.stats?.punkDisplay?.scan === 0,
      reversed.stats?.punkDisplay);

    await click('[data-action="theme"]');
    await waitFor(value => value.page === 'theme' && value.design === 'archive', 'open STYLE to switch to Future');
    await click('[data-style-design="rhine"]');
    await waitFor(value => value.page === 'theme' && value.design === 'rhine', 'switch to Future theme');
    await click('[data-action="library"]');
    await waitFor(value => value.page === 'music' && value.design === 'rhine' &&
      value.presentation?.archiveReady === true, 'Future archive controls are ready', 22000);
    await clickLayout('shelf');
    const futurePunk = await waitFor(value => value.page === 'music' && value.design === 'rhine' && value.viewLayout === 'shelf' &&
      value.caseStructure === 'punk' && value.presentation?.archiveReady === true &&
      value.stats?.layoutTransition?.active === false && value.stats?.punkDisplay?.eligible === false,
    'Future Punk ARRAY has no display', 22000);
    checkNoDisplay(futurePunk, 'Future Punk ARRAY remains unlit with the borrowed Punk case', 'punk');
    const futurePipeline = recordPipeline('Future Punk ARRAY', futurePunk);
    record('Future Punk ARRAY keeps the same six renderer passes', pipelineTypes(futurePunk).join('|') === pipelineTypes(selected).join('|') &&
      futurePipeline?.length === 6, { punkArray:pipelineTypes(selected), futurePunk:pipelineTypes(futurePunk) });
    await captureScreenshot('future-punk-array-no-display', futurePunk);

    await click('[data-action="theme"]');
    await waitFor(value => value.page === 'theme' && value.design === 'rhine', 'open Future STYLE case editor');
    await click('.case-editor__structure[data-structure="rhine"]');
    await waitFor(value => value.page === 'theme' && value.design === 'rhine' && value.caseStructure === 'rhine',
      'Future Rhine case is mounted', 16000);
    await click('[data-action="library"]');
    const futureRhine = await waitFor(value => value.page === 'music' && value.design === 'rhine' && value.viewLayout === 'shelf' &&
      value.caseStructure === 'rhine' && value.presentation?.archiveReady === true &&
      value.stats?.layoutTransition?.active === false && value.stats?.punkDisplay?.eligible === false,
    'Future Rhine ARRAY has no display', 22000);
    checkNoDisplay(futureRhine, 'Future Rhine ARRAY also has no top display', 'rhine');
    const futureRhinePipeline = recordPipeline('Future Rhine ARRAY', futureRhine);
    record('Future Rhine ARRAY keeps the same six renderer passes', pipelineTypes(futureRhine).join('|') === pipelineTypes(selected).join('|') &&
      futureRhinePipeline?.length === 6, { punkArray:pipelineTypes(selected), futureRhine:pipelineTypes(futureRhine) });
    await captureScreenshot('future-rhine-array-no-display', futureRhine);

    result.preferenceState = {
      entryOnOpen:savedPreferences().entryOnOpen,
      design:savedPreferences().style?.design,
      scheme:savedPreferences().style?.scheme,
      view:savedPreferences().view,
      archiveStructure:savedPreferences().caseProfiles?.archive?.structure,
      futureStructure:savedPreferences().caseProfiles?.rhine?.structure,
      archiveFrameTransform:savedPreferences().caseProfiles?.archive?.appearances?.punk?.transforms?.frame ?? null,
      archiveClipTransform:savedPreferences().caseProfiles?.archive?.appearances?.punk?.transforms?.clip ?? null,
    };
    result.renderPassCount = 6;
    result.ok = Object.values(result.assertions).every(Boolean) && result.screenshots.length >= 6 && result.screenshots.length <= 10 &&
      result.renderPipelineSnapshots.every(snapshot => snapshot.passes?.length === 6);
    result.summary = { ok:result.ok, cases:result.cases.length, screenshots:result.screenshots.length,
      transitions:result.transitions.map(item => ({ label:item.label, samples:item.samples.length })),
      paletteSchemes:result.paletteSamples.map(item => item.scheme), textureSamples:result.textureSamples.length,
      renderPassCount:result.renderPassCount };
  } catch (error) {
    result.error = String(error?.stack ?? error);
    result.summary = { ok:false, cases:result.cases.length, screenshots:result.screenshots.length,
      transitions:result.transitions.map(item => ({ label:item.label, samples:item.samples.length })),
      paletteSchemes:result.paletteSamples.map(item => item.scheme), textureSamples:result.textureSamples.length,
      renderPassCount:result.renderPassCount ?? null };
    error.punkCaseDisplayResult = result;
    try { await fs.writeFile(path.join(outputDirectory, 'punk-case-display-report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8'); }
    catch (writeError) { result.reportWriteError = String(writeError?.message ?? writeError); }
    throw error;
  } finally {
    try { await evaluate(`window.__punkCaseDisplayTextureWatch?.restore?.()`); } catch {}
  }
  try {
    await fs.writeFile(path.join(outputDirectory, 'punk-case-display-report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } catch (error) { result.reportWriteError = String(error?.message ?? error); }
  if (!result.ok) {
    const error = new Error(result.error ?? 'Punk case display checks did not pass.');
    error.punkCaseDisplayResult = result;
    throw error;
  }
  return result;
}
