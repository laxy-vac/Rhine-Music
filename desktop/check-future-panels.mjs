import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkFuturePanels({ browserWindow, outputDirectory, report, sendKey, serviceOrigin }) {
  const wc = browserWindow.webContents;
  const result = { ok: false, checks: {}, screenshots: [], cases: [], requests: [], isolation: { syntheticOnly: true, externalRequestsBlocked: true } };
  const evaluate = script => wc.executeJavaScript(script, true);
  const snapshot = () => evaluate(`(() => {
    const stage=document.querySelector('#stage'),panel=document.querySelector('.music-panel'),heading=panel?.querySelector('.panel-heading'),body=panel?.querySelector('#panel-body');
    const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const query=document.querySelector('#online-query'),search=document.querySelector('[data-action="online-search"]'),source=document.querySelector('#online-source'),collection=document.querySelector('#online-collection');
    return {
      theme:stage?.dataset.theme??null,design:stage?.dataset.design??null,
      graphicsPageOpen:!document.querySelector('#music-theme-page')?.hidden,
      graphicsTitle:document.querySelector('#music-style-title')?.textContent?.trim()??null,
      graphicsControls:!!document.querySelector('#theme-page-content aside.theme-mode-controls'),
      panel:panel?.dataset.panel??null,panelRect:rect(panel),headingRect:rect(heading),bodyRect:rect(body),headingTop:rect(heading)?.y??null,
      bodyScrollTop:body?.scrollTop??null,bodyScrollHeight:body?.scrollHeight??null,bodyClientHeight:body?.clientHeight??null,
      bodyClientWidth:body?.clientWidth??null,bodyScrollWidth:body?.scrollWidth??null,panelClientWidth:panel?.clientWidth??null,panelScrollWidth:panel?.scrollWidth??null,
      albumResults:document.querySelectorAll('#album-results .album-result').length,
      firstResultText:document.querySelector('#album-results .album-result .result-copy strong')?.textContent?.trim()??null,
      onlineRows:document.querySelectorAll('#online-results .online-row').length,
      onlineTitle:document.querySelector('#online-results .online-row .result-copy strong')?.textContent?.trim()??null,
      queryFocused:document.activeElement===query,activeTag:document.activeElement?.tagName??null,activeId:document.activeElement?.id??null,
      onlineQueryRect:rect(query),searchButtonRect:rect(search),sourceSelectRect:rect(source),collectionSelectRect:rect(collection),
      longCopy: (()=>{const e=document.querySelector('#online-results .online-row .result-copy strong')||document.querySelector('#album-results .album-result .result-copy strong');if(!e)return null;const s=getComputedStyle(e);return{text:s.textOverflow,whiteSpace:s.whiteSpace,overflow:s.overflow,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clamp:s.webkitLineClamp||''}})(),
      details: (()=>{const d=document.querySelector('#online-subsonic details');return d?{open:d.open,rect:rect(d),summaryText:d.querySelector('summary')?.textContent??''}:null})(),
      themeColor:getComputedStyle(stage).getPropertyValue('--page-bg').trim(),
      externalResources:performance.getEntriesByType('resource').filter(e=>/^https?:/i.test(e.name)&&!e.name.startsWith(location.origin)).map(e=>e.name).slice(0,10),
      onlineSearchResourceCount:performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/online/search')).length,
      onlineSearchResources:performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/online/search')).map(e=>e.name).slice(-4),
    };
  })()`);
  const waitFor = async (test, label, timeout = 8000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await snapshot(); if (test(value)) return value; await pause(80); }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await snapshot())}`);
  };
  const click = selector => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing panel control: '+${JSON.stringify(selector)});e.click();return true})()`);
  const paint = () => evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,800))))`);
  const screenshot = async (name, metadata) => {
    await paint();
    const image = await browserWindow.capturePage(), file = path.join(outputDirectory, `future-panels-${name}.png`);
    await fs.writeFile(file, image.toPNG());
    const item = { file, size: image.getSize(), ...metadata };
    result.screenshots.push(item); return item;
  };
  const setTheme = async theme => {
    await click('.music-topnav [data-action="theme"]');
    await waitFor(s => s.graphicsPageOpen && s.graphicsTitle === 'GRAPHICS' && s.graphicsControls, 'GRAPHICS theme controls');
    await click(`aside.theme-mode-controls button[data-theme="${theme}"]`);
    await waitFor(s => s.theme === theme, `Future ${theme} theme`);
    await click('.music-topnav [data-action="theme"]');
    await waitFor(s => !s.graphicsPageOpen, 'return from GRAPHICS to archive');
    await paint();
  };
  const openPanel = async type => {
    await click(`.music-topnav [data-action="${type}"]`);
    await waitFor(s => s.panel === type && s.bodyRect, `${type} panel`);
    await paint();
  };
  const closePanel = async () => {
    await click('.music-panel [data-action="close-panel"]');
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const open = await evaluate(`(() => {const e=document.querySelector('.music-panel');return !!e&&!e.hidden&&getComputedStyle(e).display!=='none'})()`);
      if (!open) return;
      await pause(50);
    }
    throw new Error('Panel did not close after the close button was activated.');
  };
  const panelGeometry = async label => {
    const before = await snapshot();
    const stable = before.headingTop;
    await evaluate(`(()=>{const b=document.querySelector('#panel-body');b.scrollTop=b.scrollHeight})()`);
    await pause(120);
    const after = await snapshot();
    const geometry = {
      label, panelType: before.panel, headerTopBefore: stable, headerTopAfter: after.headingTop,
      headerStable: Math.abs((after.headingTop ?? 0) - (stable ?? 0)) < 1,
      bodyScrolls: (before.bodyScrollHeight ?? 0) > (before.bodyClientHeight ?? 0) + 2 && (after.bodyScrollTop ?? 0) > 0,
      horizontalOverflow: (after.bodyScrollWidth ?? 0) > (after.bodyClientWidth ?? 0) + 1 || (after.panelScrollWidth ?? 0) > (after.panelClientWidth ?? 0) + 1,
      body: { top: after.bodyRect?.y, bottom: after.bodyRect?.bottom, scrollTop: after.bodyScrollTop, scrollHeight: after.bodyScrollHeight, clientHeight: after.bodyClientHeight },
      panelRect: after.panelRect, heading: after.headingRect,
    };
    assert.equal(geometry.headerStable, true, `${label}: heading must stay fixed when panel body scrolls`);
    assert.equal(geometry.bodyScrolls, true, `${label}: panel body must scroll for the synthetic list`);
    assert.equal(geometry.horizontalOverflow, false, `${label}: panel must not overflow horizontally`);
    return geometry;
  };
  const captureTop = async (type, theme, sizeName, label = 'initial') => {
    const state = await snapshot();
    await screenshot(`${type}-${theme}-${sizeName}-${label}`, { panel: type, theme, size: sizeName, position: label, state });
    return state;
  };
  const inspectPanelScroll = async (type, theme, sizeName, captureBottom = false) => {
    const geometry = await panelGeometry(`${type}-${theme}-${sizeName}`);
    if (captureBottom) {
      const bottom = await snapshot();
      await screenshot(`${type}-${theme}-${sizeName}-scroll-bottom`, { panel: type, theme, size: sizeName, position: 'scroll-bottom', state: bottom, geometry });
    }
    await evaluate(`(()=>{document.querySelector('#panel-body').scrollTop=0})()`);
    await paint();
    result.cases.push({ panel: type, theme, viewport: sizeName, geometry });
    return geometry;
  };
  const themeColors = {};
  const viewports = [
    { name: 'wide', width: 1280, height: 900 },
    { name: 'narrow', width: 900, height: 700 },
  ];
  await fs.mkdir(outputDirectory, { recursive: true });
  assert.equal((await snapshot()).design, 'rhine', 'Future styling must be active for panel checks');

  // Capture clean online panels in both themes before any search mutates the
  // renderer's persistent onlineSearch state.
  browserWindow.setContentSize(1280, 900);
  for (const theme of ['day', 'night']) {
    await setTheme(theme);
    await openPanel('online');
    const clean = await snapshot();
    assert.equal(clean.onlineRows, 0, 'initial online panel should have no synthetic search results');
    assert.equal(clean.details?.open, false, 'initial online connection disclosure should be closed');
    await captureTop('online', theme, 'wide', 'initial');
    await closePanel();
  }

  for (const viewport of viewports) {
    browserWindow.setContentSize(viewport.width, viewport.height);
    await pause(180);
    for (const theme of ['day', 'night']) {
      await setTheme(theme);
      themeColors[theme] = (await snapshot()).themeColor;

      await openPanel('search');
      const searchOpen = await snapshot();
      assert.equal(searchOpen.panel, 'search');
      assert.ok(searchOpen.albumResults >= 30, 'the local search fixture must contain enough albums to scroll');
      assert.ok(searchOpen.firstResultText?.includes('Synthetic'), 'search should render the fake catalogue');
      if (viewport.name === 'wide' || viewport.name === 'narrow') await captureTop('search', theme, viewport.name);
      const searchGeometry = await inspectPanelScroll('search', theme, viewport.name, viewport.name === 'wide' && theme === 'day');
      const input = await evaluate(`(() => {const e=document.querySelector('#album-search');e.focus();return document.activeElement===e})()`);
      assert.equal(input, true, 'local search field must receive keyboard focus');
      const allCount = (await snapshot()).albumResults;
      await evaluate(`(()=>{const e=document.querySelector('#album-search');e.value='needlemark';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      const filtered = await waitFor(s => s.albumResults > 0 && s.albumResults < allCount, 'local synthetic search filter');
      assert.ok(filtered.firstResultText?.toLocaleLowerCase().includes('needlemark'));
      if (!result.checks.searchFocusWorks && viewport.name === 'wide' && theme === 'day') {
        await screenshot(`search-${theme}-${viewport.name}-keyboard-focus`, { panel: 'search', theme, size: viewport.name, position: 'keyboard-focus', state: await snapshot(), filterCount: filtered.albumResults });
      }
      result.checks.localSearchFilters = true;
      result.checks.searchFocusWorks = true;
      result.checks.searchVerticalLayout = searchGeometry.headerStable && searchGeometry.bodyScrolls && !searchGeometry.horizontalOverflow;
      await closePanel();

      await openPanel('online');
      const onlineOpen = await waitFor(s => s.panel === 'online' && !!s.onlineQueryRect, 'online panel controls');
      if (viewport.name !== 'wide' || (theme !== 'day' && theme !== 'night')) await captureTop('online', theme, viewport.name);
      const geometry = await evaluate(`(() => {
        const r=e=>{if(!e)return null;const x=e.getBoundingClientRect();return{x:x.x,y:x.y,right:x.right,bottom:x.bottom,width:x.width,height:x.height}};
        const row=document.querySelector('.online-search'),q=document.querySelector('#online-query'),button=document.querySelector('.online-search button.primary-button');
        const selects=[...document.querySelectorAll('.online-search .settings-select-trigger')];
        const boxes=[...selects.map(r),r(q),r(button)].filter(Boolean),center=boxes.map(x=>x.y+x.height/2),queryCenter=r(q)?.y+r(q)?.height/2,buttonCenter=r(button)?.y+r(button)?.height/2;
        return{row:r(row),query:r(q),button:r(button),selects,all:boxes,centerSpread:center.length?Math.max(...center)-Math.min(...center):null,queryButtonSpread:Math.abs(queryCenter-buttonCenter),
          triggers:selects.length,details:document.querySelector('#online-subsonic details')?.open??null};
      })()`);
      assert.equal(geometry.triggers, 2, 'both online selects must use the enhanced select controls');
      assert.ok(geometry.query && geometry.button, `online query/search button must exist: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.queryButtonSpread <= 12, `online query and search button must share one row: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.button.height >= 32 && geometry.button.height <= 60, 'online search button height must remain usable');
      assert.equal(onlineOpen.panel, 'online');

      if (!result.checks.expandedSelectScreenshot && viewport.name === 'wide' && theme === 'day') {
        await click('select#online-collection + button.settings-select-trigger');
        // The trigger's state and menu geometry are read in one renderer snapshot below.
        const menuState = await evaluate(`(() => {const t=document.querySelector('select#online-collection + button.settings-select-trigger'),m=document.querySelector('.settings-select-menu:not([hidden])');const r=m?.getBoundingClientRect();return{expanded:t?.getAttribute('aria-expanded'),options:m?.querySelectorAll('[role=option]').length??0,menu:r?{x:r.x,y:r.y,right:r.right,bottom:r.bottom}:null,viewport:{w:innerWidth,h:innerHeight}}})()`);
        assert.equal(menuState.expanded, 'true');
        assert.ok(menuState.options >= 4);
        assert.ok(menuState.menu && menuState.menu.x >= 0 && menuState.menu.y >= 0 && menuState.menu.right <= menuState.viewport.w + 1 && menuState.menu.bottom <= menuState.viewport.h + 1);
        await screenshot(`online-${theme}-${viewport.name}-expanded-select`, { panel: 'online', theme, size: viewport.name, menu: menuState });
        await sendKey('ESC');
        await waitForSelectClosed(browserWindow);
        result.checks.expandedSelectScreenshot = true;
      }

      if (!result.checks.syntheticSourceToggle && viewport.name === 'wide' && theme === 'day') {
        await click('select#online-source + button.settings-select-trigger');
        await click('.settings-select-menu:not([hidden]) .settings-select-option[data-option-index="1"]');
        const subsonic = await evaluate(`(() => {const field=document.querySelector('.online-collection-field'),trigger=field?.querySelector('.settings-select-trigger'),r=trigger?.getBoundingClientRect();return{value:document.querySelector('#online-source')?.value,hidden:field?.hidden??null,triggerSize:r?{width:r.width,height:r.height}:null}})()`);
        assert.equal(subsonic.value, 'subsonic', 'source menu should select the configured synthetic Subsonic option');
        assert.equal(subsonic.hidden, true, 'collection wrapper should hide for Subsonic');
        assert.ok(!subsonic.triggerSize || subsonic.triggerSize.width === 0 || subsonic.triggerSize.height === 0, 'hidden collection wrapper must leave no visible enhanced trigger');
        await click('select#online-source + button.settings-select-trigger');
        await click('.settings-select-menu:not([hidden]) .settings-select-option[data-option-index="0"]');
        const archive = await evaluate(`(() => {const field=document.querySelector('.online-collection-field'),trigger=field?.querySelector('.settings-select-trigger'),r=trigger?.getBoundingClientRect();return{value:document.querySelector('#online-source')?.value,hidden:field?.hidden??null,triggerSize:r?{width:r.width,height:r.height}:null}})()`);
        assert.equal(archive.value, 'internetarchive');
        assert.equal(archive.hidden, false, 'collection wrapper should return for Internet Archive');
        assert.ok(archive.triggerSize?.width > 0 && archive.triggerSize?.height > 0, 'collection enhanced trigger should return with its wrapper');
        result.checks.syntheticSourceToggle = true;
      }

      const details = await evaluate(`(() => {const d=document.querySelector('#online-subsonic details'),u=document.querySelector('#subsonic-url');return{present:!!d,open:d?.open??null,urlInput:!!u,summary:!!d?.querySelector('summary')}})()`);
      assert.equal(details.present, true, 'Subsonic form must be inside a details disclosure');
      assert.equal(details.open, false, 'connection details should start closed');
      await click('#online-subsonic details summary');
      const expandedDetails = await evaluate(`(() => {const d=document.querySelector('#online-subsonic details');return{open:d?.open??false,url:!!document.querySelector('#subsonic-url'),user:!!document.querySelector('#subsonic-user'),password:!!document.querySelector('#subsonic-pass')}})()`);
      assert.equal(expandedDetails.open && expandedDetails.url && expandedDetails.user && expandedDetails.password, true, 'synthetic connection form should expand without submitting credentials');
      result.checks.connectionDisclosureOperable = true;

      await evaluate(`(()=>{const q=document.querySelector('#online-query');q.value='fixturepanel';q.focus()})()`);
      const priorSearchResourceCount = await evaluate(`performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/online/search')).length`);
      await sendKey('ENTER');
      await waitFor(s => s.onlineSearchResourceCount > priorSearchResourceCount, 'new synthetic online search request');
      const results = await waitFor(s => s.onlineRows >= 12, 'mock online search results', 8000);
      assert.ok(results.onlineTitle?.includes('Fixture Panel'), 'online panel should render fixed mock search results');
      const longCopy = await snapshot();
      assert.ok(longCopy.longCopy?.text === 'ellipsis' || Number(longCopy.longCopy?.clamp) > 0, 'long result text should use truncation');
      const resources = await evaluate(`performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/online/search')).map(e=>e.name).slice(-2)`);
      assert.ok(resources.length > 0, 'Enter must send the real panel request to the synthetic local API');
      result.requests.push({ query: 'fixturepanel', count: results.onlineRows, resource: resources.at(-1) });
      result.checks.onlineEnterUsesMockApi = true;
      result.checks.onlineQueryRowAligned = geometry.queryButtonSpread <= 12;
      result.checks.longOnlineTextEllipsized = true;
      const onlineGeometry = await inspectPanelScroll('online', theme, viewport.name, viewport.name === 'wide' && theme === 'day');
      result.checks.onlineVerticalLayout = onlineGeometry.headerStable && onlineGeometry.bodyScrolls && !onlineGeometry.horizontalOverflow;
      if (!result.checks.onlineKeyboardFocus && viewport.name === 'wide' && theme === 'day') {
        await evaluate(`document.querySelector('#online-query').focus()`);
        await sendKey('TAB');
        const focus = await evaluate(`(() => ({tag:document.activeElement?.tagName,id:document.activeElement?.id,action:document.activeElement?.dataset?.action,focused:document.activeElement?.closest('.online-search')!=null}))()`);
        assert.equal(focus.focused, true, 'Tab should move keyboard focus within online search controls');
        await screenshot(`online-${theme}-${viewport.name}-keyboard-focus`, { panel: 'online', theme, size: viewport.name, position: 'keyboard-focus', focus });
        result.checks.onlineKeyboardFocus = true;
      }
      await closePanel();
    }
  }
  assert.notEqual(themeColors.day, themeColors.night, 'Future day/night panel palettes must really differ');
  result.checks.futureDayNightComputedPalette = true;
  result.checks.usefulInitialAndBottomScreenshots = result.screenshots.some(s => s.panel === 'online' && s.theme === 'day' && s.position === 'initial')
    && result.screenshots.some(s => s.panel === 'online' && s.theme === 'night' && s.position === 'initial')
    && result.screenshots.some(s => s.panel === 'search' && s.theme === 'day' && s.size === 'wide' && s.position === 'scroll-bottom')
    && result.screenshots.some(s => s.panel === 'online' && s.theme === 'day' && s.size === 'wide' && s.position === 'scroll-bottom');
  result.checks.screenshotLimitRespected = result.screenshots.length <= 20;
  result.checks.syntheticNetworkIsLocal = result.requests.length >= 4 && result.requests.every(item => item.resource.startsWith(serviceOrigin));
  result.summary = { panelCases: result.cases.length, screenshots: result.screenshots.length, mockOnlineSearches: result.requests.length };
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function waitForSelectClosed(browserWindow) {
  const until = Date.now() + 2500;
  while (Date.now() < until) {
    const closed = await browserWindow.webContents.executeJavaScript(`document.querySelector('select#online-collection + button.settings-select-trigger')?.getAttribute('aria-expanded')!=='true'`, true);
    if (closed) return true;
    await pause(50);
  }
  throw new Error('Enhanced online collection select did not close after Escape.');
}
