import assert from "node:assert/strict";
import test from "node:test";
import { LabelAtlasCache } from "../src/label-atlas-cache.ts";
import { albumLabelTileSizeForRows, createPaperAtlasLayout } from "../src/paper-atlas-layout.ts";

test("zero capacity is an empty cache and rejects every physical slot", () => {
  const cache = new LabelAtlasCache(0);

  assert.equal(cache.size, 0);
  assert.throws(() => cache.bind(0, "NO.001"), RangeError);
});

test("one slot suppresses repeated paint and can be rebound while full", () => {
  const cache = new LabelAtlasCache(1);

  assert.deepEqual(cache.bind(0, "NO.001"), { atlasSlot: 0, needsPaint: true });
  assert.deepEqual(cache.bind(0, "NO.001"), { atlasSlot: 0, needsPaint: false });
  assert.throws(() => cache.bind(-1, "NO.003"), RangeError);
  assert.throws(() => cache.bind(1, "NO.003"), RangeError);
  assert.throws(() => cache.bind(0.5, "NO.003"), RangeError);
  assert.deepEqual(cache.bind(0, "NO.002"), { atlasSlot: 0, needsPaint: true });
  assert.deepEqual(cache.bind(0, "NO.002"), { atlasSlot: 0, needsPaint: false });
  assert.equal(cache.size, 1);
});

test("shared prints keep their atlas slot until the last physical slot releases them", () => {
  const cache = new LabelAtlasCache(2);

  const first = cache.bind(0, "NO.001");
  const shared = cache.bind(1, "NO.001");
  assert.deepEqual(first, { atlasSlot: 0, needsPaint: true });
  assert.deepEqual(shared, { atlasSlot: 0, needsPaint: false });

  const second = cache.bind(0, "NO.002");
  assert.deepEqual(second, { atlasSlot: 1, needsPaint: true });
  assert.deepEqual(cache.bind(0, "NO.001"), { atlasSlot: 0, needsPaint: false });

  const third = cache.bind(1, "NO.003");
  assert.deepEqual(third, { atlasSlot: 1, needsPaint: true });
  assert.deepEqual(cache.bind(0, "NO.001"), { atlasSlot: 0, needsPaint: false });
  assert.equal(cache.size, 2);
});

test("an unused atlas slot is preferred, then released prints are reused in release order", () => {
  const cache = new LabelAtlasCache(4);

  assert.deepEqual(cache.bind(0, "A"), { atlasSlot: 0, needsPaint: true });
  assert.deepEqual(cache.bind(1, "B"), { atlasSlot: 1, needsPaint: true });

  // A is now unreferenced, but slot 2 has never been used and is allocated first.
  assert.deepEqual(cache.bind(0, "C"), { atlasSlot: 2, needsPaint: true });
  // B becomes unreferenced; the remaining never-used atlas slot still wins.
  assert.deepEqual(cache.bind(1, "D"), { atlasSlot: 3, needsPaint: true });
  assert.equal(cache.size, 4);

  // With no unused atlas slots, the oldest unreferenced entry (A) is evicted.
  assert.deepEqual(cache.bind(2, "E"), { atlasSlot: 0, needsPaint: true });
  assert.deepEqual(cache.bind(0, "C"), { atlasSlot: 2, needsPaint: false });
  assert.deepEqual(cache.bind(1, "D"), { atlasSlot: 3, needsPaint: false });

  // B was released but not yet evicted, so another physical slot can reuse it.
  assert.deepEqual(cache.bind(3, "B"), { atlasSlot: 1, needsPaint: false });
  assert.equal(cache.size, 4);
});

test("a full cache can repaint a rebound slot without displacing other live keys", () => {
  const cache = new LabelAtlasCache(2);

  const first = cache.bind(0, "first");
  const second = cache.bind(1, "second");
  const replacement = cache.bind(0, "replacement");

  assert.deepEqual(first, { atlasSlot: 0, needsPaint: true });
  assert.deepEqual(second, { atlasSlot: 1, needsPaint: true });
  assert.deepEqual(replacement, { atlasSlot: 0, needsPaint: true });
  assert.deepEqual(cache.bind(1, "second"), { atlasSlot: 1, needsPaint: false });
  assert.equal(cache.size, 2);
});

