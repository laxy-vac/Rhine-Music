import { checkAlbumPanel } from './check-album-panel-behavior.mjs';
import { checkPunkControls } from './check-punk-controls.mjs';
import { checkPunkEq } from './check-punk-eq.mjs';
import { checkWindowAspectUi } from './check-window-aspect-ui.mjs';
import { checkPunkLyrics } from './check-punk-lyrics.mjs';
import { checkPunkSignal } from './check-punk-signal.mjs';
import { checkFutureDesign } from './check-future-design.mjs';
import { checkManagementNavigation, createManagementNavigationBootstrap } from './check-management-navigation.mjs';
import { checkTerminalGlassProbe } from './check-terminal-glass.mjs';
// Offline DOM geometry regression. Uses installed Chromium and real source
// CSS/shell/title/range controls; never boots the player or its music service.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, access, stat } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { normalizeProcessing } from "../src/audio-processing-model.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(project, ".tools/foobar-layout-check");
await mkdir(output, { recursive: true });
const candidates = [process.env.LAYOUT_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
const executable = await candidates.reduce(async (previous, candidate) =>
  await previous || await access(candidate).then(() => candidate, () => null), Promise.resolve(null));
assert.ok(executable, "An existing Chromium browser is required; no browser is downloaded.");
const main = await readFile(path.join(project, "src/music-app.ts"), "utf8");
const styleTokensJson = JSON.parse(await readFile(path.join(project, "src/assets/style/tokens.json"), "utf8"));
assert.match(main,/case "open":\s*setMode\("detail"\);/,"The source open-album action must enter detail mode.");
assert.match(main,/scene\.onOpenAlbum\s*=\s*index\s*=>\s*\{[^}]*setMode\("detail"\);/,"The source scene callback must open the selected album.");
assert.match(main,/document\.addEventListener\("dblclick",\s*\(event\)\s*=>\s*\{[\s\S]*?setMode\("detail"\);/,"The source left-scene double-click handler must reach detail mode.");
const displayMode = process.argv.includes('--display');
const navigationMode = process.argv.includes('--navigation');
const glassMode = process.argv.includes('--glass');
const sharedMode = process.argv.includes('--panel') || navigationMode || displayMode || glassMode;
const navigationBootstrap = navigationMode ? createManagementNavigationBootstrap(main) : '';
const hiResURL='data:image/svg+xml;base64,'+(await readFile(path.join(project,'public/audio-tech/hi-res.svg'))).toString('base64');
let css = await readFile(path.join(project, "node_modules/@kitlangton/rolling-number/dist/styles.css"), "utf8");
const rollingEntry = await readFile(path.join(project, "node_modules/@kitlangton/rolling-number/dist/index.js"), "utf8");
const rollingChunkName = rollingEntry.match(/from"\.\/(.+?)"/)[1];
const rollingChunk = await readFile(path.join(project, "node_modules/@kitlangton/rolling-number/dist", rollingChunkName), "utf8");
const rollingURL = `data:text/javascript;base64,${Buffer.from(rollingChunk).toString("base64")}`;
for (const [, relative] of main.matchAll(/^import "(\.\/.+\.css)";/gm)) {
  let source = await readFile(path.join(project, "src", relative), "utf8");
  // Embed the existing Archive fonts; remove other URLs to keep the fixture offline.
  if (relative === "./music-design-fonts.css") {
    for (const [match, url] of source.matchAll(/url\("(.+?)"\)/g)) {
      const font = await readFile(path.join(project, "src", url));
      source = source.replace(match, `url("data:font/ttf;base64,${font.toString("base64")}")`);
    }
  } else {
    const urls=[...source.matchAll(/url\(["']?(\/fonts\/[^"')]+|\/audio-tech\/[^"')]+)["']?\)/g)];
    for(const [match,url] of urls){const bytes=await readFile(path.join(project,'public',url.slice(1)));source=source.replace(match,`url("data:${url.endsWith('.woff2')?'font/woff2':'image/svg+xml'};base64,${bytes.toString('base64')}")`);}
    source = source.replace(/url\((?!["']?data:)[^)]*\)/g, "none");
  }
  css += source + "\n";
}
const parsed = ts.createSourceFile("music-app.ts", main, ts.ScriptTarget.Latest, true);
css += await readFile(path.join(project,'src/album-queue.css'),'utf8');
let template;
function find(node) {
  if (ts.isBinaryExpression(node) && node.left.getText(parsed) === "stage.innerHTML")
    template = ts.isTaggedTemplateExpression(node.right) ? node.right.template : node.right;
  ts.forEachChild(node, find);
}
find(parsed);
assert.ok(template && ts.isTemplateExpression(template), "Use the actual music app DOM template.");
const markup = template.head.text + template.templateSpans.map(span =>
  (span.expression.getText(parsed) === "playbackMarkup()" ? "__PLAYBACK__" : "") + span.literal.text).join("");
function productionListener(eventName) {
  const callbacks = [];
  for (const statement of parsed.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (call.expression.getText(parsed) !== 'document.addEventListener' ||
      !ts.isStringLiteral(call.arguments[0]) || call.arguments[0].text !== eventName) continue;
    callbacks.push(call.arguments[1]);
  }
  const callback = callbacks.at(-1);
  assert.ok(callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)),
    `The production ${eventName} listener must remain extractable.`);
  return ts.transpileModule(`document.addEventListener(${JSON.stringify(eventName)}, ${callback.getText(parsed)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}
const productionViewEvents = displayMode
  ? ['click', 'input', 'change', 'keydown'].map(productionListener).join('\n')
  : '';
async function moduleFunctions(name, exports, selectedOnly = false) {
  let source = name === '$main' ? main : await readFile(path.join(project, `src/${name}.ts`), "utf8");
  if(name==='hi-res')source=source.replaceAll('audio-tech/hi-res.svg',hiResURL);
  if (selectedOnly) {
    const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    source = tree.statements.filter(statement => ts.isFunctionDeclaration(statement) && exports.includes(statement.name?.text)
      || ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => exports.includes(declaration.name.getText(tree))))
      .map(statement => statement.getText(tree)).join("\n");
  }
  if(name==='$main') source='let detailIdentity="",detailContentKey="";\n'+source;
  const code = ts.transpileModule(source.replace(/^import[\s\S]*?;\r?\n/gm, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/^export /gm, "").replaceAll("import.meta.env.BASE_URL", '""');
  return `const {${exports.join(",")}} = (()=>{${code};return {${exports.join(",")}};})();`;
}
const modules = (await Promise.all([
  moduleFunctions("html", ["escapeHtml", "containsCjk"]),
  moduleFunctions("music-title-reels", ["createTitleReels"]),
  moduleFunctions("music-title", ["setupMusicTitleLayout"]),
  moduleFunctions("music-text-motion", ["setupMusicTextMotion"]),
  moduleFunctions("music-playback", ["playbackMarkup", "playbackTime", "setupMusicPlayback"]),
  moduleFunctions("editable-range-controls", ["setupEditableRanges"]),
  moduleFunctions("hi-res", ["hiResBadgeMarkup", "dsdBadgeMarkup", "isDsdTrack", "isHiResTrack"]),
  moduleFunctions("viewport-layout", ["foobarArchiveWidth"]),
  moduleFunctions("native-audio", ["isDsd", "directDsd", "outputDefault"], true),
  moduleFunctions("audio-info", ["setupAudioInfoPopup"]),
  moduleFunctions("foobar-shell", ["setupFoobarShell"]),
  moduleFunctions("music-view-settings", ["legacyCatalogOptions"]),
  moduleFunctions("music-style", ["musicStyleMarkup", "defaultMusicStyle", "archiveMusicStyle"]),
  moduleFunctions("music-view-controls", ["musicViewControlsMarkup", "musicBrowseControlsMarkup", "syncMusicViewControls"]),
  moduleFunctions("music-catalog-grid", ["setupMusicCatalogGrid"]),
  moduleFunctions("foobar-catalog", ["foobarCatalogMarkup", "foobarGridMarkup"]),
  moduleFunctions("album-panel", ["setupAlbumPanel"]),
  moduleFunctions("ui-transitions", ["SurfaceTransition", "PageScanTransition"]),
  moduleFunctions("music-presentation", ["MusicPresentation"]),
  moduleFunctions("album-interaction", ["setupAlbumInteraction"]),
  moduleFunctions("album-queue", ["setupAlbumQueue"]),
  moduleFunctions('$main',['time','genreName','formatList','albumDuration','valueRange','albumProfileFields','trackList','albumAbout','producerBlock','playAlbum','renderDetail','syncTabIndicator','savePrefs','syncDesignIdentity','navigationSelection','stepAlbum','stepGenre','refreshFoobarSceneForLayoutChange','musicArrangementPreset','syncMusicCatalogView','applyMusicView','$'],true),
])).join("\n");
const initialize = `(async () => {
  const trUi = value => value;
  const ui = (strings,...values) => strings.reduce((text,part,index) => text + part + (values[index] ?? ""), "");
  const uiLanguage = () => "en";
  const styleTokensJson = ${JSON.stringify(styleTokensJson)};
  const records=[];
  let catalogGrid;
  let page='music', panel=false, musicFilterTimer, mockCatalogVersion=0;
  const musicApplication={selectedIndex:0,selectedAlbumId:'fixture-album',selectedTrackId:'fixture-flac',catalogFocus:{entryKey:'track|fixture-album|fixture-flac',albumId:'fixture-album',trackId:'fixture-flac'},spatialLayout:'shelf',mode:'archive',activeTab:'tracks',infoScrollTop:0,query:'',view:Object.freeze({layout:'shelf',show:'albums',group:'genre',sort:'artist'})};
  const mockEntries=[
    {key:'track|fixture-album|fixture-flac',albumId:'fixture-album',trackId:'fixture-flac',recordIndex:0,record:{title:'Needle Track',album:{offline:false}},track:{id:'fixture-flac',title:'Needle Track'}},
    {key:'track|fixture-album|fixture-track-2',albumId:'fixture-album',trackId:'fixture-track-2',recordIndex:0,record:{title:'Second Track',album:{offline:false}},track:{id:'fixture-track-2',title:'Second Track'}},
    {key:'track|fixture-album-2|fixture-track-3',albumId:'fixture-album-2',trackId:'fixture-track-3',recordIndex:1,record:{title:'Other Track',album:{offline:false}},track:{id:'fixture-track-3',title:'Other Track'}},
  ];
  const entryByKey=key=>mockEntries.find(entry=>entry.key===key);
  mockEntries.forEach((entry,index)=>{
    entry.index=index;
    entry.record={...entry.record,id:entry.key,en:'Fixture Artist',category:'Fixture',date:'2010',
      album:{...entry.record.album,id:entry.albumId,title:'Fixture Album',artist:'Fixture Artist',year:2010,tracks:[{format:'FLAC'}]}};
    entry.track={...entry.track,format:'FLAC',discNumber:1,trackNumber:index+1,duration:180};
  });
  const getMusicDisplayEntries=()=>mockEntries;
  const getMusicEntry=index=>mockEntries[index];
  const getMusicEntryByKey=entryByKey;
  const getMusicCatalogGroups=()=>[{key:'fixture',name:'Fixture',entryKeys:mockEntries.map(entry=>entry.key)}];
  const getMusicCatalogOptions=()=>musicApplication.view;
  const configureMusicCatalog=(next,query)=>{
    const view={...musicApplication.view,...next};
    const text=query===undefined?musicApplication.query:String(query).trim();
    if(Object.keys(view).every(key=>view[key]===musicApplication.view[key])&&text===musicApplication.query)return;
    musicApplication.view=Object.freeze(view);musicApplication.query=text;
    if(view.layout!=='grid')musicApplication.spatialLayout=view.layout;
    mockCatalogVersion++;
  };
  const getMusicCatalogVersion=()=>mockCatalogVersion;
  const getMusicCatalogRecords=()=>musicApplication.query.toLowerCase().includes('no-match')?[]:musicApplication.query.toLowerCase().includes('needle')?[0]:[0,1];
  const getMusicFocusedEntry=index=>{
    if(!getMusicCatalogRecords().includes(index))return undefined;
    const focused=entryByKey(musicApplication.catalogFocus?.entryKey||'');
    return focused?.recordIndex===index?focused:mockEntries.find(entry=>entry.recordIndex===index);
  };
  const focusMusicEntry=key=>{
    const entry=entryByKey(key);if(entry){musicApplication.catalogFocus={entryKey:entry.key,albumId:entry.albumId,trackId:entry.trackId};musicApplication.selectedTrackId=entry.trackId;}return entry;
  };
  const getMusicRecordLocation=index=>index<0?null:{shelf:Math.min(2,Math.floor(index/20)),slot:index%20};
  const getMusicCatalogShelves=()=>Array.from({length:3},(_,shelf)=>({entryKeys:Array.from({length:20},(_,slot)=>'mock-'+shelf+'-'+slot)}));
  const navigationCalls=[];
  const navigateMusicEntry=(index,axis,direction)=>{navigationCalls.push([index,axis,direction]);return entryByKey(index===0?'track|fixture-album-2|fixture-track-3':'track|fixture-album|fixture-flac');};
  const getFoobarCatalogOptions = () => legacyCatalogOptions(musicApplication.view);
  const getFoobarFocusedEntry = () => getMusicFocusedEntry(musicApplication.selectedIndex);
  const getFoobarCatalogRecords = () => getMusicCatalogRecords();
  const getFoobarLocation = getMusicRecordLocation;
  const getFoobarShelves = getMusicCatalogShelves;
  const boot=undefined, viewer=undefined;
  const isLibrarySettings=()=>false;
  const openPanel=()=>{};
  const syncThemeButtons=()=>{};
  const fit=()=>{};
  const notify=()=>{};
  const themeNames={day:'LIGHT',night:'DARK'};
  const sortLabel={code:'GENRE'};
  const designProfiles={rhine:{},archive:{}};
  const caseProfiles={rhine:{},archive:{}};
  const processingSettings={};
  let savedPreferenceCount=0;
  const save=()=>{savedPreferenceCount++;};
  const settingsSelectControls=undefined;
  const detailTransition={dispose(){}};
  const browseTransition={dispose(){}};
  const libraryRebuilding=false, libraryIntent=undefined, presentation={pendingSelection:undefined};
  const select=(index)=>{
    musicApplication.selectedIndex=index;musicApplication.selectedAlbumId=records[index]?.id;
    if(musicApplication.catalogFocus?.albumId!==musicApplication.selectedAlbumId)musicApplication.selectedTrackId=undefined;
  };
  const updateSelection=()=>syncMusicCatalogView();
  // DOM fixture boundary: exercise the real compatibility toolbar markup while
  // supplying a small explicit mock catalog entry; public catalog behavior is
  // covered by check-music-display.mjs with synthetic records.
  const {c:createRollingNumber,d:createRollingText}=await import(${JSON.stringify(rollingURL)});
  const normalizeProcessing = () => structuredClone(${JSON.stringify(normalizeProcessing(undefined))});
  ${modules}
  const esc=escapeHtml,genres=[{id:'pop',name:'流行'}],demo=false,shelf='local',introductionsStarting=false,library={introductions:{running:false}};
  const introductionAlbumStatus=()=>'';
  const played=[];const player={play(id){played.push(id);return Promise.resolve();}};
  const stage = document.querySelector('#stage');
  stage.innerHTML = ${JSON.stringify(markup)}.replace('__PLAYBACK__', playbackMarkup());
  // DOM fixture boundary: mount the production browse-control markup and use
  // the production document click handler; catalog data remains the explicit
  // three-entry mock defined above.
  if(${displayMode})stage.querySelector('#music-browse').insertAdjacentHTML('afterbegin',musicBrowseControlsMarkup(musicApplication.view));
  stage.querySelector('.open-album').dataset.cjk='true';
  stage.addEventListener('album-panel-layout',()=>syncTabIndicator(false));
  stage.querySelector('#music-loading').hidden=true;
  stage.querySelector('.theme-switch').innerHTML=['day','night'].map((mode,index)=>'<button data-theme="'+mode+'" aria-pressed="'+!index+'"><i class="theme-dot '+mode+'"></i><span>'+['LIGHT','DARK'][index]+'</span></button>').join('');
  stage.dataset.design='rhine';stage.dataset.page='music';stage.dataset.mode='archive';stage.dataset.theme='day';stage.dataset.styleTextScale='1';
  stage.querySelector('#selection-code').firstChild.textContent='ALBUM NO. ';
  stage.querySelector('#genre-position').firstChild.textContent='SHELF ';
  for(const [id,value] of Object.entries({'selection-artist':'G.E.M.邓紫棋','selection-meta':'2010 / 14 首曲目 / 51:25','selection-genre':'2000s · 2010s','genre-name':'2000s · 2010s','selection-total':'20'})) document.getElementById(id).textContent=value;
  const textMotion=setupMusicTextMotion(stage);
  const ticks=document.querySelector('#album-ticks');ticks.className='music-ruler';ticks.style.width='221px';
  stage.dataset.design='archive';
  const title=setupMusicTitleLayout(stage);title.update('18 Plus',false);
  document.querySelector('#selection-title').insertAdjacentHTML('beforeend','<span class="source-audio-badges">'+hiResBadgeMarkup('album','selection-hi-res',true)+dsdBadgeMarkup('album','selection-dsd',true)+'</span>');
  document.querySelector('#music-playback').hidden=false;
  stage.dataset.layout='desktop';stage.dataset.playbackVisible='false';
  document.querySelector('#selection-title').dataset.hiRes='false';document.querySelector('#selection-title').dataset.dsd='false';
  document.querySelector('#selection-hi-res').hidden=true;document.querySelector('#selection-dsd').hidden=true;
  const profile=document.querySelector('#selection-profile');profile.hidden=false;
  let sharedPanel,albumPanel,activationBefore,glassBaseline,openAlbumButton,glassCssSnapshot,fixtureReducedMotion=false;
  let playerState;
  const preferences={style:{scheme:'flare',caseStyle:'white',get design(){return stage.dataset.design;}},theme:'day',reduced:false,view:musicApplication.view,foobarArchive:getFoobarCatalogOptions(),output:{}};
  const scene={
    get musicDisplayLayout(){return {effective:musicApplication.view.layout};},
    setMusicStyle(){},
    setCaseSettings(){return Promise.resolve();},
  };
  const trackFocus={cancel(){}};
  const sonyTechMarkup='';
  const updatePlayingRows=()=>{};
  const updateSonyTechIndicators=()=>{};
  const albumMock={id:'fixture-album',title:'18 Plus',artist:'G.E.M.邓紫棋',year:2010,genreId:'pop',rawGenres:['流行'],discCount:1,folder:'example',producers:[],description:'一段用于检查专辑介绍和滚动焦点的示例文字。'.repeat(50),tracks:Array.from({length:30},(_,index)=>({id:'track-'+index,albumId:'fixture-album',title:['写不完的温柔','All About U','Game Over'][index%3]+' '+(index+1),artist:'G.E.M.邓紫棋',duration:180,trackNumber:index+1,format:'FLAC',sampleRate:192000,bitsPerSample:24,numberOfChannels:2,bitrate:4500000,lossless:true,browserPlayable:true}))};
  records.push({id:albumMock.id,album:albumMock},{id:'fixture-album-2',album:{...albumMock,id:'fixture-album-2',title:'Other Album'}});
  const currentAlbum=()=>albumMock;
  const profileMarkup=design=>'<div class="selection-profile-heading"><span>PROFILE</span><span>ARC-0001</span></div><dl>'+albumProfileFields(albumMock).map(([label,value])=>'<div><dt>'+esc(design==='archive'?label.split(' / ')[0]:label)+'</dt><dd data-cjk="'+containsCjk(value)+'">'+esc(value)+'</dd></div>').join('')+'</dl>';
  function renderSharedTab(tab) {
    const previous=musicApplication.activeTab;musicApplication.activeTab=tab;
    stage.querySelectorAll('[data-tab]').forEach(button=>{button.setAttribute('aria-selected',String(button.dataset.tab===tab));button.tabIndex=button.dataset.tab===tab?0:-1;});
    const body=stage.querySelector('#album-tab-content');body.innerHTML=tab==='tracks'?trackList(albumMock,1):albumAbout(albumMock);
    sharedPanel?.scanTab(previous,tab);
  }
  if(${sharedMode}) {
    sharedPanel=setupAlbumPanel(stage,()=>fixtureReducedMotion);
    albumPanel=sharedPanel;
    const article=stage.querySelector('#album-detail-content');
    openAlbumButton=stage.querySelector('.open-album');
    profile.innerHTML=profileMarkup('rhine');profile.hidden=false;
    stage.dataset.design='rhine';
    renderDetail();
    await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    glassCssSnapshot=()=>Object.fromEntries(['.music-topnav','.music-navigation','.music-keyhint','.album-callout','.open-album','#album-detail-content','.music-tabs','.music-tab-indicator'].map(selector=>{
      const element=stage.querySelector(selector);if(!element)return[selector,null];
      const style=getComputedStyle(element),parent=element.parentElement;
      const properties=['display','position','left','right','top','bottom','boxSizing','margin','padding','border','borderBottom','gap','gridTemplateColumns','fontFamily','fontSize','lineHeight','color','backgroundColor','transform','zIndex','overflow'];
      return[selector,{parent:parent?.id||parent?.className||parent?.tagName,...Object.fromEntries(properties.map(name=>[name,style[name]]))}];
    }));
    const scene=stage.querySelector('#three-scene'),callout=stage.querySelector('.album-callout');
    activationBefore={panelConnected:sharedPanel.element.isConnected,panelHidden:sharedPanel.element.hidden,containsCallout:sharedPanel.element.contains(callout),containsArticle:sharedPanel.element.contains(article),calloutParent:callout.parentElement?.id,articleParent:article.parentElement?.id,openButtonConnected:openAlbumButton?.isConnected??false,marker:stage.hasAttribute('data-album-panel'),sceneTabindex:scene.getAttribute('tabindex')};
    glassBaseline={viewport:{width:innerWidth,height:innerHeight},calloutParent:callout.parentElement?.id,articleParent:article.parentElement?.id,openButtonConnected:openAlbumButton?.isConnected??false,sceneTabindex:scene.getAttribute('tabindex'),css:glassCssSnapshot()};
    stage.dataset.design='archive';profile.innerHTML=profileMarkup('archive');profile.hidden=false;renderDetail();
    sharedPanel.setActive(true);
    sharedPanel.contentChanged(albumMock.id);
  }
  const shell=setupFoobarShell(stage,{search(){},shuffle(){},order(){}});shell.setActive(true);
  const foobarShell=shell;
  catalogGrid=setupMusicCatalogGrid(stage,stage.querySelector('.foobar-grid-host'));
  catalogGrid.setDesign(preferences.style.design);
  let displayStyleHost;
  let musicSortAlias;
  const renderProductionStylePage=(design,visible=false)=>{
    if(visible){page='theme';stage.dataset.page='theme';}
    stage.dataset.design=design;
    const themePage=stage.querySelector('#music-theme-page'),content=stage.querySelector('#theme-page-content');
    themePage.hidden=!visible;themePage.inert=!visible;
    const style=design==='archive'?archiveMusicStyle:defaultMusicStyle;
    content.innerHTML=musicStyleMarkup(style,'day');
    content.querySelector('#theme-quality-slot')?.insertAdjacentHTML('beforebegin',musicViewControlsMarkup(musicApplication.view,musicApplication.query));
    displayStyleHost=content;
    if(visible)content.querySelector('.music-view-controls')?.scrollIntoView({block:'center',inline:'center'});
  };
  if(${displayMode}) {
    renderProductionStylePage('archive',false);
    // This mock settings select drives the real production change listener;
    // its value is only an alias for the public group/sort pair.
    musicSortAlias=document.createElement('select');musicSortAlias.id='music-sort';
    musicSortAlias.innerHTML='<option value="genre">Genre</option><option value="artist">Artist</option><option value="album">Album</option>';
    const aliasHost=document.createElement('div');aliasHost.hidden=true;aliasHost.append(musicSortAlias);stage.append(aliasHost);
  }
  const ranges=setupEditableRanges(stage);
  let coverURL;
  const playbackControls=setupMusicPlayback(document.querySelector('#music-playback'),{seek(){},volume(){},cover(){return coverURL;}});
  let refreshed=0,navigated='',coverInspection;
  const closeManagementPage=()=>{};
  const locatePlaying=(albumId,trackId)=>{coverInspection=[albumId,trackId];};
  const openArchivePage=()=>{coverInspection=['focused'];};
  const setMode=mode=>{coverInspection??=[];coverInspection.push(mode);musicApplication.mode=mode;stage.dataset.mode=mode;};
  const audioInfoPopup=setupAudioInfoPopup(stage,{refresh(){refreshed++;},navigate(category,target){navigated=target;}});
  const albumQueue=setupAlbumQueue(stage,{albumFor:id=>id===albumMock.id?albumMock:undefined,play:(id,tracks)=>player.play(id,tracks),closeOther:()=>audioInfoPopup.close(false)});
  document.addEventListener('click',event=>{const target=event.target.closest('button,[data-action]');if(!target)return;const action=target.dataset.action;
    if(action==='playback-queue'){albumQueue.toggle(target);return;}
    if(${sharedMode}&&target.dataset.tab){renderSharedTab(target.dataset.tab);return;}
    if(${sharedMode}&&target.dataset.track){playAlbum(target.dataset.track);return;}
    ${main.match(/if \(action === "audio-info"\) \{[^\n]+\}/)[0]}
    switch(action){${main.match(/case "locate-playing": \{[\s\S]*?\n    \}/)[0]}}
  });
  ${productionViewEvents}
  const track={id:'fixture-flac',albumId:'fixture-album',title:'测试曲目',artist:'测试歌手',format:'FLAC',codec:'FLAC',relativePath:'fixture.flac',sampleRate:44100,bitsPerSample:16,numberOfChannels:2,bitrate:900000,lossless:true};
  const state={transport:'playing',currentTrack:track,queue:[track],currentIndex:0,playbackOrder:'default',playing:true,loading:false,duration:180,currentTime:0,volume:.65,songFadeEnabled:true,bgmVolume:.18,bgmEnabled:true,bgmPlaying:false,error:null,bgmError:null,sonySettings:{dsee:false,dc:0,vinyl:0},sonyExecution:{streaming:true,parallel:true},sonyProcessing:{state:'off',progress:0},backend:'browser',outputSettings:outputDefault,volumeLocked:false};
  const selection={number:4,total:20,code:1,genreIndex:1,genresTotal:3,genre:'2000s · 2010s',genreName:'2000s · 2010s',format:'FLAC',artist:'G.E.M.邓紫棋',meta:'2010 / 14 首曲目 / 51:25'};
  textMotion.update(selection,true);
  playerState=state;
  catalogGrid.setDesign(preferences.style.design);
  syncMusicCatalogView();
  let albumSteps=0,shelfSteps=0;
  const input=sharedPanel?setupAlbumInteraction(stage,{enabled:()=>stage.dataset.page==='music'&&(stage.dataset.design==='archive'||stage.dataset.design==='rhine'),stepAlbum:direction=>{albumSteps+=direction;},stepShelf:direction=>{shelfSteps+=direction;},scrollTarget:()=>sharedPanel.scrollTarget(),tab:direction=>renderSharedTab(direction<0?'tracks':'about')}):undefined;
  window.fixture={stage,shell,title,textMotion,selection,audioInfoPopup,albumQueue,albumMock,state,musicApplication,records,playbackControls,foobarArchiveWidth,sharedPanel,input,played,ranges,renderSharedTab,renderSourceDetail:renderDetail,renderProfile:profileMarkup,activationBefore,glassBaseline,glassCssSnapshot,openAlbumButton,SurfaceTransition,catalogGrid,applyMusicView,syncMusicCatalogView,stepAlbum,stepGenre,syncDesignIdentity,musicArrangementPreset,musicStyleMarkup,renderProductionStylePage,musicViewControlsMarkup,syncMusicViewControls,displayStyleHost,musicSortAlias,scene,preferences,navigationCalls,focusMusicEntry,get focusedEntry(){return getMusicFocusedEntry(musicApplication.selectedIndex);},get savedPreferenceCount(){return savedPreferenceCount;},setPage(value){page=value;stage.dataset.page=value;},get albumSteps(){return albumSteps;},get shelfSteps(){return shelfSteps;},setReduced(value){fixtureReducedMotion=Boolean(value);},updatePlayback(value){playerState=value;playbackControls.update(value);albumQueue.update(value);},set coverURL(value){coverURL=value;},get refreshed(){return refreshed;},get navigated(){return navigated;},get coverInspection(){return coverInspection;}};
  ${navigationBootstrap}
})();`;

const profile = path.join(output, `browser-profile-${process.pid}-${Date.now()}`);
const browser = spawn(executable, ["--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--no-first-run",
  "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
  "--disable-sync", "--disable-extensions", `--user-data-dir=${profile}`],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let browserErrors="";browser.stderr.on("data",chunk=>{browserErrors=(browserErrors+chunk).slice(-2000);});
browser.on("error",error=>{browserErrors=error.message;});
let socket;
let sequence = 0;
const pending = new Map();
function receive(event) {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry=pending.get(message.id);pending.delete(message.id);clearTimeout(entry.timer);
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
}
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {pending.delete(id);reject(new Error(`CDP timeout: ${method}`));}, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
}
const results=[];
try {
  const portFile=path.join(profile,"DevToolsActivePort");
  for(let attempt=0;attempt<50;attempt++) {
    if(await stat(portFile).then(()=>true,()=>false))break;
    if(browser.exitCode!==null)throw new Error(`Browser exited: ${browserErrors}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const [port,endpoint]=await readFile(portFile,"utf8").catch(()=>{throw new Error(`Browser debugging port unavailable: ${browserErrors}`);}).then(value=>value.trim().split(/\r?\n/));
  socket=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  socket.addEventListener("message",receive);
  await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  const {targetId}=await send("Target.createTarget",{url:"about:blank"});
  const {sessionId}=await send("Target.attachToTarget",{targetId,flatten:true});
  const command=(method,params)=>send(method,params,sessionId);
  async function evaluate(expression) {
    const result=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.text+": "+result.exceptionDetails.exception?.description);
    return result.result.value;
  }
  await command("Page.enable",{});
  const {frameTree}=await command("Page.getFrameTree",{});
  await command("Page.setDocumentContent",{frameId:frameTree.frame.id,html:`<!doctype html><style>${css}</style><main id="stage" class="music-app"></main>`});
  await evaluate(initialize);
  if(glassMode) {
    await checkTerminalGlassProbe({command,evaluate,output:path.join(output,"terminal-glass",process.argv.includes('--baseline')?'baseline':'current'),project});
  } else {
  if(sharedMode) {
    const before=await evaluate(`fixture.activationBefore`);
    assert.equal(before.panelHidden,true,"Creating the archive panel must leave the glass layout inactive");
    assert.equal(before.containsCallout,false);assert.equal(before.containsArticle,false);
    assert.equal(before.calloutParent,'music-browse');assert.equal(before.articleParent,'music-detail');
    assert.equal(before.openButtonConnected,true);assert.equal(before.marker,false);
    assert.equal(before.sceneTabindex,await evaluate(`fixture.glassBaseline.sceneTabindex`));
    const active=await evaluate(`(()=>{const controller=fixture.sharedPanel,panel=controller.element,callout=document.querySelector('.album-callout'),article=document.querySelector('#album-detail-content'),button=fixture.openAlbumButton,scene=document.querySelector('#three-scene'),viewport=panel.querySelector('.album-panel-scroll');return {active:controller.active,panelConnected:panel.isConnected,panelHidden:panel.hidden,containsCallout:panel.contains(callout),containsArticle:panel.contains(article),openButtonConnected:button.isConnected,openButtonVisible:button.isConnected&&!button.hidden&&button.getClientRects().length>0,openButtonCount:document.querySelectorAll('.open-album').length,playButtonCount:document.querySelectorAll('.browse-play-album').length,profileVisible:!document.querySelector('#selection-profile').hidden,articleHidden:article.hidden,articleInert:article.inert,articleHasTabs:!!article.querySelector('.music-tabs'),articleRows:article.querySelectorAll('.track-row').length,noVisibleRows:[...article.querySelectorAll('.track-row')].every(row=>row.getClientRects().length===0),marker:fixture.stage.hasAttribute('data-album-panel'),sceneTabindex:scene.getAttribute('tabindex'),scrollTargetIsViewport:controller.scrollTarget()===viewport};})()`);
    assert.equal(active.active,true);assert.equal(active.panelConnected,true);assert.equal(active.panelHidden,false);
    assert.equal(active.containsCallout,true);assert.equal(active.containsArticle,true);
    assert.equal(active.openButtonConnected,true);assert.equal(active.openButtonVisible,true);assert.equal(active.openButtonCount,1);assert.equal(active.playButtonCount,0);
    assert.equal(active.profileVisible,true);assert.equal(active.articleHidden,true);assert.equal(active.articleInert,true);
    assert.equal(active.articleHasTabs,true);assert.equal(active.articleRows,30);assert.equal(active.noVisibleRows,true);
    assert.equal(active.marker,true);assert.equal(active.sceneTabindex,'-1');assert.equal(active.scrollTargetIsViewport,true);
  }
  if(displayMode) {
    await command("Emulation.setDeviceMetricsOverride",{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.renderProductionStylePage('archive',true);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    const before=await evaluate(`(()=>{
      fixture.setPage('theme');fixture.musicApplication.mode='detail';fixture.stage.dataset.mode='detail';
      fixture.sharedPanel.setOpen(true);fixture.musicApplication.activeTab='about';fixture.renderSharedTab('about');
      const scroll=fixture.sharedPanel.scrollTarget();scroll.scrollTop=Math.min(60,scroll.scrollHeight);
      const article=document.querySelector('#album-detail-content'),body=document.querySelector('#album-tab-content'),panel=document.querySelector('.album-panel'),callout=document.querySelector('.album-callout'),controls=fixture.displayStyleHost.querySelector('.music-view-controls');
      window.displayBefore={article,body,panel,callout,controls,scroll,scrollTop:scroll.scrollTop,trackId:fixture.musicApplication.catalogFocus.trackId,records:fixture.records};
      return {layout:fixture.musicApplication.view.layout,trackId:fixture.musicApplication.catalogFocus.trackId,tab:fixture.musicApplication.activeTab,controls:fixture.displayStyleHost.querySelectorAll('[data-music-layout]').length};
    })()`);
    assert.equal(before.layout,'shelf');assert.equal(before.trackId,'fixture-flac');assert.equal(before.tab,'about');assert.equal(before.controls,3,
      'The actual STYLE markup provides the neutral layout controls.');
    await evaluate(`document.querySelector('[data-music-layout="grid"]').click()`);
    const layoutOnly=await evaluate(`(()=>{const before=window.displayBefore,host=document.querySelector('.music-catalog-grid-host');return {
      layout:fixture.musicApplication.view.layout,mode:fixture.musicApplication.mode,trackId:fixture.musicApplication.catalogFocus.trackId,
      articleSame:before.article===document.querySelector('#album-detail-content'),bodySame:before.body===document.querySelector('#album-tab-content'),
      panelSame:before.panel===document.querySelector('.album-panel'),controlsSame:before.controls===fixture.displayStyleHost.querySelector('.music-view-controls'),tab:fixture.musicApplication.activeTab,scrollSame:before.scroll.scrollTop===before.scrollTop,
      hostHidden:host.hidden,pressed:fixture.displayStyleHost.querySelector('[data-music-layout="grid"]').getAttribute('aria-pressed'),
      saves:fixture.savedPreferenceCount,musicLayout:fixture.stage.dataset.musicLayout};})()`);
    assert.equal(layoutOnly.layout,'grid');assert.equal(layoutOnly.musicLayout,'grid');assert.equal(layoutOnly.pressed,'true');
    assert.equal(layoutOnly.mode,'detail');assert.equal(layoutOnly.trackId,'fixture-flac');assert.equal(layoutOnly.tab,'about');assert.equal(layoutOnly.controlsSame,true);
    assert.equal(layoutOnly.articleSame,true);assert.equal(layoutOnly.bodySame,true);assert.equal(layoutOnly.panelSame,true);
    assert.equal(layoutOnly.scrollSame,true);assert.equal(layoutOnly.hostHidden,true);assert.ok(layoutOnly.saves>0);

    const changeField=async(field,value)=>evaluate(`(()=>{const control=fixture.displayStyleHost.querySelector('[data-music-view-field="${field}"]');control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await changeField('show','tracks');
    await changeField('group','artist');
    await changeField('sort','title');
    await evaluate(`(()=>{const input=fixture.displayStyleHost.querySelector('[data-music-catalog-query]');input.value='Needle';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await new Promise(resolve=>setTimeout(resolve,240));
    const controlsState=await evaluate(`(()=>({view:{...fixture.musicApplication.view},query:fixture.musicApplication.query,trackId:fixture.musicApplication.catalogFocus.trackId,
      selects:[...fixture.displayStyleHost.querySelectorAll('[data-music-view-field]')].map(control=>control.value),queryInput:fixture.displayStyleHost.querySelector('[data-music-catalog-query]').value}))()`);
    assert.deepEqual(controlsState.view,{layout:'grid',show:'tracks',group:'artist',sort:'title'});
    assert.equal(controlsState.query,'Needle');assert.equal(controlsState.queryInput,'Needle');
    assert.deepEqual(controlsState.selects,['tracks','artist','title']);assert.equal(controlsState.trackId,'fixture-flac',
      'SHOW/GROUP/SORT/query updates retain the selected track identity.');
    const sortAliases=[];
    for(const [value,group,sort] of [['album','none','title'],['genre','genre','artist'],['artist','artist','title']]) {
      await evaluate(`(()=>{const control=fixture.musicSortAlias;control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      sortAliases.push(await evaluate(`({value:fixture.musicSortAlias.value,group:fixture.musicApplication.view.group,sort:fixture.musicApplication.view.sort,preset:fixture.musicArrangementPreset(),query:fixture.musicApplication.query,track:fixture.musicApplication.catalogFocus.trackId,sameRecords:window.displayBefore.records===fixture.records,hasIndependentPreference:Object.hasOwn(fixture.preferences,'musicSort')})`));
      assert.equal(sortAliases.at(-1).group,group);assert.equal(sortAliases.at(-1).sort,sort);
      assert.equal(sortAliases.at(-1).preset,value);assert.equal(sortAliases.at(-1).query,'Needle');
      assert.equal(sortAliases.at(-1).track,'fixture-flac');assert.equal(sortAliases.at(-1).sameRecords,true);assert.equal(sortAliases.at(-1).hasIndependentPreference,false);
    }

    const gridArchive=await evaluate(`(()=>{
      fixture.musicApplication.mode='archive';fixture.stage.dataset.mode='archive';fixture.sharedPanel.setOpen(false);fixture.syncMusicCatalogView();
      window.displayGridHost=document.querySelector('.music-catalog-grid-host');
      return {sameCards:window.displayGridHost.querySelectorAll('.foobar-grid-card').length,selected:window.displayGridHost.querySelector('.foobar-grid-card[aria-pressed="true"]')?.dataset.foobarEntry,
        parentIsWorkspace:window.displayGridHost.parentElement===document.querySelector('.foobar-workspace'),themeRadius:getComputedStyle(fixture.displayStyleHost.querySelector('.music-view-controls')).borderRadius};
    })()`);
    assert.equal(gridArchive.sameCards,3);assert.equal(gridArchive.selected,'track|fixture-album|fixture-flac');
    assert.equal(gridArchive.parentIsWorkspace,true);assert.equal(gridArchive.themeRadius,'0px');
    const rhine=await evaluate(`(()=>{fixture.stage.dataset.design='rhine';fixture.syncDesignIdentity();fixture.syncMusicCatalogView();return {
      sameNode:window.displayGridHost===document.querySelector('.music-catalog-grid-host'),parentIsRoot:window.displayGridHost.parentElement===fixture.stage,
      controls:fixture.displayStyleHost.querySelectorAll('[data-music-layout]').length,radius:getComputedStyle(fixture.displayStyleHost.querySelector('.music-view-controls')).borderRadius,
      articleSame:window.displayBefore.article===document.querySelector('#album-detail-content')};})()`);
    assert.equal(rhine.sameNode,true);assert.equal(rhine.parentIsRoot,true);assert.equal(rhine.controls,3);assert.equal(rhine.radius,'14px');
    assert.equal(rhine.articleSame,true,'Theme changes move the existing grid and preserve the existing right-side DOM.');
    const archive=await evaluate(`(()=>{fixture.stage.dataset.design='archive';fixture.syncDesignIdentity();fixture.syncMusicCatalogView();return {
      sameNode:window.displayGridHost===document.querySelector('.music-catalog-grid-host'),parentIsWorkspace:window.displayGridHost.parentElement===document.querySelector('.foobar-workspace'),
      articleSame:window.displayBefore.article===document.querySelector('#album-detail-content')};})()`);
    assert.equal(archive.sameNode,true);assert.equal(archive.parentIsWorkspace,true);assert.equal(archive.articleSame,true);

    const themeEscape=await evaluate(`(()=>{fixture.musicApplication.mode='detail';fixture.stage.dataset.mode='detail';fixture.setPage('theme');fixture.sharedPanel.setOpen(true);
      const input=fixture.displayStyleHost.querySelector('[data-music-catalog-query]'),event=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});input.dispatchEvent(event);
      return {mode:fixture.musicApplication.mode,prevented:event.defaultPrevented,route:fixture.coverInspection?.at(-1)};})()`);
    assert.equal(themeEscape.mode,'detail');assert.equal(themeEscape.prevented,true);
    const albumEscape=await evaluate(`(()=>{fixture.setPage('music');const event=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});document.dispatchEvent(event);
      return {mode:fixture.musicApplication.mode,prevented:event.defaultPrevented,route:fixture.coverInspection?.at(-1)};})()`);
    assert.equal(albumEscape.mode,'archive');assert.equal(albumEscape.prevented,true);assert.equal(albumEscape.route,'archive');

    const navigation=await evaluate(`(()=>{fixture.musicApplication.selectedIndex=0;fixture.musicApplication.selectedAlbumId='fixture-album';fixture.focusMusicEntry('track|fixture-album|fixture-flac');
      fixture.navigationCalls.length=0;fixture.stepAlbum(1);const album={index:fixture.musicApplication.selectedIndex,key:fixture.musicApplication.catalogFocus.entryKey,track:fixture.musicApplication.selectedTrackId};
      fixture.stepGenre(-1);const shelf={index:fixture.musicApplication.selectedIndex,key:fixture.musicApplication.catalogFocus.entryKey,track:fixture.musicApplication.selectedTrackId};
      return {album,shelf,calls:fixture.navigationCalls};})()`);
    assert.deepEqual(navigation.album,{index:1,key:'track|fixture-album-2|fixture-track-3',track:'fixture-track-3'});
    assert.deepEqual(navigation.shelf,{index:0,key:'track|fixture-album|fixture-flac',track:'fixture-flac'});
    assert.deepEqual(navigation.calls,[[0,'row',1],[1,'lane',-1]],'Album and group controls call the public navigation helper.');

    const controlShots=[];
    for(const design of ['rhine','archive']) {
      await evaluate(`fixture.renderProductionStylePage(${JSON.stringify(design)},true);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const geometry=await evaluate(`(()=>{
        const controls=document.querySelector('#theme-page-content .music-view-controls'),r=controls.getBoundingClientRect();
        const descendants=[...controls.querySelectorAll('*')].map(element=>element.getBoundingClientRect()).filter(box=>box.width>0&&box.height>0);
        const noChildOverflow=descendants.every(box=>box.left>=r.left-1&&box.right<=r.right+1);
        return {visible:controls.getClientRects().length>0&&getComputedStyle(controls).display!=='none'&&r.width>0&&r.height>0,
          noHorizontalOverflow:controls.scrollWidth<=controls.clientWidth+1&&noChildOverflow,
          rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:controls.scrollWidth,clientWidth:controls.clientWidth},
          layoutChoices:controls.querySelectorAll('[data-music-layout]').length,
          fields:controls.querySelectorAll('[data-music-view-field]').length,
          pageVisible:!document.querySelector('#music-theme-page').hidden};
      })()`);
      assert.equal(geometry.visible,true,`${design}: STYLE view controls must be visible in the production page frame.`);
      assert.equal(geometry.noHorizontalOverflow,true,`${design}: STYLE view controls must fit without horizontal overflow: ${JSON.stringify(geometry.rect)}`);
      assert.equal(geometry.pageVisible,true);assert.equal(geometry.layoutChoices,3);assert.equal(geometry.fields,3);
      const x=Math.max(0,Math.floor(geometry.rect.x-12)),y=Math.max(0,Math.floor(geometry.rect.y-12));
      const clip={x,y,width:Math.max(1,Math.min(1920-x,Math.ceil(geometry.rect.width+24))),height:Math.max(1,Math.min(1080-y,Math.ceil(geometry.rect.height+24))),scale:1};
      const {data}=await command('Page.captureScreenshot',{format:'png',clip});
      const screenshot=`display-${design}-controls.png`;
      await writeFile(path.join(output,screenshot),Buffer.from(data,'base64'));
      controlShots.push({design,...geometry,screenshot});
    }

    const gridShots=[];
    for(const design of ['archive','rhine']) {
      await evaluate(`(()=>{
        const theme=document.querySelector('#music-theme-page');theme.hidden=true;theme.inert=true;
        fixture.setPage('music');fixture.musicApplication.mode='archive';fixture.stage.dataset.mode='archive';fixture.stage.dataset.design=${JSON.stringify(design)};
        fixture.sharedPanel.setOpen(false);fixture.syncDesignIdentity();fixture.syncMusicCatalogView();
      })()`);
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const geometry=await evaluate(`(()=>{
        const host=document.querySelector('.music-catalog-grid-host'),r=host.getBoundingClientRect(),title=document.querySelector('#selection-title'),i=title.getBoundingClientRect();
        const cards=host.querySelectorAll('.foobar-grid-card');
        return {visible:!host.hidden&&getComputedStyle(host).display!=='none'&&r.width>0&&r.height>0,
          rightInfoVisible:title.getClientRects().length>0&&getComputedStyle(title).display!=='none'&&i.width>0,
          rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},
          infoRect:{x:i.x,y:i.y,right:i.right,bottom:i.bottom,width:i.width,height:i.height},
          cardCount:cards.length,selected:host.querySelector('.foobar-grid-card[aria-pressed="true"]')?.dataset.foobarEntry,
          legacyLayoutHidden:getComputedStyle(document.querySelector('.foobar-catalog-control[aria-label="LAYOUT"]')).display==='none',
          hostParent:host.parentElement?.className||host.parentElement?.id||host.parentElement?.tagName};
      })()`);
      assert.equal(geometry.visible,true,`${design}: grid must be visible in archive browsing mode.`);
      assert.equal(geometry.rightInfoVisible,true,`${design}: the existing right-side album information must remain visible.`);
      assert.ok(geometry.rect.x>=0&&geometry.rect.right<=1920&&geometry.rect.y>=0&&geometry.rect.bottom<=1080,
        `${design}: grid bounds must stay inside the 1920×1080 viewport.`);
      assert.equal(geometry.cardCount,3);assert.equal(geometry.selected,'track|fixture-album|fixture-flac');
      if(design==='archive')assert.equal(geometry.legacyLayoutHidden,true,'Punk layout selection belongs to STYLE only.');
      const {data}=await command('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1920,height:1080,scale:1}});
      const screenshot=`display-${design}-grid.png`;
      await writeFile(path.join(output,screenshot),Buffer.from(data,'base64'));
      gridShots.push({design,...geometry,screenshot});
    }

    await evaluate(`(()=>{fixture.setPage('music');fixture.musicApplication.mode='archive';fixture.stage.dataset.mode='archive';fixture.stage.dataset.design='rhine';fixture.syncDesignIdentity();fixture.syncMusicCatalogView();})()`);
    const browseControlState=[];
    for(const [field,value] of [['show','albums'],['group','decade'],['sort','added']]) {
      await evaluate(`document.querySelector('.music-browse-tools [data-music-browse-field="${field}"][data-value="${value}"]').click()`);
      const state=await evaluate(`(()=>({field:${JSON.stringify(field)},value:${JSON.stringify(value)},view:{...fixture.musicApplication.view},styleValue:fixture.displayStyleHost.querySelector('[data-music-view-field="${field}"]').value,
        pressed:document.querySelector('.music-browse-tools [data-music-browse-field="${field}"][data-value="${value}"]').getAttribute('aria-pressed'),track:fixture.musicApplication.catalogFocus.trackId}))()`);
      assert.equal(state.view[field],value,`${field}: Future browse click updates public view state.`);
      assert.equal(state.styleValue,value,`${field}: Future browse click synchronizes STYLE.`);
      assert.equal(state.pressed,'true',`${field}: the selected Future browse button is pressed.`);
      assert.equal(state.track,'fixture-flac',`${field}: browse changes retain track identity.`);
      browseControlState.push(state);
    }

    const browseShots=[],detailShots=[];
    for(const theme of ['day','night']) {
      await evaluate(`(()=>{
        fixture.setPage('music');fixture.stage.dataset.theme=${JSON.stringify(theme)};fixture.stage.dataset.design='rhine';fixture.stage.dataset.mode='archive';fixture.musicApplication.mode='archive';
        fixture.applyMusicView({layout:'grid'});fixture.sharedPanel.setOpen(false);fixture.sharedPanel.finish();fixture.syncDesignIdentity();fixture.syncMusicCatalogView();
      })()`);
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const browse=await evaluate(`(()=>{
        const tools=document.querySelector('.music-browse-tools'),r=tools.getBoundingClientRect(),button=document.querySelector('.album-panel .open-album'),label=button.querySelector('.open-album-access-label'),s=getComputedStyle(button),lr=label.getBoundingClientRect();
        const status=document.querySelector('.library-status').getBoundingClientRect(),grid=document.querySelector('.music-catalog-grid-host').getBoundingClientRect(),panel=document.querySelector('.album-panel').getBoundingClientRect();
        return{theme:fixture.stage.dataset.theme,design:fixture.stage.dataset.design,mode:fixture.stage.dataset.mode,display:getComputedStyle(tools).display,
          toolsRect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},button:{aria:button.getAttribute('aria-label'),visible:!button.hidden&&button.getClientRects().length>0,
            label:label.textContent.trim(),labelDisplay:getComputedStyle(label).display,fontSize:parseFloat(s.fontSize),width:parseFloat(s.width),height:parseFloat(s.height),borderRadius:s.borderRadius,labelRect:{width:lr.width,height:lr.height}},
          clearOfStatus:status.bottom<=r.top||status.right<=r.left||status.left>=r.right,
          clearOfGrid:r.bottom<=grid.top,clearOfPanel:r.right<=panel.left,
          gridCards:document.querySelectorAll('.music-catalog-grid-host .foobar-grid-card').length};
      })()`);
      assert.equal(browse.design,'rhine');assert.equal(browse.mode,'archive');assert.notEqual(browse.display,'none',`Future browse tools must be visible in ${theme}.`);
      assert.ok(browse.toolsRect.x>=0&&browse.toolsRect.x<400&&browse.toolsRect.y>=0&&browse.toolsRect.y<200,`${theme}: Future browse controls stay in the upper-left.`);
      for(const key of ['clearOfStatus','clearOfGrid','clearOfPanel'])assert.equal(browse[key],true,`${theme}: browse tools ${key}`);
      assert.equal(browse.button.aria,'打开专辑');assert.equal(browse.button.visible,true);assert.equal(browse.button.label,'ACCESS ALBUM');
      assert.notEqual(browse.button.labelDisplay,'none');assert.ok(browse.button.labelRect.width>0);assert.ok(browse.button.fontSize<=14);
      assert.ok(browse.button.width<=200&&browse.button.height<=48,JSON.stringify(browse.button));assert.equal(browse.button.borderRadius,'0px');
      assert.ok(browse.gridCards>0,`${theme}: browse screenshot includes the mock grid cards.`);
      const browseScreenshot=`display-future-${theme}-browse.png`;
      const browsePng=await command('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1920,height:1080,scale:1}});
      await writeFile(path.join(output,browseScreenshot),Buffer.from(browsePng.data,'base64'));
      browseShots.push({...browse,screenshot:browseScreenshot});

      await evaluate(`(()=>{fixture.musicApplication.mode='detail';fixture.stage.dataset.mode='detail';fixture.sharedPanel.setOpen(true);fixture.sharedPanel.finish();fixture.renderSharedTab('tracks');fixture.sharedPanel.finish();fixture.sharedPanel.scrollTarget().scrollTop=0;fixture.syncMusicCatalogView();})()`);
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const detail=await evaluate(`(()=>{
        const panel=document.querySelector('.album-panel'),article=document.querySelector('#album-detail-content'),callout=document.querySelector('.album-callout'),button=callout.querySelector('.open-album'),before=getComputedStyle(panel,'::before'),rows=article.querySelectorAll('.track-row');
        return{theme:fixture.stage.dataset.theme,design:fixture.stage.dataset.design,mode:fixture.stage.dataset.mode,panelState:panel.dataset.panelState,
          title:document.querySelector('#selection-title').textContent.trim(),artist:document.querySelector('#selection-artist .music-inline-plain').textContent.trim(),articleVisible:!article.hidden,rows:rows.length,articleSame:window.displayBefore.article===article,
          bodySame:window.displayBefore.body===document.querySelector('#album-tab-content'),panelSame:window.displayBefore.panel===panel,calloutSame:window.displayBefore.callout===callout,
          pseudoContent:before.content,pseudoDisplay:before.display,pseudoBorder:before.border,buttonHidden:button.hidden,trackIdentity:fixture.musicApplication.catalogFocus.trackId};
      })()`);
      assert.equal(detail.design,'rhine');assert.equal(detail.mode,'detail');assert.equal(detail.panelState,'expanded');assert.equal(detail.articleVisible,true);
      assert.equal(detail.rows,30);assert.equal(detail.articleSame,true);assert.equal(detail.bodySame,true);assert.equal(detail.panelSame,true);assert.equal(detail.calloutSame,true);
      assert.equal(detail.title,'18 Plus');assert.equal(detail.artist,'G.E.M.邓紫棋');assert.equal(detail.trackIdentity,'fixture-flac');
      assert.equal(detail.pseudoContent,'none',`${theme}: Future panel must not paint a pseudo-element glass frame.`);
      const detailScreenshot=`display-future-${theme}-detail.png`;
      const detailPng=await command('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1920,height:1080,scale:1}});
      await writeFile(path.join(output,detailScreenshot),Buffer.from(detailPng.data,'base64'));
      detailShots.push({...detail,screenshot:detailScreenshot});

      await evaluate(`(()=>{fixture.musicApplication.mode='archive';fixture.stage.dataset.mode='archive';fixture.sharedPanel.setOpen(false);fixture.sharedPanel.finish();fixture.stage.dataset.design='archive';fixture.syncDesignIdentity();fixture.syncMusicCatalogView();})()`);
      const punk=await evaluate(`(()=>{const b=document.querySelector('.album-panel .open-album');return{tools:getComputedStyle(document.querySelector('.music-browse-tools')).display,
        aria:b.getAttribute('aria-label'),label:b.querySelector('.open-album-label').textContent.trim(),labelDisplay:getComputedStyle(b.querySelector('.open-album-label')).display,
        accessDisplay:getComputedStyle(b.querySelector('.open-album-access-label')).display,fontSize:parseFloat(getComputedStyle(b).fontSize),radius:getComputedStyle(b).borderRadius};})()`);
      assert.equal(punk.tools,'none',`${theme}: Punk hides Future browse controls.`);assert.equal(punk.aria,'打开专辑');assert.equal(punk.label,'打开专辑');
      assert.notEqual(punk.labelDisplay,'none');assert.equal(punk.accessDisplay,'none');assert.ok(punk.fontSize>=18);assert.equal(punk.radius,'0px');
    }
    await writeFile(path.join(output,'display-controls.json'),JSON.stringify({viewport:{width:1920,height:1080},controls:controlShots,grids:gridShots,
      browseControls:browseControlState,futureBrowse:browseShots,futureDetail:detailShots},null,2));
    console.log('Passed --display and saved STYLE, grid, Future day/night browse/detail screenshots, and display-controls.json.');
  } else if(navigationMode) {
    const report=await checkManagementNavigation({command,evaluate,output});
    console.log(`Passed management navigation: ${report.cases.length} focused design, detail, Escape and ARCHIVE return cases; native ViewTransition ${report.nativeViewTransition?'available':'unavailable'}.`);
  } else {
  const sizes=[[1920,1080],[1440,900],[1280,720],[1251,700],[1024,700],[1024,576],[1001,700],[1000,700],[851,600],[850,600],[721,600],[720,600],[600,800],[480,700],[390,844],[320,568],[900,400],[568,320],[2560,1080]];
  for(const [width,height] of sizes) for(const playing of [false,true]) for(const badgeMode of ['none','hires','dsd']) {
    await command("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.stage.dataset.layout=${JSON.stringify(width/height<1.05?'portrait':width<1100?'compact':'desktop')};fixture.stage.dataset.playbackVisible='${playing}';document.querySelector('#selection-title').dataset.hiRes='${badgeMode!=='none'}';document.querySelector('#selection-title').dataset.dsd='${badgeMode==='dsd'}';document.querySelector('#selection-hi-res').hidden=${badgeMode==='none'};document.querySelector('#selection-dsd').hidden=${badgeMode!=='dsd'};fixture.textMotion.update({...fixture.selection,number:${playing?14:4}},true);fixture.title.update(${JSON.stringify(playing?'非常长的专辑标题用于验证窗口缩放后的换行与标题布局 (A Very Long Album Title)':'18 Plus')},false);window.dispatchEvent(new Event('resize'));new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
    const geometry=await evaluate(`(() => {
      const visible=element=>!!element&&getComputedStyle(element).display!=='none'&&element.getBoundingClientRect().width>0;
      const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const clipped=element=>{
        const r=rect(element);
        for(let parent=element.parentElement;parent&&parent!==document.body;parent=parent.parentElement){const style=getComputedStyle(parent),p=parent.getBoundingClientRect();
          if(style.overflowY!=='visible'){r.y=Math.max(r.y,p.y);r.bottom=Math.min(r.bottom,p.bottom);}
          if(style.overflowX!=='visible'){r.x=Math.max(r.x,p.x);r.right=Math.min(r.right,p.right);}
        }
        r.width=Math.max(0,r.right-r.x);r.height=Math.max(0,r.bottom-r.y);return r;
      };
      const selectors=['.foobar-header','.foobar-footer','.foobar-home-info','.foobar-home-navigation','.music-navigation','.album-stepper','.genre-stepper','#playback-toggle','.playback-volume','.playback-timeline','.foobar-mode-slot','.playback-info-trigger'];
      const boxes=Object.fromEntries(selectors.map(s=>[s,clipped(document.querySelector(s))]));
      const footer=[...document.querySelectorAll('.playback-song,.playback-buttons > button,.foobar-stop,.playback-timeline,.playback-volume,.playback-info-trigger,.foobar-shuffle,.foobar-dsp,.foobar-order,.foobar-mode-slot')].filter(visible).map(element=>({name:element.id||element.className||element.dataset.action,...rect(element)}));
      const nav=document.querySelector('.music-topnav');const navBounds=nav.parentElement.getBoundingClientRect();
      const header=[...nav.children].filter(visible).map(element=>({name:element.className,...rect(element),labels:[...element.querySelectorAll('span,small')].filter(visible).map(rect)}));
      const trigger=document.querySelector('.playback-info-trigger'),hit=rect(trigger);
      const info=document.querySelector('.foobar-home-info');
      const viewport=document.querySelector('.album-panel-scroll'),v=viewport?.getBoundingClientRect();
      const panelOverflow=viewport?{scroll:viewport.scrollWidth,width:viewport.clientWidth,offenders:[...viewport.querySelectorAll('*')].filter(element=>element.getBoundingClientRect().right>v.right+1).slice(0,8).map(element=>({name:element.id||element.className,rect:rect(element)}))}:null;
      return {boxes,footer,header,panelOverflow,navBounds:{x:navBounds.x,right:navBounds.right},probePosition:getComputedStyle(document.querySelector('.music-title-probe')).position,infoScroll:info.scrollHeight,infoClient:info.clientHeight,infoScrollWidth:info.scrollWidth,infoClientWidth:info.clientWidth,titleWidth:parseFloat(document.querySelector('#selection-title').style.getPropertyValue('--foobar-title-width')),titleBox:rect(document.querySelector('#selection-title')),badges:rect(document.querySelector('.source-audio-badges')),infoHit:document.elementFromPoint(hit.x+hit.width/2,hit.y+hit.height/2)?.closest('button')===trigger,bodyFont:getComputedStyle(document.querySelector('.album-callout')).fontFamily};
    })()`);
    const label=`${width}x${height} playback=${playing} badges=${badgeMode}`;
    results.push({width,height,playing,badgeMode,...geometry});
    const {boxes}=geometry;
    for(const name of ['.foobar-header','.foobar-footer','.foobar-home-info','.foobar-home-navigation']) {
      const r=boxes[name];assert.ok(r.x>=-1&&r.right<=width+1&&r.y>=-1&&r.bottom<=height+1,`${label} ${name} outside viewport: ${JSON.stringify(r)}`);
    }
    assert.equal(geometry.probePosition,'absolute',`${label}: title probe must not enter flow`);
    assert.ok(boxes['.foobar-home-info'].bottom<=boxes['.foobar-footer'].y+1,`${label}: info overlaps footer`);
    assert.ok(boxes['.foobar-home-navigation'].bottom<=boxes['.foobar-footer'].y+1,`${label}: navigation overlaps footer`);
    const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1;
    assert.ok(!overlap(boxes['.foobar-home-info'],boxes['.foobar-home-navigation']),`${label}: info overlaps navigation`);
    for(const a of geometry.footer) {
      assert.ok(a.x>=23&&a.right<=width-23&&a.y>=boxes['.foobar-footer'].y-1&&a.bottom<=height-31,`${label}: footer control out of its region ${JSON.stringify(a)}`);
      for(const b of geometry.footer)if(a!==b)assert.ok(!overlap(a,b),`${label}: footer overlap ${a.name} / ${b.name}`);
    }
    for(let i=1;i<geometry.header.length;i++)assert.ok(!overlap(geometry.header[i-1],geometry.header[i]),`${label}: adjacent header controls overlap`);
    for(const button of geometry.header)for(const text of button.labels)assert.ok(text.x>=button.x-1&&text.right<=button.right+1,`${label}: header label spills out of its button`);
    if(badgeMode!=='none')assert.ok(!overlap(geometry.titleBox,geometry.badges),`${label}: Hi-Res/DSD badges overlap the title`);
    assert.equal(boxes['#playback-toggle'].width,34,`${label}: toggle retains the source button size`);
    assert.equal(boxes['#playback-toggle'].height,34,`${label}: toggle must not inherit the glass minimum height`);
    assert.equal(boxes['.playback-info-trigger'].width,44,`${label}: information button needs a full hitbox`);
    assert.equal(boxes['.playback-info-trigger'].height,44,`${label}: information button needs a full hitbox`);
    assert.equal(geometry.infoHit,true,`${label}: information button center must receive pointer events`);
    assert.ok(geometry.infoScrollWidth<=geometry.infoClientWidth+1,`${label}: album information must not create a horizontal scrollbar`);
    if(geometry.panelOverflow)assert.ok(geometry.panelOverflow.scroll<=geometry.panelOverflow.width+1,`${label}: panel horizontal overflow ${JSON.stringify(geometry.panelOverflow)}`);
    const navigationReached=await evaluate(`(() => {
      const workspace=document.querySelector('.foobar-workspace');workspace.scrollTop=workspace.scrollHeight;
      const nav=document.querySelector('.foobar-home-navigation').getBoundingClientRect();
      const footer=document.querySelector('.foobar-footer').getBoundingClientRect();
      const header=document.querySelector('.foobar-header').getBoundingClientRect();
      const result=nav.top>=header.bottom-1&&nav.bottom<=footer.top+1;
      workspace.scrollTop=0;return result;
    })()`);
    assert.ok(navigationReached,`${label}: shelf navigation must be reachable inside the workspace`);
  }
  await command("Emulation.setDeviceMetricsOverride",{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await evaluate(`fixture.stage.dataset.layout='desktop';fixture.textMotion.update({...fixture.selection,genreName:'2010s · 2020s'},true);fixture.title.update('25LOOKS',false);document.fonts.ready.then(()=>new Promise(resolve=>setTimeout(resolve,550)))`);
  await evaluate(`document.querySelector('#selection-title').dataset.hiRes='false';document.querySelector('#selection-title').dataset.dsd='false';fixture.title.update('18 Plus',false);document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
  const titleClip=await evaluate(`(()=>{const title=document.querySelector('#selection-title'),r=title.getBoundingClientRect();return {x:r.x,y:r.y,width:Math.ceil(Math.min(r.width,parseFloat(title.style.getPropertyValue('--foobar-title-width')))),height:Math.ceil(r.height),scale:3};})()`);
  const titleBefore=await command('Page.captureScreenshot',{format:'png',clip:titleClip});
  await writeFile(path.join(output,'title-reels.png'),Buffer.from(titleBefore.data,'base64'));
  const titleSlots=await evaluate(`[...document.querySelectorAll('#selection-title .music-title-slot')].filter(element=>!element.hidden).map(element=>({box:getComputedStyle(element).boxSizing,slot:element.clientWidth,wheel:element.firstElementChild.getBoundingClientRect().width,padding:parseFloat(getComputedStyle(element).paddingLeft)*2,advance:parseFloat(element.style.width)}))`);
  await evaluate(`(()=>{const style=document.createElement('style');style.id='title-old-sizing';style.textContent='#selection-title .music-title-slot{box-sizing:border-box!important}';document.head.append(style);})()`);
  const titleBaseline=await command('Page.captureScreenshot',{format:'png',clip:titleClip});
  await writeFile(path.join(output,'title-before-fix.png'),Buffer.from(titleBaseline.data,'base64'));
  await evaluate(`document.querySelector('#title-old-sizing').remove()`);
  await evaluate(`(()=>{const visual=document.querySelector('#selection-title .music-title-rolling');visual.style.visibility='hidden';const native=document.createElement('span');native.id='title-native-reference';native.textContent='18 Plus';native.style.cssText='position:absolute;inset:5px 9px;display:block;font:inherit;letter-spacing:inherit;line-height:inherit;white-space:pre;';document.querySelector('#selection-title').append(native);})()`);
  const titleNative=await command('Page.captureScreenshot',{format:'png',clip:titleClip});
  await writeFile(path.join(output,'title-native.png'),Buffer.from(titleNative.data,'base64'));
  await evaluate(`document.querySelector('#title-native-reference').remove();document.querySelector('#selection-title .music-title-rolling').style.visibility=''`);
  assert.ok(titleSlots.every(slot=>slot.box==='content-box'&&slot.wheel>=slot.advance-1),'Title reel padding must not subtract from the measured glyph advance');
  if(process.argv.includes('--pixels')) {
    const comparison=spawnSync('python',['-c',[
      'from PIL import Image, ImageChops, ImageFilter',
      'import json, sys',
      'actual=Image.open(sys.argv[1]).convert("L").point(lambda value: 255 if value>=160 else 0)',
      'expected=Image.open(sys.argv[2]).convert("L").point(lambda value: 255 if value>=160 else 0)',
      'baseline=Image.open(sys.argv[3]).convert("L").point(lambda value: 255 if value>=160 else 0)',
      'assert actual.size==expected.size',
      'missing=ImageChops.subtract(expected,actual.filter(ImageFilter.MaxFilter(3)))',
      'count=sum(expected.getdata())/255',
      'lost=sum(missing.getdata())/255',
      'baselineLost=sum(ImageChops.subtract(expected,baseline.filter(ImageFilter.MaxFilter(3))).getdata())/255',
      'print(json.dumps({"expectedPixels":count,"missingPixels":lost,"missingRatio":lost/max(1,count),"baselineMissingPixels":baselineLost,"baselineMissingRatio":baselineLost/max(1,count)}))',
    ].join('\n'),path.join(output,'title-reels.png'),path.join(output,'title-native.png'),path.join(output,'title-before-fix.png')],{encoding:'utf8',windowsHide:true});
    assert.equal(comparison.status,0,comparison.stderr);
    const pixels=JSON.parse(comparison.stdout);
    await writeFile(path.join(output,'title-pixels.json'),JSON.stringify(pixels,null,2));
    assert.ok(pixels.missingRatio<.01,`Title is missing glyph pixels versus the same native text: ${JSON.stringify(pixels)}`);
    assert.ok(pixels.baselineMissingRatio>.01,'The pixel comparison must detect the old clipped rendering');
    console.log(`Title pixel comparison: ${pixels.missingPixels}/${pixels.expectedPixels} missing foreground pixels; old sizing loses ${pixels.baselineMissingPixels} (1px raster tolerance).`);
  }
  const typography=await evaluate(`(()=>{
    const slots=[...document.querySelectorAll('.foobar-shell .rn-slot')];
    const format=document.querySelector('#selection-format'),chip=format.closest('.foobar-format-chip'),shelf=document.querySelector('.genre-stepper'),name=document.querySelector('#genre-name'),random=document.querySelector('.foobar-random'),workspace=document.querySelector('.foobar-workspace');
    const f=format.getBoundingClientRect(),c=chip.getBoundingClientRect(),r=random.getBoundingClientRect(),w=workspace.getBoundingClientRect();
    return {slotsContent:slots.every(element=>getComputedStyle(element).boxSizing==='content-box'),formatPadding:getComputedStyle(format).padding,formatCenter:Math.abs((f.top+f.bottom)/2-(c.top+c.bottom)/2),shelfBorder:getComputedStyle(name).borderTopWidth,shelfBackground:getComputedStyle(name).backgroundColor,shelfName:name.querySelector('.rn-value').textContent,shelfColor:getComputedStyle(document.querySelector('#genre-position')).color,muted:getComputedStyle(fixture.stage).getPropertyValue('--muted'),artistFont:getComputedStyle(document.querySelector('#selection-artist')).fontFamily,randomX:r.x-w.x,randomY:r.y-w.y,randomHeight:r.height,dice:random.querySelectorAll('svg path').length,shortcut:random.querySelector('kbd').textContent};
  })()`);
  assert.equal(typography.slotsContent,true,'Global shell sizing must not crop rolling slots');
  assert.equal(typography.formatPadding,'0px');assert.ok(typography.formatCenter<=1,'FLAC text is centered inside a separate chip');
  assert.equal(typography.shelfBorder,'0px');assert.equal(typography.shelfBackground,'rgba(0, 0, 0, 0)');
  assert.equal(typography.shelfName,'2010s · 2020s');
  assert.ok(typography.artistFont.startsWith('"Archive Mono"') && typography.artistFont.includes('"Microsoft YaHei UI"'),'Mixed artist text must retain Geist Mono with YaHei for CJK');
  assert.equal(typography.randomX,32);assert.equal(typography.randomY,22);assert.equal(typography.randomHeight,22);assert.equal(typography.dice,1);assert.equal(typography.shortcut,'R');
  await command('DOM.enable',{});await command('CSS.enable',{});
  const {root:documentNode}=await command('DOM.getDocument',{});
  const {nodeId:artistNode}=await command('DOM.querySelector',{nodeId:documentNode.nodeId,selector:'#selection-artist'});
  const artistFonts=await command('CSS.getPlatformFontsForNode',{nodeId:artistNode});
  assert.ok(artistFonts.fonts.some(font=>font.glyphCount>0 && /Geist|Archive Mono/i.test(font.familyName+' '+font.postScriptName)),'Mixed artist Latin glyphs must render in Geist Mono');
  assert.ok(artistFonts.fonts.some(font=>font.glyphCount>0 && /Microsoft.*YaHei/i.test(font.familyName+' '+font.postScriptName)),'Mixed artist Chinese glyphs must render in Microsoft YaHei');
  await writeFile(path.join(output,'typography.json'),JSON.stringify({typography,artistFonts},null,2));
  const screenshots={};
  for(const [name,selector] of [['typography-info','.foobar-home-info'],['typography-shelf','.genre-stepper'],['typography-random','.foobar-random']]) {
    const clip=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:Math.min(r.height,510),scale:3};})()`);
    const {data}=await command('Page.captureScreenshot',{format:'png',clip});
    await writeFile(path.join(output,name+'.png'),Buffer.from(data,'base64'));screenshots[name]=clip;
  }
  await command("Emulation.setDeviceMetricsOverride",{width:1024,height:700,deviceScaleFactor:1,mobile:false});
  const gridTools=await evaluate(`fixture.applyMusicView({layout:'grid'});(()=>{const r=document.querySelector('.foobar-random').getBoundingClientRect(),w=document.querySelector('.foobar-workspace').getBoundingClientRect(),first=document.querySelector('.foobar-tool-group').getBoundingClientRect();return {y:r.top-w.top,bottom:r.bottom,first:first.top,host:document.querySelector('.music-catalog-grid-host').hidden,cards:document.querySelectorAll('.music-catalog-grid-host .foobar-grid-card').length};})()`);
  assert.equal(gridTools.y,54);assert.ok(gridTools.first>=gridTools.bottom,'Narrow grid random pick must not overlap the catalog tools');
  assert.equal(gridTools.host,false);assert.equal(gridTools.cards,3,'The public grid component renders its explicit mock catalog entries.');
  assert.equal(await evaluate(`fixture.applyMusicView({layout:'shelf'});fixture.musicApplication.selectedIndex=0;fixture.syncMusicCatalogView();document.querySelector('[data-action="genre-prev"]').disabled&&!document.querySelector('[data-action="genre-next"]').disabled`),true);
  assert.equal(await evaluate(`fixture.musicApplication.selectedIndex=40;fixture.syncMusicCatalogView();!document.querySelector('[data-action="genre-prev"]').disabled&&document.querySelector('[data-action="genre-next"]').disabled`),true);
  await evaluate(`fixture.musicApplication.selectedIndex=4;fixture.applyMusicView({layout:'array'});fixture.syncMusicCatalogView()`);
  for(const [width,height] of [[1920,1080],[1024,700],[390,844]]) {
    await command("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
    const numeral=await evaluate(`(async()=>{
      fixture.stage.dataset.layout='${width/height<1.05?'portrait':'desktop'}';fixture.textMotion.update({...fixture.selection,number:4},true);fixture.textMotion.refresh();
      await new Promise(resolve=>setTimeout(resolve,550));
      const number=document.querySelector('#selection-number'),measure=number.querySelector('.rn-measure'),code=document.querySelector('#selection-code-number'),total=document.querySelector('#selection-total');
      const n=number.getBoundingClientRect(),m=measure.getBoundingClientRect(),counter=number.parentElement.parentElement.getBoundingClientRect(),end=total.getBoundingClientRect();
      const style=getComputedStyle(number),canvas=document.createElement('canvas').getContext('2d');canvas.font=style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
      return {number:number.querySelector('.rn-value').textContent,code:code.querySelector('.rn-value').textContent,width:n.width,measured:m.width,expected:canvas.measureText('04').width,container:counter.width,used:end.right-counter.left,font:style.fontFamily,weight:style.fontWeight,ready:number.hasAttribute('data-rn-ready')};
    })()`);
    assert.equal(numeral.number,'04');assert.equal(numeral.code,'0001');assert.equal(numeral.weight,'300');assert.equal(numeral.ready,true);
    assert.ok(numeral.width>=numeral.measured-1,`${width}: rolling digits must not shrink below their glyph measurement`);
    assert.ok(numeral.width>=numeral.expected-1,`${width}: both full-size digits must fit the host`);
    assert.ok(numeral.used<=numeral.container+1,`${width}: counter and total must fit their grid column`);
  }
  await command("Emulation.setDeviceMetricsOverride",{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  for(const transport of ['idle','playing','paused']) {
    const cover=await evaluate(`(()=>{
      fixture.updatePlayback({...fixture.state,transport:'${transport}',playing:${transport==='playing'}});
      const slot=document.querySelector('.playback-cover'),song=document.querySelector('.playback-song');
      return {icon:getComputedStyle(slot.querySelector('svg')).display,background:getComputedStyle(slot).backgroundImage,tab:getComputedStyle(slot,'::after').content,placeholder:getComputedStyle(slot,'::before').content,title:song.getAttribute('title'),active:document.querySelector('#music-playback').dataset.coverActive};
    })()`);
    assert.equal(cover.icon,'none');assert.equal(cover.background,'none');assert.equal(cover.title,null);
    assert.equal(cover.active,String(transport!=='idle'));assert.equal(cover.tab,transport==='idle'?'none':'""');
    if(transport!=='idle')assert.equal(cover.placeholder,'""');
    const inspection=await evaluate(`document.querySelector('.playback-song').click();fixture.coverInspection`);
    assert.deepEqual(inspection,transport==='idle'?['focused','detail']:['fixture-album','fixture-flac']);
  }
  const imageCover=await evaluate(`(async()=>{
    fixture.coverURL='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="red"/></svg>');
    fixture.updatePlayback(fixture.state);
    await new Promise(resolve=>setTimeout(resolve,100));
    const slot=document.querySelector('.playback-cover');
    return {image:!!slot.querySelector('.playback-cover-image.visible'),placeholder:getComputedStyle(slot,'::before').content,tab:getComputedStyle(slot,'::after').content};
  })()`);
  assert.equal(imageCover.image,true);assert.equal(imageCover.placeholder,'none');assert.equal(imageCover.tab,'""');
  // Real pointer events run the application's audio-info dispatch branch.
  for(const [width,height] of [[1920,1080],[1024,700],[390,844]]) {
    await command("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.stage.dataset.layout='${width/height<1.05?'portrait':'desktop'}';fixture.audioInfoPopup.update({...fixture.state,currentTrack:undefined});new Promise(resolve=>requestAnimationFrame(resolve))`);
    const click=async selector=>{
      const {x,y}=await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await command("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1});
      await command("Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1});
    };
    await click('.playback-info-trigger');
    assert.equal(await evaluate(`fixture.audioInfoPopup.isOpen&&!!document.querySelector('.audio-info-empty')`),true,`${width}: empty information popup must open`);
    await evaluate(`fixture.audioInfoPopup.update(fixture.state)`);
    assert.ok(await evaluate(`document.querySelectorAll('.audio-info-card').length`)>0,`${width}: actual state replaces the empty message`);
    assert.equal(await evaluate(`document.querySelector('.audio-info-empty')===null`),true);
    const popup=await evaluate(`(() => {const r=document.querySelector('#music-audio-info').getBoundingClientRect();const h=document.querySelector('.foobar-header').getBoundingClientRect();const f=document.querySelector('.foobar-footer').getBoundingClientRect();return {top:r.top,bottom:r.bottom,header:h.bottom,footer:f.top};})()`);
    assert.ok(popup.top>=popup.header-1&&popup.bottom<=popup.footer,`${width}: popup must stay between header and transport`);
    assert.equal(await evaluate(`fixture.audioInfoPopup.update({...fixture.state,currentTrack:undefined});fixture.audioInfoPopup.isOpen&&document.querySelectorAll('.audio-info-card').length===0&&!!document.querySelector('.audio-info-empty')`),true,`${width}: clearing the track must clear old chain cards`);
    await click('.playback-info-trigger');assert.equal(await evaluate(`fixture.audioInfoPopup.isOpen`),false);
    await click('.playback-info-trigger');
    await command("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    assert.equal(await evaluate(`!fixture.audioInfoPopup.isOpen&&document.activeElement===document.querySelector('.playback-info-trigger')`),true);
  }
  // Entering detail hides the browse pane, but must keep the archive width.
  for(const [width,height] of [[1920,1080],[1024,700],[900,1100]]) {
    await command("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
    const widths=await evaluate(`(() => {
      const scene=document.querySelector('#three-scene'),detail=document.querySelector('#music-detail');
      fixture.stage.dataset.layout='${width/height<1.05?'portrait':'desktop'}';fixture.stage.dataset.mode='archive';
      const browse=fixture.foobarArchiveWidth(scene,scene.clientWidth,0);
      fixture.stage.dataset.mode='detail';detail.hidden=false;
      const inspect=fixture.foobarArchiveWidth(scene,scene.clientWidth,1,browse);
      detail.hidden=true;
      const transition=fixture.foobarArchiveWidth(scene,scene.clientWidth,.5,inspect);
      fixture.stage.dataset.mode='archive';
      const callout=document.querySelector('.album-callout');callout.style.transform='translateX(-10000px)';
      const hiddenTarget=fixture.foobarArchiveWidth(scene,scene.clientWidth,.5,inspect);
      callout.style.transform='';
      const restored=fixture.foobarArchiveWidth(scene,scene.clientWidth,0,transition);
      return {browse,inspect,transition,hiddenTarget,restored};
    })()`);
    assert.ok(widths.browse>300,`${width}: realistic browse region`);
    assert.equal(widths.inspect,widths.browse,`${width}: hidden browse pane must not collapse detail rendering`);
    assert.equal(widths.transition,widths.inspect,`${width}: transient hidden panes preserve width`);
    assert.equal(widths.hiddenTarget,widths.inspect,`${width}: do not substitute an animated browse pane for a hidden detail pane`);
    assert.equal(widths.restored,widths.browse,`${width}: returning to browse preserves width`);
  }
  if(sharedMode && !navigationMode && !displayMode) { await checkPunkEq({command,evaluate,output,project});await checkPunkControls({command,evaluate,output});await checkFutureDesign({command,evaluate,output,project});await checkAlbumPanel({command,evaluate,output});await checkWindowAspectUi({command,evaluate,output,project});await checkPunkLyrics({command,evaluate,output,project});await checkPunkSignal({command,evaluate,output,project}); }
  // DOM migration must still restore the glass theme's original parents.
  await evaluate(`fixture.stage.dataset.design='rhine';fixture.sharedPanel?.setActive(false);fixture.shell.setActive(false)`);
  assert.equal(await evaluate(`document.querySelector('.music-header .music-topnav')!==null&&document.querySelector('#music-browse > .album-callout')!==null`),true);
  assert.equal(await evaluate(`fixture.stage.dataset.design='rhine';fixture.textMotion.update(fixture.selection,false);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(document.querySelector('#selection-code-number .rn-value').textContent))))`),'001');
  console.log(`Passed ${results.length} offline foobar layout cases, real rolling numbers, source cover states/inspection, audio popup clicks, detail transitions and glass DOM restoration.`);
  }
  }
} finally {
  if(!displayMode&&!glassMode)await writeFile(path.join(output,"geometry.json"),JSON.stringify(results,null,2));
  for(const {timer} of pending.values())clearTimeout(timer);
  if(socket?.readyState===WebSocket.OPEN)await send("Browser.close").catch(()=>browser.kill());
  else browser.kill();
  socket?.close();
}
