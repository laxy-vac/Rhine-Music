import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function installThemeFollowProbe(browserWindow, onProgress = () => {}) {
  const d = browserWindow.webContents.debugger;
  if (d.isAttached()) throw new Error('Theme-follow probe expected an unattached CDP session.');
  onProgress('attaching CDP');
  d.attach('1.3');
  onProgress('CDP attached');
  const send = async (name, params) => Promise.race([
    d.sendCommand(name, params),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`CDP command timed out: ${name}`)), 7000)),
  ]);
  return {
    setSystemTheme: theme => send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-color-scheme', value: theme === 'night' ? 'dark' : 'light' }] }),
    watchCurrentDocument: () => browserWindow.webContents.executeJavaScript(`(() => {
      const query=matchMedia('(prefers-color-scheme: dark)'),watch=window.__rhineThemeFollowWatch={events:0,matches:query.matches};
      window.__rhineThemeFollowQuery=query;query.addEventListener('change',event=>{watch.events++;watch.matches=event.matches});
      return {matches:query.matches};
    })()`, true),
    detach: () => { if (d.isAttached()) d.detach(); },
  };
}

export async function checkThemeFollow({ browserWindow, outputDirectory, probeReport, getPreferences, themeProbe }) {
  const wc = browserWindow.webContents;
  try {
  // Only the synthetic capture window keeps painting while occluded. The
  // production gate's ready/restoration events are observed before this point.
  wc.setBackgroundThrottling(false);
  const result = { ok: false, checks: {}, cases: [], screenshots: [], mediaChanges: [], layoutChecks: [] };
  const evaluate = script => wc.executeJavaScript(script, true);
  const state = () => evaluate(`(() => {
    const stage=document.querySelector('#stage'),prefs=JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}');
    const aside=document.querySelector('aside.theme-mode-controls'),check=aside?.querySelector('[data-follow-system-theme]'),style=getComputedStyle(stage),watch=window.__rhineThemeFollowWatch;
    return {theme:stage?.dataset.theme||null,design:window.rhineMusic?.design?.design||null,localTheme:prefs.theme??null,follow:check?.checked??prefs.followSystemTheme??null,savedFollow:prefs.followSystemTheme??null,
      dayPressed:aside?.querySelector('button[data-theme="day"]')?.getAttribute('aria-pressed')??null,nightPressed:aside?.querySelector('button[data-theme="night"]')?.getAttribute('aria-pressed')??null,
      themeButtonsEnabled:!!aside&&[...aside.querySelectorAll('button[data-theme]')].every(button=>!button.disabled),
      pageBg:style.getPropertyValue('--page-bg').trim(),surface:style.getPropertyValue('--surface').trim(),ink:style.getPropertyValue('--ink').trim(),
      mql:watch?{events:watch.events,matches:watch.matches,systemDark:window.__rhineThemeFollowQuery?.matches??null}:null,
      stylePageOpen:!document.querySelector('#music-theme-page')?.hidden,hasLayout:!!document.querySelector('#theme-page-content .design-family-layout'),
      graphicsTitle:document.querySelector('#music-style-title')?.textContent?.trim()??null,
      graphicsNavLabel:document.querySelector('.music-topnav [data-action="theme"]')?.textContent?.trim()??null};
  })()`);
  const waitFor = async (test, label, timeout = 7000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await state(); if (test(value)) return value; await pause(80); }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await state())}`);
  };
  const click = selector => evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('Missing control: '+${JSON.stringify(selector)}); e.click(); })()`);
  const paint = () => evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,850))))`);
  const saves = () => probeReport.preferenceSaves?.length ?? 0;
  const assertStored = async (theme, follow) => {
    const until = Date.now() + 5000;
    while (Date.now() < until) { const p = getPreferences(); if (p.theme === theme && p.followSystemTheme === follow) return; await pause(50); }
    assert.deepEqual({ theme: getPreferences().theme, follow: getPreferences().followSystemTheme }, { theme, follow }, 'production preference filter must retain theme and follow state');
  };
  const clickTheme = async theme => { await click(`aside.theme-mode-controls button[data-theme="${theme}"]`); await waitFor(s => s.theme === theme && s.localTheme === theme, `theme ${theme}`); await paint(); };
  const clickFollow = async checked => { await click('aside.theme-mode-controls input[data-follow-system-theme]'); await waitFor(s => s.follow === checked && s.savedFollow === checked, `follow-system ${checked}`); };
  const setSystem = async (theme, expectChange = true) => {
    const before = (await state()).mql?.events ?? 0;
    await themeProbe.setSystemTheme(theme);
    if (expectChange) await waitFor(s => (s.mql?.events ?? 0) > before, `real MQL ${theme} change`, 4000);
    await pause(120);
    const after = await state();
    assert.equal(after.mql?.systemDark, theme === 'night', 'CDP media query state must match the requested system mode');
    result.mediaChanges.push({ theme, beforeEvents: before, afterEvents: after.mql?.events, systemDark: after.mql?.systemDark });
    return after;
  };
  const openStyle = async () => { await click('.music-topnav [data-action="theme"]'); await waitFor(s => s.stylePageOpen && s.hasLayout && s.graphicsTitle === 'STYLE', 'STYLE theme controls'); await paint(); };
  const chooseDesign = async design => {
    const before = await state();
    if (before.design !== design) { await click(`.design-family-card[data-style-design="${design}"]`); await waitFor(s => s.design === design, `design ${design}`, 12000); }
    const after = await state();
    assert.equal(after.theme, before.theme, `switching to ${design} must preserve global theme`);
    assert.equal(after.follow, before.follow, `switching to ${design} must preserve follow-system state`);
    return after;
  };
  const scrollToThemeLayout = async () => evaluate(`(() => {
    const page=document.querySelector('#theme-page-content'),layout=page?.querySelector('.design-family-layout');
    if(!page||!layout)return null;
    page.scrollTop+=layout.getBoundingClientRect().top-page.getBoundingClientRect().top-12;
    return page.scrollTop;
  })()`);
  const scrollControlsIntoView = async () => evaluate(`(() => {
    const page=document.querySelector('#theme-page-content'),aside=page?.querySelector('aside.theme-mode-controls'),playback=document.querySelector('#music-playback');
    if(!page||!aside||!playback)return null;
    const pr=page.getBoundingClientRect(),ar=aside.getBoundingClientRect(),br=playback.getBoundingClientRect(),top=Math.max(0,pr.top),bottom=Math.min(pr.bottom,br.top)-10;
    if(ar.bottom>bottom)page.scrollTop+=ar.bottom-bottom;
    const after=aside.getBoundingClientRect();if(after.top<top)page.scrollTop-=top-after.top;
    return page.scrollTop;
  })()`);
  const geometry = () => evaluate(`(() => {
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const page=document.querySelector('#theme-page-content'),stage=document.querySelector('#stage'),layout=page?.querySelector('.design-family-layout'),grid=layout?.querySelector('.design-family-grid'),aside=layout?.querySelector('aside.theme-mode-controls');
    if(!layout||!grid||!aside)return{present:false};
    const l=rect(layout),g=rect(grid),a=rect(aside),controls=[...aside.querySelectorAll('button[data-theme],input[data-follow-system-theme]')],inside=(r,o)=>r.x>=o.x-1&&r.y>=o.y-1&&r.right<=o.right+1&&r.bottom<=o.bottom+1;
    const p=rect(page),b=rect(document.querySelector('#music-playback'));
    return{present:true,layout:l,grid:g,aside:a,page:p,playback:b,buttons:controls.filter(n=>n.matches('button')).length,checkbox:controls.some(n=>n.matches('input[type=checkbox]')),buttonsEnabled:controls.filter(n=>n.matches('button')).every(n=>!n.disabled),
      overlap:!(g.right<=a.x+1||a.right<=g.x+1||g.bottom<=a.y+1||a.bottom<=g.y+1),inside:inside(g,l)&&inside(a,l)&&controls.every(n=>inside(rect(n),a)),
      clipped:aside.scrollWidth>aside.clientWidth+1||aside.scrollHeight>aside.clientHeight+1,outside:a.x<0||a.right>innerWidth+1||a.y<0||a.bottom>innerHeight+1,
      pageClipped:a.y<p.y-1||a.bottom>p.bottom+1,overlapsPlayback:!(a.bottom<=b.y+1||a.y>=b.bottom-1),
      viewport:{width:innerWidth,height:innerHeight},page:rect(page),pageScrollTop:page.scrollTop,rootStyle:{pageBg:getComputedStyle(stage).getPropertyValue('--page-bg').trim(),surface:getComputedStyle(stage).getPropertyValue('--surface').trim(),ink:getComputedStyle(stage).getPropertyValue('--ink').trim()}};
  })()`);
  const checkGeometry = async label => {
    const g = await geometry();
    g.label = label;
    g.ok = g.present && g.buttons === 2 && g.checkbox && g.buttonsEnabled && !g.overlap && g.inside && !g.clipped && !g.outside && !g.pageClipped && !g.overlapsPlayback;
    result.layoutChecks.push(g);
    return g;
  };
  const screenshot = async (name, metadata) => {
    await paint(); const image = await browserWindow.capturePage(), file = path.join(outputDirectory, `theme-follow-${name}.png`);
    await fs.writeFile(file, image.toPNG());
    const item = { file, size: image.getSize(), ...metadata }; result.screenshots.push(item); return item;
  };

  await fs.mkdir(outputDirectory, { recursive: true });
  await themeProbe.watchCurrentDocument();
  const initial = await state();
  assert.equal(initial.theme, 'day'); assert.equal(initial.follow, false);
  await setSystem('night', initial.mql?.systemDark !== true);
  assert.equal((await state()).theme, 'day', 'follow-off must ignore system changes');
  await openStyle();
  result.checks.graphicsTitleAndTopbarLabel = (await state()).graphicsTitle === 'STYLE' && /STYLE/i.test((await state()).graphicsNavLabel ?? '');
  const enableSaves = saves();
  await clickFollow(true);
  const enabled = await waitFor(s => s.theme === 'night' && s.savedFollow === true, 'immediate sync after enabling follow');
  await assertStored('night', true);
  assert.ok(saves() > enableSaves, 'enabling and immediate sync must persist through the production preference filter');
  result.checks.enableImmediatelySyncs = enabled.theme === 'night' && enabled.follow === true;

  await clickTheme('day'); assert.equal((await state()).follow, true, 'manual choice must leave follow enabled'); await assertStored('day', true);
  const afterManual = saves(), duplicate = await setSystem('night', false), afterDuplicate = saves();
  assert.equal(duplicate.theme, 'day', 'repeat of unchanged system state must not correct a manual mode');
  assert.equal(saves(), afterManual, 'repeat of unchanged system state must not save');
  const nodeSet = await evaluate(`(() => { window.__themeFollowStableNode=document.querySelector('#theme-page-content aside.theme-mode-controls'); return !!window.__themeFollowStableNode; })()`);
  assert.equal(nodeSet, true);
  const beforeMatch = saves(); await setSystem('day'); const afterMatch = saves();
  const sameNode = await evaluate(`window.__themeFollowStableNode===document.querySelector('#theme-page-content aside.theme-mode-controls')`);
  assert.equal((await state()).theme, 'day'); assert.equal(sameNode, true, 'matching system change must not rebuild theme controls'); assert.equal(saves(), beforeMatch, 'matching system change must not save');
  const beforeFollow = saves(); await setSystem('night');
  await waitFor(s => s.theme === 'night' && s.savedFollow, 'follow changed system mode');
  assert.ok(saves() > beforeFollow);
  result.checks.manualChoiceKeepsFollow = (await state()).follow === true;
  result.checks.sameModeNoCorrectionOrSave = duplicate.theme === 'day' && afterDuplicate === afterManual;
  result.checks.matchingModeNoRebuildOrSave = sameNode && afterMatch === beforeMatch;
  result.checks.differentModeFollows = (await state()).theme === 'night';

  await clickFollow(false); const offSaves = saves(); await setSystem('day');
  assert.equal((await state()).theme, 'night', 'follow-off must ignore later changes'); assert.equal(saves(), offSaves);
  await clickFollow(true); await waitFor(s => s.theme === 'day' && s.follow, 're-enable with immediate sync');
  await clickTheme('night'); await assertStored('night', true);

  await chooseDesign('rhine'); await chooseDesign('archive'); await chooseDesign('rhine');
  result.checks.designSwitchPreservesThemeAndFollow = true;
  const palette = {};
  for (const design of ['rhine', 'archive']) {
    await chooseDesign(design);
    for (const theme of ['day', 'night']) {
      await clickTheme(theme); await scrollToThemeLayout(); await scrollControlsIntoView(); await paint();
      const current = await state(), layout = await checkGeometry(`${design}-${theme}`);
      assert.equal(current.theme, theme);
      assert.equal(current.dayPressed === 'true', theme === 'day'); assert.equal(current.nightPressed === 'true', theme === 'night');
      assert.ok(current.pageBg && current.surface && current.ink, 'computed palette must be present');
      palette[design] ??= {}; palette[design][theme] = { pageBg: current.pageBg, surface: current.surface, ink: current.ink };
      const label = `${design === 'rhine' ? 'future' : 'punk'}-${theme}`;
      result.cases.push(await screenshot(label, { design, theme, geometry: layout, computedPalette: palette[design][theme] }));
    }
    assert.notEqual(palette[design].day.pageBg, palette[design].night.pageBg, `${design} day/night palettes must differ in computed style`);
  }
  browserWindow.setContentSize(880, 900); await pause(300); await scrollToThemeLayout(); await scrollControlsIntoView();
  const narrowGeometry = await checkGeometry('narrow-window');
  await screenshot('narrow', { design: (await state()).design, theme: (await state()).theme, geometry: narrowGeometry });

  // Keep the lifecycle/persistence case independent of the preceding narrow
  // layout case, and return its WebGL surface to the original test dimensions.
  browserWindow.setContentSize(1320, 900);
  await pause(300);
  await paint();

  const saved = getPreferences(); assert.equal(saved.theme, 'night'); assert.equal(saved.followSystemTheme, true);
  const savesBeforeReload = saves(), readyBefore = probeReport.frontendReadyCount;
  browserWindow.webContents.reload();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && probeReport.frontendReadyCount <= readyBefore) await pause(100);
  assert.equal(probeReport.frontendReadyCount, readyBefore + 1, 'reload must deliver a second real ready message');
  assert.equal(browserWindow.webContents.getBackgroundThrottling(), true); assert.equal(browserWindow.isVisible(), true);
  wc.setBackgroundThrottling(false);
  await themeProbe.watchCurrentDocument();
  await openStyle();
  const afterReload = await state();
  assert.equal(afterReload.theme, 'night', 'restart must preserve manual mode despite light system media');
  assert.equal(afterReload.follow, true); assert.equal(afterReload.savedFollow, true); await assertStored('night', true);
  const afterReloadSaves = saves(); await setSystem('light', false);
  assert.equal((await state()).theme, 'night'); assert.equal(saves(), afterReloadSaves, 'unchanged media at restart must not save');
  await setSystem('night'); assert.equal((await state()).theme, 'night'); assert.equal(saves(), afterReloadSaves, 'matching mode must not save/rebuild');
  await setSystem('day'); await waitFor(s => s.theme === 'day' && s.follow, 'follow next real system change after reload');
  assert.ok(saves() > afterReloadSaves);
  result.checks.offIgnoresSystem = true;
  result.checks.reloadPreservesManualThemeAndFollow = afterReload.theme === 'night' && afterReload.follow === true;
  result.checks.reloadWaitsForNextRealSystemChange = (await state()).theme === 'day';
  result.checks.themeControlLayoutFitsAllCases = result.layoutChecks.length === 5 && result.layoutChecks.every(item => item.ok);
  result.preferenceSaveCount = saves(); result.preferenceSaveCountBeforeReload = savesBeforeReload;
  result.summary = { cases: result.cases.length, screenshots: result.screenshots.length, readyMessages: probeReport.frontendReadyCount };
  result.ok = Object.values(result.checks).every(Boolean) && result.cases.length === 4 && result.screenshots.length === 5;
  return result;
  } finally {
    if (!browserWindow.isDestroyed()) wc.setBackgroundThrottling(true);
  }
}
