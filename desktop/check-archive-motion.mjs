import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkArchiveMotion({ browserWindow, outputDirectory, probeReport, getPreferences, getReadyCount }) {
  const wc = browserWindow.webContents;
  const screenshotDirectory = path.join(outputDirectory, 'archive-motion');
  const result = { ok: false, cases: [], assertions: {}, screenshots: [], timeline: [], transitionSamples: [],
    geometryFrames:[], flightSamples:[], retargets:[], entryTimeline:[], summary: {} };
  let transitionProbeStartedAt = 0;
  let transitionProbeContext = '';
  let transitionSequence = 0;
  const originalBackgroundThrottling = wc.getBackgroundThrottling?.() ?? true;
  const stateScript = String.raw`(() => {
    const stage = document.querySelector('#stage');
    const app = window.rhineMusic;
    const stats = app?.stats?.() ?? null;
    const canvas = document.querySelector('#three-scene canvas');
    const info = document.querySelector('.foobar-home-info');
    const tools = document.querySelector('.foobar-catalog-tools');
    const workspace = document.querySelector('.foobar-workspace');
    const toolButtons = Array.from(document.querySelectorAll('.foobar-catalog-tools button, .foobar-workspace button, .foobar-workspace [role="button"]'));
    const randomButton = toolButtons.find(button => /\brandom\b/i.test([
      button.textContent, button.getAttribute('aria-label'), button.dataset.action, button.dataset.value,
    ].filter(Boolean).join(' ')));
    const rect = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
    };
    const canvasRect = rect(canvas), infoRect = rect(info), toolsRect = rect(tools);
    const clipPath = canvas ? getComputedStyle(canvas).clipPath : '';
    const clipValues = clipPath.match(/-?\d+(?:\.\d+)?px/g) ?? [];
    const clipRight = /^inset\(/.test(clipPath) && clipValues.length >= 2 ? Number.parseFloat(clipValues[1]) : null;
    const controlFields = ['show','layout','group','sort'];
    const controls = Object.fromEntries(controlFields.map(field => {
      const node = tools?.querySelector('.foobar-tool-group[data-field="' + field + '"]');
      const r = rect(node);
      const visible = !!node && !!r && r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden';
      const buttons = Array.from(node?.querySelectorAll('button') ?? []).map(button => ({
        value: button.dataset.value ?? button.dataset.musicLayout ?? null,
        pressed: button.getAttribute('aria-pressed') === 'true',
        disabled: button.disabled,
      }));
      return [field, { present:!!node, visible, rect:r, buttons }];
    }));
    const viewLayout = stats?.displayLayout?.requested ?? stage?.dataset.musicLayout ?? null;
    const selectedAlbumId = stats?.selectedAlbumId ?? app?.selectedAlbum?.id ?? null;
    const selectedEntryKey = stats?.selectedCell?.foobarEntryKey ?? stats?.catalogFocus?.entryKey ?? null;
    const replay = document.querySelector('[data-action="entry-replay"]');
    const automatic = document.querySelector('#entry-on-open');
    const format = document.querySelector('#selection-format');
    const play = document.querySelector('.album-actions [data-action="play-album"]');
    const open = document.querySelector('.album-actions [data-action="open"]');
    const bleed = getComputedStyle(stage).getPropertyValue('--foobar-scene-bleed').trim();
    const gradient = workspace ? getComputedStyle(workspace, '::before') : null;
    return {
      page:stage?.dataset.page ?? null,
      mode:stage?.dataset.mode ?? null,
      theme:stage?.dataset.theme ?? null,
      design:app?.design?.design ?? stage?.dataset.design ?? null,
      viewLayout,
      legacyLayout:stage?.dataset.foobarLayout ?? null,
      visibility:document.visibilityState,
      viewport:{ width:innerWidth, height:innerHeight },
      stats:stats ? {
        loaded:stats.loaded,
        displayLayout:stats.displayLayout,
        projectedCenter:stats.projectedCenter ?? null,
        selectedAlbumId:stats.selectedAlbumId ?? null,
        selectedCell:stats.selectedCell ?? null,
        frameTime:stats.frameTime ?? null, cameraPosition:stats.cameraPosition ?? null,
        cameraAim:stats.cameraAim ?? null,
        cameraDistance:stats.cameraDistance ?? null, fieldOfView:stats.fieldOfView ?? null,
        cameraNear:stats.cameraNear ?? null, cameraFar:stats.cameraFar ?? null,
        modelPosition:stats.modelPosition ?? null,
        layoutTransition:stats.layoutTransition ?? null,
        shelfEntry:stats.shelfEntry ?? null,
        motionGeometrySamples:stats.motionGeometrySamples ?? [],
        motionViewport:stats.motionViewport ?? null,
        rackDeployment:stats.rackDeployment ?? null,
        rackParts:stats.rackParts ?? [], shelfResources:stats.shelfResources ?? null,
        matrixDrag:stats.matrixDrag ?? null,
        matrixHover:stats.matrixHover ?? null,
        caseStructure:stats.caseStructure ?? null,
        musicPresentationPhase:stats.musicPresentationPhase ?? null,
      } : null,
      selectedAlbumId,
      selectedEntryKey,
      selectedAlbumFromApp:app?.selectedAlbum?.id ?? null,
      entry:app?.entry ?? null,
      presentation:app?.presentation ?? null,
      detailHidden:document.querySelector('#music-detail')?.hidden ?? null,
      settingsHidden:document.querySelector('#music-settings')?.hidden ?? null,
      interfaceCategoryHidden:document.querySelector('.settings-category[data-settings-category="interface"]')?.hidden ?? null,
      entryOnOpenChecked:automatic?.checked ?? null,
      entryOnOpenDisabled:automatic?.disabled ?? null,
      entryReplayDisabled:replay?.disabled ?? null,
      entrySettingsText:document.querySelector('#entry-settings')?.textContent?.trim() ?? null,
      overlayPresent:!!document.querySelector('.future-entry'),
      canvasRect,
      infoRect,
      toolsRect,
      randomButtonRect:rect(randomButton),
      randomButtonLabel:randomButton?.textContent?.trim() ?? randomButton?.getAttribute('aria-label') ?? null,
      canvasClipPath:clipPath,
      canvasClipRight:clipRight,
      canvasVisibleRight:canvasRect && clipRight !== null ? canvasRect.right - clipRight : canvasRect?.right ?? null,
      toolsInfoEdgeDelta:toolsRect && infoRect ? toolsRect.right - infoRect.x : null,
      sceneBleed:bleed,
      blendWidth:gradient ? gradient.width : null,
      blendBackground:gradient ? gradient.backgroundImage : null,
      controls,
      layoutButtons:Array.from(tools?.querySelectorAll('[data-music-layout], [data-value="shelf"], [data-value="array"]') ?? []).map(button => ({
        value:button.dataset.musicLayout ?? button.dataset.value ?? null,
        pressed:button.getAttribute('aria-pressed') === 'true',
        disabled:button.disabled,
      })),
      infoBackground:info ? getComputedStyle(info).backgroundColor : null,
      infoVisible:!!info && !!infoRect && infoRect.width > 0 && getComputedStyle(info).visibility !== 'hidden',
      formatText:format?.textContent?.trim() ?? '',
      formatVisible:!!format && !format.hidden && getComputedStyle(format).display !== 'none' && format.textContent.trim().length > 0,
      playAction:!!play,
      openAction:!!open,
      toolbarOverflowX:tools ? getComputedStyle(tools).overflowX : null,
      toolbarScrollWidth:tools?.scrollWidth ?? null,
      toolbarClientWidth:tools?.clientWidth ?? null,
    };
  })()`;
  const evaluate = script => wc.executeJavaScript(script, true);
  const transitionStateScript = String.raw`(() => {
    const stage = document.querySelector('#stage');
    const app = window.rhineMusic;
    const stats = app?.stats?.() ?? null;
    return {
      page:stage?.dataset.page ?? null,
      mode:stage?.dataset.mode ?? null,
      design:app?.design?.design ?? stage?.dataset.design ?? null,
      viewLayout:stats?.displayLayout?.requested ?? stage?.dataset.musicLayout ?? null,
      selectedAlbumId:stats?.selectedAlbumId ?? app?.selectedAlbum?.id ?? null,
      selectedEntryKey:stats?.selectedCell?.foobarEntryKey ?? null,
      entry:app?.entry ? { active:app.entry.active, time:app.entry.time, phase:app.entry.phase } : null,
      stats:stats ? { layoutTransition:stats.layoutTransition, shelfEntry:stats.shelfEntry ?? null,
        selectedCell:stats.selectedCell ?? null, frameTime:stats.frameTime ?? null, motionViewport:stats.motionViewport ?? null,
        cameraPosition:stats.cameraPosition ?? null, cameraAim:stats.cameraAim ?? null,
        cameraDistance:stats.cameraDistance ?? null, fieldOfView:stats.fieldOfView ?? null,
        cameraNear:stats.cameraNear ?? null, cameraFar:stats.cameraFar ?? null,
        modelPosition:stats.modelPosition ?? null, motionGeometrySamples:stats.motionGeometrySamples ?? [],
        rackDeployment:stats.rackDeployment ?? null, rackParts:stats.rackParts ?? [], shelfResources:stats.shelfResources ?? null,
        musicPresentationPhase:stats.musicPresentationPhase } : null,
    };
  })()`;
  const geometryStateScript = String.raw`(() => {
    const stage = document.querySelector('#stage');
    const app = window.rhineMusic;
    const stats = app?.stats?.(true) ?? null;
    return {
      page:stage?.dataset.page ?? null,
      mode:stage?.dataset.mode ?? null,
      design:app?.design?.design ?? stage?.dataset.design ?? null,
      viewLayout:stats?.displayLayout?.requested ?? stage?.dataset.musicLayout ?? null,
      selectedAlbumId:stats?.selectedAlbumId ?? app?.selectedAlbum?.id ?? null,
      selectedEntryKey:stats?.selectedCell?.foobarEntryKey ?? null,
      stats:stats ? { layoutTransition:stats.layoutTransition, frameTime:stats.frameTime ?? null,
        shelfEntry:stats.shelfEntry ?? null,
        selectedCell:stats.selectedCell ?? null,
        motionGeometry:stats.motionGeometry ?? null, motionGeometrySamples:stats.motionGeometrySamples ?? [],
        motionViewport:stats.motionViewport ?? null, cameraPosition:stats.cameraPosition ?? null,
        cameraAim:stats.cameraAim ?? null, cameraDistance:stats.cameraDistance ?? null,
        fieldOfView:stats.fieldOfView ?? null, cameraNear:stats.cameraNear ?? null, cameraFar:stats.cameraFar ?? null,
        modelPosition:stats.modelPosition ?? null,
        rackDeployment:stats.rackDeployment ?? null, rackParts:stats.rackParts ?? [],
        shelfResources:stats.shelfResources ?? null } : null,
    };
  })()`;
  const snapshot = async () => {
    try { return await evaluate(stateScript); }
    catch (error) { return { sampleError:String(error?.message ?? error) }; }
  };
  const fastSnapshot = async () => {
    try { return await evaluate(transitionStateScript); }
    catch (error) { return { sampleError:String(error?.message ?? error) }; }
  };
  const geometrySnapshot = async () => {
    try { return await evaluate(geometryStateScript); }
    catch (error) { return { sampleError:String(error?.message ?? error) }; }
  };
  const waitFor = async (predicate, label, timeoutMs = 12000, intervalMs = 35) => {
    const deadline = Date.now() + timeoutMs;
    let latest;
    while (Date.now() < deadline) {
      latest = await snapshot();
      if (!latest.sampleError && predicate(latest)) return latest;
      await pause(intervalMs);
    }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(latest)}`);
  };
  const waitForFast = async (predicate, label, timeoutMs = 12000, intervalMs = 12) => {
    const deadline = Date.now() + timeoutMs;
    let latest;
    while (Date.now() < deadline) {
      const sampleStartedAt = Date.now();
      latest = await fastSnapshot();
      if (transitionProbeStartedAt) {
        const transition = latest.stats?.layoutTransition ?? {};
        result.transitionSamples.push({ context:transitionProbeContext,
          sinceClickMs:Date.now() - transitionProbeStartedAt, sampleMs:Date.now() - sampleStartedAt,
          active:transition.active ?? null, progress:transition.progress ?? null,
          q:transition.q ?? null, qVelocity:transition.qVelocity ?? null, desiredEnd:transition.desiredEnd ?? null,
          phase:transition.phase ?? null, path:transition.path ?? null, heading:transition.heading ?? null,
          rowSpacing:transition.rowSpacing ?? null, transitionRackDeployment:transition.rackDeployment ?? null,
          geometric:transition.geometric ?? null, frameTime:latest.stats?.frameTime ?? null, cameraPosition:latest.stats?.cameraPosition ?? null,
          cameraAim:latest.stats?.cameraAim ?? null, modelPosition:latest.stats?.modelPosition ?? null,
          cameraDistance:latest.stats?.cameraDistance ?? null, fieldOfView:latest.stats?.fieldOfView ?? null,
          cameraNear:latest.stats?.cameraNear ?? null, cameraFar:latest.stats?.cameraFar ?? null,
          rackDeployment:latest.stats?.rackDeployment ?? null,
          rackFlight:transition.rackFlight ?? null,
          motionGeometrySamples:latest.stats?.motionGeometrySamples ?? [],
          motionViewport:latest.stats?.motionViewport ?? null, layout:latest.viewLayout ?? null });
      }
      if (!latest.sampleError && predicate(latest)) return latest;
      await pause(intervalMs);
    }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(latest)}`);
  };
  const click = async selector => {
    const clicked = await evaluate(`(() => {
      const selector = ${JSON.stringify(selector)};
      const node = document.querySelector(selector);
      if (!node || node.disabled) return false;
      node.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Missing or disabled archive motion control: ${selector}`);
  };
  const record = (name, passed, detail = null) => {
    result.assertions[name] = Boolean(passed);
    result.cases.push({ name, ok:Boolean(passed), ...(detail === null ? {} : { detail }) });
    assert.ok(passed, `${name}${detail === null ? '' : ': ' + JSON.stringify(detail)}`);
  };
  const recordObserved = (name, passed, detail = null) => {
    result.assertions[name] = Boolean(passed);
    result.cases.push({ name, ok:Boolean(passed), ...(detail === null ? {} : { detail }) });
  };
  const shortState = state => ({
    design:state.design, page:state.page, viewLayout:state.viewLayout,
    selectedAlbumId:state.selectedAlbumId, selectedEntryKey:state.selectedEntryKey,
    transition:state.stats?.layoutTransition, shelfEntry:state.stats?.shelfEntry,
    matrixDrag:state.stats?.matrixDrag,
    matrixHover:state.stats?.matrixHover, entry:state.entry,
  });
  const transitionStamp = state => {
    const transition = state?.stats?.layoutTransition ?? {};
    return { wallClockMs:Date.now(), frameTime:state?.stats?.frameTime ?? null, active:transition.active ?? null,
      q:transition.q ?? null, progress:transition.progress ?? null, phase:transition.phase ?? null,
      desiredEnd:transition.desiredEnd ?? null, path:transition.path ?? null,
      cameraPosition:state?.stats?.cameraPosition ?? null, cameraAim:state?.stats?.cameraAim ?? null,
      cameraDistance:state?.stats?.cameraDistance ?? null, fieldOfView:state?.stats?.fieldOfView ?? null,
      cameraNear:state?.stats?.cameraNear ?? null, cameraFar:state?.stats?.cameraFar ?? null,
      rackFlight:transition.rackFlight ?? null, rackDeployment:state?.stats?.rackDeployment ?? null,
      viewLayout:state?.viewLayout ?? null };
  };
  const takeScreenshot = async (name, details = null, settleMs = 100, captureTransitionClock = false) => {
    let uniqueName = name, suffix = 2;
    while (result.screenshots.some(screenshot => screenshot.name === uniqueName)) uniqueName = `${name}-${suffix++}`;
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    if (settleMs > 0) await pause(settleMs);
    const captureBefore = captureTransitionClock ? transitionStamp(await fastSnapshot()) : null;
    const image = await browserWindow.capturePage();
    const captureAfter = captureTransitionClock ? transitionStamp(await fastSnapshot()) : null;
    const file = path.join(screenshotDirectory, `${uniqueName}.png`);
    await fs.writeFile(file, image.toPNG());
    const screenshotDetails = details === null ? {} : { ...details };
    if (captureTransitionClock) {
      screenshotDetails.captureBefore = captureBefore;
      screenshotDetails.captureAfter = captureAfter;
    }
    result.screenshots.push({ name:uniqueName, ...(uniqueName !== name ? { requestedName:name } : {}), file, size:image.getSize(),
      ...(details === null && !captureTransitionClock ? {} : { details:screenshotDetails }) });
    process.stdout.write(`ARCHIVE_MOTION_SCREENSHOT:${file}\n`);
    return file;
  };
  const layoutSelector = layout => `.foobar-catalog-tools .foobar-tool-group[data-field="layout"] [data-music-layout="${layout}"], .foobar-catalog-tools .foobar-tool-group[data-field="layout"] [data-value="${layout}"], #music-browse [data-music-layout="${layout}"]`;
  const clickLayout = async layout => click(layoutSelector(layout));
  const retargetLayoutAtomically = async layout => {
    const selector = layoutSelector(layout);
    const script = `(() => {
      const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return !node.disabled && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (!node) return { clicked:false, reason:'missing visible enabled layout control' };
      const before = (${geometryStateScript});
      node.click();
      const after = (${geometryStateScript});
      return { clicked:true, before, after };
    })()`;
    const captured = await evaluate(script);
    if (!captured?.clicked) throw new Error(`Could not atomically retarget archive layout: ${captured?.reason ?? selector}`);
    return captured;
  };
  const identityMatches = (state, identity) => state.selectedAlbumId === identity.selectedAlbumId &&
    state.selectedEntryKey === identity.selectedEntryKey && !!state.selectedEntryKey;
  const xyz = value => Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)
    ? value.slice(0, 3).map(Number) : null;
  const geometryPoseMap = samples => new Map((Array.isArray(samples) ? samples : [])
    .filter(sample => sample && (sample.id || sample.motionId || sample.entry || sample.cell) && xyz(sample.position) && xyz(sample.scale))
    .map(sample => [sample.id || sample.motionId || sample.entry || sample.cell,
      { position:xyz(sample.position), scale:xyz(sample.scale) }]));
  const compareGeometry = (left, right) => {
    const a = geometryPoseMap(left?.motionGeometrySamples ?? left?.stats?.motionGeometrySamples);
    const b = geometryPoseMap(right?.motionGeometrySamples ?? right?.stats?.motionGeometrySamples);
    const changes = [];
    for (const [key, pose] of a) {
      const next = b.get(key);
      if (!next) continue;
      const positionDelta = Math.hypot(...pose.position.map((value, index) => value - next.position[index]));
      const scaleDelta = Math.hypot(...pose.scale.map((value, index) => value - next.scale[index]));
      changes.push({ key, positionDelta, scaleDelta, delta:Math.hypot(positionDelta, scaleDelta) });
    }
    return { matchedCount:changes.length, changedCount:changes.filter(change => change.delta > 0.04).length,
      maxDelta:changes.reduce((maximum, change) => Math.max(maximum, change.delta), 0) };
  };
  const actualMatrixMap = state => new Map((Array.isArray(state?.stats?.motionGeometry?.instances)
    ? state.stats.motionGeometry.instances : []).filter(instance => instance?.id && Array.isArray(instance.matrix) &&
      instance.matrix.length === 16 && instance.matrix.every(Number.isFinite)).map(instance => [instance.id, instance.matrix]));
  const compareActualMatrices = (left, right) => {
    const a = actualMatrixMap(left), b = actualMatrixMap(right), deltas = [];
    for (const [id, matrix] of a) {
      const next = b.get(id);
      if (next) deltas.push({ id, maxElementDelta:Math.max(...matrix.map((value, index) => Math.abs(value - next[index]))) });
    }
    const selectedA = left?.stats?.motionGeometry?.selectedMatrix;
    const selectedB = right?.stats?.motionGeometry?.selectedMatrix;
    const selectedMatrixDelta = Array.isArray(selectedA) && selectedA.length === 16 &&
      Array.isArray(selectedB) && selectedB.length === 16
      ? Math.max(...selectedA.map((value, index) => Math.abs(value - selectedB[index]))) : null;
    return { matchedCount:deltas.length, maxElementDelta:deltas.reduce((maximum, value) => Math.max(maximum, value.maxElementDelta), 0),
      selectedMatrixDelta };
  };
  const viewportAudit = viewport => {
    const width = Number(viewport?.width), height = Number(viewport?.height), bounds = viewport?.bounds;
    const corners = Array.isArray(viewport?.selectedCorners) ? viewport.selectedCorners : [];
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
        !bounds || !['minX','maxX','minY','maxY'].every(key => Number.isFinite(Number(bounds[key]))) ||
        corners.length !== 8 || !corners.every(point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite)))
      return { ok:false, cornerCount:corners.length, viewport, reason:'missing or malformed projection data' };
    const pixelBounds = { minX:(Number(bounds.minX) + 1) * width / 2,
      maxX:(Number(bounds.maxX) + 1) * width / 2,
      minY:(1 - Number(bounds.maxY)) * height / 2,
      maxY:(1 - Number(bounds.minY)) * height / 2 };
    const marginPx = 6;
    const outsideCorners = corners.map((point, index) => ({ index, x:point[0], y:point[1] }))
      .filter(point => point.x < pixelBounds.minX - marginPx || point.x > pixelBounds.maxX + marginPx ||
        point.y < pixelBounds.minY - marginPx || point.y > pixelBounds.maxY + marginPx);
    return { ok:outsideCorners.length === 0, cornerCount:corners.length, outsideCorners, pixelBounds, marginPx };
  };
  const viewportPixelBounds = viewport => {
    const width = Number(viewport?.width), height = Number(viewport?.height), bounds = viewport?.bounds;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
        !bounds || !['minX','maxX','minY','maxY'].every(key => Number.isFinite(Number(bounds[key])))) return null;
    return { minX:(Number(bounds.minX) + 1) * width / 2,
      maxX:(Number(bounds.maxX) + 1) * width / 2,
      minY:(1 - Number(bounds.maxY)) * height / 2,
      maxY:(1 - Number(bounds.minY)) * height / 2 };
  };
  const centerInsideViewport = (center, viewport) => {
    const bounds = viewportPixelBounds(viewport);
    if (!bounds || !Array.isArray(center) || center.length < 2 ||
        !Number.isFinite(Number(center[0])) || !Number.isFinite(Number(center[1]))) return false;
    const [x, y] = center.map(Number);
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  };
  const neighborMotionAudit = samples => {
    const allProjectedSpeeds = [], visibleSpeeds = [];
    for (let index = 1; index < samples.length; index++) {
      const previous = samples[index - 1], current = samples[index];
      const seconds = Number(current.frameTime) - Number(previous.frameTime);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;
      const previousNeighbors = new Map((previous.motionViewport?.neighbors ?? [])
        .filter(neighbor => neighbor?.id && Array.isArray(neighbor.center) && neighbor.center.length >= 2)
        .map(neighbor => [neighbor.id, neighbor]));
      for (const neighbor of current.motionViewport?.neighbors ?? []) {
        const before = previousNeighbors.get(neighbor?.id);
        if (!before || !Array.isArray(neighbor.center) || neighbor.center.length < 2) continue;
        const pxDelta = Math.hypot(Number(neighbor.center[0]) - Number(before.center[0]),
          Number(neighbor.center[1]) - Number(before.center[1]));
        if (!Number.isFinite(pxDelta)) continue;
        const speed = { id:neighbor.id, entry:neighbor.entry ?? null, pxPerSecond:pxDelta / seconds };
        allProjectedSpeeds.push(speed);
        if (seconds < 0.1 && centerInsideViewport(before.center, previous.motionViewport) &&
            centerInsideViewport(neighbor.center, current.motionViewport)) visibleSpeeds.push(speed);
      }
    }
    const summarize = speeds => {
      const sorted = speeds.map(item => item.pxPerSecond).sort((left, right) => left - right);
      const byId = new Map();
      for (const speed of speeds) {
        const old = byId.get(speed.id) ?? { id:speed.id, entry:speed.entry, sampleCount:0, maxPxPerSecond:0 };
        old.sampleCount++;
        old.maxPxPerSecond = Math.max(old.maxPxPerSecond, speed.pxPerSecond);
        byId.set(speed.id, old);
      }
      const percentile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : null;
      return { pairCount:speeds.length, medianPxPerSecond:percentile(.5), p95PxPerSecond:percentile(.95),
        maxPxPerSecond:sorted.at(-1) ?? null,
        byId:[...byId.values()].sort((a, b) => b.maxPxPerSecond - a.maxPxPerSecond).slice(0, 8) };
    };
    const allProjected = summarize(allProjectedSpeeds), visible = summarize(visibleSpeeds);
    return { ...allProjected, allProjected, visible,
      visibleCriteria:{ bothCentersInsideTheirFrameBounds:true, maxAdjacentFrameTimeSecondsExclusive:0.1 } };
  };
  const distance3 = (left, right) => {
    const a = xyz(left), b = xyz(right);
    return a && b ? Math.hypot(...a.map((value, index) => value - b[index])) : null;
  };
  const transformPoint = (point, matrix) => [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
  const matrixScale = matrix => Array.isArray(matrix) && matrix.length === 16 && matrix.every(Number.isFinite)
    ? [Math.hypot(matrix[0], matrix[1], matrix[2]), Math.hypot(matrix[4], matrix[5], matrix[6]),
      Math.hypot(matrix[8], matrix[9], matrix[10])] : null;
  const boundsPoints = bounds => {
    const min = xyz(bounds?.min), max = xyz(bounds?.max);
    if (!min || !max) return null;
    return [min[0], max[0]].flatMap(x => [min[1], max[1]].flatMap(y => [min[2], max[2]].map(z => [x, y, z])));
  };
  const projectWorldBounds = (points, state) => {
    const stats = state?.stats ?? state;
    const viewport = stats?.motionViewport ?? state?.viewport;
    const position = xyz(stats?.cameraPosition), aim = xyz(stats?.cameraAim);
    const width = Number(viewport?.width), height = Number(viewport?.height);
    const fov = Number(stats?.fieldOfView), near = Math.max(1e-4, Number(stats?.cameraNear) || .1);
    const far = Number(stats?.cameraFar) > near ? Number(stats.cameraFar) : Infinity;
    if (!position || !aim || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
        !Number.isFinite(fov) || fov <= 0 || !Array.isArray(points) || points.length !== 8) return null;
    const norm = vector => Math.hypot(...vector);
    const unit = vector => { const length = norm(vector); return length > 1e-8 ? vector.map(value => value / length) : null; };
    const forward = unit(aim.map((value, index) => value - position[index]));
    if (!forward) return null;
    const right = unit([-forward[2], 0, forward[0]]);
    if (!right) return null;
    const up = unit([right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]]);
    if (!up) return null;
    const tangent = Math.tan(fov * Math.PI / 360), aspect = width / height;
    const cameraPoints = points.map(point => {
      const relative = point.map((value, index) => value - position[index]);
      const depth = relative.reduce((sum, value, index) => sum + value * forward[index], 0);
      return { x:relative.reduce((sum, value, index) => sum + value * right[index], 0),
        y:relative.reduce((sum, value, index) => sum + value * up[index], 0), depth };
    });
    const depthMin = Math.min(...cameraPoints.map(point => point.depth)), depthMax = Math.max(...cameraPoints.map(point => point.depth));
    const clipped = cameraPoints.filter(point => point.depth >= near && point.depth <= far);
    const edges = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
    for (const [leftIndex, rightIndex] of edges) {
      const left = cameraPoints[leftIndex], rightPoint = cameraPoints[rightIndex];
      for (const plane of [near, far]) {
        if (!Number.isFinite(plane) || (left.depth - plane) * (rightPoint.depth - plane) >= 0 ||
            Math.abs(rightPoint.depth - left.depth) < 1e-9) continue;
        const t = (plane - left.depth) / (rightPoint.depth - left.depth);
        clipped.push({ x:left.x + (rightPoint.x - left.x) * t, y:left.y + (rightPoint.y - left.y) * t, depth:plane });
      }
    }
    if (!clipped.length) return { valid:true, intersectsFrustum:false, depthMin, depthMax,
      allInFront:depthMin >= near };
    const projected = clipped.map(point => [point.x / (point.depth * tangent * aspect), point.y / (point.depth * tangent)]);
    const minX = Math.min(...projected.map(point => point[0])), maxX = Math.max(...projected.map(point => point[0]));
    const minY = Math.min(...projected.map(point => point[1])), maxY = Math.max(...projected.map(point => point[1]));
    return { valid:true, intersectsFrustum:depthMax >= near && depthMin <= far && maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1,
      allInFront:depthMin >= near, depthMin, depthMax, minX, maxX, minY, maxY };
  };
  const transformedBounds = (bounds, matrix) => {
    const points = boundsPoints(bounds);
    if (!points || !Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(Number.isFinite)) return null;
    const worldPoints = points.map(point => transformPoint(point, matrix));
    const center = worldPoints.reduce((sum, point) => sum.map((value, index) => value + point[index] / worldPoints.length), [0, 0, 0]);
    return { points:worldPoints, center,
      min:center.map((_, axis) => Math.min(...worldPoints.map(point => point[axis]))),
      max:center.map((_, axis) => Math.max(...worldPoints.map(point => point[axis]))) };
  };
  const visibleEntryOwners = state => {
    const stats = state?.stats ?? state;
    const geometry = stats?.motionGeometry ?? {};
    const bounds = geometry.bounds ?? state?.caseBounds;
    const instances = Array.isArray(geometry.instances) ? geometry.instances
      : Array.isArray(state?.instanceOwners) ? state.instanceOwners : [];
    const visible = new Map();
    for (const instance of instances) {
      const cell = instance?.cell, entry = String(instance?.entry ?? cell?.foobarEntryKey ?? '');
      const lane = Number(cell?.lane), row = Number(cell?.row);
      if (!entry || !Number.isFinite(lane) || !Number.isFinite(row)) continue;
      const world = transformedBounds(bounds, instance.matrix);
      const projected = world ? projectWorldBounds(world.points, state) : null;
      if (!projected?.intersectsFrustum) continue;
      const cellKey = `${lane}:${row}`, key = `${cellKey}|${entry}`;
      visible.set(key, { key, cellKey, entry, id:instance.id ?? null, route:instance.route ?? null,
        matrix:instance.matrix, projectedBounds:{ minX:projected.minX, maxX:projected.maxX,
          minY:projected.minY, maxY:projected.maxY, depthMin:projected.depthMin, depthMax:projected.depthMax } });
    }
    return visible;
  };
  const ownerMap = state => new Map((state?.stats?.motionGeometry?.instances ?? []).filter(instance =>
    Array.isArray(instance?.matrix) && instance.matrix.length === 16 && instance.matrix.every(Number.isFinite) &&
    Number.isFinite(Number(instance?.cell?.lane)) && Number.isFinite(Number(instance?.cell?.row)) &&
    (instance?.entry || instance?.cell?.foobarEntryKey)).map(instance => {
      const entry = String(instance.entry ?? instance.cell.foobarEntryKey);
      const cell = `${Number(instance.cell.lane)}:${Number(instance.cell.row)}`;
      const route = instance.route ? { segment:instance.route.segment ?? null, core:instance.route.core ?? null,
        hasArray:instance.route.hasArray ?? null, hasMatrix:instance.route.hasMatrix ?? null } : null;
      return [instance.id || `${entry}|${cell}`, { id:instance.id ?? null, entry, cell, route, matrix:instance.matrix }];
    }));
  const ownerContinuityAudit = samples => {
    const owners = new Map(), changes = [];
    for (const sample of samples) for (const [key, owner] of ownerMap(sample)) {
      const previous = owners.get(key);
      if (previous && (previous.entry !== owner.entry || previous.cell !== owner.cell ||
          JSON.stringify(previous.route) !== JSON.stringify(owner.route)))
        changes.push({ id:key, before:{ entry:previous.entry, cell:previous.cell, route:previous.route },
          after:{ entry:owner.entry, cell:owner.cell, route:owner.route }, q:sample.q });
      else owners.set(key, owner);
    }
    return { checkedIds:owners.size, ownerChanges:changes };
  };
  const captureFlightSample = async (context, requestedQ, endpoint = false) => {
    const state = await geometrySnapshot(), transition = state.stats?.layoutTransition ?? {}, geometry = state.stats?.motionGeometry ?? {};
    const instances = Array.isArray(geometry.instances) ? geometry.instances : [];
    const selectedMatrix = geometry.selectedMatrix;
    const selectedBounds = transformedBounds(geometry.bounds, selectedMatrix);
    const selectedScale = matrixScale(selectedMatrix);
    const projectedHeroBounds = selectedBounds ? projectWorldBounds(selectedBounds.points, state) : null;
    const projection = boundsPoints(geometry.bounds);
    const fullSizeOffscreenGhosts = projection ? instances.filter(instance => {
      if (!instance?.entry || instance.entry === state.selectedEntryKey || instance.route?.core !== false) return false;
      const scale = matrixScale(instance.matrix), world = transformedBounds(geometry.bounds, instance.matrix);
      const box = world ? projectWorldBounds(world.points, state) : null;
      return scale?.every(value => Math.abs(value - 1) <= .06) && box?.valid &&
        (box.maxX < -1 || box.minX > 1 || box.maxY < -1 || box.minY > 1);
    }).map(instance => ({ id:instance.id ?? null, entry:instance.entry, cell:instance.cell,
      route:instance.route ?? null, scale:matrixScale(instance.matrix) })) : [];
    const coreInstances = instances.filter(instance => instance.route?.core === true);
    const coreScaleFailures = coreInstances.filter(instance => !matrixScale(instance.matrix)?.every(value =>
      Number.isFinite(value) && Math.abs(value - 1) <= .06)).map(instance => ({ id:instance.id ?? null,
        entry:instance.entry ?? instance.cell?.foobarEntryKey ?? null, cell:instance.cell ?? null,
        scale:matrixScale(instance.matrix) }));
    const visibleEntries = [...visibleEntryOwners(state).values()].map(owner => ({
      key:owner.key, cellKey:owner.cellKey, entry:owner.entry, id:owner.id, route:owner.route,
      projectedBounds:owner.projectedBounds }));
    const rackFlight = transition.rackFlight ?? null;
    const sample = {
      context, requestedQ, endpoint, q:Number(transition.q), progress:Number(transition.progress), desiredEnd:Number(transition.desiredEnd),
      phase:transition.phase ?? null, path:transition.path ?? null, heading:Number(transition.heading),
      rowSpacing:Number(transition.rowSpacing), frameTime:state.stats?.frameTime ?? null,
      selectedAlbumId:state.selectedAlbumId, selectedEntryKey:state.selectedEntryKey,
      selectedCell:state.stats?.selectedCell ?? null, cameraPosition:xyz(state.stats?.cameraPosition),
      cameraAim:xyz(state.stats?.cameraAim), cameraDistance:Number(state.stats?.cameraDistance),
      fieldOfView:Number(state.stats?.fieldOfView), cameraNear:Number(state.stats?.cameraNear), cameraFar:Number(state.stats?.cameraFar),
      caseBounds:geometry.bounds ?? null, cameraToHeroDistance:selectedBounds && state.stats?.cameraPosition
        ? Math.hypot(...selectedBounds.center.map((value, index) => value - Number(state.stats.cameraPosition[index]))) : null,
      heroWorldCenter:selectedBounds?.center ?? null, heroWorldBounds:selectedBounds ? { min:selectedBounds.min, max:selectedBounds.max } : null,
      heroProjectedBounds:projectedHeroBounds, selectedScale, rackDeployment:Number(state.stats?.rackDeployment),
      rackResources:state.stats?.shelfResources ?? null, rackParts:state.stats?.rackParts ?? [], rackFlight,
      motionViewport:state.stats?.motionViewport ?? null, instanceCount:instances.length,
      instanceOwners:instances.map(instance => ({ id:instance.id ?? null, entry:instance.entry ?? instance.cell?.foobarEntryKey ?? null,
        cell:instance.cell ? { lane:instance.cell.lane, row:instance.cell.row } : null,
        route:instance.route ?? null, matrix:instance.matrix })),
      coreRouteCount:coreInstances.length, coreScaleFailures,
      visibleEntries,
      fullSizeOffscreenGhostCount:fullSizeOffscreenGhosts.length, fullSizeOffscreenGhosts,
      sampleError:state.sampleError ?? null,
    };
    result.flightSamples.push(sample);
    result.geometryFrames.push({ context, q:sample.q, requestedQ, endpoint, frameTime:sample.frameTime,
      selectedAlbumId:sample.selectedAlbumId, selectedEntryKey:sample.selectedEntryKey,
      heroWorldBounds:sample.heroWorldBounds, instanceCount:sample.instanceCount, rackFlight });
    return sample;
  };
  const auditFlight = (context, target, requestedQValues, identity) => {
    const samples = result.transitionSamples.filter(sample => sample.context === context && sample.active === true &&
      Number.isFinite(sample.progress));
    const actual = result.flightSamples.filter(sample => sample.context === context);
    const requested = actual.filter(sample => !sample.endpoint);
    const activeTarget = target === 'array' ? 1 : 0;
    const canonicalDirection = target === 'array' ? 1 : -1;
    const progressInBounds = samples.length > 0 && samples.every(sample => sample.progress >= 0 && sample.progress <= 1);
    const progressMonotonic = samples.every((sample, index) => index === 0 || sample.progress + .015 >= samples[index - 1].progress);
    const qMonotonic = samples.every((sample, index) => index === 0 ||
      (canonicalDirection > 0 ? sample.q + .015 >= samples[index - 1].q : sample.q - .015 <= samples[index - 1].q));
    const pathIsCameraOrbit = samples.length > 0 && samples.every(sample => sample.path === 'camera-orbit') &&
      requested.every(sample => sample.path === 'camera-orbit');
    const allIdentityStable = actual.length >= requestedQValues.length && actual.every(sample =>
      sample.selectedAlbumId === identity.selectedAlbumId && sample.selectedEntryKey === identity.selectedEntryKey &&
      (sample.selectedCell?.foobarEntryKey == null || sample.selectedCell.foobarEntryKey === identity.selectedEntryKey));
    const qCoverage = requestedQValues.map(q => ({ requested:q,
      observed:requested.find(sample => Math.abs(sample.q - q) <= .022)?.q ?? null }));
    const qCoverageOkay = qCoverage.every(sample => Number.isFinite(sample.observed));
    const sourceQ = activeTarget === 1 ? 0 : 1, targetQ = activeTarget;
    const sourceEndpoint = actual.find(sample => sample.endpoint && Math.abs(sample.q - sourceQ) <= .001);
    const targetEndpoint = actual.find(sample => sample.endpoint && Math.abs(sample.q - targetQ) <= .001);
    const sourceVisible = sourceEndpoint ? visibleEntryOwners(sourceEndpoint) : new Map();
    const targetVisible = targetEndpoint ? visibleEntryOwners(targetEndpoint) : new Map();
    const sourceVisibleEntries = new Set([...sourceVisible.values()].map(owner => owner.entry));
    const targetVisibleEntries = new Set([...targetVisible.values()].map(owner => owner.entry));
    const sourceRouteKey = sourceQ === 0 ? 'hasArray' : 'hasMatrix';
    const targetRouteKey = targetQ === 0 ? 'hasArray' : 'hasMatrix';
    const routeCoverage = requested.map(sample => {
      const routesByEntry = new Map();
      for (const owner of sample.instanceOwners ?? []) {
        const entry = String(owner.entry ?? '');
        if (!entry || !owner.route) continue;
        const list = routesByEntry.get(entry) ?? [];
        list.push(owner.route); routesByEntry.set(entry, list);
      }
      return { q:sample.q,
        missingSource: [...sourceVisibleEntries].filter(entry => !routesByEntry.get(entry)?.some(route => route[sourceRouteKey] === true)),
        missingTarget: [...targetVisibleEntries].filter(entry => !routesByEntry.get(entry)?.some(route => route[targetRouteKey] === true)) };
    });
    const allVisibleEndpointEntriesRouted = sourceVisibleEntries.size > 0 && targetVisibleEntries.size > 0 &&
      routeCoverage.every(sample => sample.missingSource.length === 0 && sample.missingTarget.length === 0);
    const orderedByQ = [...actual].sort((a, b) => a.q - b.q);
    const cameraY = orderedByQ.map(sample => sample.cameraPosition?.[1]);
    const cameraYMonotonic = cameraY.length >= 3 && cameraY.every(Number.isFinite) && cameraY.slice(1).every((value, index) => value <= cameraY[index] + .08);
    const cameraYLowerAtMatrix = orderedByQ.length >= 2 && orderedByQ.at(-1).cameraPosition?.[1] < orderedByQ[0].cameraPosition?.[1] - .05;
    const cameraDistance = orderedByQ.map(sample => sample.cameraDistance);
    const pullsBackMonotonic = cameraDistance.length >= 3 && cameraDistance.every(Number.isFinite) &&
      cameraDistance.slice(1).every((value, index) => value + .08 >= cameraDistance[index]);
    const pullsBackAtMatrix = cameraDistance.length >= 2 && cameraDistance.at(-1) > cameraDistance[0] + .5;
    const heroDistances = orderedByQ.map(sample => sample.cameraToHeroDistance);
    const heroDistanceFacts = heroDistances.every(Number.isFinite) ? { array:heroDistances[0], matrix:heroDistances.at(-1) } : null;
    const heroDistanceMonotonic = heroDistances.length >= 3 && heroDistances.every(Number.isFinite) &&
      heroDistances.slice(1).every((value, index) => value + .08 >= heroDistances[index]);
    const heroDistanceGrows = heroDistances.length >= 2 && heroDistances.at(-1) > heroDistances[0] + .5;
    const cameraYaw = orderedByQ.map(sample => sample.cameraPosition && sample.cameraAim
      ? Math.atan2(sample.cameraPosition[0] - sample.cameraAim[0], sample.cameraPosition[2] - sample.cameraAim[2]) : NaN);
    let yawTrack = 0, previousYaw = null;
    const unwrappedYaw = cameraYaw.map(yaw => {
      if (previousYaw !== null) yawTrack += Math.atan2(Math.sin(yaw - previousYaw), Math.cos(yaw - previousYaw));
      previousYaw = yaw; return yawTrack;
    });
    const cameraYawDelta = unwrappedYaw.length > 1 ? unwrappedYaw.at(-1) - unwrappedYaw[0] : NaN;
    const cameraOrbits = Number.isFinite(cameraYawDelta) && Math.abs(cameraYawDelta) > .02 && Math.abs(cameraYawDelta) < Math.PI + .05;
    const headingValues = actual.map(sample => sample.heading);
    const maxAbsoluteHeading = headingValues.length ? Math.max(...headingValues.map(Math.abs)) : NaN;
    const midpoint = actual.find(sample => !sample.endpoint && Math.abs(sample.requestedQ - .5) < .01);
    const rackHeadingTrackOkay = Number.isFinite(maxAbsoluteHeading) && maxAbsoluteHeading <= 10 * Math.PI / 180 + .012 &&
      Math.abs(Number(midpoint?.heading)) >= .12 && actual.filter(sample => sample.endpoint).every(sample => Math.abs(sample.heading) <= .03);
    const rowSpacings = actual.map(sample => sample.rowSpacing);
    const rowSpacingStaysCompact = rowSpacings.length > 1 && rowSpacings.every(value => Number.isFinite(value) && value >= .55 && value <= 1.1) &&
      orderedByQ[0].rowSpacing > orderedByQ.at(-1).rowSpacing + .15;
    const rackFlightSamples = requested.map(sample => sample.rackFlight).filter(Boolean);
    const rackBoundsValid = rackFlightSamples.length === requested.length && rackFlightSamples.every(rack =>
      Array.isArray(rack.projected) && rack.projected.length === 4 && rack.projected.every(Number.isFinite) &&
      rack.projected[0] <= rack.projected[2] && rack.projected[3] <= rack.projected[1] &&
      Array.isArray(rack.translation) && rack.translation.length === 3 && rack.translation.every(Number.isFinite));
    const rackVisibilityFollowsCompleteBounds = rackFlightSamples.length === requested.length && rackFlightSamples.every(rack =>
      rack.visible === !rack.outside && (!rack.outside || Number(rack.projected?.[1]) < -1.1));
    const nearArray = requested.find(sample => Math.abs(sample.requestedQ - .05) < .01);
    const nearMatrix = requested.find(sample => Math.abs(sample.requestedQ - .95) < .01);
    const rackAtArrayVisible = !!nearArray?.rackFlight?.visible && nearArray.rackFlight.outside === false;
    const rackExitsBelowViewport = nearMatrix?.rackFlight?.outside === true && nearMatrix.rackFlight.visible === false &&
      Number(nearMatrix.rackFlight.projected?.[1]) < -1.1;
    const rackDeploymentStaysFull = samples.length > 0 && samples.every(sample =>
      Number.isFinite(Number(sample.rackDeployment)) && Math.abs(Number(sample.rackDeployment) - 1) <= .03 &&
      Math.abs(Number(sample.transitionRackDeployment) - 1) <= .03);
    const rackPartsAtMid = Array.isArray(midpoint?.rackParts) ? midpoint.rackParts : [];
    const arrayEndpoint = actual.find(sample => sample.endpoint && Math.abs(sample.q) < .001);
    const arrayRackParts = Array.isArray(arrayEndpoint?.rackParts) ? arrayEndpoint.rackParts : [];
    const visibleArrayRackParts = arrayRackParts.map((part, index) => ({ part, index })).filter(item => item.part.visible === true);
    const fullRackPosePresent = visibleArrayRackParts.length > 0 && visibleArrayRackParts.every(({ part, index }) => {
        const moving = rackPartsAtMid[index];
        return moving?.visible === true && xyz(part.scale) && xyz(moving.scale) &&
          part.scale.every((value, axis) => value > .001 && Math.abs(value - moving.scale[axis]) <= .04);
      });
    const selectedScaleOkay = requested.length > 0 && requested.every(sample => sample.selectedScale?.every(value =>
      Number.isFinite(value) && Math.abs(value - 1) <= .06));
    const coreRouteScaleOne = requested.length > 0 && requested.every(sample => sample.coreRouteCount > 0 &&
      sample.coreScaleFailures.length === 0);
    const ghostFullSizePresent = !!midpoint && midpoint.fullSizeOffscreenGhostCount > 0;
    const selectedViewportOkay = requested.length > 0 && requested.every(sample => viewportAudit(sample.motionViewport).ok);
    const ownerContinuity = ownerContinuityAudit(requested);
    const ownerCellEntryStable = ownerContinuity.checkedIds > 0 && ownerContinuity.ownerChanges.length === 0;
    const neighborMotionPxPerSecond = neighborMotionAudit(samples);
    return { sampleCount:samples.length, qCoverage, qCoverageOkay, progressInBounds, progressMonotonic, qMonotonic,
      pathIsCameraOrbit, allIdentityStable, activeTarget, cameraYMonotonic, cameraYLowerAtMatrix,
      pullsBackMonotonic, pullsBackAtMatrix, heroDistanceMonotonic, heroDistanceGrows,
      heroDistanceFacts, cameraYawDelta, cameraOrbits,
      sourceVisibleEntryCount:sourceVisibleEntries.size, targetVisibleEntryCount:targetVisibleEntries.size,
      sourceRouteKey, targetRouteKey, allVisibleEndpointEntriesRouted, routeCoverage,
      maxAbsoluteHeading, midpointHeading:midpoint?.heading ?? null, rackHeadingTrackOkay,
      rowSpacingRange:rowSpacings.length ? [Math.min(...rowSpacings), Math.max(...rowSpacings)] : [], rowSpacingStaysCompact,
      rackBoundsValid, rackVisibilityFollowsCompleteBounds, rackAtArrayVisible, rackExitsBelowViewport,
      rackDeploymentStaysFull, fullRackPosePresent,
      selectedScaleOkay, coreRouteScaleOne, midpointCoreRouteCount:midpoint?.coreRouteCount ?? 0,
      ghostFullSizePresent, midpointGhostCount:midpoint?.fullSizeOffscreenGhostCount ?? 0,
      selectedViewportOkay, ownerCellEntryStable, ownerContinuity, neighborMotionPxPerSecond };
  };
  const settledHandoffAudit = async (designLabel, context, identity, terminal) => {
    const terminalFrameTime = Number(terminal.stats?.frameTime);
    const nextFast = await waitForFast(state => state.stats?.layoutTransition?.active === false &&
      Number(state.stats?.frameTime) > terminalFrameTime, `${designLabel} ordinary frame after ${context}`, 5000, 4);
    const next = await geometrySnapshot();
    const before = visibleEntryOwners(terminal), after = visibleEntryOwners(next);
    const missing = [...before.keys()].filter(key => !after.has(key));
    const added = [...after.keys()].filter(key => !before.has(key));
    const beforeCellOwners = new Map([...before.values()].map(owner => [owner.cellKey, owner.entry]));
    const afterCellOwners = new Map([...after.values()].map(owner => [owner.cellKey, owner.entry]));
    const ownerChanges = [...beforeCellOwners.entries()].filter(([cell, entry]) => afterCellOwners.has(cell) && afterCellOwners.get(cell) !== entry)
      .map(([cell, entry]) => ({ cell, before:entry, after:afterCellOwners.get(cell) }));
    const shared = [...before.keys()].filter(key => after.has(key));
    const matrixMaxDelta = shared.reduce((maximum, key) => Math.max(maximum,
      Math.max(...before.get(key).matrix.map((value, index) => Math.abs(value - after.get(key).matrix[index])))), 0);
    const selectedMatrixDelta = compareActualMatrices(terminal, next).selectedMatrixDelta;
    const resultFrame = { terminalFrameTime, nextFrameTime:next.stats?.frameTime,
      endpoint:terminal.viewLayout, terminalSelectedCell:terminal.stats?.selectedCell ?? null,
      nextSelectedCell:next.stats?.selectedCell ?? null, terminalVisibleEntries:before.size, nextVisibleEntries:after.size,
      sharedVisibleEntries:shared.length, missing, added, ownerChanges, matrixMaxDelta, selectedMatrixDelta,
      identityStable:identityMatches(terminal, identity) && identityMatches(next, identity),
      nextFrameFastTime:nextFast.stats?.frameTime ?? null };
    record(`${designLabel} ${context} normal-frame handoff keeps cell owners and matrices continuous`,
      resultFrame.identityStable && shared.length > 0 && missing.length === 0 && added.length === 0 && ownerChanges.length === 0 &&
      matrixMaxDelta <= .1 && Number.isFinite(selectedMatrixDelta) && selectedMatrixDelta <= .1, resultFrame);
    return resultFrame;
  };
  const transitionTo = async (designLabel, target, identity) => {
    const current = await snapshot();
    if (current.viewLayout === target && current.stats?.layoutTransition?.active !== true) return current;
    const context = `${designLabel} ${target} #${++transitionSequence}`;
    const desiredEnd = target === 'array' ? 1 : 0;
    transitionProbeContext = context; transitionProbeStartedAt = Date.now();
    await clickLayout(target);
    const active = await waitForFast(state => state.viewLayout === target && state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.desiredEnd) === desiredEnd,
    `${designLabel} ${target} camera-orbit active`, 10000, 12);
    record(`${designLabel} ${target} starts the shared canonical camera-orbit path`,
      active.stats.layoutTransition.path === 'camera-orbit' && identityMatches(active, identity), shortState(active));
    const end = await waitForFast(state => state.viewLayout === target && state.stats?.layoutTransition?.active === false &&
      Math.abs(Number(state.stats.layoutTransition.q) - desiredEnd) < .001,
    `${designLabel} ${target} canonical endpoint`, 15000, 12);
    const detailedEnd = await geometrySnapshot();
    record(`${designLabel} ${target} reaches canonical q=${desiredEnd} with identity intact`,
      identityMatches(end, identity) && identityMatches(detailedEnd, identity) &&
      Math.abs(Number(detailedEnd.stats?.layoutTransition?.q) - desiredEnd) < .001, shortState(detailedEnd));
    transitionProbeStartedAt = 0; transitionProbeContext = '';
    return detailedEnd;
  };
  const runFlightLeg = async (designLabel, target, identity, requestedQValues) => {
    const sourceLayout = target === 'array' ? 'shelf' : 'array';
    const sourceQ = target === 'array' ? 0 : 1;
    const targetQ = target === 'array' ? 1 : 0;
    const direction = target === 'array' ? 'array-to-matrix' : 'matrix-to-array';
    const context = `${designLabel} ${direction} #${++transitionSequence}`;
    const source = await waitFor(state => state.viewLayout === sourceLayout && state.stats?.layoutTransition?.active !== true &&
      identityMatches(state, identity), `${designLabel} ${direction} source endpoint`, 10000, 30);
    const startSample = await captureFlightSample(context, sourceQ, true);
    record(`${context} starts at canonical q=${sourceQ} with selected entry ownership intact`,
      Math.abs(startSample.q - sourceQ) < .001 && identityMatches(source, identity) && startSample.instanceCount > 0,
      { state:shortState(source), q:startSample.q, cell:startSample.selectedCell, instanceCount:startSample.instanceCount });
    await takeScreenshot(`${designLabel.toLowerCase()}-${direction}-q-${sourceQ.toFixed(2)}-endpoint`,
      { direction, canonicalQ:sourceQ, endpoint:'source', layout:sourceLayout }, 0, true);
    const desiredEnd = targetQ;
    transitionProbeContext = context; transitionProbeStartedAt = Date.now();
    await clickLayout(target);
    const active = await waitForFast(state => state.viewLayout === target && state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.desiredEnd) === desiredEnd,
    `${context} active camera-orbit`, 10000, 12);
    record(`${context} activates with canonical q moving toward ${targetQ}`, identityMatches(active, identity) &&
      active.stats.layoutTransition.path === 'camera-orbit' && Number.isFinite(Number(active.stats.layoutTransition.q)), shortState(active));
    const observations = [];
    for (const requestedQ of requestedQValues) {
      const state = await waitForFast(value => value.viewLayout === target && value.stats?.layoutTransition?.active === true &&
        Number(value.stats.layoutTransition.desiredEnd) === desiredEnd &&
        Math.abs(Number(value.stats.layoutTransition.q) - requestedQ) <= .018,
      `${context} q=${requestedQ.toFixed(2)}`, 15000, 8);
      const observed = await captureFlightSample(context, requestedQ, false);
      observations.push(observed);
      record(`${context} q=${requestedQ.toFixed(2)} keeps selected entry and its owner cell`,
        identityMatches(state, identity) && identityMatches(observed, identity) && observed.instanceCount > 0,
        { requestedQ, observedQ:observed.q, selectedCell:observed.selectedCell, instanceCount:observed.instanceCount });
      await takeScreenshot(`${designLabel.toLowerCase()}-${direction}-q-${requestedQ.toFixed(2)}`,
        { direction, requestedQ, canonicalQ:observed.q, selectedAlbumId:observed.selectedAlbumId,
          selectedEntryKey:observed.selectedEntryKey, selectedCell:observed.selectedCell,
          cameraY:observed.cameraPosition?.[1] ?? null, cameraDistance:observed.cameraDistance,
          cameraToHeroDistance:observed.cameraToHeroDistance, rackFlight:observed.rackFlight }, 0, true);
    }
    const endpointFast = await waitForFast(state => state.viewLayout === target && state.stats?.layoutTransition?.active === false &&
      Math.abs(Number(state.stats.layoutTransition.q) - targetQ) < .001,
    `${context} endpoint q=${targetQ}`, 18000, 12);
    const endSample = await captureFlightSample(context, targetQ, true);
    await takeScreenshot(`${designLabel.toLowerCase()}-${direction}-q-${targetQ.toFixed(2)}-endpoint`,
      { direction, canonicalQ:targetQ, endpoint:'target', layout:target,
        selectedAlbumId:endSample.selectedAlbumId, selectedEntryKey:endSample.selectedEntryKey }, 0, true);
    record(`${context} settles at the target q and keeps entry ownership`,
      identityMatches(endpointFast, identity) && identityMatches(endSample, identity) && endSample.instanceCount > 0,
      { q:endSample.q, layout:endSample.selectedAlbumId, selectedCell:endSample.selectedCell });
    const handoff = await settledHandoffAudit(designLabel, direction, identity, await geometrySnapshot());
    transitionProbeStartedAt = 0; transitionProbeContext = '';
    const audit = auditFlight(context, target, requestedQValues, identity);
    record(`${context} samples every requested canonical q in path order with camera-orbit`,
      audit.qCoverageOkay && audit.qMonotonic && audit.progressInBounds && audit.progressMonotonic && audit.pathIsCameraOrbit, audit);
    record(`${context} camera lowers and pulls back continuously toward MATRIX`,
      audit.cameraYMonotonic && audit.cameraYLowerAtMatrix && audit.pullsBackMonotonic && audit.pullsBackAtMatrix &&
      audit.heroDistanceMonotonic && audit.heroDistanceGrows && audit.cameraOrbits,
      { cameraYMonotonic:audit.cameraYMonotonic, cameraYLowerAtMatrix:audit.cameraYLowerAtMatrix,
        pullsBackMonotonic:audit.pullsBackMonotonic, pullsBackAtMatrix:audit.pullsBackAtMatrix,
        heroDistanceMonotonic:audit.heroDistanceMonotonic, heroDistanceGrows:audit.heroDistanceGrows,
        cameraYawDelta:audit.cameraYawDelta, heroDistanceFacts:audit.heroDistanceFacts });
    record(`${context} keeps the selected case in the viewport at unit scale and ghosts full size off camera`,
      audit.allIdentityStable && audit.ownerCellEntryStable && audit.selectedViewportOkay && audit.selectedScaleOkay &&
      audit.coreRouteScaleOne && audit.ghostFullSizePresent && audit.allVisibleEndpointEntriesRouted,
      { allIdentityStable:audit.allIdentityStable, ownerContinuity:audit.ownerContinuity,
        selectedViewportOkay:audit.selectedViewportOkay, selectedScaleOkay:audit.selectedScaleOkay,
        coreRouteScaleOne:audit.coreRouteScaleOne, midpointCoreRouteCount:audit.midpointCoreRouteCount,
        sourceVisibleEntryCount:audit.sourceVisibleEntryCount, targetVisibleEntryCount:audit.targetVisibleEntryCount,
        sourceRouteKey:audit.sourceRouteKey, targetRouteKey:audit.targetRouteKey,
        allVisibleEndpointEntriesRouted:audit.allVisibleEndpointEntriesRouted, routeCoverage:audit.routeCoverage,
        middleGhostCount:audit.midpointGhostCount, middleGhosts:observations.find(sample => sample.requestedQ === .5)?.fullSizeOffscreenGhosts });
    record(`${context} rack rotates within the 10 degree heading envelope and stays fully deployed in flight`,
      audit.rackHeadingTrackOkay && audit.rackDeploymentStaysFull && audit.fullRackPosePresent,
      { maxAbsoluteHeading:audit.maxAbsoluteHeading, midpointHeading:audit.midpointHeading,
        rackDeploymentStaysFull:audit.rackDeploymentStaysFull, fullRackPosePresent:audit.fullRackPosePresent });
    record(`${context} uses full projected rack bounds and exits only after the bounds pass below view`,
      audit.rackBoundsValid && audit.rackVisibilityFollowsCompleteBounds && audit.rackAtArrayVisible && audit.rackExitsBelowViewport,
      { rackBoundsValid:audit.rackBoundsValid, rackAtArrayVisible:audit.rackAtArrayVisible,
        rackVisibilityFollowsCompleteBounds:audit.rackVisibilityFollowsCompleteBounds,
        rackExitsBelowViewport:audit.rackExitsBelowViewport, nearArray:observations.find(sample => sample.requestedQ === .05)?.rackFlight,
        nearMatrix:observations.find(sample => sample.requestedQ === .95)?.rackFlight });
    record(`${context} keeps row spacing compact and narrows it toward MATRIX`, audit.rowSpacingStaysCompact,
      { range:audit.rowSpacingRange });
    record(`${context} hands off the settled owner cells and matrices without a normal-frame jump`,
      handoff.sharedVisibleEntries > 0 && handoff.missing.length === 0 && handoff.added.length === 0 && handoff.ownerChanges.length === 0 &&
      handoff.matrixMaxDelta <= .1 && Number.isFinite(handoff.selectedMatrixDelta) && handoff.selectedMatrixDelta <= .1,
      handoff);
    result.timeline.push({ design:designLabel, direction, sourceQ, targetQ, requestedQValues,
      observedQ:observations.map(sample => sample.q), sourceCameraY:startSample.cameraPosition?.[1] ?? null,
      targetCameraY:endSample.cameraPosition?.[1] ?? null, sourceCameraDistance:startSample.cameraDistance,
      targetCameraDistance:endSample.cameraDistance, sourceCameraToHeroDistance:startSample.cameraToHeroDistance,
      targetCameraToHeroDistance:endSample.cameraToHeroDistance, handoff, audit });
    return endpointFast;
  };
  const exerciseRetargets = async (designLabel, identity) => {
    const context = `${designLabel} canonical q retargets #${++transitionSequence}`;
    const source = await waitFor(state => state.viewLayout === 'shelf' && state.stats?.layoutTransition?.active !== true &&
      identityMatches(state, identity), `${designLabel} ARRAY source for retarget`, 10000, 30);
    transitionProbeContext = context; transitionProbeStartedAt = Date.now();
    await clickLayout('array');
    const qWindow = (minimum, maximum, desiredEnd, label) => waitForFast(state =>
      state.stats?.layoutTransition?.active === true && Number(state.stats.layoutTransition.desiredEnd) === desiredEnd &&
      Number(state.stats.layoutTransition.q) >= minimum && Number(state.stats.layoutTransition.q) <= maximum,
    `${designLabel} retarget ${label}`, 18000, 8);
    const retargetAndCheck = async (layout, desiredEnd, flip) => {
      const atomic = await retargetLayoutAtomically(layout), before = atomic.before, after = atomic.after;
      const a = before.stats?.layoutTransition ?? {}, b = after.stats?.layoutTransition ?? {};
      const geometry = compareGeometry(before, after), matrices = compareActualMatrices(before, after);
      const qDelta = Math.abs(Number(b.q) - Number(a.q));
      const velocityDelta = Math.abs(Number(b.qVelocity) - Number(a.qVelocity));
      const cameraDelta = distance3(before.stats?.cameraPosition, after.stats?.cameraPosition);
      const aimDelta = distance3(before.stats?.cameraAim, after.stats?.cameraAim);
      const samePlan = Number(a.desiredEnd) !== desiredEnd && Number(b.desiredEnd) === desiredEnd &&
        Number.isFinite(Number(a.q)) && Number.isFinite(Number(b.q));
      const continuous = qDelta <= .025 && velocityDelta <= .35 && geometry.matchedCount > 0 && geometry.maxDelta <= .5 &&
        matrices.matchedCount > 0 && matrices.maxElementDelta <= .5 && Number(matrices.selectedMatrixDelta) <= .5 &&
        Number.isFinite(cameraDelta) && cameraDelta <= 1.5 && Number.isFinite(aimDelta) && aimDelta <= 1.5;
      const observation = { flip, layout, desiredEnd, beforeQ:a.q, afterQ:b.q, qDelta,
        beforeVelocity:a.qVelocity, afterVelocity:b.qVelocity, velocityDelta, geometry, matrices, cameraDelta, aimDelta,
        identityStable:identityMatches(before, identity) && identityMatches(after, identity) };
      result.retargets.push({ context, ...observation });
      record(`${designLabel} flip ${flip} reverses toward canonical q=${desiredEnd} without a pose jump`,
        samePlan && continuous && observation.identityStable, observation);
      await waitForFast(state => state.viewLayout === layout && state.stats?.layoutTransition?.active === true &&
        Number(state.stats.layoutTransition.desiredEnd) === desiredEnd, `${designLabel} retarget ${flip} target applied`, 5000, 8);
    };
    const q02 = await qWindow(.16, .24, 1, 'q near .20 while entering MATRIX');
    record(`${designLabel} canonical retarget starts on the ARRAY to MATRIX q path`, source.viewLayout === 'shelf' &&
      Number(q02.stats.layoutTransition.q) > 0 && identityMatches(q02, identity), shortState(q02));
    const qSamples = [{ requested:.2, q:Number(q02.stats.layoutTransition.q), desiredEnd:1 }];
    await retargetAndCheck('shelf', 0, 1);
    const q03 = await qWindow(.01, .06, 0, 'q near .03 while returning to ARRAY');
    qSamples.push({ requested:.03, q:Number(q03.stats.layoutTransition.q), desiredEnd:0 });
    await retargetAndCheck('array', 1, 2);
    const q05 = await qWindow(.44, .56, 1, 'q near .50 while re-entering MATRIX');
    qSamples.push({ requested:.5, q:Number(q05.stats.layoutTransition.q), desiredEnd:1 });
    const q08 = await qWindow(.75, .85, 1, 'q near .80 while re-entering MATRIX');
    qSamples.push({ requested:.8, q:Number(q08.stats.layoutTransition.q), desiredEnd:1 });
    const q097 = await qWindow(.93, .99, 1, 'q near .97 before the third reversal');
    qSamples.push({ requested:.97, q:Number(q097.stats.layoutTransition.q), desiredEnd:1 });
    await retargetAndCheck('shelf', 0, 3);
    const end = await waitForFast(state => state.viewLayout === 'shelf' && state.stats?.layoutTransition?.active === false &&
      Math.abs(Number(state.stats.layoutTransition.q)) < .001, `${designLabel} three reversals settle at ARRAY`, 20000, 12);
    record(`${designLabel} three canonical q reversals settle back at ARRAY with identity intact`,
      identityMatches(end, identity) && qSamples.length === 5 && qSamples.every(sample => Number.isFinite(sample.q)),
      { qSamples, selectedCell:end.stats?.selectedCell, selectedEntryKey:end.selectedEntryKey });
    const settled = await geometrySnapshot();
    const handoff = await settledHandoffAudit(designLabel, 'three reversals', identity, settled);
    record(`${designLabel} three reversals retain the settled owner and matrix seam`,
      handoff.sharedVisibleEntries > 0 && handoff.missing.length === 0 && handoff.added.length === 0 && handoff.ownerChanges.length === 0 &&
      handoff.matrixMaxDelta <= .1 && Number.isFinite(handoff.selectedMatrixDelta) && handoff.selectedMatrixDelta <= .1, handoff);
    transitionProbeStartedAt = 0; transitionProbeContext = '';
    result.timeline.push({ design:designLabel, direction:'three-reversal-continuity', qSamples, handoff, endpoint:end.viewLayout });
    return end;
  };
  const exerciseLayoutTransitions = async (designLabel, identity) => {
    const requestedAscending = [.05,.15,.3,.5,.7,.85,.95];
    const requestedDescending = [...requestedAscending].reverse();
    const source = await snapshot();
    record(`${designLabel} canonical flight suite starts in ARRAY at q=0`, source.viewLayout === 'shelf' &&
      source.stats?.layoutTransition?.active !== true && identityMatches(source, identity), shortState(source));
    await runFlightLeg(designLabel, 'array', identity, requestedAscending);
    await runFlightLeg(designLabel, 'shelf', identity, requestedDescending);
    return exerciseRetargets(designLabel, identity);
  };
  const enterInterfaceSettings = async label => {
    await click('[data-action="settings"]');
    await waitFor(state => state.settingsHidden === false, `${label} Settings`, 10000);
    await click('[data-settings-category-target="interface"]');
    return waitFor(state => state.interfaceCategoryHidden === false && state.entryOnOpenChecked !== null,
      `${label} interface settings`, 10000);
  };
  const leaveManagementPage = async label => {
    await click('[data-action="library"]');
    return waitFor(state => state.page === 'music' && state.mode === 'archive' && state.settingsHidden !== false,
      `${label} return to archive`, 10000);
  };
  const switchDesign = async design => {
    await click('[data-action="theme"]');
    await waitFor(state => state.page === 'theme', `open STYLE before ${design}`, 10000);
    await click(`[data-style-design="${design}"]`);
    await waitFor(state => state.design === design && state.page === 'theme', `switch to ${design}`, 20000);
    await click('[data-action="library"]');
    return waitFor(state => state.design === design && state.page === 'music' && state.mode === 'archive' &&
      state.presentation?.archiveReady === true &&
      (design !== 'archive' || state.stats?.caseStructure === 'punk'),
      `return to stable ${design} archive`, 30000, 40);
  };
  const pointInScene = (state, fx, fy) => {
    const rect = state.canvasRect;
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const right = Math.max(rect.x + 20, Math.min(rect.right, state.canvasVisibleRight ?? rect.right));
    const width = right - rect.x;
    return { x:Math.round(rect.x + Math.max(0.08, Math.min(0.92, fx)) * width),
      y:Math.round(rect.y + Math.max(0.12, Math.min(0.88, fy)) * rect.height) };
  };
  const sendMouse = (type, point, modifiers) => {
    const event = { type, x:point.x, y:point.y };
    if (type === 'mouseDown' || type === 'mouseUp' || modifiers?.length) event.button = 'left';
    if (type === 'mouseDown' || type === 'mouseUp' || modifiers?.length) event.modifiers = modifiers ?? [];
    if (type === 'mouseDown' || type === 'mouseUp') event.clickCount = 1;
    return wc.sendInputEvent(event);
  };
  const findHoverPoint = async label => {
    const current = await snapshot();
    const projected = current.stats?.projectedCenter;
    const projectedPoint = Array.isArray(projected) && projected.length >= 2 && current.canvasRect
      ? { x:Math.round(current.canvasRect.x + projected[0]), y:Math.round(current.canvasRect.y + projected[1]) }
      : pointInScene(current, 0.5, 0.5);
    if (!projectedPoint) throw new Error(`${label} has no visible MATRIX hover coordinate.`);
    wc.sendInputEvent({ type:'mouseMove', x:projectedPoint.x, y:projectedPoint.y });
    await pause(300);
    let hovered = await snapshot();
    if (!hovered.stats?.matrixHover?.cell) {
      try { hovered = await waitFor(state => state.stats?.matrixHover?.cell,
        `${label} projectedCenter matrix hover`, 1800, 30); } catch {}
    }
    return { point:projectedPoint, state:hovered };
  };
  const exerciseMatrixInteraction = async label => {
    const hover = await findHoverPoint(label);
    const selectedBefore = { selectedAlbumId:hover.state.selectedAlbumId, selectedEntryKey:hover.state.selectedEntryKey };
    const hoverPassed = !!hover.state.stats?.matrixHover?.cell &&
      Math.abs(Number(hover.state.stats.matrixHover.height) - 0.28) <= 0.025;
    recordObserved(`${label} MATRIX hover adds the requested gentle lift`, hoverPassed,
      { cell:hover.state.stats?.matrixHover?.cell ?? null, height:hover.state.stats?.matrixHover?.height ?? null,
        projectedCenter:hover.state.stats?.projectedCenter ?? null });
    if (!hoverPassed) {
      await takeScreenshot(`${label.toLowerCase()}-matrix-hover-miss`);
      process.stdout.write(`ARCHIVE_MOTION_HOVER_MISS:${label}:${JSON.stringify({ point:hover.point, state:hover.state.stats?.matrixHover })}\n`);
    }
    await waitFor(state => state.stats?.matrixDrag && state.viewLayout === 'array' &&
      state.presentation?.phase === 'archive', `${label} MATRIX drag ready`, 5000);
    sendMouse('mouseDown', hover.point, ['leftbuttondown']);
    const start = await waitFor(state => state.stats?.matrixDrag?.position, `${label} matrix drag center`, 2000);
    const points = Array.from({ length:9 }, (_, index) => ({
      x:hover.point.x + 18 * (index + 1), y:hover.point.y + 7 * (index + 1),
    }));
    let previousPoint = hover.point;
    for (const point of points) {
      wc.sendInputEvent({ type:'mouseMove', x:point.x, y:point.y,
        movementX:point.x - previousPoint.x, movementY:point.y - previousPoint.y,
        button:'left', modifiers:['leftbuttondown'] });
      previousPoint = point;
      await pause(22);
    }
    const held = await waitFor(state => state.stats?.matrixDrag?.moving === true &&
      state.stats.matrixDrag.position, `${label} real held mouse movement pans MATRIX`, 5000, 25);
    const panDistance = held.stats.matrixDrag.position && start.stats.matrixDrag.position
      ? Math.hypot(held.stats.matrixDrag.position.lane - start.stats.matrixDrag.position.lane,
        held.stats.matrixDrag.position.row - start.stats.matrixDrag.position.row) : 0;
    record(`${label} real mouse movement changes MATRIX pan position`, panDistance > 0.015,
      { from:start.stats.matrixDrag, held:held.stats.matrixDrag, panDistance });
    sendMouse('mouseUp', points.at(-1), []);
    const release = await waitFor(state => state.stats?.matrixDrag && state.stats.matrixDrag.phase !== 'idle',
      `${label} drag release starts inertia or settling`, 1500, 20);
    record(`${label} mouse release enters MATRIX coasting or snapping`,
      ['coasting','snapping'].includes(release.stats.matrixDrag.phase) && release.stats.matrixDrag.moving === true,
      release.stats.matrixDrag);
    const settled = await waitFor(state => state.stats?.matrixDrag?.phase === 'idle' &&
      state.stats.matrixDrag.moving === false && state.presentation?.phase === 'archive' && state.detailHidden === true,
    `${label} matrix inertia settles without opening detail`, 8000, 40);
    await pause(140);
    const stable = await snapshot();
    record(`${label} MATRIX drag finishes in archive without opening detail`,
      stable.page === 'music' && stable.mode === 'archive' && stable.presentation?.phase === 'archive' &&
      stable.detailHidden === true && stable.entry?.active !== true,
      { settled:settled.stats.matrixDrag, final:shortState(stable), selectedBefore });
    return stable;
  };
  const exercisePunkControls = async () => {
    const baseline = await waitFor(state => state.design === 'archive' && state.page === 'music' && state.mode === 'archive', 'Punk browse controls ready');
    const identity = { selectedAlbumId:baseline.selectedAlbumId, selectedEntryKey:baseline.selectedEntryKey };
    record('Punk top rail exposes SHOW, LAYOUT, GROUP and SORT',
      ['show','layout','group','sort'].every(field => baseline.controls[field]?.present && baseline.controls[field]?.visible),
      baseline.controls);
    record('Punk LAYOUT rail exposes ARRAY, MATRIX and GRID',
      ['shelf','array','grid'].every(value => baseline.layoutButtons.some(button => button.value === value)), baseline.layoutButtons);
    for (const [field, value] of [['show','tracks'],['group','artist'],['sort','year'],['show','albums'],['group','genre'],['sort','artist']]) {
      await click(`.foobar-catalog-tools [data-foobar-catalog="${field}"][data-value="${value}"]`);
      const state = await waitFor(current => current.design === 'archive' && current.page === 'music' &&
        current.controls[field]?.buttons.some(button => button.value === value && button.pressed),
      `Punk ${field}=${value} is applied`, 10000, 35);
      record(`Punk ${field}=${value} remains operable with selection`, state.selectedAlbumId === identity.selectedAlbumId,
        { field, value, selectedAlbumId:state.selectedAlbumId, controls:state.controls[field] });
    }
    return waitFor(state => state.viewLayout === 'array' && state.design === 'archive', 'Punk MATRIX restored');
  };
  const verifyPunkChrome = async (name, expectedBleed) => {
    const state = await waitFor(value => value.design === 'archive' && value.page === 'music' &&
      value.infoVisible && value.controls.layout?.visible, `${name} Punk chrome visible`);
    verifyPunkCompactTools(state, name);
    const expected = Number.parseFloat(state.sceneBleed) || 0;
    const clipDelta = state.canvasVisibleRight !== null && state.infoRect ? state.canvasVisibleRight - state.infoRect.x : Infinity;
    const blendWidth = Number.parseFloat(state.blendWidth) || 0;
    if (state.viewport?.width > 720) record(`${name} Punk scene clip reaches the soft info transition`, expected === expectedBleed &&
      Math.abs(clipDelta - expectedBleed) <= 10,
      { sceneBleed:state.sceneBleed, expectedBleed, canvasVisibleRight:state.canvasVisibleRight, infoLeft:state.infoRect?.x, clipDelta, clipPath:state.canvasClipPath });
    else record(`${name} narrow Punk layout removes scene bleed`, expected === 0 && expectedBleed === 0,
      { sceneBleed:state.sceneBleed, expectedBleed });
    record(`${name} Punk info keeps its actions and format label`, state.playAction && state.openAction && state.formatVisible,
      { playAction:state.playAction, openAction:state.openAction, formatText:state.formatText, infoBackground:state.infoBackground });
    record(`${name} Punk right column uses one gradient surface behind the info panel`,
      /linear-gradient/i.test(state.blendBackground ?? '') && state.infoRect &&
      blendWidth >= state.infoRect.width + expectedBleed - 8 &&
      /rgba\(0,\s*0,\s*0,\s*0\)|transparent/i.test(state.infoBackground ?? ''),
      { blendWidth:state.blendWidth, expectedMinimum:state.infoRect ? state.infoRect.width + expectedBleed : null,
        blendBackground:state.blendBackground, infoBackground:state.infoBackground });
    await pause(700);
    await takeScreenshot(name);
  };
  const verifyPunkCompactTools = (state, label) => {
    const fields = ['show','layout','group','sort'];
    const fieldRects = fields.map(field => ({ field, rect:state.controls[field]?.rect }))
      .filter(item => item.rect && item.rect.width > 0 && item.rect.height > 0);
    const rows = [];
    for (const item of fieldRects) {
      const centerY = item.rect.y + item.rect.height / 2;
      let row = rows.find(candidate => Math.abs(candidate.centerY - centerY) <= 16);
      if (!row) { row = { centerY, fields:[], rects:[] }; rows.push(row); }
      row.fields.push(item.field);
      row.rects.push(item.rect);
      row.centerY = row.rects.reduce((sum, rect) => sum + rect.y + rect.height / 2, 0) / row.rects.length;
    }
    rows.sort((left, right) => left.centerY - right.centerY);
    const controlsRight = fieldRects.length ? Math.max(...fieldRects.map(item => item.rect.right)) : -Infinity;
    const controlsLeft = fieldRects.length ? Math.min(...fieldRects.map(item => item.rect.x)) : Infinity;
    const controlsTop = fieldRects.length ? Math.min(...fieldRects.map(item => item.rect.y)) : Infinity;
    const controlsBottom = fieldRects.length ? Math.max(...fieldRects.map(item => item.rect.bottom)) : -Infinity;
    const tools = state.toolsRect;
    const viewport = state.viewport ?? {};
    const sceneTop = state.canvasRect?.y ?? 0;
    const compactUpperLeft = !!tools && tools.width > 0 && tools.height > 0 &&
      tools.x >= -1 && tools.x <= Math.max(44, viewport.width * 0.06) &&
      tools.y >= sceneTop - 1 && tools.y - sceneTop <= 44 &&
      tools.width <= Math.min(560, viewport.width * 0.74) &&
      tools.height <= Math.min(180, viewport.height * 0.26);
    const twoRows = rows.length === 2 && rows.every(row => row.fields.length === 2) &&
      rows[1].centerY - rows[0].centerY >= 18 && rows[1].centerY - rows[0].centerY <= 100;
    const random = state.randomButtonRect;
    const randomBesideRows = !!random && (random.right <= controlsLeft + 3 || random.x >= controlsRight - 3) &&
      random.y + random.height >= controlsTop - 6 && random.y <= controlsBottom + 6;
    const detail = { viewport, tools, rows:rows.map(row => ({ fields:row.fields, centerY:row.centerY })),
      randomButtonRect:random, randomButtonLabel:state.randomButtonLabel,
      compactUpperLeft, twoRows, randomBesideRows };
    record(`${label} Punk tools form a compact upper-left two-row cluster`, compactUpperLeft && twoRows, detail);
    record(`${label} Punk Random stays beside the two control rows`, randomBesideRows, detail);
  };
  const verifyPunkNarrowWindow = async () => {
    if (typeof browserWindow.getSize !== 'function' || typeof browserWindow.setSize !== 'function' ||
        browserWindow.isFullScreen?.() === true) return;
    const originalSize = browserWindow.getSize();
    const originalState = await snapshot();
    const originalViewportWidth = originalState.viewport?.width;
    const identity = { selectedAlbumId:originalState.selectedAlbumId, selectedEntryKey:originalState.selectedEntryKey };
    try {
      await clickLayout('array');
      const inFlight = await waitFor(state => state.viewLayout === 'array' && state.stats?.layoutTransition?.active === true &&
        Number(state.stats.layoutTransition.q) >= .18 && Number(state.stats.layoutTransition.q) <= .38,
      'Punk MATRIX camera-orbit before 800px resize', 10000, 12);
      record('Punk narrow-window probe resizes an active canonical camera flight', identityMatches(inFlight, identity) &&
        inFlight.stats.layoutTransition.path === 'camera-orbit', shortState(inFlight));
      browserWindow.setSize(800, originalSize[1]);
      const narrow = await waitFor(state => state.design === 'archive' && state.page === 'music' &&
        state.mode === 'archive' && state.controls.layout?.visible && state.viewport?.width >= 720 &&
        state.viewport.width <= 800 && state.viewLayout === 'array' && state.stats?.layoutTransition?.active === false &&
        Math.abs(Number(state.stats?.layoutTransition?.q) - 1) < .001,
      '800px resize settles into its requested MATRIX endpoint', 8000, 30);
      record('800px resize adopts MATRIX and releases the frozen camera flight', identityMatches(narrow, identity) &&
        narrow.stats?.layoutTransition?.path === 'camera-orbit' && narrow.stats?.layoutTransition?.active === false &&
        Math.abs(Number(narrow.stats?.layoutTransition?.q) - 1) < .001,
      { viewport:narrow.viewport, layout:narrow.viewLayout, transition:narrow.stats?.layoutTransition,
        cameraPosition:narrow.stats?.cameraPosition, cameraDistance:narrow.stats?.cameraDistance });
      verifyPunkCompactTools(narrow, '800px');
      const expectedBleed = narrow.viewport.width <= 720 ? 0 : 32;
      await verifyPunkChrome('punk-tools-800px', expectedBleed);
    } finally {
      browserWindow.setSize(originalSize[0], originalSize[1]);
      if (Number.isFinite(originalViewportWidth)) await waitFor(state => Math.abs(state.viewport?.width - originalViewportWidth) <= 2,
        'restore archive motion viewport size', 5000, 30);
      const current = await snapshot();
      if (current.viewLayout !== 'shelf' || current.stats?.layoutTransition?.active === true)
        await transitionTo('Punk', 'shelf', identity);
    }
  };
  const replayFutureArrayEntry = async label => {
    const settings = await enterInterfaceSettings(label);
    record(`${label} entry settings are available in Future ARRAY with automatic entry off`,
      settings.design === 'rhine' && settings.viewLayout === 'shelf' && settings.entryOnOpenChecked === false &&
      settings.entryOnOpenDisabled === false && settings.entryReplayDisabled === false,
      { design:settings.design, viewLayout:settings.viewLayout, entryOnOpenChecked:settings.entryOnOpenChecked, replayDisabled:settings.entryReplayDisabled });
    await click('[data-action="entry-replay"]');
    return waitFor(state => state.entry?.active === true && state.overlayPresent && state.page === 'music' &&
      state.viewLayout === 'shelf' && state.mode === 'archive', `${label} Future ARRAY replay starts`, 10000, 35);
  };
  let entryTimelineStartedAt = 0;
  let lastEntryTimelineKey = '';
  const entryStamp = state => ({
    sinceReplayMs:entryTimelineStartedAt ? Date.now() - entryTimelineStartedAt : null,
    entryTime:Number.isFinite(Number(state.entry?.time)) ? Number(state.entry.time) : null,
    active:state.entry?.active ?? null,
    entryPhase:state.entry?.phase ?? null,
    shelfPhase:state.stats?.shelfEntry?.phase ?? null,
    deployment:state.stats?.shelfEntry?.deployment ?? null,
    caseScaleY:state.stats?.shelfEntry?.caseScaleY ?? null,
    fullCaseHeight:state.stats?.shelfEntry?.fullCaseHeight ?? null,
    visibleCaseHeight:state.stats?.shelfEntry?.visibleCaseHeight ?? null,
    deckY:state.stats?.shelfEntry?.deckY ?? null,
    rackDeployment:state.stats?.rackDeployment ?? null,
    modelPosition:state.stats?.modelPosition ?? null,
    motionGeometrySamples:state.stats?.motionGeometrySamples ?? [],
  });
  const recordEntryState = (state, force = false) => {
    const stamp = entryStamp(state);
    const key = [stamp.active, stamp.entryPhase, stamp.shelfPhase].join('|');
    if (force || key !== lastEntryTimelineKey) result.entryTimeline.push(stamp);
    lastEntryTimelineKey = key;
    return stamp;
  };
  const unitGeometryScales = samples => Array.isArray(samples) && samples.length > 0 && samples.length <= 8 &&
    samples.every(sample => {
      const scale = xyz(sample?.scale);
      return scale && scale.every(value => Math.abs(value - 1) <= 0.06);
    });
  const partialGeometryScales = samples => Array.isArray(samples) && samples.length > 0 && samples.length <= 8 &&
    samples.some(sample => {
      const scale = xyz(sample?.scale);
      return scale && scale.some(value => value > 0.01 && value < 0.97);
    });
  const sampleEntryUntil = async (time, label, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    let latest;
    while (Date.now() < deadline) {
      latest = await fastSnapshot();
      if (!latest.sampleError) {
        recordEntryState(latest);
        if (Number(latest.entry?.time) >= time || latest.entry?.active === false) return latest;
      }
      await pause(20);
    }
    throw new Error(`Timed out waiting for Future ARRAY entry ${label}: ${JSON.stringify(latest)}`);
  };

  try {
    wc.setBackgroundThrottling(false);
    await fs.mkdir(screenshotDirectory, { recursive:true });
    browserWindow.focus();
    const initial = await waitFor(state => state.page === 'music' && state.mode === 'archive' &&
      state.stats?.loaded === true && state.design === 'rhine', 'Future MATRIX production frontend ready', 45000, 70);
    record('probe starts Future ARRAY with automatic entry disabled',
      initial.viewLayout === 'shelf' && initial.entry?.active === false && !initial.overlayPresent &&
      getPreferences()?.entryOnOpen === false && (getReadyCount?.() ?? 1) >= 1,
      { viewLayout:initial.viewLayout, entry:initial.entry, entryOnOpen:getPreferences()?.entryOnOpen, readyCount:getReadyCount?.() ?? null });
    record('production renderer uses the isolated 38 album fixture with 7/28/3 genre groups',
      probeReport.syntheticArchiveMotionFixture === true && probeReport.syntheticArchiveMotionAlbumCount === 38 &&
      probeReport.syntheticArchiveMotionGenreCounts?.join(',') === '7,28,3' &&
      probeReport.archiveMotionUsesOnlyPngCovers === true,
      { syntheticFixture:probeReport.syntheticArchiveMotionFixture, albumCount:probeReport.syntheticArchiveMotionAlbumCount,
        genreCounts:probeReport.syntheticArchiveMotionGenreCounts, pngCovers:probeReport.archiveMotionUsesOnlyPngCovers });

    const firstAlbum = initial.selectedAlbumId;
    await click('.music-navigation [data-action="next"]');
    let selected = await waitFor(state => state.selectedAlbumId && state.selectedAlbumId !== firstAlbum && state.selectedEntryKey,
      'select a stable non-first fixture album', 10000, 35);
    record('non-first album and catalog entry are selected before transition checks',
      selected.selectedAlbumId === selected.selectedAlbumFromApp && !!selected.selectedEntryKey,
      { selectedAlbumId:selected.selectedAlbumId, selectedEntryKey:selected.selectedEntryKey,
        selectedAlbumFromApp:selected.selectedAlbumFromApp });
    const longGroupAlbumId = probeReport.syntheticArchiveMotionLongGroupProbeAlbumId ?? 'fixture-album-28';
    // Row navigation wraps inside the current MATRIX genre. Enter the long
    // middle genre before walking to its 21st item.
    for (let lane = 0; lane < 3 && !/^fixture-album-(?:0[8-9]|[12][0-9]|3[0-5])$/.test(selected.selectedAlbumId); lane++) {
      const previousAlbumId = selected.selectedAlbumId;
      await click('.music-navigation [data-action="genre-next"]');
      selected = await waitFor(state => state.selectedAlbumId && state.selectedAlbumId !== previousAlbumId,
        'enter the long Fixture genre', 10000, 35);
    }
    for (let advance = 0; advance < 38 && selected.selectedAlbumId !== longGroupAlbumId; advance++) {
      const previousAlbumId = selected.selectedAlbumId;
      await click('.music-navigation [data-action="next"]');
      selected = await waitFor(state => state.selectedAlbumId && state.selectedAlbumId !== previousAlbumId && state.selectedEntryKey,
        `advance MATRIX selection toward long-group entry ${longGroupAlbumId}`, 10000, 35);
    }
    let identity = { selectedAlbumId:selected.selectedAlbumId, selectedEntryKey:selected.selectedEntryKey };
    record('long-group album and catalog identity are selected before transition checks',
      identity.selectedAlbumId === selected.selectedAlbumFromApp && !!identity.selectedEntryKey,
      { ...identity, selectedAlbumFromApp:selected.selectedAlbumFromApp });
    record('the 21st album in the long Fixture genre is selected before a MATRIX round trip',
      identity.selectedAlbumId === longGroupAlbumId && !!identity.selectedEntryKey,
      { ...identity, expectedAlbumId:longGroupAlbumId, genreCounts:probeReport.syntheticArchiveMotionGenreCounts });
    await pause(1000);
    const stableBeforeFirstTransition = await snapshot();
    record('selected long-group identity remains stable for one second before the first layout transition',
      identityMatches(stableBeforeFirstTransition, identity), shortState(stableBeforeFirstTransition));

    await exerciseLayoutTransitions('Future', identity);
    await takeScreenshot('future-array-overview');
    await transitionTo('Future', 'array', identity);
    await takeScreenshot('future-matrix-overview');
    const futureMatrixEnd = await exerciseMatrixInteraction('Future');
    identity = { selectedAlbumId:futureMatrixEnd.selectedAlbumId, selectedEntryKey:futureMatrixEnd.selectedEntryKey };
    record('Future MATRIX drag leaves a stable catalog identity for later theme transitions',
      !!identity.selectedAlbumId && !!identity.selectedEntryKey && futureMatrixEnd.selectedAlbumId === futureMatrixEnd.selectedAlbumFromApp,
      identity);

    const punk = await switchDesign('archive');
    record('theme switch preserves the selected album', punk.selectedAlbumId === identity.selectedAlbumId,
      { selectedAlbumId:punk.selectedAlbumId, expected:identity.selectedAlbumId });
    if (punk.viewLayout !== 'shelf') await transitionTo('Punk', 'shelf', identity);
    await exerciseLayoutTransitions('Punk', identity);
    const width = (await snapshot()).viewport?.width ?? 0;
    const expectedBleed = width <= 720 ? 0 : width <= 1100 ? 32 : 64;
    await verifyPunkChrome('punk-array-controls', expectedBleed);
    await verifyPunkNarrowWindow();
    await transitionTo('Punk', 'array', identity);
    await exercisePunkControls();
    await takeScreenshot('punk-matrix-controls');
    await exerciseMatrixInteraction('Punk');
    const punkSettings = await enterInterfaceSettings('Punk entry protection');
    record('Punk Future replay remains disabled', punkSettings.design === 'archive' &&
      punkSettings.entryReplayDisabled === true && punkSettings.entryOnOpenDisabled === true,
    { replayDisabled:punkSettings.entryReplayDisabled, automaticDisabled:punkSettings.entryOnOpenDisabled, text:punkSettings.entrySettingsText });
    await evaluate('(() => { document.querySelector("[data-action=entry-replay]")?.click(); return true; })()');
    const punkStillNoEntry = await snapshot();
    record('disabled Punk replay creates no Future overlay', !punkStillNoEntry.overlayPresent && punkStillNoEntry.entry?.active !== true,
      shortState(punkStillNoEntry));
    await leaveManagementPage('Punk entry protection');

    let future = await switchDesign('rhine');
    identity = { selectedAlbumId:future.selectedAlbumId, selectedEntryKey:future.selectedEntryKey };
    record('return to Future keeps a stable current catalog identity',
      !!identity.selectedAlbumId && !!identity.selectedEntryKey && future.selectedAlbumId === future.selectedAlbumFromApp,
      identity);
    if (future.viewLayout !== 'shelf') future = await transitionTo('Future', 'shelf', identity);
    let fixtureCaseHeight = null;
    const skippedEntry = await replayFutureArrayEntry('manual skip');
    const skipFrame = await waitForFast(state => state.entry?.active === true &&
      Number(state.entry.time) >= 23.2 && Number(state.entry.time) <= 24.5 && state.entry.phase === 'shelf-assembly' &&
      Number(state.stats?.shelfEntry?.visibleCaseHeight) > 0,
    'Future ARRAY partial shelf assembly before manual skip', 30000, 12);
    recordEntryState(skipFrame, true);
    fixtureCaseHeight = Number(skipFrame.stats?.shelfEntry?.fullCaseHeight);
    const skipDeployment = Number(skipFrame.stats?.shelfEntry?.deployment);
    const skipRackDeployment = Number(skipFrame.stats?.rackDeployment);
    const skipVisibleCaseHeight = Number(skipFrame.stats?.shelfEntry?.visibleCaseHeight);
    const skipCasePartiallyVisible = Number.isFinite(fixtureCaseHeight) && fixtureCaseHeight > 0 &&
      skipVisibleCaseHeight > 0.01 && skipVisibleCaseHeight < fixtureCaseHeight - 0.01;
    record('manual skip is available during partial shelf assembly',
      skipFrame.entry.phase === 'shelf-assembly' && skipFrame.stats?.shelfEntry?.phase === 'assemble' &&
      skipDeployment > 0.01 && skipDeployment < 0.99 && skipRackDeployment > 0.01 && skipRackDeployment < 0.99 &&
      skipCasePartiallyVisible,
      { time:skipFrame.entry.time, entryPhase:skipFrame.entry.phase, shelfEntry:skipFrame.stats?.shelfEntry,
        rackDeployment:skipFrame.stats?.rackDeployment, fullCaseHeight:fixtureCaseHeight,
        partialPlanarScaleSample:partialGeometryScales(skipFrame.stats?.motionGeometrySamples),
        motionGeometrySamples:skipFrame.stats?.motionGeometrySamples });
    await click('.future-entry-skip');
    const skipped = await waitFor(state => state.entry?.active === false && !state.overlayPresent &&
      state.viewLayout === 'shelf' && state.page === 'music' && state.mode === 'archive' && state.detailHidden === true &&
      state.stats?.shelfEntry?.phase == null,
    'Future ARRAY entry skip returns to overview', 10000, 35);
    record('manual skip returns to Future ARRAY overview', skipped.viewLayout === 'shelf' &&
      skipped.presentation?.phase === 'archive' && skipped.detailHidden === true && getPreferences()?.entryOnOpen === false,
    { state:shortState(skipped), entryOnOpen:getPreferences()?.entryOnOpen, start:shortState(skippedEntry) });
    const skippedSamples = skipped.stats?.motionGeometrySamples ?? [];
    const skipRestored = Math.abs(Number(skipped.stats?.shelfEntry?.deployment) - 1) < 0.06 &&
      Math.abs(Number(skipped.stats?.shelfEntry?.caseScaleY) - 1) < 0.06 &&
      Math.abs(Number(skipped.stats?.rackDeployment) - 1) < 0.06 &&
      skipped.stats?.shelfEntry?.phase == null && (skippedSamples.length === 0 || unitGeometryScales(skippedSamples));
    record('manual skip restores unit model and case scale with the rack fully deployed', skipRestored,
      { shelfEntry:skipped.stats?.shelfEntry, rackDeployment:skipped.stats?.rackDeployment,
        reportedGeometryCount:skippedSamples.length, motionGeometrySamples:skippedSamples });

    const naturalEntry = await replayFutureArrayEntry('natural replay');
    record('manual replay starts the Future ARRAY layout', naturalEntry.entry?.layout === 'shelf' || naturalEntry.viewLayout === 'shelf',
      { entryLayout:naturalEntry.entry?.layout, viewLayout:naturalEntry.viewLayout });
    const startedAt = Date.now();
    entryTimelineStartedAt = Date.now();
    lastEntryTimelineKey = '';
    recordEntryState(naturalEntry, true);
    const keyframeTimes = [22.3,22.8,23.4,24.0,24.6,25.3,26.5];
    let keyframeCount = 0;
    for (const targetTime of keyframeTimes) {
      const beforeCapture = await sampleEntryUntil(Math.max(0, targetTime - 0.12),
        `key frame ${targetTime.toFixed(2)}s`);
      const beforeStamp = recordEntryState(beforeCapture, true);
      beforeStamp.requestedEntryTime = targetTime;
      const name = `future-array-entry-${targetTime.toFixed(2).replace('.', '-')}`;
      await takeScreenshot(name, { requestedEntryTime:targetTime, beforeCapture:beforeStamp }, 0);
      keyframeCount++;
      const afterCapture = await fastSnapshot();
      if (!afterCapture.sampleError) {
        const afterStamp = recordEntryState(afterCapture, true);
        afterStamp.requestedEntryTime = targetTime;
        result.screenshots.at(-1).details.afterCapture = afterStamp;
      }
    }
    const naturalEnd = await waitFor(state => state.entry?.active === false && !state.overlayPresent &&
      state.viewLayout === 'shelf' && state.page === 'music' && state.mode === 'archive' &&
      state.stats?.layoutTransition?.active === false && state.stats?.shelfEntry?.phase == null,
    'natural Future ARRAY entry completion', 10000, 40);
    const naturalPlaybackSeconds = (Date.now() - startedAt) / 1000;
    recordEntryState(naturalEnd, true);
    await takeScreenshot('future-array-entry-final-overview');
    const expectedEntryPhases = ['shelf-assembly','shelf-ready','settle'];
    const naturalSamples = result.entryTimeline.filter(sample => Number.isFinite(sample.sinceReplayMs));
    const observedEntryPhases = [];
    for (const sample of naturalSamples) {
      if (sample.entryPhase && sample.entryPhase !== observedEntryPhases.at(-1)) observedEntryPhases.push(sample.entryPhase);
    }
    const phaseOrderOkay = expectedEntryPhases.every((phase, index) => observedEntryPhases.indexOf(phase) >= 0 &&
      (index === 0 || observedEntryPhases.indexOf(phase) > observedEntryPhases.indexOf(expectedEntryPhases[index - 1])));
    const assemblySamples = naturalSamples.filter(sample => sample.entryPhase === 'shelf-assembly');
    const readySamples = naturalSamples.filter(sample => sample.entryPhase === 'shelf-ready');
    const settleSamples = naturalSamples.filter(sample => sample.entryPhase === 'settle');
    const orderedAssemblyHeights = assemblySamples.filter(sample => Number.isFinite(Number(sample.entryTime)) &&
      Number.isFinite(Number(sample.visibleCaseHeight))).sort((left, right) => Number(left.entryTime) - Number(right.entryTime));
    const assemblyHeightDeltas = orderedAssemblyHeights.slice(1).map((sample, index) =>
      Number(sample.visibleCaseHeight) - Number(orderedAssemblyHeights[index].visibleCaseHeight));
    const assemblyHeightRange = orderedAssemblyHeights.length
      ? Math.max(...orderedAssemblyHeights.map(sample => Number(sample.visibleCaseHeight))) -
        Math.min(...orderedAssemblyHeights.map(sample => Number(sample.visibleCaseHeight))) : 0;
    const assemblyHeightMonotonic = orderedAssemblyHeights.length >= 2 &&
      assemblyHeightDeltas.every(delta => delta >= -0.02) && assemblyHeightRange > 0.2;
    const partialAssemblyObserved = assemblySamples.some(sample => sample.shelfPhase === 'assemble' &&
      Number(sample.deployment) > 0.01 && Number(sample.deployment) < 0.99 &&
      Number(sample.rackDeployment) > 0.01 && Number(sample.rackDeployment) < 0.99 &&
      Number.isFinite(fixtureCaseHeight) && fixtureCaseHeight > 0 &&
      Number(sample.visibleCaseHeight) > 0.01 && Number(sample.visibleCaseHeight) < fixtureCaseHeight - 0.01);
    const readyPoseObserved = readySamples.some(sample => sample.shelfPhase === 'ready' &&
      Math.abs(Number(sample.deployment) - 1) < 0.06 && Math.abs(Number(sample.rackDeployment) - 1) < 0.06 &&
      Math.abs(Number(sample.caseScaleY) - 1) < 0.06 && Number.isFinite(Number(sample.fullCaseHeight)) &&
      Math.abs(Number(sample.visibleCaseHeight) - Number(sample.fullCaseHeight)) < 0.03);
    const settlePoseObserved = settleSamples.some(sample => sample.shelfPhase === 'ready' &&
      Math.abs(Number(sample.deployment) - 1) < 0.06 && Math.abs(Number(sample.rackDeployment) - 1) < 0.06 &&
      Math.abs(Number(sample.caseScaleY) - 1) < 0.06 && Number.isFinite(Number(sample.fullCaseHeight)) &&
      Math.abs(Number(sample.visibleCaseHeight) - Number(sample.fullCaseHeight)) < 0.03 &&
      unitGeometryScales(sample.motionGeometrySamples));
    record('Future ARRAY timeline reports assembly, ready and settle in order', phaseOrderOkay,
      { observedEntryPhases, entrySamples:naturalSamples.length });
    record('Future ARRAY assembly exposes a partial rigid case above the shared deck', partialAssemblyObserved,
      { fullCaseHeight:fixtureCaseHeight, samples:assemblySamples.map(sample => ({ entryTime:sample.entryTime,
        visibleCaseHeight:sample.visibleCaseHeight, deckY:sample.deckY, deployment:sample.deployment,
        rackDeployment:sample.rackDeployment, caseScaleY:sample.caseScaleY,
        partialPlanarScale:partialGeometryScales(sample.motionGeometrySamples) })) });
    record('Future ARRAY visible case height rises monotonically during assembly', assemblyHeightMonotonic,
      { samples:orderedAssemblyHeights.map(sample => ({ entryTime:sample.entryTime,
        visibleCaseHeight:sample.visibleCaseHeight, deckY:sample.deckY })), deltas:assemblyHeightDeltas,
        heightRange:assemblyHeightRange });
    record('Future ARRAY ready phase reaches full rack and unit model scale', readyPoseObserved, readySamples);
    record('Future ARRAY settle phase has unit scale across sampled case matrices', settlePoseObserved, settleSamples);
    record('Future ARRAY intro completes naturally after the original prelude and tail',
      keyframeCount === keyframeTimes.length && naturalPlaybackSeconds >= 23 && naturalPlaybackSeconds <= 40 &&
      naturalEnd.viewLayout === 'shelf' && naturalEnd.presentation?.phase === 'archive' && naturalEnd.detailHidden === true,
    { keyframeCount, keyframeTimes, playbackSeconds:naturalPlaybackSeconds, state:shortState(naturalEnd) });
    record('Future ARRAY entry returns to a static shelf with rack-only state cleared',
      naturalEnd.entry?.active === false && naturalEnd.stats?.layoutTransition?.active === false &&
      naturalEnd.stats?.shelfEntry?.phase == null &&
      Math.abs(Number(naturalEnd.stats?.shelfEntry?.deployment) - 1) < 0.06 &&
      Math.abs(Number(naturalEnd.stats?.shelfEntry?.caseScaleY) - 1) < 0.06 &&
      Math.abs(Number(naturalEnd.stats?.rackDeployment) - 1) < 0.06,
    { shelfEntry:naturalEnd.stats?.shelfEntry, rackDeployment:naturalEnd.stats?.rackDeployment,
      transition:naturalEnd.stats?.layoutTransition, entry:naturalEnd.entry });
    record('entry replay leaves automatic entry off and does not open an album',
      getPreferences()?.entryOnOpen === false && naturalEnd.viewLayout === 'shelf' &&
      naturalEnd.detailHidden === true && naturalEnd.presentation?.phase === 'archive',
    { entryOnOpen:getPreferences()?.entryOnOpen, state:shortState(naturalEnd) });

    result.ok = Object.values(result.assertions).every(Boolean);
    result.summary = { ok:result.ok, cases:result.cases.length, screenshots:result.screenshots.length,
      layoutTransitions:result.timeline.length, flightSamples:result.flightSamples.length,
      retargets:result.retargets.length, geometryFrames:result.geometryFrames.length, entryPhaseSequence:observedEntryPhases,
      keyframeCount, naturalPlaybackSeconds,
      finalLayout:naturalEnd.viewLayout, selectedAlbumId:naturalEnd.selectedAlbumId };
    return result;
  } catch (error) {
    result.ok = false;
    result.error = String(error?.stack ?? error);
    result.summary = { ok:false, cases:result.cases.length, screenshots:result.screenshots.length,
      layoutTransitions:result.timeline.length, flightSamples:result.flightSamples.length,
      retargets:result.retargets.length, geometryFrames:result.geometryFrames.length };
    error.archiveMotionResult = result;
    throw error;
  } finally {
    try { wc.setBackgroundThrottling(originalBackgroundThrottling); } catch {}
  }
}
