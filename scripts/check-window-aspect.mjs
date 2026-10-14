import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import {
  fitAspectSize,
  normalizeWindowAspect,
  windowAspectRatio,
  WINDOW_ASPECTS,
} from "../src/window-aspect-model.mjs";
import { attachWindowAspect } from "../desktop/window-aspect.mjs";

const mainSource=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
const selectionSource=mainSource.slice(mainSource.indexOf('const preferenceKeys='),mainSource.indexOf('const selectAudioPresetStore='));
const selectPreferences=new Function('windowAspectModel','Buffer',selectionSource+';return selectPreferences;')({normalizeWindowAspect},Buffer);
assert.equal(selectPreferences({windowAspect:'4:3',unknownField:true}).windowAspect,'4:3');
assert.equal(selectPreferences({windowAspect:'invalid'}).windowAspect,'16:9');
assert.equal('unknownField' in selectPreferences({windowAspect:'free',unknownField:true}),false);
assert.match(mainSource,/if\(aspectChanged\)windowAspectController\?\.set\(selected.windowAspect\)/);
const packageSource=await readFile(new URL('../scripts/package-desktop.mjs',import.meta.url),'utf8');
assert.match(packageSource,/'window-aspect.mjs'/);assert.match(packageSource,/src\/window-aspect-model.mjs/);

class MockWindow extends EventEmitter {
  constructor({ bounds, frame = { width: 24, height: 48 } }) {
    super();
    this.bounds = { ...bounds };
    this.frame = { ...frame };
    this.aspectCalls = [];
    this.minimumCalls = [];
    this.boundsCalls = [];
    this.maximized = false;
    this.fullScreen = false;
    this.destroyed = false;
  }

  getBounds() {
    return { ...this.bounds };
  }

  getSize() {
    return [this.bounds.width, this.bounds.height];
  }

  getContentSize() {
    return [
      Math.max(1, this.bounds.width - this.frame.width),
      Math.max(1, this.bounds.height - this.frame.height),
    ];
  }

  setAspectRatio(value) {
    this.aspectCalls.push(value);
  }

  setMinimumSize(width, height) {
    this.minimumCalls.push([width, height]);
  }

  setBounds(value) {
    this.boundsCalls.push({ ...value });
    this.bounds = { ...value };
  }

  isMaximized() {
    return this.maximized;
  }

  isFullScreen() {
    return this.fullScreen;
  }

  isDestroyed() {
    return this.destroyed;
  }
}

function makeScreen(workArea, scaleFactor = 1) {
  const calls = [];
  const display = { workArea: { ...workArea }, scaleFactor };
  return {
    calls,
    display,
    getDisplayMatching(bounds) {
      calls.push({ ...bounds });
      return display;
    },
  };
}

function assertInArea(bounds, area) {
  assert.ok(bounds.x >= area.x, "left edge escaped work area");
  assert.ok(bounds.y >= area.y, "top edge escaped work area");
  assert.ok(bounds.x + bounds.width <= area.x + area.width, "right edge escaped work area");
  assert.ok(bounds.y + bounds.height <= area.y + area.height, "bottom edge escaped work area");
}

function assertRatio(window, aspect) {
  const [width, height] = window.getContentSize();
  const ratio = windowAspectRatio(aspect);
  assert.ok(ratio > 0);
  assert.ok(
    Math.abs(width - height * ratio) <= 1 || Math.abs(height - width / ratio) <= 1,
    `${width}x${height} is outside 1 DIP of ${aspect}`,
  );
}

assert.deepEqual(
  WINDOW_ASPECTS.map(({ id, width, height }) => [id, width, height]),
  [
    ["16:9", 16, 9],
    ["16:10", 16, 10],
    ["4:3", 4, 3],
    ["3:2", 3, 2],
    ["21:9", 21, 9],
    ["free", 0, 0],
  ],
);
for (const invalid of [undefined, null, 16, "16/9", "unknown"]) {
  assert.equal(normalizeWindowAspect(invalid), "16:9");
  assert.equal(windowAspectRatio(invalid), 16 / 9);
}
assert.equal(windowAspectRatio("free"), 0);
for (const preset of WINDOW_ASPECTS.slice(0, -1)) {
  const size = fitAspectSize(997, 701, preset.id);
  assert.ok(size.width <= 997 && size.height <= 701);
  const ratio = preset.width / preset.height;
  assert.ok(
    Math.abs(size.width - size.height * ratio) <= 1 ||
      Math.abs(size.height - size.width / ratio) <= 1,
  );
}
assert.deepEqual(fitAspectSize(321.5, 180.25, "free"), {
  width: 321.5,
  height: 180.25,
});
assert.throws(() => fitAspectSize(Infinity, 100, "16:9"), RangeError);
assert.throws(() => fitAspectSize(0.5, 100, "16:9"), RangeError);

