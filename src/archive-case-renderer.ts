import { fileLocation, records, type ArchiveRecord } from "./data";
import { getFoobarLocation, getFoobarShelves } from "./foobar-shelves";
import { getFoobarCatalogVersion, getFoobarEntry, getFoobarFocusedEntry } from "./foobar-catalog";
import { isHiResAlbum, isHiResTrack } from "./hi-res";
import { normalizeQuality, renderDimensions, type RenderQuality } from "./render-quality";
import { foobarArchiveWidth } from "./viewport-layout";
import { normalizeCaseSettings, type CaseSettings } from "./case-settings";
import { qualitySelectionWave, qualityWaveLimit, qualityIdleGain, qualityPulseLimit } from "./quality-motion";
import { idleWave } from "./motion";
import { labelMarkSvg } from "./brand";
import { paintArchiveLabel } from "./archive-label";
import { MUSIC_SHELF_VIEW } from "./music-display-layout";
import {
  createEditableCaseSprites,
  editableCaseSpriteKey,
} from "./case-sprites";

export type SpriteCell = {
  lane: number;
  row: number;
  lift: number;
  record: ArchiveRecord | undefined;
  selected: boolean;
  clear?: number;
};

type Point = [number, number];
type Quad = [Point, Point, Point, Point];
type Crop = [number, number, number, number];
const ARRAY_LABEL_CANVAS_WIDTH = 256;
const ARRAY_LABEL_CANVAS_HEIGHT = 154;
const ARRAY_LABEL_CACHE_LIMIT = 64;
const INSPECT_LABEL_CANVAS_WIDTH = 1024;
const INSPECT_LABEL_CANVAS_HEIGHT = 614;
const INSPECT_LABEL_CACHE_LIMIT = 2;

interface CaseFrameMeta {
  cover: Quad;
  body?: Quad;
  label: Quad;
  center: Point;
  axes?: ProjectionAxes;
  origin?: Point;
  crop?: Crop;
}

interface CaseMeta {
  skin: { name: string };
  axes: { x: Point; y: Point; z: Point };
  array: { cover: Quad; label: Quad; body?: Quad; origin: Point; center: Point };
  array_res: [number, number];
  array_ppu: number;
  hero: { cover: Quad; label: Quad; origin: Point; center: Point };
  hero_res: [number, number];
  inspect: CaseFrameMeta[];
  inspect_res: [number, number];
  inspect_ppu: number;
}

interface FloorMeta {
  floor?: string;
  surface?: string;
  ppu: number;
  floor_z: number;
  plate: { res: [number, number]; origin: Point };
  shade: { res: [number, number]; origin: Point };
  fade?: string;
  tint?: number;
  glow?: boolean;
}

interface RailMeta {
  res: [number, number];
  ppu: number;
  pitch: number;
  origin: Point;
  label?: Quad;
}

interface AssetSet {
  skin: string;
  meta: CaseMeta;
  arrayClear: CanvasImageSource;
  arrayFrost: CanvasImageSource;
  arrayPaper?: CanvasImageSource;
  inspectPaper?: CanvasImageSource[];
  inspect: CanvasImageSource[];
  rail: Record<"front" | "mid" | "back", HTMLImageElement>;
  railMeta: RailMeta;
  floor: FloorAssets | null;
}

interface FloorAssets {
  id: string;
  meta: FloorMeta;
  plate: HTMLImageElement;
  images: Record<string, HTMLImageElement>;
}

interface StyleSettings {
  caseStyle: string;
  shelf: boolean;
  direction: "left-to-right" | "right-to-left";
  floor: "plain" | "deck" | "real";
  arrayScale: number;
  inspectScale: number;
  topTitles: boolean;
  camera?: "player" | "foobar";
  design?: "rhine" | "archive";
  textScale?: number;
}

interface ProjectionAxes {
  x: Point;
  y: Point;
  z: Point;
}

interface CaseView {
  axes: ProjectionAxes;
  origin: Point;
  cover: Quad;
  body?: Quad;
  label: Quad;
  center: Point;
  resolution: [number, number];
  scaleFactor: number;
  rotation: number;
}

interface Palette {
  bg: string;
  accent: string;
  fg?: string;
  muted?: string;
}

interface RenderFrame {
  width: number;
  height: number;
  cells: SpriteCell[];
  focus: { lane: number; row: number };
  detail: number;
  selectedRecord: ArchiveRecord | undefined;
  selectedScreen: { x: number; y: number };
  selectedPixelHeight: number;
  time?: number;
  reduced?: boolean;
}

interface PlacedCell {
  cell: SpriteCell;
  recordIndex: number;
  x: number;
  y: number;
  z: number;
  depth: number;
  anchor: Point;
  cover: Point[];
}

interface HitTarget {
  recordIndex: number;
  quad: Point[];
  body?: Point[];
  selected?: boolean;
  entryKey?: string;
  trackId?: string;
}

interface SpringValue {
  value: number;
  target: number;
  velocity: number;
}

interface ShelfMotion {
  pos: SpringValue;
  scroll: SpringValue;
  cases: Map<number, { lift: SpringValue; clear: SpringValue; gap: SpringValue }>;
}

const CASE_META = import.meta.glob<CaseMeta>("./assets/style/case/*/case.json", {
  eager: true,
  import: "default",
});
const CASE_IMAGE_URLS = import.meta.glob<string>("./assets/style/case/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const FLOOR_META = import.meta.glob<FloorMeta>("./assets/style/floor/*/floor.json", {
  eager: true,
  import: "default",
});
const FLOOR_IMAGE_URLS = import.meta.glob<string>("./assets/style/floor/**/*.{png,jpg}", {
  eager: true,
  query: "?url",
  import: "default",
});
const RAIL_META_MODULE = import.meta.glob<RailMeta>("./assets/style/rail/rail.json", {
  eager: true,
  import: "default",
});
const RAIL_IMAGE_URLS = import.meta.glob<string>("./assets/style/rail/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const CASE_PREFIX = "./assets/style/case/";
const FLOOR_PREFIX = "./assets/style/floor/";
const RAIL_META_KEY = "./assets/style/rail/rail.json";
const RAIL_PREFIX = "./assets/style/rail/";
const TOP_STRIP = { x0: -1.8, x1: 1.1, y: 0.15, z: 3.5 };
const SPRITE_ALPHA = 0.54;
const ROW_PITCH = MUSIC_SHELF_VIEW.rowSpacing;
const LANE_PITCH = MUSIC_SHELF_VIEW.columnSpacing;
const SHELF_SLOTS = MUSIC_SHELF_VIEW.slots;
const INSPECT_LIFT = 2.2;
const SOURCE_CLOSE: [number, number, number] = [0.45, -0.62, 0.64];
const DEFAULT_CASES: Record<string, CaseMeta> = Object.fromEntries(
  Object.entries(CASE_META).map(([path, meta]) => [path.slice(CASE_PREFIX.length, -"/case.json".length), meta]),
);
const imagePromises = new Map<string, Promise<HTMLImageElement>>();
const tintedSprites = new Map<string, HTMLCanvasElement>();
const FALLBACK_COVER_LIMIT = 96;
const fallbackCovers = new Map<string, { image: HTMLImageElement; state: "loading" | "loaded" | "failed"; listeners: Set<() => void> }>();

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => t * t * (3 - 2 * t);

function springValue(value: number): SpringValue {
  return { value, target: value, velocity: 0 };
}

function stepSpring(value: SpringValue, seconds: number, frequency: number, reduced: boolean): boolean {
  if (reduced) {
    value.value = value.target;
    value.velocity = 0;
    return false;
  }
  if (seconds <= 0) return Math.abs(value.target - value.value) > 0.001 || Math.abs(value.velocity) > 0.002;
  const delta = value.value - value.target;
  const c = value.velocity + frequency * delta;
  const decay = Math.exp(-frequency * seconds);
  value.value = value.target + (delta + c * seconds) * decay;
  value.velocity = (value.velocity - frequency * c * seconds) * decay;
  if (Math.abs(value.target - value.value) < 0.001 && Math.abs(value.velocity) < 0.002) {
    value.value = value.target;
    value.velocity = 0;
  }
  return Math.abs(value.target - value.value) > 0.001 || Math.abs(value.velocity) > 0.002;
}

function fallbackCover(url: string, onReady: () => void): HTMLImageElement | undefined {
  let entry = fallbackCovers.get(url);
  if (entry) {
    fallbackCovers.delete(url);
    fallbackCovers.set(url, entry);
    if (entry.state === "loaded") return entry.image;
    if (entry.state === "loading") entry.listeners.add(onReady);
    return undefined;
  }

  const image = new Image();
  entry = { image, state: "loading", listeners: new Set([onReady]) };
  fallbackCovers.set(url, entry);
  image.onload = () => {
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) entry!.state = "failed";
    else entry!.state = "loaded";
    for (const listener of entry!.listeners) listener();
    entry!.listeners.clear();
  };
  image.onerror = () => {
    entry!.state = "failed";
    entry!.listeners.clear();
  };
  try {
    image.src = url;
  } catch {
    entry.state = "failed";
    entry.listeners.clear();
  }
  while (fallbackCovers.size > FALLBACK_COVER_LIMIT) fallbackCovers.delete(fallbackCovers.keys().next().value!);
  return undefined;
}

function assetKey(prefix: string, ...parts: string[]) {
  return `${prefix}${parts.join("/")}`;
}

