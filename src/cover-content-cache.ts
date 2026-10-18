type CoverEntry = {
  key: string;
  atlasSlot: number;
  references: number;
};

const UNBOUND = -1;

export type CoverContentBinding = {
  atlasSlot: number;
  needsPaint: boolean;
  remapped: boolean;
};

export type CoverContentPromotion = {
  atlasSlot: number;
  physicalSlots: number[];
  remappedSlots: number[];
  needsPaint: boolean;
};

/** Bounded content-to-tile residency for the dynamic cover instance pool. */
export class CoverContentCache {
  readonly capacity: number;

  private readonly physicalAtlasSlots: number[];
  private readonly entriesByAtlasSlot: (CoverEntry | undefined)[];
  private readonly entriesByKey = new Map<string, CoverEntry>();
  private readonly unreferencedAtlasSlots = new Set<number>();
  private nextUnusedAtlasSlot = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0)
      throw new RangeError("Cover atlas capacity must be a non-negative safe integer.");

    this.capacity = capacity;
    this.physicalAtlasSlots = Array.from({ length: capacity }, () => UNBOUND);
    this.entriesByAtlasSlot = Array.from({ length: capacity }, () => undefined);
  }

  get size(): number {
    return this.entriesByKey.size;
  }

  keyAt(physicalSlot: number): string | undefined {
    this.assertPhysicalSlot(physicalSlot);
    const atlasSlot = this.physicalAtlasSlots[physicalSlot]!;
    return atlasSlot === UNBOUND ? undefined : this.entriesByAtlasSlot[atlasSlot]?.key;
  }

  atlasSlotAt(physicalSlot: number): number | undefined {
    this.assertPhysicalSlot(physicalSlot);
    const atlasSlot = this.physicalAtlasSlots[physicalSlot]!;
    return atlasSlot === UNBOUND ? undefined : atlasSlot;
  }

  has(key: string): boolean {
    return this.entriesByKey.has(key);
  }

  atlasSlotFor(key: string): number | undefined {
    return this.entriesByKey.get(key)?.atlasSlot;
  }

  bind(physicalSlot: number, key: string): CoverContentBinding {
    this.assertPhysicalSlot(physicalSlot);
    if (typeof key !== "string") throw new TypeError("Cover atlas keys must be strings.");

    const previousAtlasSlot = this.physicalAtlasSlots[physicalSlot]!;
    const previousEntry = previousAtlasSlot === UNBOUND
      ? undefined
      : this.entriesByAtlasSlot[previousAtlasSlot];

    if (previousEntry?.key === key)
      return { atlasSlot: previousEntry.atlasSlot, needsPaint: false, remapped: false };

    if (previousEntry) this.release(physicalSlot, previousEntry);

    const cached = this.entriesByKey.get(key);
    if (cached) {
      if (cached.references === 0) this.unreferencedAtlasSlots.delete(cached.atlasSlot);
      cached.references += 1;
      this.physicalAtlasSlots[physicalSlot] = cached.atlasSlot;
      return {
        atlasSlot: cached.atlasSlot,
        needsPaint: false,
        remapped: previousAtlasSlot !== cached.atlasSlot,
      };
    }

    const atlasSlot = this.takeAtlasSlot();
    const entry: CoverEntry = { key, atlasSlot, references: 1 };
    this.entriesByKey.set(key, entry);
    this.entriesByAtlasSlot[atlasSlot] = entry;
    this.physicalAtlasSlots[physicalSlot] = atlasSlot;
    return { atlasSlot, needsPaint: true, remapped: previousAtlasSlot !== atlasSlot };
  }

  /**
   * Promote a resident fallback tile to decoded content. If that content is
   * already resident, all fallback owners are merged onto its tile instead.
   */
  promote(oldKey: string, newKey: string): CoverContentPromotion | undefined {
    const source = this.entriesByKey.get(oldKey);
    if (!source) return undefined;

    const physicalSlots: number[] = [];
    for (let slot = 0; slot < this.physicalAtlasSlots.length; slot++)
      if (this.physicalAtlasSlots[slot] === source.atlasSlot) physicalSlots.push(slot);

    if (oldKey === newKey)
      return { atlasSlot: source.atlasSlot, physicalSlots, remappedSlots: [], needsPaint: false };

    const destination = this.entriesByKey.get(newKey);
    if (!destination) {
      this.entriesByKey.delete(oldKey);
      source.key = newKey;
      this.entriesByKey.set(newKey, source);
      return { atlasSlot: source.atlasSlot, physicalSlots, remappedSlots: [], needsPaint: true };
    }

    if (destination.references === 0 && physicalSlots.length > 0) this.unreferencedAtlasSlots.delete(destination.atlasSlot);
    for (const slot of physicalSlots) {
      this.physicalAtlasSlots[slot] = destination.atlasSlot;
      destination.references += 1;
      source.references -= 1;
    }
    this.entriesByKey.delete(oldKey);
    const remappedSlots = [...physicalSlots];
    if (source.references === 0) this.unreferencedAtlasSlots.add(source.atlasSlot);
    return {
      atlasSlot: destination.atlasSlot,
      physicalSlots,
      remappedSlots,
      needsPaint: false,
    };
  }

  clear(): void {
    this.entriesByKey.clear();
    this.entriesByAtlasSlot.fill(undefined);
    this.physicalAtlasSlots.fill(UNBOUND);
    this.unreferencedAtlasSlots.clear();
    this.nextUnusedAtlasSlot = 0;
  }

  private assertPhysicalSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacity)
      throw new RangeError(`Cover physical slot is outside [0, ${this.capacity}).`);
  }

  private release(slot: number, entry: CoverEntry): void {
    this.physicalAtlasSlots[slot] = UNBOUND;
    entry.references -= 1;
    if (entry.references === 0) this.unreferencedAtlasSlots.add(entry.atlasSlot);
  }

  private takeAtlasSlot(): number {
    if (this.nextUnusedAtlasSlot < this.capacity) return this.nextUnusedAtlasSlot++;

    const oldest = this.unreferencedAtlasSlots.values().next();
    if (oldest.done)
      throw new Error("Cover atlas invariant failed: no unreferenced tile is available.");

    const atlasSlot = oldest.value;
    this.unreferencedAtlasSlots.delete(atlasSlot);
    const evicted = this.entriesByAtlasSlot[atlasSlot];
    if (!evicted || evicted.references !== 0)
      throw new Error("Cover atlas invariant failed: an active tile cannot be evicted.");
    if (this.entriesByKey.get(evicted.key) === evicted) this.entriesByKey.delete(evicted.key);
    this.entriesByAtlasSlot[atlasSlot] = undefined;
    return atlasSlot;
  }
}
