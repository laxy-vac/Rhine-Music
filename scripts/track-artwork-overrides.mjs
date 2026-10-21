import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
export function checkedImage(data, declared) {
  const bytes = Buffer.from(data);
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : '';
  if (!mime || !bytes.length || bytes.length > 8 * 1024 * 1024 || declared && declared.replace('image/jpg', 'image/jpeg') !== mime)
    throw new Error('封面必须是有效的 JPEG、PNG 或 WebP，且不能超过 8 MiB。');
  return { data: bytes, mime, extension: extensions[mime] };
}
export function imageFromDataUrl(value) {
  if (typeof value !== 'string' || value.length > 12 * 1024 * 1024) throw new Error('封面数据无效或过大。');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('封面数据格式不受支持。');
  return checkedImage(Buffer.from(match[2], 'base64'), match[1]);
}
function locations(file) {
  const name = path.basename(file);
  const key = createHash('sha256').update(name).digest('hex').slice(0, 24);
  const directory = path.join(path.dirname(file), '.rhine-artwork');
  return { name, directory, json: path.join(directory, `track-${key}.json`) };
}
async function existing(loc, strict = false) {
  try {
    const [parent, directory] = await Promise.all([fs.realpath(path.dirname(loc.directory)), fs.realpath(loc.directory)]);
    if (path.dirname(directory) !== parent) throw new Error('曲目封面目录不在歌曲目录内。');
    const stat = await fs.lstat(loc.json);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('曲目封面关联文件不能是符号链接或目录。');
    if (stat.size > 8192) throw new Error('曲目封面关联文件过大。');
    const bytes = await fs.readFile(loc.json), value = JSON.parse(bytes);
    if (value.app !== 'RhineMusic' || value.version !== 1 || value.track !== loc.name ||
      !['inherit', 'embedded', 'sidecar'].includes(value.mode) ||
      value.mode === 'sidecar' && (typeof value.image !== 'string' || path.basename(value.image) !== value.image || !/^cover-[a-f0-9]{24}\.(jpg|png|webp)$/.test(value.image)))
      throw new Error('曲目封面关联文件格式无效，未覆盖原文件。');
    return { bytes, value };
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    if (strict) throw error;
    return undefined;
  }
}
export async function readTrackArtworkOverride(file) {
  const loc = locations(file), prior = await existing(loc);
  if (!prior) return undefined;
  const { value } = prior;
  if (value.mode !== 'sidecar') return { mode: value.mode };
  const image = path.join(loc.directory, value.image);
  try {
    const [directory, real] = await Promise.all([fs.realpath(loc.directory), fs.realpath(image)]);
    if (path.dirname(real) !== directory || path.dirname(directory) !== await fs.realpath(path.dirname(file))) return undefined;
    const stat = await fs.stat(real);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return undefined;
    return { mode: 'sidecar', path: real, mime: value.mime, version: value.image.slice(6, 30), embedded: false };
  } catch { return undefined; }
}
export async function writeTrackArtworkOverride(file, mode, image) {
  const loc = locations(file), prior = await existing(loc, true);
  // Persist an embedded override too: otherwise a full index rebuild cannot
  // distinguish the user's song cover from the album's default artwork.
  if (mode === 'inherit' && !prior) return { override: { mode }, rollback: async () => {} };
  await fs.mkdir(loc.directory, { recursive: true });
  if (path.dirname(await fs.realpath(loc.directory)) !== await fs.realpath(path.dirname(file))) throw new Error('曲目封面目录已移出歌曲所在目录。');
  const value = { app: 'RhineMusic', version: 1, track: loc.name, mode, revision: randomUUID() };
  let override = { mode };
  let createdImage, createdBytes;
  const cleanupImage = async () => {
    if (!createdImage) return;
    const info = await fs.lstat(createdImage).catch(() => undefined);
    if (info?.isFile() && !info.isSymbolicLink() && (await fs.readFile(createdImage)).equals(createdBytes)) await fs.unlink(createdImage);
  };
  if (mode === 'sidecar') {
    const checked = checkedImage(image.data, image.mime);
    const digest = createHash('sha256').update(checked.data).digest('hex').slice(0, 24);
    value.image = `cover-${digest}${checked.extension}`;
    value.mime = checked.mime;
    const imagePath = path.join(loc.directory, value.image);
    try { await fs.writeFile(imagePath, checked.data, { flag: 'wx' }); createdImage = imagePath; createdBytes = checked.data; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await fs.lstat(imagePath);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('已有曲目封面缓存不能是符号链接或目录。');
      if (!(await fs.readFile(imagePath)).equals(checked.data)) throw new Error('已有曲目封面缓存发生变化，未覆盖。');
    }
    override = { mode, path: imagePath, mime: checked.mime, version: digest, embedded: false };
  }
  const temporary = `${loc.json}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
    const latest = await existing(loc, true);
    if (prior ? !latest?.bytes.equals(prior.bytes) : latest) throw new Error('曲目封面关联已被外部修改，未覆盖。');
    await fs.rename(temporary, loc.json);
  }
  catch (error) { await cleanupImage(); throw error; }
  finally { await fs.rm(temporary, { force: true }); }
  return { override, rollback: async () => {
    const current = await existing(loc, true);
    if (current?.value.revision !== value.revision) throw new Error('曲目封面关联已被外部修改，无法自动撤回。');
    if (prior) { await fs.writeFile(temporary, prior.bytes, { flag: 'wx' }); await fs.rename(temporary, loc.json); }
    else await fs.unlink(loc.json);
    await cleanupImage();
  } };
}
