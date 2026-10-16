import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(evaluate, expression, label, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return;
    await pause(25);
  }
  assert.fail(`Timed out waiting for ${label}.`);
}

const rectExpression = `(() => {
  const rect = selector => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,centerX:r.left+r.width/2,centerY:r.top+r.height/2};
  };
  const visible = selector => {
    const node = document.querySelector(selector);
    if (!node || node.hidden) return false;
    const style = getComputedStyle(node), r = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const actionSelectors = ['.playback-buttons','.playback-song','.playback-timeline','.playback-volume','.playback-info-trigger','.playback-shuffle','.playback-order','.playback-queue'];
  const actionRects = actionSelectors.map(selector => ({selector,rect:rect(selector)})).filter(item => visible(item.selector));
  const overlaps = [];
  for (let i=0;i<actionRects.length;i++) for (let j=i+1;j<actionRects.length;j++) {
    const a=actionRects[i].rect,b=actionRects[j].rect;
    if (a.left < b.right-.5 && b.left < a.right-.5 && a.top < b.bottom-.5 && b.top < a.bottom-.5) overlaps.push([actionRects[i].selector,actionRects[j].selector]);
  }
  const lyric=document.querySelector('.playback-current-lyric'),lyricStyle=lyric?getComputedStyle(lyric):null;
  const playback=document.querySelector('#music-playback'),select=playback?.querySelector('.playback-order select');
  return {
    design:document.querySelector('#stage')?.dataset.design,
    theme:document.querySelector('#stage')?.dataset.theme,
    playbackVisible:visible('#music-playback'),
    playback:rect('#music-playback'),
    buttons:rect('.playback-buttons'),song:rect('.playback-song'),timeline:rect('.playback-timeline'),seek:rect('.playback-seek'),rail:rect('.playback-rail'),
    lyric:{rect:rect('.playback-current-lyric'),text:lyric?.textContent??'',height:lyric?.getBoundingClientRect().height??0,clientWidth:lyric?.clientWidth??0,scrollWidth:lyric?.scrollWidth??0,whiteSpace:lyricStyle?.whiteSpace??null,overflow:lyricStyle?.overflow??null,textOverflow:lyricStyle?.textOverflow??null,gridRowStart:lyricStyle?.gridRowStart??null,timelineRows:playback?getComputedStyle(playback.querySelector('.playback-timeline')).gridTemplateRows:null,title:lyric?.title??'',ariaHidden:lyric?.getAttribute('aria-hidden')??null},
    shuffle:{rect:rect('.playback-shuffle'),visible:visible('.playback-shuffle'),parentId:document.querySelector('.playback-shuffle')?.parentElement?.id??null},
    order:{rect:rect('.playback-order'),visible:visible('.playback-order'),parentId:document.querySelector('.playback-order')?.parentElement?.id??null,values:select?[...select.options].map(option=>option.value):[],value:select?.value??null,colorScheme:select?getComputedStyle(select).colorScheme:null},
    volume:rect('.playback-volume'),info:rect('.playback-info-trigger'),queue:rect('.playback-queue'),stopCount:document.querySelectorAll('.foobar-stop').length,
    counts:{shuffle:document.querySelectorAll('.playback-shuffle').length,order:document.querySelectorAll('.playback-order').length,dsp:document.querySelectorAll('.foobar-dsp').length,queue:document.querySelectorAll('.playback-queue').length},
    overlaps,
    actionRects,
  };
})()`;

