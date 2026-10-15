import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { importRhineProcessingBackup, normalizeProcessing, processingDefault, serializeRhineProcessingBackup, importPowerampPreset } from '../src/audio-processing-model.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runAudioControlsCheck({ browserWindow, waitFor, click, capture, setViewport, presetStoreFile }) {
  const report = { ok: false, checks: {}, screenshots: [], syntheticDataOnly: true, nativeCommandMockOnly: true };
  const evaluate = (source) => browserWindow.webContents.executeJavaScript(source, true);
  const readPersistedPresetStore = async (predicate, label, timeoutMs = 20000) => {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < timeoutMs) {
      try {
        const store = JSON.parse(await readFile(presetStoreFile, 'utf8'));
        if (predicate(store)) return store;
      } catch (error) { lastError = error; }
      await pause(50);
    }
    throw new Error(`Timed out waiting for profile audio preset file: ${label}${lastError ? ` (${lastError.message})` : ''}`);
  };
  const setField = async (field, value) => {
    const selector = `[data-processing-field=${JSON.stringify(field)}]`;
    const changed = await evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node || node.disabled) return false;
      if (node instanceof HTMLInputElement && node.type === 'checkbox') node.checked = ${JSON.stringify(value)};
      else node.value = ${JSON.stringify(String(value))};
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.equal(changed, true, `Could not edit processing control ${field}.`);
  };
  const getState = () => evaluate(`(() => {
    const preferences = JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}');
    const presetStore = JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1') || '{}');
    return {
      page: document.querySelector('#stage')?.dataset.page ?? '',
      category: document.querySelector('#music-settings [data-settings-category-target][aria-current="page"]')?.dataset.settingsCategoryTarget ?? '',
      theme: document.querySelector('#stage')?.dataset.theme ?? '',
      processing: preferences.output?.processing ?? null,
      output: preferences.output ?? null,
      presets: presetStore,
    };
  })()`);
  const openTopLevelPage = async (action, page, label) => {
    const current = await evaluate(`document.querySelector('#stage')?.dataset.page ?? ''`);
    if (current !== page) await click(`.music-topnav [data-action="${action}"]`);
    await waitFor(`document.querySelector('#stage')?.dataset.page === ${JSON.stringify(page)}`, label);
  };
  const openSettingsAudio = async (label = 'audio settings') => {
    await openTopLevelPage('settings', 'settings', `${label}: settings page`);
    const category = await evaluate(`document.querySelector('#music-settings [data-settings-category-target][aria-current="page"]')?.dataset.settingsCategoryTarget ?? ''`);
    if (category !== 'audio') await click('#music-settings [data-settings-category-target="audio"]');
    await waitFor(`document.querySelector('#music-settings [data-settings-category-target="audio"]')?.getAttribute('aria-current') === 'page'`, `${label}: audio category`);
  };
  const openEqPage = async (label = 'EQ page') => {
    await openTopLevelPage('eq', 'eq', label);
    await waitFor(`document.querySelector('#music-eq-page')?.hidden === false && document.querySelector('#music-eq-page')?.inert === false`, `${label} is visible`);
  };
  const assertSettingsHasNoEqOrTone = async (label = 'Settings EQ/Tone placement') => {
    const placement = await evaluate(`(() => { const root=document.querySelector('#music-settings'); return {
      navigation: root.querySelectorAll('[data-audio-settings-target="eq"],[data-audio-settings-target="tone"]').length,
      groups: root.querySelectorAll('#audio-settings-eq,#audio-settings-tone').length,
      fields: root.querySelectorAll('[data-processing-field^="eq."],[data-processing-field^="tone."]').length,
      presetControls: root.querySelectorAll('#processing-presets,#processing-preset-select,[data-processing-presets-slot]').length,
    }; })()`);
    assert.deepEqual(placement, { navigation: 0, groups: 0, fields: 0, presetControls: 0 }, label);
  };
  const assertEqPageControls = async (label = 'EQ page controls', expectedTone = { enabled: false, bassGain: '0', trebleGain: '0' }) => {
    const placement = await evaluate(`(() => { const root=document.querySelector('#music-eq-page'),count=s=>root.querySelectorAll(s).length,value=s=>root.querySelector(s)?.value??null; return {
      presetGroups: count('.eq-preset-disclosure'), presetSelects: count('#processing-preset-select'),
      eqSwitches: count('[data-processing-field="eq.enabled"]'), toneSections: count('#tone-settings'),
      toneSwitches: count('#tone-settings [data-processing-field="tone.enabled"]'),
      bassFields: ['frequency','q','gain'].reduce((n,key)=>n+count('[data-processing-field="tone.bass.'+key+'"]'),0),
      trebleFields: ['frequency','q','gain'].reduce((n,key)=>n+count('[data-processing-field="tone.treble.'+key+'"]'),0),
      bassGain: value('[data-processing-field="tone.bass.gain"]'), trebleGain: value('[data-processing-field="tone.treble.gain"]'),
      toneEnabled: root.querySelector('[data-processing-field="tone.enabled"]')?.checked??null,
      allPresetSelects: document.querySelectorAll('#processing-preset-select').length,
    }; })()`);
    assert.deepEqual(placement, {
      presetGroups: 1, presetSelects: 1, eqSwitches: 1, toneSections: 1, toneSwitches: 1,
      bassFields: 3, trebleFields: 3, bassGain: expectedTone.bassGain, trebleGain: expectedTone.trebleGain,
      toneEnabled: expectedTone.enabled, allPresetSelects: 1,
    }, label);
    return placement;
  };

  try {
    assert(browserWindow && typeof waitFor === 'function' && typeof click === 'function' && typeof capture === 'function',
      'Audio controls check requires the isolated BrowserWindow and settings page helpers.');
    assert.equal(typeof presetStoreFile, 'string', 'Audio controls check requires its isolated profile preset-store path.');
    const backupFixture = normalizeProcessing({
      ...processingDefault,
      eq: { ...processingDefault.eq, enabled: true, name: 'Round-trip EQ' },
      tone: { enabled: true, bass: { frequency: 95, q: 0.8, gain: 2.5 }, treble: { frequency: 9200, q: 0.7, gain: -1.5 } },
      replayGain: { mode: 'protect', source: 'album', preamp: -1.25, noTagPreamp: 0.5 },
      resampling: { ...processingDefault.resampling, mode: 'fixed', rate: 96000, allowedRates: [...processingDefault.resampling.allowedRates, 96000] },
      outputFormat: 's24',
      bufferMs: 250,
    }, { clamp: false });
    const parametricBank = normalizeProcessing({
      ...backupFixture,
      eq: { ...backupFixture.eq, mode: 'parametric', bands: backupFixture.eq.bands.map((band) => ({ ...band, type: 3, q: 0.8 })) },
    }, { clamp: false }).eq;
    const backupJson = serializeRhineProcessingBackup(backupFixture, { graphic: backupFixture.eq, parametric: parametricBank });
    const parsedBackup = importRhineProcessingBackup(backupJson);
    const { tone: fixtureTone, ...fixtureSettings } = backupFixture;
    assert.deepEqual(parsedBackup.settings, fixtureSettings, 'Rhine backup settings did not round-trip.');
    assert.deepEqual(parsedBackup.tone, fixtureTone, 'Rhine backup tone did not round-trip separately.');
    assert.deepEqual(parsedBackup.eqModes, { graphic: backupFixture.eq, parametric: parametricBank }, 'Rhine backup EQ mode banks did not round-trip.');
    const unknownVersion = JSON.parse(backupJson); unknownVersion.schemaVersion = 2;
    assert.throws(() => importRhineProcessingBackup(JSON.stringify(unknownVersion)), /不支持 Rhine 音频设置备份版本/);
    assert.equal(importPowerampPreset(JSON.stringify({
      name: 'Poweramp stays supported', preamp: 0, parametric: false,
      bands: [
        ...[{ type: 0, channels: 0, frequency: 90, q: 0.8, gain: 0, color: 0 }, { type: 1, channels: 0, frequency: 10000, q: 0.6, gain: 0, color: 0 }],
        ...processingDefault.eq.bands,
      ],
    })).eq.mode, 'graphic', 'Poweramp import path changed while adding Rhine backups.');
    report.checks.rhineBackupSerializeParse = true;

    await waitFor(`document.querySelector('#stage')?.dataset.page === 'settings'`, 'audio controls settings page');
    await click('#music-settings [data-settings-category-target="audio"]');
    await waitFor(`document.querySelector('#music-settings [data-settings-category-target="audio"]')?.getAttribute('aria-current') === 'page'`, 'audio settings category');
    await assertSettingsHasNoEqOrTone();

    const profileOriginState = await evaluate(`({ exists: window.rhineDesktop?.audioPresetStoreExists, error: window.rhineDesktop?.audioPresetPersistenceError ?? '' })`);
    assert.deepEqual(profileOriginState, { exists: false, error: '' }, 'Audio preset migration fixture requires a new, healthy desktop profile file.');
    const migrationFixture = {
      schemaVersion: 1,
      activeId: null,
      presets: [{ id: 'legacy-local-eq', name: 'Legacy Local EQ', kind: 'saved', eq: processingDefault.eq, updatedAt: 1 }],
      eqBanks: { graphic: processingDefault.eq },
    };
    await evaluate(`localStorage.setItem('rhine-audio-processing-presets-v1', ${JSON.stringify(JSON.stringify(migrationFixture))})`);
    await evaluate(`location.reload()`).catch(() => {});
    await waitFor(`location.pathname==='/' && document.querySelector('#music-loading')===null && document.querySelector('#three-scene canvas') && document.querySelector('#stage')?.dataset.page==='music'`, 'reload with existing-origin audio preset fixture', 60000);
    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page==='settings'`, 'settings page after local-store migration');
    await click('#music-settings [data-settings-category-target="audio"]');
    await waitFor(`JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1')||'{}').presets?.some(p=>p.id==='legacy-local-eq')`, 'existing-origin audio presets restored after migration');
    const migratedStore = await readPersistedPresetStore((store) => store.presets?.some((preset) => preset.id === 'legacy-local-eq'), 'existing-origin localStorage store migrated to the profile file');
    assert.equal(migratedStore.eqBanks.graphic.bands.length, processingDefault.eq.bands.length, 'Migration lost the existing graphic mode bank.');
    report.checks.existingOriginPresetStoreMigratesToProfile = true;

    await openEqPage('EQ top-level navigation after preset-store migration');
    await assertEqPageControls('EQ page owns one preset group, independent switches, and the default tone values');
    const beforeToneToggle = await getState();
    assert.equal(beforeToneToggle.processing.tone.enabled, false, 'Tone switch must start disabled.');
    assert.equal(beforeToneToggle.processing.tone.bass.gain, 0, 'Default bass gain must be 0 dB.');
    assert.equal(beforeToneToggle.processing.tone.treble.gain, 0, 'Default treble gain must be 0 dB.');
    await setField('tone.enabled', true);
    await waitFor(`JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing?.tone?.enabled===true`, 'independent tone switch enabled');
    const toneEnabledState = await getState();
    assert.deepEqual(toneEnabledState.processing.eq, beforeToneToggle.processing.eq, 'Enabling Tone changed the EQ switch or parameters.');
    await setField('tone.enabled', false);
    await waitFor(`JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing?.tone?.enabled===false`, 'independent tone switch disabled');
    const toneDisabledState = await getState();
    assert.deepEqual(toneDisabledState.processing.eq, beforeToneToggle.processing.eq, 'Disabling Tone changed the EQ switch or parameters.');
    report.checks.toneSwitchIsIndependentOfEq = true;

    const graphicAudit = await evaluate(`(() => {
      const mode = document.querySelector('#processing-eq-controls [data-processing-field="eq.mode"]');
      const bandwidth = document.querySelector('#processing-eq-controls [data-processing-field="eq.bandwidth"]');
      return {
        mode: mode?.value ?? '',
        bandwidthType: bandwidth?.type ?? '',
        bandwidthMin: bandwidth?.min ?? '',
        bandwidthMax: bandwidth?.max ?? '',
        bandwidthValue: bandwidth?.value ?? '',
        bandCount: document.querySelectorAll('#processing-eq-controls [data-eq-band-card]').length,
        firstBand: document.querySelector('#processing-eq-controls [data-processing-field="eq.bands.0.gain"]')?.value ?? '',
        fixedFrequency: !document.querySelector('#processing-eq-controls [data-processing-field="eq.bands.0.frequency"]'),
        noBandQ: !document.querySelector('#processing-eq-controls [data-processing-field="eq.bands.0.q"]'),
        sliderBank: !!document.querySelector('#processing-eq-controls .eq-graphic-bank'),
      };
    })()`);
    assert.equal(graphicAudit.mode, 'graphic', 'The default EQ mode is not graphic.');
    assert.equal(graphicAudit.bandwidthType, 'range', 'Graphic bandwidth is not a slider.');
    assert.equal(graphicAudit.bandwidthMin, '0.5');
    assert.equal(graphicAudit.bandwidthMax, '2');
    assert.equal(graphicAudit.bandwidthValue, '1');
    assert.equal(graphicAudit.bandCount, 10, 'The default graphic EQ does not contain ten bands.');
    assert.equal(graphicAudit.fixedFrequency, true, 'Graphic EQ must not expose parametric frequency editing.');
    assert.equal(graphicAudit.noBandQ, true, 'Graphic EQ must use its common bandwidth control.');
    assert.equal(graphicAudit.sliderBank, true, 'Graphic EQ must show its fixed-band gain slider bank.');

    if (typeof setViewport === 'function') await setViewport(1280, 840);
    await click('.music-header .theme-switch [data-theme="day"]');
    await waitFor(`document.querySelector('#stage')?.dataset.theme === 'day'`, 'warm day theme');
    report.screenshots.push(await capture('audio-eq-1280x840-day.png'));
    await click('.music-header .theme-switch [data-theme="night"]');
    await waitFor(`document.querySelector('#stage')?.dataset.theme === 'night'`, 'night theme');
    report.screenshots.push(await capture('audio-eq-1280x840-night.png'));
    await click('.music-header .theme-switch [data-theme="day"]');
    await waitFor(`document.querySelector('#stage')?.dataset.theme === 'day'`, 'restore day theme after EQ capture');
    await evaluate(`document.querySelector('#processing-eq-controls .eq-response-figure')?.scrollIntoView({block:'center',behavior:'instant'})`);
    await waitFor(`(() => { const figure=document.querySelector('#processing-eq-controls .eq-response-figure'); const content=document.querySelector('#eq-page-content'); if(!figure||!content) return false; const a=figure.getBoundingClientRect(), b=content.getBoundingClientRect(); return a.top>=b.top-1 && a.bottom<=b.bottom+1; })()`, 'EQ response chart in view');
    report.screenshots.push(await capture('audio-eq-response-1280x840-day.png'));
    await click('.music-header .theme-switch [data-theme="night"]');
    await waitFor(`document.querySelector('#stage')?.dataset.theme === 'night'`, 'night theme for EQ response chart');
    report.screenshots.push(await capture('audio-eq-response-1280x840-night.png'));
    await click('.music-header .theme-switch [data-theme="day"]');
    await waitFor(`document.querySelector('#stage')?.dataset.theme === 'day'`, 'restore day theme after EQ response chart');
    assert(await evaluate(`document.querySelector('#processing-eq-controls .eq-response-figure figcaption')?.textContent.includes('48 kHz 默认参考')`),
      'Idle EQ curve does not identify its 48 kHz default reference.');

    await setField('eq.bands.0.gain', 4.25);
    await waitFor(`Math.abs(Number(JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}').output?.processing?.eq?.bands?.[0]?.gain) - 4.25) < 0.001`, 'graphic EQ gain saved');
    await setField('eq.mode', 'parametric');
    await waitFor(`document.querySelector('#processing-eq-controls [data-processing-field="eq.mode"]')?.value === 'parametric'`, 'switch to parametric EQ');
    const parametricAudit = await evaluate(`(() => ({
      bandwidth: !!document.querySelector('#processing-eq-controls [data-processing-field="eq.bandwidth"]'),
      q: document.querySelector('#processing-eq-controls [data-processing-field="eq.bands.0.q"]')?.type ?? '',
      qDisabled: document.querySelector('#processing-eq-controls [data-processing-field="eq.bands.0.q"]')?.disabled ?? true,
    }))()`);
    assert.equal(parametricAudit.bandwidth, false, 'Graphic bandwidth remains visible in parametric mode.');
    assert.equal(parametricAudit.q, 'number', 'Parametric band Q is not editable.');
    assert.equal(parametricAudit.qDisabled, false, 'Parametric band Q is disabled.');
    report.checks.graphicAndParametricControlsAreDistinct = true;

    assert.equal(await evaluate(`document.querySelectorAll('#processing-eq-controls [data-eq-node]').length`), 0,
      'Parametric preview must not contain editable graph handles.');
    const beforePreviewEdit = await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('rhine-music-preferences')).output.processing.eq)`);
    await evaluate(`(() => { const svg=document.querySelector('#processing-eq-controls .eq-response-chart'); svg.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:43,clientX:500,clientY:400})); svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:43,clientX:650,clientY:320})); svg.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:43})); })()`);
    assert.equal(await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('rhine-music-preferences')).output.processing.eq)`), beforePreviewEdit,
      'Pointer interaction with the parametric preview changed EQ settings.');
    report.checks.parametricPreviewIsReadOnly = true;

    const previousResponse = await evaluate(`document.querySelector('[data-eq-band-response="0"]')?.getAttribute('d')`);
    await setField('eq.bands.0.frequency', 1500);
    await setField('eq.bands.0.gain', 9);
    await setField('eq.bands.0.q', 0.72);
    await setField('eq.bands.1.type', 5);
    await setField('eq.bands.1.frequency', 8000);
    await setField('eq.bands.1.gain', -3.8);
    await waitFor(`document.querySelector('[data-eq-band-response="0"]')?.getAttribute('d') !== ${JSON.stringify(previousResponse)}`, 'individual response updates while EQ is disabled');
    assert(await evaluate(`document.querySelector('.eq-response-figure figcaption')?.textContent.includes('均衡器已关闭')`), 'Disabled EQ preview is not labelled.');
    await evaluate(`document.querySelector('[data-eq-dial="q"][data-band-index="0"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))`);
    await waitFor(`JSON.parse(localStorage.getItem('rhine-music-preferences')).output.processing.eq.bands[0].q>0.72`, 'Q dial keyboard adjustment');
    report.checks.individualCurvesAndDialsUpdate = true;

    if (typeof setViewport === 'function') {
      await setViewport(1920, 1080);
      await evaluate(`document.querySelector('#processing-eq-controls .eq-workspace').scrollIntoView({block:'start',behavior:'instant'})`);
      await waitFor(`(() => { const strip=document.querySelector('.eq-parametric-strip'), figure=document.querySelector('.eq-response-figure'), content=document.querySelector('#eq-page-content'); if(!strip||!figure||!content)return false; const a=strip.getBoundingClientRect(),b=figure.getBoundingClientRect(),c=content.getBoundingClientRect(); return a.top>=c.top-2 && a.bottom<=b.top+2 && b.bottom<=c.bottom+2; })()`, 'parameter strip and response fit together in the fullscreen-sized viewport');
      const fullLayout = await evaluate(`(() => { const strip=document.querySelector('.eq-parametric-strip'), content=document.querySelector('#eq-page-content'), page=document.querySelector('#music-eq-page'), cards=[...strip.querySelectorAll('[data-eq-band-card]')]; return {width:content.clientWidth,rightGap:page.getBoundingClientRect().right-content.getBoundingClientRect().right,singleRow:cards.every(card=>Math.abs(card.getBoundingClientRect().top-cards[0].getBoundingClientRect().top)<1),overflow:strip.scrollWidth>strip.clientWidth}; })()`);
      assert(fullLayout.width>1400 && fullLayout.rightGap<16, 'Fullscreen settings retained the narrow content cap.');
      assert(fullLayout.singleRow && fullLayout.overflow, 'Parametric cards do not form one scrollable horizontal strip.');
      await evaluate(`(() => { const range=document.querySelector('[data-eq-strip-scroll]'); range.value='850'; range.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await waitFor(`document.querySelector('.eq-parametric-strip').scrollLeft>0`, 'horizontal browsing slider');
      await evaluate(`(() => { const range=document.querySelector('[data-eq-strip-scroll]'); range.value='0'; range.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      report.screenshots.push(await capture('audio-parametric-1920x1080-day.png'));
      await click('.music-header .theme-switch [data-theme="night"]');
      await waitFor(`document.querySelector('#stage')?.dataset.theme==='night'`, 'night parametric preview');
      report.screenshots.push(await capture('audio-parametric-1920x1080-night.png'));
      await click('.music-header .theme-switch [data-theme="day"]');
      await setViewport(1280, 840);
      report.checks.fullWidthHorizontalParametricWorkspace = true;
    }

    await setField('eq.bands.0.type', 0);
    await setField('eq.bands.0.frequency', 60);
    await setField('eq.bands.0.q', 0.8);
    await setField('eq.mode', 'graphic');
    await waitFor(`(() => { const p=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing; return p?.eq?.mode==='graphic' && Math.abs(p.eq.bands[0].gain-4.25)<0.001 && p.eq.bands[0].frequency===31; })()`, 'restore the graphic EQ mode bank');
    await setField('eq.mode', 'parametric');
    await waitFor(`(() => { const p=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing; return p?.eq?.mode==='parametric' && p.eq.bands[0].type===0 && p.eq.bands[0].frequency===60 && Math.abs(p.eq.bands[0].q-0.8)<0.001; })()`, 'restore the parametric EQ mode bank');
    report.checks.modeBanksRoundTrip = true;

    await pause(300);
    await evaluate(`location.reload()`).catch(() => {});
    await waitFor(`location.pathname==='/' && document.querySelector('#music-loading')===null && document.querySelector('#three-scene canvas') && document.querySelector('#stage')?.dataset.page==='music'`, 'EQ mode bank reload', 60000);
    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page==='settings'`, 'settings page after EQ bank reload');
    await click('#music-settings [data-settings-category-target="audio"]');
    await waitFor(`(() => { const p=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing; const b=JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1')||'{}').eqBanks; return p?.eq?.mode==='parametric' && p.eq.bands[0]?.type===0 && b?.graphic?.bands?.[0]?.frequency===31 && b?.graphic?.bands?.[0]?.gain>4.2 && b?.parametric?.bands?.[0]?.q===0.8; })()`, 'both EQ mode banks restored after reload');
    report.checks.modeBanksSurviveReload = true;
    await assertSettingsHasNoEqOrTone('Settings remains free of EQ/Tone controls after EQ state reload');
    await openEqPage('EQ page after mode-bank reload');
    await assertEqPageControls('EQ controls and presets are mounted on the EQ page after reload');

    const presetNamed = await evaluate(`(() => { const n=document.querySelector('#processing-preset-name'); if(!n) return false; n.value='Audio Core EQ'; n.dispatchEvent(new Event('input',{bubbles:true})); n.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    assert.equal(presetNamed, true, 'Could not enter the EQ preset name.');
    await click('[data-processing-preset-action="save-as"]');
    await waitFor(`JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1')||'{}').presets?.some(p=>p.kind==='saved'&&p.name==='Audio Core EQ'&&p.eq?.mode==='parametric')`, 'named EQ preset saved');
    const savedPreset = await evaluate(`(() => JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1')||'{}').presets.find(p=>p.kind==='saved'&&p.name==='Audio Core EQ'))()`);
    assert(savedPreset?.eq?.bands?.length, 'Named EQ preset did not retain its bands.');
    await setField('eq.bands.0.frequency', 81);
    await setField('tone.enabled', true);
    await setField('tone.bass.frequency', 130);
    await setField('tone.bass.q', 0.9);
    await setField('tone.bass.gain', 3.5);
    await setField('tone.treble.frequency', 9200);
    await setField('tone.treble.q', 0.75);
    await setField('tone.treble.gain', -1.5);
    const toneBeforePageRoundTrip = await getState();
    await openSettingsAudio('ReplayGain control remains in Settings');
    await assertSettingsHasNoEqOrTone();
    await setField('replayGain.mode', 'gain');
    await setField('replayGain.source', 'album');
    await setField('replayGain.preamp', 1.25);
    await waitFor(`(() => { const p=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing; return p?.tone?.enabled===true && p.replayGain?.mode==='gain' && p.replayGain?.source==='album' && Math.abs(p.replayGain.preamp-1.25)<0.001; })()`, 'local tone and ReplayGain state saved');
    await openEqPage('return to EQ after editing ReplayGain in Settings');
    const toneAfterPageRoundTrip = await getState();
    assert.deepEqual(toneAfterPageRoundTrip.processing.tone, toneBeforePageRoundTrip.processing.tone, 'EQ page navigation changed Tone values.');
    assert.deepEqual(toneAfterPageRoundTrip.processing.eq, toneBeforePageRoundTrip.processing.eq, 'EQ page navigation changed EQ values.');
    const visibleToneAfterRoundTrip = await evaluate(`(() => ({
      enabled: document.querySelector('#tone-settings [data-processing-field="tone.enabled"]')?.checked ?? null,
      bass: [...document.querySelectorAll('#tone-settings [data-processing-field^="tone.bass."]')].map(n=>n.value),
      treble: [...document.querySelectorAll('#tone-settings [data-processing-field^="tone.treble."]')].map(n=>n.value),
    }))()`);
    assert.deepEqual(visibleToneAfterRoundTrip, { enabled: true, bass: ['130', '0.9', '3.5'], treble: ['9200', '0.75', '-1.5'] }, 'Re-rendered EQ page did not show saved Tone values.');
    report.checks.toneValuesSurviveEqSettingsNavigation = true;
    const stateBeforePresetApply = await getState();
    await evaluate(`(() => { const s=document.querySelector('#processing-preset-select'); const p=JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1')||'{}').presets.find(p=>p.name==='Audio Core EQ'); if(!s||!p) return false; s.value=p.id; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    await waitFor(`(() => { const p=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing; return p?.eq?.bands?.[0]?.frequency===60 && p?.tone?.bass?.frequency===130 && p?.replayGain?.source==='album'; })()`, 'EQ preset application preserves local tone and ReplayGain');
    const stateAfterPresetApply = await getState();
    assert.deepEqual(stateAfterPresetApply.processing.tone, stateBeforePresetApply.processing.tone, 'EQ preset application changed the local tone settings.');
    assert.deepEqual(stateAfterPresetApply.processing.replayGain, stateBeforePresetApply.processing.replayGain, 'EQ preset application changed the local ReplayGain settings.');
    for (const key of ['backend', 'device', 'channel', 'wasapiDevice', 'wasapiMode', 'wasapiDsdMode']) {
      assert.equal(stateAfterPresetApply.output[key], stateBeforePresetApply.output[key], `EQ preset application changed output setting ${key}.`);
    }
    report.checks.eqPresetDoesNotReplaceLocalSettings = true;

    await setField('tone.enabled', false);
    await setField('tone.bass.frequency', 120);
    await setField('tone.bass.q', 0.9);
    await setField('tone.bass.gain', -1.2);
    const importedFixture = {
      name: 'Audio Core Poweramp Fixture',
      preamp: 0,
      parametric: false,
      bands: [
        { type: 0, channels: 0, frequency: 90, q: 0.8, gain: 2.5, color: 0 },
        { type: 1, channels: 0, frequency: 10000, q: 0.6, gain: -3.5, color: 0 },
        ...[31, 62, 124, 249, 498, 996, 1995, 3993, 7993, 16000].map((frequency, index) => ({
          type: 2, channels: 0, frequency, q: 0, gain: index % 2 ? 1.5 : -1.5, color: 0,
        })),
      ],
    };
    const fixtureText = JSON.stringify(importedFixture);
    await mkdir(path.dirname(presetStoreFile), { recursive: true });
    const originalFixturePath = path.join(path.dirname(presetStoreFile), 'audio-core-poweramp-source.json');
    await writeFile(originalFixturePath, fixtureText, { flag: 'wx' });
    const injected = await evaluate(`(() => {
      const input=document.querySelector('#processing-preset-file');
      if(!input||typeof DataTransfer!=='function'||typeof File!=='function') return false;
      const file=new File([${JSON.stringify(fixtureText)}],'poweramp-fixture',{type:'application/json'});
      const transfer=new DataTransfer(); transfer.items.add(file); input.files=transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true})); return true;
    })()`);
    assert.equal(injected, true, 'Could not inject the in-memory extensionless Poweramp fixture.');
    await waitFor(`(() => { const p=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing; const s=JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1')||'{}'); return p?.eq?.name==='Audio Core Poweramp Fixture' && s.presets?.some(i=>i.kind==='imported'&&i.sourceText); })()`, 'extensionless Poweramp fixture imported and preserved');
    const importedState = await getState();
    assert.equal(importedState.processing.tone.enabled, false, 'Poweramp import implicitly enabled tone processing.');
    assert.equal(importedState.processing.tone.bass.frequency, 90, 'Poweramp bass tone frequency was not imported.');
    assert.equal(importedState.processing.tone.bass.gain, 2.5, 'Poweramp bass tone gain was not imported.');
    assert.equal(importedState.processing.eq.mode, 'graphic');
    assert.equal(importedState.processing.eq.bands.length, 10);
    assert.equal(importedState.output.backend, stateBeforePresetApply.output.backend, 'Poweramp import changed the selected output.');
    assert.deepEqual(importedState.processing.replayGain, stateBeforePresetApply.processing.replayGain, 'Poweramp import changed local ReplayGain settings.');
    report.checks.extensionlessPowerampImportPreservesToneSwitch = true;

    const fullBackupSettings = JSON.parse(JSON.stringify(importedState.processing));
    fullBackupSettings.float64 = true;
    fullBackupSettings.eq = {
      ...fullBackupSettings.eq,
      name: 'Full Rhine Backup EQ',
      preamp: 1.5,
      bands: fullBackupSettings.eq.bands.map((band, index) => ({ ...band, gain: index === 0 ? 4.75 : band.gain })),
    };
    fullBackupSettings.tone = {
      enabled: true,
      bass: { frequency: 105, q: 0.85, gain: 5.25 },
      treble: { frequency: 9100, q: 0.75, gain: -2.5 },
    };
    fullBackupSettings.replayGain = { mode: 'protect', source: 'track', preamp: -2, noTagPreamp: 1.25 };
    fullBackupSettings.resampling = {
      ...fullBackupSettings.resampling,
      mode: 'fixed', rate: 96000, engine: 'fast',
      allowedRates: [...new Set([...fullBackupSettings.resampling.allowedRates, 96000])],
      family: true,
    };
    fullBackupSettings.outputFormat = 's24';
    fullBackupSettings.dither = 'triangular';
    fullBackupSettings.bufferMs = 250;
    fullBackupSettings.reconfigureMs = 260;
    fullBackupSettings.transition = {
      automatic: 'crossfade', manual: 'short', crossfadeMs: 4500, manualMs: 500,
      transportFade: true, transportMs: 300, seekFade: false, seekMs: 80,
      preloadMs: 1500, gapMs: 0,
    };
    const parametricBackupEq = {
      ...fullBackupSettings.eq,
      mode: 'parametric',
      bands: fullBackupSettings.eq.bands.map((band) => ({ ...band, type: 3, q: 0.8 })),
    };
    const fullBackupJson = serializeRhineProcessingBackup(fullBackupSettings, {
      graphic: fullBackupSettings.eq,
      parametric: parametricBackupEq,
    });
    const parsedFullBackup = importRhineProcessingBackup(fullBackupJson);
    const expectedFullProcessing = { ...parsedFullBackup.settings, tone: parsedFullBackup.tone };
    const localBeforeBackupImport = await getState();
    const backupInjected = await evaluate(`(() => {
      const input=document.querySelector('#processing-preset-file');
      if(!input||typeof DataTransfer!=='function'||typeof File!=='function') return false;
      const file=new File([${JSON.stringify(fullBackupJson)}],'rhine-full-backup',{type:'application/json'});
      const transfer=new DataTransfer(); transfer.items.add(file); input.files=transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true})); return true;
    })()`);
    assert.equal(backupInjected, true, 'Could not inject the in-memory Rhine backup JSON.');
    await waitFor(`(() => { const p=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing; const s=JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1')||'{}'); return p?.eq?.name==='Full Rhine Backup EQ' && s.presets?.some(i=>i.kind==='imported'&&i.format==='rhine'&&i.backup); })()`, 'Rhine backup imported as an EQ preset');
    const defaultBackupImport = await getState();
    assert.equal(defaultBackupImport.processing.eq.preamp, 1.5);
    assert.deepEqual(defaultBackupImport.processing.tone, localBeforeBackupImport.processing.tone, 'Default Rhine import replaced local tone settings.');
    assert.deepEqual(defaultBackupImport.processing.replayGain, localBeforeBackupImport.processing.replayGain, 'Default Rhine import replaced local ReplayGain settings.');
    for (const key of ['backend', 'device', 'channel', 'wasapiDevice', 'wasapiMode', 'wasapiDsdMode']) {
      assert.equal(defaultBackupImport.output[key], localBeforeBackupImport.output[key], `Rhine EQ import changed output setting ${key}.`);
    }
    const restoreBackupAvailable = await evaluate(`(() => { const b=document.querySelector('[data-processing-preset-action="restore-backup"]'); return !!b&&!b.hidden&&!b.disabled&&b.textContent.includes('恢复此备份的全部处理设置'); })()`);
    assert.equal(restoreBackupAvailable, true, 'Imported Rhine backup has no explicit full-restore action.');
    await click('[data-processing-preset-action="restore-backup"]');
    await waitFor(`(() => { const p=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing; return p?.float64===true && p?.tone?.enabled===true && p?.replayGain?.mode==='protect' && p?.resampling?.rate===96000 && p?.outputFormat==='s24' && p?.transition?.automatic==='crossfade'; })()`, 'explicit full Rhine backup restore');
    const fullRestored = await getState();
    assert.deepEqual(fullRestored.processing, expectedFullProcessing, 'Full Rhine backup restore did not restore all processing settings.');
    assert.deepEqual(fullRestored.presets.eqBanks, parsedFullBackup.eqModes, 'Full Rhine backup restore did not restore both EQ mode banks.');
    for (const key of ['backend', 'device', 'channel', 'wasapiDevice', 'wasapiMode', 'wasapiDsdMode']) {
      assert.equal(fullRestored.output[key], localBeforeBackupImport.output[key], `Full Rhine restore changed output device setting ${key}.`);
    }
    report.checks.rhineBackupDefaultsToEqAndRequiresExplicitFullRestore = true;

    await openTopLevelPage('settings', 'settings', 'settings page before volume range check');
    const rangeOpened = await evaluate(`(() => {
      const range=document.querySelector('#volume'); const button=range?.nextElementSibling;
      if(!range||!button?.classList.contains('editable-range-value')) return false;
      button.click(); return !!document.querySelector('.editable-range-number');
    })()`);
    assert.equal(rangeOpened, true, 'Existing song-volume range has no numeric editor.');
    await evaluate(`(() => { const editor=document.querySelector('.editable-range-number'); if(!editor) return false; editor.value='42'; editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return true; })()`);
    await waitFor(`document.querySelector('#volume')?.value==='42' && Math.abs(JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').volume-0.42)<0.001`, 'Enter applies a typed range value');
    assert.equal(await evaluate(`document.querySelector('#stage')?.dataset.page`), 'settings', 'Enter left the settings page.');
    await evaluate(`(() => { document.querySelector('#volume')?.nextElementSibling?.click(); const editor=document.querySelector('.editable-range-number'); if(!editor) return false; editor.value='66'; editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); return true; })()`);
    await pause(80);
    assert.equal(await evaluate(`document.querySelector('#volume')?.value`), '42', 'Escape committed the unconfirmed range edit.');
    assert.equal(await evaluate(`document.querySelector('#stage')?.dataset.page`), 'settings', 'Escape left the settings page.');
    report.checks.rangeEnterAndEscape = true;

    const expectedProcessing = fullRestored.processing;
    await pause(300);
    await evaluate(`location.reload()`).catch(() => {});
    await waitFor(`location.pathname==='/' && document.querySelector('#music-loading')===null && document.querySelector('#three-scene canvas') && document.querySelector('#stage')?.dataset.page==='music'`, 'application reload after audio settings save', 60000);
    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page==='settings'`, 'settings page after audio state reload');
    await click('#music-settings [data-settings-category-target="audio"]');
    await waitFor(`(() => { const p=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}').output?.processing; return p?.eq?.name==='Full Rhine Backup EQ' && p?.tone?.enabled===true && p?.replayGain?.mode==='protect' && p?.resampling?.rate===96000; })()`, 'processing state restored after reload');
    await assertSettingsHasNoEqOrTone('Settings remains free of EQ/Tone controls after restart');
    await openEqPage('EQ page after processing-state restart');
    const reloadedControls = await assertEqPageControls('EQ controls and tone values restored after restart', { enabled: true, bassGain: '5.25', trebleGain: '-2.5' });
    assert.deepEqual([reloadedControls.toneEnabled,reloadedControls.bassGain,reloadedControls.trebleGain],[true,'5.25','-2.5'],'Tone control values did not return after restart.');
    const reloaded = await getState();
    assert.deepEqual(reloaded.processing, expectedProcessing, 'Audio processing settings changed across reload.');
    assert(reloaded.presets?.presets?.some((preset) => preset.kind === 'saved' && preset.name === 'Audio Core EQ'), 'Named EQ preset was not persistent across reload.');
    assert(reloaded.presets?.presets?.some((preset) => preset.kind === 'imported' && preset.sourceText === fixtureText), 'Original Poweramp preset text was not persistent across reload.');
    assert(reloaded.presets?.presets?.some((preset) => preset.kind === 'imported' && preset.format === 'rhine' && preset.sourceText === fullBackupJson), 'Original Rhine backup text was not persistent across reload.');
    report.checks.processingStateAndPresetsSurviveReload = true;

    const durableStore = await readPersistedPresetStore((store) =>
      store?.schemaVersion === 1
        && store.presets?.some((preset) => preset.kind === 'saved' && preset.name === 'Audio Core EQ')
        && store.presets?.some((preset) => preset.kind === 'imported' && preset.sourceText === fixtureText)
        && store.presets?.some((preset) => preset.kind === 'imported' && preset.sourceText === fullBackupJson),
    'saved EQ presets, mode banks, and original imports');
    assert.deepEqual(durableStore, reloaded.presets, 'Desktop profile preset file differs from the renderer store.');
    report.checks.processingPresetFilePersistsInProfile = true;

    await evaluate(`localStorage.removeItem('rhine-audio-processing-presets-v1')`);
    assert.equal(await evaluate(`localStorage.getItem('rhine-audio-processing-presets-v1') === null`), true, 'Could not clear the renderer preset key for the preload recovery test.');
    await evaluate(`location.reload()`).catch(() => {});
    await waitFor(`location.pathname==='/' && document.querySelector('#music-loading')===null && document.querySelector('#three-scene canvas') && document.querySelector('#stage')?.dataset.page==='music' && localStorage.getItem('rhine-audio-processing-presets-v1')!==null`, 'desktop preload restores the preset store after renderer storage is cleared', 60000);
    await openEqPage('EQ page after profile preset restore');
    const profileRestored = await getState();
    assert.deepEqual(profileRestored.presets, durableStore, 'Preload did not restore the desktop profile preset file into the existing localStorage key.');
    report.checks.presetFileRestoredByPreloadAfterStorageClear = true;

    const powerampPreset = profileRestored.presets.presets.find((preset) => preset.kind === 'imported' && preset.sourceText === fixtureText);
    assert(powerampPreset, 'The imported Poweramp preset was not available for local-record deletion.');
    await evaluate(`(() => { const select=document.querySelector('#processing-preset-select'); if(!select) return false; select.value=${JSON.stringify(powerampPreset.id)}; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    await waitFor(`JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1')||'{}').activeId===${JSON.stringify(powerampPreset.id)}`, 'select imported preset for local-record deletion');
    const importedActions = await evaluate(`(() => ({
      save: document.querySelector('[data-processing-preset-action="save"]')?.disabled ?? true,
      rename: document.querySelector('[data-processing-preset-action="rename"]')?.disabled ?? true,
      delete: document.querySelector('[data-processing-preset-action="delete"]')?.disabled ?? true,
    }))()`);
    assert.deepEqual(importedActions, { save: true, rename: true, delete: false }, 'Imported records should be deletable locally while remaining read-only for save/rename.');
    await click('[data-processing-preset-action="delete"]');
    await waitFor(`!JSON.parse(localStorage.getItem('rhine-audio-processing-presets-v1')||'{}').presets?.some(p=>p.id===${JSON.stringify(powerampPreset.id)})`, 'delete imported preset from the local store');
    assert.equal(await readFile(originalFixturePath, 'utf8'), fixtureText, 'Deleting the local imported record changed the original source JSON file.');
    const afterImportedDelete = await getState();
    assert(afterImportedDelete.presets.presets.some((preset) => preset.kind === 'imported' && preset.sourceText === fullBackupJson), 'Deleting one imported record removed another local backup.');
    await readPersistedPresetStore((store) =>
      !store.presets?.some((preset) => preset.id === powerampPreset.id)
        && store.presets?.some((preset) => preset.kind === 'imported' && preset.sourceText === fullBackupJson),
    'imported-record deletion persisted while the Rhine backup remains');
    report.checks.importedRecordDeletionPreservesSourceFile = true;
    await openTopLevelPage('settings', 'settings', 'settings page before appearance category');
    await click('#music-settings [data-settings-category-target="appearance"]');
    report.ok = true;
  } catch (error) {
    report.error = error?.stack ?? String(error);
  }
  return report;
}
