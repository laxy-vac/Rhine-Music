import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';

function extractNavigationIcons(source) {
  const parsed = ts.createSourceFile('music-app.ts', source, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = ts.isIdentifier(declaration.name) ? declaration.name.text : '';
      if (name === 'svg' || name === 'icons') declarations.set(name, statement);
    }
  }
  assert.ok(declarations.has('svg') && declarations.has('icons'),
    'Could not extract the production svg helper and navigation icon constants.');
  const code = [declarations.get('svg').getText(parsed), declarations.get('icons').getText(parsed), 'icons;'].join('\n');
  return runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {}, { timeout: 1000 });
}

function terminalGlassScenario(report, theme) {
  const scenario = report.scenarios?.find(entry => entry.theme === theme && entry.preset === 'ultra' && entry.terminalLight === 'full');
  assert.ok(scenario, `Missing ${theme}/ultra terminal-glass scenario in profile report.`);
  assert.ok(scenario.screenshots?.lyricsMain, `Missing ${theme}/ultra lyrics-main screenshot in profile report.`);
  return scenario;
}

function lyricsMainClip(scenario, viewport) {
  const main = scenario.nodes?.find(node => node.selector === '.lyrics-main')?.rect;
  assert.ok(main, 'Missing .lyrics-main geometry in profile report.');
  const x = Math.max(0, Math.floor(main.x - 24));
  const y = Math.max(0, Math.floor(main.y - 24));
  return {
    rect: main,
    clip: {
      x,
      y,
      width: Math.max(1, Math.min(viewport.width - x, Math.ceil(main.right - x + 24))),
      height: Math.max(1, Math.min(viewport.height - y, Math.ceil(main.bottom - y + 24))),
    },
  };
}

