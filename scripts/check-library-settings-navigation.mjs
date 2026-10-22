import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";

const { librarySettingsSections, setupLibrarySettingsNavigation } = await import(
  "../src/library-settings-navigation.ts"
);

class MockEvent {
  constructor(type, target, key = "") {
    this.type = type;
    this.target = target;
    this.key = key;
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class MockElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.hidden = false;
    this.textContent = "";
    this.className = "";
    this.type = "";
    this._id = "";
    this._tabIndex = 0;
  }

  set id(value) {
    this._id = String(value);
    this.attributes.set("id", this._id);
  }

  get id() {
    return this._id;
  }

  set tabIndex(value) {
    this._tabIndex = Number(value);
    this.attributes.set("tabindex", String(this._tabIndex));
  }

  get tabIndex() {
    return this._tabIndex;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }

  insertBefore(node, reference) {
    node.remove();
    const index = this.children.indexOf(reference);
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
    node.parentElement = this;
    return node;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name.toLowerCase(), text);
    if (name.toLowerCase() === "id") this._id = text;
    if (name.toLowerCase() === "tabindex") this._tabIndex = Number(text);
  }

  getAttribute(name) {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name.toLowerCase());
    if (name.toLowerCase() === "id") this._id = "";
    if (name.toLowerCase() === "tabindex") this._tabIndex = 0;
  }

  addEventListener(type, callback, options = {}) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, signal: options.signal });
    this.listeners.set(type, listeners);
  }

  dispatch(type, target, key = "") {
    const event = new MockEvent(type, target, key);
    for (const listener of this.listeners.get(type) ?? []) {
      if (!listener.signal?.aborted) listener.callback(event);
    }
    return event;
  }

  closest(selector) {
    if (selector === "[data-library-tab]" && this.dataset.libraryTab) return this;
    return null;
  }

  contains(target) {
    return this === target || this.children.some((child) => child.contains(target));
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]);
    if (selector === "[data-library-section]") {
      return descendants.filter((node) => Boolean(node.dataset.librarySection));
    }
    return [];
  }

  querySelector(selector) {
    if (selector.startsWith('[data-library-section="')) {
      const id = selector.slice('[data-library-section="'.length, -2);
      return this.querySelectorAll("[data-library-section]").find((node) => node.dataset.librarySection === id) ?? null;
    }
    return null;
  }
}

class MockDocument {
  activeElement = null;

  createElement(tagName) {
    return new MockElement(tagName, this);
  }
}

const document = new MockDocument();
const root = document.createElement("section");
const heading = document.createElement("h2");
const intro = document.createElement("p");
root.append(heading, intro);
const panelChildren = new Map();
for (const { id } of librarySettingsSections) {
  const panel = document.createElement("section");
  panel.dataset.librarySection = id;
  const child = document.createElement("button");
  child.dataset.marker = id;
  panel.append(child);
  root.append(panel);
  panelChildren.set(id, child);
}

const changes = [];
const navigation = setupLibrarySettingsNavigation(root, "folders", (section) => changes.push(section));
const nav = root.children.find((child) => child.className === "library-settings-nav");
const context = root.children.find((child) => child.className === "library-settings-context");
assert.ok(nav, "navigation is inserted inside its settings category");
assert.ok(context, "current location is inserted inside its settings category");
assert.equal(nav.getAttribute("role"), "tablist");
assert.deepEqual(changes, ["folders"], "mount reports the initial section once");

function panel(id) {
  return root.querySelector(`[data-library-section="${id}"]`);
}

function tab(id) {
  return nav.children.find((child) => child.dataset.libraryTab === id);
}

assert.equal(panel("folders").hidden, false);
assert.equal(panel("classification").hidden, true);
assert.equal(panel("folders").getAttribute("role"), "tabpanel");
assert.equal(panel("folders").getAttribute("aria-labelledby"), "library-settings-tab-folders");
assert.equal(tab("folders").getAttribute("aria-selected"), "true");
assert.equal(tab("classification").tabIndex, -1);

nav.dispatch("click", tab("metadata"));
assert.equal(panel("metadata").hidden, false);
assert.equal(tab("metadata").getAttribute("aria-selected"), "true");
assert.equal(panel("metadata").contains(panelChildren.get("metadata")), true, "tab changes preserve panel children");
assert.deepEqual(changes, ["folders", "metadata"]);