const largeArea = { x: -320, y: 0, width: 2560, height: 1440 };
const initialWindow = new MockWindow({
  bounds: { x: 400, y: 200, width: 1320, height: 888 },
});
const largeScreen = makeScreen(largeArea, 2);
const initialController = attachWindowAspect(initialWindow, {
  screen: largeScreen,
  initialAspect: "16:9",
});
assert.equal(initialWindow.aspectCalls[0], 16 / 9);
assert.equal(initialWindow.getContentSize()[0], 1920);
assertRatio(initialWindow, "16:9");
assertInArea(initialWindow.getBounds(), largeArea);
assert.deepEqual(initialWindow.minimumCalls[0], [724, 442]);
assert.equal(largeScreen.calls.length, 2);

initialWindow.setBounds({ x: 250, y: 140, width: 1024, height: 748 });
const old = initialWindow.getBounds();
const oldCenter = { x: old.x + old.width / 2, y: old.y + old.height / 2 };
initialController.set("4:3");
assert.equal(initialWindow.aspectCalls.at(-1), 4 / 3);
assertRatio(initialWindow, "4:3");
assert.equal(initialWindow.getContentSize()[0], 1000);
assert.equal(initialWindow.getBounds().x + initialWindow.getBounds().width / 2, oldCenter.x);
assert.equal(initialWindow.minimumCalls.at(-1)[0], 724);

const beforeFree = initialWindow.getBounds();
initialController.set("free");
assert.equal(initialWindow.aspectCalls.at(-1), 0);
assert.deepEqual(initialWindow.getBounds(), beforeFree, "free mode must preserve current size and position");
assert.deepEqual(initialWindow.minimumCalls.at(-1), [724, 498]);
initialController.destroy();

const smallArea = { x: 1280, y: -100, width: 640, height: 360 };
const smallWindow = new MockWindow({
  bounds: { x: 1400, y: 10, width: 1824, height: 1128 },
});
const smallController = attachWindowAspect(smallWindow, {
  screen: makeScreen(smallArea, 2.5),
  initialAspect: "16:9",
});
assertRatio(smallWindow, "16:9");
assertInArea(smallWindow.getBounds(), smallArea);
const smallMinimum = smallWindow.minimumCalls[0];
assert.ok(smallMinimum[0] <= smallArea.width);
assert.ok(smallMinimum[1] <= smallArea.height);
smallController.destroy();

const changingWindow = new MockWindow({
  bounds: { x: 500, y: 200, width: 1224, height: 768 },
});
const changingController = attachWindowAspect(changingWindow, {
  screen: makeScreen({ x: 0, y: 0, width: 1920, height: 1080 }),
  initialAspect: "16:10",
});
changingWindow.maximized = true;
const beforeMaximizedSet = changingWindow.boundsCalls.length;
changingController.set("4:3");
assert.equal(changingWindow.boundsCalls.length, beforeMaximizedSet, "maximize must skip bounds changes");
assert.equal(changingWindow.aspectCalls.at(-1), 4 / 3);
changingWindow.maximized = false;
changingWindow.setBounds({ x: 600, y: 120, width: 1024, height: 900 });
changingWindow.emit("unmaximize");
assertRatio(changingWindow, "4:3");
assertInArea(changingWindow.getBounds(), { x: 0, y: 0, width: 1920, height: 1080 });

changingWindow.fullScreen = true;
const beforeFullScreenSet = changingWindow.boundsCalls.length;
changingController.set("21:9");
assert.equal(changingWindow.boundsCalls.length, beforeFullScreenSet, "full screen must skip bounds changes");
changingWindow.fullScreen = false;
changingWindow.setBounds({ x: -100, y: -100, width: 1024, height: 900 });
changingWindow.emit("leave-full-screen");
assertRatio(changingWindow, "21:9");
assertInArea(changingWindow.getBounds(), { x: 0, y: 0, width: 1920, height: 1080 });

changingController.set("bogus");
assert.equal(changingWindow.aspectCalls.at(-1), 16 / 9, "invalid selection must use the default ratio");
assertRatio(changingWindow, "16:9");
changingController.set("3:2");
changingController.set("16:10");
assert.deepEqual(changingWindow.aspectCalls.slice(-2), [3 / 2, 16 / 10]);
changingController.destroy();
const afterDestroy = changingWindow.boundsCalls.length;
changingWindow.emit("restore");
assert.equal(changingWindow.boundsCalls.length, afterDestroy, "destroy must remove restore listeners");

const freeInitialWindow=new MockWindow({bounds:{x:0,y:0,width:1944,height:1128}});
const freeInitialController=attachWindowAspect(freeInitialWindow,{screen:makeScreen({x:0,y:0,width:1920,height:1040}),initialAspect:'free'});
assert.equal(freeInitialWindow.aspectCalls.at(-1),0);
assertInArea(freeInitialWindow.getBounds(),{x:0,y:0,width:1920,height:1040});
const freeInitialBounds=freeInitialWindow.getBounds();freeInitialController.set('free');assert.deepEqual(freeInitialWindow.getBounds(),freeInitialBounds);
freeInitialController.destroy();
console.log("Window aspect model and Electron controller checks passed.");