test("clear releases cached content and physical bindings", () => {
  const cache = new LabelAtlasCache(3);

  cache.bind(0, "first");
  cache.bind(1, "second");
  cache.clear();

  assert.equal(cache.size, 0);
  assert.deepEqual(cache.bind(1, "second"), { atlasSlot: 0, needsPaint: true });
  assert.deepEqual(cache.bind(1, "second"), { atlasSlot: 0, needsPaint: false });
  assert.equal(cache.size, 1);
});

test("729 printed slots remain locatable across the 432-slot page boundary", () => {
  const capacity = 729;
  const cache = new LabelAtlasCache(capacity);
  const layout = createPaperAtlasLayout(capacity, 4096, 16,
    (rows, max) => albumLabelTileSizeForRows(rows, max, 440));
  const keys = Array.from({ length: capacity }, (_, index) => `NO.${String(index + 1).padStart(3, "0")}`);
  const bindings = keys.map((key, slot) => cache.bind(slot, key));
  const pageZeroEnd = bindings[431];
  const pageOneStart = bindings[432];
  const pageOneEnd = bindings[728];
  const pageOneKey = keys[432];
  assert.ok(pageZeroEnd && pageOneStart && pageOneEnd && pageOneKey);

  assert.deepEqual(layout.pages.map(page => page.count), [432, 297]);
  assert.equal(cache.size, capacity);
  assert.deepEqual(layout.locate(pageZeroEnd.atlasSlot), { page: 0, localSlot: 431 });
  assert.deepEqual(layout.locate(pageOneStart.atlasSlot), { page: 1, localSlot: 0 });
  assert.deepEqual(layout.locate(pageOneEnd.atlasSlot), { page: 1, localSlot: 296 });

  const crossPageShare = cache.bind(431, pageOneKey);
  assert.deepEqual(crossPageShare, { atlasSlot: pageOneStart.atlasSlot, needsPaint: false });
  assert.deepEqual(layout.locate(crossPageShare.atlasSlot), { page: 1, localSlot: 0 });
  assert.deepEqual(cache.bind(431, pageOneKey), crossPageShare);
});

test("deterministic rebinding never aliases two live keys or repaints a live cache hit", () => {
  const capacity = 23;
  const cache = new LabelAtlasCache(capacity);
  const live = Array.from({ length: capacity }, () => undefined);
  let state = 0x5eed1234;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };

  for (let step = 0; step < 4000; step += 1) {
    const slot = random() % capacity;
    const key = `print-${random() % 41}`;
    const previous = live[slot];
    const shared = live.find((entry, index) => index !== slot && entry?.key === key);
    const others = live.filter((_entry, index) => index !== slot);
    const binding = cache.bind(slot, key);

    if (previous?.key === key) {
      assert.equal(binding.needsPaint, false);
      assert.equal(binding.atlasSlot, previous.atlasSlot);
    } else if (shared) {
      assert.equal(binding.needsPaint, false);
      assert.equal(binding.atlasSlot, shared.atlasSlot);
    }

    for (const entry of others) {
      if (entry && entry.key !== key)
        assert.notEqual(binding.atlasSlot, entry.atlasSlot, "A live print must not be displaced by another key.");
    }
    live[slot] = { key, atlasSlot: binding.atlasSlot };

    const atlasOwners = new Map();
    const keySlots = new Map();
    for (const entry of live) {
      if (!entry) continue;
      const owner = atlasOwners.get(entry.atlasSlot);
      assert.ok(owner === undefined || owner === entry.key, "An atlas slot cannot serve two live keys.");
      atlasOwners.set(entry.atlasSlot, entry.key);
      const keySlot = keySlots.get(entry.key);
      assert.ok(keySlot === undefined || keySlot === entry.atlasSlot, "A live key must have one stable atlas slot.");
      keySlots.set(entry.key, entry.atlasSlot);
    }
    assert.ok(cache.size <= capacity);
  }

  for (let slot = 0; slot < capacity; slot += 1) {
    const entry = live[slot];
    assert.ok(entry);
    assert.deepEqual(cache.bind(slot, entry.key), { atlasSlot: entry.atlasSlot, needsPaint: false });
  }
});
