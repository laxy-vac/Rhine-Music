import { trUi, ui } from "./i18n.ts";
import type { MusicTrack } from "./music-types";
import { normalizeSony, sonyEnabled, prepareSonyAudio, type SonySettings, type SonyProcessing, type SonyExecution } from "./sony-audio.ts";
import { NativeAudio, normalizeOutput, isDsd, directDsd, type OutputSettings, type SongAudio, type NativePlaybackSession, type NativeOutputSnapshot, type SpectrumSnapshot } from "./native-audio.ts";
import { normalizeProcessing, type ProcessingSettings } from "./audio-processing-model.mjs";

export interface MusicPlayerState {
  transport: "idle" | "loading" | "playing" | "paused" | "error";
  currentTrack: MusicTrack | null;
  queue: readonly MusicTrack[];
  currentIndex: number;
  playbackOrder: PlaybackOrder;
  playing: boolean;
  loading: boolean;
  duration: number;
  currentTime: number;
  volume: number;
  songFadeEnabled: boolean;
  bgmVolume: number;
  bgmEnabled: boolean;
  bgmPlaying: boolean;
  error: string | null;
  bgmError: string | null;
  sonySettings: SonySettings;
  sonyExecution: SonyExecution;
  sonyProcessing: SonyProcessing;
  backend: OutputSettings['backend'];
  outputSettings: OutputSettings;
  volumeLocked: boolean;
  nativeSessionId?: string;
  nativeOutputStatus?: NativeOutputSnapshot;
  transitionNote?: string;
  processingPending?: boolean;
}

type Listener = (state: MusicPlayerState) => void;
type Transport = MusicPlayerState["transport"];
type Fade = { timer: ReturnType<typeof setTimeout>; finish: () => void };
export type PlaybackOrder = "default" | "repeat-queue" | "repeat-track" | "random" | "shuffle-tracks" | "shuffle-albums" | "shuffle-folders";

const PLAYBACK_ORDERS: readonly PlaybackOrder[] = [
  "default",
  "repeat-queue",
  "repeat-track",
  "random",
  "shuffle-tracks",
  "shuffle-albums",
  "shuffle-folders",
];
const isPlaybackOrder = (value: unknown): value is PlaybackOrder =>
  typeof value === "string" && (PLAYBACK_ORDERS as readonly string[]).includes(value);
const isShuffleOrder = (value: PlaybackOrder) =>
  value === "shuffle-tracks" || value === "shuffle-albums" || value === "shuffle-folders";

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}

function playbackFolderKey(track: MusicTrack): string {
  const path = track.relativePath.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  const slash = path.lastIndexOf("/");
  return (slash >= 0 ? path.slice(0, slash) : ".").toLowerCase();
}

function orderPlaybackQueue(
  tracks: readonly MusicTrack[],
  currentTrackId: string | undefined,
  order: PlaybackOrder,
): MusicTrack[] {
  if (!isShuffleOrder(order)) return [...tracks];
  const current = currentTrackId ? tracks.find((track) => track.id === currentTrackId) : undefined;
  const remaining = tracks.filter((track) => track.id !== current?.id);
  let reordered: MusicTrack[];
  if (order === "shuffle-tracks") {
    reordered = shuffled(remaining);
  } else {
    const keyFor = order === "shuffle-albums"
      ? (track: MusicTrack) => track.albumId || track.id
      : playbackFolderKey;
    const units = new Map<string, MusicTrack[]>();
    for (const track of tracks) {
      const key = keyFor(track);
      const unit = units.get(key);
      if (unit) unit.push(track);
      else units.set(key, [track]);
    }
    // Retain the current album/folder as a complete ordered unit. Its current
    // index may be in the middle: keeping that index avoids jumping from track
    // five back to track one when album shuffle is enabled during playback.
    const currentKey = current ? keyFor(current) : undefined;
    const currentUnit = currentKey === undefined ? undefined : units.get(currentKey);
    if (currentKey !== undefined) units.delete(currentKey);
    return [...(currentUnit ?? []), ...shuffled([...units.values()]).flat()];
  }
  return current ? [current, ...reordered] : reordered;
}

const SONG_FADE_MS = 450;
const unit = (value: number) => Math.max(0, Math.min(1, value));
const seconds = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : 0;
const uniqueTracks = (tracks: readonly MusicTrack[]): MusicTrack[] => {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
};

/** Music transport is independent from TerminalAudio and the Three.js scene lifecycle. */
export class MusicPlayer {
  private value: Omit<MusicPlayerState, "transport">;
  private listeners = new Set<Listener>();
  private song?: SongAudio;
  private songTrackId?: string;
  private songGain = 1;
  private songFade?: Fade;
  private readonly bgm: HTMLAudioElement;
  private transport: Transport = "idle";
  private operation = 0;
  private bgmOperation = 0;
  private bgmTarget = 0;
  private bgmTask: Promise<void> = Promise.resolve();
  private fade?: Fade;
  private gestureReceived = false;
  private disposed = false;
  private pendingSeek: number | null = null;
  private sonyAbort?: AbortController;
  private songSettingsKey = "";
  private songSonyStartPosition = 0;
  private preparationPaused = false;
  private queuedSignature = "";
  private originalQueue?: MusicTrack[];
  private playbackOrderRevision = 0;
  private processingOperation = 0;
  private processingRetryable = false;
  private retryingProcessing = false;
  private browserSpectrum?: { audio: HTMLAudioElement; context: AudioContext; source: MediaElementAudioSourceNode; analyser?: AnalyserNode; bins: Float32Array<ArrayBuffer> };
  private browserSpectrumError = "";

