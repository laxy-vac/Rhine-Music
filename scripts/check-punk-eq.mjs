import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import ts from 'typescript';

export async function checkPunkEq({command,evaluate,output,project}) {
  const source=await readFile(path.join(project,'src/music-app.ts'),'utf8');
  const tree=ts.createSourceFile('music-app.ts',source,ts.ScriptTarget.Latest,true);
  const render=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='renderEqPage');
  let template;
  const walk=n=>{if(ts.isBinaryExpression(n)&&n.left.getText(tree)==='content.innerHTML')template=n.right.getText(tree);ts.forEachChild(n,walk);};walk(render);
  const preset=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='processingPresetMarkup').getText(tree);
  const bundle=await build({stdin:{contents:`export {syncPunkEqInstruments} from './src/punk-eq-instruments';export {archiveMusicStyle,applyStylePalette} from './src/music-style';export {renderEqControls,setupEqControls} from './src/eq-controls';export {normalizeProcessing} from './src/audio-processing-model.mjs';export {enhanceSettingsSelectControls} from './src/settings-select-controls';export {setupEditableRanges} from './src/editable-range-controls';export {containsCjk,escapeHtml} from './src/html';export {ui,trUi} from './src/i18n';`,resolveDir:project,loader:'ts'},bundle:true,write:false,format:'iife',define:{'import.meta.glob':'fixtureGlob'},banner:{js:'const fixtureGlob=()=>({});'},globalName:'EqFixture',logLevel:'silent'});
  await evaluate(bundle.outputFiles[0].text);
  await evaluate(`(()=>{const f=fixture;f.albumQueue.close(false);f.stage.dataset.page='eq';document.querySelector('#music-browse').hidden=true;f.sharedPanel.setVisible(false);const page=document.querySelector('#music-eq-page');page.hidden=false;page.inert=false;
    f.mountEq=async(mode,engine='standard',expanded=false)=>{if(f.eqControls)await f.eqControls.destroy();f.eqSelect?.destroy();f.eqRanges?.destroy();
      const processingSettings=EqFixture.normalizeProcessing(undefined);processingSettings.eq.mode=mode;processingSettings.eq.engine=engine;processingSettings.eq.enabled=true;
      if(mode==='parametric')processingSettings.eq.bands=processingSettings.eq.bands.slice(0,6).map((b,i)=>({...b,type:3,q:.707,gain:[-2,3,0,1,-1,2][i]}));
      f.eqSettings=processingSettings;const {renderEqControls,ui,trUi,escapeHtml:esc}=EqFixture,eqPresetsExpanded=expanded,processingApplyMessage='';
      const processingPresetStore={activeId:'current',presets:[]},processingUndoStack=[];
      ${preset}
      const content=document.querySelector('#eq-page-content');content.innerHTML=${template};content.querySelector('[data-processing-presets-slot]').innerHTML=processingPresetMarkup();
      const mark=()=>{if(f.stage.dataset.design==='archive')content.querySelectorAll('button,label > span,.settings-row > span,.eq-band-index,summary,figcaption,.eq-mode-description').forEach(n=>n.dataset.punkCjk=String(EqFixture.containsCjk(n.textContent)));};
      f.eqSelect=EqFixture.enhanceSettingsSelectControls(content);f.ranges.sync();mark();
      if(engine==='standard')f.eqControls=EqFixture.setupEqControls(content.querySelector('.eq-controls'),()=>f.eqSettings,value=>{f.eqSettings=value;});else f.eqControls=undefined;
      mark();EqFixture.syncPunkEqInstruments(content);content.scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    };
  })()`);
  const report=[];
  for(const [width,height] of [[1920,1080],[1280,800],[1024,700],[600,800]])for(const mode of ['parametric','graphic']) {
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.stage.dataset.design='archive';fixture.stage.dataset.layout='${width<=720?'portrait':width<=1100?'compact':'desktop'}';fixture.shell.setActive(true);fixture.mountEq('${mode}')`);
    const geometry=await evaluate(`(()=>{const content=document.querySelector('#eq-page-content'),head=document.querySelector('.eq-head-controls'),chart=document.querySelector('.eq-response-figure'),disclosure=document.querySelector('.eq-preset-disclosure'),dial=document.querySelector('.eq-parameter-dial'),control=document.querySelector('.eq-controls');const c=content.getBoundingClientRect(),h=head.getBoundingClientRect(),g=chart.getBoundingClientRect();return{content:c.toJSON(),head:h.toJSON(),chart:g.toJSON(),scrollWidth:content.scrollWidth,clientWidth:content.clientWidth,headOverflow:head.scrollWidth>head.clientWidth+1,radius:getComputedStyle(disclosure).borderRadius,labels:[...head.querySelectorAll('.settings-row > span')].filter(n=>n.getClientRects().length>0).map(n=>({text:n.textContent,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,whiteSpace:getComputedStyle(n).whiteSpace})),dial:dial?{radius:getComputedStyle(dial).borderRadius,shadow:getComputedStyle(dial).boxShadow,background:getComputedStyle(dial).backgroundImage}:null,columns:getComputedStyle(control).gridTemplateColumns};})()`);
    assert.equal(geometry.radius,'0px',`${width} ${mode}: Punk preset radius`);
    assert.ok(geometry.scrollWidth<=geometry.clientWidth+1,`${width} ${mode}: page horizontal overflow ${JSON.stringify(geometry)}`);
    assert.equal(geometry.headOverflow,false,`${width} ${mode}: head controls overflow ${JSON.stringify(geometry)}`);
    const toggle=await evaluate(`(()=>{const input=document.querySelector('[data-processing-field="eq.enabled"]'),s=getComputedStyle(input);return{height:input.getBoundingClientRect().height,shadow:s.boxShadow,checked:input.checked};})()`);
    assert.equal(toggle.height,20);assert.equal(toggle.checked,true);assert.notEqual(toggle.shadow,'none');
    assert.ok(geometry.labels.every(n=>n.whiteSpace==='nowrap'&&n.width>30),`${width} ${mode}: squeezed label ${JSON.stringify(geometry)}`);
    if(geometry.dial){assert.equal(geometry.dial.radius,'0px');assert.equal(geometry.dial.shadow,'none');assert.equal(geometry.dial.background,'none');}
    report.push({width,height,mode,geometry});
    if(width===1920||width===1024){const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`punk-eq-${mode}-${width}.png`),Buffer.from(shot.data,'base64'));}
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`fixture.mountEq('parametric','standard',true)`);
  const expanded=await evaluate(`getComputedStyle(document.querySelector('.processing-presets')).borderRadius`);assert.equal(expanded,'0px');
  const binding=await evaluate(`(()=>{const dial=document.querySelector('[data-eq-dial="frequency"]');dial.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));return fixture.eqSettings.eq.bands[0].frequency;})()`);assert.ok(binding>31,'Styled dial still updates local EQ state');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`fixture.stage.dataset.theme='night';fixture.mountEq('parametric');`);
  const nightShot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'punk-eq-night.png'),Buffer.from(nightShot.data,'base64'));
  await evaluate(`document.querySelector('#eq-page-content').scrollTop=10000;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const chartShot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'punk-eq-response-night.png'),Buffer.from(chartShot.data,'base64'));
  await evaluate(`fixture.stage.dataset.theme='day';`);
  const palettes=[];
  for(const scheme of ['archive','hazard','flare','field','front','hearth'])for(const theme of ['day','night']) {
    await evaluate(`fixture.stage.dataset.theme='${theme}';EqFixture.applyStylePalette(fixture.stage,{...EqFixture.archiveMusicStyle,scheme:'${scheme}'},'${theme}');fixture.mountEq('parametric')`);
    const colors=await evaluate(`(()=>{const field=document.querySelector('.eq-dial-number'),card=document.querySelector('.eq-band-card');const ctx=document.createElement('canvas').getContext('2d');const luminance=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);};const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};const f=getComputedStyle(field),c=getComputedStyle(card),chart=document.querySelector('.eq-response-figure');EqFixture.syncPunkEqInstruments(document.querySelector('#eq-page-content'));return{readout:ratio(f.color,f.backgroundColor),label:ratio(c.color,c.backgroundColor),dialScales:document.querySelectorAll('.punk-eq-dial-scale').length,gainScales:document.querySelectorAll('.punk-eq-gain-scale').length,chartPosition:getComputedStyle(chart).position};})()`);
    assert.ok(colors.readout>=4.5,`${scheme}/${theme} readout contrast ${colors.readout}`);assert.ok(colors.label>=4.5,`${scheme}/${theme} label contrast ${colors.label}`);
    assert.equal(colors.dialScales,12);assert.equal(colors.gainScales,6);assert.equal(colors.chartPosition,'static');
    palettes.push({scheme,theme,...colors});
    if(theme==='day'){const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`punk-eq-${scheme}.png`),Buffer.from(shot.data,'base64'));}
  }
  await evaluate(`fixture.stage.dataset.theme='day';EqFixture.applyStylePalette(fixture.stage,{...EqFixture.archiveMusicStyle,scheme:'rhine'},'day');`);
  await evaluate(`fixture.mountEq('parametric','lsp')`);assert.equal(await evaluate(`!!document.querySelector('[data-lsp-action="open-editor"]')`),true);
  await evaluate(`fixture.stage.dataset.design='rhine';fixture.shell.setActive(false);fixture.mountEq('parametric')`);
  const future=await evaluate(`(()=>{const preset=document.querySelector('.eq-preset-disclosure'),dial=document.querySelector('.eq-parameter-dial');return{preset:getComputedStyle(preset).borderRadius,dial:getComputedStyle(dial).borderRadius,background:getComputedStyle(dial).backgroundImage};})()`);
  assert.notEqual(future.preset,'0px');assert.notEqual(future.dial,'0px');assert.match(future.background,/radial-gradient/);
  await evaluate(`(async()=>{await fixture.eqControls?.destroy();fixture.eqControls=undefined;fixture.eqSelect?.destroy();fixture.eqRanges?.destroy();document.querySelector('#music-eq-page').hidden=true;fixture.stage.dataset.page='music';fixture.stage.dataset.design='archive';fixture.shell.setActive(true);document.querySelector('#music-browse').hidden=false;fixture.sharedPanel.setVisible(true);})()`);
  await writeFile(path.join(output,'punk-eq.json'),JSON.stringify({report,palettes,expanded,binding,future},null,2));
}
