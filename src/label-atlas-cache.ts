type AtlasEntry = {
  key: string;
  atlasSlot: number;
  references: number;
};

const UNBOUND = -1;

/** Reuses printed atlas tiles while keeping each live physical slot bound. */
export class LabelAtlasCache {
  readonly capacity: number;

  private readonly physicalAtlasSlots: number[];
  private readonly entriesByAtlasSlot: (AtlasEntry | undefined)[];
  private readonly entriesByKey = new Map<string, AtlasEntry>();
  private readonly unreferencedAtlasSlots = new Set<number>();
  private nextUnusedAtlasSlot = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0)
      throw new RangeError("Label atlas capacity must be a non-negative safe integer.");

    this.capacity = capacity;
    this.physicalAtlasSlots = Array.from({ length: capacity }, () => UNBOUND);
    this.entriesByAtlasSlot = Array.from({ length: capacity }, () => undefined);
  }

  get size(): number {
    return this.entriesByKey.size;
  }

  bind(slot: number, key: string): { atlasSlot: number; needsPaint: boolean } {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacity)
      throw new RangeError(`Label atlas physical slot is outside [0, ${this.capacity}).`);
    if (typeof key !== "string") throw new TypeError("Label atlas cache keys must be strings.");

    const previousAtlasSlot = this.physicalAtlasSlots[slot]!;
    const previousEntry = previousAtlasSlot === UNBOUND
      ? undefined
      : this.entriesByAtlasSlot[previousAtlasSlot];

    if (previousEntry?.key === key)
      return { atlasSlot: previousEntry.atlasSlot, needsPaint: false };

    if (previousEntry) this.release(slot, previousEntry);

    const cached = this.entriesByKey.get(key);
    if (cached) {
      if (cached.references === 0) this.unreferencedAtlasSlots.delete(cached.atlasSlot);
      cached.references += 1;
      this.physicalAtlasSlots[slot] = cached.atlasSlot;
      return { atlasSlot: cached.atlasSlot, needsPaint: false };
    }

    const atlasSlot = this.takeAtlasSlot();
    const entry: AtlasEntry = { key, atlasSlot, references: 1 };
    this.entriesByKey.set(key, entry);
    this.entriesByAtlasSlot[atlasSlot] = entry;
    this.physicalAtlasSlots[slot] = atlasSlot;
    return { atlasSlot, needsPaint: true };
  }

  clear(): void {
    this.entriesByKey.clear();
    this.entriesByAtlasSlot.fill(undefined);
    this.physicalAtlasSlots.fill(UNBOUND);
    this.unreferencedAtlasSlots.clear();
    this.nextUnusedAtlasSlot = 0;
  }

  private release(slot: number, entry: AtlasEntry): void {
    this.physicalAtlasSlots[slot] = UNBOUND;
    entry.references -= 1;
    if (entry.references === 0) this.unreferencedAtlasSlots.add(entry.atlasSlot);
  }

  private takeAtlasSlot(): number {
    if (this.nextUnusedAtlasSlot < this.capacity) return this.nextUnusedAtlasSlot++;

    const oldest = this.unreferencedAtlasSlots.values().next();
    if (oldest.done)
      throw new Error("Label atlas cache invariant failed: no unreferenced slot is available.");

    const atlasSlot = oldest.value;
    this.unreferencedAtlasSlots.delete(atlasSlot);
    const evicted = this.entriesByAtlasSlot[atlasSlot];
    if (!evicted || evicted.references !== 0)
      throw new Error("Label atlas cache invariant failed: an active entry cannot be evicted.");

    this.entriesByKey.delete(evicted.key);
    this.entriesByAtlasSlot[atlasSlot] = undefined;
    return atlasSlot;
  }
}
