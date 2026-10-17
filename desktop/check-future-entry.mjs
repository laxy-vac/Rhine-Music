import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkFutureEntry({
  browserWindow,
  outputDirectory,
  getPreferences,
  setPreferences,
  sendKey,
  getReadyCount,
}) {
  const wc = browserWindow.webContents;
  const result = {
    ok: false,
    assertions: {},
    states: [],
    screenshots: [],
    summary: {},
    timingHarness: 'After each production ready signal, keep the synthetic renderer painting while screenshots are collected, then restore background throttling. Production gate settings are observed before this override.',
  };
  try {
  // Screen capture can occlude the native probe window. This test-only override
  // keeps its compositor/visibility clock active after production ready;
  // the separate startup probe checks the unmodified native visibility gate.
  wc.setBackgroundThrottling(false);
  await fs.mkdir(outputDirectory, { recursive: true });

  const stateScript = [
    '(() => {',
    '  const stage = document.querySelector("#stage");',
    '  const app = window.rhineMusic;',
    '  const stats = app?.stats?.() ?? null;',
    '  const entry = app?.entry ?? null;',
    '  const presentation = app?.presentation ?? null;',
    '  const overlay = document.querySelector(".future-entry");',
    '  const film = document.querySelector(".future-entry-film");',
    '  const boot = film?.querySelector(".boot");',
    '  const browse = document.querySelector("#music-browse");',
    '  const scene = document.querySelector("#three-scene");',
    '  const nav = document.querySelector(".music-topnav");',
    '  const detail = document.querySelector("#music-detail");',
    '  const settings = document.querySelector("#music-settings");',
    '  const interfaceCategory = document.querySelector(".settings-category[data-settings-category=interface]");',
    '  const interfaceNav = document.querySelector("[data-settings-category-target=interface]");',
    '  const entrySettings = document.querySelector("#entry-settings");',
    '  const entryOnOpen = document.querySelector("#entry-on-open");',
    '  const entryReplay = document.querySelector("[data-action=entry-replay]");',
    '  const entrySettingsCategory = entrySettings?.closest(".settings-category");',
    '  const skipButton = document.querySelector(".future-entry-skip");',
    '  return {',
    '    theme: stage?.dataset.theme ?? null,',
    '    visibility: document.visibilityState,',
    '    design: app?.design?.design ?? null,',
    '    entry,',
    '    presentation,',
    '    stats: stats ? {',
    '      loaded: stats.loaded,',
    '      design: stats.design,',
    '      displayLayout: stats.displayLayout,',
    '      cameraPosition: stats.cameraPosition,',
    '      cameraAim: stats.cameraAim,',
    '      modelPosition: stats.modelPosition,',
    '      fieldOfView: stats.fieldOfView,',
    '      cameraDetail: stats.cameraDetail,',
    '      extraction: stats.extraction,',
    '      previewLift: stats.previewLift,',
    '      musicArchiveReady: stats.musicArchiveReady,',
    '      musicPresentationPhase: stats.musicPresentationPhase,',
    '    } : null,',
    '    overlayPresent: Boolean(overlay),',
    '    browseInert: browse?.inert ?? null,',
    '    sceneInert: scene?.inert ?? null,',
    '    navInert: nav?.inert ?? null,',
    '    detailHidden: detail?.hidden ?? null,',
    '    settingsHidden: settings?.hidden ?? null,',
    '    interfaceCategoryHidden: interfaceCategory?.hidden ?? null,',
    '    interfaceNavCurrent: interfaceNav?.getAttribute("aria-current") === "page",',
    '    entrySettingsPresent: Boolean(entrySettings),',
    '    entrySettingsCategory: entrySettingsCategory?.dataset.settingsCategory ?? null,',
    '    entryControlsInSection: Boolean(entrySettings?.contains(entryOnOpen) && entrySettings?.contains(entryReplay)),',
    '    entrySettingsText: entrySettings?.textContent?.trim() ?? null,',
    '    entryOnOpenChecked: entryOnOpen?.checked ?? null,',
    '    entryReplayDisabled: entryReplay?.disabled ?? null,',
    '    skipPresent: Boolean(skipButton),',
    '    skipText: skipButton?.textContent?.trim() ?? null,',
    '    welcomeDatabase: film?.querySelector(".welcome-database")?.textContent?.trim() ?? null,',
    '    visual: {',
    '      overlayOpacity: overlay ? getComputedStyle(overlay).opacity : null,',
    '      overlayBackground: overlay ? getComputedStyle(overlay).backgroundColor : null,',
    '      overlayBeforeOpacity: overlay ? getComputedStyle(overlay, "::before").opacity : null,',
    '      bootOpacity: boot ? getComputedStyle(boot).opacity : null,',
    '      bootVisibility: boot ? getComputedStyle(boot).visibility : null,',
    '      logoWidth: film?.querySelector(".boot-logo svg")?.getBoundingClientRect().width ?? 0,',
    '      scanWidth: film?.querySelector(".scan svg")?.getBoundingClientRect().width ?? 0,',
    '    },',
    '  };',
    '})()',
  ].join('\n');

  const evaluate = script => wc.executeJavaScript(script, true);
  const click = selector => evaluate(
    `(() => {
      const selector = ${JSON.stringify(selector)};
      const element = document.querySelector(selector);
      if (!element) throw new Error("Missing UI control: " + selector);
      element.click();
      return true;
    })()`,
  );
  const snapshot = async () => {
    try {
      return await evaluate(stateScript);
    } catch (error) {
      return { sampleError: String(error?.message ?? error) };
    }
  };
  const waitFor = async (predicate, label, timeoutMs = 12000) => {
    const deadline = Date.now() + timeoutMs;
    let latest;
    while (Date.now() < deadline) {
      latest = await snapshot();
      if (await predicate(latest)) return latest;
      await pause(80);
    }
    throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify(latest));
  };
  const compactState = (label, state) => ({
    label,
    time: state.entry?.time ?? null,
    phase: state.entry?.phase ?? null,
    theme: state.theme ?? null,
    visibility: state.visibility ?? null,
    design: state.design ?? null,
    presentation: state.presentation ?? null,
    stats: state.stats ? {
      displayLayout: state.stats.displayLayout,
      cameraPosition: state.stats.cameraPosition,
      cameraAim: state.stats.cameraAim,
      modelPosition: state.stats.modelPosition,
      fieldOfView: state.stats.fieldOfView,
      cameraDetail: state.stats.cameraDetail,
      extraction: state.stats.extraction,
      previewLift: state.stats.previewLift,
      musicArchiveReady: state.stats.musicArchiveReady,
      musicPresentationPhase: state.stats.musicPresentationPhase,
    } : null,
    overlayPresent: state.overlayPresent ?? null,
    browseInert: state.browseInert ?? null,
    sceneInert: state.sceneInert ?? null,
    detailHidden: state.detailHidden ?? null,
    settingsHidden: state.settingsHidden ?? null,
    interfaceCategoryHidden: state.interfaceCategoryHidden ?? null,
    entrySettingsCategory: state.entrySettingsCategory ?? null,
    entryControlsInSection: state.entryControlsInSection ?? null,
    entryOnOpenChecked: state.entryOnOpenChecked ?? null,
    entryReplayDisabled: state.entryReplayDisabled ?? null,
    entrySettingsText: state.entrySettingsText ?? null,
    visual: state.visual ?? null,
  });
  const check = (name, condition, message) => {
    result.assertions[name] = Boolean(condition);
    assert.ok(condition, message);
  };
  const screenshot = async (name, state) => {
    await pause(120);
    const image = await browserWindow.capturePage();
    const file = path.join(outputDirectory, 'future-entry-' + name + '.png');
    await fs.writeFile(file, image.toPNG());
    result.screenshots.push({
      name,
      file,
      size: image.getSize(),
      theme: state.theme ?? null,
      phase: state.entry?.phase ?? null,
      time: state.entry?.time ?? null,
      visual: state.visual ?? null,
      entryOnOpenChecked: state.entryOnOpenChecked ?? null,
      entryReplayDisabled: state.entryReplayDisabled ?? null,
      entrySettingsText: state.entrySettingsText ?? null,
    });
  };
  const openInterfaceSettings = async label => {
    await click('[data-action=\"settings\"]');
    await waitFor(state => state.settingsHidden === false, label + ' settings page');
    await click('[data-action=\"settings-category\"][data-settings-category-target=\"interface\"]');
    const state = await waitFor(value =>
      value.interfaceCategoryHidden === false &&
      value.interfaceNavCurrent === true &&
      value.entrySettingsPresent &&
      value.entrySettingsCategory === 'interface' &&
      value.entryControlsInSection &&
      value.entryOnOpenChecked !== null,
    label + ' interface entry settings');
    result.states.push(compactState(label + '-settings', state));
    return state;
  };
  const setEntryOnOpenFromUI = async (enabled, label, expectedBefore) => {
    const state = await openInterfaceSettings(label);
    if (expectedBefore !== undefined) {
      check(label + ' starts with the expected checkbox state',
        state.entryOnOpenChecked === expectedBefore,
        label + ': entryOnOpen checkbox has an unexpected starting value');
    }
    if (state.entryOnOpenChecked !== enabled) await click('#entry-on-open');
    const saved = await waitFor(value =>
      getPreferences()?.entryOnOpen === enabled &&
      value.entryOnOpenChecked === enabled,
    label + ' entryOnOpen=' + enabled + ' persisted', 8000);
    const preferences = getPreferences();
    check(label + ' persists entryOnOpen through production preference filtering',
      Object.hasOwn(preferences, 'entryOnOpen') && preferences.entryOnOpen === enabled,
      label + ': entryOnOpen must survive the production preference whitelist');
    result.states.push(compactState(label + '-saved', saved));
    return saved;
  };
  const assertArchiveOverview = async label => {
    const state = await waitFor(value =>
      value.entry?.active === false &&
      value.entry?.phase === 'archive' &&
      value.presentation?.phase === 'archive' &&
      value.presentation?.menuVisible === false &&
      value.stats?.cameraDetail === 0 &&
      value.stats?.musicArchiveReady === true &&
      value.settingsHidden === true &&
      value.overlayPresent === false,
    label + ' archive overview', 12000);
    check(label + ' leaves album detail closed', state.presentation.menuVisible === false, label + ': album detail must stay closed');
    check(label + ' has zero camera detail', state.stats.cameraDetail === 0, label + ': camera detail must be zero');
    check(label + ' archive is ready', state.stats.musicArchiveReady === true, label + ': archive scene must be ready');
    check(label + ' removes its overlay', state.overlayPresent === false, label + ': entry overlay must be removed');
    check(label + ' restores main UI interaction',
      state.browseInert === false && state.sceneInert === false && state.navInert === false,
      label + ': browse, scene, and navigation must be non-inert');
    result.states.push(compactState(label + '-archive', state));
    return state;
  };
  const readyCount = () => Number(getReadyCount?.() ?? 0);
  const reloadAndWait = async (label, expectActive) => {
    const before = readyCount();
    wc.reload();
    const state = await waitFor(value =>
      readyCount() > before &&
      value.stats?.loaded === true &&
      value.entry?.active === expectActive,
    label + ' frontend ready', 45000);
    wc.setBackgroundThrottling(false);
    check(label + ' reload keeps the window visible', browserWindow.isVisible(), label + ': window should be visible after ready');
    result.states.push(compactState(label + '-ready', state));
    return state;
  };

  const initialPreferences = getPreferences();
  check('explicit Future matrix albums preferences',
    initialPreferences?.style?.design === 'rhine' &&
      initialPreferences?.view?.layout === 'array' &&
      initialPreferences?.view?.show === 'albums' &&
      initialPreferences?.reduced === false &&
      initialPreferences?.entryOnOpen !== false,
    'Future entry probe must start with design=rhine, layout=array, show=albums, reduced=false, with automatic entry enabled by default');
  const firstReady = await waitFor(state =>
    readyCount() >= 1 && state.stats?.loaded === true && state.entry?.active === true,
  'entry remains active after first ready', 8000);
  check('entry remains active after first ready', firstReady.entry.active === true,
    'The first frontendReady signal must release the window while the entry is still running');
  check('skip label remains fixed English',
    firstReady.skipText === 'SKIP INTRO ↗',
    'The Future entry skip control must use its fixed English label');
  check('Future matrix scene selected',
    firstReady.design === 'rhine' && firstReady.stats.displayLayout?.effective === 'array',
    'The initial scene must use the Future matrix layout');
  check('initial detail remains closed',
    firstReady.presentation?.menuVisible === false && firstReady.stats.cameraDetail === 0,
    'The entry must not open an album detail page at first ready');
  result.states.push(compactState('first-ready', firstReady));

  const phaseNames = ['logo', 'auth', 'scan', 'welcome', 'array', 'settle'];
  const captureAt = { logo: 5.0, auth: 8.0, scan: 15.4, welcome: 20.4, array: 24.2, settle: 26.1 };
  const capturedPhases = new Set();
  let lastTimelineRecord = 0;
  let handoffBefore;
  let timelineEnded = false;
  const timelineDeadline = Date.now() + 32000;
  while (Date.now() < timelineDeadline) {
    const state = await snapshot();
    if (state.entry?.active !== true) {
      timelineEnded = true;
      break;
    }
    const now = Date.now();
    const phase = state.entry.phase;
    if (now - lastTimelineRecord >= 250) {
      result.states.push(compactState('timeline', state));
      lastTimelineRecord = now;
    }
    if (state.entry.time >= 27.0 && state.entry.time < 27.12) {
      handoffBefore = compactState('handoff-before', state);
    }
    if (phaseNames.includes(phase) && state.entry.time >= captureAt[phase] && !capturedPhases.has(phase)) {
      capturedPhases.add(phase);
      process.stdout.write('future-entry: ' + phase + '\n');
      result.states.push(compactState('phase-' + phase, state));
      check(phase + ' boot host is visible',
        state.visual?.bootOpacity === '1' && state.visual?.bootVisibility === 'visible',
        phase + ': boot layer must remain visible inside the isolated overlay');
      if (phase === 'welcome') {
        check('welcome identifies the TERMINAL', state.welcomeDatabase === 'TERMINAL',
          'The welcome screen must say TERMINAL');
      }
      check(phase + ' SVG surfaces retain their film dimensions',
        state.visual.logoWidth > 100 && state.visual.scanWidth > 500,
        phase + ': music icon CSS must not shrink the full-size animated SVGs');
      const backdropOpacity = Number(state.visual?.overlayBeforeOpacity);
      if (['logo', 'auth', 'scan', 'welcome'].includes(phase)) {
        check(phase + ' backdrop is visible', backdropOpacity > 0.9,
          phase + ': opening backdrop should cover the prepared scene');
      } else {
        check(phase + ' backdrop has released the scene', backdropOpacity < 0.05,
          phase + ': backdrop should be transparent while the matrix enters and settles');
      }
      await screenshot('day-' + phase, state);
    }
    await pause(50);
  }
  check('natural entry finishes', timelineEnded,
    'The Future entry did not finish naturally before the 32 second limit');
  for (const phase of phaseNames) {
    check('screenshot captured for ' + phase, capturedPhases.has(phase),
      'Missing visible Future entry screenshot for phase ' + phase);
  }

  const finalOverview = await assertArchiveOverview('natural completion');
  await screenshot('day-archive', finalOverview);
  check('natural end reached the matrix layout',
    finalOverview.stats.displayLayout?.effective === 'array',
    'Natural completion must remain in the matrix archive layout');
  check('handoff sample captured near 27.0s', Boolean(handoffBefore?.stats),
    'Could not capture the final cinematic scene state near 27.0 seconds');
  const distance = (before, after) => {
    assert.ok(Array.isArray(before) && Array.isArray(after) && before.length === after.length,
      'Expected matching vector-valued scene statistics');
    return Math.hypot(...before.map((value, index) => Number(value) - Number(after[index])));
  };
  const handoffDelta = {
    cameraPosition: distance(handoffBefore.stats.cameraPosition, finalOverview.stats.cameraPosition),
    cameraAim: distance(handoffBefore.stats.cameraAim, finalOverview.stats.cameraAim),
    modelPosition: distance(handoffBefore.stats.modelPosition, finalOverview.stats.modelPosition),
    fieldOfView: Math.abs(handoffBefore.stats.fieldOfView - finalOverview.stats.fieldOfView),
  };
  result.summary.handoffDelta = handoffDelta;
  const naturalDurationSeconds = finalOverview.entry.time - 1.76;
  result.summary.naturalDurationSeconds = naturalDurationSeconds;
  check('natural duration matches the 25.36 second entry',
    Math.abs(naturalDurationSeconds - 25.36) < 0.2,
    'Natural entry elapsed ' + naturalDurationSeconds.toFixed(3) + ' seconds from first ready; expected about 25.36');
  check('camera position is continuous', handoffDelta.cameraPosition < 0.1,
    'Camera position jumped across the intro handoff: ' + JSON.stringify(handoffDelta));
  check('camera aim is continuous', handoffDelta.cameraAim < 0.05,
    'Camera aim jumped across the intro handoff: ' + JSON.stringify(handoffDelta));
  check('model position is continuous', handoffDelta.modelPosition < 0.05,
    'Model position jumped across the intro handoff: ' + JSON.stringify(handoffDelta));
  check('field of view is continuous', handoffDelta.fieldOfView < 0.1,
    'Field of view jumped across the intro handoff: ' + JSON.stringify(handoffDelta));

  const nightPreferences = { ...getPreferences(), theme: 'night', reduced: false };
  await setPreferences(nightPreferences);
  const nightReady = await reloadAndWait('night theme', true);
  check('night reload retains Future design', nightReady.design === 'rhine',
    'Night reload must retain the Future design');
  const nightLogo = await waitFor(state => state.entry?.active === true && state.entry.phase === 'logo',
    'night logo phase', 12000);
  check('night logo and backdrop are visible',
    nightLogo.visual?.bootOpacity === '1' &&
      nightLogo.visual?.bootVisibility === 'visible' &&
      Number(nightLogo.visual?.overlayBeforeOpacity) > 0.9,
    'Night entry should render its isolated logo and backdrop');
  await screenshot('night-logo', nightLogo);
  sendKey('ENTER');
  const nightSkipped = await assertArchiveOverview('night Enter skip');
  check('Enter skips the night entry', nightSkipped.theme === 'night',
    'Enter should skip the night entry and preserve the night theme');

  await setPreferences({ ...getPreferences(), theme: 'day', reduced: false });
  const dayReady = await reloadAndWait('day button skip', true);
  check('day reload starts its entry', dayReady.entry.active === true,
    'Day reload should start a Future entry');
  await evaluate('(() => { const button = document.querySelector(".future-entry-skip"); if (!button) throw new Error("Future entry skip button is missing"); button.click(); return true; })()');
  await assertArchiveOverview('day skip button');

  await setEntryOnOpenFromUI(false, 'disable automatic entry', true);
  check('automatic entry off persists in the mock profile',
    getPreferences().entryOnOpen === false,
    'Turning off automatic entry must persist false through the production preferences selector');
  const automaticOffReady = await reloadAndWait('automatic entry disabled', false);
  check('automatic entry off skips the next open',
    automaticOffReady.entry.active === false && !automaticOffReady.overlayPresent,
    'Reloading with entryOnOpen=false must not show an entry overlay');
  await assertArchiveOverview('automatic entry disabled');

  const manualSettings = await openInterfaceSettings('manual replay eligibility');
  check('manual replay remains available while auto entry is off',
    manualSettings.entryOnOpenChecked === false && manualSettings.entryReplayDisabled === false,
    'Manual replay must remain enabled when automatic entry is disabled');
  // The settings page and its View Transition have separate animation clocks.
  // Inspect the settled control panel rather than the outgoing archive snapshot.
  await pause(650);
  await screenshot('settings-entry-control-auto-off', manualSettings);
  await click('[data-action="entry-replay"]');
  const manualReplay = await waitFor(state =>
    state.entry?.active === true && state.overlayPresent && state.settingsHidden === true,
  'manual replay starts from the settings page', 8000);
  check('manual replay uses the Future matrix',
    manualReplay.design === 'rhine' && manualReplay.stats.displayLayout?.effective === 'array',
    'Manual replay must use the Future matrix composition');
  sendKey('ESC');
  await assertArchiveOverview('manual replay Escape skip');
  check('manual replay does not re-enable auto entry',
    getPreferences().entryOnOpen === false,
    'Manual replay must leave entryOnOpen disabled');

  await setEntryOnOpenFromUI(true, 'enable automatic entry', false);
  check('automatic entry on persists in the mock profile',
    getPreferences().entryOnOpen === true,
    'Turning on automatic entry must persist true through the production preferences selector');
  const automaticOnReady = await reloadAndWait('automatic entry enabled', true);
  check('automatic entry on plays on the next open',
    automaticOnReady.entry.active === true && automaticOnReady.overlayPresent,
    'Reloading with entryOnOpen=true must start the Future entry');
  sendKey('ENTER');
  await assertArchiveOverview('automatic entry enabled Enter skip');

  const repeatedReady = await reloadAndWait('automatic entry repeats', true);
  check('automatic entry repeats on every open',
    repeatedReady.entry.active === true && repeatedReady.overlayPresent,
    'A prior completed entry must not suppress the next window open');
  await click('.future-entry-skip');
  await assertArchiveOverview('repeated automatic entry button skip');

  await setPreferences({
    ...getPreferences(),
    reduced: true,
    view: { ...getPreferences().view, layout: 'array', show: 'albums' },
  });
  const reducedReady = await reloadAndWait('reduced motion', false);
  const reducedOverview = await assertArchiveOverview('reduced motion');
  check('reduced motion skips the entry', reducedReady.entry.active === false && !reducedReady.overlayPresent,
    'Reduced motion must not create the Future entry overlay');
  check('reduced motion remains enabled', getPreferences().reduced === true,
    'Reduced motion preference should remain enabled for its reload');
  const reducedSettings = await openInterfaceSettings('reduced motion replay eligibility');
  check('manual replay is disabled for reduced motion',
    reducedSettings.entryReplayDisabled === true &&
      /减少动态|reduce(?:d)? motion/i.test(reducedSettings.entrySettingsText ?? ''),
    'Reduced motion must disable manual replay and explain the restriction');
  await click('[data-action="settings"]');
  await waitFor(state => state.settingsHidden === true, 'close reduced motion settings');

  await setPreferences({
    ...getPreferences(),
    reduced: false,
    view: { ...getPreferences().view, layout: 'grid', show: 'albums' },
  });
  const gridReady = await reloadAndWait('grid layout', false);
  const gridOverview = await assertArchiveOverview('grid layout');
  check('grid layout skips the entry', gridReady.entry.active === false && !gridReady.overlayPresent,
    'Future entry must not run for the grid layout');
  check('grid layout remains selected', gridOverview.stats.displayLayout?.effective === 'grid',
    'Grid reload must preserve the selected grid layout');
  const gridSettings = await openInterfaceSettings('grid layout replay eligibility');
  check('manual replay is disabled and explained outside MATRIX',
    gridSettings.entryReplayDisabled === true &&
      /ALBUMS\/MATRIX|MATRIX/i.test(gridSettings.entrySettingsText ?? ''),
    'The replay control must explain that its entry is limited to Future ALBUMS/MATRIX');
  await click('[data-action="settings"]');
  await waitFor(state => state.settingsHidden === true, 'close grid layout settings');
  await assertArchiveOverview('grid settings dismissed');

  result.summary = {
    naturalDurationSeconds,
    capturedPhases: Array.from(capturedPhases),
    screenshotCount: result.screenshots.length,
    handoffDelta,
    finalTheme: gridOverview.theme,
    finalLayout: gridOverview.stats.displayLayout?.effective ?? null,
    readyMessages: readyCount(),
  };
  result.ok = Object.values(result.assertions).every(Boolean);
  assert.equal(result.ok, true, 'Future entry isolated checks did not all pass');
  return result;
  } catch (error) {
    if (error && typeof error === 'object') error.futureEntryResult = result;
    throw error;
  } finally {
    if (!browserWindow.isDestroyed()) wc.setBackgroundThrottling(true);
  }
}
