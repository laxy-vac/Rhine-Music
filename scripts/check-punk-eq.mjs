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
  const productionFunction=name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  const mountProcessingPresets=productionFunction('mountProcessingPresets');
  const openEqPage=productionFunction('openEqPage');
  const settingsRender=productionFunction('renderSettingsPage');
  const cloneProcessing=productionFunction('cloneProcessing');
  const setProcessingSettings=productionFunction('setProcessingSettings');
  const updateProcessingField=productionFunction('updateProcessingField');
  let toneNavigate;
  let processingInput,processingChange;
  const findProductionHandlers=node=>{
    if(ts.isCallExpression(node)&&node.expression.getText(tree)==='setupAudioInfoPopup'&&ts.isObjectLiteralExpression(node.arguments[1])){
      const property=node.arguments[1].properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(tree)==='navigate');
      if(property&&ts.isFunctionExpression(property.initializer))toneNavigate=property.initializer;
    }
    if(ts.isCallExpression(node)&&node.expression.getText(tree)==='document.addEventListener'&&ts.isStringLiteral(node.arguments[0])){
      const callback=node.arguments[1],body=callback?.getText(tree)||'';
      if(ts.isArrowFunction(callback)||ts.isFunctionExpression(callback)){
        if(node.arguments[0].text==='input'&&body.includes('updateProcessingField(el)'))processingInput=callback;
        if(node.arguments[0].text==='change'&&body.includes('control.dataset.processingField'))processingChange=callback;
      }
    }
    ts.forEachChild(node,findProductionHandlers);
  };
  findProductionHandlers(tree);
  for(const [name,node] of Object.entries({mountProcessingPresets,openEqPage,cloneProcessing,setProcessingSettings,updateProcessingField,toneNavigate,processingInput,processingChange}))assert.ok(node,`Could not extract production ${name} for the focused EQ fixture.`);
  const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const processingHarness=transpile(`${cloneProcessing.getText(tree)}\n${setProcessingSettings.getText(tree)}\n${updateProcessingField.getText(tree)}\nconst productionProcessingInput=${processingInput.getText(tree)};\nconst productionProcessingChange=${processingChange.getText(tree)};\ndocument.addEventListener("input", productionProcessingInput);\ndocument.addEventListener("change", productionProcessingChange);\nf.cleanupEqProcessingHarness=()=>{document.removeEventListener("input",productionProcessingInput);document.removeEventListener("change",productionProcessingChange);if(processingApplyTimer)clearTimeout(processingApplyTimer);};`);
  const productionEqRoute=transpile(`${openEqPage.getText(tree)}\nconst productionToneNavigate=${toneNavigate.getText(tree)};`);
  const variableStatement=name=>tree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)===name));
  const settingsSections=variableStatement('audioSettingsSections');
  const settingsCategories=variableStatement('settingsCategories');
  const settingsNavigation=productionFunction('settingsNavigationMarkup');
  for(const [name,node] of Object.entries({settingsRender,settingsSections,settingsCategories,settingsNavigation}))assert.ok(node,`Could not extract production ${name} for the focused EQ fixture.`);
  assert.doesNotMatch(settingsSections.getText(tree),/id\s*:\s*["'](?:eq|tone)["']|#audio-settings-(?:eq|tone)/i,'Settings still declares an EQ or Tone audio subsection.');
  assert.doesNotMatch(settingsRender.getText(tree),/#audio-settings-(?:eq|tone)|data-processing-field=["'](?:eq|tone)\.|processingPresetMarkup|mountProcessingPresets/i,'Settings renderer still mounts EQ/Tone controls or presets.');
  const settingsMarkupHarness=transpile(`${settingsCategories.getText(tree)}\n${settingsSections.getText(tree)}\n${settingsNavigation.getText(tree)}`);
  const bundle=await build({stdin:{contents:`export {syncPunkEqInstruments} from './src/punk-eq-instruments';export {archiveMusicStyle,applyStylePalette} from './src/music-style';export {renderEqControls,renderToneControls,setupEqControls} from './src/eq-controls';export {normalizeProcessing} from './src/audio-processing-model.mjs';export {enhanceSettingsSelectControls} from './src/settings-select-controls';export {setupEditableRanges} from './src/editable-range-controls';export {containsCjk,escapeHtml} from './src/html';export {ui,trUi} from './src/i18n';`,resolveDir:project,loader:'ts'},bundle:true,write:false,format:'iife',define:{'import.meta.glob':'fixtureGlob'},banner:{js:'const fixtureGlob=()=>({});'},globalName:'EqFixture',logLevel:'silent'});
  await evaluate(bundle.outputFiles[0].text);
  await evaluate(`(()=>{const f=fixture;let processingPresetElement;f.albumQueue.close(false);f.previousEqAudioNavigate=f.audioInfoCallbacks.navigate;f.previousEqLayout=f.stage.dataset.layout;f.previousEqPlaybackVisible=f.stage.dataset.playbackVisible;f.stage.dataset.playbackVisible='true';f.stage.dataset.page='eq';document.querySelector('#music-browse').hidden=true;f.sharedPanel.setVisible(false);const page=document.querySelector('#music-eq-page');page.hidden=false;page.inert=false;
    f.mountEq=async(mode,engine='standard',expanded=false,initialProcessing=undefined)=>{if(f.eqControls)await f.eqControls.destroy();f.eqSelect?.destroy();f.eqRanges?.destroy();
      const processingSettings=EqFixture.normalizeProcessing(initialProcessing);processingSettings.eq.mode=mode;processingSettings.eq.engine=engine;if(initialProcessing===undefined)processingSettings.eq.enabled=true;
      if(mode==='parametric')processingSettings.eq.bands=processingSettings.eq.bands.slice(0,6).map((b,i)=>({...b,type:3,q:.707,gain:[-2,3,0,1,-1,2][i]}));
      f.eqSettings=processingSettings;const {renderEqControls,renderToneControls,ui,trUi,escapeHtml:esc}=EqFixture,eqPresetsExpanded=expanded,processingApplyMessage='';
      const processingPresetStore={activeId:'current',presets:[]},processingUndoStack=[];
      ${preset}
      ${transpile(mountProcessingPresets.getText(tree))}
      const content=document.querySelector('#eq-page-content');content.innerHTML=${template};mountProcessingPresets(content);
      const mark=()=>{if(f.stage.dataset.design==='archive')content.querySelectorAll('button,label > span,.settings-row > span,.eq-band-index,summary,figcaption,.eq-mode-description,#tone-settings h3,#tone-settings h4,#tone-settings p').forEach(n=>n.dataset.punkCjk=String(EqFixture.containsCjk(n.textContent)));};
      f.eqSelect=EqFixture.enhanceSettingsSelectControls(content);f.ranges.sync();mark();
      if(engine==='standard')f.eqControls=EqFixture.setupEqControls(content.querySelector('.eq-controls'),()=>f.eqSettings,value=>{f.eqSettings=value;});else f.eqControls=undefined;
      mark();EqFixture.syncPunkEqInstruments(content);content.scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    };
  })()`);
  await evaluate(`(()=>{const f=fixture;let processingSettings=EqFixture.normalizeProcessing(undefined),processingEditStart,lastProcessingError='',processingApplyTimer,processingApplyRevision=0,processingApplyPending=false;const normalizeProcessing=EqFixture.normalizeProcessing,preferences={output:{backend:'browser',processing:processingSettings}},player={},eqControls=undefined,editableRanges=undefined,trUi=value=>value,ui=(strings,...values)=>strings.reduce((text,part,index)=>text+part+(values[index]??''),''),processingUndoSnapshot=()=>JSON.stringify(processingSettings),finishProcessingEdit=()=>{processingEditStart=undefined;},updateOutputUI=()=>{},updateProcessingSupportStatus=()=>{},setProcessingApplyStatus=()=>{},showProcessingPresetStatus=()=>{};f.productionSaveCount=0;const savePrefs=()=>{f.productionProcessing=cloneProcessing(processingSettings);f.productionPersisted=cloneProcessing(processingSettings);f.productionSaveCount++;};${processingHarness} f.productionRead=()=>cloneProcessing(processingSettings);f.productionSetField=(path,value)=>{const control=document.querySelector('[data-processing-field="'+path+'"]');if(!control||control.disabled)throw new Error('Missing or disabled production Tone field '+path);if(control instanceof HTMLInputElement&&control.type==='checkbox')control.checked=Boolean(value);else control.value=String(value);control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));return cloneProcessing(processingSettings);};f.productionProcessing=cloneProcessing(processingSettings);})()`);
  const settingsNavAudit=await evaluate(`(()=>{const trUi=EqFixture.trUi,ui=(strings,...values)=>strings.reduce((text,part,index)=>text+part+(values[index]??''), '');${settingsMarkupHarness}const nav=document.createElement('nav');nav.innerHTML=settingsNavigationMarkup();return{toneOrEqTargets:nav.querySelectorAll('[data-audio-settings-target="eq"],[data-audio-settings-target="tone"]').length,eqTarget:nav.querySelectorAll('[data-audio-settings-target="eq"]').length,toneTarget:nav.querySelectorAll('[data-audio-settings-target="tone"]').length};})()`);
  assert.deepEqual(settingsNavAudit,{toneOrEqTargets:0,eqTarget:0,toneTarget:0},'Rendered Settings navigation still links to EQ or Tone controls.');
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
  const toneAudit=await evaluate(`(()=>{const section=document.querySelectorAll('#music-eq-page #tone-settings'),toggle=document.querySelectorAll('#tone-settings [data-processing-field="tone.enabled"]'),field=key=>document.querySelectorAll('#tone-settings [data-processing-field="tone.'+key+'"]');return{sections:section.length,toggles:toggle.length,toggleChecked:toggle[0]?.checked??null,bassFrequency:field('bass.frequency')[0]?.value??null,bassQ:field('bass.q')[0]?.value??null,bassGain:field('bass.gain')[0]?.value??null,trebleFrequency:field('treble.frequency')[0]?.value??null,trebleQ:field('treble.q')[0]?.value??null,trebleGain:field('treble.gain')[0]?.value??null};})()`);
  assert.equal(toneAudit.sections,1,'EQ page must contain one independent tone section');
  assert.equal(await evaluate(`document.querySelectorAll('#processing-presets').length`),1,'The production preset mount must keep one preset group across EQ renders.');
  assert.equal(toneAudit.toggles,1,'EQ page must contain one tone switch independent of EQ');
  assert.equal(toneAudit.toggleChecked,false,'Tone switch must retain its default off state');
  assert.deepEqual([toneAudit.bassFrequency,toneAudit.bassQ,toneAudit.bassGain,toneAudit.trebleFrequency,toneAudit.trebleQ,toneAudit.trebleGain],['80','0.707','0','8000','0.707','0']);
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await evaluate(`fixture.stage.dataset.layout='desktop'`);
  await evaluate(`document.querySelector('#tone-settings').scrollIntoView({block:'center',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const toneViewportAudit=await evaluate(`(()=>{const tone=document.querySelector('#tone-settings').getBoundingClientRect(),content=document.querySelector('#eq-page-content').getBoundingClientRect(),playback=document.querySelector('#music-playback').getBoundingClientRect();return{toneTop:tone.top,toneBottom:tone.bottom,contentTop:content.top,contentBottom:content.bottom,playbackTop:playback.top};})()`);
  assert.ok(toneViewportAudit.toneTop>=toneViewportAudit.contentTop-1&&toneViewportAudit.toneBottom<=toneViewportAudit.contentBottom+1&&toneViewportAudit.contentBottom<toneViewportAudit.playbackTop,'Tone controls must be fully visible above the playback bar.');
  const toneShot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'punk-eq-tone.png'),Buffer.from(toneShot.data,'base64'));
  await evaluate(`fixture.mountEq('graphic','standard',false,fixture.productionRead())`);
  const defaultProcessing=await evaluate(`fixture.productionRead()`);
  const toneOnAtZero=await evaluate(`fixture.productionSetField('tone.enabled',true)`);
  assert.equal(toneOnAtZero.tone.enabled,true);
  assert.deepEqual(toneOnAtZero.eq,defaultProcessing.eq,'Enabling zero-gain Tone changed EQ state.');
  assert.deepEqual([toneOnAtZero.tone.bass.gain,toneOnAtZero.tone.treble.gain],[0,0]);
  const toneOffAtZero=await evaluate(`fixture.productionSetField('tone.enabled',false)`);
  assert.deepEqual(toneOffAtZero.eq,defaultProcessing.eq,'Disabling Tone changed EQ state.');
  assert.deepEqual([toneOffAtZero.tone.bass.gain,toneOffAtZero.tone.treble.gain],[0,0]);
  await evaluate(`fixture.productionSetField('tone.enabled',true);fixture.productionSetField('tone.bass.frequency',95);fixture.productionSetField('tone.bass.q',0.9);fixture.productionSetField('tone.bass.gain',3.5);fixture.productionSetField('tone.treble.frequency',9200);fixture.productionSetField('tone.treble.q',0.75);fixture.productionSetField('tone.treble.gain',-1.5);`);
  const toneWhileEnabled=await evaluate(`fixture.productionRead()`);
  assert.deepEqual(toneWhileEnabled.eq,defaultProcessing.eq,'Changing Tone fields changed EQ state.');
  const toneDisabledWithValues=await evaluate(`fixture.productionSetField('tone.enabled',false)`);
  assert.deepEqual(toneDisabledWithValues.tone,{enabled:false,bass:{frequency:95,q:0.9,gain:3.5},treble:{frequency:9200,q:0.75,gain:-1.5}},'Disabling Tone cleared or changed saved values.');
  assert.deepEqual(toneDisabledWithValues.eq,defaultProcessing.eq,'Disabling Tone changed EQ state.');
  const toneEventAudit=await evaluate(`(async()=>{await fixture.mountEq('graphic','standard',false,fixture.productionRead());const field=path=>document.querySelector('#tone-settings [data-processing-field="'+path+'"]');return{toggle:field('tone.enabled').checked,bass:[field('tone.bass.frequency').value,field('tone.bass.q').value,field('tone.bass.gain').value],treble:[field('tone.treble.frequency').value,field('tone.treble.q').value,field('tone.treble.gain').value],eqEnabled:document.querySelector('#music-eq-page [data-processing-field="eq.enabled"]').checked,saved:fixture.productionPersisted.tone};})()`);
  assert.deepEqual(toneEventAudit,{toggle:false,bass:['95','0.9','3.5'],treble:['9200','0.75','-1.5'],eqEnabled:false,saved:toneDisabledWithValues.tone},'Production change/input events did not preserve disabled Tone values through re-render.');
  await evaluate(`fixture.productionSetField('tone.enabled',true);fixture.mountEq('graphic','standard',false,fixture.productionRead())`);
  const toneOnlyStages=[
    {id:'tone.bass',name:'Bass tone',active:true,inputPrecision:'float64',computePrecision:'float64',outputPrecision:'float64',frequencyHz:95,q:0.9,gainDb:3.5},
    {id:'tone.treble',name:'Treble tone',active:true,inputPrecision:'float64',computePrecision:'float64',outputPrecision:'float64',frequencyHz:9200,q:0.75,gainDb:-1.5},
  ];
  await evaluate(`(()=>{const f=fixture;f.stage.dataset.page='settings';document.querySelector('#music-settings').hidden=false;document.querySelector('#music-eq-page').hidden=true;document.querySelector('#music-eq-page').inert=true;const trigger=document.createElement('button');trigger.type='button';trigger.id='eq-check-audio-info-trigger';f.stage.append(trigger);f.audioInfoPopup.update({...f.state,transport:'playing',nativeOutputStatus:{mode:'pcm',backend:'wasapi',sourceSampleRate:48000,sampleRate:48000,dspSampleRate:48000,bitsPerSample:24,validBitsPerSample:24,channels:2,processingStages:${JSON.stringify(toneOnlyStages)},capabilities:{processing:true,bitPerfectActive:false}},outputSettings:{...f.state.outputSettings,processing:f.productionRead()}});f.audioInfoPopup.toggle(trigger);})()`);
  const toneChainButton=await evaluate(`document.querySelector('#music-audio-info .audio-info-card[data-audio-info-target="#tone-settings"]')?.dataset.audioInfoTarget??null`);
  assert.equal(toneChainButton,'#tone-settings','Tone-only active DSP summary did not target the EQ Tone section.');
  await evaluate(`(async()=>{const f=fixture;if(f.eqControls)await f.eqControls.destroy();f.eqControls=undefined;let page='settings',panel=true,deferredClose,pageFocus;const stage=f.stage,$=selector=>document.querySelector(selector),audioInfoPopup=f.audioInfoPopup,preferences={reduced:true},pageScan={change:()=>false,cancelPending(){},reveal(){}},closePanel=callback=>{deferredClose=callback;return true;},closeManagementPage=()=>{document.querySelector('#music-settings').hidden=true;},cancelTrackReveal=()=>{},syncArchiveTab=()=>{},syncSelectionMotion=()=>{},effects={play(){}},renderEqPage=()=>{void f.mountEq('graphic','standard',false,f.productionRead());};${productionEqRoute}f.audioInfoCallbacks.navigate=productionToneNavigate;const card=document.querySelector('#music-audio-info .audio-info-card[data-audio-info-target="#tone-settings"]');card.click();window.toneNavigationWhilePanelOpen={page,stagePage:stage.dataset.page,deferred:typeof deferredClose==='function',eqHidden:document.querySelector('#music-eq-page').hidden};panel=false;deferredClose();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));window.toneNavigationAfterPanelClose={page,stagePage:stage.dataset.page,eqHidden:document.querySelector('#music-eq-page').hidden,settingsHidden:document.querySelector('#music-settings').hidden,focused:document.activeElement.matches('[data-processing-field="tone.enabled"]'),toneValues:[...document.querySelectorAll('#tone-settings [data-processing-field^="tone.bass."],#tone-settings [data-processing-field^="tone.treble."]')].map(node=>node.value),savedTone:f.productionRead().tone};})()`);
  const deferredToneNavigation=await evaluate(`window.toneNavigationWhilePanelOpen`);
  assert.deepEqual(deferredToneNavigation,{page:'settings',stagePage:'settings',deferred:true,eqHidden:true},'Tone audio-chain navigation bypassed deferred overlay closure.');
  const toneNavigationAudit=await evaluate(`window.toneNavigationAfterPanelClose`);
  assert.equal(toneNavigationAudit.page,'eq');assert.equal(toneNavigationAudit.stagePage,'eq');assert.equal(toneNavigationAudit.eqHidden,false);assert.equal(toneNavigationAudit.settingsHidden,true);assert.equal(toneNavigationAudit.focused,true);
  assert.deepEqual(toneNavigationAudit.toneValues,['95','0.9','3.5','9200','0.75','-1.5']);
  assert.deepEqual(toneNavigationAudit.savedTone,{enabled:true,bass:{frequency:95,q:0.9,gain:3.5},treble:{frequency:9200,q:0.75,gain:-1.5}});
  await evaluate(`document.querySelector('#tone-settings').scrollIntoView({block:'center',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const toneNavigationShot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'punk-eq-tone-navigation.png'),Buffer.from(toneNavigationShot.data,'base64'));
  await evaluate(`document.querySelector('#eq-check-audio-info-trigger').remove();fixture.audioInfoPopup.update(fixture.state)`);
  await evaluate(`fixture.mountEq('parametric')`);
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
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await evaluate(`fixture.stage.dataset.layout='desktop'`);
  await evaluate(`document.querySelector('#tone-settings').scrollIntoView({block:'center',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const futureToneViewportAudit=await evaluate(`(()=>{const tone=document.querySelector('#tone-settings').getBoundingClientRect(),content=document.querySelector('#eq-page-content').getBoundingClientRect(),playback=document.querySelector('#music-playback').getBoundingClientRect();return{toneTop:tone.top,toneBottom:tone.bottom,contentTop:content.top,contentBottom:content.bottom,playbackTop:playback.top};})()`);
  assert.ok(futureToneViewportAudit.toneTop>=futureToneViewportAudit.contentTop-1&&futureToneViewportAudit.toneBottom<=futureToneViewportAudit.contentBottom+1&&futureToneViewportAudit.contentBottom<futureToneViewportAudit.playbackTop,'Future tone controls must be fully visible above the playback bar.');
  const futureToneShot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'future-eq-tone.png'),Buffer.from(futureToneShot.data,'base64'));
  await evaluate(`(async()=>{await fixture.eqControls?.destroy();fixture.eqControls=undefined;fixture.eqSelect?.destroy();fixture.eqRanges?.destroy();fixture.cleanupEqProcessingHarness();fixture.audioInfoCallbacks.navigate=fixture.previousEqAudioNavigate;document.querySelector('#music-eq-page').hidden=true;fixture.stage.dataset.page='music';fixture.stage.dataset.design='archive';if(fixture.previousEqLayout===undefined)delete fixture.stage.dataset.layout;else fixture.stage.dataset.layout=fixture.previousEqLayout;if(fixture.previousEqPlaybackVisible===undefined)delete fixture.stage.dataset.playbackVisible;else fixture.stage.dataset.playbackVisible=fixture.previousEqPlaybackVisible;fixture.shell.setActive(true);document.querySelector('#music-browse').hidden=false;fixture.sharedPanel.setVisible(true);})()`);
  await writeFile(path.join(output,'punk-eq.json'),JSON.stringify({report,palettes,expanded,settingsNavAudit,toneAudit,toneViewportAudit,toneEventAudit,toneNavigationAudit,toneChainButton,binding,future,futureToneViewportAudit},null,2));
}
