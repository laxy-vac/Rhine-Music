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
    assert.equal(closed.buttons,1);assert.equal(closed.playButtons,1);assert.equal(closed.focusStyle,'none');assert.equal(closed.shadow,'none');
    const titleRect=await evaluate(`(()=>{const r=document.querySelector('.album-callout h1').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:titleRect.x,y:titleRect.y});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:titleRect.x,y:titleRect.y,button:'left',clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:titleRect.x,y:titleRect.y,button:'left',clickCount:1});
    const mouseFocus=await evaluate(`(()=>{
      const f=fixture,p=f.sharedPanel,host=p.element.closest('.foobar-home-info')||(p.element.parentElement!==f.stage?p.element.parentElement:null),nodes=[...(host?[['host',host]]:[]),['panel',p.element],['scroll',p.scrollTarget()],['callout',document.querySelector('.album-callout')],['article',document.querySelector('#album-detail-content')]];
      const style=node=>{const s=getComputedStyle(node);return{outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,boxShadow:s.boxShadow,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth]};};
      return{active:document.activeElement===p.element?'panel':document.activeElement===host?'host':document.activeElement?.className||document.activeElement?.id||'',state:p.element.dataset.panelState,
        hostName:host?.id||host?.className||'stage excluded',styles:nodes.map(([name,node])=>({name,...style(node)}))};
    })()`);
    assert.equal(mouseFocus.active,'panel',`${design}: a real pointer click in the information area focuses its panel host.`);
    assert.equal(mouseFocus.state,'browse');
    for(const sample of mouseFocus.styles){
      assert.ok(sample.outlineStyle==='none'||sample.outlineWidth==='0px',`${design} mouse ${sample.name} outline: ${JSON.stringify(sample)}`);
      assert.equal(sample.boxShadow,'none',`${design} mouse ${sample.name} ring: ${JSON.stringify(sample)}`);
      assert.deepEqual(sample.borders,Array(4).fill('0px'),`${design} mouse ${sample.name} border: ${JSON.stringify(sample)}`);
    }
    const containerFocus=await evaluate(`(()=>{
      const f=fixture,p=f.sharedPanel,host=p.element.closest('.foobar-home-info')||(p.element.parentElement!==f.stage?p.element.parentElement:null),nodes=[...(host?[['host',host]]:[]),['panel',p.element],['scroll',p.scrollTarget()],['callout',document.querySelector('.album-callout')]],saved=nodes.map(([,node])=>node.getAttribute('tabindex'));
      for(const [,node] of nodes)if(!node.hasAttribute('tabindex'))node.setAttribute('tabindex','-1');
      const style=node=>{const s=getComputedStyle(node);return{outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,boxShadow:s.boxShadow,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth]};};
      const states=[];
      for(const [name,target] of nodes){target.focus({preventScroll:true});states.push({target:name,focused:document.activeElement===target,styles:nodes.map(([name,node])=>({name,...style(node)}))});}
      nodes.forEach(([,node],index)=>{const value=saved[index];if(value===null)node.removeAttribute('tabindex');else node.setAttribute('tabindex',value);});
      return{states,temporaryTabindex:nodes.filter(([,node],index)=>saved[index]===null).map(([name])=>name)};
    })()`);
    for(const state of containerFocus.states){assert.equal(state.focused,true,`${design} ${state.target} can be focused for the style guard.`);
      for(const sample of state.styles){assert.ok(sample.outlineStyle==='none'||sample.outlineWidth==='0px',`${design} keyboard ${state.target}/${sample.name} outline: ${JSON.stringify(sample)}`);
        assert.equal(sample.boxShadow,'none',`${design} keyboard ${state.target}/${sample.name} ring: ${JSON.stringify(sample)}`);
        assert.deepEqual(sample.borders,Array(4).fill('0px'),`${design} keyboard ${state.target}/${sample.name} border: ${JSON.stringify(sample)}`);}}
    await evaluate(`document.querySelector('.browse-play-album').focus({preventScroll:true})`);
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    const keyboardOpen=await evaluate(`(()=>{const f=fixture,b=document.querySelector('.open-album'),g=document.querySelector('.album-actions'),s=getComputedStyle(b),gs=getComputedStyle(g),probe=document.createElement('span');probe.style.color=getComputedStyle(f.stage).getPropertyValue('--accent');f.stage.append(probe);const accent=getComputedStyle(probe).color;probe.remove();const r=b.getBoundingClientRect(),p=f.sharedPanel.element.getBoundingClientRect();return{active:document.activeElement===b,visible:b.matches(':focus-visible'),outline:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor,accent,offset:s.outlineOffset,
      groupOutline:gs.outlineStyle,groupWidth:gs.outlineWidth,groupColor:gs.outlineColor,groupOffset:gs.outlineOffset,rect:{width:r.width,height:r.height},panel:{width:p.width,height:p.height}};})()`);
    assert.equal(keyboardOpen.active,true,`${design}: keyboard Tab reaches the open button.`);
    assert.equal(keyboardOpen.visible,true,`${design}: keyboard focus remains visible on the native button.`);
    if(design==='archive') {
      assert.equal(keyboardOpen.outline,'solid');assert.equal(keyboardOpen.width,'2px');assert.equal(keyboardOpen.color,keyboardOpen.accent);
      assert.equal(keyboardOpen.offset,'-4px',`${design}: the child focus ring stays inset within the shared group frame.`);
      assert.equal(keyboardOpen.groupOutline,'solid');assert.equal(keyboardOpen.groupWidth,'1px');
      assert.equal(keyboardOpen.groupColor,keyboardOpen.accent);assert.equal(keyboardOpen.groupOffset,'4px');
    } else {
      assert.equal(keyboardOpen.outline,'solid',`${design}: Future retains its existing focused access button outline.`);
      assert.ok(parseFloat(keyboardOpen.width)>0,`${design}: keyboard focus has a visible outline.`);
      assert.equal(keyboardOpen.color,keyboardOpen.accent,`${design}: keyboard focus outline follows the current accent.`);
      assert.ok(parseFloat(keyboardOpen.offset)>0,`${design}: Future focus remains distinct from the button edge.`);
    }
    assert.ok(keyboardOpen.rect.width<keyboardOpen.panel.width/2&&keyboardOpen.rect.height<keyboardOpen.panel.height/2,
      `${design}: the focus frame stays on the small open button.`);
    const opening=await evaluate(`(async()=>{const f=fixture,p=f.sharedPanel,a=document.querySelector('#album-detail-content'),b=document.querySelector('.open-album'),surface=b.closest('.album-actions')??b,h=document.querySelector('.album-callout');b.focus({preventScroll:true});f.stage.dataset.mode='detail';p.setOpen(true);const shots=[],take=()=>{
      const buttonFrames=surface.getAnimations().flatMap(animation=>animation.effect?.getKeyframes()??[]);
      const hasClip=node=>node.getAnimations().some(animation=>animation.effect?.getKeyframes().some(frame=>typeof frame.clipPath==='string'));
      const fieldClipReveal=[...a.querySelectorAll('*')].some(hasClip);
      shots.push({state:p.element.dataset.panelState,hidden:a.hidden,buttonHidden:b.hidden,buttonInert:b.inert,height:a.getBoundingClientRect().height,clip:getComputedStyle(surface).clipPath,transform:getComputedStyle(surface).transform,
        buttonFrames,buttonDuration:surface.getAnimations()[0]?.effect?.getComputedTiming().duration??null,fieldClipReveal,buttonBackground:getComputedStyle(b).backgroundColor,
        same:a===document.querySelector('#album-detail-content')&&h===document.querySelector('.album-callout')});
    };take();await new Promise(r=>setTimeout(r,100));take();await new Promise(r=>setTimeout(r,310));take();await new Promise(r=>setTimeout(r,400));take();return shots;})()`);
    assert.equal(opening[0].state,'button-exit');assert.equal(opening[0].hidden,true);assert.equal(opening[0].buttonInert,true);
    assert.equal(opening[1].hidden,true);assert.equal(opening[1].height,0);
    assert.equal(opening[2].state,'expanding');assert.equal(opening[2].hidden,false);assert.equal(opening[2].buttonHidden,true);
    assert.equal(opening[3].state,'expanded');assert.ok(opening.every(x=>x.same));
    assert.ok(opening[0].buttonFrames.some(frame=>typeof frame.clipPath==='string'),`${design}: the action surface exits through a clip mask.`);
    if(design==='archive') {
      assert.equal(opening[0].buttonDuration,360,'Punk action group exit keeps its 360 ms duration.');
      assert.equal(opening[0].buttonFrames[0].opacity,1);assert.equal(opening[0].buttonFrames.at(-1).opacity,0);
      assert.ok(opening[0].buttonFrames.at(-1).transform.includes('translateY(-12px)')&&/scaleY\((?:\.88|0\.88)\)/.test(opening[0].buttonFrames.at(-1).transform));
      assert.ok(Number(opening[1].opacity)<1&&opening[1].transform!=='none',`${design}: group exit begins fading and compressing immediately.`);
      assert.notEqual(opening[1].clip,'none');
    } else {
      assert.notEqual(opening[1].clip,'none');assert.equal(opening[0].buttonDuration,240,'Future button mask keeps its 240 ms timing.');
      assert.ok(opening[0].buttonFrames.every(frame=>!frame.transform),'Future button exit does not rely on transform.');
      assert.notEqual(opening[0].buttonBackground,'rgb(0, 0, 0)','Future button animation does not paint a black placeholder.');
      assert.equal(opening[2].fieldClipReveal,true,'Future detail fields reveal with clip masks while the article expands.');
    }
    const articleFocus=await evaluate(`(()=>{
      const f=fixture,p=f.sharedPanel,host=p.element.closest('.foobar-home-info')||(p.element.parentElement!==f.stage?p.element.parentElement:null),nodes=[...(host?[['host',host]]:[]),['panel',p.element],['scroll',p.scrollTarget()],['callout',document.querySelector('.album-callout')],['article',document.querySelector('#album-detail-content')]],article=nodes.at(-1)[1],saved=article.getAttribute('tabindex');
      if(!article.hasAttribute('tabindex'))article.setAttribute('tabindex','-1');article.focus({preventScroll:true});
      const focused=document.activeElement===article,styles=nodes.map(([name,node])=>{const s=getComputedStyle(node);return{name,outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,boxShadow:s.boxShadow,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth]};});
      if(saved===null)article.removeAttribute('tabindex');else article.setAttribute('tabindex',saved);
      return{focused,styles,temporaryTabindex:saved===null};
    })()`);
    assert.equal(articleFocus.focused,true,`${design}: keyboard focus can reach the expanded article surface.`);
    for(const sample of articleFocus.styles){assert.ok(sample.outlineStyle==='none'||sample.outlineWidth==='0px',`${design} article ${sample.name} outline: ${JSON.stringify(sample)}`);
      assert.equal(sample.boxShadow,'none',`${design} article ${sample.name} ring: ${JSON.stringify(sample)}`);
      assert.deepEqual(sample.borders,Array(4).fill('0px'),`${design} article ${sample.name} border: ${JSON.stringify(sample)}`);}
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
    report.push({design,closed,mouseFocus,containerFocus,keyboardOpen,opening,articleFocus,focus,skin,closing,rapid,layoutPersistence,readingBackground});
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

// Narrow label-motion check: starts from the fixture's first visible browse state,
// then follows one real open/return flow and its interruption cases.
export async function checkAlbumLabelPanelMotion({command,evaluate,output}) {
  const fullLabel='打开专辑';
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  const viewport=await evaluate(`({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})`);
  assert.deepEqual(viewport,{width:1920,height:1080,deviceScaleFactor:1});
  const sampleLabel=`(()=>{
    const f=fixture,p=f.sharedPanel,label=document.querySelector('.open-album-label'),playLabel=document.querySelector('.play-album-label'),article=document.querySelector('#album-detail-content');
    return{state:p.element.dataset.panelState,label:label?.textContent?.trim()??'',playLabel:playLabel?.textContent?.trim()??'',panelHidden:p.element.hidden,buttonHidden:document.querySelector('.open-album').hidden,
      articleHidden:article.hidden,active:p.active,mode:f.musicApplication.mode,theme:f.stage.dataset.theme,design:f.stage.dataset.design,
      openCalls:f.presentation.openCalls,backCalls:f.presentation.backCalls,time:performance.now()};
  })()`;
  const initial=await evaluate(sampleLabel);
  assert.equal(initial.state,'browse','The first visible panel state must still be the initial browse state.');
  assert.equal(initial.active,true);assert.equal(initial.mode,'archive');assert.equal(initial.design,'archive');
  assert.equal(initial.panelHidden,false);assert.equal(initial.buttonHidden,false);assert.equal(initial.articleHidden,true);
  assert.equal(initial.label,fullLabel,'The first Punk browse label is complete before any open/close cycle.');
  assert.equal(initial.playLabel,'播放专辑','The play label is also complete before any open/close cycle.');

  const selectionChanges=[];
  for(const design of ['archive','rhine'])for(const theme of ['day','night']){
    const startFormat=design==='archive'?'FLAC 24/192':'FLAC · 24 bit / 192 kHz';
    const changedFormat=design==='archive'?'FLAC 16/44.1':'FLAC · 16 bit / 44.1 kHz';
    await evaluate(`(()=>{
      const f=fixture,style={...f.preferences.style,design:${JSON.stringify(design)},scheme:${JSON.stringify(design==='archive'?'archive':'rhine')}};
      f.preferences.style=style;f.preferences.theme=${JSON.stringify(theme)};f.stage.dataset.design=${JSON.stringify(design)};f.stage.dataset.theme=${JSON.stringify(theme)};
      f.applyStylePalette(f.stage,style,${JSON.stringify(theme)});f.shell.setActive(${design==='archive'});f.syncDesignIdentity();
      f.textMotion.finish();f.textMotion.update({...f.selection,format:${JSON.stringify(startFormat)}},false);
    })()`);
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await evaluate(`(()=>{fixture.sharedPanel.contentChanged(${JSON.stringify(`selection-${design}-${theme}`)});fixture.textMotion.update({...fixture.selection,format:${JSON.stringify(changedFormat)}},true);})()`);
    const frames=[];
    frames.push(await evaluate(sampleLabel));
    await evaluate(`new Promise(resolve=>setTimeout(resolve,150))`);frames.push(await evaluate(sampleLabel));
    await evaluate(`new Promise(resolve=>setTimeout(resolve,390))`);frames.push(await evaluate(sampleLabel));
    for(const frame of frames){
      assert.equal(frame.state,'browse',`${design}/${theme}: contentChanged keeps the panel in browse.`);
      assert.equal(frame.label,fullLabel,`${design}/${theme}: selection/content changes keep the open label complete.`);
      assert.equal(frame.playLabel,'播放专辑',`${design}/${theme}: selection/content changes keep the play label complete.`);
      assert.equal(frame.buttonHidden,false);assert.equal(frame.articleHidden,true);
    }
    selectionChanges.push({design,theme,frames});
  }

  await evaluate(`(()=>{
    const f=fixture,style={...f.preferences.style,design:'archive',scheme:'archive'};
    f.preferences.style=style;f.preferences.theme='day';f.stage.dataset.design='archive';f.stage.dataset.theme='day';f.stage.dataset.mode='archive';f.musicApplication.mode='archive';
    f.applyStylePalette(f.stage,style,'day');f.shell.setActive(true);f.syncDesignIdentity();
    f.textMotion.finish();f.textMotion.update({...f.selection,format:'FLAC 24/192'},false);
  })()`);
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const beforeFirstClick=await evaluate(sampleLabel);
  assert.equal(beforeFirstClick.state,'browse');assert.equal(beforeFirstClick.label,fullLabel);assert.equal(beforeFirstClick.playLabel,'播放专辑');
  await evaluate(`document.querySelector('.open-album').click()`);
  const opening=[];
  for(let i=0;i<18;i++){
    const frame=await evaluate(sampleLabel);opening.push(frame);
    if(frame.state!=='button-exit')break;
    await new Promise(resolve=>setTimeout(resolve,35));
  }
  assert.equal(opening[0].state,'button-exit','The first real open click must expose the production button-exit stage.');
  assert.ok(opening.every(frame=>frame.label===fullLabel&&frame.playLabel==='播放专辑'),`Opening the album must not type either label: ${JSON.stringify(opening)}`);
  let opened;
  for(let i=0;i<30;i++){
    opened=await evaluate(sampleLabel);if(opened.state==='expanded')break;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.equal(opened?.state,'expanded','The actual open exit must complete into the expanded article.');
  assert.equal(opened.label,fullLabel);assert.equal(opened.playLabel,'播放专辑');
  await evaluate(`(()=>{
    fixture.sharedPanel.contentChanged('fixture-album-changed-while-open');
    fixture.textMotion.update({...fixture.selection,format:'FLAC 16/44.1'},true);
  })()`);
  const openedContentFrames=[];
  openedContentFrames.push(await evaluate(sampleLabel));
  await evaluate(`new Promise(resolve=>setTimeout(resolve,150))`);openedContentFrames.push(await evaluate(sampleLabel));
  await evaluate(`new Promise(resolve=>setTimeout(resolve,330))`);openedContentFrames.push(await evaluate(sampleLabel));
  for(const frame of openedContentFrames){
    assert.equal(frame.state,'expanded','The selected album can change while the detail panel remains open.');
    assert.equal(frame.label,fullLabel,'A selected-album change while open must not type into the return button.');
    assert.equal(frame.playLabel,'播放专辑','A selected-album change while open must not type into the play button.');
    assert.equal(frame.buttonHidden,true);assert.equal(frame.articleHidden,false);
  }

  await evaluate(`document.querySelector('.music-back').click()`);
  const returning=[];let returnScreenshot;
  for(let i=0;i<36;i++){
    await new Promise(resolve=>setTimeout(resolve,35));
    const frame=await evaluate(sampleLabel);returning.push(frame);
    if(frame.state==='button-enter'&&frame.label!==fullLabel&&frame.playLabel!=='播放专辑'&&!returnScreenshot){
      const clip=await evaluate(`(()=>{const r=document.querySelector('.album-actions').getBoundingClientRect();return{x:Math.max(0,Math.floor(r.left-18)),y:Math.max(0,Math.floor(r.top-18)),width:Math.ceil(r.width+36),height:Math.ceil(r.height+36),scale:3};})()`);
      const image=await command('Page.captureScreenshot',{format:'png',clip});
      returnScreenshot='punk-return-action-group-enter.png';
      await writeFile(path.join(output,returnScreenshot),Buffer.from(image.data,'base64'));
    }
    if(frame.state==='browse')break;
  }
  const enterFrames=returning.filter(frame=>frame.state==='button-enter');
  assert.ok(enterFrames.length>0,'Returning to browse must run the real button-enter phase.');
  assert.ok(enterFrames.some(frame=>frame.label!==fullLabel&&frame.playLabel!=='播放专辑'&&/[#%/\\=<>_01]/.test(frame.label)&&/[#%/\\=<>_01]/.test(frame.playLabel)),
    `Both Punk labels must garble during button-enter: ${JSON.stringify(enterFrames)}`);
  assert.equal(returning.at(-1)?.state,'browse','The return animation must settle back to browse.');
  assert.equal(returning.at(-1)?.label,fullLabel,'The return animation restores the full label.');
  assert.equal(returning.at(-1)?.playLabel,'播放专辑','The return animation restores the full play label.');
  assert.ok(returnScreenshot,'A screenshot was captured during the real Punk button-enter text animation.');

  await evaluate(`document.querySelector('.open-album').click()`);
  let secondOpen;
  for(let i=0;i<30;i++){
    secondOpen=await evaluate(sampleLabel);if(secondOpen.state==='expanded')break;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.equal(secondOpen?.state,'expanded','The second open is used only after the first-open behavior was recorded.');
  await evaluate(`document.querySelector('.music-back').click()`);
  let garbledReturn;
  for(let i=0;i<30;i++){
    await new Promise(resolve=>setTimeout(resolve,35));garbledReturn=await evaluate(sampleLabel);
    if(garbledReturn.state==='button-enter'&&garbledReturn.label!==fullLabel)break;
  }
  assert.equal(garbledReturn?.state,'button-enter');
  assert.notEqual(garbledReturn?.label,fullLabel,'The interruption scenario begins while the open label is visibly garbled.');
  assert.notEqual(garbledReturn?.playLabel,'播放专辑','The interruption scenario begins while the play label is visibly garbled.');
  await evaluate(`fixture.sharedPanel.setOpen(true)`);
  const interrupted=await evaluate(sampleLabel);
  assert.equal(interrupted.state,'button-exit');
  assert.equal(interrupted.label,fullLabel,'Reopening during button-enter cancels typing and restores the open label.');
  assert.equal(interrupted.playLabel,'播放专辑','Reopening during button-enter cancels typing and restores the play label.');
  let interruptedOpen;
  for(let i=0;i<30;i++){
    interruptedOpen=await evaluate(sampleLabel);if(interruptedOpen.state==='expanded')break;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.equal(interruptedOpen?.state,'expanded');assert.equal(interruptedOpen.label,fullLabel);assert.equal(interruptedOpen.playLabel,'播放专辑');

  await evaluate(`(()=>{fixture.sharedPanel.setOpen(false);})()`);
  let interruptedClosed;
  for(let i=0;i<30;i++){
    interruptedClosed=await evaluate(sampleLabel);if(interruptedClosed.state==='browse')break;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.equal(interruptedClosed?.state,'browse');assert.equal(interruptedClosed.label,fullLabel);assert.equal(interruptedClosed.playLabel,'播放专辑');

  await evaluate(`document.querySelector('.open-album').click()`);
  let reducedOpen;
  for(let i=0;i<30;i++){
    reducedOpen=await evaluate(sampleLabel);if(reducedOpen.state==='expanded')break;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.equal(reducedOpen?.state,'expanded');
  await evaluate(`fixture.setReduced(true);document.querySelector('.music-back').click()`);
  const reduced=await evaluate(sampleLabel);
  assert.equal(reduced.state,'browse','Reduced motion settles the return directly into browse.');
  assert.equal(reduced.label,fullLabel,'Reduced motion leaves no partial or garbled open label.');
  assert.equal(reduced.playLabel,'播放专辑','Reduced motion leaves no partial or garbled play label.');
  assert.equal(reduced.buttonHidden,false);assert.equal(reduced.articleHidden,true);
  await evaluate(`fixture.setReduced(false)`);

  await writeFile(path.join(output,'album-label-panel-motion.json'),JSON.stringify({
    fixture:'First-visible production setupAlbumPanel state, actual extracted production click handler, real button-exit/button-enter animation, offline Chromium.',
    viewport,initial,selectionChanges,beforeFirstClick,opening,opened,openedContentFrames,returning,returnScreenshot,interrupted,interruptedOpen,interruptedClosed,reduced,
  },null,2));
}

// Focused group animation proof for --unified-album-actions. The runner enters
// this check after the first real production open click has settled in detail.
export async function checkUnifiedAlbumActionMotion({command,evaluate,output}) {
  const evidence = { fixture: "Production album panel controller and extracted click listener; first open is performed by the preceding action check.", returnScreenshot: null };
  const reportPath = path.join(output, "unified-album-action-motion.json");
  const saveEvidence = async (status = "in-progress", error = undefined) => {
    await writeFile(reportPath, JSON.stringify({ status, ...(error ? { error } : {}), evidence }, null, 2));
  };
  const sampleExpression = `(()=>{
    const f=fixture,p=f.sharedPanel,group=document.querySelector('.album-actions'),play=group.querySelector('.browse-play-album'),open=group.querySelector('.open-album');
    const rect=node=>{const r=node.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const clipArea=(button,clip)=>{
      const box=rect(group),target=rect(button),inset=(clip||'').startsWith('inset(')?(clip||'').slice(6,(clip||'').lastIndexOf(')')):'';
      if(!inset)return Math.max(0,target.width)*Math.max(0,target.height);
      const values=[];let token='',depth=0;
      for(const character of inset){
        if(character==='(')depth++;else if(character===')')depth--;
        if(/\\s/.test(character)&&depth===0){if(token)values.push(token);token='';}else token+=character;
      }
      if(token)values.push(token);
      const expanded=values.length===1?[values[0],values[0],values[0],values[0]]
        :values.length===2?[values[0],values[1],values[0],values[1]]
          :values.length===3?[values[0],values[1],values[2],values[1]]:values.slice(0,4);
      if(expanded.length!==4)throw new Error('Could not parse computed inset clip-path: '+clip);
      const size=(value,length)=>{
        if(value.startsWith('calc(')){
          const body=value.slice(5,-1).trim(),percentEnd=body.indexOf('%');
          const percentage=Number.parseFloat(body.slice(0,percentEnd)),rest=body.slice(percentEnd+1).trim(),operator=rest[0],pixels=rest.slice(1).trim();
          if(percentEnd<0||!Number.isFinite(percentage)||!['+','-'].includes(operator)||!pixels.endsWith('px')||!Number.isFinite(Number.parseFloat(pixels)))
            throw new Error('Unsupported computed inset length: '+value);
          return percentage*length/100+(operator==='-'?-1:1)*Number.parseFloat(pixels);
        }
        if(value.endsWith('%'))return Number.parseFloat(value)*length/100;
        if(value.endsWith('px'))return Number.parseFloat(value);
        if(value==='0')return 0;
        throw new Error('Unsupported computed inset length: '+value);
      };
      const width=group.offsetWidth,height=group.offsetHeight,top=size(expanded[0],height),right=size(expanded[1],width);
      const bottom=size(expanded[2],height),left=size(expanded[3],width),style=getComputedStyle(group);
      const matrix=new DOMMatrixReadOnly(style.transform==='none'?'matrix(1,0,0,1,0,0)':style.transform);
      const visible={left:box.left+left*matrix.a,right:box.left+(width-right)*matrix.a,
        top:box.top+top*matrix.d,bottom:box.top+(height-bottom)*matrix.d};
      return Math.max(0,Math.min(target.right,visible.right)-Math.max(target.left,visible.left))*
        Math.max(0,Math.min(target.bottom,visible.bottom)-Math.max(target.top,visible.top));
    };
    const style=getComputedStyle(group),matrix=new DOMMatrixReadOnly(style.transform==='none'?'matrix(1,0,0,1,0,0)':style.transform);
    const animations=group.getAnimations().map(animation=>({duration:animation.effect?.getComputedTiming().duration??null,
      currentTime:animation.currentTime,keyframes:animation.effect?.getKeyframes()??[]}));
    return{state:p.element.dataset.panelState,mode:f.musicApplication.mode,stageMode:f.stage.dataset.mode,time:performance.now(),
      group:{rect:rect(group),opacity:Number(style.opacity),clip:style.clipPath,transform:style.transform,
        transformMatrix:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f],hidden:group.hidden,inert:group.inert,
        playArea:clipArea(play,style.clipPath),openArea:clipArea(open,style.clipPath),animations},
      labels:{play:play.querySelector('.play-album-label')?.textContent?.trim()??'',open:open.querySelector('.open-album-label')?.textContent?.trim()??''},
      buttons:[play,open].map(button=>({action:button.dataset.action,hidden:button.hidden,inert:button.inert,rect:rect(button)})),
      article:{hidden:document.querySelector('#album-detail-content').hidden,inert:document.querySelector('#album-detail-content').inert}};
  })()`;
  const sample = () => evaluate(sampleExpression);
  const settleState = async (wanted, limit = 70) => {
    const frames=[];
    for(let attempt=0;attempt<limit;attempt++){
      await evaluate("new Promise(resolve=>setTimeout(resolve,20))");
      const frame=await sample();frames.push(frame);
      if(frame.state===wanted)return frames;
    }
    return frames;
  };
  const transformDelta = (left,right) => Math.max(...left.map((value,index)=>Math.abs(value-right[index])));
  try {
    await command("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    const start=await sample();evidence.start=start;await saveEvidence();
    assert.equal(start.state,"expanded","The first actual open must settle into detail before return motion is measured.");
    assert.equal(start.article.hidden,false);assert.equal(start.group.hidden,true);assert.equal(start.group.inert,true);
    assert.deepEqual(start.labels,{play:"播放专辑",open:"打开专辑"});

    // First return is the first real browse return. Capture the group itself and
    // both label streams together at each sampled frame.
    await evaluate("document.querySelector('.music-back').click()");
    const returning=[];
    for(let attempt=0;attempt<40;attempt++){
      await evaluate("new Promise(resolve=>setTimeout(resolve,20))");
      const frame=await sample();returning.push(frame);
      const enterTime=frame.group.animations[0]?.currentTime??0;
      if(frame.state==="button-enter"&&enterTime>=230&&enterTime<=340&&frame.labels.play!=="播放专辑"&&frame.labels.open!=="打开专辑"&&!evidence.returnScreenshot){
        const clip=await evaluate("(()=>{const r=document.querySelector('.album-actions').getBoundingClientRect();return{x:Math.max(0,Math.floor(r.left-18)),y:Math.max(0,Math.floor(r.top-18)),width:Math.ceil(r.width+36),height:Math.ceil(r.height+36),scale:3};})()");
        const image=await command("Page.captureScreenshot",{format:"png",clip});
        evidence.returnScreenshot="punk-action-group-return-mid.png";
        evidence.returnMidAnimation={currentTime:enterTime,opacity:frame.group.opacity,clip:frame.group.clip,labels:frame.labels,
          visibleArea:{play:frame.group.playArea,open:frame.group.openArea}};
        evidence.screenshots=[...(evidence.screenshots??[]),evidence.returnScreenshot];
        await writeFile(path.join(output,evidence.returnScreenshot),Buffer.from(image.data,"base64"));
      }
      if(frame.state==="browse")break;
    }
    evidence.returning=returning;
    await saveEvidence();
    const enterFrames=returning.filter(frame=>frame.state==="button-enter");
    assert.ok(evidence.returnScreenshot,"Capture the Punk return animation at its group midpoint.");
    assert.ok(enterFrames.length>0,"The first real back click must run group button-enter.");
    assert.equal(enterFrames[0].group.animations[0]?.duration,560,"Punk return expands over 560ms.");
    const synchronized=enterFrames.find(frame=>frame.group.opacity>0&&frame.group.opacity<1&&
      frame.group.playArea>0&&frame.group.openArea>0&&frame.buttons.every(button=>button.rect.width>0&&button.rect.height>0));
    assert.ok(synchronized,`Both Punk halves must have visible clipped area under the same changing group opacity: ${JSON.stringify(enterFrames.slice(0,4))}`);
    assert.ok(enterFrames.some(frame=>frame.labels.play!=="播放专辑"&&frame.labels.open!=="打开专辑"),
      `Both Punk labels should type during return: ${JSON.stringify(enterFrames.slice(0,8).map(frame=>frame.labels))}`);
    assert.equal(returning.at(-1)?.state,"browse");
    assert.deepEqual(returning.at(-1)?.labels,{play:"播放专辑",open:"打开专辑"},"Both labels settle to full text together.");
    assert.ok(returning.at(-1)?.group.opacity>0.99);
    assert.ok(returning.at(-1)?.buttons.every(button=>!button.hidden&&!button.inert));

    // Content changes while browsing must never start either label reel.
    await evaluate(`(()=>{const f=fixture;f.musicApplication.selectedIndex=1;f.renderSourceDetail();f.sharedPanel.contentChanged('selection-change-during-browse');})()`);
    await evaluate("new Promise(resolve=>setTimeout(resolve,120))");
    evidence.selectionStable=await sample();await saveEvidence();
    assert.equal(evidence.selectionStable.state,"browse");
    assert.deepEqual(evidence.selectionStable.labels,{play:"播放专辑",open:"打开专辑"});

    // Start a production exit and return before it finishes. Computed style at
    // the reversal boundary must continue from the sampled in-flight value.
    await evaluate("document.querySelector('.open-album').click()");
    await evaluate("new Promise(resolve=>setTimeout(resolve,80))");
    const exitBefore=await sample();
    await evaluate("document.querySelector('.music-back').click()");
    const exitAfter=await sample();
    const exitContinuity={opacityDelta:Math.abs(exitAfter.group.opacity-exitBefore.group.opacity),
      transformDelta:transformDelta(exitAfter.group.transformMatrix,exitBefore.group.transformMatrix),
      clipBefore:exitBefore.group.clip,clipAfter:exitAfter.group.clip};
    evidence.exitReversal={before:exitBefore,after:exitAfter,continuity:exitContinuity};await saveEvidence();
    assert.equal(exitBefore.state,"button-exit");assert.equal(exitAfter.state,"button-enter");
    assert.ok(exitBefore.group.opacity>0&&exitBefore.group.opacity<1);
    assert.ok(exitContinuity.opacityDelta<=.03,`Exit-to-return opacity jumped: ${JSON.stringify(evidence.exitReversal)}`);
    assert.ok(exitContinuity.transformDelta<=.15,`Exit-to-return transform jumped: ${JSON.stringify(evidence.exitReversal)}`);
    assert.equal(exitContinuity.clipAfter,exitContinuity.clipBefore,"Exit-to-return clip starts from the captured computed clip.");
    assert.ok(exitAfter.group.animations[0]?.duration>=120&&exitAfter.group.animations[0]?.duration<560,
      "The reversed return duration follows remaining opacity distance with a 120ms minimum.");
    const afterExitReversal=await settleState("browse",40);
    evidence.exitReversal.frames=afterExitReversal;await saveEvidence();
    assert.equal(afterExitReversal.at(-1)?.state,"browse");

    // Reopen during an unfinished return. The group is still one inert surface,
    // so reverse the production controller directly and record the exact seam.
    await evaluate("document.querySelector('.open-album').click()");
    const expanded=await settleState("expanded",70);
    evidence.reopened=expanded.at(-1);await saveEvidence();
    assert.equal(evidence.reopened?.state,"expanded");
    await evaluate("document.querySelector('.music-back').click()");
    const entering=await settleState("button-enter",70);
    evidence.enterStartFrames=entering;await saveEvidence();
    assert.equal(entering.at(-1)?.state,"button-enter","Wait until article collapse hands off to the real action-group enter phase.");
    await evaluate("new Promise(resolve=>setTimeout(resolve,80))");
    const enterBefore=await sample();
    await evaluate("fixture.sharedPanel.setOpen(true)");
    const enterAfter=await sample();
    const enterContinuity={opacityDelta:Math.abs(enterAfter.group.opacity-enterBefore.group.opacity),
      transformDelta:transformDelta(enterAfter.group.transformMatrix,enterBefore.group.transformMatrix),
      clipBefore:enterBefore.group.clip,clipAfter:enterAfter.group.clip};
    evidence.enterReversal={before:enterBefore,after:enterAfter,continuity:enterContinuity};await saveEvidence();
    assert.equal(enterBefore.state,"button-enter");assert.equal(enterAfter.state,"button-exit");
    assert.ok(enterContinuity.opacityDelta<=.03,`Enter-to-open opacity jumped: ${JSON.stringify(evidence.enterReversal)}`);
    assert.ok(enterContinuity.transformDelta<=.15,`Enter-to-open transform jumped: ${JSON.stringify(evidence.enterReversal)}`);
    assert.equal(enterContinuity.clipAfter,enterContinuity.clipBefore,"Enter-to-open clip starts from the captured computed clip.");
    assert.ok(enterAfter.group.animations[0]?.duration>=120&&enterAfter.group.animations[0]?.duration<360,
      "The reversed exit duration follows remaining opacity distance with a 120ms minimum.");
    const reopened=await settleState("expanded",70);
    evidence.enterReversal.frames=reopened;await saveEvidence();
    assert.equal(reopened.at(-1)?.state,"expanded");

    // Future keeps its original horizontal 240ms mask, including when the same
    // shared action group is used in the full vertical text skin.
    await evaluate(`(()=>{const f=fixture,style={...f.preferences.style,design:'rhine',scheme:'rhine'};
      f.preferences.style=style;f.stage.dataset.design='rhine';f.stage.dataset.mode='detail';f.musicApplication.mode='detail';
      f.applyStylePalette(f.stage,style,f.preferences.theme);f.shell.setActive(false);f.syncDesignIdentity();f.renderSourceDetail();
      f.sharedPanel.setOpen(true);f.sharedPanel.finish();})()`);
    await evaluate("document.querySelector('.music-back').click()");
    const futureBrowse=await settleState("browse",30);evidence.futureBrowse=futureBrowse.at(-1);
    assert.equal(evidence.futureBrowse?.state,"browse");
    await evaluate("document.querySelector('.open-album').click()");
    const futureExit=await sample();evidence.futureExit=futureExit;await saveEvidence();
    assert.equal(futureExit.state,"button-exit");
    assert.equal(futureExit.group.animations[0]?.duration,240,"Future retains its original 240ms action mask.");
    assert.ok(futureExit.group.animations[0]?.keyframes.some(frame=>typeof frame.clipPath==="string"));
    assert.ok(futureExit.group.animations[0]?.keyframes.every(frame=>frame.transform===undefined),
      "Future exit remains the original clip mask without Punk vertical compression.");
    const futureOpened=await settleState("expanded",60);evidence.futureOpened=futureOpened.at(-1);await saveEvidence();
    assert.equal(evidence.futureOpened?.state,"expanded");
    await saveEvidence("passed");
  } catch (error) {
    await saveEvidence("failed", { name: error?.name, message: error?.message, stack: error?.stack });
    throw error;
  }
}
