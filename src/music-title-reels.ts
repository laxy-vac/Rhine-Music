export type TitleGlyph = {
  key: string;
  text: string;
  kind: "main" | "translation";
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
  letterSpacing: string;
};

const DURATION = 460;
const STEPS = 48;
const IDLE_SLOTS = 64;
const SCRAMBLE_DURATION = 440;
const SCRAMBLE_GLYPHS = "#%&/\\|=+<>01_-";
type Sample = { value: number[]; velocity: number[] };

/** The archive's direct reel uses the same critically damped 460 ms curve. */
class TitleTrack {
  private animation?: Animation;
  private start: number[] = [];
  private velocity: number[] = [];
  private target: number[] = [];

  constructor(
    private readonly element: HTMLElement,
    private readonly property: "transform" | "height" | "clip-path",
    private readonly format: (value: number[]) => string,
  ) {}

  sample(): Sample {
    if (!this.animation)
      return { value: this.target, velocity: this.target.map(() => 0) };
    const time = this.animation.currentTime;
    return this.at(typeof time === "number" ? time / DURATION : 0);
  }

  private at(progress: number): Sample {
    if (progress >= 1)
      return { value: this.target, velocity: this.target.map(() => 0) };
    const t = Math.max(0, progress);
    const decay = Math.exp(-10 * t);
    const seconds = DURATION / 1000;
    const value: number[] = [],
      velocity: number[] = [];
    this.target.forEach((target, index) => {
      const delta = this.start[index] - target;
      const advance = this.velocity[index] * seconds + 10 * delta;
      value.push(target + (delta + advance * t) * decay);
      velocity.push(((advance - 10 * (delta + advance * t)) * decay) / seconds);
    });
    return { value, velocity };
  }

  set(value: number[]) {
    this.cancel();
    this.target = value;
    this.element.style.setProperty(this.property, this.format(value));
  }

  move(target: number[], from = this.sample(), completed?: () => void) {
    this.cancel();
    this.start = from.value.length ? from.value : target;
    this.velocity = target.map((value, index) => {
      const limit =
        (Math.max(Math.abs(this.start[index] - value), 1) * 12) /
        (DURATION / 1000);
      return Math.max(-limit, Math.min(limit, from.velocity[index] || 0));
    });
    this.target = target;
    this.element.style.setProperty(this.property, this.format(target));
    if (
      target.every(
        (value, index) =>
          Math.abs(value - this.start[index]) < 0.001 &&
          Math.abs(this.velocity[index]) < 0.001,
      )
    ) {
      completed?.();
      return;
    }
    const frames = Array.from({ length: STEPS + 1 }, (_, index) => ({
      [this.property]: this.format(this.at(index / STEPS).value),
    }));
    const animation = this.element.animate(frames, {
      duration: DURATION,
      easing: "linear",
    });
    this.animation = animation;
    // Give all glyphs a common timeline origin, including a newly added line.
    const now = this.element.ownerDocument.timeline.currentTime;
    if (typeof now === "number") animation.startTime = now;
    animation.onfinish = () => {
      if (this.animation !== animation) return;
      this.cancel();
      completed?.();
    };
  }

  finish() {
    this.set(this.target);
  }
  cancel() {
    if (this.animation) {
      this.animation.onfinish = null;
      this.animation.cancel();
      this.animation = undefined;
    }
  }
}

type Face = {
  text: string;
  font: string;
  letterSpacing: string;
  height: number;
  width: number;
};
type Slot = {
  host: HTMLSpanElement;
  reel: HTMLSpanElement;
  faces: HTMLSpanElement[];
  values: Face[];
  offsets: number[];
  roll: TitleTrack;
  viewport: TitleTrack;
  position: TitleTrack;
  glyph: TitleGlyph;
  active: boolean;
};
type ScrambleEntry = { slot: Slot; glyph: TitleGlyph };
type ScrambleState = {
  target: string;
  startedAt: number;
  seed: number;
  entries: ScrambleEntry[];
  generation: number;
};
const blankFace: Face = {
  text: "",
  font: "",
  letterSpacing: "",
  height: 0,
  width: 0,
};

