import assert from 'node:assert/strict';
import { CoverSnapshotCache } from '../src/cover-snapshot-cache.ts';

const disposed = [];
let nextValue = 0;
const cache = new CoverSnapshotCache(2, (value) => disposed.push(value.id));
const create = () => ({ id: ++nextValue });

const first = cache.acquire('cover:a', create);
const shared = cache.acquire('cover:a', create);
assert.ok(first && shared);
assert.strictEqual(first.entry, shared.entry, 'Identical immutable content shares one resource');
assert.strictEqual(first.value, shared.value);
assert.equal(first.entry.references, 2);
first.release();
first.release();
assert.equal(shared.entry.references, 1, 'Each owner releases at most one reference');
assert.deepEqual(disposed, [], 'A live owner pins the shared texture');

const second = cache.acquire('cover:b', create);
assert.ok(second);
const full = cache.acquire('cover:c', create);
assert.equal(full, undefined, 'A full cache does not evict live entries');
assert.equal(cache.size, 2);

shared.release();
assert.equal(shared.entry.references, 0, 'Released entries remain available in the bounded LRU');
const third = cache.acquire('cover:c', create);
assert.ok(third);
assert.deepEqual(disposed, [shared.value.id], 'The oldest zero-reference entry is the only eviction target');
assert.strictEqual(cache.get('cover:b'), second.entry, 'Active entries remain resident');

third.release();
const pendingLease = cache.acquire('pending:url:title', create);
assert.ok(pendingLease);
assert.equal(cache.promote(pendingLease.entry, 'image:url'), true);
assert.strictEqual(cache.get('image:url'), pendingLease.entry, 'Promotion preserves the resident texture');
second.release();
const collision = cache.acquire('image:collision', create);
assert.ok(collision);
assert.equal(cache.promote(collision.entry, 'image:url'), false,
  'A pending entry never displaces an already resident canonical image');
assert.strictEqual(cache.get('image:url'), pendingLease.entry);
assert.equal(cache.size, 2);

const duplicate = cache.acquire('image:url', create);
assert.ok(duplicate);
assert.strictEqual(duplicate.value, pendingLease.value);

pendingLease.release();
duplicate.release();
collision.release();
const beforeClear = disposed.length;
cache.clear();
assert.equal(cache.size, 0);
assert.equal(disposed.length, beforeClear + 2, 'Clear releases every remaining cached texture once');

const zero = new CoverSnapshotCache(0, () => assert.fail('Zero-capacity cache cannot own a value'));
assert.equal(zero.acquire('x', create), undefined);
assert.throws(() => new CoverSnapshotCache(-1, () => {}), RangeError);

console.log('Cover snapshot cache passed: shared leases, fixed capacity, live-owner pinning, zero-reference LRU eviction, promotion, and disposal.');
