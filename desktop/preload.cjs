const {contextBridge,ipcRenderer}=require('electron');
const preferences=ipcRenderer.sendSync('rhine:preferences:get');
try{if(Object.keys(preferences).length)localStorage.setItem('rhine-music-preferences',JSON.stringify(preferences))}catch{}
try{if(preferences.language==='zh-CN'||preferences.language==='en')localStorage.setItem('rhine-ui-language',preferences.language)}catch{}
let audioPresetPersistenceError='';
let audioPresetStoreExists=false;
try{
 const stored=ipcRenderer.sendSync('rhine:audio-presets:get');
 if(stored?.error)audioPresetPersistenceError=stored.error;
 else if(stored?.ok){audioPresetStoreExists=stored.exists===true;if(audioPresetStoreExists)localStorage.setItem('rhine-audio-processing-presets-v1',JSON.stringify(stored.value))}
}catch(error){audioPresetPersistenceError=`无法恢复本机音频预设：${error.message}`}
contextBridge.exposeInMainWorld('rhineDesktop',{
 native:true,
 audioPresetPersistenceError,
 audioPresetStoreExists,
 savePreferences:value=>{void ipcRenderer.invoke('rhine:preferences:save',value).then(result=>{if(!result?.ok)ipcRenderer.send('rhine:preferences:error',result?.error||'未收到文件保存确认')}).catch(error=>ipcRenderer.send('rhine:preferences:error',error.message))},
 showKnownIssues:language=>ipcRenderer.invoke('rhine:about:known-issues',language==='en'?'en':'zh-CN'),
 saveAudioProcessingPresets:value=>ipcRenderer.invoke('rhine:audio-presets:save',value),
 standardEqPresets:request=>ipcRenderer.invoke('rhine:standard-eq-presets',request),
 chooseMusicFolders:options=>ipcRenderer.invoke('rhine:library:choose-folders',{multiple:options?.multiple!==false,language:options?.language==='en'?'en':'zh-CN'}),
 chooseLyricsCacheFolder:language=>ipcRenderer.invoke('rhine:lyrics:choose-cache-folder',language==='en'?'en':'zh-CN')
});