  constructor(
    options: {
      volume?: number;
      songFadeEnabled?: boolean;
      bgmVolume?: number;
      bgmEnabled?: boolean;
      sonySettings?: SonySettings;
      sonyExecution?: SonyExecution;
      outputSettings?: OutputSettings;
    } = {},
  ) {
    this.value = {
      currentTrack: null,
      queue: [],
      currentIndex: -1,
      playbackOrder: "default",
      playing: false,
      loading: false,
      duration: 0,
      currentTime: 0,
      volume: Number.isFinite(options.volume) ? unit(options.volume!) : 0.7,
      songFadeEnabled: options.songFadeEnabled ?? true,
      bgmVolume: Number.isFinite(options.bgmVolume)
        ? unit(options.bgmVolume!)
        : 0.18,
      bgmEnabled: options.bgmEnabled ?? true,
      bgmPlaying: false,
      error: null,
      bgmError: null,
      sonySettings: normalizeSony(options.sonySettings),
      sonyExecution: { streaming: options.sonyExecution?.streaming !== false, parallel: options.sonyExecution?.parallel !== false },
      sonyProcessing: { state: "off", progress: 0 },
      backend: normalizeOutput(options.outputSettings).backend,
      outputSettings: normalizeOutput(options.outputSettings),
      volumeLocked: false,
    };
    this.bgm = new Audio("/audio/atmosphere.ogg");
    this.bgm.loop = true;
    this.bgm.preload = "none";
    this.bgm.volume = 0;
    this.bgm.addEventListener("error", this.onBgmError);
    document.addEventListener("pointerdown", this.onGesture, { capture: true });
    document.addEventListener("keydown", this.onGesture, { capture: true });
    // Intentionally no visibilitychange handler: music must continue in the background.
  }

  get state(): MusicPlayerState {
    return { ...this.value, transport: this.transport, queue: [...this.value.queue],
      sonySettings: { ...this.value.sonySettings }, sonyExecution: { ...this.value.sonyExecution }, sonyProcessing: { ...this.value.sonyProcessing },outputSettings:{...this.value.outputSettings},nativeSessionId:this.song instanceof NativeAudio?this.song.sessionId:undefined,
      volumeLocked:this.song instanceof NativeAudio?this.song.volumeLocked:this.value.volumeLocked,
      nativeOutputStatus:this.song instanceof NativeAudio&&this.songTrackId===this.value.currentTrack?.id?this.song.outputStatus:undefined };
  }

  /** Actual current-song frequency data; native DSD carriers are never analysed as PCM. */
  readSpectrum(): SpectrumSnapshot {
    if (!this.song || !this.value.currentTrack || !this.value.playing) return { available: false, bands: [], reason: this.transport === "paused" ? trUi("已暂停") : this.transport === "loading" ? trUi("缓冲中") : trUi("等待播放") };
    if (this.song instanceof NativeAudio) {
      const spectrum = this.song.outputStatus?.spectrum;
      if (!spectrum) return { available: false, bands: [], reason: trUi("正在等待原生频谱数据。") };
      const reason = spectrum.available ? undefined : /DSD|DoP/.test(spectrum.reason ?? "") ? trUi("DSD 直出暂不提供 PCM 频谱。") : /paused/.test(spectrum.reason ?? "") ? trUi("已暂停。") : /buffering/.test(spectrum.reason ?? "") ? trUi("正在等待音乐数据。") : /waiting/.test(spectrum.reason ?? "") ? trUi("频谱正在采样…") : trUi("当前播放路线暂无频谱。");
      return { ...spectrum, reason, stage: trUi("处理后 · 音量前") };
    }
    if (typeof HTMLAudioElement === "undefined" || !(this.song instanceof HTMLAudioElement) || typeof AudioContext === "undefined") return { available: false, bands: [], reason: trUi("当前播放环境不提供频谱采样。") };
    if (this.browserSpectrum?.audio !== this.song) this.attachBrowserSpectrum(this.song);
    const session = this.browserSpectrum;
    if (!session?.analyser || session.context.state !== "running") return { available: false, bands: [], reason: this.browserSpectrumError || trUi("点击播放后启用频谱采样。") };
    session.analyser.getFloatFrequencyData(session.bins);
    const rate = session.context.sampleRate, maximum = Math.min(20000, rate / 2), fftSize = session.analyser.fftSize;
    const binHz = rate / fftSize;
    const binCount = Math.min(session.bins.length, Math.floor(maximum / binHz) + 1);
    const binsDb = Array.from({ length: binCount }, (_, bin) => {
      const value = session.bins[bin];
      return Number.isFinite(value) ? Math.max(-240, Math.min(24.0824, value)) : -240;
    });
    const bands = Array.from({ length: 32 }, (_, index) => {
      const low = 20 * (maximum / 20) ** (index / 32), high = 20 * (maximum / 20) ** ((index + 1) / 32);
      const first = Math.max(1, Math.floor(low / binHz)), last = Math.min(binCount - 1, Math.ceil(high / binHz));
      let peakDb = -240; for (let bin = first; bin <= last; bin++) peakDb = Math.max(peakDb, binsDb[bin]);
      return Math.max(0, Math.min(1, (peakDb + 72) / 72));
    });
    return { available: true, bands, sampleRate: rate, fftSize, binHz, binsDb, updatedAt: Date.now(), stage: trUi("浏览器歌曲采样") };
  }

