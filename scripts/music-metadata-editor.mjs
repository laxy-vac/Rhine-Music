import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AlbumInfoSources } from './album-info-sources.mjs';
import { readAudioTagDocument, writeAudioTags } from './metadata-tag-client.mjs';
import { checkedImage, imageFromDataUrl, writeTrackArtworkOverride } from './track-artwork-overrides.mjs';
import { isInside } from './platform.mjs';
import { replaceMetadataFile } from './metadata-file-replace.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const fileRevision = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
const albumRevision = album => digest(JSON.stringify([album.id, album.title, album.artist, album.description, album.descriptionSource, album._cover?.version, album._userInfo]));
const validateCover = cover => {
  if (!cover || !['keep', 'inherit', 'upload', 'candidate'].includes(cover.mode)) throw fail('请选择有效的封面操作。');
  return cover;
};

/** Explicit user edits only. Scanning and playback never call the write methods. */
export class MusicMetadataEditor {
  constructor({ store, dataDir = store.dataDir, sources, tagReader = readAudioTagDocument, tagWriter = writeAudioTags }) {
    this.store = store;
    this.dataDir = dataDir;
    this.sources = sources ?? new AlbumInfoSources({ dataDir, fetcher: store.fetcher, contact: () => store.musicBrainzContact });
    this.tagReader = tagReader;
    this.tagWriter = tagWriter;
    this.saveChain = Promise.resolve();
  }
  async init() {
    try { await this.sources.init(); }
    catch (error) { this.sourceError = error; }
    return this;
  }
  requireSources() {
    if (this.sourceError) throw fail(`专辑资料来源配置无法读取，原文件已保留：${this.sourceError.message}`);
    return this.sources;
  }
  album(id) {
    const album = this.store.index?.albums.find(item => item.id === id && this.store.config.roots.includes(item._root));
    if (!album) throw fail('专辑已不在当前本地曲库中。', 404);
    return album;
  }
  document(id) {
    const current = this.album(id);
    return { album: this.store.snapshot().albums.find(item => item.id === id), revision: albumRevision(current), customCover: !!current._userInfo?.cover };
  }
  async search(value, signal) {
    const album = this.album(value.albumId);
    const result = await this.requireSources().search({ title: value.title ?? album.title, artist: value.artist ?? album.artist, sourceId: value.sourceId }, signal);
    return { ...result, candidates: result.candidates.map(item => ({ ...item, coverUrl: item.coverUrl ? `/api/album-info/cover/${encodeURIComponent(item.id)}` : undefined })) };
  }
  async candidate(id, signal) {
    const result = await this.requireSources().resolve(id, signal);
    return { ...result, coverUrl: result.coverUrl ? `/api/album-info/cover/${encodeURIComponent(id)}` : undefined };
  }
  async storeImage(image) {
    const checked = checkedImage(image.data, image.mime), version = digest(checked.data);
    const target = path.join(this.dataDir, 'artwork', `user-${version}${checked.extension}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try { await fs.writeFile(target, checked.data, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!(await fs.readFile(target)).equals(checked.data)) throw fail('已有封面缓存发生变化，未覆盖。', 409);
    }
    return { path: target, mime: checked.mime, version, embedded: true };
  }
  serialize(task) {
    const result = this.saveChain.catch(() => {}).then(task);
    this.saveChain = result;
    return result;
  }
  saveAlbum(value) { return this.serialize(() => this.saveAlbumNow(value)); }
  async saveAlbumNow(value) {
    const current = this.album(value.albumId), cover = validateCover(value.cover);
    if (value.revision !== albumRevision(current)) throw fail('专辑资料已更新，请重新打开后再保存，当前草稿仍可保留。', 409);
    if (typeof value.description !== 'string' || value.description.length > 100000) throw fail('专辑介绍必须是文本，最多 100000 字符。');
    const description = value.description.replace(/\r\n?/g, '\n');
    const originalDescription = Object.hasOwn(current._userInfo ?? {}, 'description') ? current._userInfo.description : current.description ?? '';
    const next = { ...current._userInfo, revision: randomUUID() };
    let candidate;
    if (value.sourceCandidateId) candidate = await this.requireSources().resolve(value.sourceCandidateId);
    if (candidate || description !== originalDescription) {
      next.description = description;
      next.descriptionSource = candidate?.description === description && candidate.url
        ? { kind: 'online', name: candidate.sourceName, url: candidate.url, license: candidate.license, checkedAt: new Date().toISOString() }
        : { kind: 'manual', name: '手动编辑', checkedAt: new Date().toISOString() };
    }
    if (cover.mode === 'upload') next.cover = await this.storeImage(imageFromDataUrl(cover.dataUrl));
    if (cover.mode === 'candidate') next.cover = await this.storeImage(await this.requireSources().cover(cover.candidateId));
    if (cover.mode === 'inherit') delete next.cover;
    // Network/image work must not commit over a newer automatic/manual edit.
    if (this.album(value.albumId) !== current || value.revision !== albumRevision(current)) throw fail('专辑资料在保存期间发生变化，请重新读取。', 409);
    current._userInfo = next;
    if (Object.hasOwn(next, 'description')) {
      current.description = next.description;
      current.descriptionSource = next.descriptionSource;
    }
    await this.store.saveIndex();
    this.store.onChange();
    return this.store.snapshot();
  }
  async track(id) {
    const descriptor = this.store.trackFile(id);
    if (!descriptor) throw fail('曲目已不在当前本地曲库中。', 404);
    const album = this.store.index.albums.find(item => item.tracks.some(track => track.id === id));
    const track = album?.tracks.find(item => item.id === id);
    const [real, root] = await Promise.all([fs.realpath(descriptor.path), fs.realpath(descriptor.allowedRoot)]);
    if (!isInside(root, real)) throw fail('歌曲文件已移出配置的音乐目录，未读取或写入。', 403);
    const stat = await fs.stat(real, { bigint: true });
    if (!stat.isFile()) throw fail('歌曲文件不存在。', 404);
    return { album, track, file: real, root, stat, revision: fileRevision(stat) };
  }
  async trackDocument(id) {
    const found = await this.track(id), tags = await this.tagReader(found.file);
    try { await fs.access(found.file, constants.W_OK); await fs.access(path.dirname(found.file), constants.W_OK); }
    catch { tags.writable = false; tags.readOnlyReason = '歌曲或所在目录为只读，不能安全写回。'; }
    const after = await fs.stat(found.file, { bigint: true });
    if (found.revision !== fileRevision(after)) throw fail('歌曲在读取期间发生变化，请重试。', 409);
    const { track, album } = found;
    const mode = track._coverOverride?.mode ?? 'inherit';
    return {
      trackId: track.id, albumId: album.id, revision: found.revision, fields: tags.fields,
      artwork: { mode, canEmbed: tags.canEmbed, url: mode === 'inherit' ? this.document(album.id).album.coverUrl : `/api/track-info/cover/${track.id}?v=${track._embeddedCover?.version ?? track._coverOverride?.version ?? found.revision}` },
      writable: tags.writable, readOnlyReason: tags.readOnlyReason,
      file: { name: path.basename(found.file), relativePath: track.relativePath, size: Number(found.stat.size), modifiedAt: new Date(Number(found.stat.mtimeMs)).toISOString(),
        format: track.format, duration: track.duration, sampleRate: track.sampleRate, bitsPerSample: track.bitsPerSample, bitrate: track.bitrate, numberOfChannels: track.numberOfChannels },
    };
  }
  saveTrack(value) { return this.serialize(async () => {
    if (this.store.scanPromise) throw fail('正在扫描音乐库，请扫描完成后再保存歌曲。', 409);
    this.store.metadataWrites = (this.store.metadataWrites ?? 0) + 1;
    try { return await this.saveTrackNow(value); }
    finally { this.store.metadataWrites--; }
  }); }
  async saveTrackNow(value) {
    if (this.store.scanPromise) throw fail('正在扫描音乐库，请扫描完成后再保存歌曲。', 409);
    const found = await this.track(value.trackId), cover = validateCover(value.cover);
    if (cover.mode === 'candidate') throw fail('歌曲封面请从本地选择，或继承专辑封面。');
    if (value.revision !== found.revision) throw fail('歌曲已被外部修改，请重新读取后再保存，未覆盖原文件。', 409);
    if (!value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields) || Object.keys(value.fields).length > 4096) throw fail('歌曲标签格式无效。');
    for (const [key, values] of Object.entries(value.fields)) {
      if (!key.trim() || key.length > 256 || /[\0\r\n]/.test(key) || ['__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE'].includes(key.toUpperCase()) || !Array.isArray(values) || values.length > 256 || values.some(item => typeof item !== 'string' || item.length > 100000 || item.includes('\0')))
        throw fail(`标签 ${key} 的名称或多值文本无效。`);
    }
    const before = await this.tagReader(found.file);
    if (!before.writable) throw fail(before.readOnlyReason || '此文件当前不支持安全写回。');
    if (cover.mode === 'keep' && [...new Set([...Object.keys(before.fields), ...Object.keys(value.fields)])]
      .every(key => JSON.stringify(before.fields[key] ?? []) === JSON.stringify(value.fields[key] ?? []))) return this.store.snapshot();
    let image;
    if (cover.mode === 'upload') image = imageFromDataUrl(cover.dataUrl);
    if (cover.mode === 'inherit') {
      const source = this.store.artworkFile(found.album.id);
      if (source) {
        const [realImage, allowed] = await Promise.all([fs.realpath(source.path), fs.realpath(source.allowedRoot)]);
        if (!isInside(allowed, realImage)) throw fail('专辑封面已移出允许目录。', 403);
        const stat = await fs.stat(realImage);
        if (stat.size > 8 * 1024 * 1024) throw fail('专辑封面过大，不能写入歌曲。');
        image = checkedImage(await fs.readFile(realImage), source.mime);
      }
    }
    const temporary = path.join(path.dirname(found.file), `.rhine-edit-${randomUUID()}${path.extname(found.file)}`);
    let sidecar, committed = false;
    // MP4's native artwork atom accepts JPEG/PNG, not WebP. Keep WebP as a
    // per-track image alongside the song instead of mislabelling its bytes.
    const embedImage = before.canEmbed && !(image?.mime === 'image/webp' && /\.(?:mp4|m4a|alac)$/i.test(found.file));
    try {
      await fs.copyFile(found.file, temporary, constants.COPYFILE_EXCL);
      const result = await this.tagWriter(temporary, {
        fields: value.fields,
        cover: cover.mode === 'keep' ? { mode: 'keep' } : image && embedImage ? { mode: 'replace', data: image.data, mime: image.mime } : { mode: image ? 'keep' : 'remove' },
      });
      // The writer's path is always a private staging file. Read back before
      // replacing the indexed file, retaining unknown original tags/frames.
      const staged = await this.tagReader(temporary);
      for (const key of new Set([...Object.keys(before.fields), ...Object.keys(value.fields)])) {
        const values = value.fields[key] ?? [];
        const wanted = values.filter(item => item !== '');
        if (JSON.stringify((staged.fields[key] ?? []).filter(item => item !== '')) !== JSON.stringify(wanted)) throw fail(`标签 ${key} 写回核对失败，原歌曲未改动。`);
      }
      if (fileRevision(await fs.stat(found.file, { bigint: true })) !== found.revision || (await this.track(value.trackId)).file !== found.file)
        throw fail('歌曲在编辑期间被外部修改，未覆盖原文件。', 409);
      let override = found.track._coverOverride;
      if (cover.mode !== 'keep') {
        const mode = cover.mode === 'inherit' ? 'inherit' : result.coverEmbedded && embedImage ? 'embedded' : 'sidecar';
        sidecar = await writeTrackArtworkOverride(found.file, mode, image);
        override = sidecar.override;
      }
      const handle = await fs.open(temporary, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      const current = await this.track(value.trackId);
      if (current.file !== found.file || current.revision !== found.revision) throw fail('歌曲在保存期间发生变化，未覆盖原文件。', 409);
      await replaceMetadataFile(temporary, found.file);
      committed = true;
      await this.store.refreshEditedTrack(value.trackId, { coverOverride: override, freezeCover: cover.mode === 'upload' });
      return this.store.snapshot();
    } catch (error) {
      committed ||= error.committed === true;
      if (!committed && sidecar) await sidecar.rollback();
      if (committed) throw fail(`歌曲标签已写入，但曲库刷新失败：${error.message}。请重新读取此歌曲。`, 500);
      throw error;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}
