export type CoverSnapshotEntry<T> = {
  key: string;
  value: T;
  references: number;
};

export type CoverSnapshotLease<T> = {
  entry: CoverSnapshotEntry<T>;
  value: T;
  release(): void;
};

/** Small high-resolution LRU whose live entries cannot be evicted. */
export class CoverSnapshotCache<T> {
  readonly capacity: number;
  private readonly entries = new Map<string, CoverSnapshotEntry<T>>();
  private readonly disposeValue: (value: T) => void;

  constructor(capacity: number, dispose: (value: T) => void) {
    if (!Number.isSafeInteger(capacity) || capacity < 0)
      throw new RangeError("Cover snapshot cache capacity must be a non-negative safe integer.");
    this.capacity = capacity;
    this.disposeValue = dispose;
  }

  get size(): number { return this.entries.size; }

  has(key: string): boolean { return this.entries.has(key); }

  get(key: string): CoverSnapshotEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (entry) this.touch(entry);
    return entry;
  }

  acquire(key: string, create: () => T): CoverSnapshotLease<T> | undefined {
    if (typeof key !== "string") throw new TypeError("Cover snapshot keys must be strings.");
    let entry = this.entries.get(key);
    if (!entry) {
      if (!this.makeRoom()) return undefined;
      entry = { key, value: create(), references: 0 };
      this.entries.set(key, entry);
    }
    entry.references += 1;
    this.touch(entry);
    return this.lease(entry);
  }

  retain(entry: CoverSnapshotEntry<T>): CoverSnapshotLease<T> | undefined {
    if (this.entries.get(entry.key) !== entry) return undefined;
    entry.references += 1;
    this.touch(entry);
    return this.lease(entry);
  }

  /** Rename a pending entry when its immutable content becomes available. */
  promote(entry: CoverSnapshotEntry<T>, key: string): boolean {
    if (this.entries.get(entry.key) !== entry) return false;
    if (entry.key === key) return true;
    if (this.entries.has(key)) return false;
    this.entries.delete(entry.key);
    entry.key = key;
    this.entries.set(key, entry);
    return true;
  }

  clear(): void {
    for (const entry of this.entries.values()) this.disposeValue(entry.value);
    this.entries.clear();
  }

  private lease(entry: CoverSnapshotEntry<T>): CoverSnapshotLease<T> {
    let released = false;
    return {
      entry,
      value: entry.value,
      release: () => {
        if (released) return;
        released = true;
        if (this.entries.get(entry.key) !== entry) return;
        entry.references = Math.max(0, entry.references - 1);
        this.touch(entry);
      },
    };
  }

  private touch(entry: CoverSnapshotEntry<T>): void {
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
  }

  private makeRoom(): boolean {
    if (this.capacity === 0) return false;
    if (this.entries.size < this.capacity) return true;
    for (const [key, entry] of this.entries) {
      if (entry.references !== 0) continue;
      this.entries.delete(key);
      this.disposeValue(entry.value);
      return true;
    }
    return false;
  }
}