async function compareTerminalGlassPixels({ command, evaluate, output, runProfile, runReport, requireBoth = false }) {
  const root = path.dirname(output);
  const profiles = {};
  const missingProfiles = [];
  for (const name of ['baseline', 'current']) {
    const directory = path.join(root, name);
    if (name === runProfile) {
      profiles[name] = { directory, report: runReport };
      continue;
    }
    try {
      const text = await readFile(path.join(directory, 'terminal-glass.json'), 'utf8');
      profiles[name] = { directory, report: JSON.parse(text) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missingProfiles.push(name);
    }
  }
  if (missingProfiles.length) {
    if (requireBoth) throw new Error(`Terminal-glass pixel comparison needs existing profile(s): ${missingProfiles.join(', ')}.`);
    return { status: 'pending', missingProfiles };
  }

  const distances = [1, 2, 4, 8, 12, 16, 20];
  const themes = [];
  for (const theme of ['day', 'night']) {
    const imageInputs = {};
    for (const name of ['baseline', 'current']) {
      const profile = profiles[name];
      const scenario = terminalGlassScenario(profile.report, theme);
      const geometry = lyricsMainClip(scenario, profile.report.viewport || { width: 1920, height: 1080 });
      const screenshotPath = path.join(profile.directory, scenario.screenshots.lyricsMain);
      const data = await readFile(screenshotPath);
      imageInputs[name] = {
        source: `data:image/png;base64,${data.toString('base64')}`,
        profile: name,
        screenshot: scenario.screenshots.lyricsMain,
        rect: geometry.rect,
        clip: geometry.clip,
      };
    }
    const payload = { theme, distances, imageInputs };
    const result = await evaluate(`(async()=>{
      const input=${JSON.stringify(payload)};
      const decode=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Canvas could not decode terminal-glass screenshot.'));image.src=src;});
      const decoded={};
      for(const name of ['baseline','current']){
        const item=input.imageInputs[name],image=await decode(item.source),canvas=document.createElement('canvas');
        canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('Canvas 2D context is unavailable for terminal-glass pixel comparison.');
        context.drawImage(image,0,0);
        decoded[name]={item,image,context,width:canvas.width,height:canvas.height};
      }
      const round=value=>Math.round(value*1000)/1000;
      const profile=(entry,distance)=>{
        const {item,context,width,height}=entry,rect=item.rect,clip=item.clip;
        const centerX=rect.x+rect.width/2;
        const leftScreen=centerX-100,rightScreen=centerX+100;
        const x0=Math.max(0,Math.floor(leftScreen-clip.x)),x1=Math.min(width,Math.ceil(rightScreen-clip.x));
        const yScreen=Math.ceil(rect.bottom)+distance-1;
        const y=yScreen-clip.y;
        if(x0>=x1||y<0||y>=height)throw new Error('Requested bottom-edge sample falls outside '+item.profile+' screenshot.');
        const rgba=context.getImageData(x0,y,x1-x0,1).data;
        const sum=[0,0,0];
        for(let index=0;index<rgba.length;index+=4){sum[0]+=rgba[index];sum[1]+=rgba[index+1];sum[2]+=rgba[index+2];}
        const count=rgba.length/4;
        return{distanceBelowBottomPx:distance,screenY:yScreen,centerSpanPx:count,rgb:sum.map(value=>round(value/count))};
      };
      const samples=input.distances.map(distance=>{
        const baseline=profile(decoded.baseline,distance),current=profile(decoded.current,distance);
        const deltaRgb=current.rgb.map((value,index)=>round(value-baseline.rgb[index]));
        const absolute=deltaRgb.map(Math.abs);
        return{
          distanceBelowBottomPx:distance,
          baseline:{rgb:baseline.rgb,pixelCount:baseline.centerSpanPx,screenY:baseline.screenY},
          current:{rgb:current.rgb,pixelCount:current.centerSpanPx,screenY:current.screenY},
          difference:{deltaRgb,absoluteDeltaRgb:absolute,meanAbsoluteChannelDelta:round(absolute.reduce((sum,value)=>sum+value,0)/3),euclideanDelta:round(Math.hypot(...deltaRgb))},
        };
      });
      return{
        theme:input.theme,
        sampleRegion:'200 CSS px centered below .lyrics-main bottom edge',
        images:Object.fromEntries(['baseline','current'].map(name=>{const entry=decoded[name];return[name,{file:entry.item.screenshot,width:entry.width,height:entry.height,rect:entry.item.rect,clip:entry.item.clip}];})),
        samples,
      };
    })()`);
    themes.push(result);
  }
  return {
    status: 'complete',
    method: 'Browser Canvas PNG decode; average RGB across a 200 CSS px centered strip at each pixel distance below the .lyrics-main bottom edge.',
    profiles: Object.fromEntries(['baseline', 'current'].map(name => [name, path.basename(profiles[name].directory)])),
    distancesBelowBottomPx: distances,
    themes,
  };
}

export async function checkTerminalGlassProbe({ command, evaluate, output, project }) {
  const verifyFix = path.basename(output) !== 'baseline';
  await mkdir(output, { recursive: true });
  const compareOnly = process.argv.includes('--compare-existing');
  const existingReport = compareOnly
    ? JSON.parse(await readFile(path.join(output, 'terminal-glass.json'), 'utf8'))
    : undefined;
  const computedCssSamples = [];
  const musicApp = await readFile(path.join(project, 'src/music-app.ts'), 'utf8');
  const icons = extractNavigationIcons(musicApp);
  const bundle = await build({
    stdin: {
      contents: "export {setupLyricsPage} from './src/lyrics-page';export {setupTerminalLighting} from './src/terminal-lighting';export {defaultMusicStyle,applyStylePalette} from './src/music-style';export {qualityPresets} from './src/render-quality';",
      resolveDir: project,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'crypto.randomUUID': 'terminalGlassUUID' },
    banner: { js: 'const terminalGlassUUID=()=>"00000000-0000-4000-8000-000000000002";' },
    globalName: 'TerminalGlassFixture',
    logLevel: 'silent',
  });
  await evaluate(bundle.outputFiles[0].text);
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });

  let runError;
  const records = [];
  try {
    const standby = await evaluate(`(async()=>{
      const f=fixture,s=f.stage;
      f.terminalGlassOriginalFetch=window.fetch;
      f.terminalGlassRequests=[];
      f.terminalGlassUnexpected=[];
      f.terminalGlassRestore={
        dataAttributes:[...s.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]),
        style:s.getAttribute('style'),
        injectedIcons:[],
        pages:['#music-browse','#music-detail','#music-settings','#music-eq-page','#music-lyrics-page','#music-signal-page','#music-theme-page'].map(selector=>{
          const node=s.querySelector(selector);return node?{node,hidden:node.hidden,inert:node.inert}:null;
        }).filter(Boolean),
        pressed:[...s.querySelectorAll('.music-topnav [aria-pressed],.theme-switch [aria-pressed]')].map(node=>({node,value:node.getAttribute('aria-pressed')})),
      };
      window.fetch=async(url,options={})=>{
        const route=new URL(String(url),'http://terminal-glass.fixture').pathname;
        f.terminalGlassRequests.push({route,method:options.method||'GET'});
        let payload;
        if(route==='/api/lyrics/settings')payload={settings:{defaultSourceId:'',cacheDirectory:'',defaultCacheDirectory:''},sources:[]};
        else if(route==='/api/lyrics/preferences')payload={trackId:new URL(String(url),'http://terminal-glass.fixture').searchParams.get('trackId')||'',sourceId:null,effectiveSourceId:'',defaultSourceId:'',sources:[]};
        else if(route==='/api/lyrics/track')payload={lyric:null};
        else {const message='Unexpected offline lyrics fixture request: '+route;f.terminalGlassUnexpected.push(message);throw new Error(message);}
        return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
      };
      f.sharedPanel?.setActive(false);
      f.shell.setActive(false);
      for(const selector of ['#music-browse','#music-detail','#music-settings','#music-eq-page','#music-signal-page','#music-theme-page']){
        const node=s.querySelector(selector);if(node){node.hidden=true;node.inert=true;}
      }
      const page=s.querySelector('#music-lyrics-page');
      if(!page)throw new Error('Terminal glass fixture is missing #music-lyrics-page.');
      page.hidden=false;page.inert=false;
      s.dataset.design='rhine';s.dataset.page='lyrics';s.dataset.layout='desktop';
      s.dataset.theme='day';
      TerminalGlassFixture.applyStylePalette(s,{...TerminalGlassFixture.defaultMusicStyle,design:'rhine'},'day');
      for(const action of ['library','eq','lyrics','signal','theme','settings']){
        const button=s.querySelector('.music-topnav [data-action="'+action+'"]');
        if(button)button.setAttribute('aria-pressed',String(action==='lyrics'));
      }
      for(const button of s.querySelectorAll('.theme-switch [data-theme]'))button.setAttribute('aria-pressed',String(button.dataset.theme==='day'));
      const iconByAction={library:'folder',eq:'eq',lyrics:'lyrics',search:'search',online:'globe',settings:'settings',stop:'stop'};
      for(const [action,name] of Object.entries(iconByAction)){
        const button=s.querySelector('.music-topnav [data-action="'+action+'"]');
        if(button&&!button.querySelector('svg')){button.insertAdjacentHTML('afterbegin',${JSON.stringify(icons)}[name]);f.terminalGlassRestore.injectedIcons.push(button.querySelector('svg'));}
      }
      const transport=s.querySelector('#play-pause');
      if(transport){
        const play=transport.querySelector('.transport-play'),pause=transport.querySelector('.transport-pause');
        if(play&&!play.querySelector('svg')){play.innerHTML=${JSON.stringify(icons.play)};f.terminalGlassRestore.injectedIcons.push(play.querySelector('svg'));}
        if(pause&&!pause.querySelector('svg')){pause.innerHTML=${JSON.stringify(icons.pause)};f.terminalGlassRestore.injectedIcons.push(pause.querySelector('svg'));}
      }
      f.terminalGlassController=TerminalGlassFixture.setupLyricsPage(s.querySelector('#lyrics-page-content'),{
        seek:()=>{},spectrum:()=>undefined,notify:()=>{},openSettings:()=>{},
      });
      f.terminalGlassLighting=TerminalGlassFixture.setupTerminalLighting(s);
      const standbyState={...structuredClone(f.state),transport:'idle',currentTrack:null,queue:[],currentIndex:-1,playing:false,loading:false,duration:0,currentTime:0,error:null};
      f.terminalGlassController.update(standbyState);
      f.terminalGlassController.setVisible(true);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return {
        currentTrackPresent:standbyState.currentTrack!==null,
        queueLength:standbyState.queue.length,
        notice:document.querySelector('.lyrics-notice-title')?.textContent?.trim()||'',
        routeRequests:f.terminalGlassRequests.map(request=>request.route),
      };
    })()`);
    assert.equal(standby.currentTrackPresent, false, 'The terminal glass baseline must begin with no current track.');
    assert.equal(standby.queueLength, 0, 'The terminal glass baseline must begin with an empty queue.');

    const invariants = new Map();
    const scenarios = compareOnly ? [
      { theme: 'day', preset: 'ultra', terminalLight: 'full' },
      { theme: 'night', preset: 'ultra', terminalLight: 'full' },
    ] : [
      { theme: 'day', preset: 'performance', terminalLight: 'off' },
      { theme: 'day', preset: 'original', terminalLight: 'local' },
      { theme: 'day', preset: 'high', terminalLight: 'full' },
      { theme: 'day', preset: 'ultra', terminalLight: 'full' },
      { theme: 'night', preset: 'performance', terminalLight: 'off' },
      { theme: 'night', preset: 'original', terminalLight: 'local' },
      { theme: 'night', preset: 'high', terminalLight: 'full' },
      { theme: 'night', preset: 'ultra', terminalLight: 'full' },
    ];
    for (const scenario of scenarios) {
      const { theme, preset, terminalLight } = scenario;
      await evaluate(`(()=>{
        const f=fixture,s=f.stage;
        s.dataset.design='rhine';s.dataset.page='lyrics';s.dataset.layout='desktop';s.dataset.theme=${JSON.stringify(theme)};
        TerminalGlassFixture.applyStylePalette(s,{...TerminalGlassFixture.defaultMusicStyle,design:'rhine'},${JSON.stringify(theme)});
        for(const action of ['library','eq','lyrics','signal','theme','settings']){
          const button=s.querySelector('.music-topnav [data-action="'+action+'"]');
          if(button)button.setAttribute('aria-pressed',String(action==='lyrics'));
        }
        for(const button of s.querySelectorAll('.theme-switch [data-theme]'))button.setAttribute('aria-pressed',String(button.dataset.theme===${JSON.stringify(theme)}));
        f.terminalGlassLighting.setQuality(TerminalGlassFixture.qualityPresets[${JSON.stringify(preset)}]);
        f.terminalGlassLighting.refresh();
        return new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),280));
      })()`);

      const sample = await evaluate(`(()=>{
        const required=selector=>{const node=document.querySelector(selector);if(!node)throw new Error('Terminal glass fixture is missing '+selector+'.');return node;};
        const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const styles=(node)=>{const s=getComputedStyle(node);return{
          background:s.background,backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage,
          boxShadow:s.boxShadow,filter:s.filter,outline:s.outline,outlineOffset:s.outlineOffset,
          border:s.border,borderColor:s.borderColor,borderRadius:s.borderRadius,
          backdropFilter:s.backdropFilter,overflow:s.overflow,overflowX:s.overflowX,overflowY:s.overflowY,
          contain:s.contain,clipPath:s.clipPath,viewTransitionName:s.viewTransitionName,
        };};
        const describe=(selector)=>{const node=required(selector);return{selector,rect:rect(node),...styles(node),receiver:node.hasAttribute('data-terminal-receiver'),level:node.style.getPropertyValue('--terminal-light-level')||null};};
        const root=required('#stage'),nav=required('.music-topnav'),main=required('.lyrics-main');
        const nodes=['#music-lyrics-page','#lyrics-page-content','.lyrics-workspace','.lyrics-main','.lyrics-scroller','.theme-switch'].map(describe);
        const navButtons=[...nav.querySelectorAll('button')].map(node=>({
          action:node.dataset.action||null,theme:node.dataset.theme||null,label:(node.innerText||node.textContent||'').trim(),
          ariaPressed:node.getAttribute('aria-pressed'),directNav:node.parentElement===nav,rect:rect(node),...styles(node),
          receiver:node.hasAttribute('data-terminal-receiver'),level:node.style.getPropertyValue('--terminal-light-level')||null,
        }));
        const receivers=[...root.querySelectorAll('[data-terminal-receiver]')].map(node=>({
          id:node.id||null,action:node.dataset.action||null,theme:node.dataset.theme||null,
          className:typeof node.className==='string'?node.className:'',ariaLabel:node.getAttribute('aria-label'),
          level:node.style.getPropertyValue('--terminal-light-level')||null,
        }));
        const activeTheme=root.querySelector('.theme-switch [aria-pressed="true"]')?.dataset.theme||null;
        const activePage=root.querySelector('.music-topnav [data-action="lyrics"][aria-pressed="true"]')?.dataset.action||null;
        const signature={
          rects:['.music-topnav','#music-lyrics-page','#lyrics-page-content','.lyrics-workspace','.lyrics-main'].map(selector=>rect(required(selector))),
          navText:[...nav.querySelectorAll('button')].map(node=>(node.innerText||node.textContent||'').trim()),
          pageText:required('#music-lyrics-page').innerText.trim(),
          noticeText:[...required('.lyrics-notice').querySelectorAll('.lyrics-notice-rail-label,.lyrics-notice-code,.lyrics-notice-eyebrow,.lyrics-notice-title,.lyrics-notice-text,.lyrics-notice-foot-value')].map(node=>node.textContent.trim()),
        };
        return{
          state:{design:root.dataset.design,page:root.dataset.page,theme:root.dataset.theme,activePage,activeTheme,terminalLighting:root.getAttribute('data-terminal-lighting')},
          nav:{rect:rect(nav),...styles(nav),buttons:navButtons,shadowRoom:Number.parseFloat(getComputedStyle(nav).paddingBottom)},
          nodes,
          lyricsMain:{receiver:main.hasAttribute('data-terminal-receiver'),level:main.style.getPropertyValue('--terminal-light-level')||null},
          receivers:{count:receivers.length,items:receivers},
          text:{nav:signature.navText,notice:signature.noticeText},
          invariantSignature:signature,
        };
      })()`);
      assert.equal(sample.state.terminalLighting, terminalLight,
        `${theme}/${preset}: terminal lighting did not reach the preset mode ${terminalLight}.`);
      assert.equal(sample.state.activePage, 'lyrics', `${theme}/${preset}: lyrics navigation state must be selected.`);
      assert.equal(sample.state.activeTheme, theme, `${theme}/${preset}: theme button state must match the page theme.`);
      if (verifyFix) {
        const transparentLabels=sample.nav.buttons.filter(button=>button.directNav&&button.ariaPressed!=='true');
        assert.ok(transparentLabels.every(button=>!button.receiver&&button.boxShadow==='none'),
          `${theme}/${preset}: inactive text navigation must not acquire solid button shadows.`);
        assert.ok(sample.nav.buttons.filter(button=>button.theme).every(button=>!button.receiver),
          'Theme labels must share the glass carrier rather than each casting a second pill.');
        assert.ok(sample.nav.shadowRoom>=20,'The scrollable header must retain space for the soft light.');
        assert.equal(sample.nodes.find(node=>node.selector==='#lyrics-page-content').overflow,'visible');
        assert.equal(sample.nodes.find(node=>node.selector==='.lyrics-main').overflow,'hidden');
        assert.equal(sample.nodes.find(node=>node.selector==='.lyrics-scroller').overflow,'auto');
        if(terminalLight!=='off') {
          assert.equal(sample.nodes.find(node=>node.selector==='.theme-switch').receiver,true);
          assert.equal(sample.nav.buttons.find(button=>button.action==='lyrics').receiver,true);
        }
      }

      const invariantKey = theme;
      if (!invariants.has(invariantKey)) invariants.set(invariantKey, sample.invariantSignature);
      else assert.deepEqual(sample.invariantSignature, invariants.get(invariantKey),
        `${theme}/${preset}: terminal-light mode changed layout geometry or visible text.`);
      delete sample.invariantSignature;
      if (compareOnly) {
        computedCssSamples.push({ theme, preset, terminalLight, state: sample.state, nav: sample.nav, nodes: sample.nodes, lyricsMain: sample.lyricsMain });
        continue;
      }
      records.push({ ...scenario, ...sample, geometryTextInvariant: true });

      const prefix = `future-${theme}-${terminalLight}-${preset}`;
      const navRect = sample.nav.rect;
      const mainNode = sample.nodes.find(node => node.selector === '.lyrics-main');
      const captureAround = async (rect, suffix) => {
        const x = Math.max(0, Math.floor(rect.x - 24));
        const y = Math.max(0, Math.floor(rect.y - 24));
        const width = Math.max(1, Math.min(1920 - x, Math.ceil(rect.right - x + 24)));
        const height = Math.max(1, Math.min(1080 - y, Math.ceil(rect.bottom - y + 24)));
        const shot = await command('Page.captureScreenshot', { format: 'png', clip: { x, y, width, height, scale: 1 } });
        const name = `${prefix}-${suffix}.png`;
        await writeFile(path.join(output, name), Buffer.from(shot.data, 'base64'));
        return name;
      };
      records.at(-1).screenshots = {
        topnav: await captureAround(navRect, 'topnav'),
        lyricsMain: await captureAround(mainNode.rect, 'lyrics-main'),
        page: `${prefix}-page.png`,
      };
      const pageShot = await command('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      });
      await writeFile(path.join(output, records.at(-1).screenshots.page), Buffer.from(pageShot.data, 'base64'));
    }

    let narrowScrolling;
    if(verifyFix&&!compareOnly) {
      await command('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});
      narrowScrolling=await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
        const content=document.querySelector('#lyrics-page-content');resolve({overflow:getComputedStyle(content).overflow,client:content.clientHeight,total:content.scrollHeight});
      })))`);
      assert.equal(narrowScrolling.overflow,'auto','The stacked narrow lyrics view retains its scrolling carrier.');
      assert.ok(narrowScrolling.total>narrowScrolling.client,'The stacked side columns remain reachable by scrolling.');
      await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
    }
    const requestCheck = await evaluate(`({unexpected:fixture.terminalGlassUnexpected,requests:fixture.terminalGlassRequests.map(request=>request.route)})`);
    assert.deepEqual(requestCheck.unexpected, [], 'The offline lyrics fixture received an unexpected request.');
    const report = compareOnly ? existingReport : {
        viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
        design: 'rhine',
        dpr: 1,
        standby,
        requests: requestCheck.requests,
        scenarios: records,
      };
    if (compareOnly) report.pixelComparisonComputedCssSamples = computedCssSamples;
    if(narrowScrolling)report.narrowScrolling=narrowScrolling;
    report.pixelComparison = await compareTerminalGlassPixels({
      command,evaluate,output,runProfile:path.basename(output),runReport:report,requireBoth:compareOnly,
    });
    await writeFile(path.join(output, 'terminal-glass.json'), JSON.stringify(report, null, 2));
    console.log(compareOnly
      ? `Compared existing baseline/current terminal-glass PNGs without recapturing screenshots; updated ${path.join(output,'terminal-glass.json')}.`
      : `Saved ${records.length} offline Future terminal-glass scenarios to ${output}.`);
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    try {
      await evaluate(`(()=>{
        const f=fixture,s=f.stage,restore=f.terminalGlassRestore;
        f.terminalGlassLighting?.destroy();
        f.terminalGlassController?.destroy();
        if(f.terminalGlassOriginalFetch)window.fetch=f.terminalGlassOriginalFetch;
        f.sharedPanel?.setActive(true);
        f.shell.setActive(true);
        if(restore){
          for(const node of restore.injectedIcons)node?.remove();
          for(const name of [...s.getAttributeNames()].filter(name=>name.startsWith('data-')))s.removeAttribute(name);
          for(const [name,value] of restore.dataAttributes)s.setAttribute(name,value);
          if(restore.style===null)s.removeAttribute('style');else s.setAttribute('style',restore.style);
          for(const page of restore.pages){page.node.hidden=page.hidden;page.node.inert=page.inert;}
          for(const entry of restore.pressed){if(entry.value===null)entry.node.removeAttribute('aria-pressed');else entry.node.setAttribute('aria-pressed',entry.value);}
        }
        delete f.terminalGlassLighting;delete f.terminalGlassController;delete f.terminalGlassOriginalFetch;
        delete f.terminalGlassRequests;delete f.terminalGlassUnexpected;delete f.terminalGlassRestore;
        return true;
      })()`);
    } catch (cleanupError) {
      if (!runError) throw new Error(`Terminal glass fixture cleanup failed: ${cleanupError.message}`, { cause: cleanupError });
      console.error(`Terminal glass fixture cleanup also failed: ${cleanupError.message}`);
    }
  }
}
