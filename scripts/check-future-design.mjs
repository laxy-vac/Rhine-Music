import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const sizes=[[1920,1080],[1920,1200],[2048,1536],[2520,1080]];
const pageSelectors={
  music:'#music-browse',
  eq:'#music-eq-page',
  settings:'#music-settings',
  lyrics:'#music-lyrics-page',
  signal:'#music-signal-page',
  theme:'#music-theme-page',
};

async function checkTerminalLighting(evaluate) {
  const result=await evaluate(`(async()=>{
    const originalRaf=window.requestAnimationFrame,rafDescriptor=Object.getOwnPropertyDescriptor(window,'requestAnimationFrame');
    const root=document.createElement('div');root.className='music-app';root.dataset.design='rhine';root.dataset.page='eq';
    root.style.cssText='position:fixed;left:-10000px;top:0;width:1280px;height:720px;opacity:0;overflow:hidden;pointer-events:none;z-index:-1;';
    const page=document.createElement('section');page.id='music-eq-page';page.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;visibility:visible;';
    const controls=[];
    for(let index=0;index<80;index++){
      const control=document.createElement('button');control.type='button';control.className='eq-terminal-fixture';control.textContent='EQ '+index;
      control.style.cssText='position:absolute;left:'+(40+(index%10)*116)+'px;top:'+(40+Math.floor(index/10)*76)+'px;width:72px;height:36px;';
      page.append(control);controls.push(control);
    }
    controls[0].setAttribute('aria-pressed','false');
    const timer=document.createElement('span');timer.className='foobar-clock';timer.textContent='00:00:00';page.append(timer);root.append(page);document.body.append(root);
    const properties=['--terminal-light-level','--terminal-light-edge','--terminal-light-highlight','--terminal-light-shadow','--terminal-light-halo','--terminal-light-spread','--terminal-light-x','--terminal-light-y'];
    const sentinel=controls[1];sentinel.style.setProperty('--terminal-light-level','0.123','important');sentinel.style.setProperty('--terminal-light-x','7px');
    const savedStyle=Object.fromEntries(properties.map(name=>[name,{value:sentinel.style.getPropertyValue(name),priority:sentinel.style.getPropertyPriority(name)}]));
    let requestCount=0,controller;
    window.requestAnimationFrame=function(callback){requestCount++;return originalRaf.call(window,callback);};
    const nextFrame=()=>new Promise(resolve=>originalRaf.call(window,resolve));
    const settle=async()=>{await nextFrame();await nextFrame();};
    const readStyle=()=>Object.fromEntries(properties.map(name=>[name,{value:sentinel.style.getPropertyValue(name),priority:sentinel.style.getPropertyPriority(name)}]));
    try{
      controller=PageScanFixture.setupTerminalLighting(root);
      controller.setQuality({terminalLight:'full'});controller.setDirection({x:-.8,y:.3});controller.refresh();await settle();
      const fullMarked=root.querySelectorAll('[data-terminal-receiver]').length;
      const levels=[...root.querySelectorAll('[data-terminal-receiver]')].map(node=>Number(node.style.getPropertyValue('--terminal-light-level')));
      const fullFinite=levels.length>0&&levels.every(value=>Number.isFinite(value)&&value>0&&value<=.78);
      const baselineNeighbor=Number(controls[1].style.getPropertyValue('--terminal-light-level'));
      controls[0].focus({preventScroll:true});controls[0].setAttribute('aria-pressed','true');controller.refresh();await settle();
      const focusedNeighbor=Number(controls[1].style.getPropertyValue('--terminal-light-level'));
      controls[0].setAttribute('aria-pressed','false');controls[0].blur();controller.refresh();await settle();

      controller.setQuality({terminalLight:'local'});await settle();
      const localMarked=root.querySelectorAll('[data-terminal-receiver]').length;
      controller.setQuality({terminalLight:'full'});controller.setDirection({x:-.8,y:.3});controller.refresh();await settle();
      const leftHighlight={x:controls[1].style.getPropertyValue('--terminal-light-x'),y:controls[1].style.getPropertyValue('--terminal-light-y')};
      controller.setDirection({x:.8,y:-.3});controller.refresh();await settle();
      const rightHighlight={x:controls[1].style.getPropertyValue('--terminal-light-x'),y:controls[1].style.getPropertyValue('--terminal-light-y')};

      const rafBeforeText=requestCount;
      for(let tick=1;tick<=8;tick++)timer.textContent='00:00:0'+(tick%10);
      await new Promise(resolve=>setTimeout(resolve,100));
      const textMutationRafRequests=requestCount-rafBeforeText;

      root.dataset.design='archive';controller.refresh();await settle();
      const punkMarked=root.querySelectorAll('[data-terminal-receiver]').length;
      root.dataset.design='rhine';controller.refresh();await settle();
      controller.setQuality({terminalLight:'off'});await settle();
      const offMarked=root.querySelectorAll('[data-terminal-receiver]').length;
      const offRestoredStyle=JSON.stringify(readStyle())===JSON.stringify(savedStyle);
      const offRootValue=root.getAttribute('data-terminal-lighting');
      controller.setQuality({terminalLight:'full'});await settle();
      const beforeDestroyMarked=root.querySelectorAll('[data-terminal-receiver]').length;
      controller.destroy();controller=undefined;
      return{fullMarked,localMarked,offMarked,fullFinite,baselineNeighbor,focusedNeighbor,
        highlightChanged:leftHighlight.x!==rightHighlight.x||leftHighlight.y!==rightHighlight.y,
        leftHighlight,rightHighlight,textMutationRafRequests,punkMarked,offRestoredStyle,offRootValue,beforeDestroyMarked,
        destroyMarked:root.querySelectorAll('[data-terminal-receiver]').length,
        destroyRootValue:root.getAttribute('data-terminal-lighting'),destroyRestoredStyle:JSON.stringify(readStyle())===JSON.stringify(savedStyle)};
    }finally{
      controller?.destroy();
      if(rafDescriptor)Object.defineProperty(window,'requestAnimationFrame',rafDescriptor);else delete window.requestAnimationFrame;
      root.remove();
    }
  })()`);
  assert.ok(result.fullMarked>0&&result.fullMarked<=64,'Full terminal light should cap receivers at 64.');
  assert.ok(result.localMarked>0&&result.localMarked<=18,'Local terminal light should cap receivers at 18.');
  assert.equal(result.offMarked,0,'Off quality should remove every receiver marker.');
  assert.equal(result.punkMarked,0,'Switching to Punk should remove all Future receiver markers.');
  assert.equal(result.fullFinite,true,'Lit EQ controls need finite, bounded light values.');
  assert.ok(result.focusedNeighbor>result.baselineNeighbor+0.05,
    `Focusing and selecting a nearby EQ control should brighten its neighbor ${JSON.stringify(result)}`);
  assert.equal(result.highlightChanged,true,
    `Reversing the environment direction should move the highlight ${JSON.stringify(result)}`);
  assert.equal(result.textMutationRafRequests,0,
    `Text-only timer changes must not schedule lighting frames ${JSON.stringify(result)}`);
  assert.equal(result.offRestoredStyle,true,'Off quality should clear controller light values and restore saved inline styles.');
  assert.equal(result.offRootValue,'off');
  assert.ok(result.beforeDestroyMarked>0,'Destroy should be exercised with live receiver markings.');
  assert.equal(result.destroyMarked,0,'destroy should remove terminal receiver markers.');
  assert.equal(result.destroyRootValue,null,'destroy should remove the root quality marker.');
  assert.equal(result.destroyRestoredStyle,true,'destroy should restore the element inline style.');
  return result;
}

