import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const expectedModeOrder=['3d','2d','classic','spectrum'];

export async function checkPunkSignal({command,evaluate,output,project}) {
  const old=execFileSync('git',['show','checkpoint/punk-lyrics-from-future:src/signal-page.ts'],{cwd:project,encoding:'utf8'});
  for(const [name,source] of [['SignalBefore',old],['SignalAfter',await readFile(path.join(project,'src/signal-page.ts'),'utf8')]]) {
    const debugSource=source.replace('host.append(root);','host.append(root);Object.assign(root,{__signalDebug:()=>({width,height,visible,disposed,frame,mode,dirty,band0:sampleBand(0),available:snapshot?.available})});');
    const result=await build({stdin:{contents:debugSource,resolveDir:path.join(project,'src'),loader:'ts'},bundle:true,write:false,format:'iife',globalName:name,loader:{'.png':'dataurl'},define:{'crypto.randomUUID':`${name}UUID`},banner:{js:`const ${name}UUID=()=>"00000000-0000-4000-8000-000000000002";`},logLevel:'silent'});
    await evaluate(result.outputFiles[0].text);
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await evaluate(`(()=>{const f=fixture;f.signalNativeRaf=requestAnimationFrame;f.signalNativeCancel=cancelAnimationFrame;f.signalNativeFetch=fetch;f.signalNativeImage=Image;f.signalQueue=new Map();f.signalClock=1000;f.signalId=0;f.signalImages=[];f.signalMetrics={};
    window.requestAnimationFrame=cb=>{const id=++f.signalId;f.signalQueue.set(id,cb);return id;};window.cancelAnimationFrame=id=>f.signalQueue.delete(id);
    window.fetch=()=>{throw new Error('Network is forbidden in isolated signal check');};window.Image=function(w,h){const image=new f.signalNativeImage(w,h);f.signalImages.push(image);return image;};
    f.signalOriginalMethods={};for(const method of ['lineTo','drawImage','clearRect','stroke','fillRect']){const original=CanvasRenderingContext2D.prototype[method];f.signalOriginalMethods[method]=original;CanvasRenderingContext2D.prototype[method]=function(...args){const key=this.canvas.classList.contains('signal-canvas')?'main':this.canvas.classList.contains('signal-trace-canvas')?'trace':'cache';if(f.signalMeasure){const m=f.signalMetrics;m[key+'_'+method]=(m[key+'_'+method]||0)+1;if(method==='drawImage'&&args[0] instanceof HTMLImageElement)m.imageBlits=(m.imageBlits||0)+1;}return original.apply(this,args);};}
    f.signalPump=(count,step=1000/60,advance=false)=>{const elapsed=[];for(let i=0;i<count;i++){f.signalClock+=step;if(advance&&i%6===0){f.signalState={...f.signalState,currentTime:f.signalState.currentTime+.1};f.signalController.update(f.signalState,f.albumMock);}const callbacks=[...f.signalQueue.values()];f.signalQueue.clear();const started=performance.now();for(const callback of callbacks)callback(f.signalClock);elapsed.push(performance.now()-started);}return elapsed;};
    f.mountSignal=async(kind,mode,playing=true)=>{f.signalController?.destroy();f.signalQueue.clear();f.signalImages=[];f.signalAvailable=true;const host=document.querySelector('#signal-page-content');host.replaceChildren();f.signalState={...f.state,currentTime:60,duration:180,playing,transport:playing?'playing':'paused'};const api=kind==='before'?SignalBefore:SignalAfter;
      f.signalController=api.setupSignalPage(host,{seek:t=>f.signalSeek=t,reduced:()=>false,spectrum:()=>({available:f.signalAvailable,reason:f.signalAvailable?undefined:'无可用频谱',bands:Array.from({length:32},(_,i)=>(i%9)/10),binsDb:Array.from({length:512},(_,i)=>-70+15*Math.sin(i/17)),binHz:44100/1024,fftSize:1024,peakDb:-12,rmsDb:-18,sampleRate:44100,updatedAt:Math.floor(f.signalClock/33)*33,stage:'合成音频快照'})});
      f.signalController.update(f.signalState,f.albumMock);f.signalController.setVisible(true);host.querySelector('[data-signal-mode="'+mode+'"]').click();await Promise.all(f.signalImages.filter(x=>x.src).map(x=>x.decode().catch(()=>{})));
      // decode() can resolve before image onload and ResizeObserver callbacks.
      // Drain native paint events before the synthetic RAF pump samples either implementation.
      await new Promise(r=>f.signalNativeRaf.call(window,()=>f.signalNativeRaf.call(window,r)));f.signalPump(75);};
    f.stage.dataset.design='archive';f.stage.dataset.theme='day';f.stage.dataset.page='signal';f.stage.dataset.layout='desktop';f.shell.setActive(true);f.sharedPanel.setVisible(false);document.querySelector('#music-browse').hidden=true;const page=document.querySelector('#music-signal-page');page.hidden=false;page.inert=false;
  })()`);
  await evaluate(`fixture.mountSignal('after','3d',false)`);
  for(const design of ['archive','rhine']) {
    await evaluate(`(()=>{fixture.stage.dataset.design='${design}';})()`);
    await evaluate(`new Promise(r=>setTimeout(r,0))`);
    const controls=await evaluate(`(()=>{const root=document.querySelector('.signal-workspace'),toolbar=root.querySelector('.signal-toolbar'),buttons=[...root.querySelectorAll('[data-signal-mode]')];return{order:buttons.map(button=>button.dataset.signalMode),groups:root.querySelectorAll('.signal-models').length,visible:buttons.every(button=>button.getClientRects().length>0),selected:buttons.filter(button=>button.getAttribute('aria-pressed')==='true').map(button=>button.dataset.signalMode),legacy:!!root.querySelector('.signal-archive-controls,.signal-archive-models,.signal-archive-model-label')||toolbar.textContent.includes('VISUALIZATIONS')||toolbar.textContent.includes('MODEL')};})()`);
    assert.deepEqual(controls,{order:expectedModeOrder,groups:1,visible:true,selected:['3d'],legacy:false},`${design}: unified signal mode controls`);
  }
  await evaluate(`(()=>{fixture.stage.dataset.design='archive';})()`);
  await evaluate(`new Promise(r=>setTimeout(r,0))`);
  const geometry=[];
  for(const [width,height] of [[1920,1080],[1920,1200],[2048,1536],[1920,1280],[2520,1080]]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.mountSignal('after','3d',false)`);
    const layout=await evaluate(`(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();const view=document.querySelector('.signal-viewport');const w=view.clientWidth,h=view.clientHeight,ring=Math.min(w*.64,h*1.2,900);return{workspace:rect('.signal-workspace'),toolbar:rect('.signal-toolbar'),viewport:rect('.signal-viewport'),trace:rect('.signal-trace'),footer:rect('.signal-footer'),frameTop:h*.44-ring*.325,frameBottom:h*.44+ring*.4,canvasHeight:h,controls:[...document.querySelectorAll('.signal-models button')].map(n=>n.getBoundingClientRect().toJSON())};})()`);
    assert.ok(layout.canvasHeight>100&&layout.frameTop>=0&&layout.frameBottom<=layout.canvasHeight,JSON.stringify(layout));
    assert.ok(layout.toolbar.bottom<=layout.viewport.top+1&&layout.viewport.bottom<=layout.trace.top+1&&layout.footer.bottom<=layout.workspace.bottom+1);
    assert.ok(layout.controls.every(r=>r.width>0&&r.left>=layout.workspace.left&&r.right<=layout.workspace.right+1));geometry.push({width,height,...layout});
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  const benchmark=[];
  for(const dpr of [1,2]) {
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:dpr,mobile:false});
  for(const mode of ['2d','3d'])for(const kind of ['before','after']) {
    await evaluate(`fixture.mountSignal('${kind}','${mode}',true)`);
    const sample=await evaluate(`(()=>{const f=fixture;for(let i=0;i<128;i++){f.signalState={...f.signalState,currentTime:i*180/128};f.signalController.update(f.signalState,f.albumMock);f.signalPump(1,100);}f.signalPump(60);f.signalMetrics={};f.signalMeasure=true;const elapsed=f.signalPump(120,1000/60,true);f.signalMeasure=false;const sorted=[...elapsed].sort((a,b)=>a-b);return{metrics:f.signalMetrics,totalMs:elapsed.reduce((a,b)=>a+b,0),medianTickMs:sorted[60],p95TickMs:sorted[114],debug:document.querySelector('.signal-workspace').__signalDebug(),queue:f.signalQueue.size,renderedFrames:f.signalMetrics.main_clearRect||0};})()`);
    benchmark.push({kind,mode,dpr,...sample});
  }
  }
  for(const dpr of [1,2])for(const mode of ['2d','3d']) {
    const before=benchmark.find(x=>x.kind==='before'&&x.mode===mode&&x.dpr===dpr),after=benchmark.find(x=>x.kind==='after'&&x.mode===mode&&x.dpr===dpr);
    assert.ok(after.renderedFrames>=110&&before.renderedFrames<=65,`${mode}: stable 60Hz frame scheduling ${JSON.stringify({before,after})}`);
    assert.ok((after.metrics.trace_fillRect||0)<(before.metrics.trace_fillRect||0),`${mode}: cached trace must reduce raster work`);
    if(mode==='2d')assert.ok((after.metrics.main_lineTo||0)<before.metrics.main_lineTo*.01,'Cached 2D paths must remove repeated JS point submission');
    else assert.equal(after.metrics.imageBlits||0,0,'3D image resampling must stay out of the warm render loop');
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  for(const mode of ['2d','3d','classic','spectrum']) {
    await evaluate(`fixture.mountSignal('after','${mode}',false)`);
    await evaluate(`new Promise(r=>setTimeout(r,200))`);
    const image=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`punk-signal-${mode}.png`),Buffer.from(image.data,'base64'));
  }
  const future=[];
  await evaluate(`fixture.stage.dataset.design='rhine';fixture.shell.setActive(false);`);
  for(const mode of ['2d','3d']) {
    await evaluate(`fixture.mountSignal('before','${mode}',false)`);
    await evaluate(`(()=>{const c=document.querySelector('.signal-canvas');fixture.signalBaseline={width:c.width,height:c.height,data:c.getContext('2d').getImageData(0,0,c.width,c.height).data,png:c.toDataURL()};})()`);
    await evaluate(`fixture.mountSignal('after','${mode}',false)`);
    const pixels=await evaluate(`(()=>{const c=document.querySelector('.signal-canvas'),old=fixture.signalBaseline,current=c.getContext('2d').getImageData(0,0,c.width,c.height).data;if(old.width!==c.width||old.height!==c.height)return{size:false};let changed=0;for(let i=0;i<current.length;i+=4)if(Math.max(Math.abs(current[i]-old.data[i]),Math.abs(current[i+1]-old.data[i+1]),Math.abs(current[i+2]-old.data[i+2]),Math.abs(current[i+3]-old.data[i+3]))>32)changed++;return{size:true,fraction:changed/(c.width*c.height)};})()`);
    if(!pixels.size||pixels.fraction>=.02) {
      const images=await evaluate(`({before:fixture.signalBaseline.png,after:document.querySelector('.signal-canvas').toDataURL()})`);
      for(const [kind,png] of Object.entries(images))await writeFile(path.join(output,`future-signal-${mode}-${kind}.png`),Buffer.from(png.split(',')[1],'base64'));
    }
    assert.ok(pixels.size&&pixels.fraction<.02,`${mode}: Future static rendering must remain equivalent ${JSON.stringify(pixels)}`);future.push({mode,...pixels});
  }
  const behavior=await evaluate(`(()=>{const f=fixture;const seek=document.querySelector('.signal-trace input');seek.value='500';seek.dispatchEvent(new Event('change',{bubbles:true}));f.signalAvailable=false;f.signalController.update({...f.signalState,playing:true,transport:'playing'},f.albumMock);f.signalPump(12);const state=document.querySelector('.signal-workspace').__signalDebug(),label=document.querySelector('.signal-data-state').textContent;f.signalController.setVisible(false);return{seek:f.signalSeek,band0:state.band0,available:state.available,label,queued:f.signalQueue.size};})()`);
  assert.equal(behavior.seek,90);assert.equal(behavior.band0,0);assert.equal(behavior.available,false);assert.equal(behavior.label,'无可用频谱');assert.equal(behavior.queued,0);
  await evaluate(`(()=>{const f=fixture;f.signalController.destroy();for(const [method,original] of Object.entries(f.signalOriginalMethods))CanvasRenderingContext2D.prototype[method]=original;window.requestAnimationFrame=f.signalNativeRaf;window.cancelAnimationFrame=f.signalNativeCancel;window.fetch=f.signalNativeFetch;window.Image=f.signalNativeImage;document.querySelector('#music-signal-page').hidden=true;f.stage.dataset.page='music';document.querySelector('#music-browse').hidden=false;f.sharedPanel.setVisible(true);})()`);
  await writeFile(path.join(output,'punk-signal.json'),JSON.stringify({geometry,benchmark,future,behavior,note:'Synthetic snapshots, 120 scheduled RAF ticks at 60Hz; timings measure browser main-thread submission, not real audio or GPU end-to-end FPS.'},null,2));
}
