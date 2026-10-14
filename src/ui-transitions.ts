const enterEase = "cubic-bezier(0.22, 1, 0.36, 1)";
const exitEase = "cubic-bezier(0.4, 0, 1, 1)";
type PageViewTransition = { ready?: Promise<void>; finished: Promise<void>; skipTransition(): void };

/** Audio Archive's scan reveal adapted to a single DOM surface (MIT).
 * Copyright (c) 2026 the Audio Archive authors; assets/signal/LICENSE.txt. */
export class PageScanTransition {
  private animation?: Animation;
  private revision = 0;
  private readonly head: HTMLElement;
  private changing = false;
  private changeRevision = 0;
  private viewTransition?: PageViewTransition;
  private contentAnimations: Animation[] = [];
  constructor(private root: HTMLElement) { this.head = root.firstElementChild as HTMLElement; }
  cancelPending() {
    if (this.changing) return;
    this.changeRevision++;
    this.viewTransition?.skipTransition();
  }
  /** Snapshot before the existing navigation changes its DOM. A newer request
   * invalidates pending updates as well as interrupting the old animation. */
  change(update: () => void, reduced: boolean): boolean {
    if (this.changing || this.root.closest<HTMLElement>(".music-app")?.dataset.design !== "rhine") return false;
    const revision = ++this.changeRevision;
    this.viewTransition?.skipTransition();
    this.contentAnimations.forEach(animation => animation.cancel());
    this.contentAnimations = [];
    const doc = document as Document & { startViewTransition?: (update: () => void) => PageViewTransition };
    if (reduced || matchMedia("(prefers-reduced-motion: reduce)").matches || !doc.startViewTransition) return false;
    this.root.hidden = true;
    const transition = doc.startViewTransition(() => {
      if (revision !== this.changeRevision) return;
      this.changing = true;
      try { update(); } finally { this.changing = false; }
    });
    this.viewTransition = transition;
    void transition.ready?.catch(() => {});
    void transition.finished.then(() => {
      if (this.viewTransition === transition) this.viewTransition = undefined;
    }).catch(() => {
      if (this.viewTransition === transition) this.viewTransition = undefined;
    });
    return true;
  }
  reveal(reduced: boolean) {
    const revision = ++this.revision;
    this.animation?.cancel();
    if (this.root.closest<HTMLElement>(".music-app")?.dataset.design === "rhine") {
      this.root.hidden = true;
      if (this.changing || reduced || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      this.contentAnimations.forEach(animation => animation.cancel());
      const app = this.root.closest<HTMLElement>(".music-app")!;
      const surface = app.querySelector<HTMLElement>('.music-settings-page:not([hidden])') ?? app.querySelector<HTMLElement>('.album-panel:not([hidden])');
      const targets = surface?.classList.contains("album-panel") ? [surface] : [surface?.querySelector<HTMLElement>(".settings-page-heading"), surface?.querySelector<HTMLElement>('.settings-page-layout, #lyrics-page-content, #signal-page-content, #theme-page-content')];
      this.contentAnimations = targets.filter((node): node is HTMLElement => !!node).map((node, index) => node.animate(
        [{ opacity: .72, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: index ? 340 : 260, delay: index ? 45 : 0, easing: enterEase, fill: "backwards" },
      ));
      return;
    }
    this.viewTransition?.skipTransition();
    this.contentAnimations.forEach(animation => animation.cancel());
    this.contentAnimations = [];
    if (reduced || matchMedia("(prefers-reduced-motion: reduce)").matches) { this.root.hidden = true; return; }
    this.root.hidden = false;
    const animation = this.head.animate([{ transform: "translateX(0)" }, { transform: "translateX(101%)" }], { duration: 540, easing: "cubic-bezier(.22,.7,.22,1)", fill: "both" });
    this.animation = animation;
    void animation.finished.then(() => { if (revision === this.revision) { this.root.hidden = true; animation.cancel(); this.animation = undefined; } }).catch(() => {});
  }
}

/** Owns the visible lifetime, including a close that interrupts an opening. */
export class SurfaceTransition {
  private animations: Animation[] = [];
  private revision = 0;

  constructor(
    private root: HTMLElement,
    private panel?: HTMLElement,
    private enterDuration = 300,
    private exitDuration = 200,
    private direction: "up" | "right" = "up",
    private enterEasing = enterEase,
    // Separate overlays can fade together without changing their common
    // ancestor's stacking context or flattening them into a full-screen layer.
    private fadeTargets: readonly HTMLElement[] = [root],
  ) {}

  show(reduced: boolean) {
    this.run(true, reduced);
  }

  hide(reduced: boolean, finished: () => void = () => {}) {
    this.run(false, reduced, finished);
  }

  finish() {
    this.animations.forEach((animation) => animation.finish());
  }

  dispose() {
    this.revision++;
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
  }

  private run(show: boolean, reduced: boolean, finished?: () => void) {
    const revision = ++this.revision;
    const hidden = this.root.hidden;
    const opacities = this.fadeTargets.map((target) =>
      hidden ? "0" : getComputedStyle(target).opacity,
    );
    const transform = this.panel
      ? hidden
        ? this.direction === "right" ? "translateX(36px)" : "translateY(12px)"
        : getComputedStyle(this.panel).transform
      : undefined;
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
    this.root.hidden = false;
    this.root.dataset.transition = show ? "opening" : "closing";
    const complete = () => {
      if (revision !== this.revision) return;
      this.root.hidden = !show;
      this.root.dataset.transition = show ? "open" : "closed";
      this.animations.forEach((animation) => animation.cancel());
      this.animations = [];
      finished?.();
    };
    if (reduced || (!show && hidden)) {
      complete();
      return;
    }
    const options: KeyframeAnimationOptions = {
      duration: show ? this.enterDuration : this.exitDuration,
      easing: show ? this.enterEasing : exitEase,
      fill: "both",
    };
    const fades = this.fadeTargets.map((target, index) => target.animate(
      [{ opacity: opacities[index] }, { opacity: show ? 1 : 0 }],
      options,
    ));
    this.animations.push(...fades);
    if (this.panel) {
      this.animations.push(
        this.panel.animate(
          [
            { transform },
            { transform: this.direction === "right"
              ? show ? "translateX(0)" : "translateX(52px)"
              : show ? "translateY(0)" : "translateY(8px)" },
          ],
          options,
        ),
      );
    }
    void Promise.all(fades.map((fade) => fade.finished)).then(complete).catch(() => {});
  }
}

export class ContentTransition {
  private animation?: Animation;

  reveal(element: HTMLElement, reduced: boolean) {
    const opacity =
      this.animation?.playState === "running"
        ? getComputedStyle(element).opacity
        : "0.35";
    this.cancel();
    if (!reduced)
      this.animation = element.animate([{ opacity }, { opacity: 1 }], {
        duration: 150,
        easing: enterEase,
      });
  }

  cancel() {
    this.animation?.cancel();
    this.animation = undefined;
  }
}
