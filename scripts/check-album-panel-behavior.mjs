import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Called by the existing offline Chrome fixture; no player or audio service.
export async function checkAlbumPanel({command,evaluate,output}) {
  const report=[];
  await evaluate(`document.querySelector('#selection-title').dataset.hiRes='true';document.querySelector('#selection-title').dataset.dsd='false';document.querySelector('#selection-hi-res').hidden=false;document.querySelector('#selection-dsd').hidden=true`);
  for(const design of ['archive','rhine']) {
    await command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.sharedPanel.setOpen(false);fixture.sharedPanel.finish();fixture.stage.dataset.mode='archive';fixture.stage.dataset.design='${design}';fixture.shell.setActive(${design==='archive'});document.querySelector('#selection-profile').innerHTML=fixture.renderProfile('${design}');fixture.renderSourceDetail();fixture.title.update('18 Plus',false);document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
    const closed=await evaluate(`(()=>{const f=fixture,p=f.sharedPanel,a=document.querySelector('#album-detail-content'),b=document.querySelector('.open-album'),v=p.scrollTarget();p.element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));const count=f.played.length;p.element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return{hidden:a.hidden,inert:a.inert,rowsHidden:[...a.querySelectorAll('.track-row')].every(x=>x.getClientRects().length===0),button:!b.hidden&&!b.inert,buttons:document.querySelectorAll('.open-album').length,playButtons:document.querySelectorAll('.browse-play-album').length,noHiddenPlay:f.played.length===count,whole:v===document.querySelector('.album-panel-scroll'),focusStyle:getComputedStyle(p.element).outlineStyle,shadow:getComputedStyle(p.element).boxShadow};})()`);
    for(const key of ['hidden','inert','rowsHidden','button','noHiddenPlay','whole'])assert.equal(closed[key],true,`${design} closed ${key}`);
    assert.equal(closed.buttons,1);assert.equal(closed.playButtons,0);assert.equal(closed.focusStyle,'none');assert.equal(closed.shadow,'none');
    const opening=await evaluate(`(async()=>{const f=fixture,p=f.sharedPanel,a=document.querySelector('#album-detail-content'),b=document.querySelector('.open-album'),h=document.querySelector('.album-callout');b.focus({preventScroll:true});f.stage.dataset.mode='detail';p.setOpen(true);const shots=[],take=()=>{
      const buttonFrames=b.getAnimations().flatMap(animation=>animation.effect?.getKeyframes()??[]);
      const hasClip=node=>node.getAnimations().some(animation=>animation.effect?.getKeyframes().some(frame=>typeof frame.clipPath==='string'));
      const fieldClipReveal=[...a.querySelectorAll('*')].some(hasClip);
      shots.push({state:p.element.dataset.panelState,hidden:a.hidden,buttonHidden:b.hidden,buttonInert:b.inert,height:a.getBoundingClientRect().height,clip:getComputedStyle(b).clipPath,transform:getComputedStyle(b).transform,
        buttonFrames,buttonDuration:b.getAnimations()[0]?.effect?.getComputedTiming().duration??null,fieldClipReveal,buttonBackground:getComputedStyle(b).backgroundColor,
        same:a===document.querySelector('#album-detail-content')&&h===document.querySelector('.album-callout')});
    };take();await new Promise(r=>setTimeout(r,100));take();await new Promise(r=>setTimeout(r,310));take();await new Promise(r=>setTimeout(r,400));take();return shots;})()`);
    assert.equal(opening[0].state,'button-exit');assert.equal(opening[0].hidden,true);assert.equal(opening[0].buttonInert,true);
    assert.equal(opening[1].hidden,true);assert.equal(opening[1].height,0);
    assert.equal(opening[2].state,'expanding');assert.equal(opening[2].hidden,false);assert.equal(opening[2].buttonHidden,true);
    assert.equal(opening[3].state,'expanded');assert.ok(opening.every(x=>x.same));
    assert.ok(opening[0].buttonFrames.some(frame=>typeof frame.clipPath==='string'),`${design}: the open button exits through a clip mask.`);
    if(design==='archive')assert.notEqual(opening[1].clip,'none');else {
      assert.notEqual(opening[1].clip,'none');assert.equal(opening[0].buttonDuration,240,'Future button mask keeps its 240 ms timing.');
      assert.ok(opening[0].buttonFrames.every(frame=>!frame.transform),'Future button exit does not rely on transform.');
      assert.notEqual(opening[0].buttonBackground,'rgb(0, 0, 0)','Future button animation does not paint a black placeholder.');
      assert.equal(opening[2].fieldClipReveal,true,'Future detail fields reveal with clip masks while the article expands.');
    }
    const focus=await evaluate(`(()=>{const f=fixture,p=f.sharedPanel,v=p.scrollTarget(),left=document.querySelector('#three-scene');const point=x=>x.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})),wheel=x=>x.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true})),key=(x,k)=>x.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));point(left);const start=f.albumSteps,shelf=f.shelfSteps;wheel(v);const leftSafe=f.albumSteps===start+1&&f.shelfSteps===shelf;point(v);const after=f.albumSteps;v.scrollTop=0;wheel(left);const rightSafe=v.scrollTop>0&&f.albumSteps===after;v.scrollTop=v.scrollHeight;wheel(left);const edge=f.albumSteps===after;p.element.focus({preventScroll:true});key(p.element,'ArrowDown');const row=document.activeElement;key(row,'Enter');const played=f.played.at(-1);f.renderSharedTab('about');const hasClip=node=>node.getAnimations().some(animation=>animation.effect?.getKeyframes().some(frame=>typeof frame.clipPath==='string'));const futureTabClipReveal=[...p.element.querySelectorAll('.music-tabs,.album-about > *')].some(hasClip);p.element.focus({preventScroll:true});key(p.element,'ArrowDown');const aboutSafe=f.albumSteps===after;f.renderSharedTab('tracks');const tab=document.querySelector('#tab-tracks');tab.focus({preventScroll:true});key(tab,'ArrowDown');const tabSafe=document.activeElement.classList.contains('track-row')&&f.albumSteps===after;return{leftSafe,rightSafe,edge,aboutSafe,tabSafe,played,mode:f.stage.dataset.mode,outline:getComputedStyle(p.element).outlineStyle,shadow:getComputedStyle(p.element).boxShadow,futureTabClipReveal};})()`);
    for(const key of ['leftSafe','rightSafe','edge','aboutSafe','tabSafe'])assert.equal(focus[key],true,`${design} focus ${key}`);
    if(design==='rhine')assert.equal(focus.futureTabClipReveal,true,'Future tab changes reveal individual content segments with clip masks.');
    assert.equal(focus.played,'track-0');assert.equal(focus.mode,'detail');assert.equal(focus.outline,'none');assert.equal(focus.shadow,'none');
    const skin=await evaluate(`(()=>{const tab=document.querySelector('#tab-tracks'),indicator=document.querySelector('.music-tab-indicator');return{background:getComputedStyle(tab).backgroundColor,indicator:getComputedStyle(indicator).display,indicatorWidth:indicator.getBoundingClientRect().width};})()`);
    if(design==='archive')assert.equal(skin.indicator,'none');else {assert.equal(skin.indicator,'block');assert.ok(skin.indicatorWidth>0,'Future selected tab underline remains visible');assert.equal(skin.background,'rgba(0, 0, 0, 0)');}
    const closing=await evaluate(`(async()=>{const f=fixture,p=f.sharedPanel;f.stage.dataset.mode='archive';p.setOpen(false);const first=p.element.dataset.panelState;await new Promise(r=>setTimeout(r,950));return{first,last:p.element.dataset.panelState,hidden:document.querySelector('#album-detail-content').hidden,button:!document.querySelector('.open-album').hidden};})()`);
    assert.equal(closing.first,'collapsing');assert.equal(closing.last,'browse');assert.equal(closing.hidden,true);assert.equal(closing.button,true);
    const rapid=await evaluate(`(async()=>{const p=fixture.sharedPanel;p.setOpen(true);await new Promise(r=>setTimeout(r,50));p.setOpen(false);await new Promise(r=>setTimeout(r,30));p.setOpen(true);await new Promise(r=>setTimeout(r,850));const open=p.element.dataset.panelState;p.setOpen(false);p.finish();return{open,closed:p.element.dataset.panelState};})()`);
    assert.equal(rapid.open,'expanded');assert.equal(rapid.closed,'browse');
    const leftFocus=await evaluate(`(()=>{const f=fixture,p=f.sharedPanel,left=document.querySelector('#three-scene');left.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));p.setOpen(true);p.finish();const kept=document.activeElement===left&&f.input.side==='left';p.setOpen(false);p.finish();return kept;})()`);
    assert.equal(leftFocus,true,`${design}: programmatic left opening must not steal focus`);
    let layoutPersistence;
    if(design==='archive') {
      const originalTheme=await evaluate(`fixture.stage.dataset.theme`),themeRuns=[];
      for(const theme of ['day','night']) {
      await evaluate(`fixture.stage.dataset.theme=${JSON.stringify(theme)};fixture.stage.dataset.foobarLayout='array';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const before=await evaluate(`(()=>{
        const f=fixture,p=f.sharedPanel;
        f.stage.dataset.mode='archive';p.setOpen(true);p.finish();f.renderSharedTab('tracks');
        const row=document.querySelector('.track-row[data-track="track-4"]');row.focus({preventScroll:true});
        const targets=[document.querySelector('.foobar-home-info'),p.element,p.scrollTarget(),document.querySelector('.album-callout'),document.querySelector('#album-detail-content')];
        const refs=[...targets,document.querySelector('#tab-tracks'),row];window.foobarLayoutRefs=refs;
        const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
        const palette=()=>Object.fromEntries(['--ink','--muted','--accent','--line','--surface'].map(name=>[name,getComputedStyle(f.stage).getPropertyValue(name).trim()]));
        const skin=()=>['.album-panel','#selection-title','.music-tabs button[aria-selected="true"]','.track-row'].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return[selector,{color:s.color,backgroundColor:s.backgroundColor,borderColor:s.borderColor,fontFamily:s.fontFamily}];});
        return{layout:f.stage.dataset.foobarLayout,design:f.stage.dataset.design,theme:f.stage.dataset.theme,mode:f.stage.dataset.mode,panelState:p.element.dataset.panelState,articleHidden:document.querySelector('#album-detail-content').hidden,tab:document.querySelector('.music-tabs [aria-selected="true"]')?.dataset.tab,focusTrack:document.activeElement?.dataset.track||'',albumId:f.albumMock.id,trackId:row.dataset.track,trackAlbumId:f.albumMock.tracks.find(track=>track.id===row.dataset.track)?.albumId,text:{title:document.querySelector('#selection-title').textContent.trim(),artist:document.querySelector('#selection-artist').textContent.trim(),track:row.textContent.trim()},rects:targets.map(rect),palette:palette(),skin:skin()};
      })()`);
      assert.equal(before.layout,'array');assert.equal(before.design,'archive');assert.equal(before.theme,theme);assert.equal(before.mode,'archive');assert.equal(before.panelState,'expanded');assert.equal(before.articleHidden,false);assert.equal(before.tab,'tracks');
      assert.equal(before.focusTrack,'track-4');assert.equal(before.albumId,'fixture-album');assert.equal(before.trackId,'track-4');assert.equal(before.trackAlbumId,before.albumId);
      const states=[];
      for(const layout of ['future','array','grid']) {
        await evaluate(`fixture.stage.dataset.foobarLayout='${layout}';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        const after=await evaluate(`(()=>{
          const f=fixture,p=f.sharedPanel,targets=[document.querySelector('.foobar-home-info'),p.element,p.scrollTarget(),document.querySelector('.album-callout'),document.querySelector('#album-detail-content')];
          const refs=[...targets,document.querySelector('#tab-tracks'),document.querySelector('.track-row[data-track="track-4"]')];
          const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
          const palette=()=>Object.fromEntries(['--ink','--muted','--accent','--line','--surface'].map(name=>[name,getComputedStyle(f.stage).getPropertyValue(name).trim()]));
          const skin=()=>['.album-panel','#selection-title','.music-tabs button[aria-selected="true"]','.track-row'].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return[selector,{color:s.color,backgroundColor:s.backgroundColor,borderColor:s.borderColor,fontFamily:s.fontFamily}];});
          return{layout:f.stage.dataset.foobarLayout,design:f.stage.dataset.design,theme:f.stage.dataset.theme,mode:f.stage.dataset.mode,panelState:p.element.dataset.panelState,articleHidden:document.querySelector('#album-detail-content').hidden,tab:document.querySelector('.music-tabs [aria-selected="true"]')?.dataset.tab,focusTrack:document.activeElement?.dataset.track||'',albumId:f.albumMock.id,trackId:document.querySelector('.track-row[data-track="track-4"]')?.dataset.track,trackAlbumId:f.albumMock.tracks.find(track=>track.id==='track-4')?.albumId,text:{title:document.querySelector('#selection-title').textContent.trim(),artist:document.querySelector('#selection-artist').textContent.trim(),track:document.querySelector('.track-row[data-track="track-4"]')?.textContent.trim()},sameNodes:window.foobarLayoutRefs.every((node,index)=>node===refs[index]),rects:targets.map(rect),palette:palette(),skin:skin()};
        })()`);
        assert.equal(after.layout,layout);assert.equal(after.design,'archive',`${layout}: archive design is retained`);assert.equal(after.theme,before.theme);assert.equal(after.mode,before.mode);
        assert.equal(after.panelState,before.panelState,`${layout}: panel open state is retained`);assert.equal(after.articleHidden,before.articleHidden);assert.equal(after.tab,before.tab,`${layout}: selected tab is retained`);
        assert.equal(after.focusTrack,before.focusTrack,`${layout}: focused track is retained`);assert.equal(after.albumId,before.albumId);assert.equal(after.trackId,before.trackId);assert.equal(after.trackAlbumId,before.trackAlbumId);
        assert.equal(after.sameNodes,true,`${layout}: right-side DOM nodes are retained`);assert.deepEqual(after.rects,before.rects,`${layout}: right-side geometry is retained`);assert.deepEqual(after.text,before.text,`${layout}: right-side text is retained`);
        assert.deepEqual(after.palette,before.palette,`${layout}: Punk palette tokens are retained`);assert.deepEqual(after.skin,before.skin,`${layout}: Punk right-side skin is retained`);
        states.push(after);
      }
      themeRuns.push({theme,before,states});
      }
      await evaluate(`fixture.stage.dataset.foobarLayout='array';fixture.stage.dataset.theme=${JSON.stringify(originalTheme)}`);
      layoutPersistence={fixture:'DOM/CSS only; catalog selection and layout dispatch are mocked',themeRuns};
    }
    let readingBackground;
    if(design==='rhine') {
      readingBackground=await evaluate(`(async()=>{
        const f=fixture,p=f.sharedPanel,browse=document.querySelector('#music-browse'),veil=document.querySelector('.album-panel-veil');
        const transition=new f.SurfaceTransition(browse,undefined,720,140,'up','cubic-bezier(0.45,0,0.25,1)',[document.querySelector('.music-browse-veil'),document.querySelector('.music-navigation'),document.querySelector('.music-keyhint')]);
        const previousTheme=f.stage.dataset.theme,samples=[];
        const sample=phase=>{const s=getComputedStyle(veil),title=document.querySelector('#selection-title').getBoundingClientRect();samples.push({phase,theme:f.stage.dataset.theme,display:s.display,visibility:s.visibility,opacity:s.opacity,background:s.backgroundImage,pointer:s.pointerEvents,titleY:title.y,parent:veil.parentElement===f.stage,old:getComputedStyle(document.querySelector('.music-browse-veil')).display});};
        for(const theme of ['day','night']) {
          f.stage.dataset.theme=theme;transition.show(true);p.setVisible(true);p.setOpen(false);p.finish();sample('browse');
          p.setOpen(true);transition.hide(false);sample('button-exit');
          for(const delay of [100,180,160,360]){await new Promise(r=>setTimeout(r,delay));sample(p.element.dataset.panelState);}
          p.setOpen(false);transition.show(false);sample('collapsing');
          for(const delay of [100,220,480]){await new Promise(r=>setTimeout(r,delay));sample(p.element.dataset.panelState);}
        }
        p.setVisible(false);const hidden=getComputedStyle(veil).display;p.setVisible(true);
        f.stage.dataset.page='settings';const settings=getComputedStyle(veil).display;f.stage.dataset.page='music';
        f.stage.dataset.design='archive';const punk=getComputedStyle(veil).display;f.stage.dataset.design='rhine';
        transition.dispose();transition.show(true);f.stage.dataset.theme=previousTheme;p.setOpen(false);p.finish();
        return{samples,hidden,settings,punk};
      })()`);
      for(const sample of readingBackground.samples) {
        assert.equal(sample.display,'block',`Future reading veil disappeared during ${sample.phase}`);
        assert.equal(sample.visibility,'visible');assert.equal(sample.opacity,'1');assert.equal(sample.pointer,'none');assert.equal(sample.parent,true);assert.equal(sample.old,'none');
      }
      for(const theme of ['day','night']) {
        const samples=readingBackground.samples.filter(x=>x.theme===theme);
        assert.ok(samples.every(x=>x.background===samples[0].background),'Future reading background must not change during album open/close');
        assert.ok(samples.every(x=>Math.abs(x.titleY-samples[0].titleY)<1),'Future title must stay anchored during album open/close');
      }
      for(const key of ['hidden','settings','punk'])assert.equal(readingBackground[key],'none',`Future veil must be absent: ${key}`);
    }
    report.push({design,closed,opening,focus,skin,closing,rapid,layoutPersistence,readingBackground});
    for(const open of [false,true]) {
      await evaluate(`fixture.sharedPanel.setOpen(${open});fixture.sharedPanel.finish();fixture.sharedPanel.scrollTarget().scrollTop=0`);
      const clip=await evaluate(`(()=>{const r=fixture.sharedPanel.element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);
      const shot=await command('Page.captureScreenshot',{format:'png',clip});
      await writeFile(path.join(output,`${design}-album-${open?'open':'selected'}.png`),Buffer.from(shot.data,'base64'));
    }
  }
  const responsive=[];
  for(const [width,height] of [[1440,900],[1024,700],[390,844]]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.stage.dataset.layout='${width<720?'portrait':width<1100?'compact':'desktop'}';fixture.sharedPanel.setOpen(false);fixture.sharedPanel.finish();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const bounds=await evaluate(`(()=>{const p=fixture.sharedPanel.element.getBoundingClientRect(),n=document.querySelector('.music-navigation').getBoundingClientRect(),v=fixture.sharedPanel.scrollTarget();return{p:p.toJSON(),n:n.toJSON(),width:v.clientWidth,scroll:v.scrollWidth,offenders:[...v.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>p.right+1).slice(0,8).map(x=>({name:x.id||x.className,hidden:x.hidden,visibility:getComputedStyle(x).visibility,right:x.getBoundingClientRect().right})),overlap:Math.min(p.right,n.right)-Math.max(p.left,n.left)>1&&Math.min(p.bottom,n.bottom)-Math.max(p.top,n.top)>1};})()`);
    assert.ok(bounds.p.x>=0&&bounds.p.y>=0&&bounds.p.right<=width+1&&bounds.p.bottom<=height+1,`Future ${width}: pane bounds`);
    assert.equal(bounds.overlap,false,`Future ${width}: navigation overlaps right pane ${JSON.stringify(bounds)}`);
    assert.ok(bounds.scroll<=bounds.width+1,`Future ${width}: horizontal overflow ${JSON.stringify(bounds)}`);responsive.push({viewportWidth:width,viewportHeight:height,...bounds});
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  const themeContext=await evaluate(`(()=>{
    const f=fixture,p=f.sharedPanel;f.stage.dataset.layout='desktop';f.stage.dataset.design='rhine';f.shell.setActive(false);
    f.renderSharedTab('tracks');f.renderSourceDetail();p.setOpen(true);p.finish();
    const body=document.querySelector('#album-tab-content'),tab=document.querySelector('#tab-tracks'),row=body.querySelector('.track-row[data-track="track-4"]');
    const viewport=p.scrollTarget();f.stage.dataset.operationFocus='right';row.focus({preventScroll:true});viewport.scrollTop=80;
    const scroll=viewport.scrollTop,focused=document.activeElement===row,out=[];
    for(const design of ['archive','rhine','archive']){
      f.stage.dataset.design=design;f.shell.setActive(design==='archive');p.setOpen(true);p.finish();f.renderSourceDetail();
      out.push({design,sameBody:body===document.querySelector('#album-tab-content'),sameTab:tab===document.querySelector('#tab-tracks'),sameRow:row===document.querySelector('.track-row[data-track="track-4"]'),focus:document.activeElement===row,scroll:viewport.scrollTop,tab:document.querySelector('.music-tabs [aria-selected="true"]')?.dataset.tab,open:p.element.dataset.panelState==='expanded'});
    }
    return{fixture:'Production renderDetail and panel/shell components; theme dispatch is simulated',scroll,focused,states:out};
  })()`);
  assert.equal(themeContext.focused,true,'Theme context fixture starts with a focused track');
  assert.ok(themeContext.scroll>0,'Theme context fixture starts with a scrolled pane');
  for(const state of themeContext.states){
    for(const key of ['sameBody','sameTab','sameRow','focus','open'])assert.equal(state[key],true,`${state.design}: theme change retains ${key}`);
    assert.equal(state.scroll,themeContext.scroll,`${state.design}: theme change retains detail scroll`);
    assert.equal(state.tab,'tracks');
  }
  const cycles=await evaluate(`(()=>{const f=fixture,p=f.sharedPanel,out=[];for(let i=0;i<3;i++)for(const design of ['archive','rhine']){f.stage.dataset.design=design;f.shell.setActive(design==='archive');document.querySelector('#selection-profile').innerHTML=f.renderProfile(design);f.renderSourceDetail();p.setOpen(false);p.finish();out.push({active:p.active,header:p.element.contains(document.querySelector('.album-callout')),article:p.element.contains(document.querySelector('#album-detail-content')),closed:document.querySelector('#album-detail-content').hidden,button:!document.querySelector('.open-album').hidden});}return out;})()`);
  assert.ok(cycles.every(x=>x.active&&x.header&&x.article&&x.closed&&x.button));
  const restored=await evaluate(`(()=>{const f=fixture;f.sharedPanel.setActive(false);f.shell.setActive(false);const restore={browse:document.querySelector('.album-callout').parentElement.id,detail:document.querySelector('#album-detail-content').parentElement.id,hidden:f.sharedPanel.element.hidden,marker:f.stage.hasAttribute('data-album-panel'),tabindex:document.querySelector('#three-scene').getAttribute('tabindex')};f.sharedPanel.destroy();return{...restore,destroyed:!document.querySelector('.album-panel')};})()`);
  assert.equal(restored.browse,'music-browse');assert.equal(restored.detail,'music-detail');assert.equal(restored.hidden,true);assert.equal(restored.marker,false);assert.equal(restored.destroyed,true);assert.equal(restored.tabindex,null);
  assert.equal(await evaluate(`document.querySelector('.album-panel-veil')===null`),true,'Destroy must remove the persistent reading veil');
  await writeFile(path.join(output,'album-open-flow.json'),JSON.stringify({report,responsive,themeContext,cycles,restored},null,2));
}
