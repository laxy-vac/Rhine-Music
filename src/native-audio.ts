import { trUi, ui } from "./i18n.ts";
import type { MusicTrack } from './music-types';
import type { SonySettings, SonyProcessing } from './sony-audio';
import { normalizeProcessing, type ProcessingSettings } from './audio-processing-model.mjs';
const frontendId=crypto.randomUUID();
export interface OutputSettings { backend: 'browser'|'wasapi'|'asio'; device: number; channel: number; dsdMode: 'pcm'|'native'|'dop'; wasapiDevice: string; wasapiMode: 'shared'|'exclusive'; wasapiDsdMode: 'pcm'|'dop'; processing: ProcessingSettings }
export interface NativeStatus { available: boolean; devices: { id: number; name: string }[]; wasapiAvailable?: boolean; wasapiDevices?: {id: string; name: string; isDefault: boolean}[]; wasapiError?: string; error?: string }
export const outputDefault: OutputSettings = { backend:'browser', device:-1, channel:0, dsdMode:'pcm', wasapiDevice:'default', wasapiMode:'shared', wasapiDsdMode:'pcm', processing: normalizeProcessing(undefined) };
export function normalizeOutput(value?: Partial<OutputSettings>): OutputSettings {
 return {backend:['browser','wasapi','asio'].includes(value?.backend??'')?value!.backend!:'browser',
   device:Number.isInteger(value?.device)&&value!.device!>=-1&&value!.device!<=255?value!.device!:-1,
   channel:Number.isInteger(value?.channel)&&value!.channel!>=0&&value!.channel!<=255?value!.channel!:0,
   dsdMode:['pcm','native','dop'].includes(value?.dsdMode??'')?value!.dsdMode!:'pcm',
   wasapiDevice:typeof value?.wasapiDevice==='string'&&value.wasapiDevice.length>0&&value.wasapiDevice.length<=2048&&!/[\0\r\n]/u.test(value.wasapiDevice)?value.wasapiDevice:'default',
   wasapiMode:value?.wasapiMode==='exclusive'?'exclusive':'shared',
   wasapiDsdMode:value?.wasapiDsdMode==='dop'?'dop':'pcm', processing:normalizeProcessing(value?.processing)};
}
export const isDsd = (track: MusicTrack) => /^(DSD|DSF|DFF)$/i.test(track.format)||/\.(dsf|dff)$/i.test(track.relativePath);
export const directDsd = (track: MusicTrack,output: OutputSettings) => isDsd(track)&&(
 output.backend==='asio'&&output.dsdMode!=='pcm'||output.backend==='wasapi'&&output.wasapiDsdMode==='dop');