  private attachBrowserSpectrum(audio: HTMLAudioElement): void {
    if (this.browserSpectrum?.audio === audio) return;
    let context: AudioContext | undefined, source: MediaElementAudioSourceNode | undefined;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192; analyser.minDecibels = -240; analyser.maxDecibels = 0; analyser.smoothingTimeConstant = 0;
      const bins = new Float32Array(analyser.frequencyBinCount);
      source = context.createMediaElementSource(audio);
      source.connect(analyser); analyser.connect(context.destination);
      this.browserSpectrum = { audio, context, source, analyser, bins };
      this.browserSpectrumError = "";
      void context.resume().catch(() => { this.browserSpectrumError = trUi("点击播放后启用频谱采样。"); });
    } catch {
      this.browserSpectrumError = trUi("浏览器频谱采样暂不可用。");
      if (context && source) {
        source.disconnect(); source.connect(context.destination);
        this.browserSpectrum = { audio, context, source, bins: new Float32Array(0) };
        void context.resume().catch(() => {});
      } else if (context) void context.close().catch(() => {});
    }
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setQueue(tracks: readonly MusicTrack[]): void {
    if (this.disposed) return;
    const sourceQueue = uniqueTracks(tracks);
    const id = this.value.currentTrack?.id;
    let queue = sourceQueue;
    if (this.value.playbackOrder === "default") {
      this.originalQueue = undefined;
    } else if (isShuffleOrder(this.value.playbackOrder)) {
      this.originalQueue = [...sourceQueue];
      queue = orderPlaybackQueue(sourceQueue, id, this.value.playbackOrder);
    } else {
      this.originalQueue = undefined;
    }
    if (this.value.playbackOrder !== "default") {
      this.playbackOrderRevision += 1;
      this.cancelQueuedNativeTracks();
    } else if(this.song instanceof NativeAudio&&JSON.stringify(queue.map(track=>track.id))!==JSON.stringify(this.value.queue.map(track=>track.id))){this.queuedSignature="";void this.song.clearQueue().catch(()=>{})}
    const index = queue.findIndex((track) => track.id === id);
    this.value.queue = queue;
    if (id && index === -1) {
      this.stop();
      this.value.currentTrack = null;
      this.value.duration = 0;
    } else if (index !== -1) {
      this.value.currentTrack = queue[index];
    }
    this.value.currentIndex = index;
    this.emit();
  }

  setPlaybackOrder(order: PlaybackOrder): void {
    if (this.disposed || !isPlaybackOrder(order) || order === this.value.playbackOrder) return;
    const currentTrackId = this.value.currentTrack?.id;
    const sourceQueue = this.originalQueue ?? [...this.value.queue];
    const queue = order === "default"
      ? sourceQueue
      : orderPlaybackQueue(sourceQueue, currentTrackId, order);
    this.originalQueue = isShuffleOrder(order) ? [...sourceQueue] : undefined;
    this.value.playbackOrder = order;
    this.value.queue = queue;
    this.value.currentIndex = queue.findIndex((track) => track.id === currentTrackId);
    if (this.value.currentIndex >= 0) this.value.currentTrack = queue[this.value.currentIndex];
    this.playbackOrderRevision += 1;
    this.cancelQueuedNativeTracks();
    this.emit();
  }

  updateTrackMetadata(tracks: readonly MusicTrack[]): void {
    if(this.disposed)return;
    const byId=new Map(tracks.map(track=>[track.id,track]));
    const queue=this.value.queue.map(track=>byId.get(track.id)??track);
    if(JSON.stringify(queue)===JSON.stringify(this.value.queue))return;
    this.value.queue=queue;
    if(this.originalQueue)this.originalQueue=this.originalQueue.map(track=>byId.get(track.id)??track);
    if(this.value.currentTrack)this.value.currentTrack=byId.get(this.value.currentTrack.id)??this.value.currentTrack;
    this.emit();
  }

  restoreNativePlayback(session: NativePlaybackSession, tracks: readonly MusicTrack[]): boolean {
    if(this.disposed||this.value.currentTrack)return false;
    const queue=uniqueTracks(tracks),index=queue.findIndex(track=>track.id===session.trackId);
    if(index<0)return false;
    const track=queue[index],output=normalizeOutput(session.settings);
    ++this.operation;this.value.queue=queue;this.value.currentIndex=index;this.value.currentTrack=track;
    this.value.outputSettings=output;this.value.backend=output.backend;this.value.sonySettings=normalizeSony(session.sonySettings);
    this.value.sonyProcessing=session.sonyProcessing;this.value.volumeLocked=directDsd(track,output);
    this.value.volume=Number.isFinite(session.volume)?unit(session.volume):this.value.volume;
    this.value.currentTime=seconds(session.state.position??0);this.value.duration=seconds(session.state.duration??0)||seconds(track.duration);
    this.value.playing=session.state.playing===true&&!session.state.ended;this.value.loading=session.state.buffering===true;this.value.error=null;
    this.transport=session.state.ended?'idle':this.value.playing?'playing':'paused';
    this.songSonyStartPosition=session.state.sourceStart??0;
    this.createSong(track,session.sonyJobId?`/api/sony/audio/${session.sonyJobId}`:track.audioUrl||`/api/audio/${track.id}`,session.state.sourceStart??0,session);
    this.emit();void this.reconcileBgm();return true;
  }

