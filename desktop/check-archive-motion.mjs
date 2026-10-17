import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkArchiveMotion({ browserWindow, outputDirectory, probeReport, getPreferences, getReadyCount }) {
  const wc = browserWindow.webContents;
  const screenshotDirectory = path.join(outputDirectory, 'archive-motion');
  const result = { ok: false, cases: [], assertions: {}, screenshots: [], timeline: [], transitionSamples: [], summary: {} };
  let transitionProbeStartedAt = 0;
  let transitionProbeContext = '';
  const originalBackgroundThrottling = wc.getBackgroundThrottling?.() ?? true;
  const stateScript = String.raw`(() => {
    const stage = document.querySelector('#stage');
    const app = window.rhineMusic;
    const stats = app?.stats?.() ?? null;
    const canvas = document.querySelector('#three-scene canvas');
    const info = document.querySelector('.foobar-home-info');
    const tools = document.querySelector('.foobar-catalog-tools');
    const workspace = document.querySelector('.foobar-workspace');
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
        cameraPosition:stats.cameraPosition ?? null,
        modelPosition:stats.modelPosition ?? null,
        layoutTransition:stats.layoutTransition ?? null,
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
      stats:stats ? { layoutTransition:stats.layoutTransition, cameraPosition:stats.cameraPosition,
        modelPosition:stats.modelPosition, musicPresentationPhase:stats.musicPresentationPhase } : null,
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
      if (transitionProbeStartedAt) result.transitionSamples.push({ context:transitionProbeContext,
        sinceClickMs:Date.now() - transitionProbeStartedAt, sampleMs:Date.now() - sampleStartedAt,
        active:latest.stats?.layoutTransition?.active ?? null,
        progress:latest.stats?.layoutTransition?.progress ?? null,
        layout:latest.viewLayout ?? null });
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
    transition:state.stats?.layoutTransition, matrixDrag:state.stats?.matrixDrag,
    matrixHover:state.stats?.matrixHover, entry:state.entry,
  });
  const takeScreenshot = async name => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await pause(100);
    const image = await browserWindow.capturePage();
    const file = path.join(screenshotDirectory, `${name}.png`);
    await fs.writeFile(file, image.toPNG());
    result.screenshots.push({ name, file, size:image.getSize() });
    process.stdout.write(`ARCHIVE_MOTION_SCREENSHOT:${file}\n`);
    return file;
  };
  const layoutSelector = layout => `.foobar-catalog-tools .foobar-tool-group[data-field="layout"] [data-music-layout="${layout}"], .foobar-catalog-tools .foobar-tool-group[data-field="layout"] [data-value="${layout}"], #music-browse [data-music-layout="${layout}"]`;
  const clickLayout = async layout => click(layoutSelector(layout));
  const identityMatches = (state, identity) => state.selectedAlbumId === identity.selectedAlbumId &&
    state.selectedEntryKey === identity.selectedEntryKey && !!state.selectedEntryKey;
  const vectorDistance = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length < 3 || right.length < 3) return Infinity;
    return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
  };
  const transitionTo = async (designLabel, target, identity, captureMidEnd = false) => {
    let current = await snapshot();
    if (current.viewLayout === target) return current;
    transitionProbeContext = `${designLabel} ${target}`;
    transitionProbeStartedAt = Date.now();
    await clickLayout(target);
    const active = await waitForFast(state => state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.progress) > 0.03 && state.viewLayout === target,
    `${designLabel} ${target} transition active`, 7000, 12);
    record(`${designLabel} ${target} has an active intermediate frame`,
      active.stats.layoutTransition.progress > 0 && active.stats.layoutTransition.progress < 1 && identityMatches(active, identity), shortState(active));
    const middle = await waitForFast(state => state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.progress) >= 0.32 && Number(state.stats.layoutTransition.progress) <= 0.88,
    `${designLabel} ${target} transition midpoint`, 7000, 12);
    record(`${designLabel} ${target} midpoint preserves selection identity`, identityMatches(middle, identity), shortState(middle));
    if (captureMidEnd) await takeScreenshot(`${designLabel.toLowerCase()}-${target}-transition-mid`);
    const end = await waitForFast(state => state.viewLayout === target && state.stats?.layoutTransition?.active === false,
      `${designLabel} ${target} endpoint`, 10000, 12);
    record(`${designLabel} ${target} reaches its endpoint with identity intact`, identityMatches(end, identity), shortState(end));
    if (captureMidEnd) await takeScreenshot(`${designLabel.toLowerCase()}-${target}-transition-end`);
    result.timeline.push({ design:designLabel, target, activeProgress:active.stats.layoutTransition.progress,
      middleProgress:middle.stats.layoutTransition.progress, endpoint:end.viewLayout,
      selectedAlbumId:end.selectedAlbumId, entryKey:end.selectedEntryKey });
    transitionProbeStartedAt = 0;
    transitionProbeContext = '';
    return end;
  };
  const exerciseLayoutTransitions = async (designLabel, identity) => {
    await transitionTo(designLabel, 'shelf', identity, designLabel === 'Future');
    await transitionTo(designLabel, 'array', identity, designLabel === 'Future');
    transitionProbeContext = `${designLabel} rapid forward`;
    transitionProbeStartedAt = Date.now();
    await clickLayout('shelf');
    const forward = await waitForFast(state => state.viewLayout === 'shelf' && state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.progress) > 0.12,
    `${designLabel} rapid-forward transition`, 7000, 12);
    record(`${designLabel} rapid-forward frame retains identity`, identityMatches(forward, identity), shortState(forward));
    transitionProbeContext = `${designLabel} rapid reverse`;
    transitionProbeStartedAt = Date.now();
    await clickLayout('array');
    const reverse = await waitForFast(state => state.viewLayout === 'array' && state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.progress) > 0.02,
    `${designLabel} rapid reverse transition`, 7000, 12);
    const cameraJump = vectorDistance(forward.stats.cameraPosition, reverse.stats.cameraPosition);
    const modelJump = vectorDistance(forward.stats.modelPosition, reverse.stats.modelPosition);
    record(`${designLabel} rapid reverse retargets without a camera snap`, cameraJump < 8 && modelJump < 8,
      { cameraJump, modelJump, from:forward.stats.layoutTransition, to:reverse.stats.layoutTransition });
    record(`${designLabel} rapid reverse preserves identity`, identityMatches(reverse, identity), shortState(reverse));
    const middle = await waitForFast(state => state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.progress) >= 0.3 && state.viewLayout === 'array',
    `${designLabel} rapid reverse midpoint`, 7000, 12);
    record(`${designLabel} rapid reverse has a visible intermediate frame`, middle.stats.layoutTransition.progress < 1 && identityMatches(middle, identity), shortState(middle));
    const end = await waitForFast(state => state.viewLayout === 'array' && state.stats?.layoutTransition?.active === false,
      `${designLabel} rapid reverse endpoint`, 10000, 12);
    record(`${designLabel} rapid reverse ends at MATRIX`, identityMatches(end, identity), shortState(end));
    result.timeline.push({ design:designLabel, target:'array', rapidReverse:true,
      activeProgress:reverse.stats.layoutTransition.progress, middleProgress:middle.stats.layoutTransition.progress,
      cameraJump, modelJump, endpoint:end.viewLayout });
    transitionProbeStartedAt = 0;
    transitionProbeContext = '';
    return end;
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
    const expected = Number.parseFloat(state.sceneBleed) || 0;
    const edgeDelta = state.toolsInfoEdgeDelta;
    const clipDelta = state.canvasVisibleRight !== null && state.infoRect ? state.canvasVisibleRight - state.infoRect.x : Infinity;
    const blendWidth = Number.parseFloat(state.blendWidth) || 0;
    if (state.viewport?.width > 720) record(`${name} Punk scene clip reaches the soft info transition`, expected === expectedBleed &&
      Math.abs(clipDelta - expectedBleed) <= 10,
      { sceneBleed:state.sceneBleed, expectedBleed, canvasVisibleRight:state.canvasVisibleRight, infoLeft:state.infoRect?.x, clipDelta, clipPath:state.canvasClipPath });
    else record(`${name} narrow Punk layout removes scene bleed`, expected === 0 && expectedBleed === 0,
      { sceneBleed:state.sceneBleed, expectedBleed });
    if (state.viewport?.width > 720) record(`${name} Punk top rail aligns with the info edge`, Math.abs(edgeDelta) <= 4,
      { toolsRight:state.toolsRect?.right, infoLeft:state.infoRect?.x, edgeDelta });
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
    record('production renderer uses the isolated 36 album library',
      probeReport.syntheticArchiveMotionFixture === true && probeReport.syntheticArchiveMotionAlbumCount === 36 &&
      probeReport.archiveMotionUsesOnlyPngCovers === true,
      { syntheticFixture:probeReport.syntheticArchiveMotionFixture, albumCount:probeReport.syntheticArchiveMotionAlbumCount,
        pngCovers:probeReport.archiveMotionUsesOnlyPngCovers });

    const firstAlbum = initial.selectedAlbumId;
    await click('.music-navigation [data-action="next"]');
    const selected = await waitFor(state => state.selectedAlbumId && state.selectedAlbumId !== firstAlbum && state.selectedEntryKey,
      'select a stable non-first fixture album', 10000, 35);
    let identity = { selectedAlbumId:selected.selectedAlbumId, selectedEntryKey:selected.selectedEntryKey };
    record('non-first album and catalog entry are selected before transition checks',
      identity.selectedAlbumId === selected.selectedAlbumFromApp && !!identity.selectedEntryKey,
      { ...identity, selectedAlbumFromApp:selected.selectedAlbumFromApp });

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
    const skippedEntry = await replayFutureArrayEntry('manual skip');
    await waitFor(state => state.entry?.active === true && Number(state.entry.time) >= 3.76,
      'Future ARRAY entry has played for about two seconds', 10000, 35);
    await takeScreenshot('future-array-entry-skip-point');
    await click('.future-entry-skip');
    const skipped = await waitFor(state => state.entry?.active === false && !state.overlayPresent &&
      state.viewLayout === 'shelf' && state.page === 'music' && state.mode === 'archive' && state.detailHidden === true,
    'Future ARRAY entry skip returns to overview', 10000, 35);
    record('manual skip returns to Future ARRAY overview', skipped.viewLayout === 'shelf' &&
      skipped.presentation?.phase === 'archive' && skipped.detailHidden === true && getPreferences()?.entryOnOpen === false,
    { state:shortState(skipped), entryOnOpen:getPreferences()?.entryOnOpen, start:shortState(skippedEntry) });

    const naturalEntry = await replayFutureArrayEntry('natural replay');
    record('manual replay starts the Future ARRAY layout', naturalEntry.entry?.layout === 'shelf' || naturalEntry.viewLayout === 'shelf',
      { entryLayout:naturalEntry.entry?.layout, viewLayout:naturalEntry.viewLayout });
    let lastEntryTime = Number(naturalEntry.entry?.time) || 1.76;
    let nextCaptureAt = 22.15;
    let tailCaptureCount = 0;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 40000) {
      const timeToCaptureMs = Math.max(5000, Math.min(30000, (nextCaptureAt - lastEntryTime + 3) * 1000));
      const state = await waitFor(value => !value.entry?.active || Number(value.entry?.time) >= nextCaptureAt,
        `Future ARRAY entry reaches ${nextCaptureAt.toFixed(2)}s or ends`, timeToCaptureMs, 60);
      if (!state.entry?.active) { lastEntryTime = Math.max(lastEntryTime, Number(state.entry?.time) || lastEntryTime); break; }
      lastEntryTime = Math.max(lastEntryTime, Number(state.entry.time) || 0);
      const shot = `future-array-entry-${String(Math.floor(nextCaptureAt)).padStart(2,'0')}-${String(Math.round((nextCaptureAt % 1) * 10)).padStart(1,'0')}`;
      await takeScreenshot(shot);
      tailCaptureCount++;
      nextCaptureAt += 0.9;
    }
    const naturalEnd = await waitFor(state => state.entry?.active === false && !state.overlayPresent &&
      state.viewLayout === 'shelf' && state.page === 'music' && state.mode === 'archive',
    'natural Future ARRAY entry completion', 10000, 40);
    const naturalPlaybackSeconds = (Date.now() - startedAt) / 1000;
    await takeScreenshot('future-array-entry-final-overview');
    record('Future ARRAY intro completes naturally after the original prelude and tail',
      tailCaptureCount >= 3 && naturalPlaybackSeconds >= 23 && naturalPlaybackSeconds <= 40 &&
      naturalEnd.viewLayout === 'shelf' && naturalEnd.presentation?.phase === 'archive' && naturalEnd.detailHidden === true,
    { tailCaptureCount, playbackSeconds:naturalPlaybackSeconds, lastEntryTime, state:shortState(naturalEnd) });
    record('entry replay leaves automatic entry off and does not open an album',
      getPreferences()?.entryOnOpen === false && naturalEnd.viewLayout === 'shelf' &&
      naturalEnd.detailHidden === true && naturalEnd.presentation?.phase === 'archive',
    { entryOnOpen:getPreferences()?.entryOnOpen, state:shortState(naturalEnd) });

    result.ok = Object.values(result.assertions).every(Boolean);
    result.summary = { ok:result.ok, cases:result.cases.length, screenshots:result.screenshots.length,
      layoutTransitions:result.timeline.length, tailCaptureCount, naturalPlaybackSeconds,
      finalLayout:naturalEnd.viewLayout, selectedAlbumId:naturalEnd.selectedAlbumId };
    return result;
  } catch (error) {
    result.ok = false;
    result.error = String(error?.stack ?? error);
    result.summary = { ok:false, cases:result.cases.length, screenshots:result.screenshots.length,
      layoutTransitions:result.timeline.length };
    error.archiveMotionResult = result;
    throw error;
  } finally {
    try { wc.setBackgroundThrottling(originalBackgroundThrottling); } catch {}
  }
}
