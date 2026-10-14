import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function checkPunkLyrics({command,evaluate,output,project}) {
  const bundle=await build({stdin:{contents:`export {setupLyricsPage} from './src/lyrics-page';`,resolveDir:project,loader:'ts'},bundle:true,write:false,format:'iife',define:{'crypto.randomUUID':'lyricsFixtureUUID'},banner:{js:'const lyricsFixtureUUID=()=>"00000000-0000-4000-8000-000000000001";'},globalName:'LyricsFixture',logLevel:'silent'});
  await evaluate(bundle.outputFiles[0].text);
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await evaluate(`(async()=>{const f=fixture;f.lyricsOriginalFetch=window.fetch;f.lyricsRequests=[];f.lyricsSeek=[];
    f.lyricsDoc={trackId:f.state.currentTrack.id,lrc:'[00:01.00]第一句合成歌词\\n[00:03.00]Second synthetic lyric',translation:'[00:01.00]First translation\\n[00:03.00]第二句译文',offsetMs:0,source:{id:'qq',name:'QQ音乐'},savedAt:'2026-10-13T00:00:00Z'};
    const sources=[{id:'netease',name:'网易云音乐',builtin:true,enabled:true},{id:'qq',name:'QQ音乐',builtin:true,enabled:true}];
    window.fetch=async(url,options={})=>{const route=new URL(String(url),'http://lyrics.fixture').pathname;f.lyricsRequests.push({route,body:options.body?JSON.parse(options.body):null});let payload;
      if(route==='/api/lyrics/settings')payload={settings:{defaultSourceId:'netease',cacheDirectory:'',defaultCacheDirectory:''},sources};
      else if(route==='/api/lyrics/preferences')payload={trackId:f.lyricsDoc.trackId,sourceId:null,effectiveSourceId:'netease',defaultSourceId:'netease',sources};
      else if(route==='/api/lyrics/track')payload={lyric:f.lyricsDoc};
      else if(route==='/api/lyrics/search')payload={candidates:[{id:'test-candidate',sourceId:'qq',title:'合成歌词',artist:'测试歌手',album:'测试专辑'}],sourceName:'多来源',sources:[{sourceId:'netease',name:'网易云音乐',status:'error',message:'模拟失败'},{sourceId:'qq',name:'QQ音乐',status:'ok',count:1}]};
      else if(route==='/api/lyrics/select'||route==='/api/lyrics/import')payload={lyric:f.lyricsDoc};
      else if(route==='/api/lyrics/offset'){f.lyricsDoc={...f.lyricsDoc,offsetMs:JSON.parse(options.body).offsetMs};payload={lyric:f.lyricsDoc};}
      else throw new Error('Unexpected request in offline lyrics fixture: '+route);
      return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
    };
    EqFixture.applyStylePalette(f.stage,{...EqFixture.archiveMusicStyle,design:'rhine',scheme:'rhine'},'day');f.stage.dataset.theme='day';f.stage.dataset.layout='desktop';f.shell.setActive(false);f.sharedPanel.setVisible(false);document.querySelector('#music-browse').hidden=true;f.stage.dataset.page='lyrics';const page=document.querySelector('#music-lyrics-page');page.hidden=false;page.inert=false;
    f.lyricsState={...f.state,currentTime:2,playing:false,transport:'paused'};
    f.lyricsController=LyricsFixture.setupLyricsPage(document.querySelector('#lyrics-page-content'),{seek:t=>f.lyricsSeek.push(t),notify:()=>{},openSettings:()=>{},spectrum:()=>({available:true,bands:Array.from({length:32},(_,i)=>(i%8)/8),sampleRate:44100,updatedAt:Date.now()})});
    f.lyricsController.update(f.lyricsState,f.albumMock);f.lyricsController.setVisible(true);
    for(let i=0;i<30&&!document.querySelector('.lyrics-line.is-active');i++)await new Promise(r=>setTimeout(r,20));
  })()`);
  const signature=`(()=>{return ['.lyrics-workspace','.lyrics-left','.lyrics-main','.lyrics-right','.lyrics-cover-frame','.lyrics-line-text','.lyrics-settings-gear'].map(selector=>{const n=document.querySelector(selector),s=getComputedStyle(n),r=n.getBoundingClientRect();return{selector,display:s.display,grid:s.gridTemplateColumns,gap:s.gap,font:s.fontSize,color:s.color,bg:s.backgroundColor,radius:s.borderRadius,width:r.width,height:r.height};});})()`;
  const futureBefore=await evaluate(signature);
  const futureStyles=[];
  for(const theme of ['day','night']) {
    await evaluate(`fixture.stage.dataset.theme='${theme}';EqFixture.applyStylePalette(fixture.stage,{...EqFixture.archiveMusicStyle,design:'rhine',scheme:'rhine'},'${theme}');for(const b of fixture.stage.querySelectorAll('.theme-switch [data-theme]'))b.setAttribute('aria-pressed',String(b.dataset.theme==='${theme}'));for(const [action,page] of Object.entries({library:'music',eq:'eq',lyrics:'lyrics',signal:'signal',theme:'theme',settings:'settings'}))fixture.stage.querySelector('.music-topnav [data-action="'+action+'"]')?.setAttribute('aria-pressed',String(page==='lyrics'));new Promise(r=>setTimeout(r,760))`);
    const skin=await evaluate(`(()=>{const active=document.querySelector('.lyrics-line.is-active'),text=active.querySelector('.lyrics-line-text'),ctx=document.createElement('canvas').getContext('2d'),base=getComputedStyle(fixture.stage).getPropertyValue('--page-bg');const lum=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=base;ctx.fillRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);};const a=lum(getComputedStyle(text).color),b=lum(getComputedStyle(active).backgroundColor);return{contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),opacity:getComputedStyle(active).opacity,weight:getComputedStyle(text).fontWeight,gear:getComputedStyle(document.querySelector('.lyrics-settings-gear')).borderRadius,panels:['.lyrics-left','.lyrics-main','.lyrics-right'].map(s=>{const n=document.querySelector(s);return{rect:n.getBoundingClientRect().toJSON(),radius:getComputedStyle(n).borderRadius};})};})()`);
    assert.ok(skin.contrast>=4.5,`Future ${theme}: active lyric contrast ${skin.contrast}`);assert.equal(skin.opacity,'1');assert.equal(skin.weight,'600');assert.equal(skin.gear,'50%');
    assert.ok(skin.panels[0].rect.right<skin.panels[1].rect.left&&skin.panels[1].rect.right<skin.panels[2].rect.left,'Future keeps its three reading columns');
    futureStyles.push({theme,...skin});
    const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`future-lyrics-${theme}.png`),Buffer.from(shot.data,'base64'));
  }
  await evaluate(`fixture.stage.dataset.theme='day';EqFixture.applyStylePalette(fixture.stage,{...EqFixture.archiveMusicStyle,design:'rhine',scheme:'rhine'},'day');new Promise(r=>setTimeout(r,220))`);
  assert.equal(await evaluate(`fixture.lyricsRequests.some(x=>x.route==='/api/lyrics/search')`),false);
  const geometry=[];
  for(const [width,height] of [[1920,1080],[1920,1200],[2048,1536],[1920,1280],[2520,1080]]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.stage.dataset.design='archive';fixture.shell.setActive(true);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const layout=await evaluate(`(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON(),visible=s=>{const n=document.querySelector(s);return !n.hidden&&getComputedStyle(n).display!=='none';};return{left:rect('.lyrics-left'),main:rect('.lyrics-main'),right:rect('.lyrics-right'),body:rect('.lyrics-left .lyrics-side-body'),bars:rect('.lyrics-spectrum-bars'),gear:rect('.lyrics-settings-gear'),cover:visible('.lyrics-cover-frame'),title:visible('.lyrics-album-title'),artist:visible('.lyrics-album-artist'),meta:visible('.lyrics-album-meta'),extras:['.lyrics-archive-profile','.lyrics-archive-readouts','.lyrics-archive-analysis','.lyrics-archive-line-index'].some(visible),wrapper:getComputedStyle(document.querySelector('.lyrics-archive-layout')).display};})()`);
    assert.ok(layout.left.right<layout.main.left&&layout.main.right<layout.right.left);
    assert.ok(layout.body.bottom<=layout.bars.top+1&&layout.bars.height>=50);
    assert.ok(layout.cover&&layout.title&&layout.artist&&layout.meta&&!layout.extras&&layout.wrapper==='contents');
    assert.equal(layout.gear.width,32);assert.equal(layout.gear.height,32);
    geometry.push({width,height,...layout});
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  const palettes=[];
  for(const scheme of ['archive','hazard','flare','field','front','hearth'])for(const mode of ['day','night']) {
    await evaluate(`fixture.stage.dataset.theme='${mode}';EqFixture.applyStylePalette(fixture.stage,{...EqFixture.archiveMusicStyle,scheme:'${scheme}'},'${mode}');new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const appearance=await evaluate(`(()=>{const n=document.querySelector('.lyrics-line.is-active'),t=n.querySelector('.lyrics-line-text'),s=getComputedStyle(n),v=getComputedStyle(t),ctx=document.createElement('canvas').getContext('2d');const lum=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);};const a=lum(v.color),b=lum(s.backgroundColor);return{contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),radius:getComputedStyle(document.querySelector('.lyrics-settings-gear')).borderRadius,bars:document.querySelectorAll('.lyrics-spectrum-bar').length};})()`);
    assert.ok(appearance.contrast>=4.5,JSON.stringify({scheme,mode,appearance}));assert.equal(appearance.radius,'0px');assert.equal(appearance.bars,32);palettes.push({scheme,mode,...appearance});
    if(mode==='day'&&['archive','front','flare'].includes(scheme)){const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`punk-lyrics-${scheme}.png`),Buffer.from(shot.data,'base64'));}
  }
  await evaluate(`document.querySelector('.lyrics-line-button').click();document.querySelector('.lyrics-settings-gear').click();new Promise(r=>setTimeout(r,30))`);
  assert.equal(await evaluate(`document.querySelector('#lyrics-options-dialog').hidden`),false);
  await evaluate(`document.querySelector('#lyrics-search-panel .lyrics-primary-button').click();new Promise(r=>setTimeout(r,30))`);
  assert.equal(await evaluate(`document.querySelectorAll('.lyrics-candidate-card').length`),1);
  await evaluate(`document.querySelector('.lyrics-candidate-card button').click();new Promise(r=>setTimeout(r,30))`);
  assert.equal(await evaluate(`document.querySelector('#lyrics-options-dialog').hidden`),true);
  await evaluate(`document.querySelector('.lyrics-settings-gear').click();document.querySelector('#lyrics-options-settings-tab').click();document.querySelector('.lyrics-offset-controls input').value='.5';document.querySelector('.lyrics-offset-controls .lyrics-quiet-button').click();new Promise(r=>setTimeout(r,30))`);
  const behavior=await evaluate(`(()=>{const tab=document.querySelector('#lyrics-options-settings-tab');return{seek:fixture.lyricsSeek[0],offset:fixture.lyricsRequests.some(x=>x.route==='/api/lyrics/offset'&&x.body.offsetMs===500),selected:tab.getAttribute('aria-selected'),radius:getComputedStyle(document.querySelector('.lyrics-preference-dialog')).borderRadius,open:!document.querySelector('#lyrics-options-dialog').hidden};})()`);
  assert.equal(behavior.seek,1);assert.ok(behavior.offset&&behavior.open);assert.equal(behavior.selected,'true');assert.equal(behavior.radius,'0px');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.activeElement?.blur();fixture.stage.dataset.theme='day';EqFixture.applyStylePalette(fixture.stage,{...EqFixture.archiveMusicStyle,design:'rhine',scheme:'rhine'},'day');fixture.shell.setActive(false);new Promise(r=>setTimeout(r,220))`);
  assert.deepEqual(await evaluate(signature),futureBefore,'Future geometry and computed styles restore unchanged');
  await evaluate(`fixture.lyricsController.destroy();window.fetch=fixture.lyricsOriginalFetch;document.querySelector('#music-lyrics-page').hidden=true;fixture.stage.dataset.page='music';document.querySelector('#music-browse').hidden=false;fixture.sharedPanel.setVisible(true);`);
  await writeFile(path.join(output,'punk-lyrics.json'),JSON.stringify({geometry,palettes,behavior,futureBefore,futureStyles},null,2));
}