export interface SongAudio extends EventTarget {
 src: string; preload: string; volume: number; currentTime: number; readonly duration: number;
 readonly paused: boolean; readonly ended: boolean; readonly readyState: number; readonly error: { code: number; message?: string }|null;
 play(): Promise<void>; pause(): void; load(): void; removeAttribute(name: string): void;
}
export interface ProcessingStage {
 id: string; name: string; inputPrecision: string; computePrecision: string; outputPrecision: string;
 active: boolean; reason?: string; sampleRate?: number; engine?: string; soxrQuality?: string; soxrPassband?: number;
 gainDb?: number; frequencyHz?: number; q?: number; source?: string; filters?: ProcessingStage[];
 algorithm?: string; routing?: string; latencyFrames?: number; outputGainDb?: number;
 filter?: string; frequency2?: number; channels?: number; slope?: number;
}
export interface SpectrumSnapshot {
 available: boolean; bands: number[]; sampleRate?: number; updatedAt?: number;
 fftSize?: number; binHz?: number; binsDb?: number[]; peakDb?: number; rmsDb?: number;
 reason?: string; stage?: string;
}
function finiteNumber(value: unknown): number | undefined {
 return typeof value==='number'&&Number.isFinite(value)?value:undefined;
}
function normalizeSpectrum(value: unknown): SpectrumSnapshot | undefined {
 if(!value||typeof value!=='object')return undefined;
 const spectrum=value as Record<string,unknown>;
 if(typeof spectrum.available!=='boolean'||!Array.isArray(spectrum.bands))return undefined;
 const rawBins=spectrum.binsDb;
 const candidateBins=Array.isArray(rawBins)?rawBins.slice(0,16385):undefined;
 const binsDb=candidateBins&&candidateBins.every((bin: unknown)=>typeof bin==='number'&&Number.isFinite(bin))?candidateBins:undefined;
 const sampleRate=finiteNumber(spectrum.sampleRate),fftSizeValue=finiteNumber(spectrum.fftSize),binHz=finiteNumber(spectrum.binHz);
 return {
   available:spectrum.available,
   bands:spectrum.bands.slice(0,64).map((band: unknown)=>{
     const numeric=finiteNumber(band);return numeric===undefined?0:Math.max(0,Math.min(1,numeric));
   }),
   sampleRate:sampleRate!==undefined&&sampleRate>0?sampleRate:undefined,
   updatedAt:finiteNumber(spectrum.updatedAt),
   fftSize:fftSizeValue!==undefined&&Number.isSafeInteger(fftSizeValue)&&fftSizeValue>0&&fftSizeValue<=32768?fftSizeValue:undefined,
   binHz:binHz!==undefined&&binHz>0?binHz:undefined,
   binsDb,
   peakDb:finiteNumber(spectrum.peakDb),
   rmsDb:finiteNumber(spectrum.rmsDb),
   reason:typeof spectrum.reason==='string'?spectrum.reason:undefined,
   stage:typeof spectrum.stage==='string'?spectrum.stage:undefined,
 };
}
export interface NativeOutputSnapshot {
 deviceReleased?: boolean;
 decoderName?: string; decodedSampleFormat?: string; decoderOutputPrecision?: string;
 backend?: 'wasapi'|'asio'; mode?: 'pcm'|'native'|'dop'; sampleRate?: number; sourceSampleRate?: number; dspSampleRate?: number; channels?: number; volumeLocked?: boolean;
 deviceId?: string; deviceName?: string; wasapiMode?: 'shared'|'exclusive'; bitsPerSample?: number; validBitsPerSample?: number; mixSampleRate?: number; mixBitsPerSample?: number;
 sampleFormat?: 'float'|'pcm'; mixSampleFormat?: 'float'|'pcm';
 outputFormat?: string; dither?: 'none'|'rectangular'|'triangular'|'highpass';
  callbackFormat?: string; callbackContainerBits?: number; callbackValidBits?: number; callbackAlignment?: 'left'|'right'|'packed'|'float'|'dsd';
  driverNativeFormat?: string; driverNativeContainerBits?: number; driverNativeValidBits?: number; driverNativeAlignment?: 'left'|'right'|'packed'|'float'|'dsd';
  backendConversion?: boolean; bufferFrames?: number; requestedBufferMs?: number; bufferControl?: 'system'|'driver'|'application'; durationExact?: boolean;
  realtime?: { producerQueueFrames?: number; underflows?: number; callbackFailures?: number };
 dsdRate?: number;
  spectrum?: SpectrumSnapshot;
 processingStages?: ProcessingStage[]; clippingSamples?: number; overRangeSamples?: number; peakAbs?: number; bufferMs?: number; reconfigureMs?: number;
 bitPerfectCheckedSamples?: number; bitPerfectMismatchSamples?: number;
 trackId?: string; transitionSerial?: number; queueTrackId?: string; queueError?: string;
 capabilities?: { processing?: boolean; gapless?: boolean; crossfade?: boolean; queue?: boolean; manualAdvance?: boolean; bitPerfect?: boolean; bitPerfectActive?: boolean };
}
interface NativeState extends NativeOutputSnapshot { deviceReleased?: boolean; playing?: boolean; paused?: boolean; ended?: boolean; buffering?: boolean; position?: number; duration?: number; sourceStart?: number; error?: string; stale?: boolean; sonyProcessing?: SonyProcessing }
export interface NativePlaybackSession {
 session: string; trackId: string; settings: OutputSettings; sonySettings: SonySettings;
 sonyJobId?: string; volume: number; state: NativeState; sonyProcessing: SonyProcessing;
}
export async function recoverNativeSession(): Promise<NativePlaybackSession|null> {
 const response=await fetch('/api/native/current',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:frontendId,clientStartedAt:performance.timeOrigin})});
 const value=await response.json();if(!response.ok)throw new Error(value.error||trUi('无法恢复原生播放会话。'));
 if(!value.session)return null;
 if(!/^[a-f0-9-]{36}$/.test(value.session)||typeof value.trackId!=='string'||!value.state||!['wasapi','asio'].includes(value.settings?.backend))throw new Error(trUi('原生播放会话无效。'));
 return value;
}
export async function discardNativeSession(session: string): Promise<void> {await post('/api/native/control',{session,action:'stop'})}
async function post(route: string,value: unknown,signal?: AbortSignal): Promise<NativeState> {
 const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value as object,clientId:frontendId}),signal});
 const result=await response.json();if(!response.ok)throw new Error(result.error||trUi('原生音频输出失败。'));return result;
}
export function nativeFrontendIdentity(): { clientId: string; clientStartedAt: number } {
 return { clientId: frontendId, clientStartedAt: performance.timeOrigin };
}
const spectrumDemandOwners=new Set<string>();
const nativeAudioInstances=new Set<NativeAudio>();
export function setSpectrumDemand(owner:string,active:boolean): void {
 const key=owner.trim();if(!key)return;
 const hadDemand=spectrumDemandOwners.size>0;
 if(active)spectrumDemandOwners.add(key);else spectrumDemandOwners.delete(key);
 if(hadDemand!==(spectrumDemandOwners.size>0))for(const audio of nativeAudioInstances)audio.spectrumDemandChanged();
}
/** Media lifecycle adapter; all song samples go to the C++ host, never HTMLAudio. */
export class NativeAudio extends EventTarget implements SongAudio {
 src='';preload='metadata';paused=true;ended=false;duration=0;readyState=0;error: {code:number;message:string}|null=null;
 private position=0;private gain=1;private readonly session: string;private readonly abort=new AbortController();
 private opened=false;private disposed=false;private desiredPlaying=false;private opening?: Promise<void>;private playingTask?: Promise<void>;
 private tail: Promise<unknown>=Promise.resolve();private pauseTask?:Promise<void>;private pollTimer?: ReturnType<typeof setTimeout>;private gainTimer?: ReturnType<typeof setTimeout>;private pollInFlight=false;
 private readonly direct: boolean;
 private track: MusicTrack;
 private queuedTracks=new Map<string,MusicTrack>();
 private knownTracks=new Map<string,MusicTrack>();
 private readonly output: OutputSettings;
 private readonly sonySettings?: SonySettings;
 private reportedOutput?: NativeOutputSnapshot;
 preferredVolume: number;
 readonly recovered: boolean;
 sonyProcessing?: SonyProcessing;
 sourceStartTime: number;
 constructor(track: MusicTrack,output: OutputSettings,sourceStartTime=0,options: {sonySettings?:SonySettings;targetVolume?:number;recovered?:NativePlaybackSession;knownTracks?:readonly MusicTrack[]}={}){
   super();this.track=track;this.output=normalizeOutput(output);this.sourceStartTime=sourceStartTime;this.direct=directDsd(track,output);this.sonySettings=options.sonySettings;this.recovered=!!options.recovered;
   this.session=options.recovered?.session??crypto.randomUUID();
   for(const known of options.knownTracks??[track])this.knownTracks.set(known.id,known);
   this.preferredVolume=options.targetVolume??options.recovered?.volume??1;
   if(options.recovered){const value=options.recovered;this.opened=true;this.readyState=1;this.accept(value.state);this.gain=value.volume;this.paused=!value.state.playing;this.ended=value.state.ended===true;this.desiredPlaying=!this.paused;this.sonyProcessing=value.sonyProcessing;}
   nativeAudioInstances.add(this);
 }
 get sessionId(){return this.session}
 get outputStatus(): NativeOutputSnapshot|undefined {return this.opened&&!this.disposed&&this.reportedOutput?{...this.reportedOutput}:undefined}
 get processingSignature(){return JSON.stringify(this.output.processing)}
 private needsProgress(){return this.recovered&&this.sonyProcessing?.streaming===true&&this.sonyProcessing.progress<1}
 spectrumDemandChanged(){
  if(this.disposed||this.error||this.pollInFlight||this.paused&&(this.ended||!this.needsProgress()))return;
  clearTimeout(this.pollTimer);this.pollTimer=undefined;this.poll();
 }
 monitor(){if(!this.paused||this.needsProgress())this.poll()}
 get volumeLocked(){return this.direct||this.reportedOutput?.volumeLocked===true||this.output.processing.bitPerfect}
 get volume(){return this.volumeLocked?1:this.gain}
 set volume(value: number){if(this.volumeLocked||!Number.isFinite(value))return;this.gain=Math.max(0,Math.min(1,value));if(this.opened&&!this.gainTimer&&!this.disposed)this.gainTimer=setTimeout(()=>{this.gainTimer=undefined;void this.control('volume',{volume:this.gain,targetVolume:this.preferredVolume}).catch(error=>this.failure(error))},40)}
 async applyProcessing(value:ProcessingSettings){
  const processing=normalizeProcessing(value,{clamp:false});
  if(this.opening&&!this.opened)await this.opening;
  if(this.opened&&!this.disposed&&!this.direct){const result=await this.control('processing',{processing,replayGain:this.track.replayGain});this.accept(result);this.event('timeupdate')}
  this.output.processing=processing;
 }
 async queueTrack(track:MusicTrack){
  if(!this.opened||this.disposed||this.direct||isDsd(track))throw new Error(trUi('当前播放路线不支持预加载这首歌曲。'));
  this.queuedTracks.set(track.id,track);
  this.knownTracks.set(track.id,track);
  const task=this.tail.catch(()=>{}).then(()=>post('/api/native/queue',{session:this.session,trackId:track.id},this.abort.signal));this.tail=task;
  try{this.accept(await task)}catch(error){this.queuedTracks.delete(track.id);throw error}
 }
 async advance(){this.accept(await this.control('advance'));this.event('timeupdate')}
 async clearQueue(){if(this.opened&&!this.disposed)this.accept(await this.control('clearQueue'));this.queuedTracks.clear()}
 get currentTime(){return this.position}
 set currentTime(value: number){if(!Number.isFinite(value)||value<0)return;this.position=value;if(this.opened&&!this.disposed){this.event('seeking');if(!this.paused)this.event('waiting');void this.control('seek',{position:value}).then(state=>{this.accept(state);this.event('seeked')}).catch(error=>this.failure(error))}}
 private event(name: string){this.dispatchEvent(new Event(name))}
 private control(action: string,extra: object={}): Promise<NativeState> {
   const task=this.tail.catch(()=>{}).then(()=>post('/api/native/control',{session:this.session,action,...extra},this.abort.signal));this.tail=task;return task;
 }
 private accept(value: NativeState){if(this.disposed)return;if(value.stale)throw new Error(trUi('音频输出会话已结束，请重新播放。'));if(value.error)throw new Error(value.error);if(Number.isFinite(value.duration))this.duration=value.duration!;if(Number.isFinite(value.position))this.position=value.position!;if(Number.isFinite(value.sourceStart))this.sourceStartTime=value.sourceStart!;if(value.sonyProcessing)this.sonyProcessing=value.sonyProcessing;
  if(value.backend||value.mode||Number.isFinite(value.sampleRate)||Number.isFinite(value.channels)||typeof value.volumeLocked==='boolean'||
    typeof value.callbackFormat==='string'||Number.isFinite(value.callbackContainerBits)||Number.isFinite(value.callbackValidBits)||typeof value.callbackAlignment==='string'||
    typeof value.driverNativeFormat==='string'||Number.isFinite(value.driverNativeContainerBits)||Number.isFinite(value.driverNativeValidBits)||typeof value.driverNativeAlignment==='string'||
    typeof value.backendConversion==='boolean'||Number.isFinite(value.bufferFrames)||Number.isFinite(value.requestedBufferMs)||typeof value.bufferControl==='string'||typeof value.durationExact==='boolean'||!!value.realtime)this.reportedOutput={
   deviceReleased:typeof value.deviceReleased==='boolean'?value.deviceReleased:this.reportedOutput?.deviceReleased,
   backend:value.backend==='asio'||value.backend==='wasapi'?value.backend:undefined,
   mode:['pcm','native','dop'].includes(value.mode??'')?value.mode:undefined,
   sampleRate:Number.isFinite(value.sampleRate)&&value.sampleRate!>0?value.sampleRate:undefined,
   sourceSampleRate:Number.isFinite(value.sourceSampleRate)&&value.sourceSampleRate!>0?value.sourceSampleRate:undefined,
   decoderName:typeof value.decoderName==='string'?value.decoderName:undefined,
   decodedSampleFormat:typeof value.decodedSampleFormat==='string'?value.decodedSampleFormat:undefined,
   decoderOutputPrecision:typeof value.decoderOutputPrecision==='string'?value.decoderOutputPrecision:undefined,
   dspSampleRate:Number.isFinite(value.dspSampleRate)&&value.dspSampleRate!>0?value.dspSampleRate:undefined,
   channels:Number.isInteger(value.channels)&&value.channels!>0?value.channels:undefined,
   volumeLocked:typeof value.volumeLocked==='boolean'?value.volumeLocked:undefined,
   deviceId:typeof value.deviceId==='string'?value.deviceId:undefined,
   deviceName:typeof value.deviceName==='string'?value.deviceName:undefined,
   wasapiMode:value.wasapiMode==='shared'||value.wasapiMode==='exclusive'?value.wasapiMode:undefined,
   bitsPerSample:Number.isInteger(value.bitsPerSample)&&value.bitsPerSample!>0?value.bitsPerSample:undefined,
   validBitsPerSample:Number.isInteger(value.validBitsPerSample)&&value.validBitsPerSample!>0?value.validBitsPerSample:undefined,
   mixSampleRate:Number.isFinite(value.mixSampleRate)&&value.mixSampleRate!>0?value.mixSampleRate:undefined,
   mixBitsPerSample:Number.isInteger(value.mixBitsPerSample)&&value.mixBitsPerSample!>0?value.mixBitsPerSample:undefined,
   sampleFormat:value.sampleFormat==='float'||value.sampleFormat==='pcm'?value.sampleFormat:undefined,
   mixSampleFormat:value.mixSampleFormat==='float'||value.mixSampleFormat==='pcm'?value.mixSampleFormat:undefined,
   outputFormat:typeof value.outputFormat==='string'?value.outputFormat:undefined,
   dither:['none','rectangular','triangular','highpass'].includes(value.dither??'')?value.dither:undefined,
   callbackFormat:typeof value.callbackFormat==='string'&&value.callbackFormat.trim()?value.callbackFormat.trim():undefined,
   callbackContainerBits:Number.isInteger(value.callbackContainerBits)&&value.callbackContainerBits!>0?value.callbackContainerBits:undefined,
   callbackValidBits:Number.isInteger(value.callbackValidBits)&&value.callbackValidBits!>0?value.callbackValidBits:undefined,
   callbackAlignment:['left','right','packed','float','dsd'].includes(value.callbackAlignment??'')?value.callbackAlignment:undefined,
   driverNativeFormat:typeof value.driverNativeFormat==='string'&&value.driverNativeFormat.trim()?value.driverNativeFormat.trim():undefined,
   driverNativeContainerBits:Number.isInteger(value.driverNativeContainerBits)&&value.driverNativeContainerBits!>0?value.driverNativeContainerBits:undefined,
   driverNativeValidBits:Number.isInteger(value.driverNativeValidBits)&&value.driverNativeValidBits!>0?value.driverNativeValidBits:undefined,
   driverNativeAlignment:['left','right','packed','float','dsd'].includes(value.driverNativeAlignment??'')?value.driverNativeAlignment:undefined,
   backendConversion:typeof value.backendConversion==='boolean'?value.backendConversion:undefined,
   bufferFrames:Number.isSafeInteger(value.bufferFrames)&&value.bufferFrames!>=0?value.bufferFrames:undefined,
   requestedBufferMs:typeof value.requestedBufferMs==='number'&&Number.isFinite(value.requestedBufferMs)&&value.requestedBufferMs!>=0?value.requestedBufferMs:undefined,
   bufferControl:['system','driver','application'].includes(value.bufferControl??'')?value.bufferControl:undefined,
   durationExact:typeof value.durationExact==='boolean'?value.durationExact:undefined,
   realtime:value.realtime&&typeof value.realtime==='object'?{
     producerQueueFrames:Number.isSafeInteger(value.realtime.producerQueueFrames)&&value.realtime.producerQueueFrames!>=0?value.realtime.producerQueueFrames:undefined,
     underflows:Number.isSafeInteger(value.realtime.underflows)&&value.realtime.underflows!>=0?value.realtime.underflows:undefined,
     callbackFailures:Number.isSafeInteger(value.realtime.callbackFailures)&&value.realtime.callbackFailures!>=0?value.realtime.callbackFailures:undefined,
   }:undefined,
   dsdRate:Number.isFinite(value.dsdRate)&&value.dsdRate!>0?value.dsdRate:undefined,
   spectrum:normalizeSpectrum(value.spectrum),
   processingStages:Array.isArray(value.processingStages)?value.processingStages.filter(stage=>stage&&typeof stage.id==='string'&&typeof stage.name==='string').map(stage=>({...stage,active:stage.active===true,inputPrecision:stage.inputPrecision??'unknown',computePrecision:stage.computePrecision??'unknown',outputPrecision:stage.outputPrecision??'unknown'})):undefined,
   clippingSamples:Number.isFinite(value.clippingSamples)?value.clippingSamples:undefined,
   overRangeSamples:Number.isFinite(value.overRangeSamples)?value.overRangeSamples:undefined,
   peakAbs:Number.isFinite(value.peakAbs)?value.peakAbs:undefined,
   bufferMs:Number.isFinite(value.bufferMs)?value.bufferMs:undefined,
   reconfigureMs:Number.isFinite(value.reconfigureMs)?value.reconfigureMs:undefined,
   trackId:typeof value.trackId==='string'?value.trackId:undefined,
   transitionSerial:Number.isInteger(value.transitionSerial)?value.transitionSerial:undefined,
   queueTrackId:typeof value.queueTrackId==='string'?value.queueTrackId:undefined,
   queueError:typeof value.queueError==='string'?value.queueError:undefined,
   capabilities:value.capabilities&&typeof value.capabilities==='object'?{...value.capabilities}:undefined,
   bitPerfectCheckedSamples:Number.isSafeInteger(value.bitPerfectCheckedSamples)&&value.bitPerfectCheckedSamples!>=0?value.bitPerfectCheckedSamples:undefined,
   bitPerfectMismatchSamples:Number.isSafeInteger(value.bitPerfectMismatchSamples)&&value.bitPerfectMismatchSamples!>=0?value.bitPerfectMismatchSamples:undefined,
  };
  if(typeof value.deviceReleased==='boolean') this.reportedOutput={...(this.reportedOutput??{}),deviceReleased:value.deviceReleased};
  if(value.trackId&&value.trackId!==this.track.id){const next=this.queuedTracks.get(value.trackId)??this.knownTracks.get(value.trackId);if(next){this.track=next;this.queuedTracks.delete(next.id);this.sourceStartTime=0;this.dispatchEvent(new CustomEvent('trackchange',{detail:next}))}}
 }
 private async initialize(){
   if(this.opened)return;if(this.opening)return this.opening;
   this.opening=(async()=>{
     const job=/^\/api\/sony\/audio\/([a-f0-9]{64})$/.exec(this.src)?.[1];
     const state=await post('/api/native/start',{session:this.session,trackId:this.track.id,settings:this.output,volume:this.volumeLocked?1:this.gain,targetVolume:this.preferredVolume,position:this.position,sonySettings:this.sonySettings,...(job?{sonyJobId:job}:{})},this.abort.signal);
     if(this.disposed)return;this.accept(state);this.opened=true;this.readyState=1;this.event('loadedmetadata');this.event('durationchange');
   })();return this.opening;
 }
 async play(): Promise<void>{
   if(this.disposed)throw new Error(trUi('歌曲已经停止。'));this.desiredPlaying=true;this.pauseTask=undefined;if(this.playingTask)return this.playingTask;
   this.playingTask=(async()=>{
    await this.initialize();
    while(!this.disposed){const desired=this.desiredPlaying,state=await this.control(desired?'play':'pause');if(this.disposed)return;this.accept(state);if(desired!==this.desiredPlaying)continue;this.paused=!desired;if(desired){this.ended=false;this.event('playing');this.poll()}return}
   })().finally(()=>{this.playingTask=undefined});
   return this.playingTask;
 }
 pause(): void {
   if(this.disposed)return;
   if(this.error){this.desiredPlaying=false;this.paused=true;return}
   if(!this.desiredPlaying&&this.paused&&this.pauseTask){this.event('pause');return}
   this.desiredPlaying=false;this.paused=true;clearTimeout(this.pollTimer);this.pollTimer=undefined;
   this.pauseTask=this.opened&&!this.disposed
     ? this.control('pause').then(state=>{if(!this.disposed&&!this.desiredPlaying){this.accept(state);this.event('timeupdate');this.monitor()}}).catch(error=>{this.failure(error)})
     : Promise.resolve();
   this.event('pause');
 }
 async whenPaused(): Promise<void> {
   const pending=[this.opening,this.playingTask,this.pauseTask].filter((task):task is Promise<void>=>!!task);
   await Promise.all(pending);
   if(this.error)throw new Error(this.error.message||trUi('原生输出失败。'));
 }
 removeAttribute(name: string): void {if(name==='src')this.src=''}
 load(): void {if(this.disposed)return;this.disposed=true;this.desiredPlaying=false;this.abort.abort();clearTimeout(this.pollTimer);clearTimeout(this.gainTimer);this.paused=true;this.readyState=0;
   nativeAudioInstances.delete(this);
   void post('/api/native/control',{session:this.session,action:'stop'}).catch(()=>{});
 }
 private poll(){
   clearTimeout(this.pollTimer);if(this.disposed||this.error||this.paused&&(this.ended||!this.needsProgress())||this.pollInFlight)return;
   const interval=spectrumDemandOwners.size?100:250;
   this.pollTimer=setTimeout(()=>{
    this.pollTimer=undefined;if(this.disposed||this.error||this.paused&&(this.ended||!this.needsProgress()))return;
    this.pollInFlight=true;
    void this.control('status').then(state=>{
      if(this.disposed)return;
      if(this.paused){if(this.needsProgress()){this.accept({...state,position:undefined});this.event('timeupdate')}return}
      this.accept(state);this.event('timeupdate');if(state.buffering)this.event('waiting');else if(!state.ended)this.event('playing');
      if(state.ended){this.ended=true;this.paused=true;this.desiredPlaying=false;this.event('ended')}
    }).catch(error=>this.failure(error)).finally(()=>{
      this.pollInFlight=false;
      if(!this.disposed&&!this.error&&(!this.paused||!this.ended&&this.needsProgress()))this.poll();
    });
   },interval);
 }
 private failure(error: unknown){if(this.disposed)return;this.error={code:4,message:error instanceof Error?error.message:trUi('原生输出失败。')};this.paused=true;this.desiredPlaying=false;clearTimeout(this.pollTimer);void post('/api/native/control',{session:this.session,action:'stop'}).catch(()=>{});this.event('error')}
}
