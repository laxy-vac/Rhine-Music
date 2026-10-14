import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const functionNames = [
  "syncArchiveTab",
  "syncThemeButtons",
  "syncDesignIdentity",
  "switchDesign",
  "setMode",
  "closeManagementPage",
  "openArchivePage",
  "openThemePage",
];

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** Put the actual navigation functions and the final production key handler in the DOM fixture scope. */
export function createManagementNavigationBootstrap(source) {
  const sourceFile = ts.createSourceFile("music-app.ts", source, ts.ScriptTarget.Latest, true);
  const functions = new Map();
  let keydownCallback;
  let keydownLine = 0;
  let clickCallback;
  let clickLine = 0;

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && functionNames.includes(statement.name.text))
      functions.set(statement.name.text, statement);
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.expression.getText(sourceFile) !== "document" ||
      call.expression.name.text !== "addEventListener" || !ts.isStringLiteral(call.arguments[0])) continue;
    if (call.arguments[0].text === "keydown") {
      keydownCallback = call.arguments[1];
      keydownLine = lineOf(sourceFile, statement);
    }
    if (call.arguments[0].text === "click" && call.arguments[1]?.getText(sourceFile).includes("target.dataset.styleDesign")) {
      clickCallback = call.arguments[1];
      clickLine = lineOf(sourceFile, statement);
    }
  }

  for (const name of functionNames) assert.ok(functions.has(name), `Production music-app function ${name} was not found.`);
  assert.ok(keydownCallback && (ts.isArrowFunction(keydownCallback) || ts.isFunctionExpression(keydownCallback)),
    "The final production document keydown callback was not found.");
  assert.ok(clickCallback, "The production navigation button handler was not found.");
  const extracted = [...functions.values()].map(node => node.getText(sourceFile)).join("\n\n") +
    `\nconst productionGlobalKeydown = ${keydownCallback.getText(sourceFile)};` +
    `\nconst productionGlobalClick = ${clickCallback.getText(sourceFile)};`;
  const javascript = ts.transpileModule(extracted, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sourceLines = Object.fromEntries([...functions].map(([name, node]) => [name, lineOf(sourceFile, node)]));
  sourceLines.globalKeydown = keydownLine;
  sourceLines.globalClick = clickLine;

  return `(() => {
    const stage = fixture.stage;
    const $ = selector => stage.querySelector(selector) ?? document.querySelector(selector);
    const musicApplication = fixture.musicApplication;
    const albumPanel = fixture.sharedPanel;
    const foobarShell = fixture.shell;
    const catalogGrid = undefined;
    const audioInfoPopup = fixture.audioInfoPopup;
    const albumQueue = fixture.albumQueue;
    const albums = [fixture.albumMock];
    const records = [{ id: fixture.albumMock.id }];
    const ready = true;
    const pageStates = [];
    const keyEvents = [];
    const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
    let page = "music";
    let pageFocus = null;
    let themePageScrollTop = 0;
    let eqPageScrollTop = 0;
    let eqPresetsExpanded = false;
    let settingsCategory = "audio";
    const settingsScrollPositions = new Map();
    let cleanupStylePreview;
    let cleanupQualityDetection;
    let caseEditor;
    let settingsSelectControls;
    let eqControls;
    let lyricsSettings;
    let panel = null;
    let libraryRebuilding = false;
    let libraryIntent;
    let libraryDraftRoots = [];
    let selectedLibraryRoot = -1;
    let stopFoobarIntro;
    const sortLabel = { code: "GENRE" };
    const isLibrarySettings = () => page === "settings" && settingsCategory === "library";
    let pageScan;
    let detailTransition;
    let browseTransition;
    let presentation;
    let fixtureReduced = false;
    let activeViewTransitions = [];
    let viewTransitionMode = "native";
    const nativeStartViewTransition = typeof document.startViewTransition === "function"
      ? document.startViewTransition.bind(document) : undefined;
    const preferences = {
      reduced: false,
      theme: "day",
      windowAspect: "16:9",
      style: { design: "archive", scheme: "rhine", caseStyle: "rhine", textScale: 1 },
    };
    const designProfiles = {
      rhine: { style: { ...preferences.style, design: "rhine" }, mode: "day" },
      archive: { style: { ...preferences.style, design: "archive" }, mode: "day" },
    };
    const caseProfiles = { rhine: {}, archive: {} };
    const themeNames = { day: "LIGHT", night: "DARK" };
    const boot = { active: false };
    const viewer = { isOpen: false, setTheme() {} };
    const player = { state: fixture.state };
    const scene = {
      cameraMode: "archive", calls: [],
      setMode(mode) { this.cameraMode = mode; this.calls.push(mode); },
      setTheme() {}, setMusicStyle() {}, resize() {},
      setCaseSettings() { return Promise.resolve(); },
    };
    const effects = { play() {}, setScene() {} };
    const lyricsPage = { setVisible() {}, update() {} };
    const signalPage = { setVisible() {}, update() {} };
    const syncSelectionMotion = () => {};
    const cancelTrackReveal = () => {};
    const finishProcessingEdit = () => {};
    const notify = () => {};
    const renderEqPage = () => {};
    const renderThemePage = () => {
      $("#theme-page-content").innerHTML = "<div data-navigation-fixture-content></div>";
    };
    const enhanceSettingsSelectControls = () => ({ close() {}, destroy() {} });
    const currentAlbum = () => fixture.albumMock;
    const currentLyricsAlbum = () => fixture.albumMock;
    const applyStylePalette = (root, style, theme) => {
      root.dataset.design = style.design;
      root.dataset.theme = theme;
      root.dataset.styleTextScale = "1";
    };
    const applyWindowAspect = () => {};
    const stylePalette = (_style, theme) => ({ bg: theme === "night" ? "#07111f" : "#eae5e1" });
    const normalizeMusicStyle = style => ({ ...style });
    const savePrefs = () => {};
    const updateSelection = () => fixture.renderSourceDetail();
    const fit = () => {};
    const closePanel = after => { after?.(); };
    const showBrowseSurface = () => {
      browseTransition.show(preferences.reduced);
      albumPanel.setVisible(true, false);
    };
    const eqPageRoot = $("#music-eq-page");
    const lyricsPageRoot = $("#music-lyrics-page");
    const signalPageRoot = $("#music-signal-page");
    const settingsPageRoot = $("#music-settings");
    const themePageRoot = $("#music-theme-page");
    const emptyRoot = $("#music-empty");
    const browseRoot = $("#music-browse");
    const detailRoot = $("#music-detail");
    const sceneRoot = $("#three-scene");
    const styles = () => ({ ...preferences.style });

    function configureViewTransition(mode) {
      viewTransitionMode = mode;
      activeViewTransitions = [];
      const start = mode === "native" && nativeStartViewTransition
        ? update => {
            const transition = nativeStartViewTransition(update);
            activeViewTransitions.push(transition);
            return transition;
          }
        : undefined;
      Object.defineProperty(document, "startViewTransition", {
        configurable: true, writable: true, value: start,
      });
    }
    async function settleViewTransitions() {
      const transitions = activeViewTransitions.splice(0);
      await Promise.all(transitions.map(transition => Promise.race([
        Promise.resolve(transition.finished).catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 2500)),
      ])));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    function newPresentation() {
      return new MusicPresentation({
        presentationReady: () => true,
        archiveReady: () => true,
        archiveInteractive: () => true,
        enterCamera: () => scene.setMode("detail"),
        returnCamera: () => scene.setMode("archive"),
        select() {}, switchDetail() {},
        mode(next) {
          musicApplication.mode = next;
          stage.dataset.mode = next;
          albumPanel.setOpen(next === "detail");
          syncSelectionMotion();
        },
        prepareMenu() {
          detailTransition.hide(true);
          fixture.renderSourceDetail();
          detailRoot.inert = true;
          detailRoot.setAttribute("aria-hidden", "true");
        },
        showMenu() {
          detailTransition.show(preferences.reduced);
          detailRoot.inert = false;
          detailRoot.setAttribute("aria-hidden", "false");
        },
        hideMenu(done) {
          detailRoot.inert = true;
          detailRoot.setAttribute("aria-hidden", "true");
          detailTransition.hide(true, done);
        },
        hideBrowse(done) {
          browseRoot.inert = true;
          browseRoot.setAttribute("aria-hidden", "true");
          browseTransition.hide(preferences.reduced, done);
        },
        showBrowse() {
          browseTransition.show(preferences.reduced);
          browseRoot.inert = false;
          browseRoot.setAttribute("aria-hidden", "false");
          albumPanel.setVisible(true, false);
        },
      });
    }
    function createTransitions() {
      detailTransition = new SurfaceTransition(detailRoot, undefined, 360, 240, "right");
      browseTransition = new SurfaceTransition(
        browseRoot, undefined, 720, 140, "up", "cubic-bezier(0.45, 0, 0.25, 1)",
        [$(".music-browse-veil"), $(".music-navigation"), $(".music-keyhint")].filter(Boolean),
      );
      pageScan = new PageScanTransition($(".music-page-scan"));
      presentation = newPresentation();
    }
    function finishSurfaces() {
      detailTransition?.finish();
      browseTransition?.finish();
      albumPanel.finish?.();
    }
    async function flush() {
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    async function waitForPage(expected) {
      const deadline = performance.now() + 6500;
      while (page !== expected && performance.now() < deadline)
        await new Promise(resolve => requestAnimationFrame(resolve));
      if (page !== expected) throw new Error("PageScanTransition did not reach " + expected + "; actual page=" + page);
      await settleViewTransitions();
      return snapshot();
    }
    function snapshot() {
      const scrollTarget = albumPanel.scrollTarget();
      return {
        page, mode: musicApplication.mode, presentationPhase: presentation.phase,
        design: preferences.style.design, theme: preferences.theme, reduced: preferences.reduced,
        selectedIndex: musicApplication.selectedIndex, selectedAlbumId: musicApplication.selectedAlbumId,
        activeTab: musicApplication.activeTab, scrollTop: scrollTarget?.scrollTop ?? 0,
        panelActive: albumPanel.active, panelHidden: albumPanel.element.hidden,
        articleHidden: $("#album-detail-content").hidden,
        articleInert: $("#album-detail-content").inert,
        pageScanHidden: $(".music-page-scan").hidden,
        viewTransitionMode, nativeViewTransition: !!nativeStartViewTransition,
        cameraMode: scene.cameraMode,
      };
    }

    ${javascript}

    const pageTitle = $("#theme-page-title");
    function prepareCase(sourceDesign, theme, reduced, transitionMode) {
      fixtureReduced = reduced;
      fixture.setReduced(reduced);
      preferences.reduced = reduced;
      preferences.theme = theme;
      preferences.style = { ...preferences.style, design: sourceDesign };
      stage.dataset.design = sourceDesign;
      stage.dataset.theme = theme;
      stage.dataset.mode = "archive";
      stage.dataset.page = "music";
      musicApplication.mode = "archive";
      musicApplication.selectedIndex = 4;
      musicApplication.selectedAlbumId = fixture.albumMock.id;
      musicApplication.activeTab = "tracks";
      musicApplication.view = { layout: "array", show: "albums", group: "genre", sort: "artist" };
      designProfiles.rhine = { style: { ...preferences.style, design: "rhine" }, mode: theme };
      designProfiles.archive = { style: { ...preferences.style, design: "archive" }, mode: theme };
      page = "music";
      pageFocus = null;
      themePageScrollTop = eqPageScrollTop = 0;
      eqPresetsExpanded = false;
      pageStates.length = 0;
      keyEvents.length = 0;
      detailRoot.hidden = true;
      detailRoot.inert = true;
      detailRoot.dataset.transition = "closed";
      browseRoot.hidden = false;
      browseRoot.inert = false;
      settingsPageRoot.hidden = true;
      eqPageRoot.hidden = true;
      lyricsPageRoot.hidden = true;
      signalPageRoot.hidden = true;
      themePageRoot.hidden = true;
      emptyRoot.hidden = true;
      sceneRoot.inert = false;
      albumPanel.setActive(true);
      albumPanel.setVisible(true, false);
      albumPanel.setOpen(false);
      foobarShell.setActive(sourceDesign === "archive");
      applyStylePalette(stage, preferences.style, theme);
      createTransitions();
      configureViewTransition(transitionMode);
      musicApplication.activeTab = "about";
      fixture.renderSharedTab("about");
      const scrollTarget = albumPanel.scrollTarget();
      if (scrollTarget) scrollTarget.scrollTop = Math.min(120, scrollTarget.scrollHeight);
    }
    async function openDetail() {
      $(".open-album[data-action=open]").click();
      finishSurfaces();
      await flush();
      presentation.update();
      finishSurfaces();
      await flush();
      const scrollTarget = albumPanel.scrollTarget();
      if (scrollTarget) scrollTarget.scrollTop = 80;
      const state = snapshot();
      if (state.mode !== "detail" || state.presentationPhase !== "detail")
        throw new Error("Production setMode(detail) did not settle into detail: " + JSON.stringify(state));
      return state;
    }
    async function openPage(name) {
      if (name !== "theme") throw new Error("Unsupported management page " + name);
      openThemePage();
      if (page !== name) await waitForPage(name);
      else await settleViewTransitions();
      return snapshot();
    }
    async function switchTo(design) {
      await switchDesign(design);
      finishSurfaces();
      await flush();
      return snapshot();
    }
    async function returnToArchive() {
      $(".music-topnav [data-action=library]").click();
      if (page !== "music") await waitForPage("music");
      else await settleViewTransitions();
      finishSurfaces();
      await flush();
      return snapshot();
    }
    function recordPage() { pageStates.push(snapshot()); }
    function resetPageScan() { pageScan = new PageScanTransition($(".music-page-scan")); }

    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      keyEvents.push({ stage: "capture", target: event.target?.id || event.target?.className || event.target?.nodeName,
        defaultPrevented: event.defaultPrevented, phase: event.eventPhase, page, mode: musicApplication.mode });
    }, true);
    document.addEventListener("keydown", productionGlobalKeydown);
    document.addEventListener("click", productionGlobalClick);
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      keyEvents.push({ stage: "bubble", target: event.target?.id || event.target?.className || event.target?.nodeName,
        defaultPrevented: event.defaultPrevented, phase: event.eventPhase, page, mode: musicApplication.mode });
    });
    createTransitions();
    window.managementNavigation = {
      sourceLines: ${JSON.stringify(sourceLines)},
      nativeViewTransition: !!nativeStartViewTransition,
      prepareCase, openDetail, openPage, switchTo, returnToArchive,
      recordPage, resetPageScan, configureViewTransition, settleViewTransitions,
      get page() { return page; }, get pageStates() { return pageStates; },
      get keyEvents() { return keyEvents; }, get state() { return snapshot(); },
      async afterEscape() { await flush(); presentation.update(); finishSurfaces(); await flush(); return snapshot(); },
      openInfoPopup() {
        audioInfoPopup.update(fixture.state);
        audioInfoPopup.toggle($(".playback-info-trigger"));
        return audioInfoPopup.isOpen;
      },
      get infoPopupOpen() { return audioInfoPopup.isOpen; },
      get presentation() { return presentation; },
      get viewTransitionMode() { return viewTransitionMode; },
      get pageTitle() { return pageTitle; },
    };
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") pageStates.push({ stage: "post-key", ...snapshot() });
    });
  })();`;
}

