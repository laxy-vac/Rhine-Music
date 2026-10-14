const presets = [
  { id: "16:9", label: "16:9", width: 16, height: 9 },
  { id: "16:10", label: "16:10", width: 16, height: 10 },
  { id: "4:3", label: "4:3", width: 4, height: 3 },
  { id: "3:2", label: "3:2", width: 3, height: 2 },
  { id: "21:9", label: "21:9", width: 21, height: 9 },
  { id: "free", label: "自由", width: 0, height: 0 },
];

export const WINDOW_ASPECTS = Object.freeze(
  presets.map((preset) => Object.freeze(preset)),
);

const presetById = new Map(WINDOW_ASPECTS.map((preset) => [preset.id, preset]));

export function normalizeWindowAspect(value) {
  return typeof value === "string" && presetById.has(value) ? value : "16:9";
}

export function windowAspectRatio(value) {
  const preset = presetById.get(normalizeWindowAspect(value));
  return preset.width === 0 ? 0 : preset.width / preset.height;
}

function dimension(value, name) {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`${name} must be a finite number greater than or equal to 1`);
  }
  return value;
}

/** Fit a fixed ratio inside the available dimensions, rounding to whole DIPs. */
export function fitAspectSize(availableWidth, availableHeight, value) {
  const width = dimension(availableWidth, "availableWidth");
  const height = dimension(availableHeight, "availableHeight");
  const id = normalizeWindowAspect(value);
  if (id === "free") return { width, height };

  const preset = presetById.get(id);
  const ratio = preset.width / preset.height;
  const maxWidth = Math.floor(width);
  const maxHeight = Math.floor(height);

  if (maxWidth / ratio <= maxHeight) {
    const fittedWidth = Math.max(1, maxWidth);
    let fittedHeight = Math.max(1, Math.round(fittedWidth / ratio));
    if (fittedHeight > maxHeight) {
      fittedHeight = Math.max(1, maxHeight);
      return {
        width: Math.min(maxWidth, Math.max(1, Math.round(fittedHeight * ratio))),
        height: fittedHeight,
      };
    }
    return { width: fittedWidth, height: fittedHeight };
  }

  const fittedHeight = Math.max(1, maxHeight);
  let fittedWidth = Math.max(1, Math.round(fittedHeight * ratio));
  if (fittedWidth > maxWidth) {
    fittedWidth = Math.max(1, maxWidth);
    return {
      width: fittedWidth,
      height: Math.min(maxHeight, Math.max(1, Math.round(fittedWidth / ratio))),
    };
  }
  return { width: fittedWidth, height: fittedHeight };
}