/** A bounded pool of actual character reels, with no glyph DOM measurements. */
export function createTitleReels(visual: HTMLElement, spacer: HTMLElement) {
  const slots = new Map<string, Slot>();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const height = new TitleTrack(
    spacer,
    "height",
    ([value]) => `${value || 0}px`,
  );
  let heightTarget = 0;
  let cleanup: ReturnType<typeof setTimeout> | undefined;
  let scrambleFrame = 0;
  let scrambleGeneration = 0;
  let scramble: ScrambleState | undefined;
  let renderedText: string | undefined;
  let resizePending = false;
  let resizeClearFrame = 0;
  let resizeClearFrame2 = 0;

  const cancelScramble = () => {
    if (scrambleFrame) cancelAnimationFrame(scrambleFrame);
    scrambleFrame = 0;
    scramble = undefined;
    scrambleGeneration++;
  };

  const writeFaces = (slot: Slot, values: Face[]) => {
    // Usually the visible pair plus one target. A simultaneous font-size change
    // can expose a third smaller face; retain it instead of discarding pixels.
    while (slot.faces.length < values.length) {
      const face = document.createElement("span");
      face.className = "music-title-face";
      slot.faces.push(face);
      slot.reel.append(face);
    }
    slot.values = values.map((value) =>
      value.height ? value : { ...value, height: slot.glyph.height },
    );
    slot.offsets = [];
    let y = 0;
    slot.values.forEach((value, index) => {
      slot.offsets.push(y);
      const face = slot.faces[index];
      if (face.textContent !== value.text) face.textContent = value.text;
      face.style.font = value.font || slot.glyph.font;
      face.style.letterSpacing =
        value.letterSpacing || slot.glyph.letterSpacing;
      face.style.lineHeight = `${value.height}px`;
      face.style.height = `${value.height}px`;
      face.style.transform = `translateY(${y}px)`;
      y += value.height;
    });
    for (let index = values.length; index < slot.faces.length; index++)
      slot.faces[index].textContent = "";
    slot.host.style.height = `${Math.max(slot.glyph.height, ...slot.values.map((value) => value.height))}px`;
    slot.host.style.width = `${Math.max(slot.glyph.width, ...slot.values.map((value) => value.width)) + 0.3}px`;
  };

  const create = (glyph: TitleGlyph) => {
    const host = document.createElement("span");
    host.className = `music-title-slot music-title-slot-${glyph.kind}`;
    const reel = document.createElement("span");
    reel.className = "music-title-wheel";
    const faces = Array.from({ length: 3 }, () => {
      const face = document.createElement("span");
      face.className = "music-title-face";
      return face;
    });
    reel.append(...faces);
    host.append(reel);
    visual.append(host);
    const slot: Slot = {
      host,
      reel,
      faces,
      values: [{ ...blankFace, height: glyph.height }],
      offsets: [0],
      glyph,
      active: false,
      roll: new TitleTrack(
        reel,
        "transform",
        ([value]) => `translateY(${-(value || 0)}px)`,
      ),
      viewport: new TitleTrack(
        host,
        "clip-path",
        ([value]) => `inset(0 0 calc(100% - ${value || 0}px) 0)`,
      ),
      position: new TitleTrack(
        host,
        "transform",
        ([x, y]) => `translate3d(${x || 0}px, ${y || 0}px, 0)`,
      ),
    };
    slot.roll.set([0]);
    slot.viewport.set([glyph.height]);
    slot.position.set([glyph.x, glyph.y]);
    slots.set(glyph.key, slot);
    return slot;
  };

  const rollTo = (slot: Slot, face: Face, animated: boolean) => {
    if (!animated) {
      writeFaces(slot, [face]);
      slot.roll.set([0]);
      return;
    }
    const sample = slot.roll.sample();
    const position = Math.max(0, sample.value[0] || 0);
    let first = 0;
    while (
      first + 1 < slot.offsets.length &&
      slot.offsets[first + 1] <= position
    )
      first++;
    const offset = Math.max(0, position - slot.offsets[first]);
    // Keep only faces intersecting the current viewport, then the newest target.
    // DOM depends on the viewport/face-height ratio, never on input history.
    const values = [slot.values[first] || blankFace];
    const viewport = slot.viewport.sample().value[0] || slot.glyph.height;
    for (let index = first + 1; index < slot.values.length; index++) {
      if (slot.offsets[index] >= position + viewport - 0.001) break;
      values.push(slot.values[index]);
    }
    if (
      values.at(-1)?.text !== face.text ||
      values.at(-1)?.font !== face.font ||
      values.at(-1)?.letterSpacing !== face.letterSpacing ||
      values.at(-1)?.height !== face.height
    )
      values.push(face);
    writeFaces(slot, values);
    const target = slot.offsets.at(-1)!;
    const from = Math.min(offset, target);
    slot.roll.move(
      [target],
      {
        value: [from],
        velocity: [
          Math.max(
            0,
            Math.min(
              sample.velocity[0] || 0,
              ((target - from) * 10000) / DURATION,
            ),
          ),
        ],
      },
      () => {
        // Remove this reel's retired ink as soon as it finishes. Other reels
        // may still be moving, or later input may postpone the pool cleanup.
        // Capture the target: render() has not yet set active on a sync finish.
        writeFaces(slot, [face]);
        slot.roll.set([0]);
      },
    );
  };

  const applyScrambleFrame = (state: ScrambleState, now: number) => {
    if (state.generation !== scrambleGeneration || scramble !== state) return;
    scrambleFrame = 0;
    const progress = Math.min(
      1,
      Math.max(0, (now - state.startedAt) / SCRAMBLE_DURATION),
    );
    if (progress >= 1) {
      state.entries.forEach(({ slot, glyph }) => {
        const face = slot.faces[0];
        if (face && face.textContent !== glyph.text)
          face.textContent = glyph.text;
      });
      settle();
      return;
    }

    // Match Audio Archive's Scramble(): resolve the eased prefix from left to
    // right and refresh the remaining terminal glyphs in 50 ms time slices.
    const resolved = Math.floor(
      (1 - Math.pow(2, -10 * progress)) * state.entries.length,
    );
    let random = state.seed + Math.floor(now / 50);
    state.entries.forEach(({ slot, glyph }, index) => {
      const face = slot.faces[0];
      if (!face) return;
      if (index < resolved || glyph.text === " ") {
        if (face.textContent !== glyph.text) face.textContent = glyph.text;
        return;
      }
      random = (random * 1103515245 + 12345) & 0x7fffffff;
      const character = SCRAMBLE_GLYPHS[random % SCRAMBLE_GLYPHS.length];
      if (face.textContent !== character) face.textContent = character;
    });
    scrambleFrame = requestAnimationFrame((timestamp) =>
      applyScrambleFrame(state, timestamp),
    );
  };

  const renderScramble = (
    glyphs: TitleGlyph[],
    nextHeight: number,
    animated: boolean,
    targetText: string,
    textChanged: boolean,
  ) => {
    const continueScramble =
      animated && scramble?.target === targetText;
    if (!continueScramble) {
      clearTimeout(cleanup);
      cleanup = undefined;
      cancelScramble();
    }

    const entries: ScrambleEntry[] = [];
    const active = new Set(glyphs.map((glyph) => glyph.key));
    glyphs.forEach((glyph) => {
      const slot = slots.get(glyph.key) || create(glyph);
      const currentText = continueScramble
        ? slot.faces[0]?.textContent ?? glyph.text
        : glyph.text;
      slot.glyph = glyph;
      slot.active = true;
      slot.host.hidden = false;
      slot.host.style.visibility = "";
      slot.host.style.fontSize = glyph.font.match(/([\d.]+)px/)?.[0] || "inherit";
      slot.position.set([glyph.x, glyph.y]);
      slot.viewport.set([glyph.height]);
      slot.roll.set([0]);
      writeFaces(slot, [{ ...glyph, text: currentText, width: glyph.width }]);
      entries.push({ slot, glyph });
    });
    slots.forEach((slot, key) => {
      if (!slot.active || active.has(key)) return;
      slot.active = false;
      slot.roll.set([0]);
      writeFaces(slot, [blankFace]);
      slot.host.style.visibility = "hidden";
      slot.host.hidden = true;
    });

    if (heightTarget !== nextHeight) {
      heightTarget = nextHeight;
      height.set([nextHeight]);
    }

    if (continueScramble) {
      scramble!.entries = entries;
      return;
    }

    if (animated && textChanged && entries.length) {
      const startedAt = performance.now();
      const state: ScrambleState = {
        target: targetText,
        startedAt,
        seed: targetText.length * 31 + 7,
        entries,
        generation: scrambleGeneration,
      };
      scramble = state;
      cleanup = setTimeout(settle, SCRAMBLE_DURATION + 40);
      applyScrambleFrame(state, startedAt);
    } else {
      entries.forEach(({ slot, glyph }) => writeFaces(slot, [glyph]));
      settle();
    }
  };

  const settle = () => {
    clearTimeout(cleanup);
    cleanup = undefined;
    cancelScramble();
    const idle: string[] = [];
    slots.forEach((slot, key) => {
      slot.roll.finish();
      slot.position.finish();
      slot.viewport.finish();
      writeFaces(slot, [slot.active ? slot.glyph : blankFace]);
      slot.roll.set([0]);
      if (!slot.active) {
        slot.host.style.visibility = "hidden";
        slot.host.hidden = true;
        idle.push(key);
      }
    });
    height.finish();
    // Short/long title changes reuse their slots; extreme libraries cannot
    // retain an unbounded history of unused subtitle glyphs.
    for (const key of idle.slice(0, Math.max(0, idle.length - IDLE_SLOTS))) {
      slots.get(key)!.host.remove();
      slots.delete(key);
    }
  };
  const onReduced = () => {
    if (!reduced.matches) return;
    clearTimeout(cleanup);
    settle();
  };
  const onResize = () => {
    if (!scramble) return;
    resizePending = true;
    if (resizeClearFrame) cancelAnimationFrame(resizeClearFrame);
    if (resizeClearFrame2) cancelAnimationFrame(resizeClearFrame2);
    resizeClearFrame = requestAnimationFrame(() => {
      resizeClearFrame = 0;
      resizeClearFrame2 = requestAnimationFrame(() => {
        resizeClearFrame2 = 0;
        resizePending = false;
      });
    });
    settle();
  };
  reduced.addEventListener("change", onReduced);
  window.addEventListener("resize", onResize);

  return {
    get moving() {
      return cleanup !== undefined;
    },
    render(
      glyphs: TitleGlyph[],
      nextHeight: number,
      animated: boolean,
      transition: "roll" | "scramble" = "roll",
    ) {
      animated = animated && !reduced.matches && !document.hidden;
      const targetText = glyphs.map((glyph) => glyph.text).join("");
      const textChanged = renderedText !== targetText;
      renderedText = targetText;
      const resized = resizePending;
      resizePending = false;
      if (transition === "scramble" && resized) animated = false;
      if (transition === "scramble") {
        renderScramble(glyphs, nextHeight, animated, targetText, textChanged);
        return;
      }

      clearTimeout(cleanup);
      cleanup = undefined;
      if (scramble) settle();
      const active = new Set(glyphs.map((glyph) => glyph.key));
      glyphs.forEach((glyph) => {
        const slot = slots.get(glyph.key) || create(glyph);
        const old = slot.glyph;
        const changed =
          !slot.active ||
          old.text !== glyph.text ||
          old.font !== glyph.font ||
          old.letterSpacing !== glyph.letterSpacing ||
          old.height !== glyph.height;
        slot.glyph = glyph;
        slot.host.hidden = false;
        slot.host.style.visibility = "";
        slot.host.style.width = `${Math.max(glyph.width, ...slot.values.map((value) => value.width)) + 0.3}px`;
        slot.host.style.fontSize =
          glyph.font.match(/([\d.]+)px/)?.[0] || "inherit";
        if (old.x !== glyph.x || old.y !== glyph.y) {
          if (animated) slot.position.move([glyph.x, glyph.y]);
          else slot.position.set([glyph.x, glyph.y]);
        }
        if (old.height !== glyph.height) {
          if (animated) slot.viewport.move([glyph.height]);
          else slot.viewport.set([glyph.height]);
        }
        if (changed) rollTo(slot, glyph, animated);
        else if (!animated) slot.roll.finish();
        slot.active = true;
      });
      slots.forEach((slot, key) => {
        if (!slot.active || active.has(key)) return;
        slot.active = false;
        rollTo(slot, blankFace, animated);
      });
      if (heightTarget !== nextHeight) {
        heightTarget = nextHeight;
        if (animated) height.move([nextHeight]);
        else height.set([nextHeight]);
      }
      if (animated) cleanup = setTimeout(settle, DURATION + 40);
      else settle();
    },
    finish() {
      clearTimeout(cleanup);
      cleanup = undefined;
      settle();
    },
    destroy() {
      clearTimeout(cleanup);
      cleanup = undefined;
      cancelScramble();
      if (resizeClearFrame) cancelAnimationFrame(resizeClearFrame);
      if (resizeClearFrame2) cancelAnimationFrame(resizeClearFrame2);
      reduced.removeEventListener("change", onReduced);
      window.removeEventListener("resize", onResize);
      height.cancel();
      slots.forEach((slot) => {
        slot.roll.cancel();
        slot.position.cancel();
        slot.viewport.cancel();
      });
      slots.clear();
      visual.replaceChildren();
    },
  };
}
