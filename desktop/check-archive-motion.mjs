import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ARCHIVE_MOTION_MATRIX_LANE_COUNT = 9;
const ARCHIVE_MOTION_MATRIX_ROWS = 48;
const ARCHIVE_MOTION_SHELF_SLOTS = 20;
// Independent copy of the e6ae98f static MATRIX camera contract. Keep these
// values and equations local to this oracle so production framing changes
// cannot update both the expected and observed camera at once.
const E6_MATRIX_CAMERA = Object.freeze({
  yaw:59, elevation:25, distance:140, span:7.33,
  aim:Object.freeze({ x:-1.091, y:-0.045, z:0.481 }),
});
const wrapIndex = (value, count) => count > 0 ? ((value % count) + count) % count : 0;
const finiteValue = value => value !== null && value !== undefined && Number.isFinite(Number(value));
const e6CameraSmooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const e6SettlingWave = (distance, time) => {
  const age = time - 25.05 - Math.abs(distance) * 0.065;
  const envelope = Math.max(-0.42, 2.15 - 0.17 * (Math.sqrt(distance * distance + 1) - 1));
  const rise = e6CameraSmooth(age / 0.62);
  const ring = age > 0 ? Math.sin(age * 5.1) * Math.exp(-age * 1.3) : 0;
  return envelope * (rise + 0.18 * ring * e6CameraSmooth(age / 0.16));
};
const e6CameraIsPortrait = (width, height) => Math.max(1, width) / Math.max(1, height) < 1.05;
const e6ArchiveCameraFraming = (width, height, span, detail, compact) => {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const aspect = width / height;
  const portrait = e6CameraIsPortrait(width, height);
  const baseSpan = span + (5.9 - span) * detail;
  const portraitDetailSpan = Math.max(6.3 / aspect, 3.7 * height / Math.max(100, 0.54 * height - 156));
  const viewSpan = portrait
    ? Math.max(baseSpan, 8.4 / aspect + (portraitDetailSpan - 8.4 / aspect) * detail)
    : Math.max(baseSpan, baseSpan * (16 / 9) / aspect);
  return { span:viewSpan, portrait, previewY:portrait ? 0.36 : 0.5,
    detailX:portrait ? 0.5 : compact ? 0.27 : 550 / 1920,
    detailY:portrait ? 0.27 + 34 / height : compact ? 0.49 : 560 / 1080 };
};
const e6MusicArchiveOffset = (width, height) => {
  if (e6CameraIsPortrait(width, height)) return { x:0, y:0 };
  const aspect = Math.max(1, width) / Math.max(1, height);
  const wide = e6CameraSmooth((aspect - 16 / 9) / (21 / 9 - 16 / 9));
  return { x:0.035 * wide, y:0.08 + 0.02 * wide };
};
const quinticStep = (value, start = 0, end = 1) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const expectedArchiveMotionGroundY = (q, bounds) => {
  const minY = Number(bounds?.min?.[1]);
  if (!Number.isFinite(q) || !Number.isFinite(minY)) return null;
  const arrayGround = -4.6 + minY - .51;
  const floorAmount = 1 - quinticStep(q, .65, .95);
  return -4.63 + (arrayGround + 4.63) * floorAmount;
};

/** Rebuild the deterministic fixture's production genre-to-shelf mapping. */
export function buildArchiveMotionFixtureShelves(fixtureCatalog) {
  const groups = Array.isArray(fixtureCatalog?.groups) ? fixtureCatalog.groups : [];
  if (!groups.length || groups.some(group => !group?.name || !Array.isArray(group.entryKeys))) return [];
  const orderedGroups = [...groups].sort((left, right) =>
    String(left.name).localeCompare(String(right.name), 'zh-CN', { sensitivity:'base', numeric:true }));
  const shelves = [[]];
  for (const group of orderedGroups) for (const entryKey of group.entryKeys) {
    if (shelves.at(-1).length >= ARCHIVE_MOTION_SHELF_SLOTS) shelves.push([]);
    shelves.at(-1).push(String(entryKey));
  }
  return shelves;
}

/** Match musicArrayEntry's lane wrap and per-shelf row period. */
export function expectedArchiveMotionMatrixEntry(shelves, lane, row) {
  if (!Array.isArray(shelves) || shelves.length === 0 || !Number.isFinite(Number(lane)) ||
      !Number.isFinite(Number(row))) return null;
  const shelf = shelves[wrapIndex(Number(lane), shelves.length)];
  return shelf?.length ? shelf[wrapIndex(Number(row) - 12, shelf.length)] ?? null : null;
}

