import assert from 'node:assert/strict';
import { CoverContentCache } from '../src/cover-content-cache.ts';

const cache = new CoverContentCache(4);
assert.equal(cache.size, 0);

const a0 = cache.bind(0, 'image:a');
const b1 = cache.bind(1, 'pending:b:first-title');
const b2 = cache.bind(2, 'pending:b:second-title');
const x3 = cache.bind(3, 'image:x');
const a3 = cache.bind(3, 'image:a');
assert.deepEqual(a0, { atlasSlot: 0, needsPaint: true, remapped: true });
assert.deepEqual(b1, { atlasSlot: 1, needsPaint: true, remapped: true });
assert.deepEqual(b2, { atlasSlot: 2, needsPaint: true, remapped: true });
assert.deepEqual(x3, { atlasSlot: 3, needsPaint: true, remapped: true });
assert.deepEqual(a3, { atlasSlot: 0, needsPaint: false, remapped: true });
assert.equal(cache.size, 4, 'Equal content keys share one bounded tile');
assert.equal(cache.atlasSlotAt(0), cache.atlasSlotAt(3));

const noChange = cache.bind(0, 'image:a');
assert.deepEqual(noChange, { atlasSlot: 0, needsPaint: false, remapped: false });

// The first decoded fallback is promoted in place. Every physical owner of
// that fallback sees the upgraded tile without changing UVs.
const promoteFirst = cache.promote('pending:b:first-title', 'image:b');
assert.deepEqual(promoteFirst, {
  atlasSlot: 1, physicalSlots: [1], remappedSlots: [], needsPaint: true,
});
assert.equal(cache.keyAt(1), 'image:b');
assert.equal(cache.atlasSlotAt(1), 1);

// A fallback with a different placeholder title merges onto the already
// resident URL tile, and explicitly reports the UV remap for that owner.
const promoteSecond = cache.promote('pending:b:second-title', 'image:b');
assert.deepEqual(promoteSecond, {
  atlasSlot: 1, physicalSlots: [2], remappedSlots: [2], needsPaint: false,
});
assert.equal(cache.keyAt(2), 'image:b');
assert.equal(cache.atlasSlotAt(2), 1);
assert.equal(cache.atlasSlotFor('pending:b:second-title'), undefined);

// All physical slots are now bound; rebinding a unique slot can recycle only
// its released tile, and duplicate owners still prevent eviction.
const replacement = cache.bind(1, 'image:c');
assert.equal(replacement.needsPaint, true);
assert.equal(replacement.remapped, true);
assert.equal(cache.keyAt(2), 'image:b');
assert.equal(cache.atlasSlotAt(1), replacement.atlasSlot);
assert.notEqual(replacement.atlasSlot, cache.atlasSlotAt(0));
assert.notEqual(replacement.atlasSlot, cache.atlasSlotAt(2));
assert.equal(cache.atlasSlotAt(0), cache.atlasSlotAt(3));

// A stale asynchronous promotion cannot overwrite a tile that has since been
// rebound to another content key.
assert.equal(cache.promote('pending:b:first-title', 'image:b'), undefined);
assert.equal(cache.keyAt(1), 'image:c');

// Evicting an old zero-owner alias must not delete a different active entry
// that was later promoted to the same key.
const identityCache = new CoverContentCache(3);
identityCache.bind(0, 'A');
identityCache.bind(1, 'B');
identityCache.promote('A', 'B');
identityCache.bind(2, 'C');
identityCache.promote('C', 'A');
assert.equal(identityCache.atlasSlotFor('A'), 2,
  'The active C entry becomes the current A mapping');
const recycledOldAlias = identityCache.bind(0, 'D');
assert.equal(recycledOldAlias.atlasSlot, 0,
  'Binding D recycles the old zero-owner A tile');
assert.equal(identityCache.atlasSlotFor('A'), 2,
  'Recycling the old A tile does not delete the newer A entry');
assert.deepEqual(identityCache.bind(1, 'A'), {
  atlasSlot: 2, needsPaint: false, remapped: true,
}, 'Binding A again hits the newer active tile without repainting');

// Promoting a zero-owner source into a zero-owner destination must keep the
// destination on the eviction queue after removing the source entry.
const zeroOwnerCache = new CoverContentCache(3);
zeroOwnerCache.bind(0, 'source:zero-owner');
const zeroDestination = zeroOwnerCache.bind(1, 'destination:zero-owner');
zeroOwnerCache.bind(2, 'spare:zero-owner');
zeroOwnerCache.bind(0, 'destination:zero-owner');
zeroOwnerCache.bind(1, 'spare:zero-owner');
zeroOwnerCache.bind(0, 'spare:zero-owner');
assert.equal(zeroOwnerCache.atlasSlotFor('destination:zero-owner'), zeroDestination.atlasSlot);
zeroOwnerCache.promote('source:zero-owner', 'destination:zero-owner');
assert.equal(zeroOwnerCache.atlasSlotFor('destination:zero-owner'), zeroDestination.atlasSlot);
assert.doesNotThrow(() => {
  zeroOwnerCache.bind(0, 'fresh:zero-owner-a');
  zeroOwnerCache.bind(1, 'fresh:zero-owner-b');
}, 'Both zero-owner tiles remain eligible for bounded reuse after promotion');
assert.equal(zeroOwnerCache.keyAt(0), 'fresh:zero-owner-a');
assert.equal(zeroOwnerCache.keyAt(1), 'fresh:zero-owner-b');

// Rebinding to an existing content key uses the resident tile and releases
// the old slot. The freed slot is the only kind eligible for later eviction.
const bindExisting = cache.bind(1, 'image:a');
assert.deepEqual(bindExisting, { atlasSlot: 0, needsPaint: false, remapped: true });
assert.equal(cache.keyAt(1), 'image:a');
assert.equal(cache.atlasSlotAt(0), cache.atlasSlotAt(1));

const beforeClear = cache.size;
assert.ok(beforeClear <= cache.capacity);
cache.clear();
assert.equal(cache.size, 0);
assert.equal(cache.keyAt(0), undefined);
assert.equal(cache.atlasSlotAt(0), undefined);
assert.deepEqual(cache.bind(0, 'image:after-clear'), { atlasSlot: 0, needsPaint: true, remapped: true });

for (const capacity of [0, 1, 2, 729]) {
  const bounded = new CoverContentCache(capacity);
  assert.ok(bounded.size <= capacity);
  if (capacity > 0) {
    for (let slot = 0; slot < capacity; slot++) bounded.bind(slot, `image:${slot}`);
    assert.equal(bounded.size, capacity);
    const rebound = bounded.bind(0, 'image:replacement');
    assert.equal(rebound.needsPaint, true);
    assert.equal(bounded.size, capacity);
    assert.equal(bounded.keyAt(0), 'image:replacement');
  }
}

assert.throws(() => new CoverContentCache(-1), RangeError);
assert.throws(() => cache.bind(-1, 'bad'), RangeError);
assert.throws(() => cache.bind(99, 'bad'), RangeError);

console.log('Cover content cache passed: fixed capacity, shared residency, fallback promotion/merge, UV remap reporting, stale promotion safety, safe rebind/eviction, and clear.');