export async function checkPlaybackLyrics({ command, evaluate, output, project }) {
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const bundle = await build({
    stdin: {
      contents: `export {setupLyricsPage} from './src/lyrics-page';`,
      resolveDir: project,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'crypto.randomUUID': 'playbackLyricsFixtureUUID' },
    banner: { js: 'const playbackLyricsFixtureUUID=()=>"00000000-0000-4000-8000-000000000001";' },
    globalName: 'PlaybackLyricsFixture',
    logLevel: 'silent',
  });
  await evaluate(bundle.outputFiles[0].text);

  const baseline = spawnSync('git', ['show', '9e9341e:src/music-playback.css'], {
    cwd: project,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(baseline.status, 0, `Could not read the baseline playback CSS: ${baseline.stderr}`);

  const cloudDoc = {
    trackId: 'fixture-flac',
    lrc: '[offset:500]\n[00:01.00]云端第一句合成歌词\n[00:03.00]云端第二句合成歌词',
    translation: '',
    offsetMs: 500,
    offsetInText: true,
    source: { id: 'qq', name: '合成云歌词' },
    savedAt: '2026-10-16T00:00:00Z',
  };
  const localDoc = {
    trackId: 'fixture-flac',
    lrc: '[00:01.00]本地第一句合成歌词\n[00:03.00]本地第二句合成歌词',
    translation: '',
    offsetMs: 500,
    offsetInText: false,
    source: { id: 'local-import', name: '本地导入' },
    savedAt: '2026-10-16T00:00:00Z',
  };
  const longDoc = {
    trackId: 'fixture-long',
    lrc: `[00:00.00]${'这是一句用于验证底栏歌词单行省略且不会挤压播放按钮的合成测试歌词'.repeat(8)}`,
    translation: '',
    offsetMs: 0,
    offsetInText: false,
    source: { id: 'qq', name: '合成云歌词' },
    savedAt: '2026-10-16T00:00:00Z',
  };

  const setupLyrics = `(() => {
    const f=fixture,stage=f.stage;
    f.lyricsRequests=[];
    f.lyricsResolvePending=false;
    f.lyricsResolveCompleted=false;
    f.lyricsResolvedTracks=[];
    f.lyricsVariantCompleted=[];
    f.resolveInitialLyrics=undefined;
    f.lyricsDocs={cloud:${JSON.stringify(cloudDoc)},local:${JSON.stringify(localDoc)},long:${JSON.stringify(longDoc)}};
    const sources=[{id:'netease',name:'网易云音乐',builtin:true,enabled:true},{id:'qq',name:'QQ音乐',builtin:true,enabled:true}];
    const response=payload=>new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
    const payload=(lyric,activeKind='cloud')=>({lyric,activeKind,effectiveKind:lyric?activeKind:null,userSelected:activeKind==='local',selectionRevision:1,variants:{cloud:true,local:true}});
    window.fetch=async(input,options={})=>{
      const route=new URL(String(input),'http://playback-lyrics.fixture').pathname;
      const body=options.body?JSON.parse(options.body):{};
      f.lyricsRequests.push({route,body});
      if(route==='/api/lyrics/resolve'&&body.trackId==='fixture-flac'){
        f.lyricsResolvePending=true;
        return await new Promise(resolve=>{f.resolveInitialLyrics=value=>{f.lyricsResolvePending=false;f.lyricsResolveCompleted=true;f.lyricsResolvedTracks.push(body.trackId);resolve(response(value));};});
      }
      if(route==='/api/lyrics/resolve'&&body.trackId==='fixture-long'){f.lyricsResolvedTracks.push(body.trackId);return response(payload(f.lyricsDocs.long,'cloud'));}
      if(route==='/api/lyrics/resolve'&&body.trackId==='fixture-missing'){f.lyricsResolvedTracks.push(body.trackId);return response({lyric:null,activeKind:'cloud',effectiveKind:null,userSelected:false,selectionRevision:2,variants:{cloud:false,local:false},sources:[{sourceId:'qq',name:'QQ音乐',status:'empty',count:0}]});}
      if(route==='/api/lyrics/settings')return response({settings:{defaultSourceId:'netease',cacheDirectory:'',defaultCacheDirectory:''},sources});
      if(route==='/api/lyrics/search')return response({candidates:[],sourceName:'合成歌词来源',sources:[{sourceId:'qq',name:'QQ音乐',status:'ok',count:0}]});
      if(route==='/api/lyrics/variant'){f.lyricsVariantCompleted.push(body.kind);return response(payload(f.lyricsDocs[body.kind],body.kind));}
      if(route==='/api/lyrics/offset'){
        const kind=body.kind==='local'?'local':'cloud';
        f.lyricsDocs[kind]={...f.lyricsDocs[kind],offsetMs:body.offsetMs};
        return response(payload(f.lyricsDocs[kind],kind));
      }
      throw new Error('Unexpected request in offline playback lyrics fixture: '+route);
    };
    const page=stage.querySelector('#music-lyrics-page');
    page.hidden=true;page.inert=true;stage.dataset.page='music';
    const controller=PlaybackLyricsFixture.setupLyricsPage(stage.querySelector('#lyrics-page-content'),{
      seek:seconds=>{f.lyricsSeek??=[];f.lyricsSeek.push(seconds);},notify:()=>{},openSettings:()=>{},
      spectrum:()=>({available:true,bands:Array.from({length:32},(_,i)=>(i%8)/8),sampleRate:44100,updatedAt:Date.now()}),
    });
    f.lyricsController=controller;
    stage.classList.add('reduce-motion');
    f.updatePlayback({...f.state,currentTime:.55});
    return {hidden:page.hidden,pending:f.lyricsResolvePending,lyric:f.playbackControls?document.querySelector('.playback-current-lyric')?.textContent:null};
  })()`;
  const initial = await evaluate(setupLyrics);
  assert.equal(initial.hidden, true, 'The lyrics page begins hidden for the asynchronous playback subscription check.');
  await waitFor(evaluate, 'fixture.lyricsResolvePending===true', 'the synthetic asynchronous lyrics resolve');
  assert.equal(await evaluate(`document.querySelector('.playback-current-lyric').textContent`), '', 'A pending resolve leaves the bottom lyric empty.');

  const cloudPayload = { lyric: cloudDoc, activeKind: 'cloud', effectiveKind: 'cloud', userSelected: false, selectionRevision: 1, variants: { cloud: true, local: true } };
  await evaluate(`fixture.resolveInitialLyrics(${JSON.stringify(cloudPayload)})`);
  await waitFor(evaluate, `document.querySelector('.playback-current-lyric').textContent===${JSON.stringify('云端第一句合成歌词')}`, 'the hidden page async result to refresh the playback lyric');
  const hiddenAsync = await evaluate(`(() => ({hidden:document.querySelector('#music-lyrics-page').hidden,text:document.querySelector('.playback-current-lyric').textContent,title:document.querySelector('.playback-current-lyric').title,ariaHidden:document.querySelector('.playback-current-lyric').getAttribute('aria-hidden'),current:[fixture.lyricsController.currentLine(.25),fixture.lyricsController.currentLine(.55)],requestCount:fixture.lyricsRequests.length}))()`);
  assert.equal(hiddenAsync.hidden, true);
  assert.equal(hiddenAsync.text, '云端第一句合成歌词');
  assert.equal(hiddenAsync.title, hiddenAsync.text);
  assert.equal(hiddenAsync.ariaHidden, 'false');
  assert.deepEqual(hiddenAsync.current, ['', '云端第一句合成歌词'], 'The getter applies an LRC offset already embedded in cloud timestamps exactly once.');
  const getterPurity = await evaluate(`(() => {const f=fixture,before=f.lyricsRequests.length,text=document.querySelector('.playback-current-lyric').textContent,lines=[f.lyricsController.currentLine(.25),f.lyricsController.currentLine(.55)];return{before,after:f.lyricsRequests.length,textBefore:text,textAfter:document.querySelector('.playback-current-lyric').textContent,lines};})()`);
  assert.equal(getterPurity.before, getterPurity.after, 'currentLine(position) does not request or mutate lyric data.');
  assert.equal(getterPurity.textBefore, getterPurity.textAfter, 'currentLine(position) leaves rendered state unchanged.');

  await evaluate(`fixture.updatePlayback({...fixture.state,currentTime:3.25})`);
  assert.equal(await evaluate(`document.querySelector('.playback-current-lyric').textContent`), '云端第二句合成歌词', 'Player time updates refresh the bottom lyric while the lyrics page stays hidden.');

  await evaluate(`(() => {const stage=fixture.stage,page=stage.querySelector('#music-lyrics-page');stage.dataset.page='lyrics';stage.querySelector('#music-browse').hidden=true;page.hidden=false;page.inert=false;fixture.lyricsController.setVisible(true);return true;})()`);
  await waitFor(evaluate, `fixture.lyricsRequests.some(request=>request.route==='/api/lyrics/settings')`, 'the LyricsPage source settings mock');
  await evaluate(`document.querySelector('.lyrics-settings-gear').click()`);
  await waitFor(evaluate, `!document.querySelector('#lyrics-options-dialog').hidden`, 'the synthetic lyrics source dialog');
  await evaluate(`fixture.updatePlayback({...fixture.state,currentTime:.25});document.querySelector('#lyrics-options-local-tab').click()`);
  await waitFor(evaluate, `fixture.lyricsVariantCompleted.includes('local')&&document.querySelector('.playback-current-lyric').textContent===''`, 'the local lyric variant switch');
  const localBeforeOffset = await evaluate(`(() => ({text:document.querySelector('.playback-current-lyric').textContent,current:[fixture.lyricsController.currentLine(.25),fixture.lyricsController.currentLine(.55)]}))()`);
  assert.deepEqual(localBeforeOffset, { text: '', current: ['', '本地第一句合成歌词'] }, 'A stored local offset applies once to timestamps that do not contain an LRC offset.');
  await evaluate(`document.querySelectorAll('.lyrics-offset-controls .lyrics-offset-nudge')[1].click()`);
  await waitFor(evaluate, `fixture.lyricsRequests.some(request=>request.route==='/api/lyrics/offset'&&request.body.kind==='local'&&request.body.offsetMs===1000)`, 'the local offset update mock');
  await waitFor(evaluate, `document.querySelector('.playback-current-lyric').textContent==='本地第一句合成歌词'`, 'the offset update to refresh the playback lyric');
  await evaluate(`document.querySelector('#lyrics-options-cloud-tab').click()`);
  await waitFor(evaluate, `fixture.lyricsVariantCompleted.includes('cloud')&&document.querySelector('.playback-current-lyric').textContent===''`, 'switching back to the cloud lyric variant');
  await evaluate(`fixture.updatePlayback({...fixture.state,currentTime:.55})`);
  assert.equal(await evaluate(`document.querySelector('.playback-current-lyric').textContent`), '云端第一句合成歌词');
  await evaluate(`fixture.lyricsController.setVisible(false);fixture.stage.dataset.page='music';fixture.stage.querySelector('#music-lyrics-page').hidden=true;fixture.stage.querySelector('#music-lyrics-page').inert=true;fixture.stage.querySelector('#music-browse').hidden=false;`);

  const geometry = [];
  const screenshots = [];
  for (const [design, theme] of [['rhine','day'],['rhine','night'],['archive','day'],['archive','night']]) {
    await evaluate(`(() => {
      const f=fixture,stage=f.stage,design=${JSON.stringify(design)},theme=${JSON.stringify(theme)};
      stage.dataset.design=design;stage.dataset.theme=theme;stage.dataset.layout='desktop';stage.dataset.page='music';
      f.applyStylePalette(stage,{...(design==='archive'?f.archiveMusicStyle:f.defaultMusicStyle),design},theme);
      f.syncDesignIdentity();f.shell.setActive(design==='archive');
      const page=stage.querySelector('#music-lyrics-page');page.hidden=true;page.inert=true;
      stage.querySelector('#music-browse').hidden=false;
      f.updatePlayback({...f.state,currentTime:.55});
      return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    })()`);
    const measurement = await evaluate(rectExpression);
    assert.equal(measurement.playbackVisible, true, `${design}/${theme}: playback is visible with the synthetic current track.`);
    assert.equal(measurement.shuffle.parentId, 'music-playback', `${design}/${theme}: SHUFFLE ALL is a direct shared playback child.`);
    assert.equal(measurement.order.parentId, 'music-playback', `${design}/${theme}: ORDER is a direct shared playback child.`);
    assert.equal(measurement.shuffle.visible, true, `${design}/${theme}: SHUFFLE ALL is visible.`);
    assert.equal(measurement.order.visible, true, `${design}/${theme}: ORDER is visible.`);
    assert.deepEqual(measurement.order.values, ['default','repeat-queue','repeat-track','random','shuffle-tracks','shuffle-albums','shuffle-folders']);
    assert.equal(measurement.order.colorScheme, theme==='day'?'light':'dark', `${design}/${theme}: the native ORDER menu follows the selected theme.`);
    assert.equal(measurement.counts.shuffle, 1, `${design}/${theme}: there is one shared shuffle control.`);
    assert.equal(measurement.counts.order, 1, `${design}/${theme}: there is one shared order control.`);
    assert.equal(measurement.counts.dsp, 0, `${design}/${theme}: the retired footer DSP duplicate is absent.`);
    assert.equal(measurement.counts.queue, 1, `${design}/${theme}: the queue control remains singular.`);
    if (design === 'archive') assert.ok(measurement.stopCount >= 1, `${design}/${theme}: the Foobar stop control remains available.`);
    assert.deepEqual(measurement.overlaps, [], `${design}/${theme}: playback transport, song, timeline and shared actions do not overlap: ${JSON.stringify(measurement.actionRects)}`);
    assert.equal(measurement.lyric.text, '云端第一句合成歌词');
    assert.equal(measurement.lyric.whiteSpace, 'nowrap');
    assert.equal(measurement.lyric.overflow, 'hidden');
    assert.equal(measurement.lyric.textOverflow, 'ellipsis');
    geometry.push(measurement);

    if (design === 'rhine') {
      const baselineNodes = await evaluate(`(() => {
        const playback=document.querySelector('#music-playback'),timeline=playback.querySelector('.playback-timeline');
        const selectors=['.playback-current-lyric','.playback-shuffle','.playback-order'];
        const markers=[];
        for(const selector of selectors){const node=playback.querySelector(selector);if(!node)continue;const marker=document.createComment('playback-baseline-slot');node.before(marker);node.remove();markers.push({selector,node,marker});}
        window.__playbackBaselineNodes=markers;
        const sheet=document.createElement('style');sheet.id='playback-lyrics-baseline';
        sheet.textContent=${JSON.stringify(baseline.stdout)}+'\\n#music-playback .playback-timeline{grid-template-rows:none!important;grid-auto-rows:auto!important}#music-playback .playback-timeline > :is(#playback-elapsed,.playback-seek,#playback-duration){grid-row:auto!important}\\n';
        document.head.append(sheet);
        return markers.length;
      })()`);
      assert.equal(baselineNodes, 3, 'Baseline reconstruction removes only the new lyric and shared controls.');
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const before = await evaluate(rectExpression);
      const capture = await command('Page.captureScreenshot', { format: 'png' });
      const filename = `future-${theme}-baseline.png`;
      await writeFile(path.join(output, filename), Buffer.from(capture.data, 'base64'));
      screenshots.push(filename);
      const restored = await evaluate(`(() => {
        document.querySelector('#playback-lyrics-baseline').remove();
        for(const {node,marker} of window.__playbackBaselineNodes)marker.replaceWith(node);
        delete window.__playbackBaselineNodes;
        return true;
      })()`);
      assert.equal(restored, true);
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const after = await evaluate(rectExpression);
      const comparison = {
        theme,
        baselineSource: '9e9341e:src/music-playback.css with lyric/actions removed and the old one-row timeline restored',
        before: { timeline: before.timeline, rail: before.rail, playback: before.playback },
        after: { timeline: after.timeline, rail: after.rail, playback: after.playback },
        delta: { timelineLeft: after.timeline.left-before.timeline.left, railLeft: after.rail.left-before.rail.left, railCenterY: after.rail.centerY-before.rail.centerY },
      };
      assert.ok(comparison.delta.timelineLeft < -1, `Future ${theme}: the timeline moves left versus the previous four-column layout: ${JSON.stringify(comparison.delta)}`);
      assert.ok(comparison.delta.railLeft < -1, `Future ${theme}: the progress rail moves left versus the previous four-column layout: ${JSON.stringify(comparison.delta)}`);
      assert.ok(comparison.delta.railCenterY >= 6 && comparison.delta.railCenterY <= 12,
        `Future ${theme}: the lyric row moves the progress rail down about 8–9px: ${JSON.stringify({ delta: comparison.delta, before: comparison.before, after: comparison.after })}`);
      geometry.at(-1).baseline = comparison.before;
      geometry.at(-1).baselineDelta = comparison.delta;
    } else {
      await evaluate(`(() => {
        const sheet=document.createElement('style');sheet.id='punk-playback-lyrics-baseline';
        sheet.textContent='#music-playback .playback-current-lyric{display:none!important}#music-playback .playback-timeline{grid-template-rows:none!important;grid-auto-rows:auto!important;height:44px!important}#music-playback .playback-timeline>*{grid-row:1!important}';
        document.head.append(sheet);return true;
      })()`);
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const before = await evaluate(rectExpression);
      await evaluate(`document.querySelector('#punk-playback-lyrics-baseline').remove();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const after = await evaluate(rectExpression);
      const comparison = {
        baselineSource: 'isolated 44px one-row Punk timeline fixture with lyric hidden',
        before: { timeline: before.timeline, rail: before.rail },
        after: { timeline: after.timeline, rail: after.rail },
        delta: { railCenterY: after.rail.centerY-before.rail.centerY },
      };
      assert.ok(comparison.delta.railCenterY >= 6 && comparison.delta.railCenterY <= 12,
        `Punk ${theme}: the lyric row moves the progress rail down about 8–9px: ${JSON.stringify(comparison)}`);
      geometry.at(-1).baseline = comparison.before;
      geometry.at(-1).baselineDelta = comparison.delta;
    }

    const shot = await command('Page.captureScreenshot', { format: 'png' });
    const filename = `${design === 'rhine' ? 'future' : 'punk'}-${theme}.png`;
    await writeFile(path.join(output, filename), Buffer.from(shot.data, 'base64'));
    screenshots.push(filename);
  }

  const orderResult = await evaluate(`(() => {
    const f=fixture,select=document.querySelector('.playback-order select'),before=f.orderCalls.length;
    select.value='shuffle-folders';select.dispatchEvent(new Event('change',{bubbles:true}));
    return {calls:f.orderCalls.slice(before),state:f.state.playbackOrder,select:select.value};
  })()`);
  assert.deepEqual(orderResult, { calls: ['shuffle-folders'], state: 'shuffle-folders', select: 'shuffle-folders' }, 'Changing ORDER calls the production setFoobarOrder callback once and the player state is reflected in the select.');
  await evaluate(`fixture.updatePlayback({...fixture.state,playbackOrder:'repeat-track'})`);
  assert.equal(await evaluate(`document.querySelector('.playback-order select').value`), 'repeat-track', 'ORDER also follows subsequent playback state updates.');

  const seek = await evaluate(`(() => {const f=fixture,input=document.querySelector('#playback-progress'),before=f.seekCalls.length;input.value='37.5';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return f.seekCalls.slice(before);})()`);
  assert.deepEqual(seek, [37.5], 'The existing playback progress control still commits one seek.');

  const shuffle = await evaluate(`(() => {
    const f=fixture,offlineTrack={id:'fixture-offline-track',albumId:'fixture-offline-album',title:'Offline synthetic track'};
    f.records.push({id:'fixture-offline-album',album:{id:'fixture-offline-album',offline:true,tracks:[offlineTrack]}});
    const expected=f.records.flatMap(record=>record.album&&!record.album.offline?record.album.tracks:[]).map(track=>track.id);
    const before=f.playCalls.length,playedBefore=f.played.length;
    document.querySelector('.playback-shuffle').click();
    const call=f.playCalls.at(-1);
    return {delta:f.playCalls.length-before,playedDelta:f.played.length-playedBefore,id:call?.id??null,queue:call?.tracks.map(track=>track.id)??[],expected};
  })()`);
  assert.equal(shuffle.delta, 1, 'One SHUFFLE ALL click invokes the whole-library play once.');
  assert.equal(shuffle.playedDelta, 1);
  assert.equal(shuffle.queue.length, shuffle.expected.length);
  assert.deepEqual([...shuffle.queue].sort(), [...shuffle.expected].sort(), 'SHUFFLE ALL includes every synthetic online-library track and excludes the offline record.');
  assert.equal(shuffle.id, shuffle.queue[0], 'Playback starts at the first track in the shuffled queue.');
  assert.equal(shuffle.queue.includes('fixture-offline-track'), false);

  await evaluate(`(() => {
    const f=fixture,track={id:'fixture-long',albumId:'fixture-album',title:'Long synthetic track',artist:'Fixture Artist',duration:180,format:'FLAC'};
    f.updatePlayback({...f.state,currentTrack:track,queue:[track],currentIndex:0,currentTime:.55});return true;
  })()`);
  await waitFor(evaluate, `document.querySelector('.playback-current-lyric').textContent.startsWith('这是一句用于验证底栏歌词')`, 'the long synthetic line');
  const longLine = await evaluate(rectExpression);
  assert.ok(longLine.lyric.clientWidth > 0 && longLine.lyric.scrollWidth > longLine.lyric.clientWidth, 'The long lyric exceeds its single-line slot and is clipped.');
  assert.ok(longLine.lyric.rect.width > 0);
  assert.ok(longLine.shuffle.rect.left >= longLine.timeline.right-.5 && longLine.order.rect.left >= longLine.shuffle.rect.right-.5,
    'A long lyric does not push or overlap the shuffle and order controls.');

  await evaluate(`(() => {
    const f=fixture,track={id:'fixture-missing',albumId:'fixture-album',title:'Missing synthetic track',artist:'Fixture Artist',duration:180,format:'FLAC'};
    f.updatePlayback({...f.state,currentTrack:track,queue:[track],currentIndex:0,currentTime:.55});return true;
  })()`);
  assert.equal(await evaluate(`document.querySelector('.playback-current-lyric').textContent`), '', 'Changing tracks clears the prior lyric before the new resolve completes.');
  await waitFor(evaluate, `fixture.lyricsRequests.some(request=>request.route==='/api/lyrics/resolve'&&request.body.trackId==='fixture-missing')`, 'the no-lyrics synthetic resolve');
  await waitFor(evaluate, `fixture.lyricsResolvePending===false&&fixture.lyricsController.currentLine()===''`, 'the no-lyrics result');
  const empty = await evaluate(rectExpression);
  assert.equal(empty.lyric.text, '');
  assert.equal(empty.lyric.title, '');
  assert.equal(empty.lyric.ariaHidden, 'true');
  assert.equal(empty.lyric.rect.width, longLine.lyric.rect.width, 'The empty lyric slot keeps the same width when no lyric is available.');
  assert.equal(empty.timeline.height, longLine.timeline.height, 'The two-row timeline keeps its reserved height when no lyric is available.');
  assert.equal(empty.rail.centerY, longLine.rail.centerY, 'The empty lyric leaves the seek rail in the same reserved second-row position.');
  assert.equal(empty.lyric.gridRowStart, longLine.lyric.gridRowStart);
  assert.equal(empty.lyric.timelineRows, longLine.lyric.timelineRows);

  const report = {
    ok: true,
    viewport: { width: 1920, height: 1080 },
    syntheticDataOnly: true,
    network: { fetchMocked: true, requests: await evaluate(`fixture.lyricsRequests`) },
    asyncHiddenLyrics: hiddenAsync,
    getterPurity,
    sourceSwitch: { localBeforeOffset, localOffsetAppliedMs: 1000, cloudAfterSwitch: '云端第一句合成歌词' },
    order: orderResult,
    seek,
    shuffle,
    longLine: { lyric: longLine.lyric, timeline: longLine.timeline, shuffle: longLine.shuffle, order: longLine.order },
    emptySlot: { lyric: empty.lyric, timeline: empty.timeline, rail: empty.rail, sameReservedGeometryAsLongLine: empty.timeline.height===longLine.timeline.height&&empty.rail.centerY===longLine.rail.centerY&&empty.lyric.rect.width===longLine.lyric.rect.width },
    geometry,
    screenshots,
  };
  await writeFile(path.join(output, 'playback-lyrics.json'), JSON.stringify(report, null, 2), 'utf8');
}
