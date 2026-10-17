import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkArchiveMotion({ browserWindow, outputDirectory, probeReport, getPreferences, getReadyCount }) {
  const wc = browserWindow.webContents;
  const screenshotDirectory = path.join(outputDirectory, 'archive-motion');
  const result = { ok: false, cases: [], assertions: {}, screenshots: [], timeline: [], transitionSamples: [],
    geometryFrames:[], entryTimeline:[], summary: {} };
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
        modelPosition:stats.modelPosition ?? null,
        layoutTransition:stats.layoutTransition ?? null,
        shelfEntry:stats.shelfEntry ?? null,
        motionGeometrySamples:stats.motionGeometrySamples ?? [],
        motionViewport:stats.motionViewport ?? null,
        rackDeployment:stats.rackDeployment ?? null,
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
        modelPosition:stats.modelPosition ?? null, motionGeometrySamples:stats.motionGeometrySamples ?? [],
        rackDeployment:stats.rackDeployment ?? null, musicPresentationPhase:stats.musicPresentationPhase } : null,
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
        cameraAim:stats.cameraAim ?? null, modelPosition:stats.modelPosition ?? null,
        rackDeployment:stats.rackDeployment ?? null } : null,
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
          phase:transition.phase ?? null, heading:transition.heading ?? null,
          rowSpacing:transition.rowSpacing ?? null, transitionRackDeployment:transition.rackDeployment ?? null,
          geometric:transition.geometric ?? null, frameTime:latest.stats?.frameTime ?? null, cameraPosition:latest.stats?.cameraPosition ?? null,
          cameraAim:latest.stats?.cameraAim ?? null, modelPosition:latest.stats?.modelPosition ?? null,
          rackDeployment:latest.stats?.rackDeployment ?? null,
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
    return { frameTime:state?.stats?.frameTime ?? null, active:transition.active ?? null,
      q:transition.q ?? null, progress:transition.progress ?? null, phase:transition.phase ?? null,
      desiredEnd:transition.desiredEnd ?? null, viewLayout:state?.viewLayout ?? null };
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
  const auditTransition = (context, target) => {
    const samples = result.transitionSamples.filter(sample => sample.context === context && sample.active === true &&
      Number.isFinite(sample.progress));
    const phaseSequence = [];
    let previousPhase = null;
    for (const sample of samples) {
      if (sample.phase !== previousPhase) phaseSequence.push(sample.phase);
      previousPhase = sample.phase;
    }
    const findFrame = (phase, predicate) => samples.find(sample => sample.phase === phase && predicate(sample)) ?? null;
    const release = findFrame('release', sample => sample.progress > 0.04 && sample.progress < 0.16);
    const reconfigure = findFrame('reconfigure', sample => Number(sample.q) > 0.48 && Number(sample.q) < 0.54);
    const dock = findFrame('dock', sample => Number(sample.q) > 0.93 && Number(sample.q) < 0.97);
    const midpointViewport = viewportAudit(reconfigure?.motionViewport);
    const neighborMotionPxPerSecond = neighborMotionAudit(samples);
    const progressInBounds = samples.length > 0 && samples.every(sample => sample.progress >= 0 && sample.progress <= 1);
    const progressMonotonic = samples.every((sample, index) => index === 0 || sample.progress + 0.01 >= samples[index - 1].progress);
    const geometricFlag = samples.length > 0 && samples.every(sample => sample.geometric === true);
    const rackTrackConsistent = samples.length > 0 && samples.every(sample =>
      Number.isFinite(Number(sample.rackDeployment)) && Number.isFinite(Number(sample.transitionRackDeployment)) &&
      Math.abs(Number(sample.rackDeployment) - Number(sample.transitionRackDeployment)) < 0.08);
    const geometricFrames = [release, reconfigure, dock].filter(Boolean);
    const matricesPresent = geometricFrames.length === 3 && geometricFrames.every(sample => {
      const poses = sample.motionGeometrySamples;
      return Array.isArray(poses) && poses.length > 0 && poses.length <= 8 && poses.every(pose =>
        xyz(pose.position) && xyz(pose.scale));
    });
    const releaseToReconfigure = compareGeometry(release, reconfigure);
    const reconfigureToDock = compareGeometry(reconfigure, dock);
    const geometryMovesThroughMiddle = matricesPresent && releaseToReconfigure.matchedCount > 0 &&
      reconfigureToDock.matchedCount > 0 && releaseToReconfigure.changedCount > 0 && reconfigureToDock.changedCount > 0;
    const releaseSpacing = Number(release?.rowSpacing), middleSpacing = Math.max(...samples.filter(sample =>
      sample.phase === 'reconfigure').map(sample => Number(sample.rowSpacing))), dockSpacing = Number(dock?.rowSpacing);
    const rowSpacingExpands = [releaseSpacing, middleSpacing, dockSpacing].every(Number.isFinite) &&
      middleSpacing > Math.max(releaseSpacing, dockSpacing) + 0.05;
    const headingValues = samples.map(sample => Number(sample.heading));
    const headingFinite = headingValues.length > 1 && headingValues.every(Number.isFinite);
    const headingDelta = release && dock ? Number(dock.heading) - Number(release.heading) : NaN;
    const targetHeadingDirection = target === 'shelf' ? 1 : -1;
    const headingMovesTowardTarget = Number.isFinite(headingDelta) && Math.sign(headingDelta) === targetHeadingDirection &&
      Math.abs(headingDelta) > 0.15;
    const maxHeadingStep = headingValues.slice(1).reduce((maximum, heading, index) =>
      Math.max(maximum, Math.abs(heading - headingValues[index])), 0);
    const headingContinuous = headingFinite && samples.slice(1).every((sample, index) =>
      Math.abs(Number(sample.heading) - Number(samples[index].heading)) <=
        8 * Math.max(.016, sample.frameTime - samples[index].frameTime));
    const cameraSamples = samples.map(sample => ({ position:xyz(sample.cameraPosition), aim:xyz(sample.cameraAim), time:sample.frameTime }))
      .filter(sample => sample.position && sample.aim);
    const cameraStepSizes = cameraSamples.slice(1).map((sample, index) =>
      distance3(sample.position, cameraSamples[index].position));
    const aimStepSizes = cameraSamples.slice(1).map((sample, index) =>
      distance3(sample.aim, cameraSamples[index].aim));
    const cameraContinuous = cameraSamples.length > 1 && cameraSamples.slice(1).every((sample, index) => {
      const seconds = Math.max(.016, sample.time - cameraSamples[index].time);
      return cameraStepSizes[index] < 450 * seconds && aimStepSizes[index] < 80 * seconds;
    });
    const cameraYaws = cameraSamples.map(sample => Math.atan2(sample.position[0] - sample.aim[0],
      sample.position[2] - sample.aim[2]));
    let unwrappedCameraYaw = 0, previousCameraYaw = null;
    const cameraYawTrack = cameraYaws.map(yaw => {
      if (previousCameraYaw !== null) unwrappedCameraYaw += Math.atan2(Math.sin(yaw - previousCameraYaw), Math.cos(yaw - previousCameraYaw));
      previousCameraYaw = yaw;
      return unwrappedCameraYaw;
    });
    const cameraYawDelta = cameraYawTrack.length > 1 ? cameraYawTrack.at(-1) - cameraYawTrack[0] : NaN;
    const cameraMovesWithHeading = Number.isFinite(cameraYawDelta) && Math.abs(cameraYawDelta) <= 97 * Math.PI / 180 + 0.04 &&
      Math.abs(cameraYawDelta) > 0.02 && Math.sign(cameraYawDelta) === Math.sign(headingDelta);
    const phaseOrderOkay = ['release','reconfigure','dock'].every((phase, index) =>
      phaseSequence.indexOf(phase) >= 0 && (index === 0 || phaseSequence.indexOf(phase) > phaseSequence.indexOf(['release','reconfigure','dock'][index - 1])));
    return { sampleCount:samples.length, phaseSequence, phaseOrderOkay, progressInBounds, progressMonotonic,
      geometricFlag, rackTrackConsistent,
      releaseProgress:release?.progress ?? null, reconfigureProgress:reconfigure?.progress ?? null, dockProgress:dock?.progress ?? null,
      matricesPresent, releaseToReconfigure, reconfigureToDock, geometryMovesThroughMiddle,
      releaseSpacing, middleSpacing, dockSpacing, rowSpacingExpands,
      headingFinite, headingDelta, headingMovesTowardTarget, maxHeadingStep, headingContinuous,
      cameraSampleCount:cameraSamples.length, cameraContinuous, cameraYawDelta, cameraMovesWithHeading,
      midpointViewport, neighborMotionPxPerSecond };
  };
  const captureGeometryFrame = async (context, target, phase, sample) => {
    const detailed = await geometrySnapshot();
    const geometry = detailed.stats?.motionGeometry ?? null;
    const transition = detailed.stats?.layoutTransition ?? null;
    const instances = geometry?.instances ?? [];
    const matricesValid = Array.isArray(instances) && instances.length > 0 && instances.every(instance =>
      instance?.id && Array.isArray(instance.matrix) && instance.matrix.length === 16 && instance.matrix.every(Number.isFinite));
    const boundsValid = xyz(geometry?.bounds?.min) && xyz(geometry?.bounds?.max);
    const selectedValid = Array.isArray(geometry?.selectedMatrix) && geometry.selectedMatrix.length === 16 &&
      geometry.selectedMatrix.every(Number.isFinite);
    const frame = { context, target, phase, q:transition?.q ?? null, progress:transition?.progress ?? null,
      waitObservedProgress:sample.stats?.layoutTransition?.progress ?? null,
      frameTime:detailed.stats?.frameTime ?? null, selectedAlbumId:detailed.selectedAlbumId,
      selectedEntryKey:detailed.selectedEntryKey, motionGeometry:geometry,
      layoutTransition:transition,
      motionViewport:detailed.stats?.motionViewport ?? null };
    result.geometryFrames.push(frame);
    record(`${context} ${phase} captures actual bounds and occurrence matrices`,
      matricesValid && boundsValid && selectedValid,
      { phase, instanceCount:instances.length, bounds:geometry?.bounds ?? null,
        selectedMatrixLength:geometry?.selectedMatrix?.length ?? null });
    return frame;
  };
  const transitionTo = async (designLabel, target, identity) => {
    let current = await snapshot();
    if (current.viewLayout === target) return current;
    const context = `${designLabel} ${target} #${++transitionSequence}`;
    transitionProbeContext = context;
    transitionProbeStartedAt = Date.now();
    await clickLayout(target);
    const active = await waitForFast(state => state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.progress) > 0 && state.viewLayout === target,
    `${designLabel} ${target} transition active`, 7000, 12);
    record(`${designLabel} ${target} has an active intermediate frame`,
      active.stats.layoutTransition.progress > 0 && active.stats.layoutTransition.progress < 1 && identityMatches(active, identity), shortState(active));
    const release = await waitForFast(state => state.stats?.layoutTransition?.active === true &&
      state.stats.layoutTransition.phase === 'release' && Number(state.stats.layoutTransition.progress) > 0.04 &&
      Number(state.stats.layoutTransition.progress) < 0.16,
    `${designLabel} ${target} release phase`, 7000, 12);
    record(`${designLabel} ${target} release frame preserves selection identity`, identityMatches(release, identity), shortState(release));
    await captureGeometryFrame(context, target, 'release', release);
    const releaseGeometry = result.geometryFrames.at(-1);
    await takeScreenshot(`${designLabel.toLowerCase()}-${target}-geometry-release`,
      { phase:'release', geometryReadQ:releaseGeometry.q }, 0, true);
    const reconfigure = await waitForFast(state => state.stats?.layoutTransition?.active === true &&
      state.stats.layoutTransition.phase === 'reconfigure' && Number(state.stats.layoutTransition.q) > 0.49 &&
      Number(state.stats.layoutTransition.q) < 0.52,
    `${designLabel} ${target} geometric reconfiguration`, 7000, 12);
    record(`${designLabel} ${target} reconfiguration frame preserves selection identity`, identityMatches(reconfigure, identity), shortState(reconfigure));
    const middleGeometry = await captureGeometryFrame(context, target, 'middle', reconfigure);
    await takeScreenshot(`${designLabel.toLowerCase()}-${target}-geometry-middle`,
      { phase:'reconfigure', geometryReadQ:middleGeometry.q }, 0, true);
    const dock = await waitForFast(state => state.stats?.layoutTransition?.active === true &&
      state.stats.layoutTransition.phase === 'dock' && Number(state.stats.layoutTransition.q) > 0.94 &&
      Number(state.stats.layoutTransition.q) < 0.955,
    `${designLabel} ${target} dock phase`, 7000, 12);
    record(`${designLabel} ${target} dock frame preserves selection identity`, identityMatches(dock, identity), shortState(dock));
    const dockGeometry = await captureGeometryFrame(context, target, 'dock', dock);
    await takeScreenshot(`${designLabel.toLowerCase()}-${target}-geometry-dock`,
      { phase:'dock', geometryReadQ:dockGeometry.q }, 0, true);
    if (designLabel === 'Future' && target === 'shelf' && context === 'Future shelf #1' &&
        identity.selectedAlbumId === 'fixture-album-28') {
      const handoffFrames = [middleGeometry, dockGeometry];
      const completeLongGroupHandoff = handoffFrames.every(frame =>
        (frame.motionGeometry?.instances?.length ?? 0) >= 17 &&
        Number(frame.layoutTransition?.matched) === 18 && Number(frame.layoutTransition?.arriving) === 0);
      record('Future long-group shelf handoff retains 18 matched occurrences without arrivals', completeLongGroupHandoff,
        handoffFrames.map(frame => ({ phase:frame.phase, q:frame.q, matched:frame.layoutTransition?.matched,
          arriving:frame.layoutTransition?.arriving, nonzeroInstances:frame.motionGeometry?.instances?.length ?? 0 })));
    }
    const end = await waitForFast(state => state.viewLayout === target && state.stats?.layoutTransition?.active === false,
      `${designLabel} ${target} endpoint`, 10000, 12);
    record(`${designLabel} ${target} reaches its endpoint with identity intact`, identityMatches(end, identity), shortState(end));
    const audit = auditTransition(context, target);
    record(`${designLabel} ${target} reports bounded progress and release, reconfigure, dock in order`,
      audit.progressInBounds && audit.progressMonotonic && audit.geometricFlag && audit.phaseOrderOkay, audit);
    record(`${designLabel} ${target} changes actual sampled mesh matrices through an intermediate pose`,
      audit.geometryMovesThroughMiddle, audit);
    record(`${designLabel} ${target} expands row spacing during reconfiguration`, audit.rowSpacingExpands, audit);
    record(`${designLabel} ${target} keeps all selected-case corners inside the available scene viewport at midpoint`,
      audit.midpointViewport.ok, audit.midpointViewport);
    record(`${designLabel} ${target} heading and camera move continuously in the same direction`,
      audit.headingMovesTowardTarget && audit.headingContinuous && audit.cameraContinuous && audit.cameraMovesWithHeading, audit);
    const expectedRackDeployment = target === 'shelf' ? 1 : 0;
    const actualRackDeployment = Number(end.stats?.rackDeployment);
    const transitionRackDeployment = Number(end.stats?.layoutTransition?.rackDeployment);
    const rackEndpointOkay = Number.isFinite(actualRackDeployment) && Number.isFinite(transitionRackDeployment) &&
      Math.abs(actualRackDeployment - expectedRackDeployment) < 0.06 &&
      Math.abs(transitionRackDeployment - expectedRackDeployment) < 0.06;
    record(`${designLabel} ${target} rack deployment reaches its endpoint`, rackEndpointOkay,
      { expectedRackDeployment, actualRackDeployment:end.stats?.rackDeployment,
        transitionRackDeployment:end.stats?.layoutTransition?.rackDeployment });
    record(`${designLabel} ${target} rack resources follow the reported deployment while moving`, audit.rackTrackConsistent, audit);
    record(`${designLabel} ${target} has a static target layout and identity after reveal`,
      end.viewLayout === target && end.stats?.layoutTransition?.active === false && identityMatches(end, identity), shortState(end));
    result.timeline.push({ design:designLabel, target, activeProgress:active.stats.layoutTransition.progress,
      releaseProgress:release.stats.layoutTransition.progress, reconfigureProgress:reconfigure.stats.layoutTransition.progress,
      dockProgress:dock.stats.layoutTransition.progress, phaseSequence:audit.phaseSequence,
      midpointViewport:audit.midpointViewport, neighborMotionPxPerSecond:audit.neighborMotionPxPerSecond,
      rackDeployment:end.stats?.rackDeployment, endpoint:end.viewLayout,
      selectedAlbumId:end.selectedAlbumId, entryKey:end.selectedEntryKey });
    transitionProbeStartedAt = 0;
    transitionProbeContext = '';
    return end;
  };
  const exerciseLayoutTransitions = async (designLabel, identity) => {
    const sourceState = await snapshot();
    const sourceSelectedCell = { lane:Number(sourceState.stats?.selectedCell?.lane), row:Number(sourceState.stats?.selectedCell?.row) };
    record(`${designLabel} fixed-plan retarget starts at the current MATRIX source coordinates`,
      sourceState.viewLayout === 'array' && Number.isFinite(sourceSelectedCell.lane) && Number.isFinite(sourceSelectedCell.row) &&
      identityMatches(sourceState, identity), { sourceSelectedCell, identity, state:shortState(sourceState) });
    const retargetContext = `${designLabel} fixed-plan retargets`;
    transitionProbeContext = retargetContext;
    transitionProbeStartedAt = Date.now();
    await clickLayout('shelf');
    const qWindow = (minimum, maximum, desiredEnd, label) => waitForFast(state =>
      state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.desiredEnd) === desiredEnd &&
      Number(state.stats.layoutTransition.q) >= minimum && Number(state.stats.layoutTransition.q) <= maximum,
    `${designLabel} ${label}`, 20000, 8);
    const q02 = await qWindow(0.16, 0.24, 1, 'retarget q near 0.2');
    record(`${designLabel} retarget starts on a stable MATRIX identity`, identityMatches(q02, identity), shortState(q02));
    const qSamples = [{ target:0.2, observed:Number(q02.stats.layoutTransition.q), desiredEnd:q02.stats.layoutTransition.desiredEnd }];
    const retargetAndCheck = async (targetLayout, nextDesiredEnd, flipNumber) => {
      const requestStartedAt = Date.now();
      const atomic = await retargetLayoutAtomically(targetLayout);
      const before = atomic.before;
      const atomicAfter = atomic.after;
      const beforeTransition = before.stats?.layoutTransition ?? {};
      const confirmation = await waitForFast(state => state.viewLayout === targetLayout &&
        state.stats?.layoutTransition?.active === true &&
        Number(state.stats.layoutTransition.desiredEnd) === nextDesiredEnd,
      `${designLabel} retarget ${flipNumber} to ${targetLayout}`, 10000, 8);
      const atomicRetargeted = Number(atomicAfter.stats?.layoutTransition?.desiredEnd) === nextDesiredEnd;
      const after = atomicRetargeted ? atomicAfter : await geometrySnapshot();
      const elapsedWallSeconds = (Date.now() - requestStartedAt) / 1000;
      const frameDelta = Number(after.stats?.frameTime) - Number(before.stats?.frameTime);
      const elapsedSeconds = Number.isFinite(frameDelta) && frameDelta > 0
        ? Math.min(0.8, frameDelta) : Math.min(0.8, elapsedWallSeconds);
      const afterTransition = after.stats?.layoutTransition ?? {};
      const qBefore = Number(beforeTransition.q), qAfter = Number(afterTransition.q);
      const velocityBefore = Number(beforeTransition.qVelocity), velocityAfter = Number(afterTransition.qVelocity);
      const qDelta = Math.abs(qAfter - qBefore), velocityDelta = Math.abs(velocityAfter - velocityBefore);
      const geometryContinuity = compareGeometry(before, after);
      const actualMatrixContinuity = compareActualMatrices(before, after);
      const cameraContinuity = distance3(before.stats?.cameraPosition, after.stats?.cameraPosition);
      const aimContinuity = distance3(before.stats?.cameraAim, after.stats?.cameraAim);
      const modelContinuity = distance3(before.stats?.modelPosition, after.stats?.modelPosition);
      const headingContinuity = Math.abs(Number(beforeTransition.heading) - Number(afterTransition.heading));
      const rowContinuity = Math.abs(Number(beforeTransition.rowSpacing) - Number(afterTransition.rowSpacing));
      const qLimit = atomicRetargeted ? 0.001 : 0.13 + elapsedSeconds * 0.5;
      const velocityLimit = atomicRetargeted ? 0.001 : 0.28 + elapsedSeconds * 1.2;
      const matrixLimit = atomicRetargeted ? 0.001 : 1.25 + elapsedSeconds * 8;
      const poseLimit = atomicRetargeted ? 0.001 : 2.5 + elapsedSeconds * 16;
      const qContinuous = Number.isFinite(qBefore) && Number.isFinite(qAfter) && qDelta <= qLimit;
      const qVelocityContinuous = Number.isFinite(velocityBefore) && Number.isFinite(velocityAfter) &&
        velocityDelta <= velocityLimit && (atomicRetargeted || Math.abs(velocityBefore) < 0.12 ||
          Math.sign(velocityBefore) === Math.sign(velocityAfter) || elapsedSeconds > 0.25);
      const poseContinuous = geometryContinuity.matchedCount > 0 && geometryContinuity.maxDelta <= matrixLimit &&
        actualMatrixContinuity.matchedCount > 0 && actualMatrixContinuity.maxElementDelta <= matrixLimit &&
        Number.isFinite(actualMatrixContinuity.selectedMatrixDelta) && actualMatrixContinuity.selectedMatrixDelta <= matrixLimit &&
        Number.isFinite(cameraContinuity) && cameraContinuity <= poseLimit &&
        Number.isFinite(aimContinuity) && aimContinuity <= poseLimit &&
        Number.isFinite(modelContinuity) && modelContinuity <= poseLimit &&
        headingContinuity <= (atomicRetargeted ? 0.001 : 0.35 + elapsedSeconds) &&
        rowContinuity <= (atomicRetargeted ? 0.001 : 0.35 + elapsedSeconds * 2);
      const retargetedInPlace = Number(beforeTransition.desiredEnd) === 1 - nextDesiredEnd &&
        Number(afterTransition.desiredEnd) === nextDesiredEnd;
      record(`${designLabel} flip ${flipNumber} retargets the same plan with q, velocity and matrices continuous`,
        retargetedInPlace && qContinuous && qVelocityContinuous && poseContinuous,
        { targetLayout, qBefore, qAfter, qDelta, velocityBefore, velocityAfter, velocityDelta,
          atomicRetargeted, elapsedSeconds, qLimit, velocityLimit, matrixLimit, geometryContinuity,
          actualMatrixContinuity, cameraContinuity, aimContinuity, modelContinuity,
          headingContinuity, rowContinuity, desiredEndBefore:beforeTransition.desiredEnd,
          desiredEndAfter:afterTransition.desiredEnd,
          timingSource:Number.isFinite(frameDelta) && frameDelta > 0 ? 'scene frameTime' : 'wall-clock fallback' });
      record(`${designLabel} flip ${flipNumber} preserves selected identity`, identityMatches(confirmation, identity), shortState(confirmation));
      return confirmation;
    };
    await retargetAndCheck('array', 0, 1);
    const q03 = await qWindow(0.01, 0.06, 0, 'retarget q near 0.03');
    qSamples.push({ target:0.03, observed:Number(q03.stats.layoutTransition.q), desiredEnd:q03.stats.layoutTransition.desiredEnd });
    await retargetAndCheck('shelf', 1, 2);
    const q05 = await qWindow(0.44, 0.56, 1, 'retarget q near 0.5');
    qSamples.push({ target:0.5, observed:Number(q05.stats.layoutTransition.q), desiredEnd:q05.stats.layoutTransition.desiredEnd });
    const q08 = await qWindow(0.75, 0.85, 1, 'retarget q near 0.8');
    qSamples.push({ target:0.8, observed:Number(q08.stats.layoutTransition.q), desiredEnd:q08.stats.layoutTransition.desiredEnd });
    const q097 = await qWindow(0.93, 0.99, 1, 'retarget q near 0.97');
    qSamples.push({ target:0.97, observed:Number(q097.stats.layoutTransition.q), desiredEnd:q097.stats.layoutTransition.desiredEnd });
    const afterFlip3 = await retargetAndCheck('array', 0, 3);
    record(`${designLabel} fixed-plan retarget probe samples q near 0.03/0.2/0.5/0.8/0.97`,
      qSamples.length === 5 && qSamples.every(sample => Number.isFinite(sample.observed)), qSamples);
    const end = await waitForFast(state => state.viewLayout === 'array' && state.stats?.layoutTransition?.active === false,
      `${designLabel} fixed-plan retarget endpoint`, 30000, 12);
    record(`${designLabel} three retarget flips settle at a static MATRIX layout`, identityMatches(end, identity) &&
      end.stats?.layoutTransition?.active === false, shortState(end));
    const finalSelectedCell = end.stats?.selectedCell ?? null;
    const sourceCoordinatesRestored = Number(finalSelectedCell?.lane) === sourceSelectedCell.lane &&
      Number(finalSelectedCell?.row) === sourceSelectedCell.row;
    record(`${designLabel} three retarget flips restore the original MATRIX lane and row with identity intact`,
      sourceCoordinatesRestored && identityMatches(end, identity),
      { sourceSelectedCell, finalSelectedCell, selectedAlbumId:end.selectedAlbumId, selectedEntryKey:end.selectedEntryKey });
    const reverseRackOkay = Number.isFinite(Number(end.stats?.rackDeployment)) &&
      Math.abs(Number(end.stats.rackDeployment)) < 0.06 &&
      Math.abs(Number(end.stats?.layoutTransition?.rackDeployment)) < 0.06;
    record(`${designLabel} retargeted plan docks with the rack retracted`, reverseRackOkay,
      { rackDeployment:end.stats?.rackDeployment, transitionRackDeployment:end.stats?.layoutTransition?.rackDeployment });
    const retargetSamples = result.transitionSamples.filter(sample => sample.context === retargetContext);
    const activeRetargetSamples = retargetSamples.filter(sample => sample.active === true);
    const rackTrackConsistent = activeRetargetSamples.length > 0 && activeRetargetSamples.every(sample =>
      Number.isFinite(Number(sample.rackDeployment)) && Number.isFinite(Number(sample.transitionRackDeployment)) &&
      Math.abs(Number(sample.rackDeployment) - Number(sample.transitionRackDeployment)) < 0.08);
    record(`${designLabel} retargeted rack resources follow the reported deployment`, rackTrackConsistent,
      { sampleCount:activeRetargetSamples.length });
    transitionProbeStartedAt = 0;
    transitionProbeContext = '';
    let settledFrameHandoff = null;
    if (designLabel === 'Future' && identity.selectedAlbumId === 'fixture-album-28') {
      const terminal = await geometrySnapshot();
      const terminalFrameTime = Number(terminal.stats?.frameTime);
      const nextFrameFast = await waitForFast(state => state.stats?.layoutTransition?.active === false &&
        Number(state.stats?.frameTime) > terminalFrameTime,
      'Future MATRIX ordinary frame after settled retarget endpoint', 5000, 4);
      const nextFrame = await geometrySnapshot();
      const entriesAroundSource = state => {
        const instances = state.stats?.motionGeometry?.instances ?? [];
        const byKey = new Map(), byCell = new Map(), lanes = new Set();
        for (const instance of instances) {
          const cell = instance?.cell;
          const lane = Number(cell?.lane), row = Number(cell?.row);
          const entry = String(instance?.entry ?? cell?.foobarEntryKey ?? '');
          const matrix = instance?.matrix;
          if (!entry || !Number.isFinite(lane) || !Number.isFinite(row) ||
              Math.abs(lane - sourceSelectedCell.lane) > 2 || Math.abs(row - sourceSelectedCell.row) > 8 ||
              !Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(Number.isFinite)) continue;
          const cellKey = `${lane}:${row}`;
          byKey.set(`${entry}|${cellKey}`, { entry, lane, row, matrix });
          byCell.set(cellKey, entry);
          lanes.add(lane);
        }
        return { byKey, byCell, lanes:[...lanes].sort((left, right) => left - right) };
      };
      const terminalNeighborhood = entriesAroundSource(terminal), nextNeighborhood = entriesAroundSource(nextFrame);
      const sharedKeys = [...terminalNeighborhood.byKey.keys()].filter(key => nextNeighborhood.byKey.has(key));
      const missingKeys = [...terminalNeighborhood.byKey.keys()].filter(key => !nextNeighborhood.byKey.has(key));
      const cellEntryChanges = [...terminalNeighborhood.byCell.entries()]
        .filter(([cell, entry]) => nextNeighborhood.byCell.has(cell) && nextNeighborhood.byCell.get(cell) !== entry)
        .map(([cell, before]) => ({ cell, before, after:nextNeighborhood.byCell.get(cell) }));
      const matrixMaxDelta = sharedKeys.reduce((maximum, key) => {
        const before = terminalNeighborhood.byKey.get(key).matrix, after = nextNeighborhood.byKey.get(key).matrix;
        return Math.max(maximum, Math.max(...before.map((value, index) => Math.abs(value - after[index]))));
      }, 0);
      const terminalSelectedMatrix = terminal.stats?.motionGeometry?.selectedMatrix;
      const nextSelectedMatrix = nextFrame.stats?.motionGeometry?.selectedMatrix;
      const selectedMatrixDelta = Array.isArray(terminalSelectedMatrix) && terminalSelectedMatrix.length === 16 &&
        Array.isArray(nextSelectedMatrix) && nextSelectedMatrix.length === 16
        ? Math.max(...terminalSelectedMatrix.map((value, index) => Math.abs(value - nextSelectedMatrix[index]))) : Infinity;
      const frameTimeDelta = Number(nextFrame.stats?.frameTime) - terminalFrameTime;
      const laneCoverage = terminalNeighborhood.lanes.length >= 3;
      const handoffOkay = frameTimeDelta > 0 && identityMatches(terminal, identity) && identityMatches(nextFrame, identity) &&
        Number(terminal.stats?.selectedCell?.lane) === sourceSelectedCell.lane &&
        Number(terminal.stats?.selectedCell?.row) === sourceSelectedCell.row &&
        Number(nextFrame.stats?.selectedCell?.lane) === sourceSelectedCell.lane &&
        Number(nextFrame.stats?.selectedCell?.row) === sourceSelectedCell.row &&
        terminalNeighborhood.byKey.size > 0 && laneCoverage && missingKeys.length === 0 &&
        cellEntryChanges.length === 0 && matrixMaxDelta <= 0.1 && selectedMatrixDelta <= 0.1;
      settledFrameHandoff = { terminalFrameTime, nextFrameTime:nextFrame.stats?.frameTime, frameTimeDelta,
        sourceSelectedCell, terminalSelectedCell:terminal.stats?.selectedCell ?? null,
        nextSelectedCell:nextFrame.stats?.selectedCell ?? null,
        terminalNeighborhoodKeys:terminalNeighborhood.byKey.size, nextNeighborhoodKeys:nextNeighborhood.byKey.size,
        sharedKeys:sharedKeys.length, missingKeys, cellEntryChanges, laneCoverage:terminalNeighborhood.lanes,
        matrixMaxDelta, selectedMatrixDelta, identityStable:identityMatches(terminal, identity) && identityMatches(nextFrame, identity),
        nextFrameFastTime:nextFrameFast.stats?.frameTime ?? null };
      record('Future settled retarget preserves entry/cell matrices through the next ordinary frame', handoffOkay,
        settledFrameHandoff);
    }
    result.timeline.push({ design:designLabel, target:'array', retargetFlips:3, qSamples, sourceSelectedCell, finalSelectedCell,
      finalDesiredEnd:0, rackDeployment:end.stats?.rackDeployment, settledFrameHandoff,
      endpoint:end.viewLayout });
    await transitionTo(designLabel, 'shelf', identity);
    return transitionTo(designLabel, 'array', identity);
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
    const originalViewportWidth = (await snapshot()).viewport?.width;
    try {
      browserWindow.setSize(800, originalSize[1]);
      const narrow = await waitFor(state => state.design === 'archive' && state.page === 'music' &&
        state.mode === 'archive' && state.controls.layout?.visible && state.viewport?.width >= 720 &&
        state.viewport.width <= 800, '800px Punk tools viewport', 5000, 30);
      verifyPunkCompactTools(narrow, '800px');
      const expectedBleed = narrow.viewport.width <= 720 ? 0 : 32;
      await verifyPunkChrome('punk-tools-800px', expectedBleed);
    } finally {
      browserWindow.setSize(originalSize[0], originalSize[1]);
      if (Number.isFinite(originalViewportWidth)) await waitFor(state => Math.abs(state.viewport?.width - originalViewportWidth) <= 2,
        'restore archive motion viewport size', 5000, 30);
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
    record('probe starts Future MATRIX with automatic entry disabled',
      initial.viewLayout === 'array' && initial.entry?.active === false && !initial.overlayPresent &&
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
    await takeScreenshot('future-matrix-overview');
    const futureMatrixEnd = await exerciseMatrixInteraction('Future');
    identity = { selectedAlbumId:futureMatrixEnd.selectedAlbumId, selectedEntryKey:futureMatrixEnd.selectedEntryKey };
    record('Future MATRIX drag leaves a stable catalog identity for later theme transitions',
      !!identity.selectedAlbumId && !!identity.selectedEntryKey && futureMatrixEnd.selectedAlbumId === futureMatrixEnd.selectedAlbumFromApp,
      identity);

    const punk = await switchDesign('archive');
    record('theme switch preserves the selected album', punk.selectedAlbumId === identity.selectedAlbumId,
      { selectedAlbumId:punk.selectedAlbumId, expected:identity.selectedAlbumId });
    if (punk.viewLayout !== 'array') await transitionTo('Punk', 'array', identity);
    await exerciseLayoutTransitions('Punk', identity);
    await transitionTo('Punk', 'shelf', identity);
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
      layoutTransitions:result.timeline.length, geometryFrames:result.geometryFrames.length, entryPhaseSequence:observedEntryPhases,
      keyframeCount, naturalPlaybackSeconds,
      finalLayout:naturalEnd.viewLayout, selectedAlbumId:naturalEnd.selectedAlbumId };
    return result;
  } catch (error) {
    result.ok = false;
    result.error = String(error?.stack ?? error);
    result.summary = { ok:false, cases:result.cases.length, screenshots:result.screenshots.length,
      layoutTransitions:result.timeline.length, geometryFrames:result.geometryFrames.length };
    error.archiveMotionResult = result;
    throw error;
  } finally {
    try { wc.setBackgroundThrottling(originalBackgroundThrottling); } catch {}
  }
}