  async play(id: string, tracks?: readonly MusicTrack[], restore?: { position: number; paused: boolean }): Promise<void> {
    if (this.disposed) return;
    const sourceQueue = tracks ? uniqueTracks(tracks) : this.value.queue;
    const queue = tracks && this.value.playbackOrder !== "default"
      ? orderPlaybackQueue(sourceQueue, id, this.value.playbackOrder)
      : sourceQueue;
    const index = queue.findIndex((track) => track.id === id);
    if (index === -1) {
      this.value.error = trUi("这首歌曲已不在播放队列中，请重新选择。");
      this.emit();
      return;
    }
    if (tracks) {
      if (this.value.playbackOrder === "default") {
        this.originalQueue = undefined;
      } else {
        this.originalQueue = isShuffleOrder(this.value.playbackOrder) ? [...sourceQueue] : undefined;
        this.playbackOrderRevision += 1;
        this.cancelQueuedNativeTracks();
      }
    }
    const track = queue[index];
    if(!restore&&this.song instanceof NativeAudio&&this.song.outputStatus?.capabilities?.manualAdvance===true&&this.value.outputSettings.processing.transition.manual!=='none'&&await this.tryNativeTransition(track,queue))return;
    // Updating the queue in a play request keeps cross-album switches in the same fade.
    this.value.queue = queue;
    const request = ++this.operation;
    this.preparationPaused = restore?.paused === true;
    this.sonyAbort?.abort();
    this.cancelSongFade();
    const resume =
      this.songTrackId === id && this.song && !this.song.ended && this.songSettingsKey === JSON.stringify(this.value.sonySettings)
        && (!restore || !(this.song instanceof NativeAudio) || restore.position+1e-6>=this.song.sourceStartTime)
        ? this.song
        : undefined;
    this.value.currentTrack = track;
    this.value.volumeLocked = directDsd(track,this.value.outputSettings);
    this.value.currentIndex = index;
    this.value.error = null;
    this.value.loading = true;
    this.transport = "loading";
    this.value.playing = !!resume && !resume.paused;
    this.value.currentTime = resume
      ? this.pendingSeek ?? seconds(resume.currentTime)
      : seconds(restore?.position??0);
    this.value.duration =
      (resume ? seconds(resume.duration) : 0) || seconds(track.duration);
    if (!resume) this.pendingSeek = null;
    const unsupported = !sonyEnabled(this.value.sonySettings) && this.value.backend==='browser' && !isDsd(track) ? this.unsupported(track) : null;
    if (unsupported) {
      this.fail(unsupported);
      return;
    }
    this.emit();
    if (request !== this.operation || this.disposed) return;

    // Silence the atmosphere while Sony prepares, including a long first-time job.
    void this.reconcileBgm();

    let source = track.audioUrl || `/api/audio/${encodeURIComponent(track.id)}`;
    const direct = directDsd(track,this.value.outputSettings);
    const bitPerfectPcm = this.value.backend !== 'browser' && !direct && this.value.outputSettings.processing.bitPerfect;
    if (bitPerfectPcm && isDsd(track)) { this.fail(trUi('PCM 比特一致性用于整数 PCM 音源；播放 DSD 请关闭此模式并选择 DSD 播放路线。')); return; }
    const effects = !direct && !bitPerfectPcm && sonyEnabled(this.value.sonySettings);
    const startPosition=resume?this.songSonyStartPosition:(this.value.backend!=='browser'&&this.value.sonyExecution.streaming?Math.floor((restore?.position??0)*1000)/1000:0);
    let sourceStart=effects||isDsd(track)&&!direct?startPosition:0;
    if (effects || (isDsd(track)&&!direct)) {
      // Release the old native reader immediately so its ARM task cannot keep
      // a new setting or track queued behind the rest of an old song.
      if(!resume&&this.song instanceof NativeAudio)this.releaseSong();
      const aborter = this.sonyAbort = new AbortController();
      try {
        source = await prepareSonyAudio(track.id, effects?this.value.sonySettings:{dsee:false,dc:0,vinyl:0}, aborter.signal, (state) => {
          if (request !== this.operation || this.disposed) return;
          if(Number.isFinite(state.positionOffset))sourceStart=state.positionOffset!;
          this.value.sonyProcessing = effects?state:{...state,state:state.state==='active'?'off':state.state,message:state.state==='preparing'?trUi('正在将 DSD 转换为 PCM…'):state.message};
          if (state.state === "error") { this.fail(state.message || trUi("Sony 原版处理失败。")); return; }
          this.emit();
        }, {...this.value.sonyExecution,dsdToPcm:isDsd(track),startPosition});
      } catch (error) {
        if (request !== this.operation || this.disposed || aborter.signal.aborted) return;
        this.value.sonyProcessing = { state: "error", progress: 0, message: (error as Error).message };
        this.fail((error as Error).message);
        return;
      }
    } else if (!resume) this.value.sonyProcessing = { state: "off", progress: 0 };
    if (request !== this.operation || this.disposed) return;

    if (!resume) {
      const outgoing = this.song;
      if (
        outgoing &&
        !outgoing.paused &&
        !outgoing.ended &&
        this.value.songFadeEnabled && !(outgoing instanceof NativeAudio)
      ) {
        await this.fadeSong(outgoing, 0);
        if (request !== this.operation || this.disposed) return;
      }
      // Release the outgoing source before the next one can start: songs never overlap.
      this.releaseSong();
    }
    const audio = this.song ?? this.createSong(track, source,sourceStart);
    if(!resume)this.songSonyStartPosition=startPosition;
    if (restore) this.seek(restore.position);

    if (restore?.paused) {
      this.transport = "paused";
      this.value.playing = this.value.loading = false;
      this.emit();
      return;
    }

    // A shared transition promise keeps rapid BGM toggles from bypassing this silence gate.
    await this.reconcileBgm();
    if (request !== this.operation || this.disposed || this.song !== audio)
      return;
    try {
      await audio.play();
      if (request !== this.operation || this.disposed || this.song !== audio) {
        if (this.song !== audio || !this.expectsSong()) audio.pause();
        return;
      }
      if (!audio.paused) {
        this.transport = "playing";
        this.value.playing = true;
        this.value.loading = false;
        this.emit();
        if (request !== this.operation || this.disposed || this.song !== audio)
          return;
        if (this.value.songFadeEnabled && !this.value.volumeLocked && !(audio instanceof NativeAudio)) await this.fadeSong(audio, 1);
        else this.setSongGain(1);
      }
    } catch (error) {
      if (request !== this.operation || this.disposed || this.song !== audio)
        return;
      this.fail(this.playbackError(track, error));
    }
  }

  async toggle(): Promise<void> {
    if (this.disposed) return;
    if (this.transport === "loading" || this.transport === "playing") {
      ++this.operation;
      this.sonyAbort?.abort();
      this.cancelSongFade();
      this.transport = "paused";
      this.song?.pause();
      if (this.songTrackId !== this.value.currentTrack?.id || this.songSettingsKey !== JSON.stringify(this.value.sonySettings)) this.releaseSong();
      else this.setSongGain(1);
      if (this.value.sonyProcessing.state === "preparing") this.value.sonyProcessing = { state: "off", progress: 0 };
      this.value.playing = false;
      this.value.loading = false;
      this.emit();
      await this.reconcileBgm();
      return;
    }
    const track = this.value.currentTrack ?? this.value.queue[0];
    if (track) await this.play(track.id,undefined,this.transport==='paused'?{position:this.pendingSeek??this.value.currentTime,paused:false}:undefined);
  }