async function pressEscape(command) {
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

async function clickThemeBlank({ command, evaluate }) {
  const probe = await evaluate(`(() => { const page=document.querySelector('#music-theme-page').getBoundingClientRect(); const x=Math.floor(page.right-32),y=Math.floor(page.bottom-28); const target=document.elementFromPoint(x,y); return {x,y,target:target?.id||target?.className||target?.nodeName,focus:document.activeElement?.id||document.activeElement?.nodeName,tag:target?.tagName}; })()`);
  assert.ok(probe.target && !["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].includes(probe.tag), `Click must target blank non-control theme page space: ${JSON.stringify(probe)}`);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: probe.x, y: probe.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: probe.x, y: probe.y, button: "left", clickCount: 1 });
  return probe;
}

async function assertThemeEscape({ command, evaluate, expectedMode, expectedDesign, expectedTheme, reduced, clickBlank }) {
  if (clickBlank) await clickThemeBlank({ command, evaluate });
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  const result = await evaluate(`({state:managementNavigation.state,keyEvents:managementNavigation.keyEvents})`);
  assert.equal(result.state.page, "theme", "Escape on STYLE must remain on that page.");
  assert.equal(result.state.mode, expectedMode, "Escape on STYLE must preserve music mode.");
  assert.equal(result.state.design, expectedDesign);
  assert.equal(result.state.theme, expectedTheme);
  assert.equal(result.state.reduced, reduced);
  assert.ok(result.keyEvents.some(event => event.stage === "bubble" && event.target && event.defaultPrevented && event.phase === 3),
    `Production Escape handler must observe and consume Escape on STYLE: ${JSON.stringify(result.keyEvents)}`);
  return result;
}

/** Run the focused navigation regression inside the already-open Chromium fixture. */
export async function checkManagementNavigation({ command, evaluate, output }) {
  const report = { status: "running", sourceLines: await evaluate("managementNavigation.sourceLines"),
    nativeViewTransition: await evaluate("managementNavigation.nativeViewTransition"), cases: [], eventEvidence: [] };
  try {
    await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    const scenarios = [
      { sourceDesign: "archive", targetDesign: "rhine", theme: "day", reduced: false, transitionMode: "native", clickBlank: true },
      { sourceDesign: "rhine", targetDesign: "archive", theme: "night", reduced: true, transitionMode: "native", clickBlank: false },
      { sourceDesign: "archive", targetDesign: "rhine", theme: "night", reduced: false, transitionMode: "none", clickBlank: false },
    ];
    for (const { sourceDesign, targetDesign, theme, reduced, transitionMode, clickBlank } of scenarios) {
      await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
      await evaluate(`managementNavigation.prepareCase(${JSON.stringify(sourceDesign)},${JSON.stringify(theme)},${reduced},${JSON.stringify(transitionMode)})`);
      const opened = await evaluate("managementNavigation.openDetail()");
      assert.equal(opened.selectedIndex, 4); assert.equal(opened.activeTab, "about");
      assert.equal(opened.mode, "detail"); assert.equal(opened.presentationPhase, "detail");
      assert.ok(opened.scrollTop > 0, "The detail route fixture must start with a scrolled information pane.");

      await evaluate("managementNavigation.openPage('theme')");
      const switched = await evaluate(`managementNavigation.switchTo(${JSON.stringify(targetDesign)})`);
      assert.equal(switched.design, targetDesign); assert.equal(switched.mode, "detail");
      const themeEscape = await assertThemeEscape({ command, evaluate, expectedMode: "detail", expectedDesign: targetDesign, expectedTheme: theme, reduced, clickBlank });
      report.eventEvidence.push({ sourceDesign, theme, reduced, page: "theme", events: themeEscape.keyEvents });

      if (sourceDesign === "archive") {
        const popupOpened = await evaluate("managementNavigation.openInfoPopup()");
        assert.equal(popupOpened, true, "The real audio information popup must open for the same-page Escape check.");
        await pressEscape(command);
        const popupResult = await evaluate(`({state:managementNavigation.state,keyEvents:managementNavigation.keyEvents,open:managementNavigation.infoPopupOpen})`);
        assert.equal(popupResult.open, false, "The popup must consume Escape and close itself.");
        assert.equal(popupResult.state.page, "theme"); assert.equal(popupResult.state.mode, "detail");
        report.eventEvidence.push({ sourceDesign, theme, reduced, page: "theme-popup", events: popupResult.keyEvents });
      }

      const returned = await evaluate("managementNavigation.returnToArchive()");
      assert.equal(returned.page, "music");
      assert.equal(returned.mode, "detail", "ARCHIVE navigation from a management page must preserve detail mode.");
      assert.equal(returned.presentationPhase, "detail");
      assert.equal(returned.selectedIndex, 4); assert.equal(returned.selectedAlbumId, "fixture-album");
      assert.equal(returned.activeTab, "about");
      assert.equal(returned.scrollTop, opened.scrollTop, "Returning through ARCHIVE retains the information reading position.");
      assert.equal(returned.panelActive, true); assert.equal(returned.articleHidden, false);
      report.cases.push({ sourceDesign, targetDesign, theme, reduced, transitionMode, opened, switched, returned,
        managementEscapeStayed: themeEscape.state.page === "theme" });

      await pressEscape(command);
      const detailEsc = await evaluate("managementNavigation.afterEscape()");
      assert.equal(detailEsc.page, "music"); assert.equal(detailEsc.mode, "archive");
      assert.equal(detailEsc.presentationPhase, "archive");
    }

    // Exercise the no-API path with reduced motion off; PageScanTransition must run its synchronous fallback.
    await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await evaluate(`managementNavigation.prepareCase("archive","day",false,"none")`);
    await evaluate("managementNavigation.openDetail()");
    await evaluate("managementNavigation.switchTo('rhine')");
    await evaluate("managementNavigation.openPage('theme')");
    const noApi = await evaluate("managementNavigation.returnToArchive()");
    assert.equal(noApi.page, "music"); assert.equal(noApi.mode, "detail");
    report.cases.push({ sourceDesign: "archive", targetDesign: "rhine", theme: "day", reduced: false, transitionMode: "no-api", returned: noApi });

    report.status = "passed";
    report.viewTransitionPaths = {
      native: report.nativeViewTransition ? "native browser ViewTransition exercised in non-reduced cases" : "unavailable; native path could not run",
      reduced: "PageScanTransition reduced-motion fallback exercised",
      noApi: "PageScanTransition missing-API fallback exercised",
    };
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeFile(path.join(output, "management-navigation.json"), JSON.stringify(report, null, 2));
  }
  return report;
}
