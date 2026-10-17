import path from 'node:path'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { boundedSource,sonySettings } from './sony-walkman.mjs'
import { effectivePcmProcessing,normalizeProcessing } from '../src/audio-processing-model.mjs'
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const fail=(message,status=400)=>Object.assign(new Error(message),{status})
const token=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)
const lspDesignKey=eq=>JSON.stringify(Object.entries(eq?.lsp??{}).filter(([key])=>key!=='pluginState'))
async function projectLocalDirectory(storageRoot,targetDirectory) {
 const base=await fs.realpath(storageRoot),target=path.resolve(targetDirectory),relative=path.relative(base,target)
 if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw fail('LSP 用户数据目录必须位于项目内')
 let current=base
 for(const segment of relative.split(path.sep)) {
  current=path.join(current,segment)
  try {
   const stat=await fs.lstat(current)
   if(stat.isSymbolicLink()||!stat.isDirectory())throw fail('LSP 用户数据路径不能包含链接或非目录文件')
  }catch(error){
   if(error.code!=='ENOENT')throw error
   try{await fs.mkdir(current)}catch(createError){if(createError.code!=='EEXIST')throw createError}
   const stat=await fs.lstat(current)
   if(stat.isSymbolicLink()||!stat.isDirectory())throw fail('LSP 用户数据路径不能包含链接或非目录文件')
  }
 }
 const actual=await fs.realpath(target),actualRelative=path.relative(base,actual)
 if(actualRelative==='..'||actualRelative.startsWith(`..${path.sep}`)||path.isAbsolute(actualRelative))throw fail('LSP 用户数据目录必须位于项目内')
 return actual
}
function lspEq(value) {
 try {
  const {eq}=normalizeProcessing({eq:value??{engine:'lsp'}},{clamp:false})
  if(eq.engine!=='lsp')throw fail('此接口仅用于 LSP 均衡器')
  return eq
 }catch(error){throw fail(error.message)}
}
export function outputSettings(value) {
 if(!value||!['wasapi','asio'].includes(value.backend)||!Number.isInteger(value.device)||value.device< -1||value.device>255||
   !Number.isInteger(value.channel)||value.channel<0||value.channel>255||!['pcm','native','dop'].includes(value.dsdMode))throw fail('无效的原生输出设置')
 if(value.backend==='asio'&&value.device<0)throw fail('请先选择已安装的 ASIO 驱动')
 const wasapiDevice=value.wasapiDevice===undefined?'default':value.wasapiDevice
 const wasapiMode=value.wasapiMode===undefined?'shared':value.wasapiMode
 const wasapiDsdMode=value.wasapiDsdMode===undefined?'pcm':value.wasapiDsdMode
 if(typeof wasapiDevice!=='string'||wasapiDevice.length<1||wasapiDevice.length>2048||/[\0\r\n]/.test(wasapiDevice)||!['shared','exclusive'].includes(wasapiMode))throw fail('无效的 WASAPI 输出设置')
 if(!['pcm','dop'].includes(wasapiDsdMode))throw fail('无效的 WASAPI DSD 播放方式')
 let processing;try{processing=normalizeProcessing(value.processing,{clamp:false})}catch(error){throw fail(error.message)}
 return {backend:value.backend,device:value.device,channel:value.channel,dsdMode:value.dsdMode,wasapiDevice,wasapiMode,wasapiDsdMode,processing}
}
export class NativeOutput {
 constructor({store,ftp,sony,lspUserDataDir=path.join(project,'.tools/lsp-plugin/user-data'),lspStorageRoot=project,executable=process.env.RHINE_NATIVE_AUDIO??path.join(project,'vendor/audio/windows-x64/rhine-audio-host.exe')}={}) {
   this.store=store;this.ftp=ftp;this.sony=sony;this.executable=path.resolve(executable);this.pending=new Map();this.counter=0;this.generation=0;this.tail=Promise.resolve();this.startTail=Promise.resolve();this.closed=false;this.musicOperations=0;this.beforeMusicOutput=undefined
   this.cancelledSessions=new Set()
   this.queueTracks=new Map()
    this.eqEditorSettings=undefined;this.eqEditorBinding=undefined
    this.lspUserDataDir=path.resolve(lspUserDataDir);this.lspStorageRoot=path.resolve(lspStorageRoot)
 }
 interfaceIdle(){return !this.closed&&this.musicOperations===0&&(!this.active||this.active.released===true)}
 async verify() {
   if(process.platform!=='win32')throw fail('ASIO / Windows 原生输出仅用于 Windows 桌面版',503)
   const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(this.executable),'assets.json'),'utf8'))
   if(manifest.kind==='rhine-source-preview-native-audio'&&!Object.hasOwn(manifest.files??{},'lsp-para-equalizer.clap'))throw fail('原生音频组件需要重新构建，请运行构建源码验证。',503)
   for(const [name,expected] of Object.entries(manifest.files)) {
     if(!/^[a-z0-9.-]+$/i.test(name))throw fail('原生组件清单无效',503)
     if(createHash('sha256').update(await fs.readFile(path.join(path.dirname(this.executable),name))).digest('hex')!==expected)throw fail(`原生音频组件校验失败：${name}`,503)
   }
 }
 async connect() {
   if(this.closed)throw fail('播放器正在退出',503)
   if(this.child)return
   if(this.connecting)return this.connecting
   this.connecting=(async()=>{
     await this.verify();if(this.closed)throw fail('播放器正在退出',503)
      const localAppData=await projectLocalDirectory(this.lspStorageRoot,this.lspUserDataDir)
      if(this.closed)throw fail('播放器正在退出',503)
      const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='localappdata'))
      env.LOCALAPPDATA=localAppData
      const child=this.child=spawn(this.executable,[],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env})
     let buffer='';const decoder=new StringDecoder('utf8');child.stderr.on('data',()=>{})
     child.stdout.on('data',chunk=>{
       buffer+=decoder.write(chunk);if(buffer.length>1_200_000){child.kill();return}
       let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value;try{value=JSON.parse(line)}catch{child.kill();return}
         if(value.fatal){child.kill();continue}
         const pending=this.pending.get(value.id);if(!pending)continue;this.pending.delete(value.id);clearTimeout(pending.timer)
         value.ok?pending.resolve(value):pending.reject(fail(value.error||'原生输出失败',503))
       }
     })
     const disconnected=()=>{if(this.child!==child)return;this.child=undefined;this.releaseLease();for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(fail('原生音频进程已退出，请重新选择输出设备',503))}this.pending.clear()}
     child.once('error',disconnected);child.once('close',disconnected)
   })().finally(()=>{this.connecting=undefined})
   return this.connecting
 }
 command(value) {
   const task=this.tail.catch(()=>{}).then(async()=>{
     await this.connect();const child=this.child,id=++this.counter
     return new Promise((resolve,reject)=>{
       const timer=setTimeout(()=>{this.pending.delete(id);child.kill();reject(fail('音频驱动响应超时，已停止原生输出',503))},20_000)
       this.pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({...value,id})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(fail('原生音频进程无法接收请求',503))}})
     })
   });this.tail=task;return task
 }
 async status() {
   try {
     const result=await this.command({cmd:'devices'}),devicesASIO=Array.isArray(result.devicesASIO)?result.devicesASIO:Array.isArray(result.devices)?result.devices:[],wasapiDevices=Array.isArray(result.wasapiDevices)?result.wasapiDevices:[]
     const wasapiAvailable=typeof result.wasapiAvailable==='boolean'?result.wasapiAvailable:wasapiDevices.length>0
     return {available:true,devices:devicesASIO,devicesASIO,wasapiAvailable,wasapiDevices,...(typeof result.wasapiError==='string'?{wasapiError:result.wasapiError}:{}),backends:[...(wasapiAvailable?['wasapi']:[]),...(devicesASIO.length?['asio']:[])],dsdModes:['pcm','native','dop']}
   }
   catch(error){return {available:false,devices:[],devicesASIO:[],wasapiAvailable:false,wasapiDevices:[],backends:[],dsdModes:['pcm','native','dop'],error:error.message}}
 }
 async refresh() {
   this.musicOperations++
   try {
     await this.beforeMusicOutput?.()
     await this.stopCurrent();const child=this.child;
     if(child)await new Promise(resolve=>{const timer=setTimeout(()=>child.kill(),2000);child.once('close',()=>{clearTimeout(timer);resolve()});child.stdin.end()});
     return await this.status()
   }finally{this.musicOperations=Math.max(0,this.musicOperations-1)}
 }
 async previewEq(value) {
   throw fail('LSP 频响预览请使用原生面板',409);
 }
  async eqEditor(value={},internalRelease=false) {
    const pendingRelease=this.active?.releasePromise
    if(pendingRelease&&!internalRelease)await pendingRelease.catch(()=>{})
    const active=this.active
    if(!value||typeof value!=='object'||Array.isArray(value))throw fail('LSP 面板请求无效')
    const action=value.action??'state'
    if(!['open','close','state'].includes(action))throw fail('无效的 LSP 面板操作')
    const previousEditorState=this.eqEditorSettings?.lsp?.pluginState
    const activeLsp=!!active&&!active.released&&active.lspEditorEligible===true&&!active.settings?.processing?.bitPerfect&&active.settings?.processing?.eq?.engine==='lsp'
    const releasedLsp=!!active&&active.released===true&&active.lspEditorEligible===true&&!active.settings?.processing?.bitPerfect&&active.settings?.processing?.eq?.engine==='lsp'
    let eq
    try{eq=lspEq(value.eq??(activeLsp||releasedLsp?active.settings.processing.eq:this.eqEditorSettings))}catch(error){throw fail(error.message)}
    if(value.ifRevision!==undefined&&(!Number.isSafeInteger(value.ifRevision)||value.ifRevision<0))throw fail('LSP 面板版本号无效')

    let session
    if(action==='open')session=activeLsp?active.session:undefined
    else if(this.eqEditorBinding!==undefined) {
      if(this.eqEditorBinding===null)session=activeLsp?active.session:undefined
      else if(active?.session===this.eqEditorBinding)session=this.eqEditorBinding
      else this.eqEditorBinding=undefined
    }
    if(session===undefined&&this.eqEditorBinding===undefined&&action!=='close'&&activeLsp)session=active.session

    let result
    try{result=await this.command({cmd:'eq_editor',action,eq,...(session?{session}:{})})}
    catch(error){throw fail(error.message,503)}
    if(result.queueCleared){this.queued=undefined;this.queueTracks.clear()}
    if(typeof result?.editorOpen!=='boolean'||typeof result.active!=='boolean'||!Number.isSafeInteger(result.latencyFrames)||result.latencyFrames<0||!Number.isSafeInteger(result.revision)||result.revision<0)throw fail('原生 LSP 面板状态无效',503)
    let updatedEq
    try{updatedEq=lspEq({...eq,lsp:{...eq.lsp,pluginState:result.pluginState}})}catch(error){throw fail(`原生 LSP 面板状态无效：${error.message}`,503)}
    this.eqEditorSettings=updatedEq
    if(session&&this.active?.session===session) {
      const processing=this.active.settings.processing
      this.active.settings={...this.active.settings,processing:{...processing,eq:{...processing.eq,lsp:{...processing.eq.lsp,pluginState:updatedEq.lsp.pluginState}}}}
      this.active.lspEditorWasOpen=result.editorOpen
    }else if(releasedLsp&&this.active===active) {
      const processing=active.settings.processing
      active.settings={...active.settings,processing:{...processing,eq:{...processing.eq,lsp:{...processing.eq.lsp,pluginState:updatedEq.lsp.pluginState}}}}
      active.lspEditorWasOpen=result.editorOpen
    }
    if(result.editorOpen)this.eqEditorBinding=session??null
    else this.eqEditorBinding=undefined
    if(value.ifRevision!==undefined&&value.ifRevision===result.revision&&previousEditorState===updatedEq.lsp.pluginState)return {editorOpen:result.editorOpen,latencyFrames:result.latencyFrames,active:result.active,revision:result.revision,unchanged:true}
    return {editorOpen:result.editorOpen,pluginState:updatedEq.lsp.pluginState,latencyFrames:result.latencyFrames,active:result.active,revision:result.revision}
  }
  async closeEqEditorForSession(active,internalRelease=false,strict=false) {
    if(!active||this.eqEditorBinding!==active.session)return
    try{await this.eqEditor({action:'close',eq:active.settings.processing.eq},internalRelease)}catch(error){if(strict)throw error}
  }
 processing() {
   const job=this.lease;if(!job)return {state:'off',progress:0};
   const view=this.sony.view(job),enabled=job.settings.dsee||job.settings.dc||job.settings.vinyl;
   return {state:view.state==='error'?'error':enabled?'active':'off',progress:view.progress??0,
     effectiveSettings:{...job.settings},bypassed:view.bypassed,message:view.message,sampleRate:view.sampleRate,inputSampleRate:view.inputSampleRate,sourceDecoder:view.sourceDecoder,
     streaming:view.streaming===true,bufferedSeconds:view.bufferedSeconds,positionOffset:view.positionOffset,workers:view.workers};
 }
 trackMetadata(id){return this.store?.index?.albums?.flatMap(album=>album.tracks??[]).find(track=>track.id===id)??this.ftp?.track?.(id)??{}}
 acceptTransition(value){
   const active=this.active;
   if(active&&value.session===active.session&&value.trackId&&value.trackId!==active.trackId&&this.queueTracks.has(value.trackId)){
     active.trackId=value.trackId;active.transitionSerial=value.transitionSerial;this.queueTracks.delete(value.trackId);
     if(this.queued?.trackId===value.trackId)this.queued=undefined;
   }
   return value;
 }
 async current(value) {
   if(!token(value?.clientId))throw fail('无效的前端播放会话');
   if(value.clientStartedAt!==undefined&&(!Number.isFinite(value.clientStartedAt)||value.clientStartedAt<0))throw fail('无效的前端时间标识');
   const epoch=value.clientStartedAt??Date.now();
   if(this.frontendEpoch!==undefined&&epoch<this.frontendEpoch)return {session:null,stale:true};
   // A new document adopts the existing stream. Older documents cannot later
   // reopen a track or stop the stream that has just been adopted.
   this.frontendOwner=value.clientId;this.frontendEpoch=epoch;
   if(this.reserved&&this.reserved!==this.active?.session){++this.generation;this.reserved=this.active?.session;await this.startTail.catch(()=>{})}
   let active=this.active;
   if(!active){for(const job of this.sony?.jobs?.values()??[])if(!job.readers&&['queued','processing'].includes(job.state))this.sony.cancel(job.id);return {session:null}}
   if(active.releasePromise)await active.releasePromise
   if(this.active!==active)return {session:null}
   if(active.released)return this.currentFromReleased(active)
   if(this.lease?.state==='error') {
     const state={...(active.lastState??{}),session:active.session,trackId:active.trackId,playing:false,paused:true,error:'Sony 处理已失败，原生播放已停止。'}
     const released=await this.releaseActiveOutput(active,state)
     this.releaseLease()
     return this.currentFromReleased(active,released)
   }
   try {
     const state=this.timeline(await this.command({cmd:'status',session:active.session}));
     if(active.releasePromise) {
       await active.releasePromise
       return this.active===active?this.currentFromReleased(active):{session:null}
     }
     if(this.active!==active||active.generation!==this.generation||this.frontendOwner!==value.clientId)return {session:null};
     if(state.stale){this.active=undefined;this.releaseLease();return {session:null}}
     active.lastState=state;active.position=state.position??active.position
     if(state.ended||state.error) {
       const released=await this.releaseActiveOutput(active,state)
       return this.currentFromReleased(active,released)
     }
     return {session:active.session,trackId:active.trackId,settings:{...active.settings},sonySettings:{...active.sonySettings},
       sonyJobId:active.sonyJobId,volume:active.targetVolume,sonyProcessing:this.processing(),
       state:{...state,playing:active.desiredPlaying&&!state.ended,paused:!active.desiredPlaying||!!state.ended,...(active.seeking?{buffering:true}:{})}};
   }catch(error){if(this.active===active&&this.frontendOwner===value.clientId)await this.stopCurrent().catch(()=>{});throw error}
 }
 currentFromReleased(active,releasedState=active?.releasedState) {
   if(!active||this.active!==active||!releasedState)return {session:null}
   releasedState=this.refreshReleasedState(active,releasedState)
   return {session:active.session,trackId:active.trackId,settings:{...active.settings},sonySettings:{...active.sonySettings},
     sonyJobId:active.sonyJobId,volume:active.targetVolume,sonyProcessing:releasedState.sonyProcessing??this.processing(),
     state:{...releasedState,playing:false,paused:true,deviceReleased:true}}
 }
 refreshReleasedState(active,releasedState=active?.releasedState) {
   if(!active||!releasedState)return releasedState
   const state={...releasedState,playing:false,paused:true,deviceReleased:true}
   if(this.lease&&active.sonyJobId===this.lease.id) {
     const sonyProcessing=this.processing();state.sonyProcessing=sonyProcessing
     if(sonyProcessing.state==='error'&&!state.error) {
       state.error=sonyProcessing.message||'Sony 实时处理失败，原生播放已停止。'
       this.releaseLease()
     }
   }
   active.releasedState=state;active.lastState=state
   return state
 }
 releaseLease(keep) {if(this.lease){const old=this.lease;old.readers=Math.max(0,(old.readers??1)-1);this.lease=undefined;if(old!==keep&&!old.readers&&old.state==='processing')this.sony?.cancel?.(old.id)}}
 timeline(value,lease=this.lease) {
   this.acceptTransition(value);
   if(!lease)return value;
   const metadata=lease.result??lease.stream;if(!metadata)return value;
   const offset=metadata.positionOffset??0,duration=metadata.duration+offset;
   return {...value,duration,sourceStart:offset,...(Number.isFinite(value.position)?{position:Math.min(duration,value.position+offset)}:{})};
 }
 async releaseActiveOutput(active,state,{pause=false}={}) {
   if(!active||this.active!==active)return {stale:true}
   if(active.released)return active.releasedState
   if(active.releasePromise)return active.releasePromise
   this.musicOperations++
   const release=(async()=>{
     active.releasing=true
     const editorWasOpen=active.lspEditorEligible&&active.settings?.processing?.eq?.engine==='lsp'&&
       (active.lspEditorWasOpen===true||this.eqEditorBinding===active.session)
     // Callers pass timeline-normalized states; only the raw pause ACK needs
     // conversion below. Reapplying timeline() here would double Sony offsets.
     let finalState=state??active.lastState??{
       session:active.session,trackId:active.trackId,position:active.position??0,playing:active.desiredPlaying,
       paused:!active.desiredPlaying,ended:false,
     }
     let pauseError
     if(pause) {
       try{finalState=this.timeline(await this.command({cmd:'pause',session:active.session}))}
       catch(error){pauseError=error;finalState={...finalState,error:error.message}}
     }
     let lspEditorError
     if(editorWasOpen) {
       try{await this.closeEqEditorForSession(active,true,true)}catch(error){lspEditorError=`LSP editor state could not be saved before releasing audio: ${error.message}`}
     }
     if(this.child)await this.command({cmd:'stop',session:active.session})
     if(this.active!==active)return {stale:true}
     active.desiredPlaying=false
     active.position=Number.isFinite(finalState.position)?finalState.position:(active.position??0)
     active.released=true
     active.releasedState={...finalState,session:active.session,trackId:active.trackId,playing:false,paused:true,
       ended:finalState.ended===true,deviceReleased:true,sonyProcessing:finalState.sonyProcessing??this.processing(),
       ...(pauseError?{error:pauseError.message}:{})}
     active.lastState=active.releasedState
     this.queued=undefined;this.queueTracks.clear()
     if(editorWasOpen) {
       try{await this.eqEditor({action:'open',eq:active.settings.processing.eq},true)}
       catch(error){active.lspEditorRestoreError=error.message;active.releasedState.lspEditorError=error.message}
     }
     if(lspEditorError)active.releasedState.lspEditorError=lspEditorError
     if(pauseError)throw pauseError
     return active.releasedState
   })()
   active.releasePromise=release
   try{return await release}
   finally{if(active.releasePromise===release)active.releasePromise=undefined;active.releasing=false;this.musicOperations=Math.max(0,this.musicOperations-1)}
 }
 async stopCurrent() {
   ++this.generation;this.reserved=undefined;this.queued=undefined;this.queueTracks.clear()
   await this.startTail.catch(()=>{})
    let current=this.active
    if(current?.releasePromise)await current.releasePromise.catch(()=>{})
    current=this.active
    await this.closeEqEditorForSession(current)
   let released=!current||current.released||!this.child
   try{
     if(current&&!current.released&&this.child){await this.command({cmd:'stop',session:current.session});released=true}
   }finally{
     if(released&&this.active===current)this.active=undefined
     this.releaseLease()
   }
   return {stopped:true}
 }
 async resumeReleased(active,value) {
   this.musicOperations++
   try {
     if(active.releasePromise)await active.releasePromise
     if(this.active!==active||this.cancelledSessions.has(active.session)||this.closed)return {stale:true}
     const state=this.refreshReleasedState(active,active.releasedState??active.lastState??{})
     if(state.error)throw fail(state.error,503)
     const position=state.ended?(Number.isFinite(state.sourceStart)?state.sourceStart:0):(Number.isFinite(active.position)?active.position:(Number.isFinite(state.position)?state.position:0))
     await this.start({
       session:active.session,
       clientId:value.clientId,
       trackId:active.trackId,
       settings:active.settings,
       sonySettings:active.sonySettings,
       sonyJobId:active.sonyJobId,
       volume:active.volume,
       targetVolume:active.targetVolume,
       position,
     })
     if(this.active?.session!==active.session||this.cancelledSessions.has(active.session)||this.closed)return {stale:true}
     return await this.control({...value,action:'play'})
   }finally{this.musicOperations=Math.max(0,this.musicOperations-1)}
 }
 async start(value) {
   this.musicOperations++
   try{return await this.startInternal(value)}finally{this.musicOperations=Math.max(0,this.musicOperations-1)}
 }
 async startInternal(value) {
   if(this.frontendOwner&&value.clientId!==this.frontendOwner)throw fail('前端已经刷新，此播放请求已取消',409)
   const settings=outputSettings(value.settings)
    let effectiveProcessing=effectivePcmProcessing(settings.processing)
   const requestedSony=value.sonySettings===undefined?{dsee:false,dc:0,vinyl:0}:sonySettings(value.sonySettings)
   if(!token(value.session)||typeof value.trackId!=='string'||!/^[-a-zA-Z0-9]+$/.test(value.trackId))throw fail('无效的原生播放请求')
   if(this.cancelledSessions.has(value.session))throw fail('此播放请求已取消',409)
   if(!Number.isFinite(value.volume)||value.volume<0||value.volume>1||!Number.isFinite(value.position)||value.position<0)throw fail('无效的音量或播放位置')
   if(value.targetVolume!==undefined&&(!Number.isFinite(value.targetVolume)||value.targetVolume<0||value.targetVolume>1))throw fail('无效的歌曲音量')
   if(value.sonyJobId!==undefined&&!/^[a-f0-9]{64}$/.test(value.sonyJobId))throw fail('无效的音效缓存 ID')
   if(settings.processing.bitPerfect&&value.sonyJobId)throw fail('PCM 比特一致性不能使用 Sony 音效缓存，请从原曲重新播放')
   const generation=++this.generation;this.reserved=value.session
   let descriptor,lease,growingBytes
   if(value.trackId.startsWith('ftp-'))await this.ftp.ensure(value.trackId)
   const originalDescriptor=this.store?.trackFile?.(value.trackId)??this.ftp?.trackFile?.(value.trackId)
   const originalDsd=/\.(dsf|dff)$/i.test(originalDescriptor?.path??'')
   if(settings.processing.bitPerfect&&originalDsd) {
     if(this.generation===generation)this.reserved=this.active?.session
     throw fail('PCM 比特一致性不适用于 DSD 原曲，请切换到 PCM 播放或选择 PCM 曲目')
   }
   const directRoute=settings.backend==='asio'?settings.dsdMode!=='pcm':settings.wasapiDsdMode==='dop'
   if(originalDsd&&directRoute&&value.sonyJobId)throw fail('DSD 直出不能使用 PCM 音效缓存，请重新准备 DSD 音源')
   if(originalDsd&&settings.backend==='wasapi'&&settings.wasapiDsdMode==='dop'&&settings.wasapiMode!=='exclusive')throw fail('WASAPI DoP 需要独占模式，请在 DSD 播放设置中开启独占')
   if(value.sonyJobId) {
     const job=this.sony.jobs.get(value.sonyJobId)
     if(!job||job.trackId!==value.trackId)throw fail('音效缓存与所选歌曲不一致',403)
     if(job.state==='processing'){await this.sony.growingAudio(value.sonyJobId);descriptor={path:job.output+'.partial',allowedRoot:this.sony.cacheDir};growingBytes=job.stream.totalBytes}
     else descriptor=await this.sony.audio(value.sonyJobId);lease=job
   }else descriptor=originalDescriptor
   if(!descriptor)throw fail('原生输出用于本地与 FTP 曲目，请选择曲库中的歌曲',404)
   let source;
   try{({source}=await boundedSource(descriptor))}catch(error){if(lease?.state==='ready'&&growingBytes){({source}=await boundedSource(await this.sony.audio(value.sonyJobId)));growingBytes=undefined}else throw error}
   if(generation!==this.generation||this.closed)throw fail('此播放请求已取消',409)
   const dsd=/\.(dsf|dff)$/i.test(source),mode=dsd?(settings.backend==='asio'?settings.dsdMode:settings.wasapiDsdMode):'pcm'
   if(settings.processing.bitPerfect&&dsd) {
     if(this.generation===generation)this.reserved=this.active?.session
     throw fail('PCM 比特一致性不适用于 DSD 原曲，请切换到 PCM 播放或选择 PCM 曲目')
   }
   if(dsd&&settings.backend==='wasapi'&&mode==='dop'&&settings.wasapiMode!=='exclusive')throw fail('WASAPI DoP 需要独占模式，不会自动转为 PCM')
   const commit=this.startTail.catch(()=>{}).then(async()=>{
    if(generation!==this.generation||this.closed)throw fail('此播放请求已取消',409)
    const offset=lease?.result?.positionOffset??lease?.stream?.positionOffset??0;
    if(value.position+1e-6<offset)throw fail('此位置早于当前音效片段，请重新准备所选位置',409);
    const position=Math.max(0,value.position-offset);
    if(lease?.state==='processing'&&position>0){const target=Math.min(lease.stream.duration,position+.5)*lease.stream.sampleRate*8+56;while(lease.state==='processing'&&lease.producedBytes<target){if(generation!==this.generation||this.closed)throw fail('此播放请求已取消',409);await new Promise(resolve=>setTimeout(resolve,100))}if(lease.state==='error')throw fail(lease.error||'Sony 处理失败',503)}
     let previousActive=this.active
     if(previousActive?.releasePromise)await previousActive.releasePromise
     if(generation!==this.generation||this.closed)throw fail('此播放请求已取消',409)
     previousActive=this.active
     const restoreLspWindow=previousActive?.released===true&&previousActive.lspEditorWasOpen===true
     const idleLspEditorOpen=restoreLspWindow&&this.eqEditorBinding===null
     const previousEq=previousActive?.settings?.processing?.eq
     const previousPluginState=previousEq?.engine==='lsp'?previousEq.lsp.pluginState:undefined
     const previousDesign=previousEq?.engine==='lsp'?lspDesignKey(previousEq):undefined
     await this.closeEqEditorForSession(previousActive)
     const requestedEq=settings.processing.eq
     const updatedPreviousEq=previousActive?.settings?.processing?.eq
     if(previousActive?.lspEditorEligible===true&&previousEq?.engine==='lsp'&&requestedEq.engine==='lsp'&&
       this.eqEditorBinding===undefined&&requestedEq.lsp.pluginState===previousPluginState&&lspDesignKey(requestedEq)===previousDesign) {
       settings.processing={...settings.processing,eq:{...requestedEq,lsp:{...requestedEq.lsp,pluginState:updatedPreviousEq?.lsp?.pluginState??previousEq.lsp.pluginState}}}
       effectiveProcessing=effectivePcmProcessing(settings.processing)
     }
    this.releaseLease(lease);this.active=undefined
    if(lease){lease.readers=(lease.readers??0)+1;this.lease=lease}
    try {
     await this.beforeMusicOutput?.()
     if(generation!==this.generation||this.closed)throw fail('此播放请求已取消',409)
     const metadata=this.trackMetadata(value.trackId);
     const open={cmd:'open',file:source,dsd,mode,session:value.session,trackId:value.trackId,processing:effectiveProcessing,replayGain:metadata.replayGain??{},sourceFormat:{sampleRate:metadata.sampleRate,bitsPerSample:metadata.bitsPerSample,codec:metadata.codec,lossless:metadata.lossless},backend:settings.backend,device:settings.device,channel:settings.channel,...(settings.backend==='wasapi'?{wasapiDevice:settings.wasapiDevice,wasapiMode:settings.processing.bitPerfect?'exclusive':settings.wasapiMode}:{}),volume:mode==='pcm'?(settings.processing.bitPerfect?1:value.volume):1,position,...(growingBytes?{growingBytes}:{})};
     let result;
     try{result=await this.command(open)}catch(error){
      // A completed worker atomically renames the same file while we acquire it.
      if(!growingBytes||!/progressive PCM is not available/.test(error.message))throw error;
      const completed=await boundedSource({path:lease.output,allowedRoot:this.sony.cacheDir});
      if((await fs.stat(completed.source)).size!==growingBytes)throw error;
      result=await this.command({...open,file:completed.source});
     }
     if(generation!==this.generation||this.closed){await this.command({cmd:'stop',session:value.session});throw fail('此播放请求已取消',409)}
     if(this.frontendOwner&&value.clientId!==this.frontendOwner){await this.command({cmd:'stop',session:value.session});throw fail('前端已经刷新，此播放请求已取消',409)}
     this.queued=undefined;
     this.queueTracks.clear();
      this.active={session:value.session,generation,desiredPlaying:false,trackId:value.trackId,settings,sonySettings:requestedSony,sonyJobId:value.sonyJobId,volume:value.volume,targetVolume:value.targetVolume??value.volume,lspEditorEligible:mode==='pcm',position:result.position??value.position,released:false,lastState:this.timeline(result),...(restoreLspWindow?{lspEditorWasOpen:true}:{})};
      if(restoreLspWindow&&this.active.lspEditorEligible&&settings.processing.eq.engine==='lsp') {
       if(idleLspEditorOpen)this.eqEditorBinding=value.session
       else {
        this.eqEditorBinding=value.session
        try{await this.eqEditor({action:'open',eq:settings.processing.eq},true)}catch(error){this.active.lspEditorRestoreError=error.message}
       }
      }
      return this.timeline(result)
    }catch(error){
      this.releaseLease(lease)
      if(previousActive?.released&&generation===this.generation&&!this.closed&&!this.active) {
        this.active=previousActive
        if(lease&&previousActive.sonyJobId===value.sonyJobId) {
          lease.readers=(lease.readers??0)+1;this.lease=lease
        }
        if(this.reserved===value.session)this.reserved=previousActive.session
      }
      throw error
    }
   });this.startTail=commit;return commit
 }
 async queue(value){
   if(!token(value.session)||typeof value.trackId!=='string'||!/^[-a-zA-Z0-9]+$/.test(value.trackId))throw fail('无效的预加载请求');
   let active=this.active;
   if(active?.releasePromise)await active.releasePromise
   active=this.active;
   if(!active||active.session!==value.session||this.frontendOwner&&value.clientId!==this.frontendOwner)return {stale:true};
   if(active.released) {
     this.queued=undefined;this.queueTracks.clear()
     return {...this.refreshReleasedState(active),session:active.session,trackId:active.trackId,queueCleared:true,queueReady:false,deviceReleased:true}
   }
   if(active.settings.processing.bitPerfect)throw fail('PCM 比特一致性模式不支持预载队列',409);
   if(this.lease||active.sonyJobId)throw fail('当前音效播放路线使用串行切歌，不预加载原始歌曲。',409);
   if(value.trackId.startsWith('ftp-'))await this.ftp.ensure(value.trackId);
   const descriptor=this.store?.trackFile?.(value.trackId)??this.ftp?.trackFile?.(value.trackId);
   if(!descriptor)throw fail('待播放歌曲已不在音乐库中',404);
   const {source}=await boundedSource(descriptor);
   if(/\.(dsf|dff)$/i.test(source))throw fail('DSD 歌曲使用独立切换路线',409);
   if(this.active===active&&active.released) {
     this.queued=undefined;this.queueTracks.clear()
     return {...active.releasedState,session:active.session,trackId:active.trackId,queueCleared:true,queueReady:false,deviceReleased:true}
   }
   if(this.active!==active||active.releasing||active.generation!==this.generation||this.cancelledSessions.has(value.session)||this.closed)return {stale:true};
   const metadata=this.trackMetadata(value.trackId),queued={trackId:value.trackId};
   this.queued=queued;
   this.queueTracks.set(value.trackId,queued);
   try{return this.timeline(await this.command({cmd:'queue',session:value.session,file:source,trackId:value.trackId,dsd:false,processing:active.settings.processing,replayGain:metadata.replayGain??{},sourceFormat:{sampleRate:metadata.sampleRate,bitsPerSample:metadata.bitsPerSample,codec:metadata.codec,lossless:metadata.lossless}}))}
   catch(error){if(this.queued===queued)this.queued=undefined;if(this.queueTracks.get(value.trackId)===queued)this.queueTracks.delete(value.trackId);throw error}
 }
 async control(value) {
   if(!token(value.session)||!['status','play','pause','stop','seek','volume','processing','clearQueue','advance'].includes(value.action))throw fail('无效的原生控制请求')
   if(this.frontendOwner&&value.clientId!==this.frontendOwner)return {stale:true}
   if(value.action==='stop'){this.cancelledSessions.add(value.session);if(this.cancelledSessions.size>512)this.cancelledSessions.delete(this.cancelledSessions.values().next().value)}
   if(value.action==='stop'&&this.reserved===value.session) {++this.generation;this.reserved=undefined}
   let active=this.active
   if(active?.session!==value.session)return {stopped:true,session:value.session,stale:true}
   if(active.releasePromise) {
     if(value.action==='stop')await active.releasePromise.catch(()=>{})
     else await active.releasePromise
   }
   active=this.active
   if(active?.session!==value.session)return {stopped:true,session:value.session,stale:true}
   if(value.action==='stop') {
     this.queued=undefined;
     this.queueTracks.clear();
     if(!active.released) {
       await this.closeEqEditorForSession(active)
       try{if(this.child)await this.command({cmd:'stop',session:value.session})}catch(error){if(this.active?.session===value.session)throw error}
     }
     if(this.active===active){this.active=undefined;this.releaseLease()}
     return {stopped:true,session:value.session}
   }
   if(value.action==='seek'&&(!Number.isFinite(value.position)||value.position<0))throw fail('无效的播放位置')
   if(value.action==='volume'&&(!Number.isFinite(value.volume)||value.volume<0||value.volume>1))throw fail('无效的歌曲音量')
   if(value.action==='volume'&&value.targetVolume!==undefined&&(!Number.isFinite(value.targetVolume)||value.targetVolume<0||value.targetVolume>1))throw fail('无效的歌曲音量')
   if(value.action==='volume'&&active.settings.processing.bitPerfect)throw fail('PCM 比特一致性模式下数字音量固定为 100%；请先关闭此模式后再调节音量',409)
   if(active.released) {
     if(value.action==='play')return this.resumeReleased(active,value)
     if(value.action==='status'||value.action==='pause')return this.refreshReleasedState(active)
     if(active.releasedState?.error)throw fail(active.releasedState.error,503)
   }
   if(this.lease?.state==='error') {
     const errorState={...(active.lastState??{}),session:active.session,trackId:active.trackId,playing:false,paused:true,error:this.lease.error||'Sony 实时处理失败'}
     const released=await this.releaseActiveOutput(active,errorState)
     this.releaseLease()
     if(value.action==='status')return released
     throw fail(errorState.error,503)
   }
   const offset=this.lease?.result?.positionOffset??this.lease?.stream?.positionOffset??0;
   if(value.action==='seek'&&value.position+1e-6<offset)throw fail('此位置早于当前音效片段，请重新准备所选位置',409);
   const position=value.action==='seek'?Math.max(0,value.position-offset):undefined;
   let processing;
   if(value.action==='processing'){
     try{processing=normalizeProcessing(value.processing,{clamp:false})}catch(error){throw fail(error.message)}
     if(processing.bitPerfect!==active.settings.processing.bitPerfect)throw fail('切换 PCM 比特一致性需要重新打开当前曲目',409)
     if(processing.bitPerfect&&(this.lease||active.sonyJobId))throw fail('PCM 比特一致性不能使用 Sony 音效缓存，请从原曲重新播放',409)
     if(processing.bitPerfect) {
       const descriptor=this.store?.trackFile?.(active.trackId)??this.ftp?.trackFile?.(active.trackId)
       if(/\.(dsf|dff)$/i.test(descriptor?.path??''))throw fail('PCM 比特一致性不适用于 DSD 原曲，请切换到 PCM 播放或选择 PCM 曲目')
     }
   }
   const effectiveProcessing=processing?effectivePcmProcessing(processing):undefined
   if(active.released) {
     if(value.action==='seek') {
       this.queued=undefined;this.queueTracks.clear()
       active.position=Number.isFinite(active.releasedState?.duration)?Math.min(value.position,active.releasedState.duration):value.position
       active.releasedState={...active.releasedState,position:active.position,ended:false,playing:false,paused:true,queueCleared:true,queueReady:false}
       active.lastState=active.releasedState
     }
     if(value.action==='volume') {
       active.volume=value.volume;active.targetVolume=value.targetVolume??value.volume
       active.releasedState={...active.releasedState,volume:value.volume,targetVolume:active.targetVolume}
       active.lastState=active.releasedState
     }
     if(processing)active.settings={...active.settings,processing}
     if(value.action==='clearQueue'||value.action==='advance') {
       this.queued=undefined;this.queueTracks.clear()
       active.releasedState={...active.releasedState,queueCleared:true,queueReady:false,queuedTrackId:''}
       active.lastState=active.releasedState
     }
     return active.releasedState
   }
   const readStatus=async()=>{
     if(active.releasePromise)await active.releasePromise
     if(this.active!==active||active.generation!==this.generation||this.cancelledSessions.has(value.session))return {stale:true}
     if(active.released)return active.releasedState
     const state=this.timeline(await this.command({cmd:'status',session:value.session}))
     if(active.releasePromise) {
       await active.releasePromise
       return this.active===active?active.releasedState:{stale:true}
     }
     if(this.active!==active||active.generation!==this.generation||this.cancelledSessions.has(value.session))return {stale:true}
     active.lastState=state;active.position=state.position??active.position
     if(state.ended||state.error)return this.releaseActiveOutput(active,state)
     return {...state,sonyProcessing:this.processing()}
   }
   if(value.action==='status')return readStatus()
   if(processing&&JSON.stringify(processing)===JSON.stringify(active.settings.processing))return readStatus()
   if(processing?.bitPerfect) {
     // Saved DSP edits must not crossfade or reconfigure the active identity path.
     const state=await readStatus();
     if(state.stale||active.released)return state
     active.settings={...active.settings,processing};
     return state;
   }
   if(processing&&this.lease){
     const state=await readStatus();
     if(state.stale||active.released)return state
     const resume=active.desiredPlaying;
     const opened=await this.start({session:active.session,clientId:value.clientId,trackId:active.trackId,settings:{...active.settings,processing},sonySettings:active.sonySettings,sonyJobId:active.sonyJobId,volume:active.volume,targetVolume:active.targetVolume,position:state.position??0});
     return resume?this.control({session:active.session,clientId:value.clientId,action:'play'}):opened;
   }
   if(value.action==='pause') {
     active.desiredPlaying=false
     return this.releaseActiveOutput(active,undefined,{pause:true})
   }
   if(value.action==='play')active.desiredPlaying=true
   if(value.action==='play'&&active.seeking)return {...await readStatus(),buffering:true}
   if(value.action==='seek'&&this.lease?.state==='processing') {
     const job=this.lease,target=Math.min(job.stream.duration,position+.5)*job.stream.sampleRate*8+56;
     if(job.producedBytes<target) {
      active.seeking=true;
      try {
       await this.command({cmd:'pause',session:value.session});
       while(job.state==='processing'&&job.producedBytes<target){if(this.active!==active||active.releasing||active.generation!==this.generation||this.cancelledSessions.has(value.session)||this.closed)return {stale:true};await new Promise(resolve=>setTimeout(resolve,100))}
       if(job.state==='error')throw fail(job.error||'Sony 处理失败',503);
       if(active.releasePromise)await active.releasePromise
       if(this.active!==active||active.released||active.generation!==this.generation||this.cancelledSessions.has(value.session)||this.closed)return active.released?active.releasedState:{stale:true};
       const seeked=await this.command({cmd:'seek',session:value.session,position});
       const state=this.timeline(active.desiredPlaying?await this.command({cmd:'play',session:value.session}):seeked)
       active.lastState=state;active.position=state.position??active.position
       if(state.ended||state.error)return this.releaseActiveOutput(active,state)
       return state;
      }finally{active.seeking=false}
     }
   }
   if(this.active?.session!==value.session||this.cancelledSessions.has(value.session))return {stale:true};
   const result=this.timeline(await this.command({cmd:value.action,session:value.session,...(value.action==='seek'?{position}:{}),...(value.action==='volume'?{volume:value.volume}:{}),...(processing?{processing:effectiveProcessing,replayGain:this.trackMetadata(active.trackId).replayGain??{}}:{})}));
   if(active.releasePromise) {
     await active.releasePromise
     return this.active===active?active.releasedState:{stale:true}
   }
   if(this.active!==active||active.generation!==this.generation||this.cancelledSessions.has(value.session))return {stale:true}
   if(processing&&this.active===active)active.settings={...active.settings,processing};
   active.lastState=result;active.position=result.position??active.position
   if(['clearQueue','seek'].includes(value.action)||value.action==='processing'&&!result.queueTrackId){this.queued=undefined;this.queueTracks.clear()}
   if(value.action==='volume'&&this.active===active){active.volume=value.volume;active.targetVolume=value.targetVolume??value.volume}
   if(result.ended||result.error)return this.releaseActiveOutput(active,result)
   return active.seeking?{...result,buffering:true}:result;
 }
 close(){this.closed=true;++this.generation;this.child?.stdin.end();this.releaseLease();const child=this.child;if(child){const timer=setTimeout(()=>child.kill(),2000);timer.unref();child.once('close',()=>clearTimeout(timer))}}
}
