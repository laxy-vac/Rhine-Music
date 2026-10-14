import {
  fitAspectSize,
  normalizeWindowAspect,
  windowAspectRatio,
} from "../src/window-aspect-model.mjs";

const MIN_CONTENT_WIDTH = 700;
const MIN_FREE_CONTENT_HEIGHT = 450;
const INITIAL_CONTENT_WIDTH = 1920;

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function readBounds(win) {
  const bounds = win.getBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function readFrameSize(win, bounds) {
  const [outerWidth, outerHeight] = win.getSize?.() ?? [bounds.width, bounds.height];
  const [contentWidth, contentHeight] =
    win.getContentSize?.() ?? [outerWidth, outerHeight];
  return {
    width: Math.max(0, outerWidth - contentWidth),
    height: Math.max(0, outerHeight - contentHeight),
  };
}

function readWorkArea(screen, bounds) {
  if (!screen) return undefined;
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const displays = [];
  try {
    if (typeof screen.getDisplayMatching === "function") {
      displays.push(screen.getDisplayMatching(bounds));
    }
  } catch {}
  try {
    if (typeof screen.getDisplayNearestPoint === "function") {
      displays.push(screen.getDisplayNearestPoint(center));
    }
  } catch {}
  try {
    if (typeof screen.getPrimaryDisplay === "function") {
      displays.push(screen.getPrimaryDisplay());
    }
  } catch {}

  for (const display of displays) {
    const area = display?.workArea;
    if (
      area &&
      isFiniteNumber(area.width) &&
      isFiniteNumber(area.height) &&
      area.width >= 1 &&
      area.height >= 1
    ) {
      return {
        x: isFiniteNumber(area.x) ? area.x : 0,
        y: isFiniteNumber(area.y) ? area.y : 0,
        width: area.width,
        height: area.height,
      };
    }
  }
  return undefined;
}

function usableContentArea(area, frame) {
  if (!area) return undefined;
  return {
    width: Math.max(1, area.width - frame.width),
    height: Math.max(1, area.height - frame.height),
  };
}

function minContentSize(aspect, usableArea) {
  if (aspect === "free") {
    let scale = 1;
    if (usableArea) {
      scale = Math.min(
        1,
        usableArea.width / MIN_CONTENT_WIDTH,
        usableArea.height / MIN_FREE_CONTENT_HEIGHT,
      );
    }
    return {
      width: Math.max(1, Math.floor(MIN_CONTENT_WIDTH * scale)),
      height: Math.max(1, Math.floor(MIN_FREE_CONTENT_HEIGHT * scale)),
    };
  }

  const ratio = windowAspectRatio(aspect);
  const baseHeight = Math.ceil(MIN_CONTENT_WIDTH / ratio);
  const width = usableArea
    ? Math.min(MIN_CONTENT_WIDTH, usableArea.width)
    : MIN_CONTENT_WIDTH;
  const height = usableArea ? Math.min(baseHeight, usableArea.height) : baseHeight;
  return fitAspectSize(width, height, aspect);
}

function withinWorkArea(bounds, width, height, area) {
  if (!area) {
    return {
      x: Math.round(bounds.x + (bounds.width - width) / 2),
      y: Math.round(bounds.y + (bounds.height - height) / 2),
      width,
      height,
    };
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    width,
    height,
  };
}

function isWindowUnavailable(win) {
  return win.isDestroyed?.() === true;
}

function isWindowMaximizedOrFullScreen(win) {
  return win.isMaximized?.() === true || win.isFullScreen?.() === true;
}

/** Attach Electron's native aspect constraint and size the window in DIPs. */
export function attachWindowAspect(win, { screen, initialAspect } = {}) {
  if (!win || typeof win.setAspectRatio !== "function") {
    throw new TypeError("win must be an Electron BrowserWindow");
  }

  let aspect = normalizeWindowAspect(initialAspect);
  let destroyed = false;

  function applyMinimumSize(bounds) {
    const frame = readFrameSize(win, bounds);
    const area = readWorkArea(screen, bounds);
    const usableArea = usableContentArea(area, frame);
    const minimum = minContentSize(aspect, usableArea);
    win.setMinimumSize(
      minimum.width + frame.width,
      minimum.height + frame.height,
    );
  }

  function resizeToAspect(initial) {
    if (destroyed || isWindowUnavailable(win) || (aspect === "free" && !initial)) return;
    if (isWindowMaximizedOrFullScreen(win)) return;

    const bounds = readBounds(win);
    const frame = readFrameSize(win, bounds);
    const area = readWorkArea(screen, bounds);
    const usableArea = usableContentArea(area, frame);
    const [contentWidth] = win.getContentSize?.() ?? [
      Math.max(1, bounds.width - frame.width),
    ];
    let contentSize;

    if (initial && aspect === "free") {
      contentSize = fitAspectSize(Math.min(INITIAL_CONTENT_WIDTH, usableArea?.width ?? INITIAL_CONTENT_WIDTH), Math.min(1080, usableArea?.height ?? 1080), "free");
    } else if (initial) {
      if (usableArea) {
        contentSize = fitAspectSize(
          Math.min(INITIAL_CONTENT_WIDTH, usableArea.width),
          usableArea.height,
          aspect,
        );
      } else {
        contentSize = fitAspectSize(
          INITIAL_CONTENT_WIDTH,
          INITIAL_CONTENT_WIDTH / windowAspectRatio(aspect),
          aspect,
        );
      }
    } else {
      const minimum = minContentSize(aspect, usableArea);
      const desiredWidth = Math.max(contentWidth, minimum.width);
      if (usableArea) {
        contentSize = fitAspectSize(
          Math.min(desiredWidth, usableArea.width),
          usableArea.height,
          aspect,
        );
      } else {
        contentSize = fitAspectSize(
          desiredWidth,
          desiredWidth / windowAspectRatio(aspect),
          aspect,
        );
      }
    }

    const next = withinWorkArea(
      bounds,
      Math.round(contentSize.width + frame.width),
      Math.round(contentSize.height + frame.height),
      area,
    );
    if (
      next.x !== bounds.x ||
      next.y !== bounds.y ||
      next.width !== bounds.width ||
      next.height !== bounds.height
    ) {
      win.setBounds(next);
    }
  }

  function apply(value, { initial = false } = {}) {
    if (destroyed || isWindowUnavailable(win)) return aspect;
    aspect = normalizeWindowAspect(value);
    const bounds = readBounds(win);
    win.setAspectRatio(windowAspectRatio(aspect));
    applyMinimumSize(bounds);
    resizeToAspect(initial);
    return aspect;
  }

  const onRestored = () => {
    if (destroyed || isWindowUnavailable(win)) return;
    applyMinimumSize(readBounds(win));
    resizeToAspect(false);
  };
  win.on("restore", onRestored);
  win.on("unmaximize", onRestored);
  win.on("leave-full-screen", onRestored);

  apply(aspect, { initial: true });

  return {
    set: apply,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.removeListener("restore", onRestored);
      win.removeListener("unmaximize", onRestored);
      win.removeListener("leave-full-screen", onRestored);
    },
  };
}
