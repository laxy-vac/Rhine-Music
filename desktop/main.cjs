const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {resolveStorageLayout,prepareStorageSync,createPreferencesStore}=require('./app-storage.cjs');
const {createStandardEqPresetStore,registerStandardEqPresetIpc}=require('./standard-eq-presets.cjs');
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(1),selfTest=args.includes('--self-test');
const sourcePreview=process.env.RHINE_SOURCE_PREVIEW==='1';
const settingsCheck=sourcePreview&&args.includes('--check-settings-page');
const previewUICheck=args.includes('--check-preview-ui');
if(previewUICheck)app.commandLine.appendSwitch('mute-audio');
if(settingsCheck){app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');app.commandLine.appendSwitch('disable-renderer-backgrounding')}
app.commandLine.appendSwitch('force_high_performance_gpu');
app.setName(sourcePreview?'Rhine Music Source Preview':'Rhine Music Preview');
const storage=resolveStorageLayout({projectRoot:root,execPath:process.execPath,sourcePreview});
try{prepareStorageSync(storage)}catch(error){dialog.showErrorBox('Rhine Music 存储目录不可用',`${error.message}\n请选择普通用户可写的安装目录；程序不会改权限或回退到 AppData。`);app.exit(1);throw error}
app.setPath('userData',storage.home);
app.setPath('sessionData',storage.sessionDir);
app.setPath('temp',storage.tempDir);
app.setPath('crashDumps',storage.crashDir);
app.setAppLogsPath(storage.logsDir);
// These overrides belong to this process and its children, never the OS profile.
process.env.TEMP=storage.tempDir;process.env.TMP=storage.tempDir;
const dataDir=storage.dataDir;
const preferencesStore=createPreferencesStore(storage);
process.env.SONY_WALKMAN_ASSETS=path.join(root,'vendor/sony-walkman');
if(!sourcePreview||!process.env.SONY_WALKMAN_PYTHON)process.env.SONY_WALKMAN_PYTHON=path.join(root,'runtime/python/python.exe');
process.env.SONY_WALKMAN_X86_DLL=path.join(root,'vendor/sony-walkman-x86/sony-dsp-x86.dll');
const previewNative=path.join(root,'.tools/source-preview-native-audio/rhine-audio-host.exe');
process.env.SONY_WALKMAN_NATIVE_DECODER=sourcePreview&&require('node:fs').existsSync(previewNative)?previewNative:path.join(root,'vendor/audio/windows-x64/rhine-audio-host.exe');
process.env.RHINE_NATIVE_AUDIO=process.env.SONY_WALKMAN_NATIVE_DECODER;
let service,window,quitting=false,preferences={},saveTail=Promise.resolve();
let windowAspectModel,windowAspectController;
const audioPresetFile=storage.audioPresetFile;
const audioPresetMaxBytes=16*1024*1024,audioPresetSourceMaxBytes=4*1024*1024;
const emptyAudioPresetStore=()=>({schemaVersion:1,activeId:null,presets:[],eqBanks:{}});
let audioPresetStore=emptyAudioPresetStore(),audioPresetStoreExists=false,audioPresetLoadError='',audioPresetFileFingerprint=null,audioPresetSaveTail=Promise.resolve();
const preferenceKeys=new Set(['language','theme','followSystemTheme','entryOnOpen','windowAspect','view','style','styleProfiles','caseProfiles','futurePunkPresets','archivePunkPresets','themeLayoutVersion','foobarArchive','sortMode','quality','reduced','volume','songFade','sony','sonyParallel','sonyStreaming','output','bgm','bgmVolume','sound','soundVolume','renderQuality']);
const selectPreferences=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid preferences');
 const text=JSON.stringify(value);if(Buffer.byteLength(text,'utf8')>2*1024*1024)throw new Error('Preferences exceed limit');
 const selected=Object.fromEntries(Object.entries(value).filter(([key])=>preferenceKeys.has(key)));
 if(selected.language!=='zh-CN'&&selected.language!=='en')delete selected.language;
 if(typeof selected.followSystemTheme!=='boolean')delete selected.followSystemTheme;
 if(typeof selected.entryOnOpen!=='boolean')delete selected.entryOnOpen;
 if(windowAspectModel)selected.windowAspect=windowAspectModel.normalizeWindowAspect(selected.windowAspect);
 return selected;
};
const selectAudioPresetStore=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('音频预设数据格式无效');
 const allowed=new Set(['schemaVersion','activeId','presets','eqBanks']);
 if(Object.keys(value).some(key=>!allowed.has(key))||['schemaVersion','activeId','presets','eqBanks'].some(key=>!Object.hasOwn(value,key)))throw new Error('音频预设数据字段无效');
 if(value.schemaVersion!==1)throw new Error('不支持此音频预设文件版本');
 if(value.activeId!==null&&typeof value.activeId!=='string')throw new Error('音频预设当前项目编号无效');
 if(!Array.isArray(value.presets)||!value.eqBanks||typeof value.eqBanks!=='object'||Array.isArray(value.eqBanks))throw new Error('音频预设列表或 EQ 模式配置无效');
 if(Object.keys(value.eqBanks).some(key=>!['graphic','parametric'].includes(key)))throw new Error('音频预设包含未知 EQ 模式');
 let sourceBytes=0;
 for(const preset of value.presets){
  if(!preset||typeof preset!=='object'||Array.isArray(preset))throw new Error('音频预设记录格式无效');
  if(typeof preset.sourceText==='string')sourceBytes+=Buffer.byteLength(preset.sourceText,'utf8');
 }
 if(sourceBytes>audioPresetSourceMaxBytes)throw new Error('导入原始文本总量超过 4 MB');
 const text=JSON.stringify(value);
 if(Buffer.byteLength(text,'utf8')>audioPresetMaxBytes)throw new Error('音频预设文件超过 16 MB');
 return JSON.parse(text);
};
const audioPresetFingerprint=text=>createHash('sha256').update(text).digest('hex');
async function loadAudioPresetStore(){
 try{
  // Source preview reads its old EQ file only when the new preset file is absent.
  // The original is retained; a subsequent user save writes the new location.
  const legacyFile=sourcePreview?path.join(storage.home,'audio-processing-presets.json'):null;
  const currentExists=await fs.access(audioPresetFile).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error});
  const loadFile=!currentExists&&legacyFile?legacyFile:audioPresetFile;
  const info=await fs.stat(loadFile);
  if(info.size>audioPresetMaxBytes)throw new Error('文件超过 16 MB');
  const text=await fs.readFile(loadFile,'utf8');
  audioPresetStore=selectAudioPresetStore(JSON.parse(text));
  audioPresetFileFingerprint=currentExists?audioPresetFingerprint(text):null;
  audioPresetStoreExists=true;
 }catch(error){
  if(error.code==='ENOENT'){audioPresetStore=emptyAudioPresetStore();audioPresetStoreExists=false;audioPresetFileFingerprint=null;return}
  audioPresetLoadError=`本机音频预设文件读取失败，原文件已保留：${error.message}`;
 }
}
async function listen() {
 for(let port=5175;port<5185;port++) {
  try {await new Promise((resolve,reject)=>{const failed=error=>{service.server.off('listening',listening);reject(error)};const listening=()=>{service.server.off('error',failed);resolve()};service.server.once('error',failed);service.server.once('listening',listening);service.server.listen(port,'127.0.0.1')});return `http://127.0.0.1:${port}`}
  catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error}
 }
 throw new Error('本地播放服务端口均被占用，请关闭多余的播放器实例。');
}
function ownedEvent(event){return window&&!window.isDestroyed()&&event.sender===window.webContents}
// HIDDEN_STARTUP_GATE_FACTORY_BEGIN
function createHiddenStartupGate({ipcMain,app,dialog,getWindow}){
 let generation=0,readyGeneration=-1,failureGeneration=-1,pendingFocus=false,origin='';
 const isOwnedMainFrameEvent=event=>{
  const target=getWindow();
  if(!target||target.isDestroyed()||event.sender!==target.webContents)return false;
  const frame=event.senderFrame;
  if(!frame||frame!==target.webContents.mainFrame)return false;
  const frameUrl=frame.url;
  if(!origin||!frameUrl)return false;
  try{if(new URL(frameUrl).origin!==origin)return false}catch{return false}
  return true;
 };
 const isReady=()=>readyGeneration===generation;
 const revealIfReady=({focus=false}={})=>{
  const target=getWindow();
  if(!target||target.isDestroyed())return false;
  if(focus)pendingFocus=true;
  if(!isReady())return false;
  const wasMinimized=target.isMinimized();
  if(wasMinimized)target.restore();
  if(wasMinimized||!target.isVisible())target.show();
  target.webContents.setBackgroundThrottling(true);
  if(pendingFocus){target.focus();pendingFocus=false}
  return true;
 };
 const reportFailure=message=>{
  if(failureGeneration===generation)return false;
  failureGeneration=generation;
  const detail=String(message||'Rhine Music 前端初始化失败').slice(0,2000);
  try{dialog.showErrorBox('Rhine Music 启动失败',detail)}finally{app.quit()}
  return true;
 };
 const attachWindow=(target,url)=>{
  origin=new URL(url).origin;
  generation++;readyGeneration=-1;failureGeneration=-1;
  // The complete WebGL startup needs frame callbacks before the first show.
  // Restore ordinary background throttling immediately after revealing it.
  target.webContents.setBackgroundThrottling(false);
  target.webContents.on('did-start-navigation',(_event,_destination,inPlace,isMainFrame)=>{
   if(!isMainFrame||inPlace)return;
   generation++;readyGeneration=-1;failureGeneration=-1;
   target.webContents.setBackgroundThrottling(false);
   // Keep an existing window visible across reload. Explicitly hiding it
   // suspends the real renderer's frame callbacks even with throttling off.
  });
  target.webContents.on('did-fail-load',(_event,code,description,validatedURL,isMainFrame)=>{
   if(!isMainFrame||Number(code)===-3)return;
   reportFailure(`网页加载失败（${code}）：${description}\n${validatedURL}`);
  });
  target.webContents.on('render-process-gone',(_event,details)=>{
   reportFailure(`页面渲染进程已退出：${details?.reason||details?.exitCode||'未知原因'}`);
  });
 };
 ipcMain.on('rhine:frontend-ready',event=>{
  if(!isOwnedMainFrameEvent(event)||isReady())return;
  readyGeneration=generation;
  revealIfReady();
 });
 ipcMain.on('rhine:frontend-failed',(event,message)=>{
  if(!isOwnedMainFrameEvent(event))return;
  reportFailure(message);
 });
 app.on('second-instance',()=>{revealIfReady({focus:true})});
 app.on('activate',()=>{revealIfReady({focus:true})});
 return{attachWindow,revealIfReady,reportFailure,isReady:()=>isReady()};
}
// HIDDEN_STARTUP_GATE_FACTORY_END
const standardEqPresetStore=createStandardEqPresetStore({home:storage.home,audioPresetFile,projectRoot:root,dialog,shell,getWindow:()=>window});
registerStandardEqPresetIpc({ipcMain,store:standardEqPresetStore,ownedEvent});
ipcMain.handle('rhine:about:known-issues',async(event,language)=>{
 if(!ownedEvent(event))throw new Error('无效的已知问题请求');
 const {getKnownIssuesText}=await import(pathToFileURL(path.join(root,'src/known-issues.mjs')).href);
 if(!ownedEvent(event))return;
 const english=language==='en';
 await dialog.showMessageBox(window,{type:'info',title:english?'Known issues':'已知问题',message:english?'Audio precision and output limitations':'音频精度与输出限制',detail:getKnownIssuesText(english?'en':'zh-CN'),buttons:[english?'Close':'关闭'],defaultId:0,cancelId:0,noLink:true});
});
ipcMain.handle('rhine:library:choose-folders',async(event,options)=>{
 if(!ownedEvent(event))throw new Error('无效的音乐库窗口');
 const english=options?.language==='en';
 const result=await dialog.showOpenDialog(window,{title:english?'Choose music folders':'选择音乐文件夹',buttonLabel:english?'Choose folder':'选择文件夹',defaultPath:app.getPath('music'),properties:['openDirectory','dontAddToRecent',...(options?.multiple===false?[]:['multiSelections'])]});
 return ownedEvent(event)&&!result.canceled?result.filePaths:[];
});
ipcMain.handle('rhine:lyrics:choose-cache-folder',async(event,language)=>{
 if(!ownedEvent(event))throw new Error('无效的播放器窗口');
 const current=service?.lyrics?await service.lyrics.settings():null;
 if(!ownedEvent(event))return null;
 const english=language==='en';
 const result=await dialog.showOpenDialog(window,{title:english?'Choose lyrics cache folder':'选择歌词缓存文件夹',buttonLabel:english?'Use this folder':'选择此文件夹',defaultPath:current?.settings.cacheDirectory||dataDir,properties:['openDirectory','createDirectory','dontAddToRecent']});
 return ownedEvent(event)&&!result.canceled?result.filePaths[0]??null:null;
});
ipcMain.on('rhine:preferences:get',event=>{event.returnValue=ownedEvent(event)?preferences:{}});
ipcMain.handle('rhine:preferences:save',async(event,value)=>{
 if(!ownedEvent(event))return{ok:false,error:'无效的播放器窗口'};let selected;try{selected=selectPreferences(value)}catch(error){return{ok:false,error:error.message}}
 const aspectChanged=preferences.windowAspect!==selected.windowAspect;
 preferences=selected;
 if(aspectChanged)windowAspectController?.set(selected.windowAspect);
 saveTail=saveTail.catch(()=>{}).then(()=>preferencesStore.save(selected));
 try{await saveTail;return{ok:true}}catch(error){return{ok:false,error:`设置或主题预设未保存：${error.message}`}}
});
let preferenceErrorVisible=false;
ipcMain.on('rhine:preferences:error',(event,message)=>{
 if(!ownedEvent(event)||preferenceErrorVisible)return;
 preferenceErrorVisible=true;
 void dialog.showMessageBox(window,{type:'error',title:'Rhine Music · 保存失败',message:'设置或主题预设没有写入文件',detail:String(message).slice(0,2000),buttons:['关闭']}).finally(()=>{preferenceErrorVisible=false});
});
ipcMain.on('rhine:audio-presets:get',event=>{
 event.returnValue=ownedEvent(event)?{ok:!audioPresetLoadError,exists:audioPresetStoreExists,value:audioPresetStore,error:audioPresetLoadError||undefined}:{ok:false,exists:false,error:'无效的音乐库窗口'};
});
ipcMain.handle('rhine:audio-presets:save',async(event,value)=>{
 if(!ownedEvent(event))return{ok:false,error:'无效的音乐库窗口'};
 if(audioPresetLoadError)return{ok:false,error:`${audioPresetLoadError}，本次保存已取消`};
 let selected;
 try{selected=selectAudioPresetStore(value)}catch(error){return{ok:false,error:`音频预设未保存：${error.message}`}}
 const text=JSON.stringify(selected),temporary=audioPresetFile+'.next';
 const write=audioPresetSaveTail.catch(()=>{}).then(async()=>{
  try{
   const currentText=await fs.readFile(audioPresetFile,'utf8');
   if(!audioPresetFileFingerprint||audioPresetFingerprint(currentText)!==audioPresetFileFingerprint)throw new Error('文件在启动后被更改或替换');
  }catch(error){if(error.code!=='ENOENT'||audioPresetFileFingerprint!==null)throw error}
  await fs.mkdir(path.dirname(audioPresetFile),{recursive:true});
  await fs.writeFile(temporary,text,{mode:0o600});
  await fs.rename(temporary,audioPresetFile);
  audioPresetFileFingerprint=audioPresetFingerprint(text);
  audioPresetStore=selected;
  audioPresetStoreExists=true;
 });
 audioPresetSaveTail=write;
 try{await write;return{ok:true}}
 catch(error){return{ok:false,error:`音频预设文件写入失败，原文件未替换：${error.message}`}}
});
if(!selfTest&&!settingsCheck&&!previewUICheck&&!app.requestSingleInstanceLock()){app.quit()}
else {
 const startupGate=!selfTest&&!settingsCheck&&!previewUICheck?createHiddenStartupGate({ipcMain,app,dialog,getWindow:()=>window}):null;
 app.whenReady().then(async()=>{
  try {
   windowAspectModel=await import(pathToFileURL(path.join(root,'src/window-aspect-model.mjs')).href);
   const {attachWindowAspect}=await import(pathToFileURL(path.join(__dirname,'window-aspect.mjs')).href);
   await loadAudioPresetStore();
   if(previewUICheck){
    // Explicit synthetic check only: the helper owns a mock service and hidden UI.
    if(!root.toLowerCase().includes(`${path.sep}.tools${path.sep}preview-release${path.sep}`))throw new Error('打包UI检查只允许在项目内隔离的preview-release产物中运行。');
    preferences={...selectPreferences(await preferencesStore.load()),bgm:false,sound:false,volume:0};
    const {runPreviewUICheck}=await import(pathToFileURL(path.join(__dirname,'check-preview-ui.mjs')).href);
    const report=await runPreviewUICheck({root,dataDir,BrowserWindow,ownWindow:value=>{window=value}});
    await saveTail.catch(()=>{});
    await fs.writeFile(path.join(storage.logsDir,'preview-ui-check.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));app.exit(report.ok?0:1);return;
   }
   if(selfTest) {
    const index=args.indexOf('--report');if(index<0||!args[index+1])throw new Error('Self-test requires --report <file>');
    const {runSelfTest}=await import(pathToFileURL(path.join(__dirname,'self-test.mjs')).href);
    const report=await runSelfTest({root,dataDir});const reportFile=path.resolve(args[index+1]);await fs.mkdir(path.dirname(reportFile),{recursive:true});await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');app.exit(report.ok?0:1);return;
   }
   if(settingsCheck){
    const {runSettingsPageCheck}=await import(pathToFileURL(path.join(__dirname,'check-settings-page.mjs')).href);
    const report=await runSettingsPageCheck({root,dataDir,home:app.getPath('userData'),BrowserWindow,audioCore:args.includes('--check-audio-core'),ownWindow:value=>{window=value}});
    await fs.writeFile(path.join(app.getPath('userData'),'settings-review-report.json'),JSON.stringify(report,null,2)+'\n');console.log(`Settings page review: ${report.ok?'passed':'failed'}`);app.exit(report.ok?0:1);return;
   }
   preferences=selectPreferences(await preferencesStore.load());
   const {createMusicServer}=await import(pathToFileURL(path.join(root,'scripts/music-server.mjs')).href);
   service=await createMusicServer({dataDir,lspUserDataDir:storage.lspUserDataDir,lspStorageRoot:storage.storageRoot,defaultRoots:[],autoScan:false,...(sourcePreview&&process.env.RHINE_SOURCE_INTERFACE?{distDir:path.resolve(process.env.RHINE_SOURCE_INTERFACE)}:{})});const origin=await listen();
   window=new BrowserWindow({width:1920,height:1080,useContentSize:true,title:'Rhine Music',backgroundColor:'#e6e8e3',show:false,autoHideMenuBar:true,icon:sourcePreview?path.join(root,'windows/app.ico'):path.join(__dirname,'app.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
   windowAspectController=attachWindowAspect(window,{screen:require('electron').screen,initialAspect:preferences.windowAspect});
   startupGate?.attachWindow(window,origin);
   {const title=sourcePreview?'Rhine Music · 源码验证':`Rhine Music · ${app.getVersion()}`;window.setTitle(title);window.webContents.on('page-title-updated',event=>{event.preventDefault();window.setTitle(title)})}
   // Restore the intended CSS proportions on startup/reload, including profiles
   // with an older saved page zoom. Windows DPI scaling remains under the OS.
   window.webContents.on('dom-ready',()=>{if(window&&!window.isDestroyed())window.webContents.setZoomFactor(1)});
   window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault()});
   window.webContents.setWindowOpenHandler(({url})=>{try{const parsed=new URL(url);if(parsed.protocol==='https:')void shell.openExternal(url)}catch{}return {action:'deny'}});
   window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
   if(sourcePreview)window.once('show',()=>{void fs.writeFile(path.join(app.getPath('userData'),'desktop-preview.json'),JSON.stringify({mode:'desktop',pid:process.pid,projectDir:root,interfaceDir:process.env.RHINE_SOURCE_INTERFACE||path.join(root,'dist'),origin,dataDir,title:window.getTitle(),visible:window.isVisible()},null,2)+'\n').catch(error=>console.error(error.message))});
   window.on('closed',()=>{windowAspectController?.destroy();windowAspectController=undefined;window=undefined});
   try{await window.loadURL(origin)}catch(error){
    // Reloading or closing the owned window cancels this navigation. Electron
    // reports ERR_ABORTED for that normal cancellation while the next load
    // proceeds; it must not tear down the service or display a startup error.
    if(error.code!=='ERR_ABORTED'&&error.errno!==-3)throw error;
   }
  }catch(error){if(settingsCheck){await fs.writeFile(path.join(app.getPath('userData'),'settings-review-report.json'),JSON.stringify({ok:false,error:error.stack},null,2)).catch(()=>{});console.error(error.stack)}else if(!selfTest&&!previewUICheck)startupGate?.reportFailure(error.message);else if(!selfTest)dialog.showErrorBox('Rhine Music 启动失败',error.message);else {const i=args.indexOf('--report');if(i>=0&&args[i+1])await fs.writeFile(path.resolve(args[i+1]),JSON.stringify({ok:false,error:error.stack},null,2)).catch(()=>{})}if(!startupGate)app.exit(1)}
 });
 app.on('window-all-closed',()=>{if(!previewUICheck)app.quit()});
 app.on('before-quit',event=>{
  if(quitting)return;event.preventDefault();quitting=true;
  const shut=async()=>{if(service){await service.native.stopCurrent().catch(()=>{});service.sony.close();service.ftp.close();service.native.close();service.server.closeAllConnections();await new Promise(resolve=>service.server.close(resolve))}await Promise.all([saveTail.catch(()=>{}),audioPresetSaveTail.catch(()=>{}),standardEqPresetStore.flush()])};
  void shut().finally(()=>app.quit());
 });
}