export async function checkFutureDesign({command,evaluate,output,project}) {
  const bundle=await build({
    stdin:{contents:"export {PageScanTransition} from './src/ui-transitions';export {setupTerminalLighting} from './src/terminal-lighting';",resolveDir:project,loader:'ts'},
    bundle:true,write:false,format:'iife',globalName:'PageScanFixture',logLevel:'silent',
  });
  await evaluate(bundle.outputFiles[0].text);

  const viewport=await evaluate(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})`);
  const saved=await evaluate(`(()=>{
    const f=fixture,s=f.stage,eq=document.querySelector('#eq-page-content'),panel=f.sharedPanel,
      article=document.querySelector('#album-detail-content'),shell=s.querySelector('.foobar-shell');
    const keys=['design','page','theme','mode','layout','playbackVisible','reducedMotion'];
    const data=Object.fromEntries(keys.map(key=>[key,s.dataset[key]]));
    const sections=[...s.querySelectorAll('#music-browse,#music-detail,.music-settings-page')].map(node=>({id:node.id,hidden:node.hidden,inert:node.inert}));
    const settings=f.eqSettings?structuredClone(f.eqSettings):undefined;
    f.futureDesignRestore={data,sections,style:s.getAttribute('style'),eqSettings:settings,hadEqControls:!!f.eqControls,shellActive:!!shell&&!shell.hidden,
      playbackHidden:document.querySelector('#music-playback').hidden,
      themeButtons:[...s.querySelectorAll('.theme-switch [data-theme]')].map(node=>({theme:node.dataset.theme,pressed:node.getAttribute('aria-pressed')})),
      eqMode:f.eqSettings?.eq?.mode??eq.querySelector('.eq-controls')?.dataset.eqMode??'parametric',
      eqEngine:f.eqSettings?.eq?.engine??eq.querySelector('.eq-controls')?.dataset.eqEngine??'standard',
      eqExpanded:eq.querySelector('.eq-preset-disclosure')?.open??false,
      eqScroll:eq.scrollTop,eqStripScroll:eq.querySelector('.eq-parametric-strip')?.scrollLeft??0,
      panelActive:!!panel?.active,panelHidden:panel?.element.hidden??true,panelInert:panel?.element.inert??true,
      panelOpen:!!article&&!article.hidden,scanHidden:s.querySelector('.music-page-scan')?.hidden??true,
      playbackVisible:s.dataset.playbackVisible};
    return{mountEq:typeof f.mountEq,settingsMode:f.futureDesignRestore.eqMode,
      design:data.design,page:data.page,theme:data.theme,panelActive:f.futureDesignRestore.panelActive,
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
  })()`);

  const report={viewTransitions:[],eq:[],headerAndPlayback:[],rightPane:null,dial:null,punkReveal:null,terminalLighting:null};
  let mediaWasChanged=false;
  try {
    assert.equal(saved.mountEq,'function','The prior EQ fixture must expose fixture.mountEq.');
    const transitionSupport=await evaluate(`(()=>{
      const f=fixture,root=f.stage.querySelector('.music-page-scan');
      f.futureViewTransitions=[];
      f.futureStartViewTransitionDescriptor=Object.getOwnPropertyDescriptor(document,'startViewTransition');
      f.futureStartViewTransitionNative=typeof document.startViewTransition==='function'?document.startViewTransition.bind(document):undefined;
      if(f.futureStartViewTransitionNative)Object.defineProperty(document,'startViewTransition',{configurable:true,writable:true,value:update=>{
        const transition=f.futureStartViewTransitionNative(update);f.futureViewTransitions.push(transition);return transition;
      }});
      f.futurePageScan=new PageScanFixture.PageScanTransition(root);
      return{native:!!f.futureStartViewTransitionNative,scan:!!root,scanHidden:root?.hidden};
    })()`);
    assert.equal(transitionSupport.native,true,'The installed Chromium must expose native document.startViewTransition.');
    assert.equal(transitionSupport.scan,true,'The actual page scan node must exist in the source fixture.');
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    mediaWasChanged=true;

    console.log('Future: native page transition');
    const firstTransition=await evaluate(`(async()=>{
      const f=fixture,s=f.stage,browse=document.querySelector('#music-browse'),eq=document.querySelector('#music-eq-page'),scan=s.querySelector('.music-page-scan');
      const show=page=>{for(const [name,selector] of Object.entries(${JSON.stringify(pageSelectors)})){const node=document.querySelector(selector);node.hidden=name!==page;node.inert=name!==page;}s.dataset.page=page;f.sharedPanel.setVisible(page==='music');};
      s.dataset.design='rhine';f.shell.setActive(false);s.dataset.mode='archive';s.dataset.layout='desktop';show('music');scan.hidden=true;
      const before=f.futureViewTransitions.length;let updates=0;
      const accepted=f.futurePageScan.change(()=>{updates++;show('eq');},false);
      const transition=f.futureViewTransitions[before],settle=promise=>promise.then(()=>true,()=>false);
      const callback=await settle(transition.updateCallbackDone),ready=await settle(transition.ready);
      const animations=document.getAnimations({subtree:true}).filter(animation=>animation.effect?.pseudoElement?.includes('view-transition-'));
      const pseudoElements=animations.map(animation=>animation.effect.pseudoElement);
      const scanAtReady={hidden:scan.hidden,headAnimations:scan.firstElementChild?.getAnimations().length??0};
      const animationResults=await Promise.all(animations.map(animation=>settle(animation.finished)));
      const finished=await settle(transition.finished);
      return{accepted,updates,callback,ready,finished,pseudoElements,animationsEnded:animationResults.every(Boolean),
        animationStates:animations.map(animation=>animation.playState),scanAtReady,page:s.dataset.page,browseHidden:browse.hidden,eqHidden:eq.hidden,
        names:{navigation:getComputedStyle(s.querySelector('.music-header')).viewTransitionName,
          transport:getComputedStyle(document.querySelector('#music-playback')).viewTransitionName,
          title:getComputedStyle(eq.querySelector('.settings-page-heading')).viewTransitionName,
          content:getComputedStyle(eq.querySelector('.settings-page-layout')).viewTransitionName}};
    })()`);
    assert.equal(firstTransition.accepted,true,'Future page navigation should use native View Transitions.');
    assert.equal(firstTransition.callback,true,'Future navigation update callback should complete.');
    assert.equal(firstTransition.ready,true,'nativeTransition.ready must resolve.');
    assert.equal(firstTransition.finished,true,'nativeTransition.finished must resolve.');
    assert.equal(firstTransition.animationsEnded,true,'Future pseudo-element animations must finish.');
    assert.deepEqual(firstTransition.names,{navigation:'future-navigation',transport:'future-transport',title:'future-title',content:'future-content'});
    assert.ok(firstTransition.pseudoElements.some(name=>name.includes('future-title')),'View Transition should animate the page title snapshot.');
    assert.ok(firstTransition.pseudoElements.some(name=>name.includes('future-content')),'View Transition should animate the page content snapshot.');
    assert.deepEqual(firstTransition.scanAtReady,{hidden:true,headAnimations:0},'Future navigation must not show the full-screen scan.');
    assert.equal(firstTransition.page,'eq');assert.equal(firstTransition.browseHidden,true);assert.equal(firstTransition.eqHidden,false);
    report.viewTransitions.push({direction:'music-to-eq',...firstTransition});

    console.log('Future: return transition');
    const returnTransition=await evaluate(`(async()=>{
      const f=fixture,s=f.stage,browse=document.querySelector('#music-browse'),eq=document.querySelector('#music-eq-page'),scan=s.querySelector('.music-page-scan');
      const show=page=>{for(const [name,selector] of Object.entries(${JSON.stringify(pageSelectors)})){const node=document.querySelector(selector);node.hidden=name!==page;node.inert=name!==page;}s.dataset.page=page;f.sharedPanel.setVisible(page==='music');};
      const before=f.futureViewTransitions.length;let updates=0;
      const accepted=f.futurePageScan.change(()=>{updates++;show('music');},false),transition=f.futureViewTransitions[before],settle=promise=>promise.then(()=>true,()=>false);
      const callback=await settle(transition.updateCallbackDone),ready=await settle(transition.ready);
      const animations=document.getAnimations({subtree:true}).filter(animation=>animation.effect?.pseudoElement?.includes('view-transition-'));
      const pseudoElements=animations.map(animation=>animation.effect.pseudoElement);
      const scanAtReady={hidden:scan.hidden,headAnimations:scan.firstElementChild?.getAnimations().length??0};
      const animationResults=await Promise.all(animations.map(animation=>settle(animation.finished))),finished=await settle(transition.finished);
      return{accepted,updates,callback,ready,finished,pseudoElements,animationsEnded:animationResults.every(Boolean),scanAtReady,page:s.dataset.page,browseHidden:browse.hidden,eqHidden:eq.hidden};
    })()`);
    assert.equal(returnTransition.accepted,true);assert.equal(returnTransition.callback,true);
    assert.equal(returnTransition.ready,true,'Return nativeTransition.ready must resolve.');assert.equal(returnTransition.finished,true);
    assert.equal(returnTransition.animationsEnded,true);assert.deepEqual(returnTransition.scanAtReady,{hidden:true,headAnimations:0});
    assert.equal(returnTransition.page,'music');assert.equal(returnTransition.browseHidden,false);assert.equal(returnTransition.eqHidden,true);
    report.viewTransitions.push({direction:'eq-to-music',...returnTransition});

    console.log('Future: interrupted transitions');
    const rapid=await evaluate(`(async()=>{
      const f=fixture,s=f.stage,browse=document.querySelector('#music-browse'),eq=document.querySelector('#music-eq-page'),settings=document.querySelector('#music-settings');
      const show=page=>{for(const [name,selector] of Object.entries(${JSON.stringify(pageSelectors)})){const node=document.querySelector(selector);node.hidden=name!==page;node.inert=name!==page;}s.dataset.page=page;f.sharedPanel.setVisible(page==='music');};
      const before=f.futureViewTransitions.length;let firstUpdates=0,lastUpdates=0;
      const firstAccepted=f.futurePageScan.change(()=>{firstUpdates++;show('eq');},false);
      const lastAccepted=f.futurePageScan.change(()=>{lastUpdates++;show('settings');},false);
      const first=f.futureViewTransitions[before],last=f.futureViewTransitions[before+1],settle=promise=>promise.then(()=>true,()=>false);
      const oldDone=Promise.all([first.updateCallbackDone,first.ready,first.finished].map(settle));
      const callback=await settle(last.updateCallbackDone),ready=await settle(last.ready);
      const animations=document.getAnimations({subtree:true}).filter(animation=>animation.effect?.pseudoElement?.includes('view-transition-')),pseudoElements=animations.map(animation=>animation.effect.pseudoElement);
      const animationResults=await Promise.all(animations.map(animation=>settle(animation.finished))),finished=await settle(last.finished);
      await oldDone;
      return{firstAccepted,lastAccepted,firstUpdates,lastUpdates,callback,ready,finished,animationsEnded:animationResults.every(Boolean),pseudoElements,
        page:s.dataset.page,browseHidden:browse.hidden,eqHidden:eq.hidden,settingsHidden:settings.hidden};
    })()`);
    assert.equal(rapid.firstAccepted,true);assert.equal(rapid.lastAccepted,true);assert.equal(rapid.firstUpdates,0,'Superseded Future navigation must not apply.');
    assert.equal(rapid.lastUpdates,1);assert.equal(rapid.callback,true);assert.equal(rapid.ready,true,'Latest nativeTransition.ready must resolve.');
    assert.equal(rapid.finished,true);assert.equal(rapid.animationsEnded,true);assert.equal(rapid.page,'settings');
    assert.equal(rapid.browseHidden,true);assert.equal(rapid.eqHidden,true);assert.equal(rapid.settingsHidden,false);
    report.viewTransitions.push({direction:'rapid-last-request-wins',...rapid});

    console.log('Future: reduced motion and Punk scan');
    const reduced=await evaluate(`(()=>{
      const f=fixture,s=f.stage,browse=document.querySelector('#music-browse'),eq=document.querySelector('#music-eq-page'),settings=document.querySelector('#music-settings'),scan=s.querySelector('.music-page-scan'),before=f.futureViewTransitions.length;
      let updates=0;const update=()=>{updates++;for(const [name,selector] of Object.entries(${JSON.stringify(pageSelectors)})){const node=document.querySelector(selector);node.hidden=name!=='music';node.inert=name!=='music';}s.dataset.page='music';f.sharedPanel.setVisible(true);};const accepted=f.futurePageScan.change(update,true);if(!accepted)update();
      return{accepted,updates,page:s.dataset.page,browseHidden:browse.hidden,eqHidden:eq.hidden,settingsHidden:settings.hidden,scanHidden:scan.hidden,transitions:f.futureViewTransitions.length-before};
    })()`);
    assert.equal(reduced.accepted,false);assert.equal(reduced.updates,1,'Reduced motion should apply the page update synchronously.');
    assert.equal(reduced.page,'music');assert.equal(reduced.browseHidden,false);assert.equal(reduced.eqHidden,true);assert.equal(reduced.settingsHidden,true);assert.equal(reduced.scanHidden,true);assert.equal(reduced.transitions,0);
    report.viewTransitions.push({direction:'reduced-sync',...reduced});

    await evaluate(`(()=>{fixture.stage.dataset.design='archive';const scan=fixture.stage.querySelector('.music-page-scan');scan.hidden=true;fixture.futurePageScan.reveal(false);fixture.futurePunkAnimation=scan.firstElementChild.getAnimations()[0];return{hidden:scan.hidden,animations:scan.firstElementChild.getAnimations().length,playState:fixture.futurePunkAnimation?.playState};})()`);
    const punkReveal=await evaluate(`(async()=>{const f=fixture,scan=f.stage.querySelector('.music-page-scan'),animation=f.futurePunkAnimation;const started={hidden:scan.hidden,animations:scan.firstElementChild.getAnimations().length,playState:animation?.playState};if(animation)await animation.finished.catch(()=>{});await new Promise(r=>setTimeout(r,0));return{...started,endedHidden:scan.hidden,endedPlayState:animation?.playState};})()`);
    assert.equal(punkReveal.hidden,false,'Punk page transitions should keep the scan reveal.');assert.ok(punkReveal.animations>0);
    assert.equal(punkReveal.endedHidden,true);report.punkReveal=punkReveal;

    const preparePage=async(page,theme='day')=>{
      await evaluate(`(()=>{
        const f=fixture,s=f.stage;s.dataset.design='rhine';s.dataset.theme=${JSON.stringify(theme)};s.dataset.layout='desktop';s.dataset.mode='archive';s.dataset.page=${JSON.stringify(page)};
        EqFixture.applyStylePalette(s,{...EqFixture.archiveMusicStyle,design:'rhine',scheme:'rhine'},${JSON.stringify(theme)});
        f.shell.setActive(false);for(const [name,selector] of Object.entries(${JSON.stringify(pageSelectors)})){const node=document.querySelector(selector);node.hidden=name!==${JSON.stringify(page)};node.inert=name!==${JSON.stringify(page)};}
        document.querySelector('#music-detail').hidden=true;document.querySelector('#music-detail').inert=true;
        for(const button of s.querySelectorAll('.theme-switch [data-theme]'))button.setAttribute('aria-pressed',String(button.dataset.theme===s.dataset.theme));
        for(const [action,page] of Object.entries({library:'music',eq:'eq',lyrics:'lyrics',signal:'signal',theme:'theme',settings:'settings'}))s.querySelector('.music-topnav [data-action="'+action+'"]')?.setAttribute('aria-pressed',String(page===s.dataset.page));
        const playback=document.querySelector('#music-playback');playback.hidden=false;f.updatePlayback({...f.state,transport:'playing',playing:true});s.dataset.playbackVisible='true';
        if(f.sharedPanel?.active){f.sharedPanel.setOpen(false);f.sharedPanel.finish();f.sharedPanel.setVisible(${JSON.stringify(page==='music')});}
      })()`);
      await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    };
    const capture=async(name)=>{
      await evaluate(`new Promise(r=>setTimeout(r,760))`);
      const image=await command('Page.captureScreenshot',{format:'png'});
      await writeFile(path.join(output,name),Buffer.from(image.data,'base64'));
    };
    const readHeader=async()=>evaluate(`(()=>{
      const nav=document.querySelector('.music-topnav'),children=[...nav.children],clock=nav.querySelector('.foobar-clock'),theme=nav.querySelector('.theme-switch'),settings=nav.querySelector('[data-action="settings"]'),cs=getComputedStyle(clock),r=clock.getBoundingClientRect();
      return{order:[children.indexOf(theme),children.indexOf(clock),children.indexOf(settings)],count:document.querySelectorAll('.music-topnav .foobar-clock').length,
        time:clock.querySelector('strong')?.textContent,border:{top:cs.borderTopWidth,right:cs.borderRightWidth,bottom:cs.borderBottomWidth,left:cs.borderLeftWidth,radius:cs.borderRadius,background:cs.backgroundColor,shadow:cs.boxShadow},bounds:r.toJSON()};
    })()`);
    const readPlayback=async()=>evaluate(`(()=>{
      const playback=document.querySelector('#music-playback'),r=playback.getBoundingClientRect(),cs=getComputedStyle(playback),inside=node=>{const b=node.getBoundingClientRect();return b.x>=r.x-1&&b.right<=r.right+1&&b.y>=r.y-1&&b.bottom<=r.bottom+1;};
      const controls=[...playback.querySelectorAll('button,input,.playback-song,.playback-timeline,.playback-volume')].filter(node=>getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden'&&node.getClientRects().length>0);
      return{hidden:playback.hidden,radius:cs.borderRadius,radiusPx:parseFloat(cs.borderTopLeftRadius),bounds:r.toJSON(),viewport:{width:innerWidth,height:innerHeight},scroll:{client:playback.clientWidth,total:playback.scrollWidth},controls:controls.map(node=>({name:node.id||node.className||node.tagName,bounds:node.getBoundingClientRect().toJSON(),inside:inside(node)}))};
    })()`);

    console.log('Future: header, album and EQ geometry');
    await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
    for(const theme of ['day','night']) {
      await preparePage('music',theme);
      const header=await readHeader(),playback=await readPlayback();
      assert.ok(header.order[0]>=0&&header.order[0]<header.order[1]&&header.order[1]<header.order[2],`${theme}: Future clock order ${JSON.stringify(header)}`);
      assert.equal(header.count,1);assert.match(header.time,/\d{2}:\d{2}:\d{2}/);
      assert.equal(header.border.top,'0px');assert.equal(header.border.right,'0px');assert.equal(header.border.bottom,'0px');
      assert.equal(header.border.radius,'0px');assert.equal(header.border.background,'rgba(0, 0, 0, 0)');assert.equal(header.border.shadow,'none');
      assert.equal(playback.hidden,false);assert.ok(playback.radiusPx>=playback.bounds.height/2-1,`${theme}: Future playback retains a capsule silhouette ${playback.radius}`);
      assert.ok(playback.bounds.x>=0&&playback.bounds.y>=0&&playback.bounds.right<=1920+1&&playback.bounds.bottom<=1080+1,`${theme}: Future playback is clipped ${JSON.stringify(playback)}`);
      assert.ok(playback.scroll.total<=playback.scroll.client+1);assert.ok(playback.controls.length>0&&playback.controls.every(control=>control.inside),`${theme}: Future playback controls must remain visible ${JSON.stringify(playback.controls)}`);
      report.headerAndPlayback.push({theme,header,playback});
    }

    await preparePage('music','day');
    await evaluate(`(()=>{const f=fixture,p=f.sharedPanel,profile=document.querySelector('#selection-profile'),callout=document.querySelector('.album-callout'),article=document.querySelector('#album-detail-content');
      profile.innerHTML=f.renderProfile('rhine');profile.hidden=false;
      const title=document.querySelector('#selection-title');title.dataset.hiRes='true';title.dataset.dsd='false';document.querySelector('#selection-hi-res').hidden=false;document.querySelector('#selection-dsd').hidden=true;f.title.update('18 Plus',false);
      p.setVisible(true);p.setOpen(false);p.finish();f.renderSharedTab('tracks');return true;})()`);
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const rightPane=await evaluate(`(()=>{
      const panel=fixture.sharedPanel.element,viewport=panel.querySelector('.album-panel-scroll'),profile=panel.querySelector('#selection-profile'),callout=panel.querySelector('.album-callout'),article=panel.querySelector('#album-detail-content'),tabs=article.querySelector('.music-tabs'),rows=[...article.querySelectorAll('.track-row')],r=panel.getBoundingClientRect();
      return{active:fixture.sharedPanel.active,visible:!panel.hidden,profile:!!profile&&profile.getClientRects().length>0,callout:!!callout&&callout.getClientRects().length>0,
        profileInCallout:callout.contains(profile),calloutBeforeArticle:!!(callout.compareDocumentPosition(article)&Node.DOCUMENT_POSITION_FOLLOWING),tabs:!!tabs,
        articleHidden:article.hidden,articleInert:article.inert,rowCount:rows.length,allRowsHidden:rows.every(row=>row.getClientRects().length===0),
        bounds:r.toJSON(),viewport:{clientWidth:viewport.clientWidth,scrollWidth:viewport.scrollWidth},offenders:[...viewport.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>r.right+1).slice(0,8).map(n=>({name:n.id||n.className,bounds:n.getBoundingClientRect().toJSON()}))};
    })()`);
    assert.equal(rightPane.active,true);assert.equal(rightPane.visible,true);assert.equal(rightPane.profile,true);assert.equal(rightPane.callout,true);
    assert.equal(rightPane.profileInCallout,true);assert.equal(rightPane.calloutBeforeArticle,true);assert.equal(rightPane.tabs,true);
    assert.equal(rightPane.articleHidden,true);assert.equal(rightPane.articleInert,true);assert.equal(rightPane.rowCount,30);assert.equal(rightPane.allRowsHidden,true);
    assert.ok(rightPane.bounds.x>960&&rightPane.bounds.right<=1920+1);assert.ok(rightPane.viewport.scrollWidth<=rightPane.viewport.clientWidth+1,JSON.stringify(rightPane));
    report.rightPane=rightPane;
    await capture('future-archive-selected-day.png');

    for(const [width,height] of sizes) {
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      for(const mode of ['parametric','graphic']) {
        await preparePage('eq','day');
        await evaluate(`fixture.mountEq(${JSON.stringify(mode)},'standard',false)`);
        const geometry=await evaluate(`(()=>{
          const page=document.querySelector('#music-eq-page'),content=document.querySelector('#eq-page-content'),controls=content.querySelector('.eq-controls'),main=controls.querySelector('.eq-controls-main'),chart=controls.querySelector('.eq-response-figure'),pr=page.getBoundingClientRect(),cr=content.getBoundingClientRect(),mr=main.getBoundingClientRect(),gr=chart.getBoundingClientRect();
          return{viewport:{width:innerWidth,height:innerHeight},mode:controls.dataset.eqMode,page:{client:page.clientWidth,scroll:page.scrollWidth,bounds:pr.toJSON()},content:{client:content.clientWidth,scroll:content.scrollWidth,bounds:cr.toJSON()},main:mr.toJSON(),chart:{bounds:gr.toJSON(),position:getComputedStyle(chart).position},below:gr.top>=mr.bottom-1};
        })()`);
        assert.equal(geometry.page.scroll<=geometry.page.client+1,true,`${width}x${height} ${mode}: EQ page horizontal overflow ${JSON.stringify(geometry)}`);
        assert.equal(geometry.content.scroll<=geometry.content.client+1,true,`${width}x${height} ${mode}: EQ content horizontal overflow ${JSON.stringify(geometry)}`);
        assert.equal(geometry.mode,mode);assert.equal(geometry.below,true,`${width}x${height} ${mode}: response graph must follow controls ${JSON.stringify(geometry)}`);
        assert.equal(geometry.chart.position,'static');report.eq.push(geometry);
        if(width===1920&&height===1080&&mode==='parametric')await capture('future-eq-parametric-day.png');
        if(width===1920&&height===1080&&mode==='graphic')await capture('future-eq-graphic-day.png');
        if(width===1920&&height===1080&&mode==='parametric') {
          const dial=await evaluate(`(()=>{const node=document.querySelector('[data-eq-dial="frequency"]'),before=Number(node.getAttribute('aria-valuenow'));node.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));return{before,after:fixture.eqSettings.eq.bands[0].frequency,aria:Number(document.querySelector('[data-eq-dial="frequency"]')?.getAttribute('aria-valuenow'))};})()`);
          assert.ok(dial.after>dial.before,`Future EQ dial keyboard input must update actual EQ settings ${JSON.stringify(dial)}`);report.dial=dial;
        }
      }
    }
    await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
    await preparePage('eq','night');await evaluate(`fixture.mountEq('parametric','standard',false)`);
    const nightGeometry=await evaluate(`(()=>{const c=document.querySelector('#eq-page-content'),p=document.querySelector('#music-eq-page');return{client:c.clientWidth,scroll:c.scrollWidth,pageClient:p.clientWidth,pageScroll:p.scrollWidth,mode:c.querySelector('.eq-controls').dataset.eqMode};})()`);
    assert.ok(nightGeometry.scroll<=nightGeometry.client+1&&nightGeometry.pageScroll<=nightGeometry.pageClient+1,`Night Future EQ overflow ${JSON.stringify(nightGeometry)}`);
    await capture('future-eq-parametric-night.png');

    console.log('Future: terminal screen-space lighting');
    report.terminalLighting=await checkTerminalLighting(evaluate);
  } finally {
    await evaluate(`(async()=>{
      const f=fixture,s=f.stage,restore=f.futureDesignRestore;
      f.futurePageScan?.cancelPending?.();f.futurePageScan?.reveal(true);
      if(f.futureStartViewTransitionDescriptor)Object.defineProperty(document,'startViewTransition',f.futureStartViewTransitionDescriptor);
      else delete document.startViewTransition;
      if(restore){
        await f.eqControls?.destroy();f.eqControls=undefined;f.eqSelect?.destroy();f.eqSelect=undefined;
        for(const key of Object.keys(restore.data)){const value=restore.data[key];if(value===undefined)delete s.dataset[key];else s.dataset[key]=value;}
        if(restore.hadEqControls&&restore.eqSettings&&typeof f.mountEq==='function'){
          s.dataset.page='eq';document.querySelector('#music-browse').hidden=true;document.querySelector('#music-eq-page').hidden=false;document.querySelector('#music-eq-page').inert=false;
          f.shell.setActive(false);f.sharedPanel?.setVisible(false);
          await f.mountEq(restore.eqMode,restore.eqEngine,restore.eqExpanded);f.eqSettings=restore.eqSettings;
          const eq=document.querySelector('#eq-page-content');eq.scrollTop=restore.eqScroll;
          const strip=eq.querySelector('.eq-parametric-strip');if(strip)strip.scrollLeft=restore.eqStripScroll;
        }
        for(const key of Object.keys(restore.data)){const value=restore.data[key];if(value===undefined)delete s.dataset[key];else s.dataset[key]=value;}
        if(f.sharedPanel){
          if(!f.sharedPanel.active&&restore.panelActive)f.sharedPanel.setActive(true);
          if(f.sharedPanel.active){f.sharedPanel.setOpen(restore.panelOpen);f.sharedPanel.finish();f.sharedPanel.setVisible(!restore.panelHidden,restore.panelInert);}
          if(f.sharedPanel.active&&!restore.panelActive)f.sharedPanel.setActive(false);
        }
        f.shell.setActive(restore.shellActive);
        for(const state of restore.sections){const node=s.querySelector('#'+state.id);if(node){node.hidden=state.hidden;node.inert=state.inert;}}
        for(const button of s.querySelectorAll('.theme-switch [data-theme]')){
          const state=restore.themeButtons.find(item=>item.theme===button.dataset.theme);if(state)button.setAttribute('aria-pressed',state.pressed);
        }
        document.querySelector('#music-playback').hidden=restore.playbackHidden;
        f.updatePlayback(f.state);
        f.eqSettings=restore.eqSettings;
        if(restore.style===null)s.removeAttribute('style');else s.setAttribute('style',restore.style);
        if(restore.playbackVisible===undefined)delete s.dataset.playbackVisible;else s.dataset.playbackVisible=restore.playbackVisible;
        const scan=s.querySelector('.music-page-scan');if(scan)scan.hidden=restore.scanHidden;
      }
      delete f.futurePageScan;delete f.futureViewTransitions;delete f.futureStartViewTransitionDescriptor;delete f.futureStartViewTransitionNative;delete f.futurePunkAnimation;delete f.futureDesignRestore;
    })()`);
    if(mediaWasChanged)await command('Emulation.setEmulatedMedia',{features:saved.reduced?[{name:'prefers-reduced-motion',value:'reduce'}]:[]});
    await command('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:viewport.dpr,mobile:false});
  }
  await writeFile(path.join(output,'future-design.json'),JSON.stringify({sizes,viewport,transitions:report.viewTransitions,headerAndPlayback:report.headerAndPlayback,rightPane:report.rightPane,eq:report.eq,dial:report.dial,punkReveal:report.punkReveal,terminalLighting:report.terminalLighting},null,2));
}