function loadImage(path: string, urls: Record<string, string>): Promise<HTMLImageElement> {
  const url = urls[path];
  if (!url) return Promise.reject(new Error(`Missing asset: ${path}`));
  const existing = imagePromises.get(url);
  if (existing) return existing;

  let promise: Promise<HTMLImageElement>;
  promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load asset: ${path}`));
    image.src = url;
  }).catch((error: unknown) => {
    if (imagePromises.get(url) === promise) imagePromises.delete(url);
    throw error;
  });
  imagePromises.set(url, promise);
  return promise;
}

function imageSize(source: CanvasImageSource): [number, number] {
  const value = source as unknown as {
    width?: number | { baseVal?: { value: number } };
    height?: number | { baseVal?: { value: number } };
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  const dimension = (primary: number | undefined, fallback: number | { baseVal?: { value: number } } | undefined) => {
    if (primary && primary > 0) return primary;
    if (typeof fallback === "number" && fallback > 0) return fallback;
    if (typeof fallback === "object" && fallback?.baseVal?.value) return fallback.baseVal.value;
    return 1;
  };
  return [
    dimension(value.naturalWidth ?? value.videoWidth, value.width),
    dimension(value.naturalHeight ?? value.videoHeight, value.height),
  ];
}

function pointInPolygon(x: number, y: number, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function caseHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o:Point,a:Point,b:Point)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const half=(input:Point[])=>{const out:Point[]=[];for(const p of input){while(out.length>=2&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}return out;};
  const lower=half(sorted),upper=half([...sorted].reverse());
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function nearCasePolygon(x:number,y:number,polygon:Point[],padding:number) {
  if(pointInPolygon(x,y,polygon))return true;
  return polygon.some((a,i)=>{const b=polygon[(i+1)%polygon.length],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    const t=length?clamp(((x-a[0])*dx+(y-a[1])*dy)/length,0,1):0;
    return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<=padding;});
}
function mapQuad(quad: Quad, left: number, top: number, scale: number): Point[] {
  return quad.map(([x, y]): Point => [left + x * scale, top + y * scale]);
}

function containImageQuad(quad: Point[], imageAspect: number): Point[] {
  const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
  const insetX = aspect < 1 ? (1 - aspect) / 2 : 0;
  const insetY = aspect > 1 ? (1 - 1 / aspect) / 2 : 0;
  const point = (u: number, v: number): Point => [
    quad[0][0] + (quad[1][0] - quad[0][0]) * u + (quad[3][0] - quad[0][0]) * v,
    quad[0][1] + (quad[1][1] - quad[0][1]) * u + (quad[3][1] - quad[0][1]) * v,
  ];
  return [point(insetX, insetY), point(1 - insetX, insetY), point(1 - insetX, 1 - insetY), point(insetX, 1 - insetY)];
}

function mirrorQuad(quad: Point[], centerX: number, mirrored: boolean): Point[] {
  return mirrored ? quad.map(([x, y]): Point => [2 * centerX - x, y]) : quad;
}

function readableQuad(quad: Point[], mirrored: boolean): Point[] {
  return mirrored ? [quad[1], quad[0], quad[3], quad[2]] : quad;
}

function mapCasePoint(
  point: Point,
  anchor: Point,
  imageOrigin: Point,
  scale: number,
  mirrored: boolean,
  rotation: number,
): Point {
  const dx = (point[0] - imageOrigin[0]) * scale;
  const dy = (point[1] - imageOrigin[1]) * scale;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const rotatedX = cosine * dx - sine * dy;
  const rotatedY = sine * dx + cosine * dy;
  return [anchor[0] + (mirrored ? -rotatedX : rotatedX), anchor[1] + rotatedY];
}

function mapCaseQuad(
  quad: Quad,
  anchor: Point,
  imageOrigin: Point,
  scale: number,
  mirrored: boolean,
  rotation: number,
): Point[] {
  return quad.map((point) => mapCasePoint(point, anchor, imageOrigin, scale, mirrored, rotation));
}

function quadBounds(quad: Point[]): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(...quad.map(([x]) => x)),
    top: Math.min(...quad.map(([, y]) => y)),
    right: Math.max(...quad.map(([x]) => x)),
    bottom: Math.max(...quad.map(([, y]) => y)),
  };
}

function drawCaseImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  anchor: Point,
  imageOrigin: Point,
  scale: number,
  width: number,
  height: number,
  mirrored: boolean,
  rotation: number,
) {
  ctx.save();
  ctx.translate(anchor[0], anchor[1]);
  if (mirrored) ctx.scale(-1, 1);
  if (rotation) ctx.rotate(rotation);
  ctx.drawImage(image, -imageOrigin[0] * scale, -imageOrigin[1] * scale, width * scale, height * scale);
  ctx.restore();
}

function rotatePoint([x, y]: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine * x - sine * y, sine * x + cosine * y];
}

function rotateAxes(axes: ProjectionAxes, angle: number): ProjectionAxes {
  return {
    x: rotatePoint(axes.x, angle),
    y: rotatePoint(axes.y, angle),
    z: rotatePoint(axes.z, angle),
  };
}

function caseWorldEdge(meta: CaseMeta): number {
  const [topLeft, topRight, , bottomLeft] = meta.array.cover;
  const xPixels = Math.hypot(topRight[0] - topLeft[0], topRight[1] - topLeft[1]);
  const zPixels = Math.hypot(topLeft[0] - bottomLeft[0], topLeft[1] - bottomLeft[1]);
  const xAxisPixels = Math.hypot(meta.axes.x[0], meta.axes.x[1]);
  const zAxisPixels = Math.hypot(meta.axes.z[0], meta.axes.z[1]);
  return (xPixels / xAxisPixels + zPixels / zAxisPixels) / 2;
}

function inspectProjectionAxes(meta: CaseMeta, frame: CaseFrameMeta): ProjectionAxes {
  if (frame.axes) return frame.axes;
  const edge = caseWorldEdge(meta);
  const ppu = meta.inspect_ppu;
  const [topLeft, topRight, , bottomLeft] = frame.cover;
  const x: Point = [(topRight[0] - topLeft[0]) / edge, (topRight[1] - topLeft[1]) / edge];
  const z: Point = [(topLeft[0] - bottomLeft[0]) / edge, (topLeft[1] - bottomLeft[1]) / edge];
  const ux = x[0] / ppu;
  const vx = x[1] / ppu;
  const uz = z[0] / ppu;
  const vz = z[1] / ppu;
  const yMagnitude = Math.sqrt(Math.max(0, 1 - ux * ux - uz * uz));
  const uy = (meta.axes.y[0] >= 0 ? 1 : -1) * yMagnitude;
  const vy = yMagnitude > 1e-6 ? -(ux * vx + uz * vz) / uy : 0;
  return { x, y: [uy * ppu, vy * ppu], z };
}

function caseView(meta: CaseMeta): CaseView {
  return {
    axes: meta.axes,
    origin: meta.array.origin,
    cover: meta.array.cover,
    body: meta.array.body,
    label: meta.array.label,
    center: meta.array.center,
    resolution: meta.array_res,
    scaleFactor: 1,
    rotation: 0,
  };
}

function interpolateQuad(a: Quad, b: Quad, t: number): Quad {
  return a.map((p, i) => [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t)]) as Quad;
}

function triangleTransform(source: [Point, Point, Point], target: [Point, Point, Point]) {
  const [s0, s1, s2] = source;
  const [t0, t1, t2] = target;
  const den = (s0[0] - s1[0]) * (s0[1] - s2[1]) - (s0[0] - s2[0]) * (s0[1] - s1[1]);
  if (Math.abs(den) < 1e-8) return null;
  const a = ((t0[0] - t1[0]) * (s0[1] - s2[1]) - (t0[0] - t2[0]) * (s0[1] - s1[1])) / den;
  const c = ((s0[0] - s1[0]) * (t0[0] - t2[0]) - (s0[0] - s2[0]) * (t0[0] - t1[0])) / den;
  const b = ((t0[1] - t1[1]) * (s0[1] - s2[1]) - (t0[1] - t2[1]) * (s0[1] - s1[1])) / den;
  const d = ((s0[0] - s1[0]) * (t0[1] - t2[1]) - (s0[0] - s2[0]) * (t0[1] - t1[1])) / den;
  const e = t0[0] - a * s0[0] - c * s0[1];
  const f = t0[1] - b * s0[0] - d * s0[1];
  return [a, b, c, d, e, f] as const;
}

function drawImageQuad(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  quad: Point[],
  alpha = 1,
  mirrorSourceX = false,
) {
  if (quad.length !== 4) return;
  const [width, height] = imageSize(image);
  quad = containImageQuad(quad, width / height);
  const source: Quad = mirrorSourceX
    ? [[width, 0], [0, 0], [0, height], [width, height]]
    : [[0, 0], [width, 0], [width, height], [0, height]];
  const triangles: Array<[[Point, Point, Point], [Point, Point, Point]]> = [
    [[source[0], source[1], source[2]], [quad[0], quad[1], quad[2]]],
    [[source[0], source[2], source[3]], [quad[0], quad[2], quad[3]]],
  ];
  for (const [src, dst] of triangles) {
    const transform = triangleTransform(src, dst);
    if (!transform) continue;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.moveTo(dst[0][0], dst[0][1]);
    ctx.lineTo(dst[1][0], dst[1][1]);
    ctx.lineTo(dst[2][0], dst[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(...transform);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }
}

function drawImageAt(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  left: number,
  top: number,
  width: number,
  height: number,
  mirrorCenterX: number,
  mirrored: boolean,
) {
  ctx.save();
  if (mirrored) {
    ctx.translate(2 * mirrorCenterX, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, left, top, width, height);
  ctx.restore();
}

function drawTextQuad(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  text: string,
  fontSize: number,
  fill: string,
  bg?: string,
  domain: [number, number] = [100, 60],
) {
  if (quad.length !== 4) return;
  const [p0, p1, p2, p3] = quad;
  const [domainW, domainH] = domain;
  const a = (p1[0] - p0[0]) / domainW;
  const b = (p1[1] - p0[1]) / domainW;
  const c = (p3[0] - p0[0]) / domainH;
  const d = (p3[1] - p0[1]) / domainH;
  ctx.save();
  ctx.transform(a, b, c, d, p0[0], p0[1]);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, domainW, domainH);
  }
  ctx.fillStyle = fill;
  ctx.font = `600 ${fontSize}px "Archive Mono", monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const inset = Math.max(4, domainW * 0.08);
  ctx.fillText(text, inset, domainH * 0.56, domainW - inset * 1.5);
  ctx.restore();
}

