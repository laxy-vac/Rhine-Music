import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const clone = value => JSON.parse(JSON.stringify(value));
const eq = (left, right) => isDeepStrictEqual(left, right);

export async function checkCaseGlass({ browserWindow, outputDirectory, probeReport }) {
  const wc = browserWindow.webContents;
  const screenshotDirectory = path.join(outputDirectory, 'case-glass');
  const result = { ok: false, cases: [], screenshots: [], assertions: {}, summary: {} };
  let originalBackgroundThrottling;
  const evaluate = script => wc.executeJavaScript(script, true);
  const state = () => evaluate(`(() => {
    const stage = document.querySelector('#stage');
    const editor = document.querySelector('#theme-case-editor .case-editor');
    const preview = editor?.querySelector('[data-preview-stage]');
    const optics = editor?.querySelector('[data-minimal-glass-section]');
      const glassInputs = ['transmission','roughness'].map(field => editor?.querySelector('[data-minimal-glass="' + field + '"]'));
    const read = field => editor?.querySelector('[data-minimal-glass="' + field + '"]')?.value ?? null;
      const box = node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
      const previewRect = preview ? box(preview) : null, opticsRect = optics ? box(optics) : null;
      const visibleHeight = previewRect ? Math.max(0, Math.min(previewRect.bottom,innerHeight)-Math.max(previewRect.y,0)) : 0;
    return {
      page: stage?.dataset.page ?? null, theme: stage?.dataset.theme ?? null,
      design: stage?.dataset.design ?? editor?.dataset.design ?? null,
      viewport: { width: innerWidth, height: innerHeight },
      structure: preview?.dataset.caseStructure ?? null,
      previewState: preview?.dataset.casePreviewState ?? null,
      previewRect, opticsRect, previewVisibleHeight: visibleHeight,
      previewInViewport: !!previewRect && visibleHeight > 0 && previewRect.right > 0 && previewRect.x < innerWidth,
      opticsInViewport: !!optics && !optics.hidden && !!opticsRect && opticsRect.bottom > 0 && opticsRect.y < innerHeight && opticsRect.right > 0 && opticsRect.x < innerWidth,
      glassControlsVisible: glassInputs.every(input => { if(!input||input.disabled||input.closest('[data-minimal-glass-section]')?.hidden)return false; const r=input.getBoundingClientRect(); return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth; }),
      canvasReady: !!editor?.querySelector('[data-canvas-host] canvas') && (() => { const c=editor.querySelector('[data-canvas-host] canvas'); const r=c.getBoundingClientRect(); return c.width>0&&c.height>0&&r.width>0&&r.height>0; })(),
      opticsHidden: optics?.hidden ?? null,
      transmission: read('transmission'), roughness: read('roughness'),
      coverShown: editor?.querySelector('[data-field="show-cover"]')?.checked ?? null,
      coverTitle: editor?.querySelector('[data-cover-title]')?.textContent?.trim() ?? null,
      entryOverlay: Boolean(document.querySelector('.future-entry')),
    };
  })()`);
  const savedPreferences = () => evaluate(`(() => {
    try { return JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}'); }
    catch { return {}; }
  })()`);
  const scrollEditorToStart = async () => {
    const scrolled = await evaluate(`(() => {
      const editor=document.querySelector('#theme-case-editor .case-editor');
      const content=document.querySelector('#theme-page-content')??document.querySelector('#music-theme-page .theme-page-content')??editor?.closest('.theme-page-content');
      if(!editor)return false;
      if(content){content.scrollTop+=editor.getBoundingClientRect().top-content.getBoundingClientRect().top;}
      else editor.scrollIntoView({block:'start'});
      return true;
    })()`);
    if (!scrolled) throw new Error('STYLE case editor is not mounted.');
    await pause(220);
  };
  const nudgeEditorToShowCase = async () => {
    await evaluate(`(() => {
      const editor=document.querySelector('#theme-case-editor .case-editor');
      const content=document.querySelector('#theme-page-content')??document.querySelector('#music-theme-page .theme-page-content')??editor?.closest('.theme-page-content');
      if(content)content.scrollTop+=60;else window.scrollBy(0,60);
      return true;
    })()`);
    await pause(220);
  };
  const caseProfile = preferences => preferences?.caseProfiles?.rhine;
  const minimalSurfaces = preferences => caseProfile(preferences)?.appearances?.minimal?.surfaces;
  const record = (name, ok, detail = null) => {
    result.assertions[name] = Boolean(ok);
    result.cases.push({ name, ok: Boolean(ok), ...(detail === null ? {} : { detail }) });
    if (!ok) throw new Error(`Case glass check failed: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  };
  const waitFor = async (predicate, label, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await state();
      if (predicate(last)) return last;
      await pause(100);
    }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
  };
  const click = async selector => {
    const clicked = await evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node) return false; node.click(); return true; })()`);
    if (!clicked) throw new Error(`Missing case glass control: ${selector}`);
  };
  const waitPreview = structure => waitFor(value => value.page === 'theme' && value.design === (structure === 'punk' ? 'archive' : 'rhine') && value.structure === structure && value.previewState === 'ready' && value.previewVisibleHeight >= 400 && value.canvasReady, `${structure} case preview`);
  const waitPreferenceSave = async (previousCount, predicate, label) => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const preferences = await savedPreferences();
      if (predicate(preferences) && (probeReport.preferenceSaves?.length ?? 0) > previousCount) return preferences;
      await pause(60);
    }
    throw new Error(`Timed out waiting for saved preference: ${label}`);
  };
  const screenshot = async name => {
    await scrollEditorToStart();
    await nudgeEditorToShowCase();
    const visible = await waitFor(value => value.previewState === 'ready' && value.previewVisibleHeight >= 400 && value.opticsInViewport && value.glassControlsVisible && value.canvasReady, 'visible case and glass controls', 10000);
    const left = Math.max(0, Math.floor(Math.min(visible.previewRect.x, visible.opticsRect.x)));
    const top = Math.max(0, Math.floor(Math.min(visible.previewRect.y, visible.opticsRect.y)));
    const right = Math.min(visible.viewport.width, Math.ceil(Math.max(visible.previewRect.right, visible.opticsRect.right)));
    const bottom = Math.min(visible.viewport.height, Math.ceil(Math.max(visible.previewRect.bottom, visible.opticsRect.bottom)));
    result.captureRegions ??= [];
    result.captureRegions.push({ x:left, y:top, width:right-left, height:bottom-top, previewVisibleHeight:visible.previewVisibleHeight });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const file = path.join(screenshotDirectory, `${name}.png`);
    await fs.writeFile(file, (await browserWindow.capturePage({ x: left, y: top, width: right - left, height: bottom - top })).toPNG());
    result.screenshots.push(file);
    process.stdout.write(`CASE_GLASS_SCREENSHOT:${file}\n`);
    return file;
  };
  const readField = (surfaces, part, field) => surfaces?.[part]?.[field];
  const unchangedExcept = (before, after, ignored) => {
    const strip = value => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !ignored.includes(key)));
    return eq(strip(before), strip(after));
  };
  const setOptic = async (field, value, otherField, frameBaseline) => {
    const before = await savedPreferences();
    const beforeSurfaces = minimalSurfaces(before);
    const savesBefore = probeReport.preferenceSaves?.length ?? 0;
    const dispatched = await evaluate(`(() => {
      const input=document.querySelector('[data-minimal-glass="${field}"]');
      if(!input || input.disabled || input.closest('[data-minimal-glass-section]')?.hidden) return false;
      input.value=${JSON.stringify(String(value))};
      input.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    })()`);
    if (!dispatched) throw new Error(`Minimal glass ${field} input is missing, hidden, or disabled.`);
    const after = await waitPreferenceSave(savesBefore, preferences => {
      const surfaces = minimalSurfaces(preferences);
      return ['cover', 'back'].every(part => Math.abs(Number(readField(surfaces, part, field)) - value) < 0.001);
    }, `minimal ${field}=${value}`);
    const surfaces = minimalSurfaces(after);
    record(`${field} updates cover and back only`,
      ['cover', 'back'].every(part => Math.abs(Number(readField(surfaces, part, field)) - value) < 0.001) &&
      ['cover', 'back'].every(part => eq(readField(surfaces, part, otherField), readField(beforeSurfaces, part, otherField))) &&
      eq(surfaces.frame, frameBaseline),
      { field, value, cover: surfaces.cover[field], back: surfaces.back[field], frameUnchanged: eq(surfaces.frame, frameBaseline) });
    return after;
  };

  try {
    originalBackgroundThrottling = wc.getBackgroundThrottling?.();
    wc.setBackgroundThrottling(false);
    await fs.mkdir(screenshotDirectory, { recursive: true });
    const initialPrefs = await savedPreferences();
    record('entry overlay disabled by saved startup preference', initialPrefs.entryOnOpen === false, { entryOnOpen: initialPrefs.entryOnOpen });
    await click('.music-topnav [data-action="theme"]');
    let current = await waitFor(value => value.page === 'theme' && value.design === 'rhine' && value.structure !== null, 'Future STYLE case editor');
    await scrollEditorToStart();
    current = await waitPreview(current.structure);
    record('synthetic cover is selected for the preview', current.coverShown === true && current.canvasReady, { coverShown: current.coverShown, coverTitle: current.coverTitle });
    if (current.structure === 'minimal') {
      await click('.case-editor__structure[data-structure="rhine"]');
      await waitPreview('rhine');
    }
    const savesBeforeMinimal = probeReport.preferenceSaves?.length ?? 0;
    await click('.case-editor__structure[data-structure="minimal"]');
    await scrollEditorToStart();
    await nudgeEditorToShowCase();
    current = await waitPreview('minimal');
    record('minimal glass controls are visible', current.opticsHidden === false && current.transmission !== null && current.roughness !== null, current);

    const baselinePrefs = await waitPreferenceSave(savesBeforeMinimal, preferences => caseProfile(preferences)?.structure === 'minimal' && !!minimalSurfaces(preferences), 'initial minimal case profile');
    const baseline = clone(minimalSurfaces(baselinePrefs));
    const frameBaseline = clone(baseline.frame);
    const otherStructureBaseline = clone(caseProfile(baselinePrefs).appearances.rhine);
    record('minimal profile saved through production preferences', !!baseline.cover && !!baseline.back && !!baseline.frame, { parts: Object.keys(baseline) });

    const lowTransmission = Math.abs(Number(baseline.cover.transmission) - 0.08) > 0.001 ? 0.08 : 0.12;
    const highTransmission = Math.abs(Number(baseline.cover.transmission) - 0.92) > 0.001 ? 0.92 : 0.88;
    const highRoughness = Math.abs(Number(baseline.cover.roughness) - 0.94) > 0.001 ? 0.94 : 0.86;
    await setOptic('transmission', lowTransmission, 'roughness', frameBaseline);
    await screenshot('low-transmission-day');
    await setOptic('transmission', highTransmission, 'roughness', frameBaseline);
    await screenshot('high-transmission-day');
    await setOptic('roughness', highRoughness, 'transmission', frameBaseline);
    await screenshot('high-roughness-day');

    const tunedPrefs = await savedPreferences();
    const tunedValues = ['transmission', 'roughness'].map(field => readField(minimalSurfaces(tunedPrefs), 'cover', field));
    await click('.case-editor__structure[data-structure="rhine"]');
    await waitPreview('rhine');
    await click('.design-family-card[data-style-design="archive"]');
    current = await waitFor(value => value.page === 'theme' && value.design === 'archive' && value.structure !== null, 'Punk STYLE case editor');
    await scrollEditorToStart();
    await waitPreview('punk');
    await click('.design-family-card[data-style-design="rhine"]');
    current = await waitFor(value => value.page === 'theme' && value.design === 'rhine' && value.structure !== null, 'return to Future STYLE case editor');
    await scrollEditorToStart();
    current = await waitPreview('rhine');
    await click('.case-editor__structure[data-structure="minimal"]');
    current = await waitPreview('minimal');
    const returnedPrefs = await savedPreferences();
    const returnedSurfaces = minimalSurfaces(returnedPrefs);
    record('minimal glass values survive Rhine and Punk structure switches',
      ['transmission', 'roughness'].every((field, index) =>
        readField(returnedSurfaces, 'cover', field) === tunedValues[index] &&
        readField(returnedSurfaces, 'back', field) === tunedValues[index]) && eq(returnedSurfaces.frame, frameBaseline),
      { transmission: tunedValues[0], roughness: tunedValues[1], finalStructure: current.structure });

    const savesBeforeNight = probeReport.preferenceSaves?.length ?? 0;
    await click('.theme-mode-controls [data-theme="night"]');
    await pause(800);
    await waitFor(value => value.theme === 'night' && value.structure === 'minimal' && value.previewState === 'ready', 'night minimal preview');
    const nightPrefs = await waitPreferenceSave(savesBeforeNight, preferences => preferences.theme === 'night', 'night theme preference');
    record('night theme control preserves minimal glass values', ['transmission', 'roughness'].every(field =>
      readField(minimalSurfaces(nightPrefs), 'cover', field) === tunedValues[field === 'transmission' ? 0 : 1] &&
      readField(minimalSurfaces(nightPrefs), 'back', field) === tunedValues[field === 'transmission' ? 0 : 1]), { theme: nightPrefs.theme });
    const savesBeforeDay = probeReport.preferenceSaves?.length ?? 0;
    await click('.theme-mode-controls [data-theme="day"]');
    await pause(800);
    await waitFor(value => value.theme === 'day' && value.structure === 'minimal' && value.previewState === 'ready', 'day minimal preview');
    const dayPrefs = await waitPreferenceSave(savesBeforeDay, preferences => preferences.theme === 'day', 'day theme preference');
    record('day theme control restores day with glass values intact', ['transmission', 'roughness'].every(field =>
      readField(minimalSurfaces(dayPrefs), 'cover', field) === tunedValues[field === 'transmission' ? 0 : 1] &&
      readField(minimalSurfaces(dayPrefs), 'back', field) === tunedValues[field === 'transmission' ? 0 : 1]), { theme: dayPrefs.theme });

    const beforeResetPrefs = await savedPreferences();
    const beforeResetProfile = clone(caseProfile(beforeResetPrefs));
    const savesBeforeReset = probeReport.preferenceSaves?.length ?? 0;
    await click('.case-editor [data-action="reset"]');
    const resetPrefs = await waitPreferenceSave(savesBeforeReset, preferences => {
      const surfaces = minimalSurfaces(preferences);
      return ['cover', 'back'].every(part =>
        readField(surfaces, part, 'transmission') === readField(baseline, part, 'transmission') &&
        readField(surfaces, part, 'roughness') === readField(baseline, part, 'roughness') &&
        readField(surfaces, part, 'preserveSource') === readField(baseline, part, 'preserveSource'));
    }, 'minimal glass reset');
    const resetProfile = caseProfile(resetPrefs);
    const resetSurfaces = minimalSurfaces(resetPrefs);
    record('reset restores cover and back glass defaults', ['cover', 'back'].every(part =>
      readField(resetSurfaces, part, 'transmission') === readField(baseline, part, 'transmission') &&
      readField(resetSurfaces, part, 'roughness') === readField(baseline, part, 'roughness') &&
      readField(resetSurfaces, part, 'preserveSource') === readField(baseline, part, 'preserveSource')),
    { cover: resetSurfaces.cover, back: resetSurfaces.back });
    record('reset leaves frame and other structures unchanged',
      eq(resetSurfaces.frame, beforeResetProfile.appearances.minimal.surfaces.frame) &&
      eq(resetProfile.appearances.rhine, beforeResetProfile.appearances.rhine) &&
      eq(resetProfile.appearances.minimal.surfaces.frame, frameBaseline) &&
      unchangedExcept(beforeResetProfile.appearances.minimal.surfaces.cover, resetSurfaces.cover, ['transmission', 'roughness', 'preserveSource']) &&
      unchangedExcept(beforeResetProfile.appearances.minimal.surfaces.back, resetSurfaces.back, ['transmission', 'roughness', 'preserveSource']) &&
      eq(resetPrefs.caseProfiles.archive, beforeResetPrefs.caseProfiles.archive),
      { frameUnchanged: eq(resetSurfaces.frame, frameBaseline), rhineStructureUnchanged: eq(resetProfile.appearances.rhine, beforeResetProfile.appearances.rhine) });

    result.preferenceState = {
      entryOnOpen: resetPrefs.entryOnOpen,
      theme: resetPrefs.theme,
      style: clone(resetPrefs.style),
      caseProfiles: clone(resetPrefs.caseProfiles),
    };
    const textureUploadErrors = (probeReport.rendererConsole ?? []).filter(item => /bad image data|Texture is immutable/i.test(item.message ?? ''));
    record('renderer has no invalid cover texture uploads', textureUploadErrors.length === 0, textureUploadErrors.map(item => item.message));
    result.ok = Object.values(result.assertions).every(Boolean) && result.screenshots.length >= 3;
    result.summary = { ok: result.ok, cases: result.cases.length, screenshots: result.screenshots.length, preferenceSaves: probeReport.preferenceSaves?.length ?? 0 };
  } catch (error) {
    result.error = String(error?.stack ?? error);
    result.summary = { ok: false, cases: result.cases.length, screenshots: result.screenshots.length, preferenceSaves: probeReport.preferenceSaves?.length ?? 0 };
  } finally {
    if (typeof originalBackgroundThrottling === 'boolean') wc.setBackgroundThrottling(originalBackgroundThrottling);
  }
  try {
    await fs.writeFile(path.join(outputDirectory, 'case-glass-report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } catch (error) { result.reportWriteError = String(error?.message ?? error); }
  if (!result.ok) {
    const error = new Error(result.error ?? 'Case glass checks did not pass.');
    error.caseGlassResult = result;
    throw error;
  }
  return result;
}