const endKey = nav.dispatch("keydown", tab("metadata"), "End");
assert.equal(endKey.defaultPrevented, true);
assert.equal(panel("providers").hidden, false);
assert.equal(document.activeElement, tab("providers"), "keyboard navigation focuses the selected tab");
assert.equal(context.children[0].textContent, "音乐库 / 资料来源");

navigation.select("providers");
assert.deepEqual(changes, ["folders", "metadata", "providers"], "selecting the current tab does not repeat the callback");
navigation.select("classification", true);
assert.equal(document.activeElement, tab("classification"));
assert.equal(panel("classification").contains(panelChildren.get("classification")), true);

navigation.destroy();
assert.equal(root.children.includes(nav), false);
assert.equal(root.children.includes(context), false);
for (const { id } of librarySettingsSections) {
  assert.equal(panel(id).hidden, false, "destroy restores the panel's original visibility");
  assert.equal(panel(id).getAttribute("role"), null, "destroy restores panel attributes");
  assert.equal(panel(id).contains(panelChildren.get(id)), true, "destroy keeps panel contents");
}
nav.dispatch("click", tab("folders"));
assert.deepEqual(changes, ["folders", "metadata", "providers", "classification"], "destroy removes active listeners");

const require = createRequire(import.meta.url);
const ts = require("typescript");
const appText = await readFile(new URL("../src/music-app.ts", import.meta.url), "utf8");
const appAst = ts.createSourceFile("music-app.ts", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const requestedFunctions = [
  "rememberLocalLibrarySettings",
  "receiveLocalLibrarySettings",
  "syncLocalLibrarySettings",
  "ensureLibrarySettingsSection",
  "renderLibraryConnectionSettings",
];
const functionNodes = new Map();
for (const name of requestedFunctions) {
  const node = appAst.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(node, `music-app.ts defines ${name}`);
  functionNodes.set(name, node);
}

let receiveReload = false;
function findReloadCall(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "location"
    && node.expression.name.text === "reload") receiveReload = true;
  ts.forEachChild(node, findReloadCall);
}
findReloadCall(functionNodes.get("receiveLocalLibrarySettings"));
const receiveLibraryNode = appAst.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "receiveLibrary",
);
assert.ok(receiveLibraryNode, "music-app.ts defines receiveLibrary");
findReloadCall(receiveLibraryNode);
assert.equal(receiveReload, false, "library receipt and scan completion do not reload the page");

function makeLibrary(prefix, { scanRunning = false, finishedAt = 0 } = {}) {
  return {
    roots: [{ path: `${prefix}-root` }],
    albums: [
      { id: `${prefix}-album` },
      { id: "ftp-remote-album" },
      { id: "online-source-album" },
    ],
    genres: [{ id: "rock" }, { id: "ftp-library" }],
    scan: { running: scanRunning, finishedAt, error: "" },
    enrich: { running: false },
    introductions: { running: false },
  };
}

