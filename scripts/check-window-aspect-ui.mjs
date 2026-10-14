import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function checkWindowAspectUi({command,evaluate,output,project}) {
  const result=await build({stdin:{contents:`export {applyWindowAspect,windowAspectMarkup} from './src/window-aspect';export {WINDOW_ASPECTS} from './src/window-aspect-model.mjs';export {musicStyleMarkup,archiveMusicStyle,defaultMusicStyle} from './src/music-style';`,resolveDir:project,loader:'ts'},bundle:true,write:false,format:'iife',define:{'import.meta.glob':'aspectFixtureGlob'},banner:{js:'const aspectFixtureGlob=()=>({});'},globalName:'AspectFixture',logLevel:'silent'});
  await evaluate(result.outputFiles[0].text);
  await evaluate(`fixture.aspectOriginalStyle=fixture.stage.getAttribute('style');fixture.aspectBodyStyle=document.body.getAttribute('style');`);
  const report=[];
  for(const design of ['rhine','archive']) {
    await evaluate(`fixture.stage.dataset.design='${design}';fixture.shell.setActive(${design==='archive'});fixture.stage.dataset.page='theme';fixture.stage.dataset.layout='desktop';fixture.sharedPanel.setVisible(false);document.querySelector('#music-browse').hidden=true;document.querySelector('#music-theme-page').hidden=false;document.querySelector('#music-theme-page').inert=false;`);
    for(const [width,height] of [[1920,1080],[1920,1200],[2048,1536],[2560,1440]]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      for(const aspect of ['16:9','16:10','4:3','3:2','21:9','free']) {
        const geometry=await evaluate(`(()=>{AspectFixture.applyWindowAspect(fixture.stage,'${aspect}');const rect=fixture.stage.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};})()`);
        assert.ok(geometry.x>=0&&geometry.y>=0&&geometry.x+geometry.width<=width+1&&geometry.y+geometry.height<=height+1);
        if(aspect==='free'){assert.equal(geometry.width,width);assert.equal(geometry.height,height);}else {const [a,b]=aspect.split(':').map(Number);assert.ok(Math.abs(geometry.width/(a/b)-geometry.height)<=1);}
        report.push({design,width,height,aspect,...geometry});
      }
    }
    await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
    const markup=await evaluate(`(()=>{const content=document.querySelector('#theme-page-content');content.innerHTML=AspectFixture.musicStyleMarkup({...AspectFixture.${design==='archive'?'archiveMusicStyle':'defaultMusicStyle'}},'day');content.querySelector('.music-style-heading').insertAdjacentHTML('afterend',AspectFixture.windowAspectMarkup('4:3'));AspectFixture.applyWindowAspect(fixture.stage,'16:9');const select=content.querySelector('[data-window-aspect]');return{count:content.querySelectorAll('[data-window-aspect]').length,selected:select.value,options:[...select.options].map(x=>x.value),bounds:select.getBoundingClientRect().toJSON()};})()`);
    assert.equal(markup.count,1);assert.equal(markup.selected,'4:3');assert.deepEqual(markup.options,['16:9','16:10','4:3','3:2','21:9','free']);assert.ok(markup.bounds.width>100);
    const visible=await evaluate(`(()=>{document.querySelector('[data-window-aspect]').scrollIntoView({block:'center',behavior:'instant'});const rect=document.querySelector('[data-window-aspect]').getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight;})()`);assert.equal(visible,true,`${design}: ratio control can be scrolled into view`);
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const screenshot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`${design}-window-aspect.png`),Buffer.from(screenshot.data,'base64'));
  }
  await evaluate(`document.querySelector('#music-theme-page').hidden=true;fixture.stage.dataset.page='music';document.querySelector('#music-browse').hidden=false;fixture.stage.removeAttribute('data-window-aspect');if(fixture.aspectOriginalStyle===null)fixture.stage.removeAttribute('style');else fixture.stage.setAttribute('style',fixture.aspectOriginalStyle);if(fixture.aspectBodyStyle===null)document.body.removeAttribute('style');else document.body.setAttribute('style',fixture.aspectBodyStyle);fixture.sharedPanel.setVisible(true);`);
  await writeFile(path.join(output,'window-aspect-ui.json'),JSON.stringify(report,null,2));
}
