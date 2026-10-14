import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createTrackFixture} from './check-foobar-tracks.mjs';

export async function checkPunkControls({command,evaluate,output}) {
  const report=[];
  for(const width of [1440,1920,2560]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.stage.dataset.design='archive';fixture.stage.dataset.layout='desktop';fixture.shell.setActive(true);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const nav=await evaluate(`(()=>{const clock=document.querySelector('.foobar-header .foobar-clock').getBoundingClientRect(),button=document.querySelector('.foobar-header [data-action="settings"]').getBoundingClientRect(),slot=document.querySelector('.foobar-nav-slot').getBoundingClientRect();return{gap:button.left-clock.right,right:button.right,limit:slot.right};})()`);
    assert.ok(nav.gap>=0&&nav.gap<=20,`${width}: SETTINGS follows clock ${JSON.stringify(nav)}`);
    assert.ok(nav.right<=nav.limit+1,`${width}: complete SETTINGS button visible ${JSON.stringify(nav)}`);
  }
  for(const design of ['archive','rhine']) {
    await command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate(`fixture.stage.dataset.design='${design}';fixture.stage.dataset.mode='archive';fixture.stage.dataset.layout='desktop';fixture.shell.setActive(${design==='archive'});fixture.sharedPanel.setOpen(false);fixture.sharedPanel.finish();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const header=await evaluate(`(()=>{const nav=document.querySelector('.music-topnav'),nodes=[...nav.children],online=nav.querySelector('[data-action="online"]'),mode=nav.querySelector('.theme-switch'),clock=nav.querySelector('.foobar-clock'),settings=nav.querySelector('[data-action="settings"]');let count=0;const listener=e=>{if(e.target.closest('[data-action="settings"]'))count++;};document.addEventListener('click',listener);settings.click();document.removeEventListener('click',listener);return{order:[online,mode,clock,settings].map(x=>nodes.indexOf(x)),clocks:document.querySelectorAll('.foobar-clock').length,time:clock.textContent,menu:!!document.querySelector('.foobar-menu'),settingsBubble:count,queueParent:document.querySelector('.playback-queue').parentElement.className};})()`);
    assert.ok(header.order.every((x,i,a)=>x>=0&&(i===0||x>a[i-1])),`${design}: header order ${header.order}`);
    assert.equal(header.clocks,1);assert.match(header.time,/\d{2}:\d{2}:\d{2}/);assert.equal(header.menu,false);assert.equal(header.settingsBubble,1);
    assert.match(header.queueParent,design==='archive'?/foobar-mode-slot/:/playback-utilities/);
    const queue=await evaluate(`(()=>{const f=fixture,b=document.querySelector('.playback-queue'),state={...f.state,currentTrack:f.albumMock.tracks[3]};f.updatePlayback(state);b.click();const p=document.querySelector('.album-queue-popover'),list=p.querySelector('.album-queue-list'),r=p.getBoundingClientRect(),br=b.getBoundingClientRect(),count=p.querySelectorAll('.album-queue-track').length,current=p.querySelector('.is-current')?.dataset.trackId;const steps=f.albumSteps;const active=document.activeElement;active.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));list.scrollTop=120;const scroll=list.scrollTop;f.updatePlayback({...state,currentTime:100});const retained=list===p.querySelector('.album-queue-list')&&list.scrollTop===scroll;return{count,current,retained,steps:f.albumSteps===steps,above:r.bottom<=br.top+1,bounds:r.toJSON(),open:f.albumQueue.isOpen};})()`);
    assert.equal(queue.count,30);assert.equal(queue.current,'track-3');assert.equal(queue.retained,true);assert.equal(queue.steps,true);assert.equal(queue.above,true);assert.equal(queue.open,true);
    const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`${design}-queue-header.png`),Buffer.from(shot.data,'base64'));
    const behavior=await evaluate(`(()=>{const f=fixture;f.updatePlayback({...f.state,currentTrack:{...f.albumMock.tracks[0],albumId:'unknown-album'}});const empty=!!document.querySelector('.album-queue-empty')&&document.querySelectorAll('.album-queue-track').length===0;f.updatePlayback({...f.state,currentTrack:f.albumMock.tracks[3]});document.querySelectorAll('.album-queue-track')[7].click();const played=f.played.at(-1),closed=!f.albumQueue.isOpen,mode=f.stage.dataset.mode;document.querySelector('.playback-queue').click();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return{empty,played,closed,mode,esc:!f.albumQueue.isOpen,focus:document.activeElement===document.querySelector('.playback-queue')};})()`);
    assert.equal(behavior.empty,true);assert.equal(behavior.played,'track-7');assert.equal(behavior.closed,true);assert.equal(behavior.mode,'archive');assert.equal(behavior.esc,true);assert.equal(behavior.focus,true);
    report.push({design,header,queue,behavior});
  }
  await evaluate(`fixture.stage.dataset.design='archive';fixture.shell.setActive(true);fixture.sharedPanel.setVisible(false);fixture.sharedPanel.setVisible(true);`);
  const typing=await evaluate(`(async()=>{const label=document.querySelector('.open-album-label');await new Promise(r=>setTimeout(r,100));const early=label.textContent;await new Promise(r=>setTimeout(r,550));const button=document.querySelector('.open-album');return{early,final:label.textContent,bg:getComputedStyle(button).backgroundColor,ink:getComputedStyle(document.querySelector('.album-callout')).color,width:button.getBoundingClientRect().width,pane:fixture.sharedPanel.element.getBoundingClientRect().width};})()`);
  assert.notEqual(typing.early,typing.final);assert.equal(typing.final,'打开专辑');assert.equal(typing.bg,typing.ink);assert.ok(typing.width<typing.pane*.8,'Punk action is a compact title block');
  const fixture=await createTrackFixture();
  fixture.records[0].album.coverUrl='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#d6b78a"/></svg>').toString('base64');
  fixture.records[1].album.coverUrl=fixture.records[0].album.coverUrl;
  fixture.catalog.configureFoobarCatalog({show:'tracks',layout:'grid',group:'none',sort:'title'});
  const html=fixture.catalog.foobarGridMarkup(0);
  await evaluate(`fixture.stage.dataset.foobarLayout='grid';document.querySelector('.foobar-catalog-tools').innerHTML=${JSON.stringify(fixture.catalog.foobarCatalogMarkup())};document.querySelector('.foobar-grid-host').hidden=false;document.querySelector('.foobar-grid-host').innerHTML=${JSON.stringify(html)};new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const grid=await evaluate(`(()=>{const host=document.querySelector('.foobar-grid-host'),images=[...host.querySelectorAll('.foobar-cover-image')];return{cards:host.querySelectorAll('.foobar-track-card').length,maxImage:Math.max(...images.map(x=>x.getBoundingClientRect().width)),client:host.clientWidth,scroll:host.scrollWidth};})()`);
  assert.equal(grid.cards,29);assert.ok(grid.maxImage<=240,`Track thumbnail grew to ${grid.maxImage}`);assert.ok(grid.scroll<=grid.client+1,'TRACKS grid must not overflow horizontally');
  const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'punk-track-grid.png'),Buffer.from(shot.data,'base64'));
  await evaluate(`fixture.stage.dataset.foobarLayout='array';document.querySelector('.foobar-grid-host').hidden=true;fixture.shell.refreshCatalog();fixture.updatePlayback(fixture.state)`);
  await writeFile(path.join(output,'punk-controls-queue.json'),JSON.stringify({report,typing,grid},null,2));
}
