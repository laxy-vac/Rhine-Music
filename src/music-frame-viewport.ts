type Viewport = { width: number; height: number; compact: boolean };

/** One synchronous frame's measurements, captured before selection DOM writes. */
export class MusicFrameViewport {
  enabled = true;
  private current?: Viewport;

  prepare(container: HTMLElement): void {
    this.clear();
    if (!this.enabled) return;
    const value = this.measure(container);
    this.current = value;
    queueMicrotask(() => { if (this.current === value) this.clear(); });
  }

  read(container: HTMLElement): Viewport {
    return this.enabled && this.current ? this.current : this.measure(container);
  }

  clear(): void { this.current = undefined; }

  private measure(container: HTMLElement): Viewport {
    return { width: container.clientWidth, height: container.clientHeight,
      compact: container.closest<HTMLElement>("[data-layout]")?.dataset.layout === "compact" };
  }
}
