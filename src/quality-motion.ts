import { baselineSelectionWave, smooth } from "./motion.ts";

export type WaveQuality = "off" | "basic" | "reduced" | "full";

const MAX_AGE = 3.2;
const endFade = (age: number) => smooth((MAX_AGE - age) / 0.18);
const finiteInput = (distance: number, age: number) =>
  Number.isFinite(distance) && Number.isFinite(age);

/** Selection motion for the chosen quality level, in scene-distance units. */
export function qualitySelectionWave(
  level: WaveQuality,
  distance: number,
  age: number,
): number {
  if (level === "off" || !finiteInput(distance, age)) return 0;
  if (age < 0 || age > MAX_AGE) return 0;

  if (level === "full") {
    return baselineSelectionWave(distance, age) * endFade(age);
  }

  const radius = Math.abs(distance);
  if (level === "reduced") {
    // Keep the reference phase and traveling crest, fading smoothly beyond
    // the nearer part of the field to limit distant motion and overlap.
    const range = 1 - smooth((radius - 8) / 6);
    if (range <= 0) return 0;
    return baselineSelectionWave(distance, age) * range * endFade(age);
  }

  // The basic option gives nearby cards one quiet, synchronized lift without
  // the long-travel alternating wave used by the richer modes.
  const localAge = age - Math.max(0, radius - 0.45) * 0.12;
  if (localAge <= 0) return 0;
  const nearby = 1 - smooth((radius - 0.45) / 2.55);
  const tail = smooth((MAX_AGE - age) / 0.28);
  return (
    0.32 * smooth(localAge / 0.16) * Math.exp(-localAge * 1.6) * nearby * tail
  );
}

export function qualityIdleGain(level: WaveQuality): number {
  switch (level) {
    case "off":
      return 0;
    case "basic":
      return 0.35;
    case "reduced":
      return 0.65;
    case "full":
      return 1;
  }
}

/** One-dimensional rack ripple: the four saved values select its intensity. */
export function punkArraySelectionWave(level: WaveQuality, distance: number, age: number): number {
  return qualitySelectionWave("full", distance, age) * (qualityIdleGain(level) ?? 0);
}

/** Maximum absolute displacement contributed by selected-item waves. */
export function qualityWaveLimit(level: WaveQuality): number {
  switch (level) {
    case "off":
      return 0;
    case "basic":
      return 0.2;
    case "reduced":
      return 0.4;
    case "full":
      return 0.6;
  }
}

/** Maximum concurrent selection waves retained by the scene. */
export function qualityPulseLimit(level: WaveQuality): number {
  switch (level) {
    case "off":
      return 0;
    case "basic":
      return 1;
    case "reduced":
      return 3;
    case "full":
      return 6;
  }
}
