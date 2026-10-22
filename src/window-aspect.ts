import { ui } from "./i18n";
import { WINDOW_ASPECTS, fitAspectSize, normalizeWindowAspect } from "./window-aspect-model.mjs";

export function windowAspectMarkup(value: unknown) {
  const selected = normalizeWindowAspect(value);
  return ui`<section class="window-aspect-settings" aria-labelledby="window-aspect-title"><h3 id="window-aspect-title">窗口显示</h3><label class="settings-row"><span>窗口比例<small>两种主题共用</small></span><select data-window-aspect aria-label="播放器窗口比例">${WINDOW_ASPECTS.map(item => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${item.id === "free" ? ui`自由比例` : item.label}</option>`).join("")}</select></label><p>固定比例下，拖动窗口边框会保持比例；选择自由比例后可分别调整宽高。</p><small class="window-aspect-baseline">显示基准：1920 × 1080 及以上。</small></section>`;
}

/** Keep the selected canvas ratio even when Windows maximizes the outer window. */
export function applyWindowAspect(stage: HTMLElement, value: unknown, background?: string) {
  const aspect = normalizeWindowAspect(value);
  stage.dataset.windowAspect = aspect;
  const viewport = stage.ownerDocument.defaultView!;
  if (aspect === "free") {
    for (const name of ["inset", "left", "top", "right", "bottom", "width", "height"]) stage.style.removeProperty(name);
  } else {
    const size = fitAspectSize(viewport.innerWidth, viewport.innerHeight, aspect);
    Object.assign(stage.style, { inset: "auto", left: `${Math.max(0, (viewport.innerWidth - size.width) / 2)}px`, top: `${Math.max(0, (viewport.innerHeight - size.height) / 2)}px`, width: `${size.width}px`, height: `${size.height}px` });
  }
  stage.ownerDocument.body.style.backgroundColor = background ?? getComputedStyle(stage).backgroundColor;
}