export async function checkArchiveMotion({ browserWindow, outputDirectory, probeReport, getPreferences, getReadyCount }) {
  const wc = browserWindow.webContents;
  const screenshotDirectory = path.join(outputDirectory, 'archive-motion');
  const result = { ok: false, cases: [], assertions: {}, screenshots: [], timeline: [], transitionSamples: [],
    geometryFrames:[], flightSamples:[], routeEndpointBridges:[], matrixSlotAudits:[], extraRiseReversals:[],
    retargets:[], qSampleMisses:[], entryTimeline:[], windowRestores:[], legacyCameraAudits:[],
    cameraEndpointBridges:[], summary: {} };
  let transitionProbeStartedAt = 0;
  let transitionProbeContext = '';
  let transitionSequence = 0;
  const originalBackgroundThrottling = wc.getBackgroundThrottling?.() ?? true;
  const ensureProbeVisible = () => {
    if (browserWindow.isDestroyed() || browserWindow.isVisible()) return;
    result.windowRestores.push({ at:Date.now(), minimized:browserWindow.isMinimized() });
    if (browserWindow.isMinimized()) browserWindow.restore();
    browserWindow.showInactive();
  };
  const stateScript = String.raw`(() => {
    const stage = document.querySelector('#stage');
    const app = window.rhineMusic;
    const stats = app?.stats?.() ?? null;
    const canvas = document.querySelector('#three-scene canvas');
    let reducedMotionPreference = null;
    try { reducedMotionPreference = JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}')?.reduced ?? null; } catch {}
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
      compactLayout:document.querySelector('#three-scene')?.closest('[data-layout]')?.dataset.layout === 'compact',
      styleArrayScale:app?.design?.arrayScale ?? stage?.dataset.styleArrayScale ?? null,
      reducedMotionPreference,
      reducedMotionActive:stage?.classList.contains('reduce-motion') ?? null,
      viewLayout,
      legacyLayout:stage?.dataset.foobarLayout ?? null,
      visibility:document.visibilityState,
      viewport:{ width:innerWidth, height:innerHeight },
      stats:stats ? {
        loaded:stats.loaded,
        hiRes:stats.hiRes ?? null,
        floorY:stats.floorY ?? null, archiveBadge:stats.archiveBadge ?? null,
        displayLayout:stats.displayLayout,
        projectedCenter:stats.projectedCenter ?? null,
        selectedAlbumId:stats.selectedAlbumId ?? null,
        selectedCell:stats.selectedCell ?? null,
        returningFiles:stats.returningFiles ?? null,
        selectionPhase:stats.selectionPhase ?? null,
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
      stats:stats ? { layoutTransition:stats.layoutTransition, hiRes:stats.hiRes ?? null,
        floorY:stats.floorY ?? null, archiveBadge:stats.archiveBadge ?? null, shelfEntry:stats.shelfEntry ?? null,
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
        hiRes:stats.hiRes ?? null, floorY:stats.floorY ?? null, archiveBadge:stats.archiveBadge ?? null,
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
    ensureProbeVisible();
    try { return await evaluate(stateScript); }
    catch (error) { return { sampleError:String(error?.message ?? error) }; }
  };
  const fastSnapshot = async () => {
    ensureProbeVisible();
    try { return await evaluate(transitionStateScript); }
    catch (error) { return { sampleError:String(error?.message ?? error) }; }
  };
  const geometrySnapshot = async () => {
    ensureProbeVisible();
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
      ensureProbeVisible();
      latest = await fastSnapshot();
      if (transitionProbeStartedAt) {
        const transition = latest.stats?.layoutTransition ?? {};
        result.transitionSamples.push({ context:transitionProbeContext,
          sinceClickMs:Date.now() - transitionProbeStartedAt, sampleMs:Date.now() - sampleStartedAt,
          active:transition.active ?? null, progress:transition.progress ?? null,
          q:transition.q ?? null, qVelocity:transition.qVelocity ?? null, desiredEnd:transition.desiredEnd ?? null,
          phase:transition.phase ?? null, groundY:transition.groundY ?? null, extraRise:transition.extraRise ?? null,
          path:transition.path ?? null, heading:transition.heading ?? null,
          alignmentDuration:transition.alignmentDuration ?? null, alignmentElapsed:transition.alignmentElapsed ?? null,
          prepared:transition.prepared ?? null,
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
  const diagnosticFailure = item => {
    if (!item || typeof item !== 'object') return false;
    if (item.ok === false || item.okay === false || item.passed === false || item.sampleOkay === false) return true;
    if (finiteValue(item.error) && Math.abs(Number(item.error)) > .035) return true;
    const failureFlags = ['routeStable','arrayCellStable','alphaOkay','scaleDepthOkay','geometryPathFinite',
      'badgeKindValid','extraClipMatchesRoute','completeBoundsAtArray','riseMonotonicByQ',
      'riseMonotonicInTravel','extraRiseRange','fullyRaisedAtMatrix','adjacentSlotsContinuous',
      'visibleAmountsDiffer','orderedWindowsVary'];
    return failureFlags.some(key => item[key] === false) ||
      Object.entries(item).some(([key, value]) =>
        /(?:^missing|failures$|misses$|unmatched$|duplicateIds$|ownerChanges$)/i.test(key) &&
        Array.isArray(value) && value.length > 0);
  };
  const summarizeDiagnostic = (value, key = '') => {
    if (Array.isArray(value)) {
      if (value.length <= 12) return value.map(item => summarizeDiagnostic(item));
      const numeric = value.every(item => typeof item === 'number' && Number.isFinite(item));
      if (numeric) return { count:value.length, min:Math.min(...value), max:Math.max(...value),
        first:value[0], last:value.at(-1) };
      const failureList = /(?:failures|misses|unmatched|duplicateIds|ownerChanges|failingTracks)$/i.test(key);
      const failures = value.filter(diagnosticFailure);
      const sampleIndexes = [...new Set([0, Math.floor((value.length - 1) / 2), value.length - 1])];
      return { count:value.length,
        ...(failureList ? { items:value.slice(0, 6).map(item => summarizeDiagnostic(item)) } : {}),
        ...(failures.length ? { failureCount:failures.length,
          failures:failures.slice(0, 6).map(item => summarizeDiagnostic(item)) } : {}),
        ...(!failureList ? { samples:sampleIndexes.map(index => summarizeDiagnostic(value[index])) } : {}) };
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) =>
      [childKey, summarizeDiagnostic(child, childKey)]));
  };
  const record = (name, passed, detail = null) => {
    result.assertions[name] = Boolean(passed);
    result.cases.push({ name, ok:Boolean(passed),
      ...(detail === null ? {} : { detail:summarizeDiagnostic(detail) }) });
  };
  const recordObserved = (name, passed, detail = null) => {
    result.assertions[name] = Boolean(passed);
    result.cases.push({ name, ok:Boolean(passed),
      ...(detail === null ? {} : { detail:summarizeDiagnostic(detail) }) });
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
    if (!captureTransitionClock)
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
  const arrayCellKey = value => Number.isFinite(Number(value?.lane)) && Number.isFinite(Number(value?.row))
    ? `${Number(value.lane)}:${Number(value.row)}` : null;
  const fixtureMatrixShelves = buildArchiveMotionFixtureShelves(probeReport?.syntheticArchiveMotionFixtureCatalog);
  const routeRiseIdentity = route => route?.rise == null ? null : {
    start:route.rise.start ?? null, end:route.rise.end ?? null,
    edgeDistance:route.rise.edgeDistance ?? null, alongDistance:route.rise.alongDistance ?? null,
  };
  const riseScheduleOkay = rise => {
    if (!rise || !finiteValue(rise.start) || !finiteValue(rise.end) ||
        !finiteValue(rise.edgeDistance) || !finiteValue(rise.alongDistance) ||
        !finiteValue(rise.amount) || !finiteValue(rise.lift)) return false;
    const start = Number(rise.start), end = Number(rise.end);
    const edgeDistance = Number(rise.edgeDistance), alongDistance = Number(rise.alongDistance);
    const amount = Number(rise.amount);
    const expectedStart = .18 + .34 * (1 - Math.exp(-(edgeDistance + alongDistance) / 9));
    return edgeDistance >= 0 && alongDistance >= 0 && amount >= -.001 && amount <= 1.001 &&
      start >= .18 - .002 && start <= .52 + .002 && Math.abs(start - expectedStart) <= .002 &&
      Math.abs((end - start) - .44) <= .002 && end >= .62 - .002 && end <= .96 + .002;
  };
  const xyz = value => Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)
    ? value.slice(0, 3).map(Number) : null;
  const add3 = (left, right) => left.map((value, index) => value + right[index]);
  const scale3 = (value, amount) => value.map(component => component * amount);
  const subtract3 = (left, right) => left.map((value, index) => value - right[index]);
  const cross3 = (left, right) => [left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
  const length3 = value => Math.hypot(...value);
  const normalize3 = value => {
    const length = length3(value);
    return length > 1e-9 ? scale3(value, 1 / length) : null;
  };
  const e6MatrixCameraExpectation = state => {
    const viewport = state?.stats?.motionViewport ?? {};
    const width = Number(viewport.width ?? state?.viewport?.width);
    const height = Number(viewport.height ?? state?.viewport?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
      return { ok:false, reason:'missing rendered viewport dimensions' };
    const compact = state.compactLayout === true || viewport.kind === 'compact';
    const framing = e6ArchiveCameraFraming(width, height, E6_MATRIX_CAMERA.span, 0, compact);
    const yaw = E6_MATRIX_CAMERA.yaw * Math.PI / 180;
    const elevation = E6_MATRIX_CAMERA.elevation * Math.PI / 180;
    const direction = [-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation),
      Math.cos(yaw) * Math.cos(elevation)];
    const right = normalize3(cross3([0, 1, 0], direction));
    const up = normalize3(cross3(direction, right));
    let aim;
    if (framing.portrait) {
      const previewAim = [0, -4.6 + e6SettlingWave(0, 26.56) + 0.4 + 1.85, -2.17];
      aim = add3(previewAim, scale3(up, (framing.previewY - 0.5) * framing.span));
    } else {
      const offset = e6MusicArchiveOffset(width, height);
      aim = add3([E6_MATRIX_CAMERA.aim.x, E6_MATRIX_CAMERA.aim.y, E6_MATRIX_CAMERA.aim.z],
        add3(scale3(right, offset.x * framing.span * width / height), scale3(up, offset.y * framing.span)));
    }
    const position = add3(aim, scale3(direction, E6_MATRIX_CAMERA.distance));
    const fieldOfView = 2 * Math.atan(framing.span / (2 * E6_MATRIX_CAMERA.distance)) * 180 / Math.PI;
    return { ok:true, viewport:{ width, height, compact, portrait:framing.portrait }, framing, offset:framing.portrait ? { x:0, y:0 } : e6MusicArchiveOffset(width, height),
      direction, aim, position, span:framing.span, yaw:E6_MATRIX_CAMERA.yaw,
      elevation:E6_MATRIX_CAMERA.elevation, distance:E6_MATRIX_CAMERA.distance, fieldOfView };
  };
  const cameraPose = state => {
    const position = xyz(state?.stats?.cameraPosition), aim = xyz(state?.stats?.cameraAim);
    if (!position || !aim) return null;
    const offset = subtract3(position, aim);
    const distance = length3(offset);
    if (!Number.isFinite(distance) || distance <= 1e-6) return null;
    const yaw = Math.atan2(-offset[0], offset[2]) * 180 / Math.PI;
    const elevation = Math.asin(Math.max(-1, Math.min(1, offset[1] / distance))) * 180 / Math.PI;
    const fieldOfView = Number(state?.stats?.fieldOfView);
    if (!Number.isFinite(fieldOfView)) return null;
    return { position, aim, yaw, elevation, distance, fieldOfView,
      span:2 * distance * Math.tan(fieldOfView * Math.PI / 360) };
  };
  const angleDelta = (left, right) => Math.abs(((left - right + 540) % 360) - 180);
  const compareCameraEndpoints = (from, to, responsiveMatrix = false) => {
    const left = cameraPose(from), right = cameraPose(to);
    if (!left || !right) return { ok:false, reason:'missing camera pose', from:left, to:right };
    let comparison = right, viewportChange = null;
    if (responsiveMatrix) {
      const before = e6MatrixCameraExpectation(from), after = e6MatrixCameraExpectation(to);
      if (!before.ok || !after.ok) return { ok:false, reason:'missing legacy viewport camera', before, after };
      viewportChange = { from:before.viewport, to:after.viewport,
        aim:subtract3(after.aim, before.aim), position:subtract3(after.position, before.position),
        span:after.span - before.span, fieldOfView:after.fieldOfView - before.fieldOfView };
      comparison = { ...right, aim:subtract3(right.aim, viewportChange.aim),
        position:subtract3(right.position, viewportChange.position), span:right.span - viewportChange.span,
        fieldOfView:right.fieldOfView - viewportChange.fieldOfView };
    }
    const deltas = {
      yaw:angleDelta(left.yaw, comparison.yaw), elevation:Math.abs(left.elevation - comparison.elevation),
      distance:Math.abs(left.distance - comparison.distance), fieldOfView:Math.abs(left.fieldOfView - comparison.fieldOfView),
      span:Math.abs(left.span - comparison.span), aim:length3(subtract3(left.aim, comparison.aim)),
      position:length3(subtract3(left.position, comparison.position)),
    };
    return { ok:deltas.yaw <= .2 && deltas.elevation <= .2 && deltas.distance <= .25 &&
      deltas.fieldOfView <= .12 && deltas.span <= .25 && deltas.aim <= .035 && deltas.position <= .4,
      deltas, from:left, to:right, viewportChange };
  };
  const legacyMatrixCameraAudit = state => {
    const expected = e6MatrixCameraExpectation(state), actual = cameraPose(state);
    if (!expected.ok || !actual) return { ok:false, expected, actual, reason:expected.reason ?? 'missing camera pose' };
    const aimDelta = length3(subtract3(actual.aim, expected.aim));
    const positionDelta = length3(subtract3(actual.position, expected.position));
    const errors = { yaw:angleDelta(actual.yaw, expected.yaw), elevation:Math.abs(actual.elevation - expected.elevation),
      distance:Math.abs(actual.distance - expected.distance), span:Math.abs(actual.span - expected.span),
      fieldOfView:Math.abs(actual.fieldOfView - expected.fieldOfView), aim:aimDelta, position:positionDelta };
    return { ok:state.viewLayout === 'array' && state.stats?.layoutTransition?.active !== true &&
      state.presentation?.phase === 'archive' && errors.yaw <= .35 && errors.elevation <= .35 &&
      errors.distance <= .4 && errors.span <= .035 && errors.fieldOfView <= .08 &&
      errors.aim <= .035 && errors.position <= .5,
      expected, actual, errors, viewLayout:state.viewLayout, presentation:state.presentation?.phase ?? null,
      selectedProjectedCenter:state.stats?.projectedCenter ?? null };
  };
  const recordLegacyMatrixCamera = (label, state, settled) => {
    const audit = { label, settled, ...legacyMatrixCameraAudit(state) };
    result.legacyCameraAudits.push(audit);
    record(`${label} matches the independent e6 static MATRIX camera contract`, settled && audit.ok, audit);
    return audit;
  };
  const recordCameraEndpointBridge = (label, from, to, fromLayout, toLayout, responsiveMatrix = false) => {
    const bridge = { label, fromLayout, toLayout, ...compareCameraEndpoints(from, to, responsiveMatrix) };
    result.cameraEndpointBridges.push(bridge);
    record(`${label} preserves the static camera endpoint`, bridge.ok, bridge);
    return bridge;
  };
  const setReducedMotionForEndpointProbe = async enabled => {
    let current = await snapshot();
    if (current.reducedMotionPreference === enabled && current.reducedMotionActive === enabled) return current;
    if (current.page !== 'settings') {
      await click('[data-action="settings"]');
      current = await waitFor(state => state.page === 'settings' && state.settingsHidden === false,
        'open Interface settings for the static camera probe');
    }
    if (current.interfaceCategoryHidden !== false) {
      await click('[data-settings-category-target="interface"]');
      current = await waitFor(state => state.page === 'settings' && state.interfaceCategoryHidden === false,
        'open Interface settings for the static camera probe');
    }
    const changed = await evaluate(`(() => {
      const input = document.querySelector('#reduced-motion');
      if (!input) return false;
      input.checked = ${JSON.stringify(enabled)};
      input.dispatchEvent(new Event('change', { bubbles:true }));
      return true;
    })()`);
    if (!changed) throw new Error('Missing reduced-motion setting for the static camera probe.');
    await waitFor(state => state.page === 'settings' && state.reducedMotionPreference === enabled &&
      state.reducedMotionActive === enabled, `set static camera probe reduced motion to ${enabled}`);
    await click('[data-action="library"]');
    return waitFor(state => state.page === 'music' && state.mode === 'archive' &&
      state.presentation?.phase === 'archive', 'return to the archive after the static camera probe setting');
  };
  const withReducedMotionEndpointProbe = async task => {
    const initial = await snapshot();
    const originalPreference = initial.reducedMotionPreference ?? (getPreferences()?.reduced === true);
    let toggled = false;
    try {
      if (originalPreference !== true) {
        await setReducedMotionForEndpointProbe(true);
        toggled = true;
      }
      return await task();
    } finally {
      if (toggled) await setReducedMotionForEndpointProbe(originalPreference === true);
    }
  };
  const captureStaticCameraEndpoint = async (label, layout, identity) => withReducedMotionEndpointProbe(async () => {
    const state = await waitFor(value => value.viewLayout === layout && value.page === 'music' && value.mode === 'archive' &&
      value.stats?.layoutTransition?.active !== true && value.presentation?.phase === 'archive' &&
      (!identity || identityMatches(value, identity)), `${label} static ${layout} camera endpoint`, 10000, 35);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    return { state:await snapshot(), settled:true, reducedMotion:true };
  });
  const setArrayScaleFromStylePage = async requestedValue => {
    let state = await snapshot();
    if (state.page !== 'theme') {
      if (state.page !== 'music') throw new Error(`Cannot open STYLE from ${state.page} while probing ARRAY scale.`);
      await click('[data-action="theme"]');
      state = await waitFor(value => value.page === 'theme', 'open STYLE for the ARRAY scale probe');
    }
    const selection = await evaluate(`(() => {
      const select = document.querySelector('select[data-style-field="arrayScale"]');
      if (!select) return { available:false, reason:'missing ARRAY scale selector' };
      const current = String(select.value);
      const options = Array.from(select.options).map(option => String(option.value)).filter(value => Number.isFinite(Number(value)) && Number(value) > 0);
      const requested = ${JSON.stringify(requestedValue)};
      const target = requested === null
        ? options.filter(value => value !== current).sort((left, right) =>
            Math.abs(Math.log(Number(right) / Number(current))) - Math.abs(Math.log(Number(left) / Number(current))))[0] ?? null
        : options.find(value => value === String(requested)) ?? null;
      if (target === null) return { available:options.length > 0, changed:false, current, options };
      if (target !== current) {
        select.value = target;
        select.dispatchEvent(new Event('change', { bubbles:true }));
      }
      return { available:true, changed:target !== current, current, value:target, options };
    })()`);
    if (!selection?.available) throw new Error(`ARRAY scale selector is unavailable: ${selection?.reason ?? 'no numeric options'}`);
    if (selection.changed) await waitFor(value => value.page === 'theme' &&
      Math.abs(Number(value.styleArrayScale) - Number(selection.value)) < 1e-8,
    `apply ARRAY scale ${selection.value}`, 10000, 35);
    await click('[data-action="library"]');
    const archive = await waitFor(value => value.page === 'music' && value.mode === 'archive' &&
      value.presentation?.phase === 'archive', 'return to archive after the ARRAY scale probe');
    return { ...selection, archive };
  };
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
  const ownerMap = state => {
    const instances = state?.stats?.motionGeometry?.instances ?? state?.instanceOwners ?? [];
    return new Map(instances.filter(instance =>
      Array.isArray(instance?.matrix) && instance.matrix.length === 16 && instance.matrix.every(Number.isFinite) &&
      Number.isFinite(Number(instance?.cell?.lane)) && Number.isFinite(Number(instance?.cell?.row)) &&
      (instance?.entry || instance?.cell?.foobarEntryKey)).map(instance => {
      const entry = String(instance.entry ?? instance.cell.foobarEntryKey);
      const cell = `${Number(instance.cell.lane)}:${Number(instance.cell.row)}`;
      const route = instance.route ? { resident:instance.route.resident ?? null, core:instance.route.core ?? null,
        hasArray:instance.route.hasArray ?? null, hasMatrix:instance.route.hasMatrix ?? null,
        arrayCell:arrayCellKey(instance.route.arrayCell), rise:routeRiseIdentity(instance.route) } : null;
      return [instance.id || `${entry}|${cell}`, { id:instance.id ?? null, entry, cell, route, matrix:instance.matrix }];
    }));
  };
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
  const startDenseGeometryCapture = async () => evaluate(`(() => {
    const previous = window.__rhineArchiveGeometry;
    if (previous) { previous.running = false; cancelAnimationFrame(previous.raf); }
    const trace = { running:true, started:false, lastQ:null, frames:[], overflow:false, raf:0 };
    window.__rhineArchiveGeometry = trace;
    const capture = ${geometryStateScript.replace(/\(\)\s*$/, '')};
    const tick = () => {
      if (!trace.running) return;
      const flight = window.rhineMusic?.stats?.()?.layoutTransition;
      if (flight?.active) {
        trace.started = true;
        const q = Number(flight.q);
        if (flight.prepared && !flight.interactionSettling && Number.isFinite(q) &&
          (trace.lastQ === null || Math.abs(q - trace.lastQ) >= .035)) {
          if (trace.frames.length >= 96) trace.overflow = true;
          else { trace.frames.push(capture()); trace.lastQ = q; }
        }
      } else if (trace.started) { trace.running = false; return; }
      trace.raf = requestAnimationFrame(tick);
    };
    trace.raf = requestAnimationFrame(tick);
    return true;
  })()`);
  const finishDenseGeometryCapture = async () => evaluate(`(() => {
    const trace = window.__rhineArchiveGeometry;
    if (!trace) return { frames:[], overflow:false };
    trace.running = false; cancelAnimationFrame(trace.raf);
    delete window.__rhineArchiveGeometry;
    return { frames:trace.frames, overflow:trace.overflow };
  })()`);
  const captureFlightSample = async (context, requestedQ, endpoint = false, recordedState = null) => {
    const state = recordedState ?? await geometrySnapshot(), transition = state.stats?.layoutTransition ?? {}, geometry = state.stats?.motionGeometry ?? {};
    if (transition.active === false && (Math.abs(Number(transition.q)) < 1e-8 || Math.abs(Number(transition.q) - 1) < 1e-8)) endpoint = true;
    const instances = Array.isArray(geometry.instances) ? geometry.instances : [];
    const selectedMatrix = geometry.selectedMatrix;
    const selectedBounds = transformedBounds(geometry.bounds, selectedMatrix);
    const selectedScale = matrixScale(selectedMatrix);
    const projectedHeroBounds = selectedBounds ? projectWorldBounds(selectedBounds.points, state) : null;
    const routeInstances = instances.filter(instance => instance?.route && (instance?.entry || instance?.cell?.foobarEntryKey));
    const routeFrame = routeInstances.map(instance => {
      const scale = matrixScale(instance.matrix), world = transformedBounds(geometry.bounds, instance.matrix);
      const box = world ? projectWorldBounds(world.points, state) : null;
      const alpha = Number(instance.alpha);
      const unitScale = !!scale?.every(value => Number.isFinite(value) && Math.abs(value - 1) <= .06);
      const positiveDepth = Number.isFinite(Number(box?.depthMin)) && Number(box.depthMin) > Math.max(0, Number(state.stats?.cameraNear) || 0);
      const fullyOffscreen = !!box?.valid && positiveDepth && box.intersectsFrustum === false;
      return { id:instance.id ?? null, entry:instance.entry ?? instance.cell?.foobarEntryKey ?? null, cell:instance.cell,
        route:instance.route, arrayCellKey:arrayCellKey(instance.route.arrayCell),
        alpha:Number.isFinite(alpha) ? alpha : null, scale, unitScale, positiveDepth, fullyOffscreen,
        badgeKind:Number.isFinite(Number(instance.badgeKind)) ? Number(instance.badgeKind) : 0,
        extraClip:instance.extraClip === true,
        intersectsFrustum:box?.intersectsFrustum === true,
        worldBounds:world ? { min:world.min, max:world.max } : null,
        ndcBounds:box ? { minX:box.minX, maxX:box.maxX, minY:box.minY, maxY:box.maxY,
          depthMin:box.depthMin, depthMax:box.depthMax } : null };
    });
    const residentInstances = routeFrame.filter(item => item.route.resident === true);
    const oneEndRoutes = routeFrame.filter(item => item.route.hasArray !== item.route.hasMatrix);
    const matrixOnly = oneEndRoutes.filter(item => item.route.hasArray === false && item.route.hasMatrix === true);
    const arrayOnly = oneEndRoutes.filter(item => item.route.hasArray === true && item.route.hasMatrix === false);
    const routeContractFailures = routeFrame.filter(item =>
      typeof item.route.resident !== 'boolean' || typeof item.route.hasArray !== 'boolean' ||
      typeof item.route.hasMatrix !== 'boolean' || item.route.hasArray !== item.route.resident ||
      item.route.core !== item.route.resident || !item.arrayCellKey || !riseScheduleOkay(item.route.rise))
      .map(({ id, entry, cell, route, arrayCellKey:key }) => ({ id, entry, cell, route, arrayCellKey:key }));
    const riseFormulaFailures = routeFrame.filter(item => {
      const rise = item.route?.rise, q = Number(transition.q);
      if (!riseScheduleOkay(rise) || !Number.isFinite(q)) return true;
      const expectedAmount = quinticStep(q, Number(rise.start), Number(rise.end));
      const expectedLift = item.route.resident === true ? .22 * Math.sin(Math.PI * expectedAmount) ** 2 : 0;
      return Math.abs(Number(rise.amount) - expectedAmount) > .01 ||
        Math.abs(Number(rise.lift) - expectedLift) > .004;
    }).map(({ id, entry, cell, route, arrayCellKey:key }) => {
      const rise = route?.rise, q = Number(transition.q);
      const expectedAmount = riseScheduleOkay(rise) && Number.isFinite(q)
        ? quinticStep(q, Number(rise.start), Number(rise.end)) : null;
      const expectedLift = expectedAmount === null ? null
        : route.resident === true ? .22 * Math.sin(Math.PI * expectedAmount) ** 2 : 0;
      return { id, entry, cell, route, arrayCellKey:key, q, expectedAmount, expectedLift };
    });
    const residentColumnRanges = new Map();
    for (const item of routeFrame.filter(item => item.route.resident === true && item.arrayCellKey)) {
      const lane = Number(item.route.arrayCell.lane), row = Number(item.route.arrayCell.row);
      if (!Number.isFinite(lane) || !Number.isFinite(row)) continue;
      const range = residentColumnRanges.get(lane) ?? { min:row, max:row };
      range.min = Math.min(range.min, row); range.max = Math.max(range.max, row);
      residentColumnRanges.set(lane, range);
    }
    const riseOriginLane = Number(transition.riseOrigin?.lane), riseOriginRow = Number(transition.riseOrigin?.row);
    if (Number.isFinite(riseOriginLane) && Number.isFinite(riseOriginRow)) {
      const range = residentColumnRanges.get(riseOriginLane) ?? { min:riseOriginRow, max:riseOriginRow };
      range.min = Math.min(range.min, riseOriginRow); range.max = Math.max(range.max, riseOriginRow);
      residentColumnRanges.set(riseOriginLane, range);
    }
    const selectedArrayRow = Number(transition.riseOrigin?.row);
    const riseDistanceFailures = routeFrame.filter(item => {
      const rise = item.route?.rise, cell = item.route?.arrayCell;
      const lane = Number(cell?.lane), row = Number(cell?.row);
      if (!riseScheduleOkay(rise) || !Number.isFinite(lane) || !Number.isFinite(row) ||
          !Number.isFinite(selectedArrayRow)) return true;
      const expectedAlong = .36 * Math.abs(row - selectedArrayRow);
      let expectedEdge = 0;
      if (item.route.resident !== true) {
        const distances = [...residentColumnRanges.entries()].map(([columnLane, range]) => {
          const rowDistance = row < range.min ? range.min - row : row > range.max ? row - range.max : 0;
          return Math.hypot(4 * (lane - columnLane), rowDistance);
        });
        if (!distances.length) return true;
        expectedEdge = Math.min(...distances);
      }
      return Math.abs(Number(rise.edgeDistance) - expectedEdge) > .002 ||
        Math.abs(Number(rise.alongDistance) - expectedAlong) > .002;
    }).map(({ id, entry, cell, route, arrayCellKey:key }) => {
      const rise = route?.rise, arrayCell = route?.arrayCell;
      const lane = Number(arrayCell?.lane), row = Number(arrayCell?.row);
      const expectedAlong = Number.isFinite(row) && Number.isFinite(selectedArrayRow)
        ? .36 * Math.abs(row - selectedArrayRow) : null;
      let expectedEdge = null;
      if (route?.resident === true && Number.isFinite(lane)) expectedEdge = 0;
      else if (Number.isFinite(lane) && Number.isFinite(row) && residentColumnRanges.size) {
        expectedEdge = Math.min(...[...residentColumnRanges.entries()].map(([columnLane, range]) => {
          const rowDistance = row < range.min ? range.min - row : row > range.max ? row - range.max : 0;
          return Math.hypot(4 * (lane - columnLane), rowDistance);
        }));
      }
      return { id, entry, cell, route, arrayCellKey:key, selectedArrayRow,
        expectedEdgeDistance:expectedEdge, expectedAlongDistance:expectedAlong };
    });
    const focusRise = transition.focusRise ?? null;
    const focusQ = Number(transition.q);
    const expectedFocusAmount = riseScheduleOkay(focusRise) && Number.isFinite(focusQ)
      ? quinticStep(focusQ, Number(focusRise.start), Number(focusRise.end)) : null;
    const expectedFocusLift = expectedFocusAmount === null ? null
      : .22 * Math.sin(Math.PI * expectedFocusAmount) ** 2;
    const focusOwner = routeFrame.find(item => item.route.resident === true &&
      Number(item.route.arrayCell?.lane) === Number(transition.riseOrigin?.lane) &&
      Number(item.route.arrayCell?.row) === Number(transition.riseOrigin?.row));
    const focusRiseFailures = !riseScheduleOkay(focusRise) || Math.abs(Number(focusRise.start) - .18) > .002 ||
      Math.abs(Number(focusRise.end) - .62) > .002 || Math.abs(Number(focusRise.edgeDistance)) > .002 ||
      Math.abs(Number(focusRise.alongDistance)) > .002 ||
      Math.abs(Number(focusRise.amount) - Number(expectedFocusAmount)) > .01 ||
      Math.abs(Number(focusRise.lift) - Number(expectedFocusLift)) > .004 ||
      (focusOwner && (Math.abs(Number(focusOwner.route.rise.amount) - Number(focusRise.amount)) > .01 ||
        Math.abs(Number(focusOwner.route.rise.lift) - Number(focusRise.lift)) > .004))
      ? [{ q:focusQ, focusRise, expectedAmount:expectedFocusAmount, expectedLift:expectedFocusLift,
          focusOwner:focusOwner ? { id:focusOwner.id, arrayCell:focusOwner.route.arrayCell, rise:focusOwner.route.rise } : null }]
      : [];
    const oneEndScaleDepthFailures = oneEndRoutes.filter(item => !item.unitScale || !item.positiveDepth)
      .map(({ id, entry, cell, route, scale, positiveDepth, ndcBounds }) =>
        ({ id, entry, cell, route, scale, positiveDepth, ndcBounds }));
    const matrixOnlyVisualFailures = matrixOnly.filter(item => !item.unitScale || item.alpha == null ||
      Math.abs(item.alpha - 1) > 1e-4 || !item.positiveDepth)
      .map(({ id, entry, cell, route, alpha, scale, positiveDepth, ndcBounds }) =>
        ({ id, entry, cell, route, alpha, scale, positiveDepth, ndcBounds }));
    const residentRouteInstances = instances.filter(instance => instance.route?.resident === true);
    const residentScaleFailures = residentRouteInstances.filter(instance => !matrixScale(instance.matrix)?.every(value =>
      Number.isFinite(value) && Math.abs(value - 1) <= .06)).map(instance => ({ id:instance.id ?? null,
        entry:instance.entry ?? instance.cell?.foobarEntryKey ?? null, cell:instance.cell ?? null,
        scale:matrixScale(instance.matrix) }));
    const visibleEntries = [...visibleEntryOwners(state).values()].map(owner => ({
      key:owner.key, cellKey:owner.cellKey, entry:owner.entry, id:owner.id, route:owner.route,
      projectedBounds:owner.projectedBounds }));
    const rackFlight = transition.rackFlight ?? null;
    const sample = {
      context, requestedQ, endpoint, rendererFrameCapture:recordedState !== null, transitionActive:transition.active === true,
      q:Number(transition.q), progress:Number(transition.progress), desiredEnd:Number(transition.desiredEnd),
      phase:transition.phase ?? null, entryPhase:transition.phase ?? null,
      groundY:finiteValue(transition.groundY) ? Number(transition.groundY) : null,
      extraRise:finiteValue(transition.extraRise) ? Number(transition.extraRise) : null,
      riseOrigin:transition.riseOrigin ?? null,
      focusRise,
      hiRes:state.stats?.hiRes ?? null, floorY:finiteValue(state.stats?.floorY) ? Number(state.stats.floorY) : null,
      archiveBadge:state.stats?.archiveBadge ?? null,
      path:transition.path ?? null, heading:Number(transition.heading),
      rowSpacing:Number(transition.rowSpacing), frameTime:state.stats?.frameTime ?? null,
      selectedAlbumId:state.selectedAlbumId, selectedEntryKey:state.selectedEntryKey,
      selectedCell:state.stats?.selectedCell ?? null, cameraPosition:xyz(state.stats?.cameraPosition),
      cameraAim:xyz(state.stats?.cameraAim), cameraDistance:Number(state.stats?.cameraDistance),
      fieldOfView:Number(state.stats?.fieldOfView), cameraNear:Number(state.stats?.cameraNear), cameraFar:Number(state.stats?.cameraFar),
      caseBounds:geometry.bounds ?? null, heroMatrix:selectedMatrix ?? null, cameraToHeroDistance:selectedBounds && state.stats?.cameraPosition
        ? Math.hypot(...selectedBounds.center.map((value, index) => value - Number(state.stats.cameraPosition[index]))) : null,
      heroWorldCenter:selectedBounds?.center ?? null, heroWorldBounds:selectedBounds ? { min:selectedBounds.min, max:selectedBounds.max } : null,
      heroProjectedBounds:projectedHeroBounds, selectedScale, rackDeployment:Number(state.stats?.rackDeployment),
      rackResources:state.stats?.shelfResources ?? null, rackParts:state.stats?.rackParts ?? [], rackFlight,
      motionViewport:state.stats?.motionViewport ?? null, instanceCount:instances.length,
      instanceOwners:instances.map(instance => ({ id:instance.id ?? null, entry:instance.entry ?? instance.cell?.foobarEntryKey ?? null,
         cell:instance.cell ? { lane:instance.cell.lane, row:instance.cell.row } : null,
         route:instance.route ?? null, alpha:Number.isFinite(Number(instance.alpha)) ? Number(instance.alpha) : null,
         badgeKind:Number.isFinite(Number(instance.badgeKind)) ? Number(instance.badgeKind) : 0,
         extraClip:instance.extraClip === true, matrix:instance.matrix })),
      routeVisibility:routeFrame.map(({ id, entry, cell, route, arrayCellKey, alpha, scale, unitScale,
        positiveDepth, fullyOffscreen, intersectsFrustum, worldBounds, badgeKind, extraClip }) => ({ id, entry, cell, route, arrayCellKey,
        alpha, scale, unitScale, positiveDepth, fullyOffscreen, intersectsFrustum, worldBounds, badgeKind, extraClip })),
      residentRouteCount:residentInstances.length, residentScaleFailures, routeContractFailures,
      riseFormulaFailures, riseDistanceFailures, focusRiseFailures,
      residentIds:residentInstances.map(item => ({ id:item.id, entry:item.entry, arrayCellKey:item.arrayCellKey,
        alpha:item.alpha, unitScale:item.unitScale, positiveDepth:item.positiveDepth,
        intersectsFrustum:item.intersectsFrustum })),
      oneEndRouteCount:oneEndRoutes.length, oneEndScaleDepthFailures,
      matrixOnlyCount:matrixOnly.length, matrixOnlyVisibleCount:matrixOnly.filter(item => item.intersectsFrustum).length,
      matrixOnlyVisualFailures,
      arrayOnlyCount:arrayOnly.length, arrayOnlyVisibleCount:arrayOnly.filter(item => item.intersectsFrustum).length,
      arrayOnlyOffscreenCount:arrayOnly.filter(item => item.fullyOffscreen).length,
      visibleEntries,
      sampleError:state.sampleError ?? null,
    };
    result.flightSamples.push(sample);
    result.geometryFrames.push({ context, q:sample.q, requestedQ, endpoint, frameTime:sample.frameTime,
      entryPhase:sample.entryPhase, groundY:sample.groundY, floorY:sample.floorY, extraRise:sample.extraRise,
      riseOrigin:sample.riseOrigin, focusRise:sample.focusRise,
      floorY:sample.floorY, archiveBadge:sample.archiveBadge, hiRes:sample.hiRes,
      hiRes:sample.hiRes,
      selectedAlbumId:sample.selectedAlbumId, selectedEntryKey:sample.selectedEntryKey,
      heroWorldBounds:sample.heroWorldBounds, instanceCount:sample.instanceCount, rackFlight,
      extraSurfaceBounds:routeFrame.filter(item => item.route.hasArray === false && item.route.hasMatrix === true)
        .map(item => ({ id:item.id, entry:item.entry, arrayCellKey:item.arrayCellKey,
          surfaceBottom:item.worldBounds?.min?.[1] ?? null, surfaceTop:item.worldBounds?.max?.[1] ?? null,
          badgeKind:item.badgeKind, extraClip:item.extraClip,
          worldBounds:item.worldBounds })) });
    return sample;
  };
  const hydrateEndpointRouteMetadata = (endpoint, active, context) => {
    if (!endpoint || !active) return { context, mapped:0, unmatched:[], duplicateIds:[], reason:'missing endpoint or active route sample' };
    const offsetKey = owner => {
      const cell = owner?.cell, selected = owner?.selectedCell;
      if (!owner?.entry || !Number.isFinite(Number(cell?.lane)) || !Number.isFinite(Number(cell?.row)) ||
          !Number.isFinite(Number(selected?.lane)) || !Number.isFinite(Number(selected?.row))) return null;
      return `${owner.entry}|${Number(cell.lane) - Number(selected.lane)}:${Number(cell.row) - Number(selected.row)}`;
    };
    const activeByOffset = new Map();
    for (const owner of active.instanceOwners ?? []) {
      if (!owner?.route || !owner.id || !arrayCellKey(owner.route.arrayCell)) continue;
      const key = offsetKey({ ...owner, selectedCell:active.selectedCell });
      if (!key) continue;
      const candidates = activeByOffset.get(key) ?? [];
      candidates.push(owner);
      activeByOffset.set(key, candidates);
    }
    const matchedIds = new Set(), unmatched = [], duplicateIds = [], endpointRouteRiseRepairs = [], endpointRiseFormulaFailures = [];
    for (const owner of endpoint.instanceOwners ?? []) {
      const key = offsetKey({ ...owner, selectedCell:endpoint.selectedCell });
      const candidates = key ? activeByOffset.get(key) ?? [] : [];
      const candidate = candidates.length === 1 ? candidates[0] : null;
      if (!candidate) {
        unmatched.push({ entry:owner.entry ?? null, cell:owner.cell ?? null, key, candidateCount:candidates.length });
        continue;
      }
      if (matchedIds.has(candidate.id)) duplicateIds.push({ id:candidate.id, entry:owner.entry, cell:owner.cell, key });
      matchedIds.add(candidate.id);
      owner.id = candidate.id;
      const endpointQ = Number(endpoint.q);
      const endpointRoute = owner.route;
      const sourceRise = endpointRoute?.rise ?? candidate.route?.rise;
      if (endpointRoute?.rise) {
        if (riseScheduleOkay(endpointRoute.rise) && Number.isFinite(endpointQ)) {
          const expectedAmount = quinticStep(endpointQ, Number(endpointRoute.rise.start), Number(endpointRoute.rise.end));
          const expectedLift = endpointRoute.resident === true ? .22 * Math.sin(Math.PI * expectedAmount) ** 2 : 0;
          if (Math.abs(Number(endpointRoute.rise.amount) - expectedAmount) > .01 ||
              Math.abs(Number(endpointRoute.rise.lift) - expectedLift) > .004)
            endpointRiseFormulaFailures.push({ id:owner.id, entry:owner.entry, cell:owner.cell, q:endpointQ,
              route:endpointRoute, expectedAmount, expectedLift });
        } else endpointRiseFormulaFailures.push({ id:owner.id, entry:owner.entry, cell:owner.cell,
          q:endpointQ, route:endpointRoute, reason:'endpoint route rise metadata is incomplete' });
        owner.route = endpointRoute;
      } else if (riseScheduleOkay(sourceRise) && Number.isFinite(endpointQ)) {
        const amount = quinticStep(endpointQ, Number(sourceRise.start), Number(sourceRise.end));
        const lift = (endpointRoute?.resident ?? candidate.route?.resident) === true
          ? .22 * Math.sin(Math.PI * amount) ** 2 : 0;
        owner.route = { ...candidate.route, ...(endpointRoute ?? {}),
          rise:{ ...sourceRise, amount, lift } };
        endpointRouteRiseRepairs.push({ id:owner.id, entry:owner.entry, cell:owner.cell,
          source:'nearest active fixed schedule', q:endpointQ, amount, lift });
      } else {
        owner.route = endpointRoute ?? candidate.route;
        endpointRiseFormulaFailures.push({ id:owner.id, entry:owner.entry, cell:owner.cell,
          q:endpointQ, route:owner.route, reason:'no usable endpoint or active rise schedule' });
      }
    }
    const state = { stats:{ motionViewport:endpoint.motionViewport, cameraPosition:endpoint.cameraPosition,
      cameraAim:endpoint.cameraAim, cameraDistance:endpoint.cameraDistance, fieldOfView:endpoint.fieldOfView,
      cameraNear:endpoint.cameraNear, cameraFar:endpoint.cameraFar } };
    const routed = (endpoint.instanceOwners ?? []).filter(owner => owner?.route && owner?.entry);
    const routeVisibility = routed.map(owner => {
      const scale = matrixScale(owner.matrix), world = transformedBounds(endpoint.caseBounds, owner.matrix);
      const box = world ? projectWorldBounds(world.points, state) : null;
      const alpha = Number(owner.alpha);
      const unitScale = !!scale?.every(value => Number.isFinite(value) && Math.abs(value - 1) <= .06);
      const positiveDepth = Number.isFinite(Number(box?.depthMin)) && Number(box.depthMin) >
        Math.max(0, Number(endpoint.cameraNear) || 0);
      const fullyOffscreen = !!box?.valid && positiveDepth && box.intersectsFrustum === false;
      return { id:owner.id, entry:owner.entry, cell:owner.cell, route:owner.route,
        arrayCellKey:arrayCellKey(owner.route.arrayCell), alpha:Number.isFinite(alpha) ? alpha : null,
        badgeKind:Number.isFinite(Number(owner.badgeKind)) ? Number(owner.badgeKind) : 0,
        extraClip:owner.extraClip === true,
        scale, unitScale, positiveDepth, fullyOffscreen, intersectsFrustum:box?.intersectsFrustum === true,
        ndcBounds:box ? { minX:box.minX, maxX:box.maxX, minY:box.minY, maxY:box.maxY,
          depthMin:box.depthMin, depthMax:box.depthMax } : null };
    });
    const resident = routeVisibility.filter(item => item.route.resident === true);
    const oneEnd = routeVisibility.filter(item => item.route.hasArray !== item.route.hasMatrix);
    const matrixOnly = oneEnd.filter(item => item.route.hasArray === false && item.route.hasMatrix === true);
    endpoint.routeVisibility = routeVisibility;
    endpoint.routeRiseRepairs = endpointRouteRiseRepairs;
    endpoint.riseFormulaFailures = [...(endpoint.riseFormulaFailures ?? []), ...endpointRiseFormulaFailures];
    endpoint.residentRouteCount = resident.length;
    endpoint.residentIds = resident.map(item => ({ id:item.id, entry:item.entry, arrayCellKey:item.arrayCellKey,
      alpha:item.alpha, unitScale:item.unitScale, positiveDepth:item.positiveDepth,
      intersectsFrustum:item.intersectsFrustum }));
    endpoint.residentScaleFailures = resident.filter(item => !item.unitScale).map(item => ({ id:item.id, entry:item.entry, scale:item.scale }));
    endpoint.routeContractFailures = routeVisibility.filter(item =>
      typeof item.route.resident !== 'boolean' || typeof item.route.hasArray !== 'boolean' ||
      typeof item.route.hasMatrix !== 'boolean' || item.route.hasArray !== item.route.resident ||
      item.route.core !== item.route.resident || !item.arrayCellKey || !riseScheduleOkay(item.route.rise))
      .map(({ id, entry, cell, route, arrayCellKey:key }) => ({ id, entry, cell, route, arrayCellKey:key }));
    endpoint.oneEndRouteCount = oneEnd.length;
    endpoint.oneEndScaleDepthFailures = oneEnd.filter(item => !item.unitScale || !item.positiveDepth)
      .map(({ id, entry, cell, route, scale, positiveDepth, ndcBounds }) => ({ id, entry, cell, route, scale, positiveDepth, ndcBounds }));
    endpoint.matrixOnlyCount = matrixOnly.length;
    endpoint.matrixOnlyVisibleCount = matrixOnly.filter(item => item.intersectsFrustum).length;
    endpoint.matrixOnlyVisualFailures = matrixOnly.filter(item => !item.unitScale || item.alpha == null ||
      Math.abs(item.alpha - 1) > 1e-4 || !item.positiveDepth)
      .map(({ id, entry, cell, route, alpha, scale, positiveDepth, ndcBounds }) =>
        ({ id, entry, cell, route, alpha, scale, positiveDepth, ndcBounds }));
    endpoint.visibleEntries = [...visibleEntryOwners(endpoint).values()].map(owner => ({
      key:owner.key, cellKey:owner.cellKey, entry:owner.entry, id:owner.id, route:owner.route,
      projectedBounds:owner.projectedBounds }));
    return { context, endpointQ:endpoint.q, activeQ:active.q, mapped:matchedIds.size,
      endpointInstanceCount:(endpoint.instanceOwners ?? []).length, routed:routeVisibility.length,
      unmatched, duplicateIds, endpointRouteRiseRepairs, endpointRiseFormulaFailures,
      activeSelectedCell:active.selectedCell, endpointSelectedCell:endpoint.selectedCell };
  };
  const auditMatrixPhysicalSlots = endpoint => {
    const gpuOwners = new Map(), duplicateCells = [], missingCellOwners = [], entryMismatches = [];
    for (const owner of endpoint?.instanceOwners ?? []) {
      const cellKey = arrayCellKey(owner.cell), entry = String(owner.entry ?? owner.cell?.foobarEntryKey ?? '');
      if (!cellKey || !entry) { missingCellOwners.push({ id:owner.id ?? null, cell:owner.cell ?? null, entry:entry || null }); continue; }
      const previous = gpuOwners.get(cellKey);
      if (previous) duplicateCells.push({ cellKey, first:previous.entry, duplicate:entry });
      else gpuOwners.set(cellKey, { id:owner.id ?? null, entry, cell:owner.cell });
    }
    const heroCell = endpoint?.selectedCell ?? null, heroCellKey = arrayCellKey(heroCell);
    const heroEntry = String(heroCell?.foobarEntryKey ?? endpoint?.selectedEntryKey ?? '');
    const heroScale = matrixScale(endpoint?.heroMatrix);
    const heroIsUnitScale = !!heroScale?.every(value => Number.isFinite(value) && Math.abs(value - 1) <= .06);
    const allObservedCells = [...gpuOwners.keys(), ...(heroCellKey ? [heroCellKey] : [])];
    const physicalLanes = [...new Set(allObservedCells.map(key => Number(key.split(':')[0])))].sort((a, b) => a - b);
    const physicalRows = [...new Set(allObservedCells.map(key => Number(key.split(':')[1])))].sort((a, b) => a - b);
    const laneResidues = [...new Set(physicalLanes.map(lane => wrapIndex(lane, ARCHIVE_MOTION_MATRIX_LANE_COUNT)))].sort((a, b) => a - b);
    const rowSpan = physicalRows.length ? physicalRows.at(-1) - physicalRows[0] + 1 : 0;
    const expectedCells = new Map();
    for (const lane of physicalLanes) for (const row of physicalRows) {
      const key = `${lane}:${row}`;
      expectedCells.set(key, expectedArchiveMotionMatrixEntry(fixtureMatrixShelves, lane, row));
      const actualOwner = gpuOwners.get(key);
      if (actualOwner && actualOwner.entry !== expectedCells.get(key))
        entryMismatches.push({ cellKey:key, expectedEntry:expectedCells.get(key), actualEntry:actualOwner.entry });
    }
    const expectedHeroEntry = heroCellKey ? expectedCells.get(heroCellKey) : null;
    const heroIsMapped = !!heroCellKey && expectedCells.has(heroCellKey) && !!expectedHeroEntry && heroEntry === expectedHeroEntry;
    const unexpectedCells = [...gpuOwners.keys()].filter(key => !expectedCells.has(key));
    const missingGpuCells = [...expectedCells.keys()].filter(key => !gpuOwners.has(key));
    const selectedGpuCellHidden = missingGpuCells.length === 1 && missingGpuCells[0] === heroCellKey;
    const shelfCounts = fixtureMatrixShelves.map(shelf => shelf.length);
    const lastShelf = fixtureMatrixShelves.at(-1) ?? [];
    const lastShelfCycle = Array.from({ length:ARCHIVE_MOTION_SHELF_SLOTS }, (_, slot) => ({
      slot, entry:lastShelf.length ? lastShelf[wrapIndex(slot, lastShelf.length)] : null,
    }));
    const lastShelfHasNoHoles = lastShelf.length === 5 && lastShelfCycle.length === ARCHIVE_MOTION_SHELF_SLOTS &&
      lastShelfCycle.every((item, slot) => item.entry === lastShelf[slot % lastShelf.length]);
    const expectedPhysicalCount = ARCHIVE_MOTION_MATRIX_LANE_COUNT * ARCHIVE_MOTION_MATRIX_ROWS;
    const gpuOwnerCount = gpuOwners.size;
    const totalOwnedPhysicalSlots = gpuOwnerCount + Number(heroIsMapped && heroIsUnitScale);
    const ok = fixtureMatrixShelves.length === 3 && shelfCounts.join(',') === '20,20,5' && lastShelfHasNoHoles &&
      physicalLanes.length === ARCHIVE_MOTION_MATRIX_LANE_COUNT && laneResidues.length === ARCHIVE_MOTION_MATRIX_LANE_COUNT &&
      physicalRows.length === ARCHIVE_MOTION_MATRIX_ROWS && rowSpan === ARCHIVE_MOTION_MATRIX_ROWS &&
      expectedCells.size === expectedPhysicalCount && gpuOwnerCount === expectedPhysicalCount - 1 &&
      duplicateCells.length === 0 && unexpectedCells.length === 0 && missingCellOwners.length === 0 &&
      entryMismatches.length === 0 && selectedGpuCellHidden && heroIsMapped && heroIsUnitScale &&
      totalOwnedPhysicalSlots === expectedPhysicalCount;
    return { ok, physicalShape:{ lanes:physicalLanes.length, rows:physicalRows.length, laneResidues, rowMin:physicalRows[0] ?? null,
        rowMax:physicalRows.at(-1) ?? null },
      expectedPhysicalCount, fixtureShelfCounts:shelfCounts, lastShelfHasNoHoles, lastShelfCycle,
      gpuOwnerCount, totalOwnedPhysicalSlots,
      selectedGpuCellHidden, hero:{ cell:heroCell, cellKey:heroCellKey, entry:heroEntry, expectedEntry:expectedHeroEntry,
        scale:heroScale, mapped:heroIsMapped, unitScale:heroIsUnitScale },
      missingGpuCells, duplicateCells:duplicateCells.slice(0, 12), unexpectedCells:unexpectedCells.slice(0, 12),
      missingCellOwners:missingCellOwners.slice(0, 12), entryMismatches:entryMismatches.slice(0, 12) };
  };
  const auditFlight = (context, target, requestedQValues, identity) => {
    const samples = result.transitionSamples.filter(sample => sample.context === context && sample.active === true &&
      Number.isFinite(sample.progress));
    const activeTarget = target === 'array' ? 1 : 0;
    const captured = result.flightSamples.filter(sample => sample.context === context);
    const firstEndpoint = captured.find(sample => sample.endpoint && Math.abs(sample.q - (1 - activeTarget)) < .001);
    const lastEndpoint = captured.findLast(sample => sample.endpoint && Math.abs(sample.q - activeTarget) < .001);
    const actual = captured.filter(sample => !sample.endpoint || sample === firstEndpoint || sample === lastEndpoint);
    const requested = actual.filter(sample => !sample.endpoint);
    const canonicalDirection = target === 'array' ? 1 : -1;
    const progressInBounds = samples.length > 0 && samples.every(sample => sample.progress >= 0 && sample.progress <= 1);
    const progressMonotonic = samples.every((sample, index) => index === 0 || sample.progress + .015 >= samples[index - 1].progress);
    const qMonotonic = samples.every((sample, index) => index === 0 ||
      (canonicalDirection > 0 ? sample.q + .015 >= samples[index - 1].q : sample.q - .015 <= samples[index - 1].q));
    const alignSamples = samples.filter(sample => sample.phase === 'align');
    const alignQValues = alignSamples.map(sample => Number(sample.q));
    const alignQFrozen = alignSamples.length === 0 || (alignQValues.length >= 2 && alignQValues.every(Number.isFinite) &&
      Math.max(...alignQValues) - Math.min(...alignQValues) <= 1e-8);
    const lastAlignMs = alignSamples.length ? Math.max(...alignSamples.map(sample => Number(sample.sinceClickMs))) : 0;
    const postAlignSamples = samples.filter(sample => Number(sample.sinceClickMs) > lastAlignMs);
    const postAlignQMonotonic = postAlignSamples.every((sample, index) => index === 0 ||
      (canonicalDirection > 0 ? sample.q + .015 >= postAlignSamples[index - 1].q
        : sample.q - .015 <= postAlignSamples[index - 1].q));
    const pathIsCameraOrbit = samples.length > 0 && samples.every(sample => sample.path === 'camera-orbit') &&
      requested.every(sample => sample.path === 'camera-orbit');
    const allIdentityStable = actual.length >= requestedQValues.length && actual.every(sample =>
      sample.selectedAlbumId === identity.selectedAlbumId && sample.selectedEntryKey === identity.selectedEntryKey &&
      (sample.selectedCell?.foobarEntryKey == null || sample.selectedCell.foobarEntryKey === identity.selectedEntryKey));
    const qCoverage = requestedQValues.map(q => {
      const nearest = requested.reduce((best, sample) => !best || Math.abs(sample.q - q) < Math.abs(best.q - q) ? sample : best, null);
      const error = nearest ? Math.abs(nearest.q - q) : Infinity;
      return { requested:q, observed:nearest?.q ?? null, nearestActualQ:nearest?.q ?? null,
        absoluteError:Number.isFinite(error) ? error : null, tolerance:.10 };
    });
    // Real-time capture may cross a narrow requested instant. Exact q geometry
    // is tested separately; native acceptance requires dense actual coverage
    // plus explicit rearrangement/midpoint frames, never relabeled samples.
    const qCoverageOkay = qCoverage.every(sample => Number.isFinite(sample.observed) && sample.absoluteError <= sample.tolerance);
    const qSampleMisses = result.qSampleMisses.filter(miss => miss.context === context);
    const sourceQ = activeTarget === 1 ? 0 : 1, targetQ = activeTarget;
    const sourceEndpoint = actual.find(sample => sample.endpoint && Math.abs(sample.q - sourceQ) <= .001);
    const targetEndpoint = actual.find(sample => sample.endpoint && Math.abs(sample.q - targetQ) <= .001);
    const nearestActiveFrame = endpoint => endpoint ? actual.filter(sample => !sample.endpoint && sample.routeVisibility?.length)
      .reduce((nearest, sample) => !nearest || Math.abs(sample.q - endpoint.q) < Math.abs(nearest.q - endpoint.q) ? sample : nearest, null) : null;
    const sourceBridge = hydrateEndpointRouteMetadata(sourceEndpoint, nearestActiveFrame(sourceEndpoint), `${context} source endpoint`);
    const targetBridge = hydrateEndpointRouteMetadata(targetEndpoint, nearestActiveFrame(targetEndpoint), `${context} target endpoint`);
    result.routeEndpointBridges.push(sourceBridge, targetBridge);
    const endpointRiseFormulaFailures = [...(sourceBridge.endpointRiseFormulaFailures ?? []),
      ...(targetBridge.endpointRiseFormulaFailures ?? [])];
    const arrayEndpoint = sourceQ === 0 ? sourceEndpoint : targetEndpoint;
    const matrixEndpoint = sourceQ === 1 ? sourceEndpoint : targetEndpoint;
    const matrixSlotOwnership = auditMatrixPhysicalSlots(matrixEndpoint);
    result.matrixSlotAudits.push({ context, q:matrixEndpoint?.q ?? null, ...matrixSlotOwnership });
    const pathFrames = [...actual].sort((left, right) => left.q - right.q);
    const visibilityFor = (frame, id) => frame.routeVisibility?.find(item => item.id === id) ?? null;
    const ownerFor = (frame, id) => frame.instanceOwners?.find(item => item.id === id) ?? null;
    const traceEndpointEntries = (endpoint, predicate, requireVisible = true) =>
      (endpoint?.routeVisibility ?? []).filter(item => predicate(item) && (!requireVisible || item.intersectsFrustum === true));
    const traceTracks = (endpointEntries, { resident = false, matrixOnly:trackMatrixOnly = false } = {}) => {
      const unique = new Map();
      for (const item of endpointEntries) {
        const id = item.id ?? `${item.entry}|${item.arrayCellKey ?? ''}`;
        if (id != null && !unique.has(id)) unique.set(id, item);
      }
      return [...unique.entries()].map(([id, endpointItem]) => {
        const arrayCell = endpointItem.route?.arrayCell ?? null;
        const expectedArrayCellKey = endpointItem.arrayCellKey;
        const frames = pathFrames.map(frame => {
          const visibility = visibilityFor(frame, id), owner = ownerFor(frame, id);
          const world = owner ? transformedBounds(frame.caseBounds, owner.matrix) : null;
          return { q:frame.q, requestedQ:frame.requestedQ, endpoint:frame.endpoint, present:!!visibility && !!owner,
            transitionActive:frame.transitionActive === true,
            visible:visibility?.intersectsFrustum === true, entryPhase:frame.entryPhase ?? frame.phase ?? null,
            groundY:frame.groundY ?? null, floorY:frame.floorY ?? null, extraRise:frame.extraRise ?? null,
            entry:visibility?.entry ?? owner?.entry ?? null, route:visibility?.route ?? null,
            rise:(visibility?.route ?? owner?.route)?.rise ?? null,
            arrayCellKey:visibility?.arrayCellKey ?? null, alpha:visibility?.alpha ?? null,
            badgeKind:visibility?.badgeKind ?? owner?.badgeKind ?? null,
            extraClip:visibility?.extraClip ?? owner?.extraClip ?? null,
            unitScale:visibility?.unitScale === true, positiveDepth:visibility?.positiveDepth === true,
            center:world?.center ?? null, worldBounds:world ? { min:world.min, max:world.max } : null,
            centerY:world?.center?.[1] ?? null,
            surfaceBottom:world?.min?.[1] ?? null, surfaceTop:world?.max?.[1] ?? null };
        });
        const contiguousVisibility = (() => {
          const visible = frames.map(frame => frame.visible), first = visible.indexOf(true), last = visible.lastIndexOf(true);
          return first < 0 || visible.slice(first, last + 1).every(Boolean);
        })();
        const allPresent = frames.length === pathFrames.length && frames.every(frame => frame.present ||
          (!resident && trackMatrixOnly && frame.endpoint === true && Math.abs(frame.q) <= .001));
        const presentFrames = frames.filter(frame => frame.present);
        const activePresentFrames = presentFrames.filter(frame => frame.transitionActive);
        const routeStable = presentFrames.length > 0 && presentFrames.every(frame => {
          const route = frame.route;
          return !!route && route.resident === resident && route.hasArray === resident &&
            (resident ? typeof route.hasMatrix === 'boolean' : route.hasMatrix === trackMatrixOnly) &&
            riseScheduleOkay(route.rise) &&
            JSON.stringify(routeRiseIdentity(route)) === JSON.stringify(routeRiseIdentity(presentFrames[0].route));
        });
        const arrayCellStable = !!expectedArrayCellKey && presentFrames.every(frame => frame.arrayCellKey === expectedArrayCellKey &&
          arrayCellKey(frame.route?.arrayCell) === expectedArrayCellKey);
        const alphaOkay = presentFrames.length > 0 && presentFrames.every(frame => Number.isFinite(Number(frame.alpha)) &&
          (resident ? Number(frame.alpha) > .001 : Math.abs(Number(frame.alpha) - 1) <= 1e-4));
        const scaleDepthOkay = presentFrames.length > 0 && presentFrames.every(frame => frame.unitScale && frame.positiveDepth);
        const geometryPathFinite = presentFrames.length > 0 && presentFrames.every(frame => Array.isArray(frame.center) && frame.center.length === 3 &&
          frame.center.every(Number.isFinite));
        const firstCenter = frames.find(frame => Math.abs(frame.q) <= .001)?.center;
        const lastCenter = frames.find(frame => Math.abs(frame.q - 1) <= .001)?.center;
        const endpointMovement = firstCenter && lastCenter
          ? Math.hypot(...firstCenter.map((value, index) => value - lastCenter[index])) : null;
        return { id, entry:endpointItem.entry, arrayCell:arrayCellKey(arrayCell), lane:Number(arrayCell?.lane),
          presentEveryFrame:allPresent, routeStable, arrayCellStable, alphaOkay, scaleDepthOkay,
          allVisible:frames.every(frame => frame.visible), contiguousVisibility, geometryPathFinite,
          endpointMovement:Number.isFinite(endpointMovement) ? endpointMovement : null,
          badgeKindValid:presentFrames.length > 0 && presentFrames.every(frame => [0,1,2,3].includes(Number(frame.badgeKind))),
          extraClipMatchesRoute:activePresentFrames.length > 0 && activePresentFrames.every(frame =>
            frame.extraClip === (frame.route?.resident === false)),
          visibleQ:frames.filter(frame => frame.visible).map(frame => frame.q),
          verticalSamples:frames.map(frame => ({ q:frame.q, requestedQ:frame.requestedQ, endpoint:frame.endpoint,
            present:frame.present, transitionActive:frame.transitionActive, entryPhase:frame.entryPhase,
            groundY:frame.groundY, floorY:frame.floorY,
            extraRise:frame.extraRise, riseAmount:frame.rise?.amount ?? null, riseLift:frame.rise?.lift ?? null,
            rise:frame.rise,
            badgeKind:frame.badgeKind, extraClip:frame.extraClip,
            centerY:frame.centerY, surfaceBottom:frame.surfaceBottom, surfaceTop:frame.surfaceTop,
            worldBounds:frame.worldBounds })),
          missingQ:frames.filter(frame => !frame.present).map(frame => frame.q),
          hiddenQ:frames.filter(frame => frame.present && !frame.visible).map(frame => frame.q),
          alphaFailures:frames.filter(frame => !Number.isFinite(Number(frame.alpha)) ||
            (resident ? Number(frame.alpha) <= .001 : Math.abs(Number(frame.alpha) - 1) > 1e-4)).map(frame => frame.q),
          geometryFailures:frames.filter(frame => !frame.unitScale || !frame.positiveDepth || !frame.center).map(frame => frame.q) };
      });
    };
    const arrayResidentEntries = traceEndpointEntries(arrayEndpoint,
      item => item.route?.resident === true && item.route?.hasArray === true && item.entry !== identity.selectedEntryKey);
    const residentTracks = traceTracks(arrayResidentEntries, { resident:true });
    const residentLiftTracks = residentTracks.map(track => {
      const frames = track.verticalSamples.filter(frame => frame.present && finiteValue(frame.q) &&
        finiteValue(frame.centerY) && finiteValue(frame.riseLift));
      const firstRest = frames.filter(frame => frame.transitionActive && frame.entryPhase !== 'align')
        .reduce((nearest, frame) => !nearest || Math.abs(Number(frame.q) - sourceQ) < Math.abs(Number(nearest.q) - sourceQ)
          ? frame : nearest, null);
      const targetRest = frames.find(frame => frame.endpoint && Math.abs(Number(frame.q) - targetQ) <= .001);
      const preAlignSource = frames.find(frame => frame.endpoint && Math.abs(Number(frame.q) - sourceQ) <= .001);
      const sourceRest = alignSamples.length ? firstRest : preAlignSource;
      const sourceEase = sourceRest ? quinticStep(Number(sourceRest.q), 0, 1) : NaN;
      const targetEase = targetRest ? quinticStep(Number(targetRest.q), 0, 1) : NaN;
      const fitSpan = targetEase - sourceEase;
      const validationFrames = frames.filter(frame =>
        (frame.transitionActive && frame.entryPhase !== 'align') ||
        (frame.endpoint && (Math.abs(Number(frame.q) - targetQ) <= .001 || !alignSamples.length)));
      const residuals = validationFrames.map(frame => {
        const progress = (quinticStep(Number(frame.q), 0, 1) - sourceEase) / fitSpan;
        const baselineY = Number(sourceRest?.centerY) +
          (Number(targetRest?.centerY) - Number(sourceRest?.centerY)) * progress;
        const measuredLift = Number(frame.centerY) - baselineY;
        return { q:frame.q, phase:frame.entryPhase, endpoint:frame.endpoint, measuredLift, expectedLift:Number(frame.riseLift),
          error:measuredLift - Number(frame.riseLift) };
      });
      const peakMeasuredLift = residuals.length ? Math.max(...residuals.map(item => item.measuredLift)) : null;
      return { id:track.id, entry:track.entry, arrayCell:track.arrayCell,
        hasRestBaselines:!!sourceRest && !!targetRest, sourceQ:sourceRest?.q ?? null,
        sourcePhase:sourceRest?.entryPhase ?? null, targetQ:targetRest?.q ?? null,
        sourceY:finiteValue(sourceRest?.centerY) ? Number(sourceRest.centerY) : null,
        targetY:finiteValue(targetRest?.centerY) ? Number(targetRest.centerY) : null,
        preAlignSourceY:finiteValue(preAlignSource?.centerY) ? Number(preAlignSource.centerY) : null,
        preAlignSourceDelta:finiteValue(preAlignSource?.centerY) && finiteValue(sourceRest?.centerY)
          ? Number(preAlignSource.centerY) - Number(sourceRest.centerY) : null,
        residuals, peakMeasuredLift,
        okay:!!sourceRest && !!targetRest && Number.isFinite(fitSpan) && Math.abs(fitSpan) > 1e-6 &&
          Math.abs(Number(sourceRest.q) - sourceQ) <= .1 && Math.abs(Number(sourceRest.riseLift)) <= .001 &&
          residuals.length >= 3 &&
          residuals.every(item => Number.isFinite(item.error) && Math.abs(item.error) <= .035) &&
          Number.isFinite(peakMeasuredLift) && peakMeasuredLift > .1 };
    });
    const residentLiftPathOkay = residentLiftTracks.length > 0 && residentLiftTracks.every(track => track.okay);
    const focusFirstRest = actual.filter(sample => sample.transitionActive && sample.phase !== 'align' &&
      finiteValue(sample.heroWorldCenter?.[1]) && finiteValue(sample.focusRise?.lift))
      .reduce((nearest, sample) => !nearest || Math.abs(Number(sample.q) - sourceQ) < Math.abs(Number(nearest.q) - sourceQ)
        ? sample : nearest, null);
    const focusTargetRest = actual.find(sample => sample.endpoint && Math.abs(Number(sample.q) - targetQ) <= .001);
    const focusPreAlignSource = actual.find(sample => sample.endpoint && Math.abs(Number(sample.q) - sourceQ) <= .001);
    const focusSourceRest = alignSamples.length ? focusFirstRest : focusPreAlignSource;
    const focusSourceEase = focusSourceRest ? quinticStep(Number(focusSourceRest.q), 0, 1) : NaN;
    const focusTargetEase = focusTargetRest ? quinticStep(Number(focusTargetRest.q), 0, 1) : NaN;
    const focusFitSpan = focusTargetEase - focusSourceEase;
    const selectedFocusLiftPath = actual.filter(sample => finiteValue(sample.q) &&
      finiteValue(sample.heroWorldCenter?.[1]) && finiteValue(sample.focusRise?.lift) &&
      ((sample.transitionActive && sample.phase !== 'align') ||
        (sample.endpoint && (Math.abs(Number(sample.q) - targetQ) <= .001 || !alignSamples.length)))).map(sample => {
      const progress = (quinticStep(Number(sample.q), 0, 1) - focusSourceEase) / focusFitSpan;
      const baselineY = Number(focusSourceRest?.heroWorldCenter?.[1]) +
        (Number(focusTargetRest?.heroWorldCenter?.[1]) - Number(focusSourceRest?.heroWorldCenter?.[1])) * progress;
      const measuredLift = Number(sample.heroWorldCenter[1]) - baselineY;
      return { q:sample.q, phase:sample.phase, endpoint:sample.endpoint,
        riseAmount:Number(sample.focusRise.amount), measuredLift, expectedLift:Number(sample.focusRise.lift),
        error:measuredLift - Number(sample.focusRise.lift) };
    });
    const selectedFocusPathOkay = !!focusSourceRest && !!focusTargetRest && Number.isFinite(focusFitSpan) &&
      Math.abs(Number(focusSourceRest.q) - sourceQ) <= .1 && Math.abs(Number(focusSourceRest.focusRise?.lift)) <= .001 &&
      Math.abs(focusFitSpan) > 1e-6 && selectedFocusLiftPath.length >= 3 && selectedFocusLiftPath.every(sample =>
        Number.isFinite(sample.error) && Math.abs(sample.error) <= .035) &&
      Math.max(...selectedFocusLiftPath.map(sample => sample.measuredLift)) > .1;
    const selectedFocusBaseline = { sourceQ:focusSourceRest?.q ?? null, sourcePhase:focusSourceRest?.phase ?? null,
      sourceY:finiteValue(focusSourceRest?.heroWorldCenter?.[1]) ? Number(focusSourceRest.heroWorldCenter[1]) : null,
      targetQ:focusTargetRest?.q ?? null,
      targetY:finiteValue(focusTargetRest?.heroWorldCenter?.[1]) ? Number(focusTargetRest.heroWorldCenter[1]) : null,
      preAlignSourceY:finiteValue(focusPreAlignSource?.heroWorldCenter?.[1])
        ? Number(focusPreAlignSource.heroWorldCenter[1]) : null,
      preAlignSourceDelta:finiteValue(focusPreAlignSource?.heroWorldCenter?.[1]) &&
        finiteValue(focusSourceRest?.heroWorldCenter?.[1])
        ? Number(focusPreAlignSource.heroWorldCenter[1]) - Number(focusSourceRest.heroWorldCenter[1]) : null };
    const residentLanes = [...new Set(residentTracks.map(track => track.lane).filter(Number.isFinite))].sort((a, b) => a - b);
    const residentMovedLanes = [...new Set(residentTracks.filter(track => Number(track.endpointMovement) > .01)
      .map(track => track.lane).filter(Number.isFinite))].sort((a, b) => a - b);
    const residentPathOkay = residentTracks.length > 0 && residentLanes.length >= 2 &&
      residentTracks.every(track => track.presentEveryFrame && track.routeStable && track.arrayCellStable &&
        track.alphaOkay && track.scaleDepthOkay && track.geometryPathFinite &&
        track.badgeKindValid && track.extraClipMatchesRoute) &&
      residentMovedLanes.length === residentLanes.length;
    const matrixOnlyEndpointEntries = traceEndpointEntries(matrixEndpoint,
      item => item.route?.resident === false && item.route?.hasArray === false && item.route?.hasMatrix === true);
    const matrixOnlyTracks = traceTracks(matrixOnlyEndpointEntries, { resident:false, matrixOnly:true });
    const matrixOnlyOpaqueUnitScale = requested.length > 0 && requested.every(sample => sample.matrixOnlyCount > 0 &&
      sample.matrixOnlyVisualFailures.length === 0);
    const extraCurveSamples = actual.filter(sample => !sample.endpoint && sample.transitionActive &&
      finiteValue(sample.q) && finiteValue(sample.extraRise) && finiteValue(sample.groundY));
    const extraRiseFormulaFailures = extraCurveSamples.filter(sample =>
      Math.abs(sample.extraRise - quinticStep(sample.q, .18, .96)) > .01).map(sample => ({ q:sample.q,
      actualEnvelope:sample.extraRise, expectedEnvelope:quinticStep(sample.q, .18, .96) }));
    const perItemRiseFormulaFailures = actual.flatMap(sample =>
      (sample.riseFormulaFailures ?? []).map(failure => ({ q:sample.q, ...failure })));
    const riseDistanceFailures = actual.flatMap(sample =>
      (sample.riseDistanceFailures ?? []).map(failure => ({ q:sample.q, ...failure })));
    const focusRiseFormulaFailures = actual.flatMap(sample =>
      (sample.focusRiseFailures ?? []).map(failure => ({ q:sample.q, ...failure })));
    const groundFormulaFailures = extraCurveSamples.filter(sample => {
      const expectedGroundY = expectedArchiveMotionGroundY(sample.q, sample.caseBounds);
      return !Number.isFinite(expectedGroundY) || Math.abs(sample.groundY - expectedGroundY) > .002;
    }).map(sample => ({ q:sample.q, actualGroundY:sample.groundY,
      expectedGroundY:expectedArchiveMotionGroundY(sample.q, sample.caseBounds) }));
    const floorAgreementFailures = extraCurveSamples.filter(sample => !finiteValue(sample.floorY) ||
      Math.abs(sample.groundY - sample.floorY) > .002).map(sample => ({ q:sample.q, groundY:sample.groundY, floorY:sample.floorY }));
    const matrixOnlyExtraRiseCurveOkay = extraCurveSamples.length > 0 && extraRiseFormulaFailures.length === 0 &&
      perItemRiseFormulaFailures.length === 0 && riseDistanceFailures.length === 0 &&
      focusRiseFormulaFailures.length === 0;
    const matrixOnlyGroundCurveOkay = extraCurveSamples.length > 0 && groundFormulaFailures.length === 0 &&
      floorAgreementFailures.length === 0;
    const matrixOnlyTrackIntegrity = matrixOnlyTracks.length > 0 && matrixOnlyTracks.every(track =>
      track.presentEveryFrame && track.routeStable && track.arrayCellStable && track.alphaOkay &&
      track.scaleDepthOkay && track.geometryPathFinite && track.badgeKindValid && track.extraClipMatchesRoute);
    const matrixOnlyVerticalTracks = matrixOnlyTracks.map(track => {
      const actualPath = track.verticalSamples.filter(frame => frame.present && frame.transitionActive &&
        finiteValue(frame.q) && finiteValue(frame.riseAmount) &&
        finiteValue(frame.surfaceTop) && finiteValue(frame.groundY))
        .sort((left, right) => left.q - right.q);
      const nearestActualQ = q => actualPath.reduce((nearest, frame) => !nearest ||
        Math.abs(frame.q - q) < Math.abs(nearest.q - q) ? frame : nearest, null);
      const nearArray = nearestActualQ(.05), nearMatrix = nearestActualQ(.95);
      const completeBoundsAtArray = !!nearArray?.worldBounds &&
        Array.isArray(nearArray.worldBounds.min) && nearArray.worldBounds.min.length === 3 && nearArray.worldBounds.min.every(Number.isFinite) &&
        Array.isArray(nearArray.worldBounds.max) && nearArray.worldBounds.max.length === 3 && nearArray.worldBounds.max.every(Number.isFinite) &&
        finiteValue(nearArray.surfaceBottom) &&
        finiteValue(nearArray.surfaceTop) && finiteValue(nearArray.groundY) &&
        Number(nearArray.surfaceTop) <= Number(nearArray.groundY) - .001 &&
        Number(nearArray.surfaceBottom) <= Number(nearArray.surfaceTop);
      const riseMonotonicByQ = actualPath.length >= 3 && actualPath.slice(1).every((frame, index) =>
        frame.riseAmount + .005 >= actualPath[index].riseAmount && frame.surfaceTop + .035 >= actualPath[index].surfaceTop);
      const riseAmounts = actualPath.map(frame => Number(frame.riseAmount));
      const extraRiseRange = riseAmounts.length >= 2 && riseAmounts.every(value => value >= -.001 && value <= 1.001) &&
        Math.max(...riseAmounts) - Math.min(...riseAmounts) >= .75;
      const expectedNearMatrixRise = finiteValue(nearMatrix?.q) && riseScheduleOkay(nearMatrix?.rise)
        ? quinticStep(Number(nearMatrix.q), Number(nearMatrix.rise.start), Number(nearMatrix.rise.end)) : null;
      const fullyRaisedAtMatrix = finiteValue(nearMatrix?.riseAmount) && finiteValue(expectedNearMatrixRise) &&
        Math.abs(Number(nearMatrix.riseAmount) - expectedNearMatrixRise) <= .01;
      const sinkMonotonicInTravel = actualPath.length >= 3 && [...actualPath].reverse().slice(1).every((frame, index, reversed) =>
        frame.surfaceTop <= reversed[index].surfaceTop + .035 && frame.riseAmount <= reversed[index].riseAmount + .005);
      const riseMonotonicInTravel = target === 'array' ? riseMonotonicByQ : sinkMonotonicInTravel;
      const verticalTravelDistance = actualPath.length >= 2 ? actualPath.at(-1).surfaceTop - actualPath[0].surfaceTop : null;
      return { id:track.id, entry:track.entry, arrayCell:track.arrayCell, completeBoundsAtArray,
        arraySurface:{ q:nearArray?.q ?? null, entryPhase:nearArray?.entryPhase ?? null, groundY:nearArray?.groundY ?? null,
          extraRise:nearArray?.extraRise ?? null, riseAmount:nearArray?.riseAmount ?? null,
          surfaceBottom:nearArray?.surfaceBottom ?? null,
          surfaceTop:nearArray?.surfaceTop ?? null, badgeKind:nearArray?.badgeKind ?? null,
          extraClip:nearArray?.extraClip ?? null, worldBounds:nearArray?.worldBounds ?? null },
        matrixSurface:{ q:nearMatrix?.q ?? null, entryPhase:nearMatrix?.entryPhase ?? null, groundY:nearMatrix?.groundY ?? null,
          extraRise:nearMatrix?.extraRise ?? null, riseAmount:nearMatrix?.riseAmount ?? null,
          surfaceBottom:nearMatrix?.surfaceBottom ?? null,
          surfaceTop:nearMatrix?.surfaceTop ?? null, badgeKind:nearMatrix?.badgeKind ?? null,
          extraClip:nearMatrix?.extraClip ?? null, worldBounds:nearMatrix?.worldBounds ?? null },
        actualPathQ:actualPath.map(frame => frame.q), riseAmount:actualPath.map(frame => frame.riseAmount),
        surfaceTop:actualPath.map(frame => frame.surfaceTop), riseMonotonicByQ, riseMonotonicInTravel,
        sinkMonotonicInTravel, extraRiseRange, fullyRaisedAtMatrix, verticalTravelDistance };
    });
    const matrixOnlyArrayBoundsSubmerged = matrixOnlyVerticalTracks.length > 0 &&
      matrixOnlyVerticalTracks.every(track => track.completeBoundsAtArray);
    const matrixOnlyHiResBadgeTracks = matrixOnlyVerticalTracks.filter(track => track.entry === 'fixture-album-01');
    const matrixOnlyHiResBadgeSubmerged = matrixOnlyHiResBadgeTracks.length > 0 &&
      matrixOnlyHiResBadgeTracks.some(track => track.completeBoundsAtArray && track.arraySurface.badgeKind === 1 &&
        track.arraySurface.extraClip === true);
    const futureArchiveBadgeEnabled = requested.length > 0 && requested.every(sample =>
      sample.archiveBadge?.visible === true && Number(sample.archiveBadge?.hiResSlots) > 0);
    const matrixOnlyRisePathOkay = matrixOnlyVerticalTracks.length > 0 && matrixOnlyVerticalTracks.every(track =>
      track.riseMonotonicInTravel && track.extraRiseRange && track.fullyRaisedAtMatrix &&
      Number.isFinite(track.verticalTravelDistance) && track.verticalTravelDistance > .1);
    const orderedExtraRiseWave = requested.filter(sample => sample.q >= .30 && sample.q <= .80).map(sample => {
      const extras = sample.routeVisibility.filter(item => item.route?.resident === false &&
        item.route?.hasArray === false && item.route?.hasMatrix === true &&
        riseScheduleOkay(item.route.rise) && item.arrayCellKey);
      const slots = [...new Map(extras.map(item => [item.arrayCellKey, item])).values()];
      const visible = slots.filter(item => item.intersectsFrustum === true);
      const amounts = visible.map(item => Number(item.route.rise.amount));
      const starts = slots.map(item => Number(item.route.rise.start));
      const amountRange = amounts.length ? Math.max(...amounts) - Math.min(...amounts) : 0;
      const distinctStartCount = new Set(starts.map(value => value.toFixed(3))).size;
      const neighbors = [];
      for (let leftIndex = 0; leftIndex < slots.length; leftIndex++) {
        const left = slots[leftIndex], leftCell = left.route.arrayCell;
        for (let rightIndex = leftIndex + 1; rightIndex < slots.length; rightIndex++) {
          const right = slots[rightIndex], rightCell = right.route.arrayCell;
          const distance = Math.abs(Number(leftCell?.lane) - Number(rightCell?.lane)) +
            Math.abs(Number(leftCell?.row) - Number(rightCell?.row));
          if (distance === 1) neighbors.push({ left:left.arrayCellKey, right:right.arrayCellKey,
            startDelta:Math.abs(Number(left.route.rise.start) - Number(right.route.rise.start)) });
        }
      }
      const maxAdjacentStartDelta = neighbors.length ? Math.max(...neighbors.map(pair => pair.startDelta)) : null;
      const visibleAmountsDiffer = visible.length >= 2 && amountRange >= .12;
      const orderedWindowsVary = distinctStartCount >= 2;
      const adjacentSlotsContinuous = neighbors.length >= 5 && maxAdjacentStartDelta <= .17;
      return { q:sample.q, visibleExtraCount:visible.length, visibleAmountRange:amountRange,
        distinctStartCount, neighborPairCount:neighbors.length, maxAdjacentStartDelta,
        visibleAmountsDiffer, orderedWindowsVary, adjacentSlotsContinuous,
        sampleOkay:visibleAmountsDiffer && orderedWindowsVary && adjacentSlotsContinuous };
    }).sort((left, right) => right.visibleAmountRange - left.visibleAmountRange);
    const orderedExtraRiseWaveEvidence = orderedExtraRiseWave[0] ?? null;
    const orderedExtraRiseWaveOkay = !!orderedExtraRiseWaveEvidence?.sampleOkay &&
      perItemRiseFormulaFailures.length === 0 && riseDistanceFailures.length === 0;
    const extraRiseSamples = extraCurveSamples.map(sample => ({ requestedQ:sample.requestedQ, q:sample.q,
      entryPhase:sample.entryPhase, groundY:sample.groundY, extraRise:sample.extraRise }));
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
    const heroPathSamples = [...requested, targetEndpoint].filter(Boolean).sort((a, b) => a.q - b.q);
    const heroPathDistances = heroPathSamples.map(sample => sample.cameraToHeroDistance);
    const heroDistanceMonotonic = heroPathDistances.length >= 3 && heroPathDistances.every(Number.isFinite) &&
      heroPathDistances.slice(1).every((value, index) => value + .08 >= heroPathDistances[index]);
    const heroDistanceGrows = heroDistances.length >= 2 && heroDistances.at(-1) > heroDistances[0] + .5;
    const sourceQForHero = activeTarget === 1 ? 0 : 1;
    const firstActiveSample = requested.reduce((best, sample) => !best ||
      Math.abs(sample.q - sourceQForHero) < Math.abs(best.q - sourceQForHero) ? sample : best, null);
    const sourceHeroDistance = Number(sourceEndpoint?.cameraToHeroDistance);
    const firstActiveHeroDistance = Number(firstActiveSample?.cameraToHeroDistance);
    const targetHeroDistance = Number(targetEndpoint?.cameraToHeroDistance);
    const sourceToFirstActiveHeroDistanceDelta = Number.isFinite(sourceHeroDistance) && Number.isFinite(firstActiveHeroDistance)
      ? firstActiveHeroDistance - sourceHeroDistance : null;
    const heroDistancePathFacts = { firstActiveQ:firstActiveSample?.q ?? null,
      firstActiveDistance:Number.isFinite(firstActiveHeroDistance) ? firstActiveHeroDistance : null,
      targetQ:targetEndpoint?.q ?? null, targetDistance:Number.isFinite(targetHeroDistance) ? targetHeroDistance : null,
      sourceQ:sourceEndpoint?.q ?? null, sourceDistance:Number.isFinite(sourceHeroDistance) ? sourceHeroDistance : null,
      sourceToFirstActiveDelta:sourceToFirstActiveHeroDistanceDelta,
      monotonicSamples:heroPathSamples.length };
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
    const midpoint = requested.reduce((best, sample) => !best || Math.abs(sample.q - .5) < Math.abs(best.q - .5) ? sample : best, null);
    const rackHeadingTrackOkay = Number.isFinite(maxAbsoluteHeading) && maxAbsoluteHeading <= 10 * Math.PI / 180 + .012 &&
      Math.abs(Number(midpoint?.heading)) >= .12 && actual.filter(sample => sample.endpoint).every(sample => Math.abs(sample.heading) <= .03);
    const rowSpacingSamples = [...requested].sort((a, b) => a.q - b.q);
    const rowSpacings = rowSpacingSamples.map(sample => sample.rowSpacing);
    const rowSpacingStaysCompact = rowSpacings.length > 1 && rowSpacings.every(value => Number.isFinite(value) && value >= .55 && value <= 1.1) &&
      rowSpacingSamples[0].rowSpacing > rowSpacingSamples.at(-1).rowSpacing + .15;
    const rackFlightSamples = requested.map(sample => sample.rackFlight).filter(Boolean);
    const rackBoundsValid = rackFlightSamples.length === requested.length && rackFlightSamples.every(rack =>
      Array.isArray(rack.projected) && rack.projected.length === 4 && rack.projected.every(Number.isFinite) &&
      rack.projected[0] <= rack.projected[2] && rack.projected[3] <= rack.projected[1] &&
      Array.isArray(rack.translation) && rack.translation.length === 3 && rack.translation.every(Number.isFinite));
    const rackVisibilityFollowsCompleteBounds = rackFlightSamples.length === requested.length && rackFlightSamples.every(rack =>
      rack.visible === !rack.outside && (!rack.outside || Number(rack.projected?.[1]) < -1.1));
    const nearestFrame = q => requested.reduce((best, sample) => !best || Math.abs(sample.q - q) < Math.abs(best.q - q) ? sample : best, null);
    const nearArray = nearestFrame(.05);
    const nearMatrix = nearestFrame(.95);
    const rackAtArrayVisible = !!nearArray?.rackFlight?.visible && nearArray.rackFlight.outside === false;
    const rackExitsBelowViewport = nearMatrix?.rackFlight?.outside === true && nearMatrix.rackFlight.visible === false &&
      Number(nearMatrix.rackFlight.projected?.[1]) < -1.1;
    const preparedSamples = samples.filter(sample => sample.prepared === true);
    const rackDeploymentStaysFull = preparedSamples.length > 0 && preparedSamples.every(sample =>
      Number.isFinite(Number(sample.rackDeployment)) && Math.abs(Number(sample.rackDeployment) - 1) <= .03 &&
      Math.abs(Number(sample.transitionRackDeployment) - 1) <= .03);
    const rackPartsAtMid = Array.isArray(midpoint?.rackParts) ? midpoint.rackParts : [];
    // Compare the frozen rigid rack in flight, rather than a subsequent normal
    // shelf whose slot window may differ. Fixed floor marks and unused zero
    // instances are not physical rack members; visibility is audited by bounds.
    const firstRackParts = requested.find(sample => sample.rackParts?.some(part =>
      !/floor|locator|seam/i.test(part.name) && part.visible && xyz(part.scale)?.every(value => value > 1e-6)))?.rackParts ?? [];
    const rigidRackParts = firstRackParts.filter(part => !/floor|locator|seam/i.test(part.name) &&
      part.visible && xyz(part.scale)?.every(value => value > 1e-6));
    const fullRackPosePresent = rigidRackParts.length > 0 && rigidRackParts.every(part => {
      const moving = rackPartsAtMid.find(candidate => candidate.name === part.name);
      return xyz(moving?.scale) && part.scale.every((value, axis) => Math.abs(value - moving.scale[axis]) <= .04);
    });
    const selectedScaleOkay = requested.length > 0 && requested.every(sample => sample.selectedScale?.every(value =>
      Number.isFinite(value) && Math.abs(value - 1) <= .06));
    const residentRouteScaleOne = requested.length > 0 && requested.every(sample => sample.residentRouteCount > 0 &&
      sample.residentScaleFailures.length === 0);
    const residentWindowFrames = requested.filter(sample => sample.q >= .2 && sample.q <= .4);
    const residentMiddleFrames = requested.filter(sample => sample.q >= .4 && sample.q <= .6);
    const residentMiddleSampleCaptured = residentMiddleFrames.some(sample => sample.residentRouteCount > 0 &&
      sample.routeContractFailures.length === 0 && sample.residentScaleFailures.length === 0);
    const activeOneEndSamples = requested.filter(sample => sample.oneEndRouteCount > 0);
    const oneEndUnitPositiveDepth = activeOneEndSamples.every(sample => sample.oneEndScaleDepthFailures.length === 0);
    const routeContractOkay = actual.length > 0 && actual.every(sample => sample.routeContractFailures.length === 0) &&
      perItemRiseFormulaFailures.length === 0 && riseDistanceFailures.length === 0 &&
      focusRiseFormulaFailures.length === 0 && endpointRiseFormulaFailures.length === 0;
    const endpointRoutesOkay = [sourceBridge, targetBridge].every(bridge => bridge.unmatched?.length === 0 &&
      bridge.duplicateIds?.length === 0 && bridge.mapped > 0);
    const endpointBoxes = [sourceEndpoint, targetEndpoint].map(sample => sample?.heroProjectedBounds);
    const normalEndpointEnvelope = endpointBoxes.every(Boolean) ? {
      minY:Math.min(...endpointBoxes.map(box => box.minY)) - .01,
      maxY:Math.max(...endpointBoxes.map(box => box.maxY)) + .01,
    } : null;
    const horizontalBounds = requested.find(sample => sample.motionViewport?.bounds)?.motionViewport.bounds;
    const endpointsInsideCanvas = !!horizontalBounds && endpointBoxes.every(box => box?.valid && box.depthMin > 5 &&
      box.minX >= Math.max(-1, horizontalBounds.minX - .02) && box.maxX <= Math.min(1, horizontalBounds.maxX + .02) &&
      box.minY >= -1 && box.maxY <= 1);
    // Static Punk navigation spans empty space below the case. Preserve its
    // normal endpoint envelope vertically; do not redesign static UI here.
    const selectedViewportOkay = endpointsInsideCanvas && !!normalEndpointEnvelope && requested.length > 0 && requested.every(sample => {
      const viewport = sample.motionViewport;
      const bounds = viewport?.bounds ?? horizontalBounds;
      if (!viewport || !bounds) return false;
      return viewportAudit({ ...viewport, bounds: { ...bounds,
        minY:Math.min(bounds.minY, normalEndpointEnvelope.minY),
        maxY:Math.max(bounds.maxY, normalEndpointEnvelope.maxY) } }).ok;
    });
    const ownerContinuity = ownerContinuityAudit(requested);
    const ownerCellEntryStable = ownerContinuity.checkedIds > 0 && ownerContinuity.ownerChanges.length === 0;
    const neighborMotionPxPerSecond = neighborMotionAudit(samples);
    return { sampleCount:samples.length, qCoverage, qCoverageOkay, progressInBounds, progressMonotonic, qMonotonic,
      pathIsCameraOrbit, allIdentityStable, activeTarget, cameraYMonotonic, cameraYLowerAtMatrix,
      alignSampleCount:alignSamples.length, alignQFrozen, postAlignQMonotonic,
      pullsBackMonotonic, pullsBackAtMatrix, heroDistanceMonotonic, heroDistanceGrows,
      heroDistanceFacts, heroDistancePathFacts, sourceToFirstActiveHeroDistanceDelta,
      heroDistanceSourceDeltaExplanation:'Pre-click endpoint can differ from the first post-align q sample; only post-start q samples plus the target endpoint define hero-distance monotonicity.',
      cameraYawDelta, cameraOrbits,
      sourceVisibleEntryCount:sourceVisibleEntries.size, targetVisibleEntryCount:targetVisibleEntries.size,
      matrixSlotOwnership,
      sourceRouteKey, targetRouteKey, allVisibleEndpointEntriesRouted, routeCoverage,
      maxAbsoluteHeading, midpointHeading:midpoint?.heading ?? null, rackHeadingTrackOkay,
      rowSpacingRange:rowSpacings.length ? [Math.min(...rowSpacings), Math.max(...rowSpacings)] : [], rowSpacingStaysCompact,
      rackBoundsValid, rackVisibilityFollowsCompleteBounds, rackAtArrayVisible, rackExitsBelowViewport,
      rackDeploymentStaysFull, fullRackPosePresent,
      selectedScaleOkay, residentRouteScaleOne, midpointResidentRouteCount:midpoint?.residentRouteCount ?? 0,
      routeContractOkay, endpointRoutesOkay, sourceBridge, targetBridge,
      riseFormulaFailures:perItemRiseFormulaFailures, riseDistanceFailures, focusRiseFormulaFailures,
      endpointRiseFormulaFailures,
      residentPathOkay, residentTrackCount:residentTracks.length, residentTracks,
      residentLiftPathOkay, residentLiftTracks, selectedFocusPathOkay, selectedFocusLiftPath, selectedFocusBaseline,
      residentArrayCellLanes:residentLanes, residentMovedLanes,
      residentWindowQ:residentWindowFrames.map(sample => sample.q), residentMiddleSampleCaptured,
      residentMiddleQ:residentMiddleFrames.map(sample => sample.q),
      matrixOnlyOpaqueUnitScale, matrixOnlyTrackIntegrity, matrixOnlyArrayBoundsSubmerged,
      matrixOnlyRisePathOkay, matrixOnlyExtraRiseCurveOkay, matrixOnlyGroundCurveOkay,
      orderedExtraRiseWaveOkay, orderedExtraRiseWaveEvidence, orderedExtraRiseWave,
      matrixOnlyHiResBadgeSubmerged, matrixOnlyHiResBadgeTracks, futureArchiveBadgeEnabled,
      extraRiseFormulaFailures, perItemRiseFormulaFailures, riseDistanceFailures, focusRiseFormulaFailures,
      groundFormulaFailures, floorAgreementFailures,
      matrixOnlyTrackCount:matrixOnlyTracks.length, matrixOnlyTracks,
      matrixOnlyVerticalTracks, extraRiseSamples,
      oneEndSampleCount:activeOneEndSamples.length, oneEndUnitPositiveDepth,
      oneEndCountsAt:requested.map(sample => ({ q:sample.q, matrixOnly:sample.matrixOnlyCount,
        matrixOnlyVisible:sample.matrixOnlyVisibleCount, arrayOnly:sample.arrayOnlyCount,
        arrayOnlyVisible:sample.arrayOnlyVisibleCount,
        oneEndScaleDepthFailures:sample.oneEndScaleDepthFailures.length,
        matrixOnlyVisualFailures:sample.matrixOnlyVisualFailures.length })),
      qSampleMisses, selectedViewportOkay, endpointsInsideCanvas, normalEndpointEnvelope,
      ownerCellEntryStable, ownerContinuity, neighborMotionPxPerSecond };
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
  const auditAlignment = (context, required = false) => {
    const activeSamples = result.transitionSamples.filter(sample => sample.context === context && sample.active === true);
    const alignment = activeSamples.filter(sample => sample.phase === 'align');
    if (!required && alignment.length === 0) return null;
    const qValues = alignment.map(sample => Number(sample.q));
    const qFrozen = qValues.length >= 2 && qValues.every(Number.isFinite) && Math.max(...qValues) - Math.min(...qValues) <= 1e-8;
    const times = alignment.map(sample => Number(sample.sinceClickMs)).filter(Number.isFinite);
    const observedDurationMs = times.length >= 2 ? Math.max(...times) - Math.min(...times) : null;
    const alignmentDurationObserved = Number.isFinite(observedDurationMs) && observedDurationMs > 0 &&
      alignment.every(sample => Math.abs(Number(sample.alignmentDuration) - .18) < 1e-8 &&
        Number(sample.alignmentElapsed) >= 0 && Number(sample.alignmentElapsed) <= .18 + 1e-8);
    const desiredEnd = Number(alignment[0]?.desiredEnd);
    const sourceQ = desiredEnd === 1 ? 0 : 1;
    const qStartsAtSourceEndpoint = qValues.length > 0 && Math.abs(qValues[0] - sourceQ) <= .001;
    const lastAlignMs = times.length ? Math.max(...times) : 0;
    const afterAlign = activeSamples.filter(sample => Number(sample.sinceClickMs) > lastAlignMs);
    const direction = desiredEnd === 1 ? 1 : -1;
    const postAlignQMonotonic = afterAlign.length >= 2 && afterAlign.every((sample, index) => index === 0 ||
      (direction > 0 ? sample.q + .015 >= afterAlign[index - 1].q : sample.q - .015 <= afterAlign[index - 1].q));
    const postAlignQMoved = afterAlign.length >= 2 && Math.abs(Number(afterAlign.at(-1).q) - Number(afterAlign[0].q)) > .05;
    const audit = { observed:alignment.length > 0, sampleCount:alignment.length, qMin:qValues.length ? Math.min(...qValues) : null,
      qMax:qValues.length ? Math.max(...qValues) : null, qFrozen, qStartsAtSourceEndpoint,
      observedDurationMs, simulatedDuration:alignment[0]?.alignmentDuration ?? null, alignmentDurationObserved,
      postAlignSampleCount:afterAlign.length, postAlignQMonotonic, postAlignQMoved };
    record(`${context} hover alignment holds canonical q during its 0.18s animation clock`,
      qFrozen && qStartsAtSourceEndpoint && alignmentDurationObserved && postAlignQMonotonic && postAlignQMoved, audit);
    return audit;
  };
  const transitionTo = async (designLabel, target, identity, options = {}) => {
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
    `${designLabel} ${target} canonical endpoint`, 30000, 12);
    const detailedEnd = await geometrySnapshot();
    record(`${designLabel} ${target} reaches canonical q=${desiredEnd} with identity intact`,
      identityMatches(end, identity) && identityMatches(detailedEnd, identity) &&
      Math.abs(Number(detailedEnd.stats?.layoutTransition?.q) - desiredEnd) < .001, shortState(detailedEnd));
    const alignmentAudit = auditAlignment(context, options.requireAlignment === true);
    if (alignmentAudit) result.timeline.push({ design:designLabel, direction:'hover-alignment', target,
      alignment:alignmentAudit, endpoint:detailedEnd.viewLayout });
    transitionProbeStartedAt = 0; transitionProbeContext = '';
    return detailedEnd;
  };
  const runFlightLeg = async (designLabel, target, identity, requestedQValues) => {
    const sourceLayout = target === 'array' ? 'shelf' : 'array';
    const sourceQ = target === 'array' ? 0 : 1;
    const targetQ = target === 'array' ? 1 : 0;
    const canonicalDirection = target === 'array' ? 1 : -1;
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
    await startDenseGeometryCapture();
    await clickLayout(target);
    const active = await waitForFast(state => state.viewLayout === target && state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.desiredEnd) === desiredEnd,
    `${context} active camera-orbit`, 10000, 12);
    record(`${context} activates with canonical q moving toward ${targetQ}`, identityMatches(active, identity) &&
      active.stats.layoutTransition.path === 'camera-orbit' && Number.isFinite(Number(active.stats.layoutTransition.q)), shortState(active));
    const observations = [];
    for (const requestedQ of requestedQValues) {
      const qTolerance = requestedQ === .2 || requestedQ === .4 ? .004 : requestedQ === .55 ? .006 : .018;
      const actualReachedTarget = value => canonicalDirection > 0
        ? Number(value.stats?.layoutTransition?.q) >= requestedQ - qTolerance
        : Number(value.stats?.layoutTransition?.q) <= requestedQ + qTolerance;
      const state = await waitForFast(value => value.viewLayout === target &&
        Number(value.stats?.layoutTransition?.desiredEnd) === desiredEnd && actualReachedTarget(value),
      `${context} q=${requestedQ.toFixed(2)}`, 15000, 8);
      const fastQ = Number(state.stats?.layoutTransition?.q), fastError = Math.abs(fastQ - requestedQ);
      if (!Number.isFinite(fastError) || fastError > .022) {
        const miss = { context, requestedQ, actualQ:fastQ, absoluteError:Number.isFinite(fastError) ? fastError : null,
          direction, frameTime:state.stats?.frameTime ?? null, cameraPosition:state.stats?.cameraPosition ?? null,
          cameraDistance:state.stats?.cameraDistance ?? null,
          reason:'The requested q threshold was crossed while capture was delayed; no geometry screenshot was labeled as that q.' };
        result.qSampleMisses.push(miss);
      }
      const observed = await captureFlightSample(context, requestedQ, false);
      const captureError = Math.abs(Number(observed.q) - requestedQ);
      if (!Number.isFinite(captureError) || captureError > .022) {
        const miss = { context, requestedQ, actualQ:observed.q, absoluteError:Number.isFinite(captureError) ? captureError : null,
          direction, frameTime:observed.frameTime, cameraPosition:observed.cameraPosition,
          cameraDistance:observed.cameraDistance,
          reason:'The full geometry read advanced beyond the requested q window; the observed q is retained as-is.' };
        result.qSampleMisses.push(miss);
      }
      observations.push(observed);
      record(`${context} q=${requestedQ.toFixed(2)} keeps selected entry and its owner cell`,
        identityMatches(state, identity) && identityMatches(observed, identity) && observed.instanceCount > 0,
        { requestedQ, actualQ:observed.q, selectedCell:observed.selectedCell, instanceCount:observed.instanceCount });
      if (![.2,.4,.55].includes(requestedQ)) await takeScreenshot(`${designLabel.toLowerCase()}-${direction}-q-${requestedQ.toFixed(2)}`,
        { direction, requestedQ, actualQ:observed.q, canonicalQ:observed.q,
          entryPhase:observed.entryPhase, groundY:observed.groundY, floorY:observed.floorY,
          extraRise:observed.extraRise, archiveBadge:observed.archiveBadge,
          extraSurfaceBounds:observed.routeVisibility.filter(item => item.route?.resident === false &&
            item.route?.hasArray === false && item.route?.hasMatrix === true).map(item => ({ id:item.id,
            entry:item.entry, arrayCellKey:item.arrayCellKey, surfaceBottom:item.worldBounds?.min?.[1] ?? null,
            surfaceTop:item.worldBounds?.max?.[1] ?? null, badgeKind:item.badgeKind, extraClip:item.extraClip,
            worldBounds:item.worldBounds })),
          selectedAlbumId:observed.selectedAlbumId,
          selectedEntryKey:observed.selectedEntryKey, selectedCell:observed.selectedCell,
          cameraY:observed.cameraPosition?.[1] ?? null, cameraDistance:observed.cameraDistance,
          cameraToHeroDistance:observed.cameraToHeroDistance, rackFlight:observed.rackFlight }, 0, true);
    }
    const endpointFast = await waitForFast(state => state.viewLayout === target && state.stats?.layoutTransition?.active === false &&
      Math.abs(Number(state.stats.layoutTransition.q) - targetQ) < .001,
    `${context} endpoint q=${targetQ}`, 18000, 12);
    const dense = await finishDenseGeometryCapture();
    for (const state of dense.frames) await captureFlightSample(context, Number(state.stats?.layoutTransition?.q), false, state);
    const denseQs = dense.frames.map(state => Number(state.stats?.layoutTransition?.q));
    const maximumQStep = Math.max(0, ...denseQs.slice(1).map((q, i) => Math.abs(q - denseQs[i])));
    record(`${context} records dense actual renderer frames independently of screenshot latency`,
      dense.frames.length >= 16 && !dense.overflow && maximumQStep <= .057001,
      { count:dense.frames.length, maximumQStep, overflow:dense.overflow });
    const endSample = await captureFlightSample(context, targetQ, true);
    await takeScreenshot(`${designLabel.toLowerCase()}-${direction}-q-${targetQ.toFixed(2)}-endpoint`,
      { direction, requestedQ:targetQ, actualQ:endSample.q, canonicalQ:targetQ, endpoint:'target', layout:target,
        entryPhase:endSample.entryPhase, groundY:endSample.groundY, floorY:endSample.floorY,
        extraRise:endSample.extraRise, archiveBadge:endSample.archiveBadge,
        selectedAlbumId:endSample.selectedAlbumId, selectedEntryKey:endSample.selectedEntryKey }, 0, true);
    record(`${context} settles at the target q and keeps entry ownership`,
      identityMatches(endpointFast, identity) && identityMatches(endSample, identity) && endSample.instanceCount > 0,
      { q:endSample.q, layout:endSample.selectedAlbumId, selectedCell:endSample.selectedCell });
    const handoff = await settledHandoffAudit(designLabel, direction, identity, await geometrySnapshot());
    transitionProbeStartedAt = 0; transitionProbeContext = '';
    const audit = auditFlight(context, target, requestedQValues, identity);
    record(`${context} captures dense actual q coverage in path order with camera-orbit`,
      audit.qCoverageOkay && audit.qMonotonic && audit.alignQFrozen && audit.postAlignQMonotonic &&
      audit.progressInBounds && audit.progressMonotonic && audit.pathIsCameraOrbit, audit);
    record(`${context} captures resident geometry through q=.2-.4 and the transition midpoint`,
      audit.residentWindowQ.length > 0 && audit.residentMiddleSampleCaptured,
      { residentActualQ:audit.residentWindowQ, residentMiddleActualQ:audit.residentMiddleQ,
        missedQSamples:audit.qSampleMisses });
    record(`${context} camera follows the authored orbit into MATRIX`,
      audit.cameraYMonotonic && audit.cameraYLowerAtMatrix && audit.cameraOrbits,
      { cameraYMonotonic:audit.cameraYMonotonic, cameraYLowerAtMatrix:audit.cameraYLowerAtMatrix,
        pullsBackMonotonic:audit.pullsBackMonotonic, pullsBackAtMatrix:audit.pullsBackAtMatrix,
        heroDistanceMonotonic:audit.heroDistanceMonotonic, heroDistanceGrows:audit.heroDistanceGrows,
        cameraYawDelta:audit.cameraYawDelta, heroDistanceFacts:audit.heroDistanceFacts,
        heroDistancePathFacts:audit.heroDistancePathFacts,
        sourceToFirstActiveHeroDistanceDelta:audit.sourceToFirstActiveHeroDistanceDelta,
        heroDistanceSourceDeltaExplanation:audit.heroDistanceSourceDeltaExplanation });
    record(`${context} preserves selected entry ownership, resident scale and every visible endpoint entry`,
      audit.allIdentityStable && audit.ownerCellEntryStable && audit.selectedViewportOkay && audit.selectedScaleOkay &&
      audit.residentRouteScaleOne && audit.routeContractOkay && audit.endpointRoutesOkay &&
      audit.allVisibleEndpointEntriesRouted,
      { allIdentityStable:audit.allIdentityStable, ownerContinuity:audit.ownerContinuity,
        selectedViewportOkay:audit.selectedViewportOkay, selectedScaleOkay:audit.selectedScaleOkay,
        residentScaleOne:audit.residentRouteScaleOne, routeContractOkay:audit.routeContractOkay,
        endpointRoutesOkay:audit.endpointRoutesOkay, sourceRouteBridge:audit.sourceBridge,
        targetRouteBridge:audit.targetBridge,
        midpointResidentRouteCount:audit.midpointResidentRouteCount,
        sourceVisibleEntryCount:audit.sourceVisibleEntryCount, targetVisibleEntryCount:audit.targetVisibleEntryCount,
        sourceRouteKey:audit.sourceRouteKey, targetRouteKey:audit.targetRouteKey,
        allVisibleEndpointEntriesRouted:audit.allVisibleEndpointEntriesRouted, routeCoverage:audit.routeCoverage });
    record(`${context} MATRIX endpoint owns all 432 physical slots through production shelf mapping`,
      audit.matrixSlotOwnership.ok, audit.matrixSlotOwnership);
    record(`${context} keeps ARRAY resident identities rendered and unit-scale through MATRIX`,
      audit.residentPathOkay,
      { residentTrackCount:audit.residentTrackCount, arrayCellLanes:audit.residentArrayCellLanes,
        movedLanes:audit.residentMovedLanes,
        failingTracks:audit.residentTracks.filter(track => !(track.presentEveryFrame && track.routeStable &&
          track.arrayCellStable && track.alphaOkay && track.scaleDepthOkay &&
          track.geometryPathFinite && track.badgeKindValid && track.extraClipMatchesRoute)).slice(0, 12),
        tracks:audit.residentTracks });
    record(context + ' resident surfaces add the scheduled lift over the eased ARRAY-to-MATRIX baseline',
      audit.residentLiftPathOkay,
      { tracks:audit.residentLiftTracks });
    record(context + ' selected focus follows its dedicated rise schedule over the eased baseline',
      audit.selectedFocusPathOkay,
      { baseline:audit.selectedFocusBaseline, selectedFocusLiftPath:audit.selectedFocusLiftPath,
        focusRiseFailures:audit.focusRiseFormulaFailures.slice(0, 12) });
    record(`${context} one-end cases stay unit-size and in positive camera depth while moving`,
      audit.oneEndUnitPositiveDepth, { oneEndUnitPositiveDepth:audit.oneEndUnitPositiveDepth,
        auditedActiveSamples:audit.oneEndSampleCount, oneEndCountsAt:audit.oneEndCountsAt,
        failures:observations.map(sample => ({ q:sample.q, failures:sample.oneEndScaleDepthFailures.length,
          first:sample.oneEndScaleDepthFailures.slice(0, 3) })) });
    record(`${context} extras stay opaque and unit-scale while full bounds rise from below the ARRAY ground and sink back`,
      audit.matrixOnlyOpaqueUnitScale && audit.matrixOnlyTrackIntegrity &&
      audit.matrixOnlyArrayBoundsSubmerged && audit.matrixOnlyRisePathOkay &&
      audit.matrixOnlyExtraRiseCurveOkay && audit.matrixOnlyGroundCurveOkay,
      { matrixOnlyOpaqueUnitScale:audit.matrixOnlyOpaqueUnitScale,
        matrixOnlyTrackIntegrity:audit.matrixOnlyTrackIntegrity,
        matrixOnlyArrayBoundsSubmerged:audit.matrixOnlyArrayBoundsSubmerged,
        matrixOnlyRisePathOkay:audit.matrixOnlyRisePathOkay,
        matrixOnlyExtraRiseCurveOkay:audit.matrixOnlyExtraRiseCurveOkay,
        matrixOnlyGroundCurveOkay:audit.matrixOnlyGroundCurveOkay,
        extraRiseFormulaFailures:audit.extraRiseFormulaFailures,
        perItemRiseFormulaFailures:audit.perItemRiseFormulaFailures,
        riseDistanceFailures:audit.riseDistanceFailures,
        focusRiseFormulaFailures:audit.focusRiseFormulaFailures,
        groundFormulaFailures:audit.groundFormulaFailures,
        floorAgreementFailures:audit.floorAgreementFailures,
        matrixOnlyTrackCount:audit.matrixOnlyTrackCount,
        verticalTracks:audit.matrixOnlyVerticalTracks,
        failingTracks:audit.matrixOnlyTracks.filter(track => !(track.presentEveryFrame && track.routeStable &&
          track.arrayCellStable && track.alphaOkay && track.scaleDepthOkay && track.geometryPathFinite &&
          track.badgeKindValid && track.extraClipMatchesRoute)).slice(0, 12),
        oneEndCountsAt:audit.oneEndCountsAt });
    record(context + ' extra items rise in a deterministic outward wave with continuous neighboring slots',
      audit.orderedExtraRiseWaveOkay,
      { evidence:audit.orderedExtraRiseWaveEvidence, candidates:audit.orderedExtraRiseWave,
        perItemRiseFormulaFailures:audit.perItemRiseFormulaFailures.slice(0, 12),
        riseDistanceFailures:audit.riseDistanceFailures.slice(0, 12) });
    record(`${context} keeps the Future Hi-Res badge active and clips its buried extra instances`,
      designLabel !== 'Future' || (audit.futureArchiveBadgeEnabled && audit.matrixOnlyHiResBadgeSubmerged),
      { appliesToFuture:designLabel === 'Future', archiveBadgeEnabled:audit.futureArchiveBadgeEnabled,
        hiResExtraSubmerged:audit.matrixOnlyHiResBadgeSubmerged,
        hiResTracks:audit.matrixOnlyHiResBadgeTracks,
        archiveBadgeAt:observations.map(sample => ({ requestedQ:sample.requestedQ, actualQ:sample.q,
          archiveBadge:sample.archiveBadge })),
        badgeExtraAtArray:audit.matrixOnlyVerticalTracks.filter(track => track.entry === 'fixture-album-01')
          .map(track => ({ id:track.id, arrayCell:track.arrayCell, arraySurface:track.arraySurface })) });
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
      targetCameraToHeroDistance:endSample.cameraToHeroDistance,
      sourceToFirstActiveHeroDistanceDelta:audit.sourceToFirstActiveHeroDistanceDelta,
      heroDistancePathFacts:audit.heroDistancePathFacts,
      heroDistanceSourceDeltaExplanation:audit.heroDistanceSourceDeltaExplanation, handoff,
      audit:summarizeDiagnostic(audit) });
    return { endpointFast, audit };
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
    const requestedAscending = [.05,.15,.2,.3,.4,.5,.55,.7,.85,.95];
    const requestedDescending = [...requestedAscending].reverse();
    const source = await snapshot();
    record(`${designLabel} canonical flight suite starts in ARRAY at q=0`, source.viewLayout === 'shelf' &&
      source.stats?.layoutTransition?.active !== true && identityMatches(source, identity), shortState(source));
    const forward = await runFlightLeg(designLabel, 'array', identity, requestedAscending);
    const reverse = await runFlightLeg(designLabel, 'shelf', identity, requestedDescending);
    const interpolateAtQ = (points, q, field) => {
      const ordered = points.filter(point => finiteValue(point.q) && finiteValue(point[field]))
        .sort((left, right) => left.q - right.q);
      if (!ordered.length) return null;
      const exact = ordered.find(point => Math.abs(point.q - q) <= .001);
      if (exact) return Number(exact[field]);
      const rightIndex = ordered.findIndex(point => point.q > q);
      if (rightIndex < 0) {
        const last = ordered.at(-1);
        return Math.abs(last.q - q) <= .035 ? Number(last[field]) : null;
      }
      if (rightIndex === 0) return Math.abs(ordered[0].q - q) <= .035 ? Number(ordered[0][field]) : null;
      const left = ordered[rightIndex - 1], right = ordered[rightIndex], span = right.q - left.q;
      if (span <= 1e-8) return Number(left[field]);
      const amount = (q - left.q) / span;
      return Number(left[field]) + (Number(right[field]) - Number(left[field])) * amount;
    };
    const commonQRange = (leftPoints, rightPoints) => {
      const leftQs = leftPoints.map(point => Number(point.q)).filter(Number.isFinite);
      const rightQs = rightPoints.map(point => Number(point.q)).filter(Number.isFinite);
      if (!leftQs.length || !rightQs.length) return null;
      const min = Math.max(Math.min(...leftQs), Math.min(...rightQs));
      const max = Math.min(Math.max(...leftQs), Math.max(...rightQs));
      return max > min ? { min, max } : null;
    };
    const preferredCompareQs = [.3,.4,.5,.55,.7];
    const forwardPoints = forward.audit.extraRiseSamples, reversePoints = reverse.audit.extraRiseSamples;
    const globalOverlap = commonQRange(forwardPoints, reversePoints);
    const sharedRiseQs = preferredCompareQs.filter(q => globalOverlap && q >= globalOverlap.min + .01 && q <= globalOverlap.max - .01);
    const pairedRise = sharedRiseQs.map(q => {
      const forwardRise = interpolateAtQ(forwardPoints, q, 'extraRise'), reverseRise = interpolateAtQ(reversePoints, q, 'extraRise');
      const forwardGround = interpolateAtQ(forwardPoints, q, 'groundY'), reverseGround = interpolateAtQ(reversePoints, q, 'groundY');
      return { q, forwardRise, reverseRise, riseDelta:Number.isFinite(forwardRise) && Number.isFinite(reverseRise)
        ? Math.abs(forwardRise - reverseRise) : null,
        forwardGround, reverseGround, groundDelta:Number.isFinite(forwardGround) && Number.isFinite(reverseGround)
          ? Math.abs(forwardGround - reverseGround) : null };
    });
    const forwardTracks = new Map(forward.audit.matrixOnlyVerticalTracks.map(track => [`${track.entry}|${track.arrayCell}`, track]));
    const reverseTracks = new Map(reverse.audit.matrixOnlyVerticalTracks.map(track => [`${track.entry}|${track.arrayCell}`, track]));
    const sharedTrackKeys = [...forwardTracks.keys()].filter(key => reverseTracks.has(key));
    const pairedSurfaces = sharedTrackKeys.flatMap(key => {
      const left = forwardTracks.get(key), right = reverseTracks.get(key);
      const leftPoints = left.actualPathQ.map((actualQ, index) => ({ q:actualQ,
        surfaceTop:left.surfaceTop[index], riseAmount:left.riseAmount[index] }));
      const rightPoints = right.actualPathQ.map((actualQ, index) => ({ q:actualQ,
        surfaceTop:right.surfaceTop[index], riseAmount:right.riseAmount[index] }));
      const overlap = commonQRange(leftPoints, rightPoints);
      if (!overlap) return [];
      return preferredCompareQs.filter(q => q >= overlap.min + .01 && q <= overlap.max - .01).map(q => {
        const forwardTop = interpolateAtQ(leftPoints, q, 'surfaceTop');
        const reverseTop = interpolateAtQ(rightPoints, q, 'surfaceTop');
        const forwardAmount = interpolateAtQ(leftPoints, q, 'riseAmount');
        const reverseAmount = interpolateAtQ(rightPoints, q, 'riseAmount');
        return { key, q, forwardTop, reverseTop, forwardAmount, reverseAmount,
          riseAmountDelta:Number.isFinite(forwardAmount) && Number.isFinite(reverseAmount)
            ? Math.abs(forwardAmount - reverseAmount) : null,
          absoluteDelta:Number.isFinite(forwardTop) && Number.isFinite(reverseTop) ? Math.abs(forwardTop - reverseTop) : null };
      });
    });
    const extraRiseReversal = { design:designLabel, comparedActualQs:pairedRise.map(sample => sample.q), commonQRange:globalOverlap, pairedRise,
      sharedExtraTracks:sharedTrackKeys.length, pairedSurfaces,
      ok:pairedRise.length >= 3 && pairedRise.every(sample => sample.riseDelta !== null && sample.riseDelta <= .025 &&
        sample.groundDelta !== null && sample.groundDelta <= .025) && sharedTrackKeys.length > 0 &&
        pairedSurfaces.length > 0 && pairedSurfaces.every(sample => sample.riseAmountDelta !== null &&
          sample.riseAmountDelta <= .025 && sample.absoluteDelta !== null && sample.absoluteDelta <= .12) };
    result.extraRiseReversals.push(extraRiseReversal);
    record(`${designLabel} extras use the same ground, rise and full-box height at matching q in reverse`,
      extraRiseReversal.ok, extraRiseReversal);
    return exerciseRetargets(designLabel, identity);
  };
  const selectFixtureAlbumInFirstArrayLane = async (albumId, label) => {
    const firstShelf = fixtureMatrixShelves[0] ?? [];
    const inFirstShelf = state => firstShelf.includes(state.selectedEntryKey);
    const targetSlot = firstShelf.indexOf(albumId);
    if (targetSlot < 0) throw new Error(`${label} target is absent from the first canonical shelf.`);
    let selected = await snapshot();
    for (let lane = 0; lane < fixtureMatrixShelves.length && !inFirstShelf(selected); lane++) {
      const previousAlbumId = selected.selectedAlbumId;
      await click('.music-navigation [data-action="genre-prev"]');
      selected = await waitFor(state => state.selectedAlbumId && state.selectedAlbumId !== previousAlbumId,
        `${label} move selection to the first Fixture lane`, 10000, 35);
    }
    if (!inFirstShelf(selected))
      throw new Error(`${label} did not reach the first Fixture lane: ${JSON.stringify(shortState(selected))}`);
    for (let advance = 0; advance < firstShelf.length && selected.selectedAlbumId !== albumId; advance++) {
      const previousAlbumId = selected.selectedAlbumId;
      const step = firstShelf.indexOf(selected.selectedEntryKey) > targetSlot ? 'prev' : 'next';
      await click(`.music-navigation [data-action="${step}"]`);
      selected = await waitFor(state => state.selectedAlbumId && state.selectedAlbumId !== previousAlbumId && state.selectedEntryKey,
        `${label} advance within the first Fixture lane toward ${albumId}`, 10000, 35);
    }
    if (selected.selectedAlbumId !== albumId || !selected.selectedEntryKey)
      throw new Error(`${label} failed to select ${albumId} from the first Fixture lane: ${JSON.stringify(shortState(selected))}`);
    return waitFor(state => state.selectedAlbumId === albumId && !!state.selectedEntryKey &&
      Number(state.stats?.returningFiles) === 0 && state.stats?.selectionPhase === 'settled',
    `${label} first-lane selection settles`, 10000, 40);
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
    const current = { ...await snapshot(), ...await geometrySnapshot() };
    const projected = current.stats?.projectedCenter;
    let projectedPoint = Array.isArray(projected) && projected.length >= 2 && current.canvasRect
      ? { x:Math.round(current.canvasRect.x + projected[0]), y:Math.round(current.canvasRect.y + projected[1]) }
      : pointInScene(current, 0.5, 0.5);
    if (!projectedPoint) throw new Error(`${label} has no visible MATRIX hover coordinate.`);
    const geometry = current.stats?.motionGeometry, rect = current.canvasRect;
    const candidatePoints = (geometry?.instances ?? []).flatMap(instance => {
      const world = transformedBounds(geometry.bounds, instance.matrix);
      const box = world ? projectWorldBounds(world.points, current) : null;
      if (!box?.intersectsFrustum || !rect) return [];
      const x = rect.x + (box.minX + box.maxX + 2) * rect.width / 4;
      const y = rect.y + (2 - box.minY - box.maxY) * rect.height / 4;
      return x > rect.x + 30 && x < (current.canvasVisibleRight ?? rect.right) - 30 &&
        y > rect.y + rect.height * .32 && y < rect.bottom - 80 ? [{ x:Math.round(x), y:Math.round(y) }] : [];
    }).sort((a,b) => Math.hypot(a.x-projectedPoint.x,a.y-projectedPoint.y) - Math.hypot(b.x-projectedPoint.x,b.y-projectedPoint.y));
    let hovered = current;
    for (const point of [projectedPoint, ...candidatePoints.slice(0, 12)]) {
      projectedPoint = point;
      wc.sendInputEvent({ type:'mouseMove', x:point.x, y:point.y });
      await pause(220);
      hovered = await snapshot();
      if (hovered.stats?.matrixHover?.cell) {
        hovered = await waitFor(state => state.stats?.matrixHover?.cell &&
          Math.abs(Number(state.stats.matrixHover.height) - .28) <= .025, `${label} visible-instance hover settles`, 3000, 30);
        break;
      }
    }
    return { point:projectedPoint, state:hovered };
  };
  const exerciseFinalShelfFiveCycle = async (label, initialState) => {
    const lastShelf = fixtureMatrixShelves.at(-1) ?? [];
    if (lastShelf.length !== 5) throw new Error(`${label} final MATRIX shelf fixture must contain exactly five entries.`);
    const addressOf = state => {
      const cell = state?.stats?.selectedCell ?? null;
      return { lane:Number.isFinite(Number(cell?.lane)) ? Number(cell.lane) : null,
        row:Number.isFinite(Number(cell?.row)) ? Number(cell.row) : null,
        entry:cell?.foobarEntryKey ?? state?.selectedEntryKey ?? null,
        albumId:state?.selectedAlbumId ?? null };
    };
    let current = await waitFor(state => state.viewLayout === 'array' && state.stats?.layoutTransition?.active !== true &&
      identityMatches(state, { selectedAlbumId:initialState.selectedAlbumId, selectedEntryKey:initialState.selectedEntryKey }) &&
      Number(state.stats?.returningFiles) === 0 && state.stats?.selectionPhase === 'settled',
    `${label} dragged MATRIX owner settles before the short-shelf cycle`, 10000, 35);
    let genreHops = 0;
    while (!lastShelf.includes(current.selectedEntryKey) && genreHops < 3) {
      const previousAlbumId = current.selectedAlbumId;
      await click('.music-navigation [data-action="genre-next"]');
      current = await waitFor(state => state.selectedAlbumId && state.selectedAlbumId !== previousAlbumId && state.selectedEntryKey,
        `${label} genre-next toward the five-entry final shelf`, 10000, 35);
      genreHops++;
    }
    const reachedLastShelf = lastShelf.includes(current.selectedEntryKey);
    const navigationCycles = [];
    let nonCanonicalCopy = false;
    for (let cycleIndex = 0; reachedLastShelf && cycleIndex < 2 && !nonCanonicalCopy; cycleIndex++) {
      const cycleStart = addressOf(current), cycleCells = [cycleStart];
      for (let step = 0; step < lastShelf.length; step++) {
        const previousAlbumId = current.selectedAlbumId;
        await click('.music-navigation [data-action="next"]');
        current = await waitFor(state => state.selectedAlbumId && state.selectedAlbumId !== previousAlbumId && state.selectedEntryKey,
          `${label} five-entry final-shelf next ${step + 1}/5`, 10000, 35);
        cycleCells.push(addressOf(current));
      }
      const cycleMembership = cycleCells.every(cell => lastShelf.includes(cell.entry));
      const cycleChangedEveryStep = cycleCells.slice(1).every((cell, index) => cell.entry !== cycleCells[index].entry);
      const cycleReturnedToStart = cycleCells.at(-1)?.entry === cycleCells[0]?.entry;
      const cycleVisitedFiveEntries = new Set(cycleCells.slice(0, 5).map(cell => cell.entry)).size === 5;
      current = await waitFor(state => state.selectedEntryKey === cycleStart.entry &&
        Number(state.stats?.returningFiles) === 0 && state.stats?.selectionPhase === 'settled',
      `${label} final-shelf five-entry cycle settles`, 10000, 35);
      const matrixAfter = addressOf(current);
      const slot = lastShelf.indexOf(matrixAfter.entry);
      const canonicalArray = { lane:fixtureMatrixShelves.length - 1, row:12 + slot, entry:matrixAfter.entry };
      nonCanonicalCopy = Number.isInteger(matrixAfter.row) && matrixAfter.row !== canonicalArray.row;
      navigationCycles.push({ index:cycleIndex + 1, cells:cycleCells,
        canonicalM:cycleStart, canonicalA:canonicalArray, canonicalB:matrixAfter,
        cycleMembership, cycleChangedEveryStep, cycleReturnedToStart, cycleVisitedFiveEntries,
        nonCanonicalCopy });
    }
    const finalCycle = navigationCycles.at(-1);
    const cycleOkay = reachedLastShelf && genreHops <= 3 && navigationCycles.length > 0 &&
      navigationCycles.every(cycle => cycle.cycleMembership && cycle.cycleChangedEveryStep &&
        cycle.cycleReturnedToStart && cycle.cycleVisitedFiveEntries) && nonCanonicalCopy;
    record(`${label} MATRIX next navigates a full five-entry final-shelf cycle on a non-canonical physical row`, cycleOkay,
      { lastShelf, genreHops, cycleCount:navigationCycles.length, navigationCycles,
        canonicalM:finalCycle?.canonicalM ?? null, canonicalA:finalCycle?.canonicalA ?? null,
        canonicalB:finalCycle?.canonicalB ?? null });
    return current;
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
    return exerciseFinalShelfFiveCycle(label, stable);
  };
  const verifyMatrixPhysicalSelectionRoundTrip = async (label, identity) => {
    const addressOf = state => {
      const cell = state?.stats?.selectedCell ?? null;
      return { lane:Number.isFinite(Number(cell?.lane)) ? Number(cell.lane) : null,
        row:Number.isFinite(Number(cell?.row)) ? Number(cell.row) : null,
        entry:cell?.foobarEntryKey ?? state?.selectedEntryKey ?? null };
    };
    const sourceCapture = await captureStaticCameraEndpoint(`${label} MATRIX source`, 'array', identity);
    const beforeState = sourceCapture.state;
    const sourceCamera = recordLegacyMatrixCamera(`${label} MATRIX source`, beforeState, sourceCapture.settled);
    const before = addressOf(beforeState);
    const validBefore = Number.isInteger(before.lane) && Number.isInteger(before.row) && before.entry === identity.selectedEntryKey;
    const canonicalShelf = fixtureMatrixShelves.findIndex(shelf => shelf.includes(before.entry));
    const canonicalSlot = canonicalShelf >= 0 ? fixtureMatrixShelves[canonicalShelf].indexOf(before.entry) : -1;
    const canonicalA = { lane:canonicalShelf, row:canonicalSlot >= 0 ? 12 + canonicalSlot : null, entry:before.entry };
    await transitionTo(label, 'shelf', identity);
    const arrayCapture = await captureStaticCameraEndpoint(`${label} ARRAY after MATRIX`, 'shelf', identity);
    const arrayEndpoint = arrayCapture.state;
    const arrayAddress = addressOf(arrayEndpoint);
    const arrayIsCanonical = canonicalShelf >= 0 && arrayAddress.lane === canonicalA.lane &&
      arrayAddress.row === canonicalA.row && arrayAddress.entry === canonicalA.entry;
    await transitionTo(label, 'array', identity);
    const matrixCapture = await captureStaticCameraEndpoint(`${label} MATRIX after ARRAY`, 'array', identity);
    const matrixEndpoint = matrixCapture.state;
    const matrixCamera = recordLegacyMatrixCamera(`${label} MATRIX after ARRAY`, matrixEndpoint, matrixCapture.settled);
    const mToAToMBridge = recordCameraEndpointBridge(`${label} M→A→M`, beforeState, matrixEndpoint, 'array', 'array');
    const after = addressOf(matrixEndpoint);
    const beforeIsNonCanonical = validBefore && canonicalShelf === fixtureMatrixShelves.length - 1 &&
      Number.isInteger(canonicalA.row) && before.row !== canonicalA.row;
    const restored = beforeIsNonCanonical && arrayIsCanonical && matrixEndpoint.viewLayout === 'array' && identityMatches(matrixEndpoint, identity) &&
      before.lane === after.lane && before.row === after.row && before.entry === after.entry;
    record(`${label} fresh MATRIX to ARRAY to MATRIX round trip restores the dragged physical selection address`, restored,
      { canonicalM:before, canonicalA:arrayAddress, canonicalB:after, beforeIsNonCanonical,
        arrayIsCanonical, identity,
        arrayLayout:arrayEndpoint.viewLayout, matrixLayout:matrixEndpoint.viewLayout });
    await transitionTo(label, 'shelf', identity);
    const arrayAgainCapture = await captureStaticCameraEndpoint(`${label} ARRAY after MATRIX round trip`, 'shelf', identity);
    const aToMToABridge = recordCameraEndpointBridge(`${label} A→M→A`, arrayEndpoint, arrayAgainCapture.state, 'shelf', 'shelf');
    await transitionTo(label, 'array', identity);
    const finalMatrixCapture = await captureStaticCameraEndpoint(`${label} final MATRIX endpoint`, 'array', identity);
    const finalMatrixCamera = recordLegacyMatrixCamera(`${label} final MATRIX endpoint`, finalMatrixCapture.state,
      finalMatrixCapture.settled);
    const finalMBridge = recordCameraEndpointBridge(`${label} repeated MATRIX endpoint`, matrixEndpoint,
      finalMatrixCapture.state, 'array', 'array');
    record(`${label} M↔A camera sequence preserves both original static endpoints`,
      sourceCamera.ok && matrixCamera.ok && finalMatrixCamera.ok && mToAToMBridge.ok && aToMToABridge.ok &&
      finalMBridge.ok && identityMatches(arrayAgainCapture.state, identity) && identityMatches(finalMatrixCapture.state, identity),
    { mToAToMBridge, aToMToABridge, finalMBridge,
      finalM:finalMatrixCamera.expected, finalMErrors:finalMatrixCamera.errors,
      arrayEndpoint:cameraPose(arrayEndpoint), arrayAgain:cameraPose(arrayAgainCapture.state) });
    return finalMatrixCapture.state;
  };
  const verifyArrayScaleCameraIsolation = async (label, identity) => {
    const sourceM = await captureStaticCameraEndpoint(`${label} ARRAY scale source MATRIX`, 'array', identity);
    const sourceMatrixAudit = recordLegacyMatrixCamera(`${label} ARRAY scale source MATRIX`, sourceM.state, sourceM.settled);
    const originalScale = Number(sourceM.state.styleArrayScale);
    if (!Number.isFinite(originalScale) || originalScale <= 0) {
      record(`${label} ARRAY scale probe has a readable original scale`, false,
        { styleArrayScale:sourceM.state.styleArrayScale });
      return sourceM.state;
    }
    await transitionTo(label, 'shelf', identity);
    const sourceA = await captureStaticCameraEndpoint(`${label} ARRAY scale source ARRAY`, 'shelf', identity);
    await transitionTo(label, 'array', identity);
    const matrixBeforeChange = await captureStaticCameraEndpoint(`${label} ARRAY scale MATRIX before change`, 'array', identity);
    const beforeChangeBridge = recordCameraEndpointBridge(`${label} ARRAY scale setup M→A→M`, sourceM.state,
      matrixBeforeChange.state, 'array', 'array');
    let scaleChangeAttempted = false;
    let failure = null;
    let finalMatrixState = matrixBeforeChange.state;
    try {
      scaleChangeAttempted = true;
      const change = await setArrayScaleFromStylePage(null);
      if (!change.changed) {
        scaleChangeAttempted = false;
        record(`${label} ARRAY scale isolation probe has an alternate ARRAY size`, true,
          { skipped:true, reason:'the STYLE control has no alternate numeric scale', originalScale, options:change.options });
      } else {
        const changedScale = Number(change.value);
        const matrixAfterChange = await captureStaticCameraEndpoint(`${label} MATRIX after ARRAY scale change`, 'array', identity);
        const matrixAfterAudit = recordLegacyMatrixCamera(`${label} MATRIX after ARRAY scale change`,
          matrixAfterChange.state, matrixAfterChange.settled);
        const matrixBridge = recordCameraEndpointBridge(`${label} MATRIX ignores ARRAY scale`, matrixBeforeChange.state,
          matrixAfterChange.state, 'array', 'array');
        await transitionTo(label, 'shelf', identity);
        const arrayAfterChange = await captureStaticCameraEndpoint(`${label} ARRAY after ARRAY scale change`, 'shelf', identity);
        const beforeArrayPose = cameraPose(sourceA.state), afterArrayPose = cameraPose(arrayAfterChange.state);
        const expectedSpanRatio = originalScale / changedScale;
        const actualSpanRatio = beforeArrayPose && afterArrayPose ? afterArrayPose.span / beforeArrayPose.span : NaN;
        const arrayScaleEffect = { originalScale, changedScale, expectedSpanRatio, actualSpanRatio,
          yawDelta:beforeArrayPose && afterArrayPose ? angleDelta(beforeArrayPose.yaw, afterArrayPose.yaw) : null,
          elevationDelta:beforeArrayPose && afterArrayPose ? Math.abs(beforeArrayPose.elevation - afterArrayPose.elevation) : null,
          distanceDelta:beforeArrayPose && afterArrayPose ? Math.abs(beforeArrayPose.distance - afterArrayPose.distance) : null,
          aimDelta:beforeArrayPose && afterArrayPose ? length3(subtract3(beforeArrayPose.aim, afterArrayPose.aim)) : null };
        const arrayScaleEffectOkay = Number.isFinite(actualSpanRatio) && Math.abs(expectedSpanRatio - 1) >= .04 &&
          Math.abs(actualSpanRatio - expectedSpanRatio) <= .035 && arrayScaleEffect.yawDelta <= .2 &&
          arrayScaleEffect.elevationDelta <= .2 && arrayScaleEffect.distanceDelta <= .25;
        record(`${label} ARRAY scale changes only ARRAY framing while MATRIX stays on the e6 camera`,
          sourceMatrixAudit.ok && matrixAfterAudit.ok && matrixBridge.ok && beforeChangeBridge.ok && arrayScaleEffectOkay,
        { sourceMatrixAudit, matrixAfterAudit, matrixBridge, beforeChangeBridge, arrayScaleEffect });
      }
    } catch (error) {
      failure = error;
    } finally {
      if (scaleChangeAttempted) {
        try {
          const restoredScale = await setArrayScaleFromStylePage(originalScale);
          const restoreState = restoredScale.archive;
          const restoreValue = Number(restoreState.styleArrayScale);
          const restoredA = await captureStaticCameraEndpoint(`${label} ARRAY scale restored ARRAY`, 'shelf', identity);
          const restoredABridge = recordCameraEndpointBridge(`${label} ARRAY scale restores ARRAY endpoint`,
            sourceA.state, restoredA.state, 'shelf', 'shelf');
          record(`${label} ARRAY scale probe restores its original setting`,
            Math.abs(restoreValue - originalScale) <= 1e-8 && restoredABridge.ok && identityMatches(restoredA.state, identity),
          { originalScale, restoreValue, restoredABridge });
        } catch (error) {
          failure ??= error;
          record(`${label} ARRAY scale probe restores its original setting`, false,
            { originalScale, restoreError:String(error?.message ?? error) });
        }
      }
      try {
        const current = await snapshot();
        if (current.viewLayout !== 'array' && current.page === 'music') await transitionTo(label, 'array', identity);
        const restoredM = await captureStaticCameraEndpoint(`${label} ARRAY scale restored MATRIX`, 'array', identity);
        const restoredAudit = recordLegacyMatrixCamera(`${label} ARRAY scale restored MATRIX`, restoredM.state, restoredM.settled);
        const restoredBridge = recordCameraEndpointBridge(`${label} ARRAY scale leaves MATRIX at its endpoint`,
          sourceM.state, restoredM.state, 'array', 'array');
        record(`${label} ARRAY scale probe ends in the original MATRIX endpoint`,
          restoredAudit.ok && restoredBridge.ok && identityMatches(restoredM.state, identity),
        { restoredAudit, restoredBridge, priorFailure:failure ? String(failure?.message ?? failure) : null });
        finalMatrixState = restoredM.state;
      } catch (error) {
        failure ??= error;
        record(`${label} ARRAY scale probe ends in the original MATRIX endpoint`, false,
          { finalError:String(error?.message ?? error), priorFailure:failure ? String(failure?.message ?? failure) : null });
      }
    }
    if (failure) throw failure;
    return finalMatrixState;
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
    const initialGeometry = await geometrySnapshot();
    record('production renderer uses the isolated 45 album fixture with 7/28/10 genre groups',
      probeReport.syntheticArchiveMotionFixture === true && probeReport.syntheticArchiveMotionAlbumCount === 45 &&
      probeReport.syntheticArchiveMotionGenreCounts?.join(',') === '7,28,10' &&
      fixtureMatrixShelves.map(shelf => shelf.length).join(',') === '20,20,5' &&
      probeReport.syntheticArchiveMotionFixtureHiRes?.albumId === 'fixture-album-01' &&
      probeReport.syntheticArchiveMotionFixtureHiRes?.trackCount === 3 &&
      probeReport.syntheticArchiveMotionFixtureHiRes?.qualifyingTrackCount === 3 && Number(initial.stats?.hiRes?.albums) >= 1 &&
      initial.stats?.caseStructure === 'rhine' &&
      initialGeometry.stats?.archiveBadge?.visible === true &&
      (Number(initialGeometry.stats?.archiveBadge?.hiResSlots) > 0 ||
        initial.selectedAlbumId === probeReport.syntheticArchiveMotionFixtureHiRes.albumId && initial.stats?.hiRes?.selected === true) &&
      probeReport.archiveMotionUsesOnlyPngCovers === true,
      { syntheticFixture:probeReport.syntheticArchiveMotionFixture, albumCount:probeReport.syntheticArchiveMotionAlbumCount,
        genreCounts:probeReport.syntheticArchiveMotionGenreCounts, canonicalShelfCounts:fixtureMatrixShelves.map(shelf => shelf.length),
        pngCovers:probeReport.archiveMotionUsesOnlyPngCovers, hiResFixture:probeReport.syntheticArchiveMotionFixtureHiRes,
        rendererHiResAlbumCount:initial.stats?.hiRes?.albums ?? null,
        caseStructure:initial.stats?.caseStructure ?? null, archiveBadge:initialGeometry.stats?.archiveBadge ?? null });

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
    const stableBeforeFirstTransition = await waitFor(state => identityMatches(state, identity) &&
      Number(state.stats?.returningFiles) === 0 && state.stats?.selectionPhase === 'settled',
    'long-group source settles after selection return before the first layout transition', 10000, 40);
    record('long-group source has no returning files and settled selection before the first transition',
      identityMatches(stableBeforeFirstTransition, identity) && Number(stableBeforeFirstTransition.stats?.returningFiles) === 0 &&
      stableBeforeFirstTransition.stats?.selectionPhase === 'settled',
    { returningFiles:stableBeforeFirstTransition.stats?.returningFiles,
      selectionPhase:stableBeforeFirstTransition.stats?.selectionPhase, state:shortState(stableBeforeFirstTransition) });

    selected = await selectFixtureAlbumInFirstArrayLane('fixture-album-02', 'Future multi-column flight');
    identity = { selectedAlbumId:selected.selectedAlbumId, selectedEntryKey:selected.selectedEntryKey };
    record('Future multi-column flight selects a non-first item in the first ARRAY lane',
      identity.selectedAlbumId === 'fixture-album-02' && identity.selectedAlbumId === selected.selectedAlbumFromApp &&
      !!identity.selectedEntryKey && Number(selected.stats?.returningFiles) === 0 && selected.stats?.selectionPhase === 'settled',
    { identity, selectedCell:selected.stats?.selectedCell, returningFiles:selected.stats?.returningFiles,
      selectionPhase:selected.stats?.selectionPhase, state:shortState(selected) });
    await exerciseLayoutTransitions('Future', identity);
    await takeScreenshot('future-array-overview');
    await transitionTo('Future', 'array', identity);
    await takeScreenshot('future-matrix-overview');
    const futureMatrixEnd = await exerciseMatrixInteraction('Future');
    identity = { selectedAlbumId:futureMatrixEnd.selectedAlbumId, selectedEntryKey:futureMatrixEnd.selectedEntryKey };
    record('Future MATRIX drag leaves a stable catalog identity for later theme transitions',
      !!identity.selectedAlbumId && !!identity.selectedEntryKey && futureMatrixEnd.selectedAlbumId === futureMatrixEnd.selectedAlbumFromApp,
      identity);
    const futureMatrixRoundTrip = await verifyMatrixPhysicalSelectionRoundTrip('Future', identity);
    identity = { selectedAlbumId:futureMatrixRoundTrip.selectedAlbumId, selectedEntryKey:futureMatrixRoundTrip.selectedEntryKey };

    const futureThemeEndpoint = await captureStaticCameraEndpoint('Future before Punk theme switch', 'array', identity);
    const futureThemeCamera = recordLegacyMatrixCamera('Future before Punk theme switch', futureThemeEndpoint.state,
      futureThemeEndpoint.settled);
    let punk = await withReducedMotionEndpointProbe(async () => {
      const switched = await switchDesign('archive');
      const punkThemeEndpoint = await captureStaticCameraEndpoint('Punk after Future theme switch', 'array', identity);
      const punkThemeCamera = recordLegacyMatrixCamera('Punk after Future theme switch', punkThemeEndpoint.state,
        punkThemeEndpoint.settled);
      const themeBridge = recordCameraEndpointBridge('Future→Punk M theme switch', futureThemeEndpoint.state,
        punkThemeEndpoint.state, 'array', 'array', true);
      record('Future to Punk theme switch keeps the e6 MATRIX camera contract',
        futureThemeCamera.ok && punkThemeCamera.ok && themeBridge.ok && switched.selectedAlbumId === identity.selectedAlbumId,
      { futureThemeCamera, punkThemeCamera, themeBridge, switched:shortState(switched) });
      return punkThemeEndpoint.state;
    });
    record('theme switch preserves the selected album', punk.selectedAlbumId === identity.selectedAlbumId,
      { selectedAlbumId:punk.selectedAlbumId, expected:identity.selectedAlbumId });
    punk = await selectFixtureAlbumInFirstArrayLane('fixture-album-02', 'Punk multi-column flight after MATRIX interaction');
    identity = { selectedAlbumId:punk.selectedAlbumId, selectedEntryKey:punk.selectedEntryKey };
    record('Punk multi-column flight returns to a non-first item in the first ARRAY lane',
      identity.selectedAlbumId === 'fixture-album-02' && identity.selectedAlbumId === punk.selectedAlbumFromApp &&
      !!identity.selectedEntryKey && Number(punk.stats?.returningFiles) === 0 && punk.stats?.selectionPhase === 'settled',
    { identity, selectedCell:punk.stats?.selectedCell, returningFiles:punk.stats?.returningFiles,
      selectionPhase:punk.stats?.selectionPhase, state:shortState(punk) });
    if (punk.viewLayout !== 'shelf') {
      const hover = await findHoverPoint('Punk hover alignment preflight');
      record('Punk MATRIX hover is active before the align phase', identityMatches(hover.state, identity) &&
        !!hover.state.stats?.matrixHover?.cell && Math.abs(Number(hover.state.stats.matrixHover.height) - .28) <= .025,
      { matrixHover:hover.state.stats?.matrixHover, projectedCenter:hover.state.stats?.projectedCenter });
      punk = await transitionTo('Punk', 'shelf', identity, { requireAlignment:true });
    }
    await exerciseLayoutTransitions('Punk', identity);
    const width = (await snapshot()).viewport?.width ?? 0;
    const expectedBleed = width <= 720 ? 0 : width <= 1100 ? 32 : 64;
    await verifyPunkChrome('punk-array-controls', expectedBleed);
    await verifyPunkNarrowWindow();
    await transitionTo('Punk', 'array', identity);
    await exercisePunkControls();
    await takeScreenshot('punk-matrix-controls');
    const punkMatrixEnd = await exerciseMatrixInteraction('Punk');
    identity = { selectedAlbumId:punkMatrixEnd.selectedAlbumId, selectedEntryKey:punkMatrixEnd.selectedEntryKey };
    const punkMatrixRoundTrip = await verifyMatrixPhysicalSelectionRoundTrip('Punk', identity);
    identity = { selectedAlbumId:punkMatrixRoundTrip.selectedAlbumId, selectedEntryKey:punkMatrixRoundTrip.selectedEntryKey };
    const punkArrayScaleEnd = await verifyArrayScaleCameraIsolation('Punk', identity);
    identity = { selectedAlbumId:punkArrayScaleEnd.selectedAlbumId, selectedEntryKey:punkArrayScaleEnd.selectedEntryKey };
    const punkSettings = await enterInterfaceSettings('Punk entry protection');
    record('Punk Future replay remains disabled', punkSettings.design === 'archive' &&
      punkSettings.entryReplayDisabled === true && punkSettings.entryOnOpenDisabled === true,
    { replayDisabled:punkSettings.entryReplayDisabled, automaticDisabled:punkSettings.entryOnOpenDisabled, text:punkSettings.entrySettingsText });
    await evaluate('(() => { document.querySelector("[data-action=entry-replay]")?.click(); return true; })()');
    const punkStillNoEntry = await snapshot();
    record('disabled Punk replay creates no Future overlay', !punkStillNoEntry.overlayPresent && punkStillNoEntry.entry?.active !== true,
      shortState(punkStillNoEntry));
    await leaveManagementPage('Punk entry protection');

    const punkBeforeFutureEndpoint = await captureStaticCameraEndpoint('Punk before Future theme switch', 'array', identity);
    const punkBeforeFutureCamera = recordLegacyMatrixCamera('Punk before Future theme switch', punkBeforeFutureEndpoint.state,
      punkBeforeFutureEndpoint.settled);
    let future = await withReducedMotionEndpointProbe(async () => {
      const switched = await switchDesign('rhine');
      const futureAfterPunkEndpoint = await captureStaticCameraEndpoint('Future after Punk theme switch', 'array', identity);
      const futureAfterPunkCamera = recordLegacyMatrixCamera('Future after Punk theme switch', futureAfterPunkEndpoint.state,
        futureAfterPunkEndpoint.settled);
      const themeBridge = recordCameraEndpointBridge('Punk→Future M theme switch', punkBeforeFutureEndpoint.state,
        futureAfterPunkEndpoint.state, 'array', 'array', true);
      record('Punk to Future theme switch keeps the e6 MATRIX camera contract',
        punkBeforeFutureCamera.ok && futureAfterPunkCamera.ok && themeBridge.ok &&
        switched.selectedAlbumId === identity.selectedAlbumId,
      { punkBeforeFutureCamera, futureAfterPunkCamera, themeBridge, switched:shortState(switched) });
      return futureAfterPunkEndpoint.state;
    });
    identity = { selectedAlbumId:future.selectedAlbumId, selectedEntryKey:future.selectedEntryKey };
    record('return to Future keeps a stable current catalog identity',
      !!identity.selectedAlbumId && !!identity.selectedEntryKey && future.selectedAlbumId === future.selectedAlbumFromApp,
      identity);
    if (future.viewLayout !== 'shelf') future = await transitionTo('Future', 'shelf', identity);
    future = await selectFixtureAlbumInFirstArrayLane('fixture-album-02', 'Future entry partial skip fixture');
    identity = { selectedAlbumId:future.selectedAlbumId, selectedEntryKey:future.selectedEntryKey };
    record('Future entry partial skip uses the first-lane case during its assembly window',
      identity.selectedAlbumId === 'fixture-album-02' && !!identity.selectedEntryKey &&
      future.viewLayout === 'shelf' && identity.selectedAlbumId === future.selectedAlbumFromApp,
    { identity, selectedCell:future.stats?.selectedCell, state:shortState(future) });
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
      matrixSlotAudits:result.matrixSlotAudits.length,
      extraRiseReversals:result.extraRiseReversals.length,
      retargets:result.retargets.length, qSampleMisses:result.qSampleMisses.length,
      geometryFrames:result.geometryFrames.length, legacyCameraAudits:result.legacyCameraAudits.length,
      cameraEndpointBridges:result.cameraEndpointBridges.length, entryPhaseSequence:observedEntryPhases,
      keyframeCount, naturalPlaybackSeconds,
      finalLayout:naturalEnd.viewLayout, selectedAlbumId:naturalEnd.selectedAlbumId };
    return result;
  } catch (error) {
    result.ok = false;
    result.error = String(error?.stack ?? error);
    result.summary = { ok:false, cases:result.cases.length, screenshots:result.screenshots.length,
      layoutTransitions:result.timeline.length, flightSamples:result.flightSamples.length,
      matrixSlotAudits:result.matrixSlotAudits.length,
      extraRiseReversals:result.extraRiseReversals.length,
      retargets:result.retargets.length, qSampleMisses:result.qSampleMisses.length,
      geometryFrames:result.geometryFrames.length, legacyCameraAudits:result.legacyCameraAudits.length,
      cameraEndpointBridges:result.cameraEndpointBridges.length };
    error.archiveMotionResult = result;
    throw error;
  } finally {
    try { wc.setBackgroundThrottling(originalBackgroundThrottling); } catch {}
  }
}