class SettingsHost {
  constructor() {
    this.childElementCount = 0;
    this.isConnected = true;
    this.draftState = null;
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.childElementCount = this._innerHTML ? 1 : 0;
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

function createAppHarness() {
  const onlineLibrary = makeLibrary("online-shelf");
  const folderHost = new SettingsHost();
  const genreHost = new SettingsHost();
  const configHost = new SettingsHost();
  const sourcesHost = new SettingsHost();
  const hosts = new Map([
    ["#library-page-body", folderHost],
    ["#genre-rules-host", genreHost],
    ["#online-config", configHost],
    ["#album-info-sources-settings", sourcesHost],
  ]);
  const received = [];
  const requests = [];
  const calls = { folderRender: 0, genreEdit: 0, sourceMount: 0, pathRender: 0 };
  const sandbox = {
    library: onlineLibrary,
    localSettingsLibrary: makeLibrary("cached-local", { scanRunning: true }),
    localSettingsReady: false,
    shelf: "online",
    libraryDraftRoots: ["draft-root"],
    libraryDraftDirty: false,
    selectedLibraryRoot: 0,
    choosingLibraryFolder: false,
    scanSubmitting: false,
    isLibrarySettings: () => true,
    document: { querySelector: (selector) => hosts.get(selector) ?? null },
    renderLibraryPaths: () => { calls.pathRender += 1; },
    renderLibraryPage: () => { calls.folderRender += 1; folderHost.innerHTML = "folder controls"; },
    updateScanStatus() {},
    updateIntroductionStatus() {},
    editGenres: () => {
      calls.genreEdit += 1;
      genreHost.innerHTML = "genre editor";
      genreHost.draftState = { marker: "unsaved rule draft" };
    },
    receiveLibrary: async (next, force = false) => {
      received.push({ next, force });
      sandbox.library = next;
      sandbox.__librarySettingsFns.rememberLocalLibrarySettings(next);
    },
    renderLibraryConnectionSettings: undefined,
    cleanupAlbumInfoSources: undefined,
    albumInfoEditor: {
      mountSources(host) {
        calls.sourceMount += 1;
        host.innerHTML = "source editor";
        return () => {};
      },
    },
    request: async (path) => {
      requests.push(path);
      return { musicBrainzContact: "", musicBrainzConfigured: true, onlineEnabled: false };
    },
    notify() {},
    uiLanguage: () => "zh-CN",
    trUi: (value) => value,
    esc: (value) => String(value),
    ui: (strings, ...values) => strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  };
  const declarations = requestedFunctions.map((name) => functionNodes.get(name).getText(appAst)).join("\n");
  const expose = `\nglobalThis.__librarySettingsFns = { ${requestedFunctions.join(", ")} };`;
  const code = ts.transpile(`${declarations}${expose}`, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  });
  vm.runInNewContext(code, sandbox, { filename: "music-app-library-settings-functions.js" });
  return { sandbox, onlineLibrary, folderHost, genreHost, configHost, sourcesHost, received, requests, calls };
}

const app = createAppHarness();
const fns = app.sandbox.__librarySettingsFns;
const localScan = makeLibrary("local-scan-result", { finishedAt: 10 });
await fns.receiveLocalLibrarySettings(localScan, true);
assert.equal(app.sandbox.library, app.onlineLibrary, "online shelf keeps its active library snapshot");
assert.equal(app.received.length, 0, "online shelf does not proxy local scan results to receiveLibrary");
assert.equal(app.sandbox.localSettingsLibrary.roots[0].path, "local-scan-result-root");
assert.deepEqual(
  Array.from(app.sandbox.localSettingsLibrary.albums, (album) => album.id),
  ["local-scan-result-album"],
  "local settings projection filters FTP and online albums",
);
assert.deepEqual(Array.from(app.sandbox.localSettingsLibrary.genres, (genre) => genre.id), ["rock"]);

app.sandbox.libraryDraftDirty = true;
app.sandbox.libraryDraftRoots = ["unsaved-root-a", "unsaved-root-b"];
app.sandbox.selectedLibraryRoot = 1;
fns.syncLocalLibrarySettings();
assert.deepEqual(Array.from(app.sandbox.libraryDraftRoots), ["unsaved-root-a", "unsaved-root-b"], "dirty folder drafts are preserved");
app.sandbox.libraryDraftDirty = false;
app.sandbox.selectedLibraryRoot = 99;
app.sandbox.localSettingsLibrary.roots = [{ path: "saved-root-a" }, { path: "saved-root-b" }];
fns.syncLocalLibrarySettings();
assert.deepEqual(Array.from(app.sandbox.libraryDraftRoots), ["saved-root-a", "saved-root-b"], "clean drafts refresh from saved roots");
assert.equal(app.sandbox.selectedLibraryRoot, 1, "selection is clamped after saved roots refresh");

app.sandbox.shelf = "local";
const localMetadata = makeLibrary("local-metadata-result");
await fns.receiveLocalLibrarySettings(localMetadata, true);
assert.equal(app.received.length, 1, "local shelf proxies local results to receiveLibrary");
assert.equal(app.received[0].next, localMetadata);
assert.equal(app.received[0].force, true, "local shelf forwards the force flag");

for (const section of ["folders", "classification", "providers", "folders", "classification", "providers"]) {
  fns.ensureLibrarySettingsSection(section);
}
await Promise.resolve();
assert.equal(app.calls.folderRender, 1, "repeated folder tabs keep the existing folder host");
assert.equal(app.calls.genreEdit, 1, "repeated classification tabs keep the existing rule editor and draft");
assert.equal(app.calls.sourceMount, 1, "repeated provider tabs do not remount source settings");
assert.equal(app.requests.filter((path) => path === "/api/config").length, 1, "provider connection host loads once");
assert.equal(app.genreHost.draftState.marker, "unsaved rule draft");
assert.equal(app.folderHost, app.sandbox.document.querySelector("#library-page-body"));
assert.equal(app.sourcesHost.childElementCount, 1);

console.log("Library settings navigation checks passed.");
