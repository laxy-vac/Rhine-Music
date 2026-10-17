import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkArchiveMotion({ browserWindow, outputDirectory, probeReport, getPreferences, getReadyCount }) {
  const wc = browserWindow.webContents;
  const screenshotDirectory = path.join(outputDirectory, 'archive-motion');
  const result = { ok: false, cases: [], assertions: {}, screenshots: [], timeline: [], transitionSamples: [], entryTimeline: [], summary: {} };
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
        cameraPosition:stats.cameraPosition ?? null,
        modelPosition:stats.modelPosition ?? null,
        layoutTransition:stats.layoutTransition ?? null,
        shelfEntry:stats.shelfEntry ?? null,
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
        musicPresentationPhase:stats.musicPresentationPhase } : null,
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
      if (transitionProbeStartedAt) {
        const transition = latest.stats?.layoutTransition ?? {};
        result.transitionSamples.push({ context:transitionProbeContext,
          sinceClickMs:Date.now() - transitionProbeStartedAt, sampleMs:Date.now() - sampleStartedAt,
          active:transition.active ?? null, progress:transition.progress ?? null,
          phase:transition.phase ?? null,
          outgoing:transition.outgoing ?? null, incoming:transition.incoming ?? null,
          snapshotRevision:transition.snapshotRevision ?? null, layout:latest.viewLayout ?? null });
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
  const takeScreenshot = async (name, details = null, settleMs = 100) => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    if (settleMs > 0) await pause(settleMs);
    const image = await browserWindow.capturePage();
    const file = path.join(screenshotDirectory, `${name}.png`);
    await fs.writeFile(file, image.toPNG());
    result.screenshots.push({ name, file, size:image.getSize(), ...(details === null ? {} : { details }) });
    process.stdout.write(`ARCHIVE_MOTION_SCREENSHOT:${file}\n`);
    return file;
  };
  const layoutSelector = layout => `.foobar-catalog-tools .foobar-tool-group[data-field="layout"] [data-music-layout="${layout}"], .foobar-catalog-tools .foobar-tool-group[data-field="layout"] [data-value="${layout}"], #music-browse [data-music-layout="${layout}"]`;
  const clickLayout = async layout => click(layoutSelector(layout));
  const identityMatches = (state, identity) => state.selectedAlbumId === identity.selectedAlbumId &&
    state.selectedEntryKey === identity.selectedEntryKey && !!state.selectedEntryKey;
  const auditTransition = context => {
    const samples = result.transitionSamples.filter(sample => sample.context === context && sample.active === true &&
      Number.isFinite(sample.progress));
    const phaseSequence = [];
    let previousPhase = null;
    let phaseBoundaryErrorCount = 0;
    let doubleExposureCount = 0;
    let invalidWeightCount = 0;
    let releaseMonotonicErrorCount = 0;
    let resolveMonotonicErrorCount = 0;
    let previousReleaseOutgoing = null;
    let previousResolveIncoming = null;
    for (const sample of samples) {
      const progress = sample.progress;
      if (sample.phase !== previousPhase) phaseSequence.push(sample.phase);
      previousPhase = sample.phase;
      const outgoing = sample.outgoing, incoming = sample.incoming;
      if (!Number.isFinite(outgoing) || !Number.isFinite(incoming) || outgoing < -0.002 || outgoing > 1.002 ||
          incoming < -0.002 || incoming > 1.002) invalidWeightCount++;
      if (outgoing > 0.002 && incoming > 0.002) doubleExposureCount++;
      if ((sample.phase === 'release' && progress >= 0.34) || (sample.phase === 'resolve' && progress < 0.34)) phaseBoundaryErrorCount++;
      if (sample.phase === 'release') {
        if (previousReleaseOutgoing !== null && outgoing > previousReleaseOutgoing + 0.01) releaseMonotonicErrorCount++;
        previousReleaseOutgoing = outgoing;
      }
      if (sample.phase === 'resolve') {
        if (previousResolveIncoming !== null && incoming < previousResolveIncoming - 0.01) resolveMonotonicErrorCount++;
        previousResolveIncoming = incoming;
      }
    }
    return {
      sampleCount:samples.length, phaseSequence,
      phaseOrderOkay:phaseSequence[0] === 'release' && phaseSequence.includes('resolve') &&
        phaseSequence.indexOf('release') < phaseSequence.indexOf('resolve'),
      phaseBoundaryErrorCount, doubleExposureCount, invalidWeightCount,
      releaseMonotonicErrorCount, resolveMonotonicErrorCount,
      snapshotRevisions:[...new Set(samples.map(sample => sample.snapshotRevision).filter(Number.isInteger))],
    };
  };
  const transitionTo = async (designLabel, target, identity, captureMidEnd = false) => {
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
      state.stats.layoutTransition.phase === 'release' && Number(state.stats.layoutTransition.progress) >= 0.08,
    `${designLabel} ${target} release phase`, 7000, 12);
    record(`${designLabel} ${target} release frame preserves selection identity`, identityMatches(release, identity), shortState(release));
    if (captureMidEnd) await takeScreenshot(`${designLabel.toLowerCase()}-${target}-transition-release`, {
      progress:release.stats.layoutTransition.progress, phase:release.stats.layoutTransition.phase,
      snapshotRevision:release.stats.layoutTransition.snapshotRevision,
    });
    const resolve = await waitForFast(state => state.stats?.layoutTransition?.active === true &&
      state.stats.layoutTransition.phase === 'resolve' && Number(state.stats.layoutTransition.progress) > 0.6,
    `${designLabel} ${target} resolve phase above 0.6`, 7000, 12);
    record(`${designLabel} ${target} resolve frame preserves selection identity`, identityMatches(resolve, identity), shortState(resolve));
    if (captureMidEnd) await takeScreenshot(`${designLabel.toLowerCase()}-${target}-transition-resolve`, {
      progress:resolve.stats.layoutTransition.progress, phase:resolve.stats.layoutTransition.phase,
      snapshotRevision:resolve.stats.layoutTransition.snapshotRevision,
    });
    const end = await waitForFast(state => state.viewLayout === target && state.stats?.layoutTransition?.active === false,
      `${designLabel} ${target} endpoint`, 10000, 12);
    record(`${designLabel} ${target} reaches its endpoint with identity intact`, identityMatches(end, identity), shortState(end));
    if (captureMidEnd) await takeScreenshot(`${designLabel.toLowerCase()}-${target}-transition-end`);
    const audit = auditTransition(context);
    record(`${designLabel} ${target} transition reports release then resolve`, audit.phaseOrderOkay, audit);
    record(`${designLabel} ${target} curtain weights stay bounded and move in order`, audit.sampleCount > 0 &&
      audit.phaseBoundaryErrorCount === 0 && audit.doubleExposureCount === 0 && audit.invalidWeightCount === 0 &&
      audit.releaseMonotonicErrorCount === 0 && audit.resolveMonotonicErrorCount === 0, audit);
    record(`${designLabel} ${target} has a static target layout and identity after reveal`,
      end.viewLayout === target && end.stats?.layoutTransition?.active === false && identityMatches(end, identity), shortState(end));
    result.timeline.push({ design:designLabel, target, activeProgress:active.stats.layoutTransition.progress,
      releaseProgress:release.stats.layoutTransition.progress, resolveProgress:resolve.stats.layoutTransition.progress,
      phaseSequence:audit.phaseSequence,
      snapshotRevision:resolve.stats.layoutTransition.snapshotRevision, endpoint:end.viewLayout,
      selectedAlbumId:end.selectedAlbumId, entryKey:end.selectedEntryKey });
    transitionProbeStartedAt = 0;
    transitionProbeContext = '';
    return end;
  };
  const exerciseLayoutTransitions = async (designLabel, identity) => {
    await transitionTo(designLabel, 'shelf', identity, designLabel === 'Future');
    await transitionTo(designLabel, 'array', identity, designLabel === 'Future');
    const forwardContext = `${designLabel} rapid forward`;
    transitionProbeContext = forwardContext;
    transitionProbeStartedAt = Date.now();
    await clickLayout('shelf');
    const forward = await waitForFast(state => state.viewLayout === 'shelf' && state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.progress) > 0.12,
    `${designLabel} rapid-forward transition`, 7000, 12);
    record(`${designLabel} rapid-forward frame retains identity`, identityMatches(forward, identity), shortState(forward));
    const reverseContext = `${designLabel} rapid reverse`;
    transitionProbeContext = reverseContext;
    transitionProbeStartedAt = Date.now();
    await clickLayout('array');
    const reverse = await waitForFast(state => state.viewLayout === 'array' && state.stats?.layoutTransition?.active === true &&
      Number(state.stats.layoutTransition.progress) > 0.02,
    `${designLabel} rapid reverse transition`, 7000, 12);
    const forwardRevision = forward.stats.layoutTransition.snapshotRevision;
    const reverseRevision = reverse.stats.layoutTransition.snapshotRevision;
    record(`${designLabel} rapid reverse retains the prior composed snapshot`, Number.isInteger(forwardRevision) &&
      Number.isInteger(reverseRevision) && reverseRevision > forwardRevision,
    { forwardRevision, reverseRevision, from:forward.stats.layoutTransition, to:reverse.stats.layoutTransition });
    record(`${designLabel} rapid reverse preserves identity`, identityMatches(reverse, identity), shortState(reverse));
    const resolve = await waitForFast(state => state.stats?.layoutTransition?.active === true &&
      state.stats.layoutTransition.phase === 'resolve' && Number(state.stats.layoutTransition.progress) > 0.6 &&
      state.viewLayout === 'array', `${designLabel} rapid reverse resolve phase`, 7000, 12);
    record(`${designLabel} rapid reverse reaches its reveal phase with identity intact`,
      identityMatches(resolve, identity), shortState(resolve));
    const end = await waitForFast(state => state.viewLayout === 'array' && state.stats?.layoutTransition?.active === false,
      `${designLabel} rapid reverse endpoint`, 10000, 12);
    record(`${designLabel} rapid reverse ends at a static MATRIX layout`, identityMatches(end, identity) &&
      end.stats?.layoutTransition?.active === false, shortState(end));
    const audit = auditTransition(reverseContext);
    record(`${designLabel} rapid reverse reports release then resolve`, audit.phaseOrderOkay, audit);
    record(`${designLabel} rapid reverse keeps one curtain image visible at a time`,
      audit.sampleCount > 0 && audit.phaseBoundaryErrorCount === 0 && audit.doubleExposureCount === 0 &&
      audit.invalidWeightCount === 0 && audit.releaseMonotonicErrorCount === 0 && audit.resolveMonotonicErrorCount === 0, audit);
    result.timeline.push({ design:designLabel, target:'array', rapidReverse:true,
      activeProgress:reverse.stats.layoutTransition.progress, resolveProgress:resolve.stats.layoutTransition.progress,
      phaseSequence:audit.phaseSequence, snapshotRevisionFrom:forwardRevision,
      snapshotRevisionTo:reverseRevision, endpoint:end.viewLayout });
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
    hiddenCases:state.stats?.shelfEntry?.hiddenCases ?? null,
    baseCaptured:state.stats?.shelfEntry?.baseCaptured ?? null,
  });
  const recordEntryState = (state, force = false) => {
    const stamp = entryStamp(state);
    const key = [stamp.active, stamp.entryPhase, stamp.shelfPhase, stamp.hiddenCases, stamp.baseCaptured].join('|');
    if (force || key !== lastEntryTimelineKey) result.entryTimeline.push(stamp);
    lastEntryTimelineKey = key;
    return stamp;
  };
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
    const skippedEntry = await replayFutureArrayEntry('manual skip');
    const skipFrame = await waitForFast(state => state.entry?.active === true && Number(state.entry.time) >= 22.15,
      'Future ARRAY structure phase before manual skip', 30000, 12);
    record('manual skip is available while shelf structure is assembled',
      skipFrame.entry.phase === 'shelf-structure' && Number(skipFrame.entry.time) <= 22.7,
      { time:skipFrame.entry.time, entryPhase:skipFrame.entry.phase, shelfEntry:skipFrame.stats?.shelfEntry });
    await click('.future-entry-skip');
    const skipped = await waitFor(state => state.entry?.active === false && !state.overlayPresent &&
      state.viewLayout === 'shelf' && state.page === 'music' && state.mode === 'archive' && state.detailHidden === true &&
      state.stats?.shelfEntry?.hiddenCases === 0 && state.stats?.shelfEntry?.phase == null,
    'Future ARRAY entry skip returns to overview', 10000, 35);
    record('manual skip returns to Future ARRAY overview', skipped.viewLayout === 'shelf' &&
      skipped.presentation?.phase === 'archive' && skipped.detailHidden === true && getPreferences()?.entryOnOpen === false,
    { state:shortState(skipped), entryOnOpen:getPreferences()?.entryOnOpen, start:shortState(skippedEntry) });
    record('manual skip clears hidden rack cases and restores the static shelf',
      skipped.stats?.shelfEntry?.hiddenCases === 0 && skipped.stats?.shelfEntry?.phase == null,
      { shelfEntry:skipped.stats?.shelfEntry });

    const naturalEntry = await replayFutureArrayEntry('natural replay');
    record('manual replay starts the Future ARRAY layout', naturalEntry.entry?.layout === 'shelf' || naturalEntry.viewLayout === 'shelf',
      { entryLayout:naturalEntry.entry?.layout, viewLayout:naturalEntry.viewLayout });
    const startedAt = Date.now();
    entryTimelineStartedAt = Date.now();
    lastEntryTimelineKey = '';
    recordEntryState(naturalEntry, true);
    const keyframeTimes = [22.35,22.7,23.15,23.75,24.2,25.3,25.9];
    let keyframeCount = 0;
    for (const targetTime of keyframeTimes) {
      const beforeCapture = await sampleEntryUntil(Math.max(0, targetTime - 0.12),
        `key frame ${targetTime.toFixed(2)}s`);
      const beforeStamp = recordEntryState(beforeCapture, true);
      const name = `future-array-entry-${targetTime.toFixed(2).replace('.', '-')}`;
      await takeScreenshot(name, { requestedEntryTime:targetTime, beforeCapture:beforeStamp }, 0);
      keyframeCount++;
      const afterCapture = await fastSnapshot();
      if (!afterCapture.sampleError) {
        const afterStamp = recordEntryState(afterCapture, true);
        result.screenshots.at(-1).details.afterCapture = afterStamp;
      }
    }
    const naturalEnd = await waitFor(state => state.entry?.active === false && !state.overlayPresent &&
      state.viewLayout === 'shelf' && state.page === 'music' && state.mode === 'archive' &&
      state.stats?.layoutTransition?.active === false && state.stats?.shelfEntry?.hiddenCases === 0 &&
      state.stats?.shelfEntry?.phase == null,
    'natural Future ARRAY entry completion', 10000, 40);
    const naturalPlaybackSeconds = (Date.now() - startedAt) / 1000;
    recordEntryState(naturalEnd, true);
    await takeScreenshot('future-array-entry-final-overview');
    const expectedEntryPhases = ['shelf-structure','shelf-catalog','shelf-ready','settle'];
    const observedEntryPhases = [];
    for (const sample of result.entryTimeline) {
      if (sample.entryPhase && sample.entryPhase !== observedEntryPhases.at(-1)) observedEntryPhases.push(sample.entryPhase);
    }
    const phaseStarts = Object.fromEntries(expectedEntryPhases.map(phase => [phase,
      result.entryTimeline.find(sample => sample.entryPhase === phase)?.entryTime ?? null]));
    const phaseOrderOkay = expectedEntryPhases.every((phase, index) => observedEntryPhases.indexOf(phase) >= 0 &&
      (index === 0 || observedEntryPhases.indexOf(phase) > observedEntryPhases.indexOf(expectedEntryPhases[index - 1])));
    // Screenshots block sampling for several frames. First observation is not
    // a phase boundary; exact boundaries are covered by the offline clock test.
    const phaseTimingOkay = expectedEntryPhases.every((phase, index) => Number.isFinite(phaseStarts[phase]) &&
      phaseStarts[phase] >= 21.9 && phaseStarts[phase] <= 26.3 &&
      (index === 0 || phaseStarts[phase] >= phaseStarts[expectedEntryPhases[index - 1]]));
    const structureSamples = result.entryTimeline.filter(sample => sample.entryPhase === 'shelf-structure');
    const catalogSamples = result.entryTimeline.filter(sample => sample.entryPhase === 'shelf-catalog');
    const readySamples = result.entryTimeline.filter(sample => sample.entryPhase === 'shelf-ready');
    record('Future ARRAY timeline reports structure, catalog, ready and settle in order', phaseOrderOkay,
      { observedEntryPhases, phaseStarts });
    record('Future ARRAY scene phases follow the shared prelude in time order', phaseTimingOkay, { phaseStarts });
    record('Future ARRAY structure reveals complete racks with catalog cases hidden',
      structureSamples.some(sample => sample.shelfPhase === 'structure' && sample.hiddenCases > 0 && sample.baseCaptured === false),
      structureSamples);
    record('Future ARRAY catalog shows all covers over the captured rack',
      catalogSamples.some(sample => sample.shelfPhase === 'catalog' && sample.hiddenCases === 0 && sample.baseCaptured === true),
      catalogSamples);
    record('Future ARRAY ready phase reaches the static shelf state',
      readySamples.some(sample => sample.shelfPhase === 'ready'), readySamples);
    record('Future ARRAY intro completes naturally after the original prelude and tail',
      keyframeCount === keyframeTimes.length && naturalPlaybackSeconds >= 23 && naturalPlaybackSeconds <= 40 &&
      naturalEnd.viewLayout === 'shelf' && naturalEnd.presentation?.phase === 'archive' && naturalEnd.detailHidden === true,
    { keyframeCount, keyframeTimes, playbackSeconds:naturalPlaybackSeconds, state:shortState(naturalEnd) });
    record('Future ARRAY entry returns to a static shelf with rack-only state cleared',
      naturalEnd.entry?.active === false && naturalEnd.stats?.layoutTransition?.active === false &&
      naturalEnd.stats?.shelfEntry?.phase == null && naturalEnd.stats?.shelfEntry?.hiddenCases === 0,
    { shelfEntry:naturalEnd.stats?.shelfEntry,
      transition:naturalEnd.stats?.layoutTransition, entry:naturalEnd.entry });
    record('entry replay leaves automatic entry off and does not open an album',
      getPreferences()?.entryOnOpen === false && naturalEnd.viewLayout === 'shelf' &&
      naturalEnd.detailHidden === true && naturalEnd.presentation?.phase === 'archive',
    { entryOnOpen:getPreferences()?.entryOnOpen, state:shortState(naturalEnd) });

    result.ok = Object.values(result.assertions).every(Boolean);
    result.summary = { ok:result.ok, cases:result.cases.length, screenshots:result.screenshots.length,
      layoutTransitions:result.timeline.length, entryPhaseSequence:observedEntryPhases,
      keyframeCount, naturalPlaybackSeconds,
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
