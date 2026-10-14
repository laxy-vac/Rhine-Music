import { isDsdAlbum, isHiResAlbum } from "./hi-res.ts";
import type { MusicAlbum } from "./music-types.ts";

const LABEL_WIDTH = 1024;
const LABEL_HEIGHT = 440;

function isReadyMark(mark: CanvasImageSource): boolean {
  const image = mark as unknown as {
    complete?: unknown;
    naturalWidth?: unknown;
    naturalHeight?: unknown;
    readyState?: unknown;
    videoWidth?: unknown;
    videoHeight?: unknown;
    width?: unknown;
    height?: unknown;
    displayWidth?: unknown;
    displayHeight?: unknown;
  };

  if (typeof image.complete === "boolean") {
    if (!image.complete) return false;
    if (typeof image.naturalWidth === "number")
      return image.naturalWidth > 0 && typeof image.naturalHeight === "number" && image.naturalHeight > 0;
  }
  if (typeof image.readyState === "number")
    return image.readyState >= 2 && typeof image.videoWidth === "number" && image.videoWidth > 0 &&
      typeof image.videoHeight === "number" && image.videoHeight > 0;

  const width = image.displayWidth ?? image.width;
  const height = image.displayHeight ?? image.height;
  if (typeof width === "number" && typeof height === "number") return width > 0 && height > 0;
  return true;
}

/** Paint the original Rhine Lab cassette label using its 1024×440 design grid. */
export function paintArchiveLabel(
  canvas: HTMLCanvasElement,
  index: number | undefined,
  mark?: CanvasImageSource,
  options: { fit?: "stretch" | "contain"; background?: boolean } = {},
): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  context.save();
  try {
    const scaleX = canvas.width / LABEL_WIDTH;
    const scaleY = canvas.height / LABEL_HEIGHT;
    const contained = options.fit === "contain";
    const scale = Math.min(scaleX, scaleY);
    if (contained || options.background === false) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (options.background !== false) {
        context.fillStyle = "#e6e2d9";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    context.setTransform(contained ? scale : scaleX, 0, 0, contained ? scale : scaleY,
      contained ? (canvas.width - LABEL_WIDTH * scale) / 2 : 0,
      contained ? (canvas.height - LABEL_HEIGHT * scale) / 2 : 0);
    context.fillStyle = "#e6e2d9";
    if (options.background !== false) context.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);
    context.fillStyle = "#171713";
    context.fillRect(12, 12, 1000, 6);
    context.fillRect(12, 419, 1000, 3);
    context.font = "bold 81px MiSans, sans-serif";
    context.fillText("RHINE LAB, LLC.", 22, 116);
    context.font = "32px MiSans, sans-serif";
    context.fillStyle = "#878476";
    context.fillText("INTERNAL DATABASE", 25, 174);
    context.fillStyle = "#171713";
    context.font = "bold 130px MiSans, sans-serif";
    const number = typeof index === "number" && Number.isFinite(index) && Number.isInteger(index) && index >= 0
      ? String(index + 1).padStart(3, "0")
      : "---";
    context.fillText(`NO.${number}`, 22, 360);
    context.fillRect(782, 32, 221, 39);
    context.fillStyle = "#eee9de";
    context.font = "24px MiSans, sans-serif";
    context.fillText("R L / I S", 809, 61);
    context.fillStyle = "#171713";
    context.font = "bold 64px MiSans, sans-serif";
    context.fillText("INFO", 830, 143);
    if (mark && isReadyMark(mark)) context.drawImage(mark, 790, 242, 210, 98);
  } finally {
    context.restore();
  }
}

/** Evaluate both source qualifications independently so a DSD album can carry both marks. */
export function rhineSourceBadge(
  album?: Pick<MusicAlbum, "tracks">,
): "dsd" | "hi-res" | "hi-res-dsd" | undefined {
  const hiRes = isHiResAlbum(album);
  const dsd = isDsdAlbum(album);
  if (hiRes && dsd) return "hi-res-dsd";
  if (hiRes) return "hi-res";
  if (dsd) return "dsd";
  return undefined;
}
