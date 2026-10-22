import { mainEnglish } from "./i18n-main-en.ts";
import { panelsEnglish } from "./i18n-panels-en.ts";
import { lspEnglish } from "./i18n-lsp-en.ts";
import { metadataEnglish } from "./i18n-metadata-en.ts";

export type UiLanguage = "zh-CN" | "en";
const preferenceKey = "rhine-ui-language";
export function readUiLanguage(): UiLanguage {
  try {
    return localStorage.getItem(preferenceKey) === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}
const language = readUiLanguage();
export const uiLanguage = () => language;
export function lyricSourceLabel(value?: {
  id?: string;
  sourceId?: string;
  name?: string;
}): string {
  if (!value) return "";
  const id = value.id ?? value.sourceId;
  if (language === "en" && id === "netease") return "NetEase Cloud Music";
  if (language === "en" && id === "qq") return "QQ Music";
  return value.name ?? "";
}
export function saveUiLanguage(next: string): void {
  if (next !== "zh-CN" && next !== "en") return;
  localStorage.setItem(preferenceKey, next);
}
if (typeof document !== "undefined") document.documentElement.lang = language;
const english: Record<string, string> = {
  ...lspEnglish,
  ...mainEnglish,
  ...panelsEnglish,
  ...metadataEnglish,
  "唱片盒体": "Album cases",
  "请输入有效 HEX 颜色：#RGB 或 #RRGGBB": "Enter a valid HEX colour: #RGB or #RRGGBB",
  "通用部件设置": "Shared part settings",
  "仿孤星内置预设": "Lone Trail–Inspired built-in presets",
  "内置预设用于切换整盒颜色与材质，部件位置保持不变。": "Built-in presets change the case colours and materials while keeping part positions.",
  "我的预设": "My presets",
  "保存当前整盒的外观和部件设置，以后可一键使用。": "Save this case's appearance and part settings to use again.",
  "还没有个人预设。调整满意后，在下方命名保存。": "No personal presets yet. Name and save your changes below.",
  "预设名称": "Preset name", "例如：暖白磨砂": "For example: Warm frosted white",
  "保存为新预设": "Save as new preset",
  "颜色与材质": "Colours and materials",
  "调整哪个部件": "Part to edit",
  "部件显隐、位置、角度与比例": "Part visibility, position, rotation and scale",
  "预设名称最多64个字符。": "Preset names can contain up to 64 characters.",
  "精细盒体 · 透光设置": "Detailed case · Optical settings",
  "透光率控制光穿过材质的程度；透明度控制部件本身淡出的程度。": "Transmission controls light passing through the material. Transparency fades the part itself.",
  "简单粗糙 · 玻璃设置": "Simple case · Glass settings",
  "只调整玻璃主体与背板，专辑封面和金色边缘保持不变。": "Adjusts only the glass body and backing; album artwork and gold trim stay unchanged.",
  "透明度": "Transparency",
  "磨砂度": "Frosting",
  "恢复原始透光设置": "Restore original optical settings",
  "恢复玻璃默认设置": "Restore glass defaults",
  "简单粗糙款可调玻璃透光与磨砂度；精细款可调透光与透明度；仿孤星拓展可深度定制并保存预设。": "Simple glass transmission and frosting are adjustable. Detailed supports transmission and transparency; Lone Trail–Inspired extension supports customization and saved presets.",
  "进阶光学参数": "Advanced optics",
  "仅替换当前部件的材质": "Replace only this part's material",
  "恢复当前盒体默认设置": "Restore this case's defaults",
  "正在调整：": "Editing: ",
  "先选择盒体。通用设置适用于三种盒体，仿孤星拓展可另外调整颜色和材质。": "Choose a case. Shared settings apply to all three; Lone Trail–Inspired extension also supports colours and materials.",
  "当前外观已调整，可在“我的预设”中命名保存。": "This appearance has been edited. Name and save it under My presets.",
  "已使用个人预设：": "Applied personal preset: ",
  "删除这个个人预设？": "Delete this personal preset?",
  "删除预设": "Delete preset",
  "确认删除此预设": "Confirm deletion",
  "取消删除": "Cancel deletion",
  "预设已删除，当前盒体外观保留。": "Preset deleted. The current case appearance is kept.",
  "请先填写预设名称。": "Enter a preset name first.",
  "已有同名预设，请使用其他名称。": "A preset with this name already exists. Choose another name.",
  "个人预设已达50个，请先删除不需要的预设。": "You have 50 personal presets. Delete one before adding another.",
  "已保存到本机：": "Saved locally: ",
  "预设未保存：": "Preset was not saved: ",
  "本地设置空间不足，预设未保存。": "Local settings are full. The preset was not saved.",
  "简单粗糙": "Simple",
  "仿孤星拓展": "Lone Trail–Inspired extension",
  "仿孤星盒体": "Lone Trail–Inspired case",
  "仿孤星使用专属盒体，可调整外观和部件。": "Lone Trail–Inspired uses its own case. Customize its finish and parts.",
  "选择简单粗糙、精细或 仿孤星拓展盒体，预览会同步更新。": "Choose Simple, Detailed, or Lone Trail–Inspired extension with a live preview.",
  "极简盒体 · 极致省资源": "Minimal case · Lowest resource use",
  "RhineLab 精细盒体": "RhineLab detailed case",
  "仿孤星通用盒体": "Lone Trail–Inspired universal case",
  "仿孤星复刻盒体": "Lone Trail–Inspired reference reconstruction",
  "外框": "Frame", "透明盖板": "Glass cover", "背板 / 内衬": "Backing / Inlay", "标记与装饰": "Accent details",
  "封面窗盖": "Cover window", "脊边": "Spine edge", "卡扣": "Clip", "螺钉与紧固件": "Screws and fasteners",
  "正面封装玻璃": "Full front glass", "右侧内板": "Right inlay", "渐变方向（度）": "Gradient angle (degrees)",
  "专辑位于封装玻璃后方，玻璃的透色与反光会参与预览。": "Album art sits inside the case, behind the tinted and reflective front glass.",
  "徽记": "Emblem", "标签板": "Label plate", "标签墨层": "Label ink", "饰条": "Trim", "刻度线": "Ruler marks",
  "通风槽": "Vents", "字标": "Lettering", "光学件": "Optics", "透明薄片": "Clear film", "薄片边缘": "Film edge",
  "琥珀透光件": "Amber optical insert", "陶瓷件": "Ceramic part", "内沿": "Inner rim", "饰条高光": "Trim highlight",
  "透明玻璃": "Clear glass", "磨砂玻璃": "Frosted glass", "金属": "Metal", "涂层": "Coating",
  "莱茵原色": "Rhine original", "霜面玻璃": "Frosted glass", "哑白金属": "Matte white metal", "深色金属": "Dark metal", "珊瑚透色": "Translucent coral",
  "Rhine 原始材质": "Rhine original materials", "大理石": "Marble", "危标碳纤": "Hazard carbon fiber",
  "霜白陶瓷": "Frosted white ceramic", "薄荷透明": "Mint clear", "雾霜琥珀": "Frosted amber", "烈焰红": "Flame red",
  "冰蓝金属": "Ice blue metal", "珊瑚暖粉": "Warm coral", "潮汐蓝绿": "Tidal blue-green", "极光渐变": "Aurora gradient",
  "无纹理": "No pattern", "碳纤维": "Carbon fiber", "渐变": "Gradient", "拉丝": "Brushed",
  "可按部件调整颜色、材质和位置。": "Customize each part's colour, material and position.",
  "使用 Rhine GLB 模型原始材质；关闭部件开关后可自定义。": "Uses the Rhine GLB's original materials. Turn off the part switch to customize them.",
  "唱片盒体编辑器": "Album case editor", "可调唱片盒体": "Customizable album cases",
  "切换结构、表面和材料参数，预览会同步更新。": "Change the structure and materials with a live preview.",
  "重置当前外观": "Reset current finish", "盒体结构": "Case structure", "可调盒体": "Customizable case",
  "关闭后，仿孤星保留原版盒体外观。": "Turn off to use the original Lone Trail–Inspired case artwork.",
  "外观预设": "Finish presets", "盒体部件": "Case parts", "材质类型": "Material",
  "从预设取材": "Use material from preset", "部件材质来源预设": "Source preset for this part", "应用到当前部件": "Apply to current part",
  "表面纹理": "Pattern", "纹理辅色": "Secondary color", "金属度": "Metalness", "清漆层": "Clearcoat", "清漆粗糙度": "Clearcoat roughness", "薄膜干涉": "Iridescence",
  "光学厚度（模型单位）": "Optical thickness (model units)", "衰减距离（模型单位）": "Attenuation distance (model units)",
  "使用模型原始材质": "Use model's original material",
  "启用时使用模型内置材质；关闭后可自定义。": "Use the model's built-in material when enabled. Turn off to customize.",
  "部件位置、角度与比例": "Part position, rotation, and scale", "位置使用模型单位；旋转使用度数。变换会随当前盒体外观配置保存。": "Position uses model units; rotation uses degrees. Transforms are saved with this case appearance.",
  "显示此部件": "Show this part", "显示专辑封面": "Show album cover", "仅控制此预览，用来检查被封面遮住的壳体细节。": "Preview only; hide the cover to inspect shell details behind it.",
  "极简结构仅包含外框、封面窗盖和背板；其他部件在当前结构中不可用。": "The minimal structure contains only the frame, cover window, and backing; other parts are unavailable.",
  "当前结构不包含此部件。": "This part is unavailable in the current structure.",
  "已自定义材质参数；可通过部件开关恢复模型原始材质。": "Custom material values are saved. Use the part switch to restore the model's original material.",
  "基准外观；切换到 Rhine 结构可使用模型原始材质。": "Base finish. Switch to the Rhine structure to use the model's original materials.",
  "粗糙度": "Roughness", "透光率": "Transmission", "折射率 IOR": "Refractive index", "发光强度": "Emission",
  "盒体三维预览": "3D case preview", "唱片盒体预览": "Album case preview", "预览视角": "Preview angle", "陈列": "Display", "正面": "Front",
  "拖动可旋转盒体。当前专辑封面仅作为独立表面预览。": "Drag to rotate. Album art is displayed on an independent surface.",
  "当前结构": "Selected structure", "极简盒体不包含独立装饰部件。": "The minimal case has no separate accent parts.",
  "暂无封面": "No cover artwork", "封面以原始颜色独立呈现，不受盒体材质调色影响。": "Album art retains its original colours independently of case materials.",
  "当前没有封面，使用安静的文字占位。可拖动旋转盒体。": "No artwork available. Drag to rotate the preview.",
  "无法载入盒体模型：": "Could not load the case model:", "可拖动旋转的盒体三维预览": "Interactive 3D album case preview",
  "当前浏览器无法创建 3D 预览。": "This browser could not create the 3D preview.",
  "阵列波动": "Array waves", "专辑之间的传播、近邻联动和待机起伏": "Travelling waves and idle motion for Rhine Lab: Reflections and customizable cases",
  "水波强度": "Wave intensity", "波动效果": "Wave motion",
  "阵列仅当前排起伏，矩阵保留连续波动。": "Only the selected ARRAY row undulates; MATRIX keeps continuous waves.",
  "调整唱片的传播和待机起伏": "Adjust wave propagation between records and their idle motion.",
  "轻柔": "Gentle", "适中": "Moderate", "强烈": "Strong",
  "盒体细节": "Case detail", "适用于可调的 3D 盒体": "Applies to customizable 3D cases", "简洁": "Simple", "精细": "Detailed",
  "盒体光影": "Case lighting", "增强": "Enhanced", "终端局部受光": "Terminal light interaction",
  "面板与悬浮控件之间的光照影响": "Light shared between Rhine Lab: Reflections panels and floating controls",
  "近邻": "Nearby", "平衡": "Balanced", "局部": "Local", "完整": "Full", "基础": "Basic",
  "流畅": "Performance", "均衡": "Balanced", "高画质": "High", "极致": "Ultra",
  "盒体细节与灯光选项适用于可调盒体；仿孤星原版盒体保留固定光影与虚化。": "Case detail and lighting apply to customizable 3D cases. Original Lone Trail–Inspired artwork retains its fixed lighting and blur.",
  界面语言: "Interface language",
  "应用语言 ↗": "Apply language ↗",
  切换后重新载入界面: "Reload the interface to apply",
  简体中文: "简体中文",
  未提供: "Not provided",
  主题: "Style",
  主题与显示: "Style and display",
  播放器比例: "Player aspect ratio",
  窗口比例: "Window aspect ratio",
  播放器窗口比例: "Player window aspect ratio",
  自由比例: "Free aspect ratio",
  "两种主题共用": "Shared by Rhine Lab: Reflections and Lone Trail–Inspired",
  "固定比例下，拖动窗口边框会保持比例；选择自由比例后可分别调整宽高。": "Fixed ratios stay locked when resizing the window. Choose Free to adjust width and height independently.",
  "显示基准：1920 × 1080 及以上。": "Display baseline: 1920 × 1080 and above.",
  "组合颜色、唱片盒与陈列方式": "Combine colours, cases and display layouts",
  界面显示: "Interface display",
  陈列朝向: "Display direction",
  碟数: "Discs",
  浅色: "Light",
  深色: "Dark",
  "查看正在播放的专辑": "Inspect the playing album",
  "查看所选专辑": "Inspect the selected album",
  "播放歌曲后，可查看实际音频链路。": "Play a track to view the active audio signal chain.",
  "尚无播放链路": "No active signal chain",
  "当前专辑播放队列": "Playing album queue",
  "当前专辑曲目": "Playing album tracks",
  "这张专辑没有可显示的曲目": "This album has no tracks to display",
  "无法读取正在播放曲目的专辑曲目": "The playing album's tracks are unavailable",
  "目前没有正在播放的曲目": "No track is playing",
  "开始播放后，这里会显示当前专辑的曲目。": "Start playback to see this album's tracks here.",
  "调整后自动保存。若画面卡顿，可降低渲染比例或像素密度上限。": "Changes save automatically. Lower the render scale or pixel density limit for smoother performance.",
  "两种主题共用这组画质设置，切换主题后继续沿用。": "Both themes share these quality settings and keep them when switching.",
  "以下选项适用于莱茵生命：映像；仿孤星原版盒体保留固定光影与虚化。": "The options below apply to the Rhine Lab: Reflections scene when you switch back. Lone Trail–Inspired cases retain their original lighting and blur.",
  "无法读取有效的舞台尺寸，请调整播放器窗口后重试。": "Could not read the stage size. Resize the player window and try again.",
  "货架浏览": "Shelf browsing",
  "开盒与收盒": "Opening and closing the case",
  "建议采用": "Recommended:",
  "最低画质也未达到稳定 60 FPS，本次没有画质建议。": "The lowest quality preset did not sustain a stable 60 FPS. No recommendation is available.",
  "预设": "Preset",
  "货架 FPS": "Shelf FPS",
  "开盒/收盒 FPS": "Case open/close FPS",
  "帧间隔": "frame interval",
  "慢帧": "Slow frames",
  "有效帧": "Frame samples",
  "主动性能检测": "Performance check",
  "使用固定合成场景检查货架移动与开盒动画，不读取曲库，也不会播放音频。": "Measure shelf movement and case opening with a fixed synthetic scene. No music library is read and no audio is played.",
  "开始检测": "Run check",
  "建议在播放器前台运行检测。": "Keep the player in the foreground while the check runs.",
  "采用推荐画质": "Use recommended quality",
  "检测会逐帧等待 GPU 完成，结果偏保守；日常使用不会自动切换画质。": "The check waits for each GPU frame to finish, so results are conservative. Quality will not change automatically during normal use.",
  "检测页面必须与播放器来自同一来源。": "The benchmark page must share the player's origin.",
  "无法启动检测。": "Could not start the check.",
  "正在准备隔离检测场景…": "Preparing the isolated test scene…",
  "画质性能检测": "Graphics performance check",
  "性能检测的合成货架预览": "Synthetic shelf preview for the performance check",
  "正在检查画质预设": "Checking quality presets",
  "等待检测页面就绪…": "Waiting for the benchmark page…",
  "取消检测": "Cancel check",
  "固定合成唱片 · 无音频播放 · 不读取个人曲库": "Fixed synthetic albums · no audio playback · no personal library access",
  "正在取消并释放检测场景…": "Cancelling and releasing the test scene…",
  "检测已取消，画质设置未更改。": "Check cancelled. Quality settings were not changed.",
  "场景或显示尺寸已改变，请重新检测。": "The scene or display size changed. Run the check again.",
  "播放器切到后台，检测结果已作废。": "The player went to the background, so the result was discarded.",
  "检测结果无效，本次没有画质建议。": "The check returned invalid results. No quality recommendation is available.",
  "检测完成。采用建议后才会更新播放器设置。": "Check complete. Player settings change only if you apply the recommendation.",
  "检测场景无法初始化，本次没有画质建议。": "Could not initialize the benchmark scene. No recommendation is available.",
  "初始化": "Preparing",
  "预热": "Warming up",
  "测量": "Measuring",
  "检测超时，画质设置未更改。": "The check timed out. Quality settings were not changed.",
  "已采用": "Applied",
  "无法应用推荐画质。": "Could not apply the recommended quality preset.",
};
const hasHan = (text: string) => /\p{Script=Han}/u.test(text);
type MarkupContext = { tag: boolean; quote: string };
const punctuation = (value: string) =>
  value.replace(
    /[：，。；（）]/gu,
    (char) =>
      ({ "：": ":", "，": ",", "。": ".", "；": ";", "（": "(", "）": ")" })[
        char
      ]!,
  );
function translateStatic(
  source: string,
  markup = false,
  context: MarkupContext = { tag: false, quote: "" },
): string {
  return source
    .split(/([<>"'=\n\r])/u)
    .map((part) => {
      if (markup && part.length === 1) {
        if (part === "<" && !context.quote) context.tag = true;
        else if (part === ">" && !context.quote) context.tag = false;
        else if (context.tag && (part === '"' || part === "'"))
          context.quote = context.quote === part ? "" : context.quote || part;
      }
      const key = part.trim();
      if (!Object.hasOwn(english, key)) return punctuation(part);
      let value = punctuation(english[key]);
      if (markup) {
        value = value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
        if (context.quote)
          value = value.replaceAll('"', "&quot;").replaceAll("'", "&#39;");
      }
      const start = part.length - part.trimStart().length;
      return part.slice(0, start) + value + part.slice(part.trimEnd().length);
    })
    .join("");
}

/** Application-authored literals only. Never pass a track, lyric, path or user name. */
export function trUi(source: string): string {
  if (language === "zh-CN" || !hasHan(source)) return source;
  if (Object.hasOwn(english, source)) return english[source];
  // Static HTML literals and template chunks: translate text/attribute fragments
  // before interpolation. Values, URLs, identifiers and user input stay untouched.
  return translateStatic(source, /<[a-z/!]/iu.test(source));
}

/** Translate authored chunks before substituting any dynamic content. */
export function ui(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  let result = "";
  const markup = strings.some((value) => /<[a-z/!]/iu.test(value));
  const context: MarkupContext = { tag: false, quote: "" };
  for (let i = 0; i < strings.length; i++) {
    let chunk =
      language === "en"
        ? translateStatic(strings[i], markup, context)
        : strings[i];
    if (
      language === "en" &&
      hasHan(strings[i]) &&
      /[\p{L}\p{N}]$/u.test(result) &&
      /^[\p{L}\p{N}]/u.test(chunk)
    )
      chunk = " " + chunk;
    result += chunk;
    if (i < values.length) {
      const value = String(values[i]);
      if (
        language === "en" &&
        hasHan(strings[i]) &&
        /[\p{L}\p{N}]$/u.test(chunk) &&
        /^[\p{L}\p{N}]/u.test(value)
      )
        result += " ";
      result += value;
    }
  }
  return result;
}
