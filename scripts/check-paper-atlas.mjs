import assert from "node:assert/strict";
import test from "node:test";
import {
  albumLabelTileSizeForRows,
  createPaperAtlasLayout,
} from "../src/paper-atlas-layout.ts";

const profiles = [
  { name: "Rhine label", columns: 16, measure: (rows, max) => albumLabelTileSizeForRows(rows, max, 440), pagedAt4096: true },
  { name: "Punk label", columns: 16, measure: (rows, max) => albumLabelTileSizeForRows(rows, max, 600), pagedAt4096: true },
];

function pageMaximum(page) {
  return Math.max(page.width, page.height);
}

test("432-entry baseline stays one page at 4K, 8K and 16K", () => {
  for (const profile of profiles) for (const maxTextureSize of [4096, 8192, 16384]) {
    const layout = createPaperAtlasLayout(432, maxTextureSize, profile.columns, profile.measure);
    const baseline = profile.measure(Math.ceil(432 / profile.columns), maxTextureSize);
    assert.equal(layout.paged, false, `${profile.name} @${maxTextureSize}`);
    assert.equal(layout.pages.length, 1);
    assert.equal(layout.pages[0].count, 432);
    assert.equal(layout.tileWidth, baseline.width);
    assert.equal(layout.tileHeight, baseline.height);
    assert.ok(pageMaximum(layout.pages[0]) <= maxTextureSize);
  }
});

test("729-entry atlas pages only when single-page tiles fall below the 432 baseline", () => {
  for (const profile of profiles) for (const maxTextureSize of [4096, 8192, 16384]) {
    const baseline = createPaperAtlasLayout(432, maxTextureSize, profile.columns, profile.measure);
    const layout = createPaperAtlasLayout(729, maxTextureSize, profile.columns, profile.measure);
    const expectedPaged = maxTextureSize === 4096;
    assert.equal(layout.paged, expectedPaged, `${profile.name} @${maxTextureSize}`);
    assert.ok(layout.tileWidth >= baseline.tileWidth);
    assert.ok(layout.tileHeight >= baseline.tileHeight);
    if (expectedPaged) {
      assert.equal(layout.pages.length, 2);
      assert.deepEqual(layout.pages.map(page => page.count), [432, 297]);
      assert.deepEqual(layout.pages.map(page => page.rows), [
        Math.ceil(432 / profile.columns), Math.ceil(297 / profile.columns),
      ]);
      assert.ok(layout.pages.every(page => page.width === baseline.pages[0].width));
      assert.ok(layout.pages.every(page => pageMaximum(page) <= maxTextureSize));
      assert.deepEqual(layout.locate(431), { page: 0, localSlot: 431 });
      assert.deepEqual(layout.locate(432), { page: 1, localSlot: 0 });
      assert.deepEqual(layout.locate(728), { page: 1, localSlot: 296 });
    } else {
      assert.equal(layout.pages.length, 1, `${profile.name} @${maxTextureSize} remains a single atlas`);
      assert.equal(layout.pages[0].count, 729);
      assert.ok(pageMaximum(layout.pages[0]) <= maxTextureSize);
      assert.deepEqual(layout.locate(728), { page: 0, localSlot: 728 });
    }
  }
});

test("atlas lookup rejects slots outside the logical pool", () => {
  const layout = createPaperAtlasLayout(729, 4096, 16,
    (rows, max) => albumLabelTileSizeForRows(rows, max, 440));
  assert.equal(layout.locate(-1), undefined);
  assert.equal(layout.locate(729), undefined);
  assert.equal(layout.locate(1.5), undefined);
});