  async next(): Promise<void> {
    if (this.disposed) return;
    const track = this.value.queue[this.nextPlaybackIndex(false)];
    if (!track) {
      this.stop();
      return;
    }
    if (track.id === this.value.currentTrack?.id && this.songTrackId === track.id && this.song && !this.song.ended) {
      this.seek(0);
      return;
    }
    await this.play(track.id);
  }

  async previous(): Promise<void> {
    if (this.disposed) return;
    if (this.value.currentTime > 3 && this.song) {
      this.seek(0);
      return;
    }
    const track = this.value.queue[Math.max(0, this.value.currentIndex - 1)];
    if (track) {
      if (track.id === this.value.currentTrack?.id) this.seek(0);
      await this.play(track.id);
    }
  }

  seek(position: number): void {
    if (
      this.disposed ||
      !this.song ||
      this.songTrackId !== this.value.currentTrack?.id ||
      !Number.isFinite(position)
    )
      return;
    const duration = seconds(this.song.duration) || this.value.duration;
    const target = Math.max(
      0,
      duration > 0 ? Math.min(duration, position) : position,
    );
    if(this.song instanceof NativeAudio&&target+1e-6<this.song.sourceStartTime){
      const track=this.value.currentTrack;
      if(track)void this.play(track.id,undefined,{position:target,paused:this.pausedForRestore()});
      return;
    }
    this.pendingSeek = target;
    if (this.song instanceof NativeAudio || this.song.readyState >= 1) this.applySeek(this.song);
    this.value.currentTime = target;
    this.emit();
  }

  stop(): void {
    if (this.disposed) return;
    ++this.operation;
    this.sonyAbort?.abort();
    this.transport = "idle";
    this.releaseSong();
    this.value.playing = false;
    this.value.loading = false;
    this.value.currentTime = 0;
    this.value.error = null;
    this.value.sonyProcessing = { state: "off", progress: 0 };
    this.value.volumeLocked = false;
    this.emit();
    void this.reconcileBgm();
  }

  setVolume(volume: number): void {
    if (this.disposed || !Number.isFinite(volume) || this.value.volumeLocked || this.song instanceof NativeAudio&&this.song.volumeLocked) return;
    this.value.volume = unit(volume);
    if(this.song instanceof NativeAudio)this.song.preferredVolume=this.value.volume;
    this.setSongGain(this.songGain);
    this.emit();
  }

  async setSonySettings(settings: SonySettings): Promise<void> {
    if (this.disposed) return;
    const next = normalizeSony(settings);
    if (JSON.stringify(next) === JSON.stringify(this.value.sonySettings)) return;
    const restore = { position: this.pendingSeek ?? this.value.currentTime, paused: this.pausedForRestore() };
    this.value.sonySettings = next;
    this.value.sonyProcessing = { state: "off", progress: 0 };
    this.emit();
    if (this.value.currentTrack && this.transport !== "idle") await this.play(this.value.currentTrack.id, undefined, restore);
  }

  setSonyExecution(execution: SonyExecution): void {
    if (this.disposed) return;
    this.value.sonyExecution = { streaming: execution.streaming !== false, parallel: execution.parallel !== false };
    this.emit();
  }
  async setOutputSettings(settings: OutputSettings): Promise<void> {
    ++this.processingOperation;
    const next=normalizeOutput(settings);if(this.disposed||JSON.stringify(next)===JSON.stringify(this.value.outputSettings))return;
    const track=this.value.currentTrack,restore={position:this.pendingSeek??this.value.currentTime,paused:this.pausedForRestore()};
    this.value.outputSettings=next;this.value.backend=next.backend;this.value.volumeLocked=!!track&&directDsd(track,next);
    this.songSettingsKey="";this.value.sonyProcessing={state:'off',progress:0};this.emit();void this.reconcileBgm();
    if(track&&this.transport!=='idle')await this.play(track.id,undefined,restore);
  }

  async setProcessingSettings(settings: ProcessingSettings): Promise<void> {
    const processing=normalizeProcessing(settings,{clamp:false});
    const before=this.value.outputSettings.processing;
    if(this.disposed||JSON.stringify(before)===JSON.stringify(processing)&&(!(this.song instanceof NativeAudio)||this.song.processingSignature===JSON.stringify(processing)))return;
    const reopenKey=(value:ProcessingSettings)=>JSON.stringify([value.resampling,value.outputFormat,value.dither,value.bufferMs,value.bitPerfect]);
    if(reopenKey(before)!==reopenKey(processing)){
      await this.setOutputSettings({...this.value.outputSettings,processing});return;
    }
    const operation=++this.processingOperation,audio=this.song;
    this.value.outputSettings={...this.value.outputSettings,processing};
    this.queuedSignature="";this.value.transitionNote=undefined;this.value.processingPending=false;this.processingRetryable=false;this.emit();
    if(audio instanceof NativeAudio&&this.transport!=='idle'&&!audio.ended){
      try{await audio.applyProcessing(processing);if(operation===this.processingOperation){this.value.error=null;this.value.processingPending=false;this.emit()}}
      catch(error){
        if(operation===this.processingOperation){
          const message=(error as Error).message;
          if(/transition|effects.*progress|effects.*active|processor.*update/i.test(message)){
            this.processingRetryable=true;this.value.processingPending=true;this.emit();return;
          }
          this.value.error=message;this.emit();
        }
        throw error;
      }
    }
  }

