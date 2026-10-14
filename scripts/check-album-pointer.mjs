import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenePath = path.join(root, "src", "scene.ts");
const source = readFileSync(scenePath, "utf8");
const sourceFile = ts.createSourceFile(scenePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const archiveScene = sourceFile.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === "ArchiveScene",
);
const bindPointer = archiveScene?.members.find(
  (node) => ts.isMethodDeclaration(node) && node.name?.getText(sourceFile) === "bindPointer",
);
assert.ok(bindPointer, "ArchiveScene.bindPointer was not found in src/scene.ts");

const transformed = ts.transpileModule(
  `class Extracted { ${bindPointer.getText(sourceFile)} }\nglobalThis.Extracted = Extracted;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
);
assert.ok(!transformed.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error), "bindPointer transpilation failed");

const cellA = { lane: 1, row: 11 };
const cellB = { lane: 1, row: 12 };
const cellC = { lane: 2, row: 11 };
const key = (cell) => `${cell.lane}:${cell.row}`;
const recordByCell = new Map([[key(cellA), 1], [key(cellB), 1], [key(cellC), 2]]);
const fileAtCell = (cell) => recordByCell.get(key(cell)) ?? -1;
const sameCell = (a, b) => a.lane === b.lane && a.row === b.row;
const fileAtSlot = (slot) => slot;

class Vector2 {
  set(x, y) { this.x = x; this.y = y; return this; }
}

class MockCanvas {
  constructor() {
    this.listeners = new Map();
    this.style = {};
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  dispatch(type, values = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 50,
      detail: 0,
      ...values,
    };
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setPointerCapture() {}
}

function makeScene(design, phase = "archive", resolveHit = (x) => x < 30 ? { cell: cellA } : x > 70 ? { cell: cellC } : null) {
  const canvas = new MockCanvas();
  const scene = {
    renderer: { domElement: canvas },
    container: { clientWidth: 100, clientHeight: 100 },
    musicStyle: { design },
    musicPresentation: { phase },
    detail: 0,
    reveal: 1,
    loaded: true,
    dragging: false,
    canInspect: false,
    selectedSlot: 1,
    selectedCell: { ...cellA },
    cursor: new Vector2(),
    pointer: new Vector2(),
    camera: {},
    instances: [{}],
    model: { visible: true },
    catalogView: true,
    displayLayout: { effective: "shelf" },
    cells: [{ ...cellA }, { ...cellB }, { ...cellC }],
    counters: { raycaster: 0 },
    selections: [],
    opened: [],
    navigations: 0,
    resolveHit,
  };
  scene.raycaster = {
    setFromCamera(cursor) {
      this.x = (cursor.x + 1) * 50;
      this.y = (1 - cursor.y) * 50;
    },
    intersectObjects() {
      scene.counters.raycaster++;
      const result = scene.resolveHit(this.x, this.y);
      if (!result) return [];
      if (result.model) return [{}];
      const instanceId = scene.cells.findIndex((cell) => sameCell(cell, result.cell));
      if (instanceId >= 0 && result.cell.foobarEntryKey) scene.cells[instanceId] = { ...result.cell };
      return instanceId >= 0 ? [{ instanceId }] : [];
    },
  };
  scene.recordAtCell = fileAtCell;
  scene.onSelect = (index, cell) => {
    scene.selections.push({ index, cell: { ...cell } });
    scene.selectedSlot = index;
    scene.selectedCell = { ...cell };
    scene.focusedKey=cell.foobarEntryKey;
  };
  scene.onOpenAlbum = (index) => scene.opened.push(index);
  scene.onNavigate = () => { scene.navigations++; };

  const sandbox = {
    THREE: { Vector2, MathUtils: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) } },
    musicLibrary: true,
    records: [{}, {}, {}],
    fileAtCell,
    fileAtSlot,
    sameCell,
    getMusicFocusedEntry:()=>scene.focusedKey?{key:scene.focusedKey}:undefined,
    getMusicCatalogShelves:()=>[{}],
    musicPointerDragThreshold:()=>12,
    swipeDirection: (dx, dy) => Math.hypot(dx, dy) > 6 ? { axis: "row", direction: 1 } : null,
    performance: { now: () => scene.now ?? 100 },
  };
  vm.runInNewContext(transformed.outputText, sandbox, { filename: "scene-bindPointer-check.js" });
  sandbox.Extracted.prototype.bindPointer.call(scene);
  return { scene, canvas };
}

function click(canvas, x, detail, pointerType = "mouse", options = {}) {
  const y = options.y ?? 50;
  const pointerId = options.pointerId ?? 1;
  canvas.dispatch("pointerdown", { pointerId, pointerType, button: 0, clientX: x, clientY: y });
  canvas.dispatch("pointerup", {
    pointerId,
    pointerType,
    clientX: options.upX ?? x,
    clientY: options.upY ?? y,
  });
  canvas.dispatch("click", { pointerType, clientX: options.upX ?? x, clientY: options.upY ?? y, detail });
}

function doubleClick(canvas, firstX = 10, secondX = firstX, pointerType = "mouse") {
  click(canvas, firstX, 1, pointerType);
  click(canvas, secondX, 2, pointerType);
  canvas.dispatch("dblclick", { pointerType, clientX: secondX, clientY: 50, detail: 2 });
}

for (const design of ["rhine", "archive"]) {
  const { scene, canvas } = makeScene(design);
  click(canvas, 10, 1);
  assert.equal(scene.opened.length, 0, `${design}: one selected click must not open`);
  assert.equal(scene.selections.length, 0, `${design}: one selected click must not reselect`);
  click(canvas, 10, 2);
  canvas.dispatch("dblclick", { clientX: 10, clientY: 50, detail: 2 });
  assert.deepEqual(scene.opened, [1], `${design}: selected double click should open exactly once`);
  canvas.dispatch("dblclick", { clientX: 10, clientY: 50, detail: 2 });
  assert.deepEqual(scene.opened, [1], `${design}: duplicate dblclick must not reopen`);
  assert.ok(scene.counters.raycaster > 0, `${design}: input must use the shared THREE raycast path`);

  const selection = makeScene(design);
  click(selection.canvas, 90, 1);
  assert.equal(selection.scene.selections.length, 1, `${design}: single click on another record should select it`);
  assert.equal(selection.scene.selections[0].index, 2, `${design}: selection should use the hit record`);
  assert.equal(selection.scene.opened.length, 0, `${design}: selecting another record must not open it`);

  const selectThenOpen = makeScene(design);
  doubleClick(selectThenOpen.canvas, 90);
  assert.deepEqual(selectThenOpen.scene.opened, [2], `${design}: double click should open the record selected by its first click`);
  assert.equal(selectThenOpen.scene.selections.length, 1, `${design}: second click must not repeat selection`);
}

for (const design of ["rhine", "archive"]) {
  const blank = makeScene(design, "archive", () => null);
  doubleClick(blank.canvas, 50);
  assert.equal(blank.scene.opened.length, 0, `${design}: blank double click must not open`);

  const crossRecord = makeScene(design);
  doubleClick(crossRecord.canvas, 10, 90);
  assert.equal(crossRecord.scene.opened.length, 0, `${design}: cross-record double click must not open`);

  const drag = makeScene(design);
  click(drag.canvas, 10, 1, "mouse", { upX: 24 });
  click(drag.canvas, 10, 2);
  drag.canvas.dispatch("dblclick", { clientX: 10, clientY: 50, detail: 2 });
  assert.equal(drag.scene.opened.length, 0, `${design}: a drag beyond its tolerance must break the double click`);

  const touch = makeScene(design);
  doubleClick(touch.canvas, 10, 10, "touch");
  assert.equal(touch.scene.opened.length, 0, `${design}: touch input must not open`);

  const transitioning = makeScene(design, "returning");
  doubleClick(transitioning.canvas);
  assert.equal(transitioning.scene.opened.length, 0, `${design}: non-archive phase must not open`);
}

const duplicateFutureCell = makeScene("rhine", "archive", (x) =>
  x < 15 ? { cell: { ...cellA, foobarEntryKey: "track-first", foobarTrackId: "first" } }
    : x < 30 ? { cell: { ...cellB, foobarEntryKey: "track-second", foobarTrackId: "second" } }
      : x > 70 ? { cell: cellC } : null,
);
doubleClick(duplicateFutureCell.canvas, 10, 20);
assert.equal(duplicateFutureCell.scene.opened.length, 0,
  "Future: distinct public entries from one parent record must not count as the same double click");

const touchSwipe = makeScene("rhine");
click(touchSwipe.canvas, 10, 1, "touch", { upX: 22 });
click(touchSwipe.canvas, 10, 2, "touch");
touchSwipe.canvas.dispatch("dblclick", { pointerType: "touch", clientX: 10, clientY: 50, detail: 2 });
assert.equal(touchSwipe.scene.opened.length, 0, "touch swipe must not open");
assert.equal(touchSwipe.scene.navigations, 1, "touch swipe should retain its existing navigation path");

const jitter=makeScene('archive');
click(jitter.canvas,10,1,'mouse',{upX:18});click(jitter.canvas,20,1,'mouse',{upX:24});
assert.deepEqual(jitter.scene.opened,[1],'Punk accepts a small mouse drift even when native click detail restarts');
const expired=makeScene('archive');expired.scene.now=100;click(expired.canvas,10,1);expired.scene.now=800;click(expired.canvas,10,1);
assert.equal(expired.scene.opened.length,0,'Punk does not combine clicks outside the 560ms interval');

const tracks=makeScene('archive','archive',x=>({cell:{...cellA,foobarEntryKey:x<15?'track-a':'track-b',foobarTrackId:x<15?'a':'b'}}));
tracks.scene.focusedKey='track-a';doubleClick(tracks.canvas,10,20);
assert.equal(tracks.scene.opened.length,0,'Two different tracks in one album are not the same double-click target');

console.log("Album pointer checks passed for both themes through the shared mocked THREE raycaster, including track identity, drag/touch/blank rules and unique open callbacks. Rendered browser hit targets are covered by check-case-system --unified-render.");
