import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkFutureEntry({
  browserWindow,
  outputDirectory,
  probeReport,
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
    '  const welcomeLine = film?.querySelector(".welcome-database");',
    '  const browse = document.querySelector("#music-browse");',
    '  const scene = document.querySelector("#three-scene");',
    '  const nav = document.querySelector(".music-topnav");',
    '  const detail = document.querySelector("#music-detail");',
    '  const settings = document.querySelector("#music-settings");',
    '  const interfaceCategory = document.querySelector(".settings-category[data-settings-category=interface]");',
    '  const interfaceNav = document.querySelector("[data-settings-category-target=interface]");',
    '  const appearanceCategory = document.querySelector(".settings-category[data-settings-category=appearance]");',
    '  const appearanceNav = document.querySelector("[data-settings-category-target=appearance]");',
    '  const entrySettings = document.querySelector("#entry-settings");',
    '  const motionSettings = interfaceCategory?.querySelector("#motion-settings");',
    '  const motionGroup = motionSettings?.matches(".graphics-motion-settings") ? motionSettings : motionSettings?.querySelector(".graphics-motion-settings");',
    '  const entryOnOpen = document.querySelector("#entry-on-open");',
    '  const entryReplay = document.querySelector("[data-action=entry-replay]");',
    '  const entryWelcome = document.querySelector("#entry-welcome[data-entry-text=entryWelcome]");',
    '  const entryIdentity = document.querySelector("#entry-identity[data-entry-text=entryIdentity]");',
    '  const entryWelcomeCount = document.querySelector("[data-entry-count=entryWelcome]");',
    '  const entryIdentityCount = document.querySelector("[data-entry-count=entryIdentity]");',
    '  const entryTextReset = document.querySelector("[data-action=entry-text-reset]");',
    '  const entryTextHelp = document.querySelector("#entry-text-help");',
    '  const entryTextStatus = document.querySelector("#entry-text-status");',
    '  const entrySettingsCategory = entrySettings?.closest(".settings-category");',
    '  const graphicsPage = document.querySelector("#music-theme-page");',
    '  const graphicsDisplay = appearanceCategory?.querySelector("#graphics-display-settings");',
    '  const graphicsCaseEditor = graphicsPage?.querySelector("#theme-case-editor");',
    '  const graphicsNav = document.querySelector(".music-topnav [data-action=theme]");',
    '  const settingsInterfaceNav = settings?.querySelector("[data-settings-category-target=interface]");',
    '  const skipButton = document.querySelector(".future-entry-skip");',
    '  return {',
    '    theme: stage?.dataset.theme ?? null,',
    '    page: stage?.dataset.page ?? null,',
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
    '    appearanceCategoryHidden: appearanceCategory?.hidden ?? null,',
    '    appearanceNavCurrent: appearanceNav?.getAttribute("aria-current") === "page",',
    '    entrySettingsPresent: Boolean(entrySettings),',
    '    entrySettingsCategory: entrySettingsCategory?.dataset.settingsCategory ?? null,',
    '    entryControlsInSection: Boolean(entrySettings?.contains(entryOnOpen) && entrySettings?.contains(entryReplay) && entrySettings?.contains(entryWelcome) && entrySettings?.contains(entryIdentity) && entrySettings?.contains(entryTextReset)),',
    '    entrySettingsText: entrySettings?.textContent?.trim() ?? null,',
    '    entryOnOpenChecked: entryOnOpen?.checked ?? null,',
    '    entryOnOpenDisabled: entryOnOpen?.disabled ?? null,',
    '    entryReplayDisabled: entryReplay?.disabled ?? null,',
    '    entryWelcomeValue: entryWelcome?.value ?? null,',
    '    entryIdentityValue: entryIdentity?.value ?? null,',
    '    entryWelcomeDisabled: entryWelcome?.disabled ?? null,',
    '    entryIdentityDisabled: entryIdentity?.disabled ?? null,',
    '    entryWelcomeMaxLength: entryWelcome?.maxLength ?? null,',
    '    entryIdentityMaxLength: entryIdentity?.maxLength ?? null,',
    '    entryWelcomePattern: entryWelcome?.getAttribute("pattern") ?? null,',
    '    entryIdentityPattern: entryIdentity?.getAttribute("pattern") ?? null,',
    '    entryWelcomeCount: entryWelcomeCount?.textContent?.trim() ?? null,',
    '    entryIdentityCount: entryIdentityCount?.textContent?.trim() ?? null,',
    '    entryTextResetDisabled: entryTextReset?.disabled ?? null,',
    '    entryTextHelp: entryTextHelp?.textContent?.trim() ?? null,',
    '    entryTextStatus: entryTextStatus?.textContent?.trim() ?? null,',
    '    settingsInterfaceLabel: settingsInterfaceNav?.textContent?.trim() ?? null,',
    '    appearanceNavLabel: appearanceNav?.textContent?.trim() ?? null,',
    '    settingsHasMotionSettings: Boolean(settings?.querySelector("#motion-settings")),',
    '    settingsHasMotionSettingsInInterface: Boolean(motionGroup?.querySelector("#reduced-motion") && motionGroup?.querySelector("[data-quality=wave]")),',
    '    settingsAppearanceHasMotionSettings: Boolean(appearanceCategory?.querySelector("#motion-settings, #reduced-motion, .graphics-motion-settings, [data-quality=wave]")),',
    '    settingsHasThemeCards: Boolean(settings?.querySelector(".theme-cards, [data-theme=day], [data-theme=night]")),',
    '    settingsHasLanguageControl: Boolean(interfaceCategory?.querySelector("#interface-settings #ui-language")),',
    '    settingsHasLanguageApply: Boolean(interfaceCategory?.querySelector("#interface-settings [data-action=apply-language]")),',
    '    settingsHasInterfaceSettings: Boolean(interfaceCategory?.querySelector("#interface-settings")),',
    '    settingsHasGraphicsLink: Boolean(interfaceCategory?.querySelector("#interface-settings [data-action=theme]")),',
    '    settingsHasEntrySettingsInInterface: Boolean(interfaceCategory?.querySelector("#entry-settings")),',
    '    settingsHasInterfaceSoundInInterface: Boolean(interfaceCategory?.querySelector("#interface-sound-settings")),',
    '    settingsAppearanceHasDisplaySettings: Boolean(graphicsDisplay),',
    '    settingsAppearanceHasLanguageControl: Boolean(appearanceCategory?.querySelector("#ui-language")),',
    '    graphicsPageOpen: !!graphicsPage && !graphicsPage.hidden,',
    '    graphicsTitle: document.querySelector("#music-style-title")?.textContent?.trim() ?? null,',
    '    graphicsStyleKicker: graphicsPage?.querySelector(".music-style-heading small")?.textContent?.trim() ?? null,',
    '    graphicsNavLabel: graphicsNav?.textContent?.trim() ?? null,',
    '    graphicsHasStyleCard: Boolean(graphicsPage?.querySelector(".design-family-card")),',
    '    graphicsHasColorChoices: Boolean(graphicsPage?.querySelector("[data-style-scheme], .theme-choice-preview")),',
    '    graphicsHasCaseEditor: Boolean(graphicsPage?.querySelector("#theme-case-editor .case-editor, .case-editor")),',
    '    graphicsHasScenePreview: Boolean(graphicsPage?.querySelector("[data-style-preview-content], .music-style-preview, .foobar-style-preview, .theme-choice-scene")),',
    '    graphicsHasQuality: Boolean(graphicsDisplay?.querySelector(".quality-settings [data-quality]")),',
    '    graphicsHasWindowAspect: Boolean(graphicsDisplay?.querySelector("[data-window-aspect]")),',
    '    graphicsHasDisplaySettings: Boolean(graphicsDisplay),',
    '    graphicsHasReducedMotion: Boolean(motionGroup?.querySelector("#reduced-motion")),',
    '    graphicsHasFullscreen: Boolean(graphicsDisplay?.querySelector("[data-action=fullscreen]")),',
    '    graphicsHasGpu: Boolean(graphicsDisplay?.querySelector("[data-gpu-preference]")),',
    '    graphicsHasQualityDetection: Boolean(graphicsDisplay?.querySelector(".quality-detection")),',
    '    graphicsHasThemeControls: Boolean(graphicsPage?.querySelector(".theme-mode-controls [data-theme=day]")),',
    '    graphicsStyleQualitySlotEmpty: Boolean(graphicsPage?.querySelector("#theme-quality-slot") && graphicsPage.querySelector("#theme-quality-slot").children.length === 0),',
    '    graphicsStyleCaseEditorBeforeQualitySlot: Boolean(graphicsCaseEditor && graphicsPage?.querySelector("#theme-quality-slot") && (graphicsCaseEditor.compareDocumentPosition(graphicsPage.querySelector("#theme-quality-slot")) & Node.DOCUMENT_POSITION_FOLLOWING)),',
    '    graphicsStyleHasForbiddenControls: Boolean(graphicsPage?.querySelector("#graphics-display-settings, #motion-settings, #reduced-motion, [data-quality], .quality-settings, [data-gpu-settings], [data-gpu-preference], [data-window-aspect], [data-action=fullscreen], #entry-settings, #ui-language")),',
    '    topbarHasThemeSwitcher: Boolean(document.querySelector(".theme-switch")),',
    '    skipPresent: Boolean(skipButton),',
    '    skipText: skipButton?.textContent?.trim() ?? null,',
    '    welcomeDatabase: film?.querySelector(".welcome-database")?.textContent?.trim() ?? null,',
    '    welcomeLineWidth: welcomeLine?.clientWidth ?? 0,',
    '    welcomeLineScrollWidth: welcomeLine?.scrollWidth ?? 0,',
    '    welcomeLineFontSize: welcomeLine ? Number.parseFloat(getComputedStyle(welcomeLine).fontSize) || 0 : 0,',
    '    authIdentity: film?.querySelector("#auth-message")?.textContent?.trim() ?? null,',
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
    appearanceCategoryHidden: state.appearanceCategoryHidden ?? null,
    entrySettingsCategory: state.entrySettingsCategory ?? null,
    entryControlsInSection: state.entryControlsInSection ?? null,
    entryOnOpenChecked: state.entryOnOpenChecked ?? null,
    entryOnOpenDisabled: state.entryOnOpenDisabled ?? null,
    entryReplayDisabled: state.entryReplayDisabled ?? null,
    entrySettingsText: state.entrySettingsText ?? null,
    entryWelcomeValue: state.entryWelcomeValue ?? null,
    entryIdentityValue: state.entryIdentityValue ?? null,
    entryWelcomeDisabled: state.entryWelcomeDisabled ?? null,
    entryIdentityDisabled: state.entryIdentityDisabled ?? null,
    entryWelcomeCount: state.entryWelcomeCount ?? null,
    entryIdentityCount: state.entryIdentityCount ?? null,
    entryTextResetDisabled: state.entryTextResetDisabled ?? null,
    entryTextHelp: state.entryTextHelp ?? null,
    entryTextStatus: state.entryTextStatus ?? null,
    graphicsTitle: state.graphicsTitle ?? null,
    graphicsStyleKicker: state.graphicsStyleKicker ?? null,
    graphicsNavLabel: state.graphicsNavLabel ?? null,
    graphicsPageOpen: state.graphicsPageOpen ?? null,
    graphicsStyleQualitySlotEmpty: state.graphicsStyleQualitySlotEmpty ?? null,
    graphicsStyleCaseEditorBeforeQualitySlot: state.graphicsStyleCaseEditorBeforeQualitySlot ?? null,
    graphicsStyleHasForbiddenControls: state.graphicsStyleHasForbiddenControls ?? null,
    graphicsHasCaseEditor: state.graphicsHasCaseEditor ?? null,
    welcomeLineWidth: state.welcomeLineWidth ?? null,
    welcomeLineScrollWidth: state.welcomeLineScrollWidth ?? null,
    welcomeLineFontSize: state.welcomeLineFontSize ?? null,
    visual: state.visual ?? null,
  });
  const check = (name, condition, message) => {
    result.assertions[name] = Boolean(condition);
    assert.ok(condition, message);
  };
  const screenshot = async (name, state) => {
    if (/graphics|settings/.test(name)) {
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await evaluate(`Promise.allSettled(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished))`);
    }
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
      welcomeDatabase: state.welcomeDatabase ?? null,
      authIdentity: state.authIdentity ?? null,
      welcomeLineWidth: state.welcomeLineWidth ?? null,
      welcomeLineScrollWidth: state.welcomeLineScrollWidth ?? null,
      welcomeLineFontSize: state.welcomeLineFontSize ?? null,
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
      value.entryOnOpenChecked !== null &&
      value.entryWelcomeValue !== null &&
      value.entryIdentityValue !== null &&
      value.entryTextStatus !== null,
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
  const setEntryTextFromUI = async (welcome, identity, label) => {
    await evaluate(`(() => {
      const welcome = document.querySelector('#entry-welcome[data-entry-text="entryWelcome"]');
      const identity = document.querySelector('#entry-identity[data-entry-text="entryIdentity"]');
      if (!welcome || !identity) throw new Error('Entry text inputs are missing');
      welcome.value = ${JSON.stringify(welcome)};
      identity.value = ${JSON.stringify(identity)};
      welcome.dispatchEvent(new Event('input', { bubbles: true }));
      identity.dispatchEvent(new Event('input', { bubbles: true }));
      welcome.dispatchEvent(new Event('change', { bubbles: true }));
      identity.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const saved = await waitFor(value =>
      getPreferences()?.entryWelcome === welcome &&
      getPreferences()?.entryIdentity === identity &&
      value.entryWelcomeValue === welcome &&
      value.entryIdentityValue === identity,
    label + ' entry text persisted', 8000);
    check(label + ' preserves valid text and case',
      getPreferences().entryWelcome === welcome && getPreferences().entryIdentity === identity,
      label + ': valid entry text should save without changing case');
    result.states.push(compactState(label + '-saved', saved));
    return saved;
  };
  const assertEntryTextDefaults = async label => {
    const state = await waitFor(value =>
      getPreferences()?.entryWelcome === 'Internal DataBase' &&
      getPreferences()?.entryIdentity === 'Kristen Wright' &&
      value.entryWelcomeValue === 'Internal DataBase' &&
      value.entryIdentityValue === 'Kristen Wright',
    label + ' entry text defaults', 8000);
    check(label + ' restores both copy defaults',
      state.entryWelcomeValue === 'Internal DataBase' && state.entryIdentityValue === 'Kristen Wright',
      label + ': welcome and identity must both use their default text');
    result.states.push(compactState(label + '-defaults', state));
    return state;
  };
  const exerciseEntryTextValidation = async label => {
    const before = getPreferences();
    const savesBefore = probeReport?.preferenceSaves?.length ?? 0;
    const result = await evaluate(`(() => {
      const welcome = document.querySelector('#entry-welcome[data-entry-text="entryWelcome"]');
      const identity = document.querySelector('#entry-identity[data-entry-text="entryIdentity"]');
      if (!welcome || !identity) throw new Error('Entry text inputs are missing');
      const beforeInput = new InputEvent('beforeinput', { inputType: 'insertText', data: '中文123<script>\\n', bubbles: true, cancelable: true });
      welcome.dispatchEvent(beforeInput);
      const identityBeforeInput = new InputEvent('beforeinput', { inputType: 'insertText', data: 'ID123\\n', bubbles: true, cancelable: true });
      identity.dispatchEvent(identityBeforeInput);
      const transfer = new DataTransfer();
      transfer.setData('text/plain', '中文123<script>\\n');
      const paste = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
      welcome.dispatchEvent(paste);
      const identityTransfer = new DataTransfer();
      identityTransfer.setData('text/plain', 'ID123\\n');
      const identityPaste = new ClipboardEvent('paste', { clipboardData: identityTransfer, bubbles: true, cancelable: true });
      identity.dispatchEvent(identityPaste);
      welcome.value = 'Private 中文123<script>';
      welcome.dispatchEvent(new Event('input', { bubbles: true }));
      identity.value = 'Ada123 Lovelace\\n';
      identity.dispatchEvent(new Event('input', { bubbles: true }));
      const identityAfterInput = identity.value;
      identity.value = 'W'.repeat(25);
      identity.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        beforeInputPrevented: beforeInput.defaultPrevented,
        identityBeforeInputPrevented: identityBeforeInput.defaultPrevented,
        pastePrevented: paste.defaultPrevented,
        identityPastePrevented: identityPaste.defaultPrevented,
        welcomeAfterInput: welcome.value,
        identityAfterInput,
        identityAfterLongInput: identity.value,
      };
    })()`);
    check(label + ' beforeinput and paste reject invalid characters',
      result.beforeInputPrevented && result.identityBeforeInputPrevented && result.pastePrevented && result.identityPastePrevented,
      label + ': beforeinput and paste must reject non-ASCII letters, digits, markup, and line breaks');
    check(label + ' input fallback removes invalid characters',
      result.welcomeAfterInput === 'Private script' &&
        result.identityAfterInput === 'Ada Lovelace' &&
        result.identityAfterLongInput === 'W'.repeat(24),
      label + ': input fallback should retain ASCII letters/spaces and limit values to 24 characters');
    await evaluate(`(() => {
      const welcome = document.querySelector('#entry-welcome[data-entry-text="entryWelcome"]');
      const identity = document.querySelector('#entry-identity[data-entry-text="entryIdentity"]');
      welcome.value = '<script>alert(1)</script>';
      identity.value = 'Kristen123 Wright';
      welcome.dispatchEvent(new Event('change', { bubbles: true }));
      identity.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await pause(250);
    check(label + ' invalid direct change is not saved',
      getPreferences()?.entryWelcome === before.entryWelcome &&
        getPreferences()?.entryIdentity === before.entryIdentity &&
        (probeReport?.preferenceSaves?.length ?? 0) === savesBefore,
      label + ': directly dispatched invalid change events must not alter or resave preferences');
    return result;
  };
  const waitForAuthIdentity = async (identity, label) => waitFor(state =>
    state.entry?.active === true && state.entry.time >= 8.6 && state.authIdentity?.includes(identity),
  label + ' full identity text', 10000);
  const openStyle = async label => {
    await click('.music-topnav [data-action="theme"]');
    return waitFor(state => state.graphicsPageOpen && state.graphicsTitle === 'STYLE', label + ' STYLE page');
  };
  const closeStyle = async label => {
    await click('.music-topnav [data-action="theme"]');
    await waitFor(state => !state.graphicsPageOpen, label + ' return to music');
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
  check('production preference whitelist retains entry text',
    probeReport?.productionPreferenceWhitelistHasEntryWelcome === true &&
      probeReport?.productionPreferenceWhitelistHasEntryIdentity === true,
    'The production preferences filter must retain entryWelcome and entryIdentity');
  check('production selector defaults a legacy profile',
    probeReport?.productionEntryTextDefaultsLegacyProfile === true,
    'A profile without entry text must receive both safe defaults');
  check('production selector rejects invalid and overlong text',
    probeReport?.productionEntryTextInvalidValuesUseDefaults === true,
    'Invalid markup and digits must fall back before preferences are saved');
  check('explicit Future matrix albums preferences',
    initialPreferences?.style?.design === 'rhine' &&
      initialPreferences?.view?.layout === 'array' &&
      initialPreferences?.view?.show === 'albums' &&
      initialPreferences?.reduced === false &&
      initialPreferences?.entryWelcome === 'Internal DataBase' &&
      initialPreferences?.entryIdentity === 'Kristen Wright' &&
      initialPreferences?.entryOnOpen !== false,
    'Future entry probe must start with default welcome/identity and automatic entry enabled for the Future album matrix');
  const firstReady = await waitFor(state =>
    readyCount() >= 1 && state.stats?.loaded === true && state.entry?.active === true,
  'entry remains active after first ready', 8000);
  check('entry remains active after first ready', firstReady.entry.active === true,
    'The first frontendReady signal must release the window while the entry is still running');
  check('skip label remains fixed English',
    firstReady.skipText === 'SKIP INTRO ↗',
    'The Future entry skip control must use its fixed English label');
  check('default welcome copy is rendered',
    firstReady.welcomeDatabase === 'Internal DataBase',
    'The Future welcome line must default to Internal DataBase');
  check('Future matrix scene selected',
    firstReady.design === 'rhine' && firstReady.stats.displayLayout?.effective === 'array',
    'The initial scene must use the Future matrix layout');
  check('initial detail remains closed',
    firstReady.presentation?.menuVisible === false && firstReady.stats.cameraDetail === 0,
    'The entry must not open an album detail page at first ready');
  result.states.push(compactState('first-ready', firstReady));

  const phaseNames = ['logo', 'auth', 'scan', 'welcome', 'array', 'settle'];
  const captureAt = { logo: 5.0, auth: 8.6, scan: 15.4, welcome: 20.4, array: 24.2, settle: 26.1 };
  const capturedPhases = new Set();
  let lastTimelineRecord = 0;
  let handoffBefore;
  let timelineEnded = false;
  let previousTimelineEntryTime;
  let maxObservedStepSeconds = 0;
  let largestObservedStepSeconds = 0;
  let oversizedTimelineStepCount = 0;
  let nonMonotonicTimelineStepCount = 0;
  const timelineDeadline = Date.now() + 32000;
  while (Date.now() < timelineDeadline) {
    const state = await snapshot();
    const currentEntryTime = Number(state.entry?.time);
    if (Number.isFinite(currentEntryTime)) {
      if (previousTimelineEntryTime !== undefined) {
        const step = currentEntryTime - previousTimelineEntryTime;
        if (step < 0) {
          nonMonotonicTimelineStepCount++;
        } else {
          largestObservedStepSeconds = Math.max(largestObservedStepSeconds, step);
          if (step > 2) oversizedTimelineStepCount++;
          else maxObservedStepSeconds = Math.max(maxObservedStepSeconds, step);
        }
      }
      previousTimelineEntryTime = currentEntryTime;
    }
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
        check('welcome retains the default database line', state.welcomeDatabase === 'Internal DataBase',
          'The welcome screen must show the selected database label');
      }
      if (phase === 'auth') {
        check('default auth identity is complete', state.authIdentity?.includes('Kristen Wright'),
          'The auth line must complete the default Kristen Wright identity within its existing frame range');
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
  const nominalDurationSeconds = 25.36;
  const durationOverrunSeconds = naturalDurationSeconds - nominalDurationSeconds;
  const allowedDurationOverrunSeconds = Math.max(0.2, maxObservedStepSeconds + 0.05);
  result.summary.naturalDurationSeconds = naturalDurationSeconds;
  result.summary.nominalDurationSeconds = nominalDurationSeconds;
  result.summary.observedStepSeconds = maxObservedStepSeconds;
  result.summary.largestObservedStepSeconds = largestObservedStepSeconds;
  result.summary.oversizedTimelineStepCount = oversizedTimelineStepCount;
  result.summary.nonMonotonicTimelineStepCount = nonMonotonicTimelineStepCount;
  result.summary.durationOverrunSeconds = durationOverrunSeconds;
  check('timeline clock steps remain within 2 seconds',
    oversizedTimelineStepCount === 0 && nonMonotonicTimelineStepCount === 0,
    'Timeline observed ' + oversizedTimelineStepCount + ' steps over 2s and ' + nonMonotonicTimelineStepCount + ' backwards steps; largest observed step was ' + largestObservedStepSeconds.toFixed(3) + 's');
  check('natural duration matches the nominal duration plus observed frame step',
    naturalDurationSeconds >= nominalDurationSeconds &&
      naturalDurationSeconds <= nominalDurationSeconds + allowedDurationOverrunSeconds,
    'Natural entry elapsed ' + naturalDurationSeconds.toFixed(3) + 's; nominal ' + nominalDurationSeconds.toFixed(3) + 's, maximum normal step ' + maxObservedStepSeconds.toFixed(3) + 's, allowed overrun ' + allowedDurationOverrunSeconds.toFixed(3) + 's');
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
  check('entry text controls have safe defaults and 24 character limits',
    manualSettings.entryWelcomeValue === 'Internal DataBase' &&
      manualSettings.entryIdentityValue === 'Kristen Wright' &&
      manualSettings.entryWelcomeMaxLength === 24 &&
      manualSettings.entryIdentityMaxLength === 24,
    'The interface settings must expose the default welcome and identity with 24 character limits');
  check('interface settings retain the interaction and entry category',
    /interface.*interaction|界面与交互/i.test(manualSettings.settingsInterfaceLabel ?? ''),
    'The Settings category should be labelled Interface & Interaction');
  check('entry text controls advertise ASCII words and spaces',
    /A-Z/.test(manualSettings.entryWelcomePattern ?? '') &&
      /a-z/.test(manualSettings.entryWelcomePattern ?? '') &&
      /A-Z/.test(manualSettings.entryIdentityPattern ?? '') &&
      /a-z/.test(manualSettings.entryIdentityPattern ?? '') &&
      /letter|字母/i.test(manualSettings.entrySettingsText ?? '') &&
      /space|空格/i.test(manualSettings.entrySettingsText ?? '') &&
      /24/.test(manualSettings.entrySettingsText ?? ''),
    'Entry text settings must describe the English letter/word-space restriction and 24 character limit');
  check('entry copy counters and status are present',
    /17\s*\/\s*24/.test(manualSettings.entryWelcomeCount ?? '') &&
      /14\s*\/\s*24/.test(manualSettings.entryIdentityCount ?? '') &&
      /letter|字母/i.test(manualSettings.entryTextHelp ?? '') &&
      /space|空格/i.test(manualSettings.entryTextHelp ?? '') &&
      /24/.test(manualSettings.entryTextHelp ?? '') &&
      manualSettings.entryTextStatus !== null &&
      manualSettings.entryTextResetDisabled === false,
    'The entry settings must show character counters, a status area and an enabled reset control');
  await exerciseEntryTextValidation('entry text input validation');
  const customSettings = await setEntryTextFromUI('Private Archive', 'Ada Lovelace', 'custom entry copy');
  check('custom entry copy updates counters',
    /15\s*\/\s*24/.test(customSettings.entryWelcomeCount ?? '') &&
      /12\s*\/\s*24/.test(customSettings.entryIdentityCount ?? ''),
    'Counters should reflect the saved custom values including spaces');
  // The settings page and its View Transition have separate animation clocks.
  // Inspect the settled control panel rather than the outgoing archive snapshot.
  await pause(650);
  await screenshot('settings-entry-control-auto-off', customSettings);
  await click('[data-action="entry-replay"]');
  const manualReplay = await waitFor(state =>
    state.entry?.active === true && state.overlayPresent && state.settingsHidden === true &&
      state.welcomeDatabase === 'Private Archive',
  'manual replay starts from the settings page', 8000);
  check('manual replay uses the Future matrix',
    manualReplay.design === 'rhine' && manualReplay.stats.displayLayout?.effective === 'array',
    'Manual replay must use the Future matrix composition');
  const manualIdentity = await waitForAuthIdentity('Ada Lovelace', 'manual replay custom identity');
  check('manual replay uses the saved identity',
    manualIdentity.authIdentity.includes('Ada Lovelace'),
    'The auth line must show the saved identity after typing completes');
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
  check('custom copy survives renderer reload',
    automaticOnReady.welcomeDatabase === 'Private Archive' &&
      getPreferences().entryWelcome === 'Private Archive' &&
      getPreferences().entryIdentity === 'Ada Lovelace',
    'Saved entry text must survive a renderer reload and populate the next entry');
  const automaticOnIdentity = await waitForAuthIdentity('Ada Lovelace', 'automatic replay custom identity');
  check('automatic replay uses the saved identity',
    automaticOnIdentity.authIdentity.includes('Ada Lovelace'),
    'The automatic auth line must show the saved identity after typing completes');
  sendKey('ENTER');
  await assertArchiveOverview('automatic entry enabled Enter skip');

  await openInterfaceSettings('empty entry text fallback');
  await evaluate(`(() => {
    const welcome = document.querySelector('#entry-welcome[data-entry-text="entryWelcome"]');
    welcome.value = '';
    welcome.dispatchEvent(new Event('input', { bubbles: true }));
    welcome.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(state => getPreferences().entryWelcome === 'Internal DataBase' && state.entryWelcomeValue === 'Internal DataBase',
    'empty welcome change restores its default');
  await click('[data-action="entry-text-reset"]');
  await assertEntryTextDefaults('entry text reset');
  await setEntryTextFromUI('W'.repeat(24), 'Ada Lovelace', '24 character welcome');
  await click('[data-action="entry-replay"]');
  const wideWelcomeReplay = await waitFor(state =>
    state.entry?.active === true && state.welcomeDatabase === 'W'.repeat(24) &&
      state.welcomeLineWidth > 0 &&
      state.welcomeLineScrollWidth <= state.welcomeLineWidth + 1 &&
      state.welcomeLineFontSize >= 18 && state.welcomeLineFontSize < 36,
  '24 wide letters fit the welcome line', 8000);
  check('24 wide letters fit the 480px welcome line',
    wideWelcomeReplay.welcomeLineScrollWidth <= wideWelcomeReplay.welcomeLineWidth + 1 &&
      wideWelcomeReplay.welcomeLineFontSize >= 18 && wideWelcomeReplay.welcomeLineFontSize < 36,
    'The welcome text should shrink once to a readable size without overflowing its 480px line');
  const wideWelcomeVisible = await waitFor(state =>
    state.entry?.active === true && state.entry.phase === 'welcome' && state.entry.time >= 20.4 &&
      state.welcomeDatabase === 'W'.repeat(24) &&
      state.welcomeLineScrollWidth <= state.welcomeLineWidth + 1 &&
      state.welcomeLineFontSize >= 18 && state.welcomeLineFontSize < 36,
  '24 wide letters visible in the welcome phase', 25000);
  await screenshot('welcome-24-wide-letters', wideWelcomeVisible);
  await click('.future-entry-skip');
  await assertArchiveOverview('24 character welcome skip');
  await openInterfaceSettings('restore default copy');
  await click('[data-action="entry-text-reset"]');
  await assertEntryTextDefaults('restore default copy');
  await click('[data-action="settings"]');
  await waitFor(state => state.settingsHidden === true, 'close text reset settings');

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

  await click('[data-action="settings"]');
  await waitFor(state => state.settingsHidden === false, 'general settings page');
  await click('[data-action="settings-category"][data-settings-category-target="interface"]');
  const interfaceSettings = await waitFor(state => state.settingsHidden === false &&
    state.interfaceCategoryHidden === false && state.interfaceNavCurrent && state.settingsHasLanguageControl,
    'interface settings category');
  check('interface settings keep language, STYLE link, motion and interaction entry controls',
    interfaceSettings.settingsHasInterfaceSettings &&
      interfaceSettings.settingsHasLanguageControl &&
      interfaceSettings.settingsHasLanguageApply &&
      interfaceSettings.settingsHasGraphicsLink &&
      interfaceSettings.settingsHasMotionSettingsInInterface &&
      interfaceSettings.settingsHasEntrySettingsInInterface &&
      interfaceSettings.settingsHasInterfaceSoundInInterface &&
      !interfaceSettings.settingsHasThemeCards &&
      /interface.*interaction|界面与交互/i.test(interfaceSettings.settingsInterfaceLabel ?? ''),
    'Interface must own language, the STYLE jump, motion, entry and interface-sound settings');
  await screenshot('settings-interface-controls', interfaceSettings);
  await click('#interface-settings [data-action="theme"]');
  const linkedStyle = await waitFor(state => state.page === 'theme' && state.graphicsPageOpen && state.graphicsTitle === 'STYLE',
    'STYLE opened from the interface settings link');
  check('interface settings link opens STYLE', linkedStyle.page === 'theme' && linkedStyle.graphicsTitle === 'STYLE',
    'The interface settings appearance link must navigate to STYLE');
  await closeStyle('interface settings STYLE link');
  await click('[data-action="settings"]');
  await waitFor(state => state.settingsHidden === false, 'reopen Settings after STYLE link');
  await click('[data-action="settings-category"][data-settings-category-target="appearance"]');
  const appearanceSettings = await waitFor(state => state.settingsHidden === false &&
    state.appearanceCategoryHidden === false && state.appearanceNavCurrent && state.settingsAppearanceHasDisplaySettings,
    'display and performance settings category');
  check('appearance settings own display and performance controls',
    appearanceSettings.settingsAppearanceHasDisplaySettings &&
      appearanceSettings.graphicsHasWindowAspect &&
      appearanceSettings.graphicsHasFullscreen &&
      appearanceSettings.graphicsHasGpu &&
      appearanceSettings.graphicsHasQuality &&
      appearanceSettings.graphicsHasQualityDetection &&
      !appearanceSettings.settingsAppearanceHasLanguageControl &&
      !appearanceSettings.settingsAppearanceHasMotionSettings &&
      /display.*performance|显示与性能/i.test(appearanceSettings.appearanceNavLabel ?? ''),
    'Appearance compatibility ID must contain display and performance settings only');
  await screenshot('settings-display-performance', appearanceSettings);
  await click('[data-action="settings"]');
  await waitFor(state => state.settingsHidden === true, 'close Settings');

  await setPreferences({
    ...getPreferences(),
    entryOnOpen: false,
    reduced: false,
    style: { ...getPreferences().style, design: 'rhine' },
    view: { ...getPreferences().view, layout: 'array', show: 'albums' },
  });
  await reloadAndWait('Future Graphics route', false);
  await assertArchiveOverview('Future Graphics route');
  await openStyle('Future STYLE route');
  const futureGraphics = await waitFor(state => state.graphicsHasStyleCard && state.graphicsPageOpen,
    'Future STYLE controls');
  check('Future STYLE title and topbar label',
    futureGraphics.page === 'theme' && futureGraphics.graphicsTitle === 'STYLE' &&
      /STYLE/i.test(futureGraphics.graphicsNavLabel ?? '') && /STYLE/i.test(futureGraphics.graphicsStyleKicker ?? ''),
    'The theme route, page title, navigation label and kicker must read STYLE');
  check('Future STYLE contains appearance previews without interface or display controls',
    futureGraphics.graphicsHasStyleCard &&
      futureGraphics.graphicsHasColorChoices &&
      futureGraphics.graphicsHasCaseEditor &&
      futureGraphics.graphicsHasScenePreview &&
      futureGraphics.graphicsHasThemeControls &&
      futureGraphics.graphicsStyleQualitySlotEmpty &&
      futureGraphics.graphicsStyleCaseEditorBeforeQualitySlot &&
      !futureGraphics.graphicsStyleHasForbiddenControls,
    'STYLE must retain theme, colour and scene appearance controls while display and interface settings stay in Settings');
  await screenshot('future-style', futureGraphics);
  await closeStyle('Future STYLE route');

  await setPreferences({
    ...getPreferences(),
    entryOnOpen: true,
    style: { ...getPreferences().style, design: 'archive' },
    view: { ...getPreferences().view, layout: 'grid', show: 'albums' },
  });
  const punkReady = await reloadAndWait('Punk entry unsupported', false);
  check('Punk has no Future entry overlay',
    punkReady.design === 'archive' && punkReady.entry?.active === false && !punkReady.overlayPresent,
    'Punk must not show the Future entry');
  const punkSettings = await openInterfaceSettings('Punk entry settings');
  check('Punk keeps a disabled entry settings stub',
    punkSettings.entrySettingsPresent &&
      punkSettings.entryControlsInSection &&
      punkSettings.entryOnOpenDisabled === true &&
      punkSettings.entryReplayDisabled === true &&
      punkSettings.entryWelcomeDisabled === true &&
      punkSettings.entryIdentityDisabled === true &&
      punkSettings.entryTextResetDisabled === true &&
      /later|future|后续适配/i.test(punkSettings.entrySettingsText ?? ''),
    'Punk should retain the entry settings section with disabled controls and a future adaptation note');
  const punkPrefsBeforeForgery = getPreferences();
  const punkSavesBeforeForgery = probeReport?.preferenceSaves?.length ?? 0;
  await evaluate(`(() => {
    const automatic = document.querySelector('#entry-on-open');
    const welcome = document.querySelector('#entry-welcome[data-entry-text="entryWelcome"]');
    const identity = document.querySelector('#entry-identity[data-entry-text="entryIdentity"]');
    automatic.checked = !automatic.checked;
    welcome.value = 'Changed Copy';
    identity.value = 'Changed Identity';
    automatic.dispatchEvent(new Event('change', { bubbles: true }));
    welcome.dispatchEvent(new Event('change', { bubbles: true }));
    identity.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-action="entry-text-reset"]')?.click();
    document.querySelector('[data-action="entry-replay"]')?.click();
  })()`);
  await pause(250);
  check('forged Punk settings changes do not alter Future preferences',
    getPreferences().entryOnOpen === punkPrefsBeforeForgery.entryOnOpen &&
      getPreferences().entryWelcome === punkPrefsBeforeForgery.entryWelcome &&
      getPreferences().entryIdentity === punkPrefsBeforeForgery.entryIdentity &&
      (probeReport?.preferenceSaves?.length ?? 0) === punkSavesBeforeForgery,
    'Synthetic change events on disabled Punk controls must not write Future entry preferences');
  check('Punk replay remains absent',
    !(await snapshot()).overlayPresent,
    'Punk must not create the Future entry overlay from disabled controls');
  await screenshot('punk-entry-settings-disabled', await snapshot());
  await click('[data-action="settings"]');
  await waitFor(state => state.settingsHidden === true, 'close Punk entry settings');
  await openStyle('Punk STYLE route');
  const punkGraphics = await waitFor(state => state.graphicsHasStyleCard && state.graphicsPageOpen,
    'Punk STYLE controls');
  check('Punk STYLE title and appearance controls',
    punkGraphics.design === 'archive' &&
      punkGraphics.page === 'theme' &&
      punkGraphics.graphicsTitle === 'STYLE' &&
      /STYLE/i.test(punkGraphics.graphicsNavLabel ?? '') &&
      /STYLE/i.test(punkGraphics.graphicsStyleKicker ?? '') &&
      punkGraphics.graphicsHasColorChoices &&
      punkGraphics.graphicsHasCaseEditor &&
      punkGraphics.graphicsHasScenePreview &&
      punkGraphics.graphicsHasThemeControls &&
      punkGraphics.graphicsStyleQualitySlotEmpty &&
      punkGraphics.graphicsStyleCaseEditorBeforeQualitySlot &&
      !punkGraphics.graphicsStyleHasForbiddenControls,
    'Punk STYLE must keep only the shared appearance and preview controls');
  await screenshot('punk-style', punkGraphics);
  await closeStyle('Punk STYLE route');

  result.summary = {
    nominalDurationSeconds,
    naturalDurationSeconds,
    durationOverrunSeconds,
    observedStepSeconds: maxObservedStepSeconds,
    largestObservedStepSeconds,
    oversizedTimelineStepCount,
    nonMonotonicTimelineStepCount,
    capturedPhases: Array.from(capturedPhases),
    screenshotCount: result.screenshots.length,
    handoffDelta,
    finalTheme: punkGraphics.theme,
    finalLayout: punkGraphics.stats?.displayLayout?.effective ?? null,
    finalDesign: punkGraphics.design,
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