  private retryProcessing(audio:NativeAudio):void{
    if(!this.processingRetryable||this.retryingProcessing||this.song!==audio||!this.value.playing||audio.outputStatus?.processingStages?.some(stage=>stage.id==='mix'&&stage.active))return;
    this.retryingProcessing=true;
    void this.setProcessingSettings(this.value.outputSettings.processing).catch(()=>{}).finally(()=>{this.retryingProcessing=false});
  }

  private async tryNativeTransition(track:MusicTrack,queue:readonly MusicTrack[]):Promise<boolean>{
    const audio=this.song;
    if(!(audio instanceof NativeAudio)||audio.paused||audio.ended||audio.volumeLocked||isDsd(track)||sonyEnabled(this.value.sonySettings)||track.id===this.songTrackId||audio.outputStatus?.capabilities?.manualAdvance!==true||this.value.outputSettings.processing.transition.manual==='none')return false;
    const operation=++this.operation,orderRevision=this.playbackOrderRevision;
    try{
      await audio.queueTrack(track);
      if(operation!==this.operation||this.song!==audio||orderRevision!==this.playbackOrderRevision)return true;
      this.value.queue=queue;await audio.advance();
      if(operation===this.operation){this.value.transitionNote=undefined;this.emit()}
      return true;
    }catch(error){
      if(operation!==this.operation||this.song!==audio||orderRevision!==this.playbackOrderRevision)return true;
      this.value.transitionNote=(error as Error).message;
      await audio.clearQueue().catch(()=>{});return false;
    }
  }

  private queueNext(audio:NativeAudio):void{
    if (this.value.playbackOrder === "repeat-track" || this.value.playbackOrder === "random") return;
    const nextIndex = this.nextPlaybackIndex(true);
    const track=this.value.queue[nextIndex],processing=this.value.outputSettings.processing;
    if(!track||audio.volumeLocked||isDsd(track)||sonyEnabled(this.value.sonySettings)||processing.transition.automatic==='none'||audio.outputStatus?.capabilities?.queue!==true)return;
    if (track.id === this.songTrackId) return;
    if(audio.outputStatus.processingStages?.some(stage=>stage.id==='mix'&&stage.active))return;
    const remaining=this.value.duration-this.value.currentTime;
    const window=(processing.transition.preloadMs+(processing.transition.automatic==='crossfade'?processing.transition.crossfadeMs:0))/1000;
    if(remaining>Math.max(2,window))return;
    const signature=JSON.stringify([this.songTrackId,track.id,processing,this.value.playbackOrder,this.value.currentIndex]);
    if(signature===this.queuedSignature)return;this.queuedSignature=signature;
    const orderRevision=this.playbackOrderRevision;
    void audio.queueTrack(track).catch(error=>{if(this.song===audio&&orderRevision===this.playbackOrderRevision){
      const message=(error as Error).message;
      if(/transition|effects.*progress|effects.*active|processor.*update/i.test(message)&&this.queuedSignature===signature)this.queuedSignature="";
      this.value.transitionNote=message;this.emit();
    }});
  }

  private nextPlaybackIndex(naturalEnd: boolean): number {
    const queue = this.value.queue;
    if (!queue.length) return -1;
    const currentIndex = this.value.currentIndex;
    if (naturalEnd && this.value.playbackOrder === "repeat-track") return currentIndex;
    if (this.value.playbackOrder === "random") {
      return Math.floor(Math.random() * queue.length);
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex >= 0 && nextIndex < queue.length) return nextIndex;
    return this.value.playbackOrder === "repeat-queue" ? 0 : -1;
  }

  private cancelQueuedNativeTracks(): void {
    this.queuedSignature = "";
    if (this.song instanceof NativeAudio) void this.song.clearQueue().catch(() => {});
  }

  setSongFadeEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.value.songFadeEnabled = enabled;
    if (!enabled) {
      this.cancelSongFade();
      // A pending switch will release the old song as soon as its fade resolves.
      if (this.songTrackId === this.value.currentTrack?.id) this.setSongGain(1);
    }
    this.emit();
  }

  setBgmVolume(volume: number): void {
    if (this.disposed || !Number.isFinite(volume)) return;
    this.value.bgmVolume = unit(volume);
    this.emit();
    void this.reconcileBgm();
  }

  setBgmEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.value.bgmEnabled = enabled;
    this.value.bgmError = null;
    this.emit();
    void this.reconcileBgm();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.operation;
    this.sonyAbort?.abort();
    ++this.bgmOperation;
    this.cancelFade();
    this.releaseSong();
    this.bgm.pause();
    this.bgm.removeEventListener("error", this.onBgmError);
    this.bgm.removeAttribute("src");
    this.bgm.load();
    document.removeEventListener("pointerdown", this.onGesture, {
      capture: true,
    });
    document.removeEventListener("keydown", this.onGesture, { capture: true });
    this.listeners.clear();
  }

  private createSong(track: MusicTrack, source: string,sourceStart=0,recovered?:NativePlaybackSession): SongAudio {
    const audio: SongAudio = this.value.backend==='browser'?new Audio():new NativeAudio(track,this.value.outputSettings,sourceStart,{sonySettings:this.value.sonySettings,targetVolume:this.value.volume,recovered,knownTracks:this.value.queue});
    this.song = audio;
    this.songTrackId = track.id;
    this.songSettingsKey = JSON.stringify(this.value.sonySettings);
    this.songGain = !recovered&&!(audio instanceof NativeAudio)&&this.value.songFadeEnabled && !this.value.volumeLocked ? 0 : 1;
    audio.preload = "metadata";
    this.setSongGain(this.songGain);
    const active = () =>
      !this.disposed &&
      this.song === audio &&
      this.value.currentTrack?.id === this.songTrackId;
    audio.addEventListener("trackchange",event=>{
      if(this.song!==audio||!(event instanceof CustomEvent))return;
      const next=event.detail as MusicTrack;
      let index=this.value.queue.findIndex(item=>item.id===next.id);
      // A committed crossfade can become audible just as its queued item is removed.
      // Keep the real foreground source visible rather than labelling it as the old song.
      if(index<0){
        const previousId=this.value.currentTrack?.id;
        const queue=[...this.value.queue];index=Math.min(Math.max(0,this.value.currentIndex+1),queue.length);queue.splice(index,0,next);this.value.queue=queue;
        if(this.originalQueue&&!this.originalQueue.some(item=>item.id===next.id)){
          const original=[...this.originalQueue],previousIndex=original.findIndex(item=>item.id===previousId);
          original.splice(previousIndex<0?original.length:previousIndex+1,0,next);this.originalQueue=original;
        }
      }
      this.songTrackId=next.id;this.value.currentTrack=this.value.queue[index];this.value.currentIndex=index;
      this.value.currentTime=seconds(audio.currentTime);this.value.duration=seconds(audio.duration)||seconds(next.duration);
      this.queuedSignature="";this.value.transitionNote=undefined;this.emit();
    });
    audio.addEventListener("loadedmetadata", () => {
      if (!active()) return;
      this.value.duration = seconds(audio.duration) || seconds(track.duration);
      this.applySeek(audio);
      this.emit();
    });
    audio.addEventListener("durationchange", () => {
      if (!active()) return;
      this.value.duration = seconds(audio.duration) || seconds(track.duration);
      this.emit();
    });
    audio.addEventListener("timeupdate", () => {
      if (!active() || this.pendingSeek !== null) return;
      this.value.currentTime = seconds(audio.currentTime);
      if(audio instanceof NativeAudio){this.retryProcessing(audio);if(audio.outputStatus?.queueError)this.value.transitionNote=audio.outputStatus.queueError;this.queueNext(audio)}
      if(audio instanceof NativeAudio&&audio.recovered&&audio.sonyProcessing)this.value.sonyProcessing=audio.sonyProcessing;
      this.emit();
    });
    audio.addEventListener("playing", () => {
      if (!active() || audio.paused) return;
      if (this.transport !== "loading" && this.transport !== "playing") {
        audio.pause();
        return;
      }
      this.transport = "playing";
      this.value.playing = true;
      this.value.loading = false;
      this.emit();
    });
    audio.addEventListener("waiting", () => {
      if (!active() || this.transport !== "playing") return;
      this.value.loading = true;
      this.emit();
    });
    audio.addEventListener("pause", () => {
      if (!active() && this.song === audio && audio.paused) {
        this.cancelSongFade();
        return;
      }
      if (
        !active() ||
        this.transport !== "playing" ||
        audio.ended ||
        !audio.paused
      )
        return;
      ++this.operation;
      this.cancelSongFade();
      this.setSongGain(1);
      this.transport = "paused";
      this.value.playing = false;
      this.value.loading = false;
      this.emit();
    });
    audio.addEventListener("ended", () => {
      if (!active() && this.song === audio && audio.ended) {
        // The outgoing song can finish naturally during its fade-out.
        this.cancelSongFade();
        return;
      }
      if (!active() || this.transport !== "playing") return;
      this.cancelSongFade();
      this.value.playing = false;
      this.value.loading = false;
      this.value.currentTime = this.value.duration;
      const next = this.value.queue[this.nextPlaybackIndex(true)];
      if (next) {
        // No idle intermediate state, so BGM never appears between songs.
        void this.play(next.id);
      } else {
        ++this.operation;
        this.transport = "idle";
        this.emit();
        void this.reconcileBgm();
      }
    });
    audio.addEventListener("error", () => {
      if (active()) this.fail(this.playbackError(track, audio.error));
      else if (this.song === audio) this.cancelSongFade();
    });
    audio.src = source;
    if(recovered&&audio instanceof NativeAudio)audio.monitor();
    return audio;
  }

  private applySeek(audio: SongAudio): void {
    if (this.pendingSeek === null || (!(audio instanceof NativeAudio) && audio.readyState < 1)) return;
    const target = Math.max(
      0,
      seconds(audio.duration) > 0
        ? Math.min(audio.duration, this.pendingSeek)
        : this.pendingSeek,
    );
    try {
      audio.currentTime = target;
      this.pendingSeek = null;
      this.value.currentTime = target;
    } catch {
      // Metadata may still be arriving; retain the user's seek until it is available.
    }
  }

  private releaseSong(): void {
    this.queuedSignature="";
    this.processingRetryable=false;this.value.processingPending=false;
    this.cancelSongFade();
    const old = this.song;
    this.song = undefined;
    this.songTrackId = undefined;
    this.songSonyStartPosition = 0;
    this.songGain = 1;
    this.pendingSeek = null;
    if (!old) return;
    old.pause();
    if (this.browserSpectrum?.audio === old) {
      this.browserSpectrum.source.disconnect();
      void this.browserSpectrum.context.close().catch(() => {});
      this.browserSpectrum = undefined;
      this.browserSpectrumError = "";
    }
    old.removeAttribute("src");
    old.load();
  }

  private setSongGain(gain: number): void {
    this.songGain = unit(gain);
    if (this.song) this.song.volume = unit(this.value.volume * this.songGain);
  }

  private songDirect(audio: SongAudio): boolean { return audio instanceof NativeAudio && audio.volumeLocked; }
  private fadeSong(audio: SongAudio, target: number): Promise<void> {
    this.cancelSongFade();
    if (this.song !== audio) return Promise.resolve();
    const start = this.songGain;
    if (audio.paused || audio.ended || Math.abs(start - target) < 0.001) {
      this.setSongGain(target);
      return Promise.resolve();
    }
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const fade: Fade = {
        timer: 0 as unknown as ReturnType<typeof setTimeout>,
        finish: resolve,
      };
      const step = () => {
        if (this.songFade !== fade) return;
        const progress = Math.min(1, (performance.now() - startedAt) / SONG_FADE_MS);
        this.setSongGain(start + (target - start) * progress);
        if (progress < 1) fade.timer = setTimeout(step, 16);
        else {
          this.songFade = undefined;
          resolve();
        }
      };
      this.songFade = fade;
      step();
    });
  }

  private cancelSongFade(): void {
    if (!this.songFade) return;
    const fade = this.songFade;
    this.songFade = undefined;
    clearTimeout(fade.timer);
    fade.finish();
  }

  private expectsSong(): boolean {
    return this.transport === "loading" || this.transport === "playing";
  }

  private pausedForRestore(): boolean {
    // Replacing a preparation keeps the transport intent from before loading.
    return this.transport === "loading" ? this.preparationPaused : !this.expectsSong();
  }

  private unsupported(track: MusicTrack): string | null {
    if (
      /^(DSD|DSF|DFF)$/i.test(track.format) ||
      /\.(dsf|dff)$/i.test(track.relativePath)
    ) {
      return trUi("当前版本暂不支持 DSF / DFF（DSD）播放，请选择浏览器支持的音频文件。");
    }
    if (!track.browserPlayable)
      return ui`${track.format} 无法在当前浏览器中播放，请选择浏览器支持的音频文件。`;
    return null;
  }

  private playbackError(track: MusicTrack, error: unknown): string {
    if(this.song instanceof NativeAudio)return error instanceof Error?error.message:this.song.error?.message||trUi('原生音频输出失败。');
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError")
      return trUi("浏览器暂未允许播放，请点击播放按钮重试。");
    const media = this.song?.error;
    if (media?.code === 2)
      return trUi("音频读取失败：请检查本地服务和音乐文件是否仍然可用。");
    if (name === "AbortError") return trUi("歌曲播放被中断，请点击播放按钮重试。");
    if (/M4A|ALAC/i.test(`${track.format} ${track.codec ?? ""}`)) {
      return trUi("此 M4A / ALAC 文件未能由当前浏览器解码，或文件已不可用。请检查原文件，或尝试支持该编码的浏览器。");
    }
    if (
      media?.code === 3 ||
      media?.code === 4 ||
      name === "NotSupportedError"
    ) {
      return ui`无法播放此 ${track.format} 文件：当前浏览器不支持它的编码，或文件已损坏、不可读取。`;
    }
    return ui`播放失败，请检查 ${track.format} 文件及本地音乐服务后重试。`;
  }

  private fail(message: string): void {
    ++this.operation;
    this.sonyAbort?.abort();
    this.transport = "error";
    this.releaseSong();
    this.value.playing = false;
    this.value.loading = false;
    this.value.error = message;
    this.emit();
    void this.reconcileBgm();
  }

  private onGesture = (): void => {
    if (this.disposed) return;
    this.gestureReceived = true;
    if (this.browserSpectrum?.context.state === "suspended") void this.browserSpectrum.context.resume().catch(() => {});
    void this.reconcileBgm();
  };

  private onBgmError = (): void => {
    if (this.disposed) return;
    ++this.bgmOperation;
    this.cancelFade();
    this.bgm.pause();
    this.bgm.volume = 0;
    this.bgmTarget = -1;
    this.value.bgmPlaying = false;
    this.value.bgmError = trUi("氛围配乐无法加载，歌曲播放功能仍可使用。");
    this.emit();
  };

  private reconcileBgm(): Promise<void> {
    const idle = this.transport === "idle" || this.transport === "error";
    const target =
      !this.disposed && this.value.backend==='browser' && this.gestureReceived && this.value.bgmEnabled && idle
        ? this.value.bgmVolume
        : 0;
    if (target === this.bgmTarget) return this.bgmTask;
    this.bgmTarget = target;
    const request = ++this.bgmOperation;
    this.cancelFade();
    this.bgmTask = (async () => {
      if (target > 0) {
        try {
          await this.bgm.play();
          if (this.disposed || request !== this.bgmOperation) {
            if (this.disposed || this.bgmTarget <= 0) this.bgm.pause();
            return;
          }
          this.value.bgmError = null;
          this.value.bgmPlaying = true;
          this.emit();
        } catch {
          if (!this.disposed && request === this.bgmOperation) {
            this.bgmTarget = -1;
            this.value.bgmPlaying = false;
            this.value.bgmError =
              trUi("氛围配乐暂未获准播放或无法读取，请再次点击界面重试。");
            this.emit();
          }
          return;
        }
      }
      if (this.disposed || request !== this.bgmOperation) return;
      await this.fadeBgm(target, target > 0 ? 650 : 220);
      if (this.disposed || request !== this.bgmOperation) return;
      if (target === 0) this.bgm.pause();
      this.value.bgmPlaying = target > 0 && !this.bgm.paused;
      this.emit();
    })();
    return this.bgmTask;
  }

  private fadeBgm(target: number, duration: number): Promise<void> {
    this.cancelFade();
    const start = this.bgm.volume;
    if (this.bgm.paused || Math.abs(start - target) < 0.001) {
      this.bgm.volume = target;
      return Promise.resolve();
    }
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const fade: Fade = {
        timer: 0 as unknown as ReturnType<typeof setTimeout>,
        finish: resolve,
      };
      const step = () => {
        if (this.fade !== fade) return;
        const progress = Math.min(
          1,
          (performance.now() - startedAt) / duration,
        );
        this.bgm.volume = unit(start + (target - start) * progress);
        if (progress < 1) fade.timer = setTimeout(step, 24);
        else {
          this.fade = undefined;
          resolve();
        }
      };
      this.fade = fade;
      step();
    });
  }

  private cancelFade(): void {
    if (!this.fade) return;
    const fade = this.fade;
    this.fade = undefined;
    clearTimeout(fade.timer);
    fade.finish();
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error("MusicPlayer state listener failed", error);
      }
    }
  }
}
