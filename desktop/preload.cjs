const {contextBridge,ipcRenderer}=require('electron');
const preferences=ipcRenderer.sendSync('rhine:preferences:get');
try{if(Object.keys(preferences).length)localStorage.setItem('rhine-music-preferences',JSON.stringify(preferences))}catch{}
try{if(preferences.language==='zh-CN'||preferences.language==='en')localStorage.setItem('rhine-ui-language',preferences.language)}catch{}
let frontendReady=false,frontendFailureSent=false;
function reportFrontendFailure(message){
 if(frontendReady||frontendFailureSent)return;
 frontendFailureSent=true;
 const detail=String(message||'前端初始化失败').slice(0,2000);
 ipcRenderer.send('rhine:frontend-failed',detail);
}
window.addEventListener('error',event=>reportFrontendFailure(event.error?.stack||event.message||'前端脚本发生错误'));
window.addEventListener('unhandledrejection',event=>reportFrontendFailure(event.reason?.stack||event.reason||'前端异步任务失败'));
let audioPresetPersistenceError='';
let audioPresetStoreExists=false;
try{
 const stored=ipcRenderer.sendSync('rhine:audio-presets:get');
 if(stored?.error)audioPresetPersistenceError=stored.error;
 else if(stored?.ok){audioPresetStoreExists=stored.exists===true;if(audioPresetStoreExists)localStorage.setItem('rhine-audio-processing-presets-v1',JSON.stringify(stored.value))}
}catch(error){audioPresetPersistenceError=`无法恢复本机音频预设：${error.message}`}
contextBridge.exposeInMainWorld('rhineDesktop',{
 native:true,
 gpuInfo:()=>ipcRenderer.invoke('rhine:gpu:info'),
 selectGpu:id=>ipcRenderer.invoke('rhine:gpu:select',id),
 fullscreen:action=>ipcRenderer.invoke('rhine:window:fullscreen',action),
 onFullscreenChange:callback=>{
  if(typeof callback!=='function')throw new TypeError('fullscreen callback must be a function');
  const listener=(_event,isFullscreen)=>{if(typeof isFullscreen==='boolean')callback(isFullscreen)};
  ipcRenderer.on('rhine:window:fullscreen-changed',listener);
  let subscribed=true;
  return()=>{if(!subscribed)return;subscribed=false;ipcRenderer.removeListener('rhine:window:fullscreen-changed',listener)};
 },
 frontendReady:()=>{frontendReady=true;ipcRenderer.send('rhine:frontend-ready')},
 frontendFailed:reportFrontendFailure,
 audioPresetPersistenceError,
 audioPresetStoreExists,
 savePreferences:value=>{void ipcRenderer.invoke('rhine:preferences:save',value).then(result=>{if(!result?.ok)ipcRenderer.send('rhine:preferences:error',result?.error||'未收到文件保存确认')}).catch(error=>ipcRenderer.send('rhine:preferences:error',error.message))},
 showKnownIssues:language=>ipcRenderer.invoke('rhine:about:known-issues',language==='en'?'en':'zh-CN'),
 saveAudioProcessingPresets:value=>ipcRenderer.invoke('rhine:audio-presets:save',value),
 standardEqPresets:request=>ipcRenderer.invoke('rhine:standard-eq-presets',request),
 chooseMusicFolders:options=>ipcRenderer.invoke('rhine:library:choose-folders',{multiple:options?.multiple!==false,language:options?.language==='en'?'en':'zh-CN'}),
 chooseLyricsCacheFolder:language=>ipcRenderer.invoke('rhine:lyrics:choose-cache-folder',language==='en'?'en':'zh-CN')
});
