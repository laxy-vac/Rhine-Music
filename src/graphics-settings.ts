import { ui } from "./i18n";
import { qualityMarkup, waveQualityMarkup } from "./quality-settings";
import type { RenderQuality } from "./render-quality";
import type { MusicLayout } from "./music-view-settings";
import { windowAspectMarkup } from "./window-aspect";

export function graphicsSettingsMarkup(
  quality: RenderQuality,
  design: "rhine" | "archive",
  layout: MusicLayout,
  windowAspect: unknown,
  reduced: boolean,
) {
  return ui`<section id="graphics-display-settings" class="graphics-display-settings" aria-labelledby="graphics-display-title">
    <div class="style-section-heading"><div><small>DISPLAY / RENDERING</small><h2 id="graphics-display-title">显示与渲染</h2></div></div>
    <div class="graphics-window-settings">
      ${windowAspectMarkup(windowAspect)}
      <label class="style-setting-row"><span>全屏显示<small>保留当前窗口比例，退出后恢复窗口</small></span><button type="button" class="graphics-fullscreen-button" data-action="fullscreen" aria-pressed="false">进入全屏 ↗</button></label>
    </div>
    <section class="graphics-motion-settings" aria-labelledby="graphics-motion-title">
      <h3 id="graphics-motion-title">动态效果</h3>
      <label class="style-setting-row style-switch-row"><span>减少动态效果<small>简化镜头、文字加载和页签过渡</small></span><input type="checkbox" role="switch" id="reduced-motion" ${reduced ? "checked" : ""}></label>
      ${waveQualityMarkup(quality, design, layout)}
    </section>
    <div data-gpu-settings></div>
    ${qualityMarkup(quality, design, layout, true)}
  </section>`;
}