function hexToRgba(color: string, alpha: number): string {
  const match = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return `rgba(12, 12, 12, ${alpha})`;
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  const value = Number.parseInt(hex, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function colorChannels(color: string): [number, number, number] {
  const match = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return [12, 12, 12];
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((channel) => channel + channel).join("");
  const value = Number.parseInt(hex, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixColor(a: string, b: string, amount: number): string {
  const left = colorChannels(a);
  const right = colorChannels(b);
  const t = clamp(amount, 0, 1);
  const channel = (index: number) => Math.round(left[index] + (right[index] - left[index]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

const END_ELLIPSIS_CACHE = new Map<string, string>();
function textWithEndEllipsis(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  const text = Array.from(value.replace(/[\r\n\t]+/g, " "));
  const normalized = text.join("");
  const key = `${ctx.font}\u0000${maxWidth}\u0000${normalized}`;
  const cached = END_ELLIPSIS_CACHE.get(key);
  if (cached !== undefined) return cached;
  const remember = (result: string) => {
    if (END_ELLIPSIS_CACHE.size >= 512) END_ELLIPSIS_CACHE.delete(END_ELLIPSIS_CACHE.keys().next().value!);
    END_ELLIPSIS_CACHE.set(key, result);
    return result;
  };
  if (ctx.measureText(normalized).width <= maxWidth) return remember(normalized);
  const ellipsis = "...";
  if (ctx.measureText(ellipsis).width > maxWidth) return remember("");
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid).join("")}${ellipsis}`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return remember(`${text.slice(0, low).join("").trimEnd()}${ellipsis}`);
}

function isCjk(value: string): boolean {
  return /[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(value);
}

function drawArchiveLabelQuad(
  ctx: CanvasRenderingContext2D,
  quad: Point[],
  label: CanvasImageSource,
): void {
  if (quad.length !== 4) return;
  const [p0, p1, , p3] = quad;
  const a = (p1[0] - p0[0]) / 100;
  const b = (p1[1] - p0[1]) / 100;
  const c = (p3[0] - p0[0]) / 60;
  const d = (p3[1] - p0[1]) / 60;
  if (![a, b, c, d, ...quad.flat()].every(Number.isFinite)) return;
  const projectedArea = Math.abs(quad.reduce((sum, point, index) => {
    const next = quad[(index + 1) % quad.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
  // A transformed hidden/near-zero label can still produce a finite affine
  // matrix. Skip subpixel plaques so they cannot leave an isolated white pixel.
  if (projectedArea < 1) return;
  ctx.save();
  ctx.transform(a, b, c, d, p0[0], p0[1]);
  ctx.drawImage(label, 0, 0, 100, 60);
  ctx.restore();
}

function makeTintedSprite(image: CanvasImageSource, bg: string, amount: number, key: string) {
  const level = Math.round(clamp(amount, 0, 0.8) * 10) / 10;
  if (level <= 0) return image;
  const cacheKey = `${key}|${bg}|${level}`;
  const cached = tintedSprites.get(cacheKey);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  const [width, height] = imageSize(image);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = hexToRgba(bg, level);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  tintedSprites.set(cacheKey, canvas);
  return canvas;
}

function quadPath(ctx: CanvasRenderingContext2D, quad: Point[]) {
  if (quad.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(quad[0][0], quad[0][1]);
  for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i][0], quad[i][1]);
  ctx.closePath();
}

function drawGoldEdge(ctx: CanvasRenderingContext2D, quad: Point[], scale: number) {
  if (quad.length !== 4) return;
  const [a, b] = quad;
  const gradient = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
  gradient.addColorStop(0, "#875a16");
  gradient.addColorStop(0.2, "#f4d374");
  gradient.addColorStop(0.48, "#fff1b6");
  gradient.addColorStop(0.72, "#c69631");
  gradient.addColorStop(1, "#70470e");
  ctx.save();
  ctx.lineWidth = Math.max(0.8, 1.6 * scale);
  ctx.strokeStyle = gradient;
  ctx.shadowColor = "rgba(248, 197, 83, .72)";
  ctx.shadowBlur = Math.max(1, 4 * scale);
  quadPath(ctx, quad);
  ctx.stroke();
  ctx.restore();
}

let ordinalSource: ArchiveRecord[] | undefined;
let albumOrdinals = new Map<string, number>();
function canonicalAlbumIndex(record: ArchiveRecord | undefined): number {
  if (!record) return -1;
  if (ordinalSource !== records) {
    ordinalSource = records;
    albumOrdinals = new Map(records.map((item, index) => [item.id, index]));
  }
  return albumOrdinals.get(record.album?.id ?? record.id) ?? -1;
}

function chooseFloorId(floor: StyleSettings["floor"], mode: "day" | "night") {
  if (floor === "plain") return null;
  const preferred = `${floor}-${mode === "day" ? "light" : "dark"}`;
  const fallback = `${floor}-${mode === "day" ? "dark" : "light"}`;
  const has = (id: string) => Object.prototype.hasOwnProperty.call(FLOOR_META, assetKey(FLOOR_PREFIX, id, "floor.json"));
  if (has(preferred)) return preferred;
  if (has(fallback)) return fallback;
  return null;
}

function getCaseMeta(skin: string) {
  return DEFAULT_CASES[skin];
}

function getMetaForFloor(id: string) {
  return FLOOR_META[assetKey(FLOOR_PREFIX, id, "floor.json")];
}

function getFloorImageKey(id: string, file: string) {
  return assetKey(FLOOR_PREFIX, id, file);
}

function getCaseImageKey(skin: string, file: string) {
  return assetKey(CASE_PREFIX, skin, file);
}

async function loadFloorAssets(id: string | null): Promise<FloorAssets | null> {
  if (!id) return null;
  const meta = getMetaForFloor(id);
  if (!meta) throw new Error(`Missing floor metadata: ${id}/floor.json`);
  const base = [
    "shade-front.png", "shade-front-far.png", "shade-mid.png", "shade-mid-far.png", "shade-back.png", "shade-back-far.png",
  ];
  if (meta.glow !== false) {
    base.push("glow-front.png", "glow-front-far.png", "glow-mid.png", "glow-mid-far.png", "glow-back.png", "glow-back-far.png");
  }
  const [plate, ...loaded] = await Promise.all([
    loadImage(getFloorImageKey(id, "plate.jpg"), FLOOR_IMAGE_URLS),
    ...base.map((file) => loadImage(getFloorImageKey(id, file), FLOOR_IMAGE_URLS)),
  ]);
  return { id, meta, plate, images: Object.fromEntries(base.map((file, index) => [file.replace(".png", ""), loaded[index]])) };
}

async function loadAssetSet(skin: string, floorId: string | null): Promise<AssetSet> {
  const meta = getCaseMeta(skin);
  if (!meta) throw new Error(`Unknown case style: ${skin}`);
  const railMeta = RAIL_META_MODULE[RAIL_META_KEY];
  if (!railMeta) throw new Error("Missing rail metadata: rail/rail.json");

  const realCasePrefix = floorId === "real-dark" ? "case/frost/" : "";
  const realRailPrefix = floorId === "real-dark" ? "rail/" : "";
  const floorCaseClear = realCasePrefix ? getFloorImageKey(floorId!, `${realCasePrefix}array-clear.png`) : "";
  const floorCaseFrost = realCasePrefix ? getFloorImageKey(floorId!, `${realCasePrefix}array-frost.png`) : "";
  const floorRail = (kind: string) => realRailPrefix ? getFloorImageKey(floorId!, `${realRailPrefix}rail-${kind}.png`) : "";
  const clearKey = floorCaseClear && FLOOR_IMAGE_URLS[floorCaseClear] ? floorCaseClear : getCaseImageKey(skin, "array-clear.png");
  const frostKey = floorCaseFrost && FLOOR_IMAGE_URLS[floorCaseFrost] ? floorCaseFrost : getCaseImageKey(skin, "array-frost.png");
  const railKey = (kind: "front" | "mid" | "back") => {
    const override = floorRail(kind);
    return override && FLOOR_IMAGE_URLS[override] ? override : assetKey(RAIL_PREFIX, `rail-${kind}.png`);
  };
  const railImage = (kind: "front" | "mid" | "back") => {
    const key = railKey(kind);
    return loadImage(key, key.startsWith(FLOOR_PREFIX) ? FLOOR_IMAGE_URLS : RAIL_IMAGE_URLS);
  };
  const [arrayClear, arrayFrost, ...rest] = await Promise.all([
    loadImage(clearKey, clearKey.startsWith(FLOOR_PREFIX) ? FLOOR_IMAGE_URLS : CASE_IMAGE_URLS),
    loadImage(frostKey, frostKey.startsWith(FLOOR_PREFIX) ? FLOOR_IMAGE_URLS : CASE_IMAGE_URLS),
    ...Array.from({ length: meta.inspect.length }, (_, i) => loadImage(getCaseImageKey(skin, `inspect-${String(i).padStart(2, "0")}.png`), CASE_IMAGE_URLS)),
    railImage("front"),
    railImage("mid"),
    railImage("back"),
    loadFloorAssets(floorId),
  ]);
  const inspect = rest.slice(0, meta.inspect.length) as HTMLImageElement[];
  const railImages = rest.slice(meta.inspect.length, meta.inspect.length + 3) as HTMLImageElement[];
  const floor = rest[meta.inspect.length + 3] as FloorAssets | null;
  return {
    skin,
    meta,
    arrayClear,
    arrayFrost,
    inspect,
    rail: { front: railImages[0], mid: railImages[1], back: railImages[2] },
    railMeta,
    floor,
  };
}

async function loadEditableAssetSet(
  settings: CaseSettings,
  quality: RenderQuality,
  floorId: string | null,
  theme: "day" | "night",
  paletteKey: string,
): Promise<AssetSet> {
  // Rails and floor remain the existing 2D assets. The case shell and its
  // cover/label projections come from the editable Three.js model.
  const base = await loadAssetSet("white", floorId);
  const sprites = await createEditableCaseSprites(settings, quality, base.meta, theme, paletteKey);
  const meta: CaseMeta = {
    ...base.meta,
    array: { ...base.meta.array, ...sprites.array },
    inspect: sprites.inspectFrames.map((frame) => ({
      ...frame,
      crop: [0, 0, base.meta.inspect_res[0], base.meta.inspect_res[1]],
    })),
    inspect_ppu: sprites.inspect_ppu,
  };
  return {
    ...base,
    skin: `editable-${settings.structure}`,
    meta,
    arrayClear: sprites.arrayClear,
    arrayFrost: sprites.arrayFrost,
    inspect: sprites.inspect,
    arrayPaper: sprites.arrayPaper,
    inspectPaper: sprites.inspectPaper,
  };
}

export class ArchiveCaseRenderer {
  private active = true;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly labelMark: HTMLImageElement;
  private readonly arrayLabelCanvases = new Map<number, HTMLCanvasElement>();
  private readonly inspectLabelCanvases = new Map<number, HTMLCanvasElement>();
  private readonly container: HTMLElement;
  private readonly readCover: (record: ArchiveRecord) => CanvasImageSource | undefined;
  private readonly onError: (message: string) => void;
  private style: StyleSettings = {
    caseStyle: "white",
    shelf: true,
    direction: "left-to-right",
    floor: "plain",
    arrayScale: 1,
    inspectScale: 1,
    topTitles: true,
    camera: "foobar",
    design: "archive",
    textScale: 1,
  };
  private palette: Palette = { bg: "#0b0b0b", accent: "#ff7a01" };
  private assets: AssetSet | null = null;
  private view: CaseView | null = null;
  private lastFrame: RenderFrame | null = null;
  private generation = 0;
  private assetSignature = "";
  private failedSignature = "";
  private status: "loading" | "error" | "" = "";
  private statusMessage = "";
  private hitTargets: HitTarget[] = [];
  private archiveWidth = 0;
  private shelfMotion = new Map<number, ShelfMotion>();
  private shelfSelections = new Map<number, number>();
  private layoutRecords: ArchiveRecord[] | undefined;
  private catalogVersion = -1;
  private lastRenderTime: number | undefined;
  private pixelRatio = 1;
  private quality = normalizeQuality(undefined);
  private caseSettings: CaseSettings = normalizeCaseSettings(undefined, "archive");
  private caseUpdateTimer: ReturnType<typeof setTimeout> | undefined;
  private caseMode: "day" | "night" = "night";
  private caseWaveKey = "";
  private caseWaveTime = 0;
  private caseWaves: Array<{ shelf: number; slot: number; time: number }> = [];
  private readonly onFallbackCoverReady = () => {
    if (this.lastFrame && !this.canvas.hidden) this.render(this.lastFrame);
  };

  constructor(
    container: HTMLElement,
    readCover: (record: ArchiveRecord) => CanvasImageSource | undefined,
    onError: (message: string) => void,
  ) {
    this.container = container;
    this.readCover = readCover;
    this.onError = onError;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "2",
    });
    this.canvas.hidden = true;
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      onError("Canvas 2D is unavailable for the archive sprite layer.");
      throw new Error("Canvas 2D is unavailable for the archive sprite layer.");
    }
    this.ctx = ctx;
    this.labelMark = new Image();
    this.labelMark.decoding = "async";
    this.labelMark.onload = () => this.refreshLabelCanvases();
    this.labelMark.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelMarkSvg)}`;
    if (document.fonts) void Promise.allSettled([
      document.fonts.load("bold 81px MiSans"),
      document.fonts.load("32px MiSans"),
    ]).then(() => this.refreshLabelCanvases());
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      if (this.caseUpdateTimer) clearTimeout(this.caseUpdateTimer);
      this.caseUpdateTimer = undefined;
      this.generation++;
      this.canvas.hidden = true;
      this.hitTargets = [];
    }
  }

  setQuality(quality: RenderQuality): void {
    const previousQuality = this.quality;
    const resized = quality.scale !== this.quality.scale || quality.pixelRatio !== this.quality.pixelRatio;
    this.quality = normalizeQuality(quality);
    const spriteQualityChanged = JSON.stringify(previousQuality) !== JSON.stringify(this.quality);
    if (spriteQualityChanged && this.caseSettings?.enabled) {
      this.failedSignature = "";
      this.setStyle(this.style, this.caseMode, this.palette);
      return;
    }
    if (resized && this.lastFrame && !this.canvas.hidden) this.render(this.lastFrame);
  }

  setCaseSettings(settings: CaseSettings): void {
    settings = normalizeCaseSettings(settings, "archive");
    if (JSON.stringify(this.caseSettings) === JSON.stringify(settings)) return;
    this.caseSettings = settings;
    this.failedSignature = "";
    // A superseded capture may still have the same signature after a quick
    // A → B → A edit. The replacement must subscribe with the new generation.
    this.assetSignature = "";
    if (this.caseUpdateTimer) clearTimeout(this.caseUpdateTimer);
    this.generation++;
    if (!settings.enabled) { this.setStyle(this.style, this.caseMode, this.palette); return; }
    // Coalesce continuous slider input; never create a WebGL capture per input event.
    this.caseUpdateTimer = setTimeout(() => {
      this.caseUpdateTimer = undefined;
      this.setStyle(this.style, this.caseMode, this.palette);
    }, 120);
  }

  setStyle(
    style: StyleSettings,
    mode: "day" | "night",
    palette: Palette,
  ): void {
    this.caseMode = mode;
    this.style = {
      ...style,
      arrayScale: Math.max(0.1, style.arrayScale),
      inspectScale: Math.max(0.1, style.inspectScale),
      camera: "foobar",
      design: style.design ?? "archive",
      textScale: style.textScale ?? 1,
    };
    const nextPalette = { ...palette };
    if (nextPalette.bg !== this.palette.bg) tintedSprites.clear();
    this.palette = nextPalette;
    if (!this.active || style.design === "rhine" || (style.caseStyle === "rhine" && !this.caseSettings?.enabled)) {
      if (this.caseUpdateTimer) clearTimeout(this.caseUpdateTimer);
      this.caseUpdateTimer = undefined;
      this.generation++;
      this.assets = null;
      this.view = null;
      imagePromises.clear();
      tintedSprites.clear();
      fallbackCovers.clear();
      this.assetSignature = "rhine";
      this.failedSignature = "";
      this.status = "";
      this.statusMessage = "";
      this.canvas.hidden = true;
      this.hitTargets = [];
      this.shelfMotion.clear();
      this.shelfSelections.clear();
      this.caseWaveKey = "";
      this.caseWaves = [];
      this.lastRenderTime = undefined;
      this.clearCanvas();
      return;
    }

    const floorId = chooseFloorId(style.floor, mode);
    const effectiveSkin = style.floor === "real" ? "frost" : style.caseStyle;
    const editable = this.caseSettings?.enabled === true;
    const paletteKey = JSON.stringify(nextPalette);
    const editableKey = editable ? editableCaseSpriteKey(this.caseSettings!, this.quality, mode, paletteKey) : "";
    const signature = editable
      ? `editable|${this.caseSettings!.structure}|${editableKey}|${floorId ?? "plain"}|foobar`
      : `${effectiveSkin}|${floorId ?? "plain"}|foobar`;
    if (signature === this.failedSignature) {
      this.canvas.hidden = false;
      this.renderStatus();
      return;
    }
    if (signature !== this.assetSignature) {
      imagePromises.clear();
      tintedSprites.clear();
    }
    if (style.floor !== "plain" && !floorId) {
      this.generation++;
      this.assets = null;
      this.assetSignature = signature;
      this.failedSignature = signature;
      this.status = "error";
      this.statusMessage = "Style resources unavailable";
      this.canvas.hidden = false;
      this.renderStatus();
      this.onError(`Missing floor resources for ${style.floor} (${mode}).`);
      return;
    }
    if (signature === this.assetSignature && this.assets) {
      this.status = "";
      this.statusMessage = "";
      this.canvas.hidden = false;
      if (this.lastFrame) this.render(this.lastFrame);
      return;
    }
    const generation = ++this.generation;
    this.assets = null;
    this.assetSignature = signature;
    this.failedSignature = "";
    this.status = "loading";
    this.statusMessage = "Loading case sprites…";
    this.canvas.hidden = false;
    this.renderStatus();
    const assetsPromise = editable
      ? loadEditableAssetSet(this.caseSettings!, this.quality, floorId, mode, paletteKey)
      : loadAssetSet(effectiveSkin, floorId);
    void assetsPromise.then((assets) => {
      if (generation !== this.generation) return;
      this.assets = assets;
      this.view = caseView(assets.meta);
      this.status = "";
      this.statusMessage = "";
      this.canvas.hidden = false;
      if (this.lastFrame) this.render(this.lastFrame);
      else this.renderStatus();
    }).catch((error: unknown) => {
      if (generation !== this.generation) return;
      this.assets = null;
      this.view = null;
      this.failedSignature = signature;
      this.status = "error";
      this.statusMessage = "Style resources unavailable";
      this.canvas.hidden = false;
      this.hitTargets = [];
      this.renderStatus();
      this.onError(error instanceof Error ? error.message : String(error));
    });
  }

  render(frame: RenderFrame): void {
    this.lastFrame = frame;
    if (this.canvas.hidden || frame.width <= 0 || frame.height <= 0) return;
    const dimensions = renderDimensions(this.quality, frame.width, frame.height,
      this.container.getBoundingClientRect().width / frame.width,
      window.devicePixelRatio || 1, 8192);
    const dpr = dimensions.ratio;
    const pixelWidth = dimensions.width;
    const pixelHeight = dimensions.height;
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight || this.pixelRatio !== dpr) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.pixelRatio = dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.ctx.clearRect(0, 0, frame.width, frame.height);
    this.ctx.fillStyle = this.palette.bg;
    this.ctx.fillRect(0, 0, frame.width, frame.height);
    this.hitTargets = [];
    if (!this.assets) {
      this.drawStatusText(frame.width, frame.height);
      return;
    }

    if (this.layoutRecords !== records || this.catalogVersion !== getFoobarCatalogVersion()) {
      this.layoutRecords = records;
      this.catalogVersion = getFoobarCatalogVersion();
      this.shelfMotion.clear();
      this.shelfSelections.clear();
    }

    const { meta } = this.assets;
    const view = this.view ?? caseView(meta);
    this.view = view;
    const arrayWidth = foobarArchiveWidth(this.container, frame.width, frame.detail, this.archiveWidth);
    this.archiveWidth = arrayWidth;
    const zoom = clamp(Math.min(arrayWidth / 936, frame.height / 731), 1, 1.6);
    const scale = SPRITE_ALPHA * zoom * this.style.arrayScale;
    const worldScale = scale * view.scaleFactor;
    const origin = { x: Math.round(arrayWidth * MUSIC_SHELF_VIEW.originX), y: frame.height - MUSIC_SHELF_VIEW.bottomInset };
    const shelves = getFoobarShelves();
    let selectedIndex = frame.selectedRecord ? records.indexOf(frame.selectedRecord) : -1;
    if (selectedIndex < 0 && frame.selectedRecord) selectedIndex = records.findIndex((record) => record.id === frame.selectedRecord!.id);
    const canonicalSelectedIndex=selectedIndex;
    const selectedLocation = selectedIndex >= 0 ? getFoobarLocation(selectedIndex) : null;
    selectedIndex=getFoobarFocusedEntry(canonicalSelectedIndex)?.index??-1;
    const focusShelf = selectedLocation?.shelf ?? 0;
    const focusedSlot = selectedLocation?.slot ?? 0;
    if (selectedLocation) this.shelfSelections.set(focusShelf, focusedSlot);

    const time = Number.isFinite(frame.time) ? frame.time! : performance.now() / 1000;
    const seconds = this.lastRenderTime === undefined ? 1 / 60 : clamp(time - this.lastRenderTime, 0, 0.05);
    this.lastRenderTime = time;
    const reduced = frame.reduced === true;
    const waveKey = `${focusShelf}:${focusedSlot}`;
    if (waveKey !== this.caseWaveKey) {
      if (this.caseWaveKey && this.caseSettings?.enabled && !reduced && qualityPulseLimit(this.quality.wave))
        this.caseWaves.push({ shelf: focusShelf, slot: focusedSlot, time });
      this.caseWaveKey = waveKey;
      this.caseWaveTime = time;
    }
    const pulseCount = qualityPulseLimit(this.quality.wave);
    this.caseWaves = pulseCount ? this.caseWaves.filter(pulse => time - pulse.time < 3.2).slice(-pulseCount) : [];
    const renderFrame: RenderFrame = { ...frame, cells: [], focus: { lane: focusShelf, row: focusedSlot } };

    let slotsInView = 0;
    while (slotsInView < 400) {
      const ox = origin.x + slotsInView * view.axes.y[0] * worldScale - view.origin[0] * worldScale;
      const oy = origin.y + slotsInView * view.axes.y[1] * worldScale - view.origin[1] * worldScale;
      if (ox + view.resolution[0] * worldScale * .7 > arrayWidth || oy < 56 - view.resolution[1] * worldScale * .05) break;
      slotsInView++;
    }
    slotsInView = Math.max(6, slotsInView);
    const firstShelf = Math.max(0, focusShelf - 1);
    const lastShelf = Math.min(shelves.length - 1, focusShelf + 4);
    for (const shelfIndex of this.shelfMotion.keys()) {
      if (shelfIndex < firstShelf || shelfIndex > lastShelf) this.shelfMotion.delete(shelfIndex);
    }

    const shelfStates = new Map<number, ShelfMotion>();
    const shelfPositions = new Map<number, number>();
    const shelfScrolls = new Map<number, number>();
    for (let shelfIndex = firstShelf; shelfIndex <= lastShelf; shelfIndex++) {
      const rememberedSlot = shelfIndex === focusShelf
        ? focusedSlot
        : this.shelfSelections.get(shelfIndex) ?? 0;
      const targetScroll = clamp(rememberedSlot - 4, 0, Math.max(0, SHELF_SLOTS - slotsInView));
      let motion = this.shelfMotion.get(shelfIndex);
      if (!motion) {
        motion = {
          pos: springValue(shelfIndex - focusShelf),
          scroll: springValue(targetScroll),
          cases: new Map(),
        };
        this.shelfMotion.set(shelfIndex, motion);
      }
      motion.pos.target = shelfIndex - focusShelf;
      motion.scroll.target = targetScroll;
      stepSpring(motion.pos, seconds, 9, reduced);
      stepSpring(motion.scroll, seconds, 9, reduced);
      shelfStates.set(shelfIndex, motion);
      shelfPositions.set(shelfIndex, motion.pos.value);
      shelfScrolls.set(shelfIndex, motion.scroll.value);
    }

    const visibleShelves = [...shelfStates.keys()]
      .filter((shelfIndex) => {
        const position = shelfPositions.get(shelfIndex) ?? shelfIndex - focusShelf;
        return position > -1 && position < 4;
      })
      .sort((left, right) => (shelfPositions.get(right) ?? 0) - (shelfPositions.get(left) ?? 0));
    const placed: PlacedCell[] = [];
    for (const shelfIndex of visibleShelves) {
      const shelf = shelves[shelfIndex];
      if (!shelf) continue;
      const motion = shelfStates.get(shelfIndex)!;
      const active = selectedLocation !== null && shelfIndex === focusShelf;
      const rememberedSlot = active ? focusedSlot : this.shelfSelections.get(shelfIndex) ?? 0;
      const x = -(shelfPositions.get(shelfIndex) ?? shelfIndex - focusShelf) * LANE_PITCH;
      const scroll = shelfScrolls.get(shelfIndex) ?? 0;
      for (let slot = 0; slot < shelf.records.length; slot++) {
        const recordIndex = shelf.records[slot];
        if (recordIndex === undefined) continue;
        const record = getFoobarEntry(recordIndex)?.record;
        if (!record) continue;
        const distance = slot - rememberedSlot;
        const bell = Math.exp(-distance * distance / 4.5) - 0.32 * Math.exp(-distance * distance / 18);
        const selected = recordIndex === selectedIndex;
        const liftTarget = (active ? 1.1 : 0.65) * bell + (selected ? 1.35 : 0);
        const clearTarget = selected ? 1 : 0;
        const gapTarget = active ? (slot > rememberedSlot ? 0.55 : slot < rememberedSlot ? -0.25 : 0) : 0;
        let caseMotion = motion.cases.get(slot);
        if (!caseMotion) {
          caseMotion = { lift: springValue(liftTarget), clear: springValue(clearTarget), gap: springValue(gapTarget) };
          motion.cases.set(slot, caseMotion);
        }
        caseMotion.lift.target = liftTarget;
        caseMotion.clear.target = clearTarget;
        caseMotion.gap.target = gapTarget;
        stepSpring(caseMotion.lift, seconds, 13, reduced);
        stepSpring(caseMotion.clear, seconds, 8, reduced);
        stepSpring(caseMotion.gap, seconds, 11, reduced);
        let wave = 0;
        if (this.caseSettings?.enabled && !reduced) {
          for (const pulse of this.caseWaves) {
            const distance = Math.hypot(slot - pulse.slot, (shelfIndex - pulse.shelf) * 2.2);
            wave += qualitySelectionWave(this.quality.wave, distance, time - pulse.time) * Math.min(1, distance / 1.2);
          }
          const limit = qualityWaveLimit(this.quality.wave);
          wave = clamp(wave, -limit, limit);
          if (time - this.caseWaveTime > 2.5) wave += idleWave(slot, shelfIndex, time) * qualityIdleGain(this.quality.wave) * Math.min(1, (time - this.caseWaveTime - 2.5) / 1.2);
          wave *= 1 - clamp(frame.detail, 0, 1);
        }
        const cell: SpriteCell = {
          lane: shelfIndex,
          row: slot,
          lift: caseMotion.lift.value + wave,
          clear: caseMotion.clear.value,
          record,
          selected,
        };
        const y = (slot - scroll) * ROW_PITCH + caseMotion.gap.value;
        const z = caseMotion.lift.value + wave;
        const projected = this.project(origin, meta, x, y, z, worldScale, view.axes);
        const cover = mapCaseQuad(view.cover, [projected.x, projected.y], view.origin, worldScale, false, view.rotation);
        placed.push({
          cell,
          recordIndex,
          x,
          y,
          z,
          depth: SOURCE_CLOSE[1] * y + SOURCE_CLOSE[2] * z * 0.2,
          anchor: [projected.x, projected.y],
          cover,
        });
      }
    }

    const shelfScroll = (lane: number) => shelfScrolls.get(lane) ?? 0;
    const shelfPosition = (lane: number) => shelfPositions.get(lane) ?? lane - focusShelf;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(0, 0, arrayWidth, frame.height);
    this.ctx.clip();
    if (this.assets.floor) this.drawFloor(origin, scale, placed, shelfScroll, shelfPosition);
    for (const shelfIndex of visibleShelves) {
      const x = -shelfPosition(shelfIndex) * LANE_PITCH;
      const scroll = shelfScroll(shelfIndex);
      const items: Array<{ depth: number; cell?: PlacedCell; rail?: "front" | "mid" | "back"; x: number; y: number; z: number; lane: number }> = [];
      for (const item of placed) {
        if (item.cell.lane === shelfIndex) items.push({ depth: item.depth, cell: item, x: item.x, y: item.y, z: item.z, lane: shelfIndex });
      }
      if (this.style.shelf) {
        for (let slot = -1; slot <= SHELF_SLOTS; slot++) {
          const y = (slot - scroll) * ROW_PITCH;
          const rail: "front" | "mid" | "back" = slot < 0 ? "front" : slot >= SHELF_SLOTS ? "back" : "mid";
          items.push({ depth: SOURCE_CLOSE[1] * (y + 0.4), rail, x, y, z: 0, lane: shelfIndex });
        }
      }
      items.sort((left, right) => left.depth - right.depth);
      for (const item of items) {
        const projected = this.project(origin, meta, item.x, item.y, item.z, worldScale, view.axes);
        if (item.rail) {
          const railScale = scale * meta.array_ppu / this.assets.railMeta.ppu;
          this.drawRail(projected, railScale, item.rail, frame.width, frame.height, item.lane, shelfPosition(item.lane));
        } else if (item.cell) this.drawArrayCell(renderFrame, item.cell, origin, scale, item.depth, view);
      }
    }
    this.ctx.restore();

    const selectedCell = placed.find((item) => item.recordIndex === selectedIndex);
    if (frame.detail > 0 && selectedCell) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(0, 0, arrayWidth, frame.height);
      this.ctx.clip();
      this.drawInspection(renderFrame, selectedCell, origin, scale, view, arrayWidth);
      this.ctx.restore();
    }
  }

  hitTest(x: number, y: number): { lane: number; row: number; foobarEntryKey?:string; foobarTrackId?:string } | null {
    if (x < 0 || x > this.archiveWidth) return null;
    for (let i = this.hitTargets.length - 1; i >= 0; i--) {
      const target = this.hitTargets[i];
      if (pointInPolygon(x, y, target.body ?? target.quad)) {
        const location = fileLocation(target.recordIndex);
        return { lane: location.lane, row: location.row, foobarEntryKey:target.entryKey, foobarTrackId:target.trackId };
      }
    }
    const selected = this.hitTargets.find(target => target.selected);
    if (selected && nearCasePolygon(x, y, selected.body ?? selected.quad, 16)) {
      const location = fileLocation(selected.recordIndex);
      return { lane: location.lane, row: location.row, foobarEntryKey:selected.entryKey, foobarTrackId:selected.trackId };
    }
    return null;
  }

  private clearCanvas() {
    const ctx = this.canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private coverFor(record: ArchiveRecord): CanvasImageSource | undefined {
    const cover = this.readCover(record);
    if (cover) return cover;
    const url = record.album?.coverUrl;
    return url ? fallbackCover(url, this.onFallbackCoverReady) : undefined;
  }

  private drawStatusText(width: number, height: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = this.status === "error" ? this.palette.accent : this.palette.muted ?? this.palette.fg ?? this.palette.accent;
    ctx.font = '500 13px "Archive Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.statusMessage || "Loading case sprites…", width / 2, height / 2, Math.max(120, width - 32));
    ctx.restore();
  }

  private renderStatus() {
    const rect = this.container.getBoundingClientRect();
    const frame = this.lastFrame ?? {
      width: rect.width,
      height: rect.height,
      cells: [],
      focus: { lane: 0, row: 0 },
      detail: 0,
      selectedRecord: undefined,
      selectedScreen: { x: 0, y: 0 },
      selectedPixelHeight: 0,
    } satisfies RenderFrame;
    if (frame.width > 0 && frame.height > 0) this.render(frame);
  }

  private get directionSign() {
    return 1;
  }

  private project(
    origin: { x: number; y: number },
    meta: CaseMeta,
    x: number,
    y: number,
    z: number,
    scale: number,
    axes: ProjectionAxes = meta.axes,
  ) {
    const projectedX = x * axes.x[0] + y * axes.y[0] + z * axes.z[0];
    return {
      x: origin.x + projectedX * scale * this.directionSign,
      y: origin.y + (x * axes.x[1] + y * axes.y[1] + z * axes.z[1]) * scale,
    };
  }

  private labelCanvas(index: number): HTMLCanvasElement {
    return this.cachedLabelCanvas(index, false);
  }

  private inspectLabelCanvas(index: number): HTMLCanvasElement {
    return this.cachedLabelCanvas(index, true);
  }

  private cachedLabelCanvas(index: number, inspect: boolean): HTMLCanvasElement {
    const cache = inspect ? this.inspectLabelCanvases : this.arrayLabelCanvases;
    const width = inspect ? INSPECT_LABEL_CANVAS_WIDTH : ARRAY_LABEL_CANVAS_WIDTH;
    const height = inspect ? INSPECT_LABEL_CANVAS_HEIGHT : ARRAY_LABEL_CANVAS_HEIGHT;
    const limit = inspect ? INSPECT_LABEL_CACHE_LIMIT : ARRAY_LABEL_CACHE_LIMIT;
    const cached = cache.get(index);
    if (cached) {
      cache.delete(index);
      cache.set(index, cached);
      return cached;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    paintArchiveLabel(canvas, index, this.labelMark, { fit: "contain" });
    cache.set(index, canvas);
    while (cache.size > limit) cache.delete(cache.keys().next().value!);
    return canvas;
  }

  private refreshLabelCanvases(): void {
    this.arrayLabelCanvases.clear();
    this.inspectLabelCanvases.clear();
    if (this.canvas.isConnected && this.lastFrame && !this.canvas.hidden) this.render(this.lastFrame);
  }

  private laneRanges(placed: PlacedCell[], fullShelves = false) {
    const ranges = new Map<number, { min: number; max: number }>();
    for (const { cell } of placed) {
      const range = ranges.get(cell.lane);
      if (!range) ranges.set(cell.lane, fullShelves ? { min: 0, max: SHELF_SLOTS - 1 } : { min: cell.row, max: cell.row });
      else if (!fullShelves) { range.min = Math.min(range.min, cell.row); range.max = Math.max(range.max, cell.row); }
    }
    return [...ranges].map(([lane, range]) => ({ lane, ...range }));
  }

  private drawArrayCell(frame: RenderFrame, placed: PlacedCell, origin: { x: number; y: number }, scale: number, _depth: number, view: CaseView) {
    const { cell, anchor, cover } = placed;
    const record = cell.record;
    const catalogEntry=getFoobarEntry(placed.recordIndex);
    if (!record) return;
    if (cell.selected && frame.detail > 0) return;
    const ctx = this.ctx;
    const mirrored = this.directionSign < 0;
    const spriteScale = scale * view.scaleFactor;
    const imageQuad = mapCaseQuad(
      [[0, 0], [view.resolution[0], 0], [view.resolution[0], view.resolution[1]], [0, view.resolution[1]]],
      anchor, view.origin, spriteScale, mirrored, view.rotation,
    );
    const bounds = quadBounds(imageQuad);
    if (bounds.left > frame.width || bounds.right < 0 || bounds.top > frame.height || bounds.bottom < 0) return;
    const laneDelta = -placed.x / LANE_PITCH;
    const far = Math.max(0, laneDelta);
    const alpha = Math.round(255 * clamp(1 + laneDelta, 0, 1) * clamp((4 - laneDelta) / 0.8, 0, 1)) / 255;
    if (alpha <= 0) return;
    const clear = clamp(cell.clear ?? (cell.selected ? 1 : 0), 0, 1);
    const fade = this.assets!.floor?.meta.fade ?? this.palette.bg;
    const tint = Math.round(clamp(0.38 * clamp(far, 0, 1) + 0.14 * far, 0, 0.8) * (this.assets!.floor?.meta.tint ?? 1) * 10) / 10;
    const coverImage = this.coverFor(record);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hexToRgba(this.palette.bg, 0.92);
    quadPath(ctx, cover);
    ctx.fill();
    if (coverImage) {
      // Original compositing starts with the blurred artwork beneath every
      // frosted case, then fades in the sharp print only for the clear case.
      ctx.save();
      quadPath(ctx, cover);
      ctx.clip();
      ctx.filter = `blur(${Math.max(1, 4 * spriteScale)}px)`;
      drawImageQuad(ctx, coverImage, cover, 1, mirrored);
      ctx.restore();
    }
    if (coverImage && clear > 0.01 && tint === 0) {
      drawImageQuad(ctx, coverImage, cover, clear, mirrored);
    }
    if (coverImage && this.assets!.arrayPaper) {
      ctx.save();
      quadPath(ctx, cover); ctx.clip();
      ctx.globalCompositeOperation = "multiply";
      drawCaseImage(ctx, this.assets!.arrayPaper, anchor, view.origin, spriteScale, view.resolution[0], view.resolution[1], mirrored, view.rotation);
      ctx.restore();
    }
    if (tint > 0) {
      ctx.save();
      ctx.globalAlpha *= tint;
      ctx.fillStyle = fade;
      quadPath(ctx, cover);
      ctx.fill();
      ctx.restore();
      const sprite = makeTintedSprite(
        this.assets!.arrayFrost,
        fade,
        tint,
        `${this.assets!.skin}|foobar`,
      );
      drawCaseImage(ctx, sprite, anchor, view.origin, spriteScale, view.resolution[0], view.resolution[1], mirrored, view.rotation);
    } else {
      if (clear < 0.99) {
        ctx.save();
        ctx.globalAlpha *= 1 - clear;
        drawCaseImage(ctx, this.assets!.arrayFrost, anchor, view.origin, spriteScale, view.resolution[0], view.resolution[1], mirrored, view.rotation);
        ctx.restore();
      }
      if (clear > 0.01) {
        ctx.save();
        ctx.globalAlpha *= clear;
        drawCaseImage(ctx, this.assets!.arrayClear, anchor, view.origin, spriteScale, view.resolution[0], view.resolution[1], mirrored, view.rotation);
        ctx.restore();
      }
    }

    const albumIndex = catalogEntry?.recordIndex ?? canonicalAlbumIndex(record);
    if (albumIndex >= 0 && tint === 0 && (cell.selected || Math.abs(laneDelta) < 0.5)) {
      const label = mapCaseQuad(view.label, anchor, view.origin, spriteScale, mirrored, view.rotation);
      drawArchiveLabelQuad(ctx, readableQuad(label, mirrored), this.labelCanvas(albumIndex));
    }
    if (cell.selected && clear > 0.6 && frame.detail === 0) {
      this.drawSelectedCorners(cover, spriteScale);
    }
    if (this.style.topTitles && tint < 0.5) this.drawTopTitle(record, origin, placed.x, placed.y, placed.z, spriteScale, tint, view);
    if (catalogEntry?.track?isHiResTrack(catalogEntry.track):record.album&&isHiResAlbum(record.album)) this.drawGoldEdge(cover, spriteScale);
    ctx.restore();

    const spine = mapCaseQuad(view.label, anchor, view.origin, spriteScale, mirrored, view.rotation);
    const entry=getFoobarEntry(placed.recordIndex);
    this.hitTargets.push({ recordIndex: entry?.recordIndex??placed.recordIndex, entryKey:entry?.key,trackId:entry?.track?.id,quad: cover,
      body: view.body ? mapCaseQuad(view.body, anchor, view.origin, spriteScale, mirrored, view.rotation) : caseHull([...cover, ...spine]), selected: cell.selected });
  }

  private drawSelectedCorners(quad: Point[], scale: number) {
    const size = Math.max(3, scale * 8);
    this.ctx.fillStyle = this.palette.accent;
    for (const [x, y] of quad) this.ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }

  private drawTopTitle(record: ArchiveRecord, origin: { x: number; y: number }, x: number, y: number, z: number, scale: number, tint: number, view: CaseView) {
    const meta = this.assets!.meta;
    const at = (px: number, py: number, pz: number): Point => {
      const p = this.project(origin, meta, x + px, y + py, z + pz, scale, view.axes);
      return [p.x, p.y];
    };
    const { x0, x1, y: topY, z: topZ } = TOP_STRIP;
    const mirrored = this.directionSign < 0;
    const textStart = mirrored ? x1 : x0;
    const textStep = mirrored ? -1 : 1;
    const o = at(textStart, topY, topZ);
    const u = at(textStart + textStep, topY, topZ);
    const v = at(textStart, topY - 1, topZ);
    this.drawTopTitleFace(record, o, u, v, tint);
  }

  private drawTopTitleFace(record: ArchiveRecord, o: Point, u: Point, v: Point, tint: number) {
    if (Math.hypot(v[0] - o[0], v[1] - o[1]) * TOP_STRIP.y * 2 < 5) return;
    const a = (u[0] - o[0]) / 100;
    const b = (u[1] - o[1]) / 100;
    const c = (v[0] - o[0]) / 100;
    const d = (v[1] - o[1]) / 100;
    const ctx = this.ctx;
    const width = (TOP_STRIP.x1 - TOP_STRIP.x0) * 100;
    const height = TOP_STRIP.y * 200;
    const fade = this.assets!.floor?.meta.fade ?? this.palette.bg;
    ctx.save();
    ctx.transform(a, b, c, d, o[0], o[1]);
    ctx.fillStyle = mixColor("#e9e6dd", fade, tint);
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = mixColor(this.palette.accent, fade, tint);
    ctx.fillRect(0, 0, 4, height);
    ctx.fillStyle = mixColor("#1b1c18", fade, tint);
    const title = (record.title || "UNTITLED").toUpperCase();
    const cjk = isCjk(title);
    ctx.font = cjk ? '700 18px "Archive Mono", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif' : '600 17px "Archive Mono", monospace';
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(textWithEndEllipsis(ctx, title, width - 20), 12, height / 2);
    ctx.restore();
  }

  private drawGoldEdge(quad: Point[], scale: number) {
    drawGoldEdge(this.ctx, quad, scale);
  }

  private drawRail(origin: { x: number; y: number }, scale: number, kind: "front" | "mid" | "back", width: number, height: number, lane: number, shelfPosition: number) {
    const { railMeta, rail } = this.assets!;
    const left = origin.x - railMeta.origin[0] * scale;
    const top = origin.y - railMeta.origin[1] * scale;
    const drawWidth = railMeta.res[0] * scale;
    const drawHeight = railMeta.res[1] * scale;
    const mirrored = this.directionSign < 0;
    const visualLeft = mirrored ? 2 * origin.x - left - drawWidth : left;
    if (visualLeft > width || visualLeft + drawWidth < 0 || top > height || top + drawHeight < 0) return;
    const laneDelta = shelfPosition;
    const alpha = Math.round(255 * clamp(1 + laneDelta, 0, 1) * clamp((4 - laneDelta) / 0.8, 0, 1)) / 255;
    if (alpha <= 0) return;
    const tint = Math.round(clamp(0.38 * clamp(laneDelta, 0, 1) + 0.14 * Math.max(0, laneDelta), 0, 0.8) * (this.assets!.floor?.meta.tint ?? 1) * 10) / 10;
    const fade = this.assets!.floor?.meta.fade ?? this.palette.bg;
    const sprite = tint > 0 ? makeTintedSprite(rail[kind], fade, tint, `rail-${kind}`) : rail[kind];
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    drawImageAt(this.ctx, sprite, left, top, drawWidth, drawHeight, origin.x, mirrored);
    if (kind === "front" && railMeta.label) {
      const label = mirrorQuad(mapQuad(railMeta.label, left, top, scale), origin.x, mirrored);
      drawTextQuad(this.ctx, readableQuad(label, mirrored), `ROW ${String(lane + 1).padStart(2, "0")}`, 12, mixColor("#1b1c18", fade, tint), undefined, [100, 20]);
    }
    this.ctx.restore();
  }

  private drawFloor(
    origin: { x: number; y: number },
    scale: number,
    placed: PlacedCell[],
    shelfScroll: (lane: number) => number,
    shelfPosition: (lane: number) => number,
  ) {
    const floor = this.assets!.floor;
    if (!floor) return;
    const ctx = this.ctx;
    const meta = floor.meta;
    const cameraMeta = this.assets!.meta;
    const mirrored = this.directionSign < 0;
    const [plateW, plateH] = meta.plate.res;
    drawImageAt(ctx, floor.plate, origin.x - meta.plate.origin[0] * scale, origin.y - meta.plate.origin[1] * scale, plateW * scale, plateH * scale, origin.x, mirrored);
    if (!this.style.shelf) return;
    const ranges = this.laneRanges(placed, true);
    const shadeOrigin = meta.shade.origin;
    const [sw, sh] = meta.shade.res;
    const ax = cameraMeta.axes.x;
    const ay = cameraMeta.axes.y;
    const az = cameraMeta.axes.z;
    const fz = -meta.floor_z;
    const zx = fz * az[0], zy = fz * az[1];
    const det = ax[0] * ay[1] - ay[0] * ax[1];
    if (Math.abs(det) < 1e-6) return;
    for (const { lane, min, max } of ranges) {
      const laneDelta = shelfPosition(lane);
      const x = -shelfPosition(lane) * LANE_PITCH;
      const minRow = min - 1;
      const maxRow = max + 1;
      const length = Math.max(1, max - min + 1);
      const rowAlpha = Math.round(255 * clamp(1 + laneDelta, 0, 1) * clamp((4 - laneDelta) / 0.8, 0, 1)) / 255;
      const rowTint = Math.round(clamp(0.38 * clamp(laneDelta, 0, 1) + 0.14 * Math.max(0, laneDelta), 0, 0.8) * (meta.tint ?? 1) * 10) / 10;
      const parts = ["", "-far"];
      const layers = meta.glow === false ? ["shade"] : ["shade", "glow"];
      for (const layer of layers) for (const part of parts) {
        const alpha = rowAlpha * (1 - rowTint) * (part ? clamp(1 - laneDelta, 0, 1) : 1);
        for (const end of ["front", "back"] as const) {
          const row = end === "front" ? minRow : maxRow;
          const p = this.project(origin, this.assets!.meta, x, row - shelfScroll(lane), 0, scale);
          const image = floor.images[`${layer}-${end}${part}`];
          if (image && alpha > 0) {
            ctx.save();
            ctx.globalAlpha = alpha;
            drawImageAt(ctx, image, p.x - shadeOrigin[0] * scale, p.y - shadeOrigin[1] * scale, sw * scale, sh * scale, p.x, mirrored);
            ctx.restore();
          }
        }
        const image = floor.images[`${layer}-mid${part}`];
        if (!image || alpha <= 0) continue;
        const centerRow = (minRow + maxRow) / 2;
        const center = this.project(origin, this.assets!.meta, x, centerRow - shelfScroll(lane), 0, scale);
        const stretch = (length - 1) / det;
        const m00 = 1 - stretch * ay[0] * ax[1];
        const m01 = stretch * ay[0] * ax[0];
        const m10 = -stretch * ay[1] * ax[1];
        const m11 = 1 + stretch * ay[1] * ax[0];
        const ux = zx - shadeOrigin[0], uy = zy - shadeOrigin[1];
        const e = center.x + this.directionSign * scale * (m00 * ux + m01 * uy - zx);
        const f = center.y + scale * (m10 * ux + m11 * uy - zy);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.transform(this.directionSign * scale * m00, scale * m10, this.directionSign * scale * m01, scale * m11, e, f);
        ctx.drawImage(image, 0, 0, sw, sh);
        ctx.restore();
      }
    }
  }

  private drawInspection(frame: RenderFrame, selected: PlacedCell, origin: { x: number; y: number }, baseScale: number, view: CaseView, arrayWidth: number) {
    const assets = this.assets!;
    const record = frame.selectedRecord ?? selected.cell.record;
    if (!record) return;
    const meta = assets.meta;
    const frames = meta.inspect;
    if (!frames.length || assets.inspect.length !== frames.length) return;
    const progress = frame.reduced && frame.detail > 0 ? 1 : clamp(frame.detail, 0, 1);
    const framePosition = progress * (frames.length - 1);
    const i0 = Math.min(frames.length - 2, Math.floor(framePosition));
    const blend = framePosition - i0;
    const first = frames[i0];
    const next = frames[i0 + 1];
    const mirrored = this.directionSign < 0;
    const arrayScale = baseScale * view.scaleFactor;
    const liftProgress = easeInOut(clamp(progress * 2, 0, 1));
    const lifted = this.project(origin, meta, selected.x, selected.y, selected.z + INSPECT_LIFT * liftProgress, arrayScale, view.axes);
    const arrayCenter = mapCasePoint(view.center, [lifted.x, lifted.y], view.origin, arrayScale, mirrored, view.rotation);
    const center = {
      x: lerp(arrayCenter[0], arrayWidth * 0.49, progress),
      y: lerp(arrayCenter[1], frame.height * 0.5, progress),
    };
    const last = frames[frames.length - 1];
    const lastCrop = last.crop ?? [0, 0, meta.inspect_res[0], meta.inspect_res[1]];
    const initialScale = baseScale * meta.array_ppu / meta.inspect_ppu;
    const fit = Math.min(arrayWidth * 0.9 / lastCrop[2], Math.max(1, frame.height - 190) / lastCrop[3]);
    const targetScale = Math.max(initialScale, Math.min(initialScale * 2 * this.style.inspectScale, fit));
    const scale = lerp(initialScale, targetScale, easeInOut(progress));
    const coverMeta = interpolateQuad(first.cover, next.cover, blend);
    const rotation = 0;
    const mirroredCover = mapCaseQuad(coverMeta, [center.x, center.y], first.center, scale, mirrored, rotation);
    const coverImage = this.coverFor(record);
    this.ctx.fillStyle = hexToRgba(this.palette.bg, 0.92);
    quadPath(this.ctx, mirroredCover);
    this.ctx.fill();
    if (coverImage) drawImageQuad(this.ctx, coverImage, mirroredCover, 1, mirrored);
    if (coverImage && assets.inspectPaper) {
      this.ctx.save();
      quadPath(this.ctx, mirroredCover); this.ctx.clip();
      this.ctx.globalCompositeOperation = "multiply";
      const shade = (index: number, meta: CaseFrameMeta, alpha: number) => {
        const image = assets.inspectPaper?.[index]; if (!image || alpha <= 0) return;
        const crop = meta.crop ?? [0,0,...assets.meta.inspect_res];
        this.ctx.save(); this.ctx.globalAlpha *= alpha;
        this.ctx.translate(center.x,center.y); if(mirrored)this.ctx.scale(-1,1);
        this.ctx.drawImage(image,(crop[0]-meta.center[0])*scale,(crop[1]-meta.center[1])*scale,crop[2]*scale,crop[3]*scale);
        this.ctx.restore();
      };
      shade(i0, first, 1-blend);
      if (blend>0) shade(i0+1,next,blend);
      this.ctx.restore();
    }
    const drawFrame = (index: number, frameMeta: CaseFrameMeta, alpha: number) => {
      const image = assets.inspect[index];
      const crop = frameMeta.crop ?? [0, 0, meta.inspect_res[0], meta.inspect_res[1]];
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.translate(center.x, center.y);
      if (mirrored) this.ctx.scale(-1, 1);
      if (rotation) this.ctx.rotate(rotation);
      // The shipped PNG is already cropped (and may be downsampled). crop is
      // its destination rectangle in the original 900px coordinate system.
      this.ctx.drawImage(image, (crop[0] - frameMeta.center[0]) * scale, (crop[1] - frameMeta.center[1]) * scale, crop[2] * scale, crop[3] * scale);
      this.ctx.restore();
    };
    drawFrame(i0, first, 1);
    if (blend > 0.01) drawFrame(i0 + 1, next, blend);
    const labelMeta = interpolateQuad(first.label, next.label, blend);
    const label = mapCaseQuad(labelMeta, [center.x, center.y], first.center, scale, mirrored, rotation);
    const catalogEntry = getFoobarEntry(selected.recordIndex);
    const albumIndex = catalogEntry?.recordIndex ?? canonicalAlbumIndex(record);
    if (albumIndex >= 0)
      drawArchiveLabelQuad(this.ctx, readableQuad(label, mirrored), this.inspectLabelCanvas(albumIndex));
    if (this.style.topTitles) {
      const axes0 = inspectProjectionAxes(meta, first);
      const axes1 = inspectProjectionAxes(meta, next);
      const axes = rotateAxes({
        x: [lerp(axes0.x[0], axes1.x[0], blend), lerp(axes0.x[1], axes1.x[1], blend)],
        y: [lerp(axes0.y[0], axes1.y[0], blend), lerp(axes0.y[1], axes1.y[1], blend)],
        z: [lerp(axes0.z[0], axes1.z[0], blend), lerp(axes0.z[1], axes1.z[1], blend)],
      }, rotation);
      const origin0 = first.origin ?? first.center;
      const origin1 = next.origin ?? next.center;
      const frameOrigin = [lerp(origin0[0], origin1[0], blend), lerp(origin0[1], origin1[1], blend)] as Point;
      const projectedOrigin = mapCasePoint(frameOrigin, [center.x, center.y], first.center, scale, mirrored, rotation);
      const at = (x: number, y: number, z: number): Point => [
        projectedOrigin[0] + this.directionSign * (x * axes.x[0] + y * axes.y[0] + z * axes.z[0]) * scale,
        projectedOrigin[1] + (x * axes.x[1] + y * axes.y[1] + z * axes.z[1]) * scale,
      ];
      const { x0, x1, y: stripY, z: stripZ } = TOP_STRIP;
      const start = this.directionSign < 0 ? x1 : x0;
      const step = this.directionSign < 0 ? -1 : 1;
      this.drawTopTitleFace(record, at(start, stripY, stripZ), at(start + step, stripY, stripZ), at(start, stripY - 1, stripZ), 0);
    }
    if (record.album && isHiResAlbum(record.album)) drawGoldEdge(this.ctx, mirroredCover, scale);
    if (progress > 0.85) this.drawSelectedCorners(mirroredCover, scale);
    const entry=getFoobarEntry(selected.recordIndex);
    const body = first.body && next.body ? mapCaseQuad(interpolateQuad(first.body, next.body, blend), [center.x, center.y], first.center, scale, mirrored, rotation) : undefined;
    this.hitTargets.push({ recordIndex: entry?.recordIndex??selected.recordIndex,entryKey:entry?.key,trackId:entry?.track?.id,quad: mirroredCover,body,selected:true });
  }
}
