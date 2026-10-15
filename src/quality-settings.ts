import { trUi, ui } from "./i18n";
import {
  matchingPreset,
  presetLabels,
  type QualityPreset,
  type RenderQuality,
} from "./render-quality";

function select(
  quality: RenderQuality,
  key: keyof RenderQuality,
  label: string,
  hint: string,
  choices: (readonly [string | number, string])[],
) {
  return `<label class="quality-control"><span>${label}<small>${hint}</small></span><select data-quality="${key}" aria-label="${label}">${choices.map(([value, text]) => `<option value="${value}" ${quality[key] === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
}
function range(
  quality: RenderQuality,
  key: "scale" | "depthOfField",
  label: string,
  hint: string,
  min: number,
  max: number,
) {
  return `<label class="quality-control quality-range"><span>${label}<small>${hint}</small></span><div><input type="range" data-quality="${key}" aria-label="${label}" min="${min}" max="${max}" step="5" value="${quality[key]}"/><output data-quality-output="${key}">${quality[key]}%</output></div></label>`;
}
export function qualityMarkup(quality: RenderQuality, design?: "rhine" | "archive") {
  const preset = matchingPreset(quality);
  const archiveWave = design === "archive";
  return ui`<section class="quality-settings" aria-label="画质设置">
    <div class="quality-heading"><h3>RENDER QUALITY <span>渲染画质</span></h3><select id="quality-preset" aria-label="画质预设">${(Object.keys(presetLabels) as QualityPreset[]).map((key) => `<option value="${key}" ${preset === key ? "selected" : ""}>${presetLabels[key]}</option>`).join("")}<option value="custom" disabled ${preset === "custom" ? "selected" : ""}>自定义</option></select></div>
    <p class="quality-summary" id="quality-summary" aria-live="polite"></p>
    ${design ? `<p class="quality-note">${trUi("两种主题共用这组画质设置，切换主题后继续沿用。")}</p>` : ""}
    ${design ? `<div class="quality-grid quality-core-grid">
    ${select(
      quality,
      "wave",
      trUi(archiveWave ? "水波强度" : "波动效果"),
      trUi(archiveWave ? "阵列仅当前排起伏，矩阵保留连续波动。" : "调整唱片的传播和待机起伏"),
      [
        ["off", trUi("关闭")],
        ["basic", trUi(archiveWave ? "轻柔" : "近邻")],
        ["reduced", trUi(archiveWave ? "适中" : "平衡")],
        ["full", trUi(archiveWave ? "强烈" : "完整")],
      ],
    )}
    ${select(
      quality,
      "modelDetail",
      trUi("盒体细节"),
      trUi("适用于可调的 3D 盒体"),
      [
        ["low", trUi("简洁")],
        ["medium", trUi("标准")],
        ["high", trUi("精细")],
      ],
    )}
    ${select(
      quality,
      "lighting",
      trUi("盒体光影"),
      trUi("适用于可调的 3D 盒体"),
      [
        ["basic", trUi("基础")],
        ["high", trUi("增强")],
        ["full", trUi("完整")],
      ],
    )}
    ${select(
      quality,
      "terminalLight",
      trUi("终端局部受光"),
      trUi("Future 面板与悬浮控件之间的光照影响"),
      [
        ["off", trUi("关闭")],
        ["local", trUi("局部")],
        ["full", trUi("完整")],
      ],
    )}
    </div>` : ""}
    <details class="quality-advanced"><summary>精细设置 <span>清晰度 / 材质 / 阴影</span></summary><div class="quality-grid">
    ${range(quality, "scale", trUi("渲染比例"), trUi("提高比例可让画面更清晰，但会增加显卡负担"), 50, 200)}
    ${select(
      quality,
      "pixelRatio",
      trUi("像素密度上限"),
      trUi("调整高分辨率屏幕的画面精细度，降低可提高流畅度"),
      [1, 1.5, 2, 3].map((v) => [v, `${v}×`]),
    )}
    ${select(quality, "antialias", trUi("抗锯齿"), trUi("让专辑卡片和场景边缘更平滑"), [
      ["off", trUi("原始")],
      ["smaa", "SMAA"],
    ])}
    ${select(
      quality,
      "anisotropy",
      trUi("纹理过滤"),
      trUi("让倾斜角度下的封面和文字更清晰"),
      [1, 2, 4, 8, 16].map((v) => [v, `${v}×`]),
    )}
    ${select(
      quality,
      "transmission",
      trUi("透明材质分辨率"),
      trUi("调整透过玻璃看到的画面清晰度"),
      [0.25, 0.5, 0.75, 1].map((v) => [v, `${v * 100}%`]),
    )}
    ${select(
      quality,
      "shadows",
      trUi("阴影分辨率 · 阵列"),
      trUi("提高可让阴影边缘更细腻，但会增加显卡负担"),
      [
        [0, trUi("关闭")],
        [1024, "1024"],
        [2048, "2048"],
        [4096, "4096"],
      ],
    )}
    ${select(
      quality,
      "aoSamples",
      trUi("环境遮蔽 · 阵列"),
      trUi("调整卡片接缝和遮挡处的暗部细节"),
      [
        [0, trUi("关闭")],
        [16, trUi("16 采样")],
        [32, trUi("32 采样")],
        [64, trUi("64 采样")],
      ],
    )}
    ${select(
      quality,
      "aoResolution",
      trUi("遮蔽分辨率 · 阵列"),
      trUi("降低可提高流畅度，提高可让暗部更细腻"),
      [0.5, 0.75, 1].map((v) => [v, `${v * 100}%`]),
    )}
    ${range(quality, "depthOfField", trUi("景深强度 · 阵列"), trUi("调整远处景物的虚化程度，设为 0% 可关闭"), 0, 150)}
    </div></details><p class="quality-note">${design === "archive" ? trUi("调整后自动保存。若画面卡顿，可降低渲染比例或像素密度上限。") : trUi("调整后自动保存。若画面卡顿，可降低渲染比例、阴影和暗部细节。")}</p>
  </section>`;
}

export function syncQualityUI(quality: RenderQuality) {
  const preset = document.querySelector<HTMLSelectElement>("#quality-preset");
  if (!preset) return;
  preset.value = matchingPreset(quality);
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-quality]")
    .forEach((control) => {
      const key = control.dataset.quality as keyof RenderQuality;
      control.value = String(quality[key]);
      control.disabled = key === "aoResolution" && quality.aoSamples === 0;
    });
  document
    .querySelectorAll<HTMLOutputElement>("[data-quality-output]")
    .forEach((output) => {
      output.value = `${quality[output.dataset.qualityOutput as keyof RenderQuality]}%`;
    });
}
