import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const orderValues = ['default', 'repeat-queue', 'repeat-track', 'random', 'shuffle-tracks', 'shuffle-albums', 'shuffle-folders'];

export async function runUnifiedUiChecks({ command, evaluate, output, project }) {
  await mkdir(output, { recursive: true });
  const report = {
    ok: false,
    mode: 'unified-ui',
    createdAt: new Date().toISOString(),
    cases: [],
    screenshots: [],
  };

  const paint = () => evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,24)))))`);
  const fixtureCall = (name, ...args) => evaluate(`fixture[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
  const waitFor = async (expression, label, timeoutMs = 2500) => {
    const started = Date.now();
    let lastValue;
    while (Date.now() - started < timeoutMs) {
      lastValue = await evaluate(expression);
      if (lastValue) return lastValue;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
  };
  const click = async selector => {
    const clicked = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return false;element.click();return true;})()`);
    assert.equal(clicked, true, `Expected a clickable element at ${selector}.`);
    await paint();
  };
  const screenshot = async (name, selector) => {
    await paint();
    const clip = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return null;const r=element.getBoundingClientRect(),x=Math.floor(Math.max(0,r.x)),y=Math.floor(Math.max(0,r.y));return{x,y,width:Math.max(1,Math.ceil(r.right)-x),height:Math.max(1,Math.ceil(r.bottom)-y),scale:1};})()`);
    assert.ok(clip && clip.width > 0 && clip.height > 0, `Screenshot target is not painted: ${selector}`);
    const image = await command('Page.captureScreenshot', { format: 'png', clip });
    const file = `${name}.png`;
    await writeFile(path.join(output, file), Buffer.from(image.data, 'base64'));
    report.screenshots.push(file);
  };
  const runCase = async (name, callback) => {
    try {
      const result = await callback();
      report.cases.push({ name, ok: true, ...(result === undefined ? {} : { result }) });
      return result;
    } catch (error) {
      report.cases.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const readTheme = () => evaluate(`({theme:fixture.preferences.theme,stage:fixture.stage.dataset.theme,design:fixture.preferences.style.design})`);
  const setTheme = async theme => {
    await fixtureCall('setTheme', theme);
    await paint();
    const state = await readTheme();
    assert.equal(state.theme, theme, `Global preference should be ${theme}.`);
    assert.equal(state.stage, theme, `Rendered stage should use the global ${theme} palette.`);
  };

  try {
    assert.equal(await evaluate(`typeof fixture.switchDesign`), 'function', 'The fixture must expose the production switchDesign callback.');
    assert.equal(await evaluate(`typeof fixture.setTheme`), 'function', 'The fixture must expose the production setTheme callback.');
    assert.equal(await evaluate(`typeof fixture.normalizeDesignProfiles`), 'function', 'The fixture must expose production normalizeDesignProfiles.');

    await runCase('ORDER custom select: click, keyboard, Escape, outside click, and day/night skin', async () => {
      const triggerSelector = '.playback-order .settings-select-trigger[role="combobox"]';
      const readSurface = () => evaluate(`(()=>{
        const trigger=document.querySelector(${JSON.stringify(triggerSelector)});
        const select=document.querySelector('.playback-order select');
        const menu=[...document.querySelectorAll('#music-playback .settings-select-menu')].find(item=>item.getAttribute('aria-label')===select?.getAttribute('aria-label'));
        if(!trigger||!select||!menu)return null;
        const style=getComputedStyle(menu),button=getComputedStyle(trigger),rect=menu.getBoundingClientRect();
        return {theme:fixture.stage.dataset.theme,design:fixture.preferences.style.design,trigger:button.backgroundColor,triggerColor:button.color,
          menu:style.backgroundColor,menuColor:style.color,border:style.borderColor,shadow:style.boxShadow,
          visible:!menu.hidden&&menu.getClientRects().length>0&&rect.width>0&&rect.height>0,
          expanded:trigger.getAttribute('aria-expanded'),triggerAria:trigger.getAttribute('aria-label'),
          selectAria:select.getAttribute('aria-label'),menuAria:menu.getAttribute('aria-label'),
          value:select.value,label:trigger.querySelector('.settings-select-value')?.textContent,
          selected:[...menu.querySelectorAll('[role="option"]')].filter(option=>option.getAttribute('aria-selected')==='true').map(option=>option.textContent.trim())};
      })()`);
      const optionIndex = async value => evaluate(`(()=>{const select=document.querySelector('.playback-order select');const index=[...select.options].findIndex(option=>option.value===${JSON.stringify(value)});return {index,count:select.options.length};})()`);

      await setTheme('day');
      await click(triggerSelector);
      const dayOpen = await readSurface();
      assert.ok(dayOpen?.visible, 'ORDER menu should be visibly open in day mode.');
      assert.equal(dayOpen.expanded, 'true');
      assert.equal(dayOpen.triggerAria, 'Playback order');
      assert.equal(dayOpen.selectAria, 'Playback order');
      assert.equal(dayOpen.menuAria, 'Playback order');
      await screenshot('order-day-open', '#music-playback .settings-select-menu');
      const repeatTrack = await optionIndex('repeat-track');
      assert.equal(repeatTrack.count, orderValues.length);
      assert.ok(repeatTrack.index >= 0);
      await evaluate(`(()=>{const select=document.querySelector('.playback-order select'),menu=[...document.querySelectorAll('#music-playback .settings-select-menu')].find(item=>item.getAttribute('aria-label')===select.getAttribute('aria-label'));menu.querySelectorAll('[role="option"]')[${repeatTrack.index}].click();})()`);
      await paint();
      let selected = await evaluate(`(()=>({value:document.querySelector('.playback-order select').value,order:fixture.state.playbackOrder,
        label:document.querySelector('.playback-order .settings-select-trigger .settings-select-value')?.textContent,
        selected:[...document.querySelectorAll('#music-playback .settings-select-menu [role="option"]')].filter(option=>option.getAttribute('aria-selected')==='true').map(option=>option.textContent.trim())}))()`);
      assert.equal(selected.value, 'repeat-track');
      assert.equal(selected.order, 'repeat-track', 'The real playback-order callback must receive the selection.');
      assert.match(selected.label, /REPEAT TRACK/i);
      assert.equal(selected.selected.length, 1);

      await evaluate(`(()=>{const trigger=document.querySelector(${JSON.stringify(triggerSelector)});trigger.focus();trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);
      await paint();
      selected = await evaluate(`(()=>({value:document.querySelector('.playback-order select').value,order:fixture.state.playbackOrder,
        selected:[...document.querySelectorAll('#music-playback .settings-select-menu [role="option"]')].filter(option=>option.getAttribute('aria-selected')==='true').map(option=>option.textContent.trim())}))()`);
      assert.equal(selected.value, 'random');
      assert.equal(selected.order, 'random');
      assert.equal(selected.selected.length, 1);

      await click(triggerSelector);
      await evaluate(`(()=>document.querySelector(${JSON.stringify(triggerSelector)}).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))()`);
      let closed = await readSurface();
      assert.equal(closed.expanded, 'false', 'Escape must close ORDER.');
      assert.equal(closed.visible, false);

      await click(triggerSelector);
      await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true}))`);
      closed = await readSurface();
      assert.equal(closed.expanded, 'false', 'An outside pointer press must close ORDER.');
      assert.equal(closed.visible, false);

      await setTheme('night');
      await click(triggerSelector);
      const nightOpen = await readSurface();
      assert.ok(nightOpen?.visible, 'ORDER menu should be visibly open in night mode.');
      assert.equal(nightOpen.expanded, 'true');
      assert.equal(nightOpen.theme, 'night');
      assert.ok(dayOpen.menu !== nightOpen.menu || dayOpen.menuColor !== nightOpen.menuColor || dayOpen.border !== nightOpen.border,
        `ORDER surface must use the night palette: ${JSON.stringify({ dayOpen, nightOpen })}`);
      await screenshot('order-night-open', '#music-playback .settings-select-menu');
      await evaluate(`(()=>document.querySelector(${JSON.stringify(triggerSelector)}).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))()`);

      await fixtureCall('switchDesign', 'rhine');
      await waitFor(`fixture.preferences.style.design==='rhine'&&fixture.stage.dataset.design==='rhine'`, 'Future design for ORDER palette checks');
      const futureSnapshots = [];
      for (const theme of ['day', 'night']) {
        await setTheme(theme);
        await click(triggerSelector);
        const surface = await readSurface();
        assert.ok(surface?.visible, `Future ORDER menu should be open in ${theme} mode.`);
        assert.equal(surface.design, 'rhine');
        assert.equal(surface.theme, theme);
        assert.equal(surface.expanded, 'true');
        await screenshot(`order-future-${theme}-open`, '#music-playback .settings-select-menu');
        futureSnapshots.push(surface);
        await evaluate(`(()=>document.querySelector(${JSON.stringify(triggerSelector)}).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))()`);
      }
      assert.ok(futureSnapshots[0].menu !== futureSnapshots[1].menu || futureSnapshots[0].menuColor !== futureSnapshots[1].menuColor || futureSnapshots[0].border !== futureSnapshots[1].border,
        `Future ORDER menu must use both global palettes: ${JSON.stringify(futureSnapshots)}`);
      return { day: dayOpen, night: nightOpen, future: futureSnapshots, selectedOrder: selected.value };
    });

    await runCase('Theme page: compact previews render in both themes and select the real design', async () => {
      const snapshots = [];
      for (const theme of ['day', 'night']) {
        await setTheme(theme);
        await fixtureCall('renderProductionStylePage', await evaluate(`fixture.preferences.style.design`), true);
        await paint();
        const before = await evaluate(`(()=>{
          const cards=[...document.querySelectorAll('#theme-page-content .design-family-card[data-style-design]')];
          return cards.map(card=>{const preview=card.querySelector('.theme-choice-preview');if(!preview)return{design:card.dataset.styleDesign,missing:true};
            const s=getComputedStyle(preview),r=preview.getBoundingClientRect(),cardRect=card.getBoundingClientRect();
            const name=card.querySelector('.theme-choice-copy strong'),description=card.querySelector('.theme-choice-copy small');
            const nameRect=name?.getBoundingClientRect(),descriptionRect=description?.getBoundingClientRect();
            const previewStyle=card.dataset.styleDesign===fixture.preferences.style.design?fixture.normalizeMusicStyle(fixture.preferences.style):
              card.dataset.styleDesign==='rhine'?fixture.defaultMusicStyle:fixture.archiveMusicStyle;
            const expectedPalette=fixture.stylePalette(previewStyle,${JSON.stringify(theme)});
            return{design:card.dataset.styleDesign,previewDesign:preview.dataset.previewDesign,mode:preview.dataset.previewMode,
              pressed:card.getAttribute('aria-pressed'),visible:r.width>0&&r.height>0,
              width:r.width,height:r.height,cardWidth:cardRect.width,cardHeight:cardRect.height,
              background:s.backgroundColor,miniBg:s.getPropertyValue('--mini-bg').trim(),expectedBg:expectedPalette.bg,
              color:s.color,border:s.borderColor,text:preview.textContent.trim().slice(0,100),
              name:name?.textContent.trim()||'',description:description?.textContent.trim()||'',
              nameRect:nameRect?.toJSON()??null,descriptionRect:descriptionRect?.toJSON()??null,
              nameDescriptionGap:nameRect&&descriptionRect?descriptionRect.top-nameRect.bottom:null};});
        })()`);
        assert.equal(before.length, 2, 'Theme page must offer Future and Punk cards.');
        assert.ok(before.every(item=>!item.missing&&item.visible), `Both compact previews must be painted: ${JSON.stringify(before)}`);
        assert.ok(before.every(item=>item.previewDesign===item.design&&item.mode===theme),
          `Each compact preview must use the active design and global ${theme} mode: ${JSON.stringify(before)}`);
        assert.ok(before.every(item=>item.miniBg===item.expectedBg),
          `Each preview must use the production palette for ${theme}: ${JSON.stringify(before)}`);
        assert.ok(before.every(item=>item.background!=='rgba(0, 0, 0, 0)'&&item.color!=='rgba(0, 0, 0, 0)'),
          `Each preview must paint its palette: ${JSON.stringify(before)}`);
        assert.ok(before.every(item=>item.width <= item.cardWidth+1 && item.height <= item.cardHeight+1), `Previews must stay compact within their cards: ${JSON.stringify(before)}`);
        assert.ok(before.every(item=>item.name&&item.description&&item.nameRect?.height>0&&item.descriptionRect?.height>0&&item.nameDescriptionGap>=-1),
          `Theme family names and descriptions must paint on separate non-overlapping lines in ${theme}: ${JSON.stringify(before)}`);
        if (theme === 'day') await screenshot('theme-preview-day', '#theme-page-content .design-family-grid');
        else await screenshot('theme-preview-night', '#theme-page-content .design-family-grid');

        const current = await evaluate(`fixture.preferences.style.design`);
        const next = current === 'rhine' ? 'archive' : 'rhine';
        await click(`#theme-page-content .design-family-card[data-style-design="${next}"]`);
        await waitFor(`fixture.preferences.style.design===${JSON.stringify(next)}&&fixture.stage.dataset.design===${JSON.stringify(next)}`, `${next} design card selection`);
        const selected = await evaluate(`(()=>({design:fixture.preferences.style.design,theme:fixture.preferences.theme,
          pressed:document.querySelector('#theme-page-content .design-family-card[data-style-design='+JSON.stringify(${JSON.stringify(next)})+']')?.getAttribute('aria-pressed'),
          previewCount:document.querySelectorAll('#theme-page-content .design-family-card .theme-choice-preview').length}))()`);
        assert.equal(selected.design, next);
        assert.equal(selected.theme, theme);
        assert.equal(selected.pressed, 'true');
        assert.equal(selected.previewCount, 2);
        snapshots.push({ theme, before, selected });
      }
      const day = snapshots.find(item=>item.theme==='day').before;
      const night = snapshots.find(item=>item.theme==='night').before;
      for(const design of ['rhine','archive']){
        const dayPreview=day.find(item=>item.design===design),nightPreview=night.find(item=>item.design===design);
        assert.ok(dayPreview.background!==nightPreview.background||dayPreview.color!==nightPreview.color,
          `${design} compact preview must reflect both day and night palettes: ${JSON.stringify({dayPreview,nightPreview})}`);
      }
      return snapshots;
    });

    await runCase('Design switching: global day/night, legacy profile normalization, view, and quality survive both directions', async () => {
      const snapshots = [];
      for (const theme of ['day', 'night']) {
        await setTheme(theme);
        await evaluate(`(()=>{
          const opposite=${JSON.stringify(theme === 'day' ? 'night' : 'day')};
          fixture.designProfiles.rhine={style:structuredClone(fixture.defaultMusicStyle),mode:opposite};
          fixture.designProfiles.archive={style:structuredClone(fixture.archiveMusicStyle),mode:opposite};
          fixture.musicApplication.view=Object.freeze({...fixture.musicApplication.view,layout:'grid',show:'tracks',group:'artist',sort:'added'});
          fixture.preferences.view=fixture.musicApplication.view;
          fixture.preferences.quality='original';
          fixture.preferences.renderQuality={marker:'retain-render-quality',scale:1.25,pixelRatio:2};
          fixture.processingSettings.qualityMarker='retain-audio-processing';
          fixture.preferences.output.processing=fixture.processingSettings;
        })()`);
        const before = await evaluate(`(()=>({view:{...fixture.musicApplication.view},quality:fixture.preferences.quality,
          renderQuality:structuredClone(fixture.preferences.renderQuality),processing:structuredClone(fixture.preferences.output.processing)}))()`);
        const startDesign = await evaluate(`fixture.preferences.style.design`);
        const firstDesign = startDesign === 'rhine' ? 'archive' : 'rhine';
        await fixtureCall('setPage', 'music');
        await click('.playback-order .settings-select-trigger[role="combobox"]');
        assert.equal(await evaluate(`document.querySelector('.playback-order .settings-select-trigger')?.getAttribute('aria-expanded')`), 'true');
        await fixtureCall('switchDesign', firstDesign);
        await paint();
        assert.equal(await evaluate(`document.querySelector('.playback-order .settings-select-trigger')?.getAttribute('aria-expanded')`), 'false',
          'Switching design should close the open ORDER menu through its playback control handle.');
        let current = await readTheme();
        assert.equal(current.design, firstDesign);
        assert.equal(current.theme, theme, `Switching to ${firstDesign} must preserve global ${theme}.`);
        assert.equal(current.stage, theme);
        await fixtureCall('switchDesign', startDesign);
        await paint();
        current = await readTheme();
        assert.equal(current.design, startDesign);
        assert.equal(current.theme, theme, `Switching back to ${startDesign} must preserve global ${theme}.`);

        const normalized = await evaluate(`fixture.normalizeDesignProfiles(
          {rhine:{style:fixture.defaultMusicStyle,mode:${JSON.stringify(theme === 'day' ? 'night' : 'day')}},
           archive:{style:fixture.archiveMusicStyle,mode:${JSON.stringify(theme === 'day' ? 'night' : 'day')}}},
          fixture.preferences.style,${JSON.stringify(theme)})`);
        assert.equal(normalized.rhine.mode, theme, 'Restart normalization must replace an old Rhine profile mode with the global mode.');
        assert.equal(normalized.archive.mode, theme, 'Restart normalization must replace an old Archive profile mode with the global mode.');
        assert.equal(normalized.rhine.style.design, 'rhine');
        assert.equal(normalized.archive.style.design, 'archive');

        const after = await evaluate(`(()=>({view:{...fixture.musicApplication.view},quality:fixture.preferences.quality,
          renderQuality:structuredClone(fixture.preferences.renderQuality),processing:structuredClone(fixture.preferences.output.processing)}))()`);
        assert.deepEqual(after.view, before.view, 'Switching designs must preserve the shared audio view.');
        assert.equal(after.quality, before.quality);
        assert.deepEqual(after.renderQuality, before.renderQuality);
        assert.deepEqual(after.processing, before.processing);
        snapshots.push({ theme, startDesign, firstDesign, before, after });
      }
      return snapshots;
    });

    await runCase('Lyrics profile, queue, and preview factory follow the currently playing album', async () => {
      await setTheme('night');
      await fixtureCall('switchDesign', 'archive');
      await paint();
      await fixtureCall('setPage', 'lyrics');
      await evaluate(`fixture.lyricsController.setVisible(true)`);
      await waitFor(`document.querySelector('.lyrics-line.is-active .lyrics-line-text')&&fixture.lyricsController.currentLine()==='Current fixture lyric'`, 'mock lyric line');
      const first = await evaluate(`(()=>{
        const profile=document.querySelector('.lyrics-archive-profile');
        const frame=profile?.querySelector('.lyrics-archive-cover-frame');
        const album=profile?.querySelector('.lyrics-archive-loaded-value')?.textContent||'';
        const ordinal=profile?.querySelector('.lyrics-archive-table-heading span:last-child')?.textContent||'';
        const queue=[...profile?.querySelectorAll('.lyrics-archive-queue-list .lyrics-queue-row')||[]].map(row=>row.dataset.track);
        const line=document.querySelector('.lyrics-line.is-active .lyrics-line-text');
        const factory=fixture.casePreviewFactoryCalls.at(-1),binding=factory?.options?.getAlbum?.(),factoryState=factory?.lastState;
        return{visible:!!profile&&profile.getClientRects().length>0,frame:!!frame,album,ordinal,queue,
          line:line?.textContent||'',boundAlbum:binding?.record?.album?.id||binding?.record?.id||binding?.album?.id||binding?.id,
          factoryCount:fixture.casePreviewFactoryCalls.length,factoryVisible:factory?.visible,
          factoryRefreshCalls:factory?.refreshCalls||0,
          factoryTheme:factoryState?.theme,factoryDesign:factoryState?.design,factoryQuality:factoryState?.quality?.marker,
          factoryHost:factory?.host?.className||''};
      })()`);
      assert.equal(first.visible, true, `Punk lyrics should show the right profile: ${JSON.stringify(first)}`);
      assert.equal(first.frame, true);
      assert.match(first.album, /18 Plus/);
      assert.equal(first.ordinal, 'ARC-0001');
      assert.equal(first.line, 'Current fixture lyric');
      assert.equal(first.boundAlbum, 'fixture-album');
      assert.ok(first.factoryCount > 0, 'The production createCasePreview callback must create the mocked factory.');
      assert.equal(first.factoryVisible, true);
      assert.ok(first.factoryRefreshCalls > 0);
      assert.equal(first.factoryTheme, 'night');
      assert.equal(first.factoryDesign, 'archive');
      assert.equal(first.factoryQuality, 'fixture-render-quality');
      assert.match(first.factoryHost, /case|preview/i);
      await click('.lyrics-settings-gear');
      await waitFor(`document.querySelector('#lyrics-options-dialog')&&!document.querySelector('#lyrics-options-dialog').hidden`, 'English lyrics options dialog');
      const lyricsOptions = await evaluate(`(()=>({title:document.querySelector('#lyrics-preference-title')?.textContent||'',
        close:document.querySelector('.lyrics-preference-close')?.getAttribute('aria-label')||'',
        tabs:document.querySelector('.lyrics-dialog-tabs')?.getAttribute('aria-label')||'',
        source:document.querySelector('.lyrics-source-select')?.getAttribute('aria-label')||'',
        fields:[...document.querySelectorAll('.lyrics-query-input')].map(field=>field.getAttribute('aria-label'))}))()`);
      assert.equal(lyricsOptions.title, 'Lyrics options');
      assert.equal(lyricsOptions.close, 'Close lyrics options');
      assert.equal(lyricsOptions.tabs, 'Lyrics source');
      assert.equal(lyricsOptions.source, 'Choose which lyrics sources to use for this search');
      assert.deepEqual(lyricsOptions.fields, ['Search title', 'Search artist', 'Search album']);
      await click('.lyrics-preference-close');
      await waitFor(`document.querySelector('#lyrics-options-dialog').hidden`, 'lyrics options close');
      await screenshot('lyrics-profile-first-album', '.lyrics-archive-profile');

      await evaluate(`(()=>{
        const first=fixture.records[0].album;
        const next=fixture.records[1].album;
        const currentTrack={id:'fixture-track-3',albumId:next.id,title:'Other Album Current',artist:next.artist,format:'FLAC',codec:'FLAC',relativePath:'fixture-next.flac',sampleRate:96000,bitsPerSample:24,numberOfChannels:2,bitrate:2200000,lossless:true,trackNumber:1,duration:180};
        const nextTrack={id:'fixture-track-3-next',albumId:next.id,title:'Other Album Next',artist:next.artist,format:'FLAC',codec:'FLAC',relativePath:'fixture-next-2.flac',sampleRate:96000,bitsPerSample:24,numberOfChannels:2,bitrate:2200000,lossless:true,trackNumber:2,duration:190};
        next.tracks=[currentTrack,nextTrack];
        fixture.musicApplication.selectedAlbumId=first.id;
        fixture.updatePlayback({...fixture.state,currentTrack,queue:[currentTrack,nextTrack],currentIndex:0,currentTime:0,duration:180});
      })()`);
      await waitFor(`fixture.lyricsController.currentLine()==='Current fixture lyric'&&document.querySelector('.lyrics-archive-loaded-value')?.textContent.includes('Other Album')`, 'lyrics profile refresh for playing album');
      await paint();
      const second = await evaluate(`(()=>{const factory=fixture.casePreviewFactoryCalls.at(-1),binding=factory?.options?.getAlbum?.(),factoryState=factory?.lastState;return{selectedAlbum:fixture.musicApplication.selectedAlbumId,
        loaded:document.querySelector('.lyrics-archive-loaded-value')?.textContent||'',
        ordinal:document.querySelector('.lyrics-archive-table-heading span:last-child')?.textContent||'',
        title:document.querySelector('.lyrics-archive-title')?.textContent||'',
        queue:[...document.querySelectorAll('.lyrics-archive-queue-list .lyrics-queue-row')].map(row=>({track:row.dataset.track,title:row.querySelector('.lyrics-queue-title')?.textContent})),
        boundAlbum:binding?.record?.album?.id||binding?.record?.id||binding?.album?.id||binding?.id,
        factoryAlbum:factory?.lastAlbumId,
        factoryTheme:factoryState?.theme,factoryDesign:factoryState?.design,
        factoryVisible:factory?.visible,
        factoryRefreshCalls:factory?.refreshCalls||0,
        caseFrame:document.querySelector('.lyrics-case-preview')?.getAttribute('data-case-preview-state')||''};})()`);
      assert.equal(second.selectedAlbum, 'fixture-album', 'Catalog selection remains on the first album for this binding check.');
      assert.match(second.loaded, /Other Album/);
      assert.equal(second.ordinal, 'ARC-0002');
      assert.equal(second.title, 'Other Album Current');
      assert.deepEqual(second.queue.map(item=>item.track), ['fixture-track-3-next']);
      assert.equal(second.boundAlbum, 'fixture-album-2', 'Factory getAlbum must follow the playing track, not catalog selection.');
      assert.equal(second.factoryAlbum, 'fixture-album-2');
      assert.equal(second.factoryTheme, 'night');
      assert.equal(second.factoryDesign, 'archive');
      assert.equal(second.factoryVisible, true);
      assert.ok(second.factoryRefreshCalls > first.factoryRefreshCalls);
      await screenshot('lyrics-profile-current-playing-album', '.lyrics-archive-profile');
      return { first, second, lyricsOptions };
    });

    await runCase('Future header removes duplicate transport and bottom stop uses the real action callback', async () => {
      await fixtureCall('setPage', 'music');
      const before = await evaluate(`(()=>({headerPlay:document.querySelectorAll('header #play-pause, .music-header #play-pause, #play-pause').length,
        headerStop:document.querySelectorAll('header #stop-playback, .music-header #stop-playback, #stop-playback').length,
        bottomStop:document.querySelectorAll('#music-playback #playback-stop').length,
        allStops:document.querySelectorAll('[data-action="stop"]').length,
        visible:document.querySelector('#music-playback')?.hidden===false}))()`);
      assert.equal(before.headerPlay, 0);
      assert.equal(before.headerStop, 0);
      assert.equal(before.bottomStop, 1);
      assert.equal(before.allStops, 1);
      assert.equal(before.visible, true);
      const stopCount = await evaluate(`fixture.stopCalls.length`);
      await click('#music-playback #playback-stop');
      await waitFor(`fixture.stopCalls.length===${stopCount + 1}`, 'bottom stop action');
      return { before, stops: await evaluate(`fixture.stopCalls`) };
    });

    await runCase('English i18n: source translations and shared labels across both skins', async () => {
      const language = await evaluate(`(()=>({selected:fixture.i18n.uiLanguage(),stored:fixture.i18n.readUiLanguage(),
        document:document.documentElement.lang,preference:fixture.i18n.fixtureLanguageStorage.get('rhine-ui-language'),
        playbackOrder:fixture.i18n.trUi('播放顺序'),lyricsOptions:fixture.i18n.trUi('歌词选项'),
        lyricsError:fixture.i18n.trUi('歌词来源暂时不可用，可重新匹配或手动查找。')}))()`);
      assert.equal(language.selected, 'en');
      assert.equal(language.stored, 'en');
      assert.equal(language.document, 'en');
      assert.equal(language.preference, 'en');
      assert.equal(language.playbackOrder, 'Playback order');
      assert.equal(language.lyricsOptions, 'Lyrics options');
      assert.equal(language.lyricsError, 'Lyrics sources are temporarily unavailable. Retry or search manually.');

      const themeSnapshots = [];
      for (const theme of ['day', 'night']) {
        await setTheme(theme);
        const design = await evaluate(`fixture.preferences.style.design`);
        await fixtureCall('renderProductionStylePage', design, true);
        await paint();
        const snapshot = await evaluate(`(()=>({theme:fixture.preferences.theme,
          family:[...document.querySelectorAll('#theme-page-content .design-family-card[data-style-design]')].map(card=>({
            design:card.dataset.styleDesign,name:card.querySelector('.theme-choice-copy strong')?.textContent||'',
            description:card.querySelector('.theme-choice-copy small')?.textContent||''})),
          orderSelect:document.querySelector('.playback-order select')?.getAttribute('aria-label')||'',
          orderTrigger:document.querySelector('.playback-order .settings-select-trigger')?.getAttribute('aria-label')||''}))()`);
        assert.equal(snapshot.theme, theme);
        assert.deepEqual(snapshot.family.map(item=>item.name), ['Future', 'Punk']);
        assert.deepEqual(snapshot.family.map(item=>item.description), ['TRANSLUCENT · SPATIAL', 'INSTRUMENT · ARCHIVE']);
        assert.equal(snapshot.orderSelect, language.playbackOrder);
        assert.equal(snapshot.orderTrigger, language.playbackOrder);
        themeSnapshots.push(snapshot);
        if (theme === 'night') await screenshot('theme-english-labels', '#theme-page-content .design-family-grid');
      }
      assert.deepEqual(themeSnapshots[0].family, themeSnapshots[1].family,
        'English family labels must stay identical between day and night skins.');

      const lyricsCase = report.cases.find(item=>item.name.startsWith('Lyrics profile, queue'));
      const lyricsOptions = lyricsCase?.result?.lyricsOptions;
      assert.ok(lyricsOptions, 'The lyrics fixture must record its English options fields.');
      assert.equal(lyricsOptions.title, language.lyricsOptions);
      assert.equal(lyricsOptions.close, 'Close lyrics options');
      assert.equal(lyricsOptions.tabs, 'Lyrics source');
      assert.equal(lyricsOptions.source, 'Choose which lyrics sources to use for this search');
      assert.deepEqual(lyricsOptions.fields, ['Search title', 'Search artist', 'Search album']);

      await fixtureCall('setPage', 'lyrics');
      await evaluate(`fixture.lyricsController.setVisible(false)`);
      await fixtureCall('setPage', 'music');
      return { language, themeSnapshots, lyricsOptions,
        chineseModeDecoration: 'Not exercised; this fixture loads the real i18n module once with the selected English preference.' };
    });

    report.controlsPreflight = await evaluate(`(() => {
      const root = document.querySelector('#music-panel-root');
      if (!document.querySelector('.music-panel-scrim')) {
        const title = fixture.i18n.trUi('在线曲库');
        root.innerHTML = '<div class="music-panel-scrim" data-action="dismiss-panel"><section class="music-panel" role="dialog" aria-modal="true" aria-labelledby="music-panel-title"><div class="panel-heading"><div><small>ONLINE LIBRARY</small><h2 id="music-panel-title">' + title + '</h2></div><button data-action="close-panel" aria-label="' + fixture.i18n.trUi('关闭') + '">×</button></div><div id="panel-body"></div></section></div>';
      }
      const panel = document.querySelector('.music-panel');
      const scrim = document.querySelector('.music-panel-scrim');
      scrim.hidden = true;
      return {
        ids: ['music-settings', 'music-eq-page', 'music-theme-page', 'music-lyrics-page'].map(id => ({ id, count: document.querySelectorAll('#' + id).length })),
        stageChildren: [...fixture.stage.children].map(node => node.id || node.className || node.tagName),
        stageHtmlLength: fixture.stage.innerHTML.length,
        page: fixture.stage.dataset.page,
        panelExists: Boolean(panel),
        scrimExists: Boolean(scrim),
      };
    })()`);
    const { checkUnifiedControls } = await import('./check-unified-controls.mjs');
    const controlsEvaluate = async expression => {
      const value = await evaluate(expression);
      if (typeof expression === 'string' && expression.includes('window.unifiedSettings')) {
        report.controlsSettingsPost = await evaluate(`(() => ({
          nav: document.querySelector('#music-settings .settings-page-nav')?.innerHTML ?? null,
          categories: [...document.querySelectorAll('#settings-page-content > .settings-category')].map(node => ({ id: node.dataset.settingsCategory, hidden: node.hidden })),
          targets: [...document.querySelectorAll('#music-settings [data-settings-category-target]')].map(node => ({ target: node.dataset.settingsCategoryTarget, current: node.getAttribute('aria-current') })),
        }))()`);
      }
      return value;
    };
    await runCase('Future settings, EQ, lighting, and online control states and geometry',
      async () => {
        try {
          return await checkUnifiedControls({ command, evaluate: controlsEvaluate, output, project });
        } catch (error) {
          report.controlsFailureSnapshot = await evaluate(`(() => ({
            nav: document.querySelector('#music-settings .settings-page-nav')?.innerHTML ?? null,
            categories: [...document.querySelectorAll('#settings-page-content > .settings-category')].map(node => ({ id: node.dataset.settingsCategory, hidden: node.hidden })),
            targets: [...document.querySelectorAll('#music-settings [data-settings-category-target]')].map(node => ({ target: node.dataset.settingsCategoryTarget, current: node.getAttribute('aria-current') })),
            range: (() => {
              const node = document.querySelector('#interface-sound-settings input[type="range"]');
              if (!node) return null;
              return { theme: fixture.stage.dataset.design, parent: node.parentElement?.className, section: node.closest('.music-settings-page')?.id,
                appearance: getComputedStyle(node).appearance, trackHeight: getComputedStyle(node, '::-webkit-slider-runnable-track').height,
                trackRules: [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules]; } catch { return []; } })
                  .filter(rule => rule.cssText?.includes('::-webkit-slider-runnable-track') && rule.cssText.includes('future-control'))
                  .map(rule => rule.cssText.slice(0, 240)) };
            })(),
            page: fixture.stage.dataset.page,
            panel: Boolean(document.querySelector('.music-panel-scrim')),
          }))()`);
          throw error;
        }
      });

    await runCase('Initial frontend readiness shows the browse surface without the legacy intro or loader', async () => {
      const source = await readFile(path.join(project, 'src/music-app.ts'), 'utf8');
      assert.match(source, /function\s+showBrowseSurface\(immediate\s*=\s*false\)/,
        'Browse-surface transitions keep their optional immediate path.');
      assert.match(source, /async function start\(\)\s*\{[\s\S]*?showBrowseSurface\(true\);/,
        'Initial startup completes the browse surface immediately after scene readiness.');
      assert.doesNotMatch(source, /\b(?:MusicBoot|FoobarIntro)\b|music-loading|foobar-intro/,
        'The old boot/intro loader hooks are removed from the production app.');
      return { immediateInitialBrowse: true, legacyIntroLoader: false };
    });

    await runCase('Desktop startup gate isolated mock', async () => {
      const script = path.join(project, 'desktop', 'check-hidden-startup.mjs');
      const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8', windowsHide: true, timeout: 30000 });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, `Hidden startup mock failed: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Hidden startup gate mock checks passed/);
      return { status: result.status, output: result.stdout.trim() };
    });

    report.ok = true;
    await writeFile(path.join(output, 'unified-ui-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } catch (error) {
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    await writeFile(path.join(output, 'unified-ui-report.json'), `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
    throw error;
  }
}
