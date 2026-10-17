import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const preferenceKey = 'rhine-music-preferences';
const paletteTokens = {
  bg: '--page-bg', ink: '--ink', muted: '--muted', line: '--line',
  accent: '--accent', surface: '--surface', panel: '--panel',
};
const originalDay = {
  bg: '#e8e5e1', ink: '#080a08', muted: '#77756d', line: '#aaa59a',
  accent: '#9b7247', surface: '#edebe4', panel: '#edebe4',
};
const dayDotColors = { soft: '#b56834', original: '#9b7247' };

function hexToRgb(value) {
  const hex = value.replace('#', '');
  return `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
}

function sameColor(actual, expected) {
  return String(actual).replace(/\s+/g, '').toLowerCase() === String(expected).replace(/\s+/g, '').toLowerCase();
}

function colorChannels(value) {
  const values = String(value).match(/[\d.]+/g)?.map(Number);
  return values?.length >= 3 ? values.slice(0, 3) : null;
}

function assertIntermediateColor(actual, from, to, label) {
  const value = colorChannels(actual);
  const start = colorChannels(hexToRgb(from));
  const end = colorChannels(hexToRgb(to));
  assert.ok(value && start && end, `${label} should resolve to an interpolated RGB color: ${actual}`);
  assert.ok(!sameColor(actual, hexToRgb(from)) && !sameColor(actual, hexToRgb(to)),
    `${label} should be between both endpoints during its transition: ${actual}`);
  assert.ok(value.every((channel, index) => channel >= Math.min(start[index], end[index]) && channel <= Math.max(start[index], end[index])),
    `${label} channels should remain between the old and new colors: ${actual}`);
}

function assertDaySwatches(swatches, label) {
  assert.equal(swatches.length,2,`${label} should expose both day-palette choices: ${JSON.stringify(swatches)}`);
  for (const palette of ['soft','original']) {
    const item=swatches.find(value=>value.palette===palette);
    assert.ok(item,`${label} should expose the ${palette} day-palette option`);
    assert.ok(item.dot,`${label}/${palette} should show a reference color dot`);
    assert.ok(item.dot.width>=6&&item.dot.height>=6&&Math.abs(item.dot.width-item.dot.height)<=0.5,
      `${label}/${palette} reference dot should be a visible circle: ${JSON.stringify(item.dot)}`);
    assert.ok(/50%|100%|999/.test(item.dot.borderRadius)||parseFloat(item.dot.borderRadius)>=item.dot.width/2-0.5,
      `${label}/${palette} reference dot should have a circular radius: ${JSON.stringify(item.dot)}`);
    assert.ok(!/^rgba?\(\s*0\s*,\s*0\s*,\s*0(?:\s*,\s*0(?:\.0+)?)?\s*\)$/i.test(item.dot.backgroundColor)&&item.dot.backgroundColor!=='transparent',
      `${label}/${palette} reference dot should have a non-transparent fill: ${JSON.stringify(item.dot)}`);
    assert.ok(sameColor(item.dot.backgroundColor,hexToRgb(dayDotColors[palette])),
      `${label}/${palette} reference dot should match its palette accent ${dayDotColors[palette]}: ${JSON.stringify(item.dot)}`);
    assert.ok(item.dot.right<=item.text.left+1,
      `${label}/${palette} reference dot should sit to the left of its label: ${JSON.stringify(item)}`);
    assert.ok(item.requiredWidth<=item.clientWidth+1&&item.scrollWidth<=item.clientWidth+1,
      `${label}/${palette} button should fit its dot and label without horizontal compression or overflow: ${JSON.stringify(item)}`);
  }
}

export async function checkDayPalette({ browserWindow, outputDirectory }) {
  const wc = browserWindow.webContents;
  const evaluate = script => wc.executeJavaScript(script, true);
  const click = selector => evaluate(`(() => {
    const node=document.querySelector(${JSON.stringify(selector)});
    if(!node)throw new Error('Missing day-palette control: '+${JSON.stringify(selector)});
    node.click();
    return true;
  })()`);
  const report = {
    ok: false,
    screenshots: [],
    checks: {},
    reportPath: path.join(outputDirectory, 'day-palette-report.json'),
  };
  let failure = null;
  let initial = null;
  let originalBounds = null;
  let originalContentSize = null;
  let originalFullscreen = false;
  let refsCreated = false;

  const snapshot = () => evaluate(`(() => {
    const stage=document.querySelector('#stage');
    const app=document.querySelector('.music-app');
    const picker=document.querySelector('#music-theme-page .future-appearance-switch');
    const options=picker?.querySelector('.future-day-options');
    const style=app?getComputedStyle(app):null;
    const tokens=Object.fromEntries(Object.entries(${JSON.stringify(paletteTokens)}).map(([name,property])=>[name,style?.getPropertyValue(property).trim()??'']));
    const prefs=JSON.parse(localStorage.getItem(${JSON.stringify(preferenceKey)})||'{}');
    const scroller=document.querySelector('#theme-page-content');
    return {
      design:stage?.dataset.design??null,
      theme:stage?.dataset.theme??null,
      page:stage?.dataset.page??null,
      category:document.querySelector('#music-settings [data-settings-category-target][aria-current="page"]')?.dataset.settingsCategoryTarget??null,
      palette:picker?.dataset.dayChoice??prefs.style?.dayPalette??null,
      mode:picker?.dataset.appearanceMode??null,
      hasPicker:!!picker,
      optionsInert:!!options?.inert,
      dayPaletteTabs:options?[...options.querySelectorAll('[data-day-palette]')].map(node=>({value:node.dataset.dayPalette,tabIndex:node.tabIndex,pressed:node.getAttribute('aria-pressed')})):[],
      themeMotionReady:!!app?.classList.contains('theme-motion-ready'),
      reducedMotionClass:!!app?.classList.contains('reduce-motion'),
      transitionProperty:style?.transitionProperty??'',
      transitionDuration:style?.transitionDuration??'',
      systemReducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
      tokens,
      prefs,
      scrollTop:scroller?.scrollTop??0,
      windowScrollY:window.scrollY,
    };
  })()`);
  const waitUntil = async (predicate, label, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await snapshot();
      if (predicate(state)) return state;
      await pause(60);
    }
    const state = await snapshot();
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({design:state.design,theme:state.theme,page:state.page,palette:state.palette,mode:state.mode})}`);
  };
  const openStyle = async () => {
    if ((await snapshot()).page !== 'theme') await click('.music-topnav [data-action=theme]');
    return waitUntil(state=>state.page==='theme'&&state.hasPicker||state.page==='theme','open STYLE');
  };
  const setDesign = async design => {
    await openStyle();
    if ((await snapshot()).design !== design) {
      await click(`.design-family-card[data-style-design="${design}"]`);
      await waitUntil(state=>state.design===design&&state.page==='theme','switch style design');
    }
  };
  const setTheme = async theme => {
    const before = await snapshot();
    if (before.theme !== theme) {
      await click(`.future-appearance-switch [data-theme="${theme}"]`);
      await waitUntil(state=>state.design==='rhine'&&state.theme===theme&&state.mode===theme,'switch day/night mode');
    }
  };
  const setPalette = async palette => {
    const before = await snapshot();
    assert.equal(before.design, 'rhine', 'Day palette choices belong to Future');
    assert.equal(before.theme, 'day', 'Day palette choices must be selected in LIGHT mode');
    if (before.palette !== palette) {
      await click(`.future-appearance-switch [data-day-palette="${palette}"]`);
      await waitUntil(state=>state.palette===palette&&state.prefs.style?.dayPalette===palette,'save day palette');
    }
  };
  const assertTokens = (actual, expected, label) => {
    for (const [name, color] of Object.entries(expected)) {
      assert.ok(sameColor(actual[name], hexToRgb(color)), `${label} ${name} token should be ${color}; received ${actual[name]}`);
    }
  };
  const waitForDayTokens = async (palette, label) => {
    const expected = palette === 'original' ? originalDay : null;
    if (expected) return waitUntil(state=>Object.entries(expected).every(([name,color])=>sameColor(state.tokens[name],hexToRgb(color))),label,5000);
    return waitUntil(state=>sameColor(state.tokens.ink,hexToRgb('#232722'))&&sameColor(state.tokens.accent,hexToRgb('#b56834')),label,5000);
  };
  const capture = async name => {
    await evaluate(`(() => {const scroller=document.querySelector('#theme-page-content');if(scroller)scroller.scrollTop=0;})()`);
    await pause(500);
    const file = path.join(outputDirectory, `graphics-day-palette-${name}.png`);
    await fs.writeFile(file, (await browserWindow.capturePage()).toPNG());
    report.screenshots.push(file);
  };
  const saveSwitchRefs = () => evaluate(`(() => {
    const picker=document.querySelector('#music-theme-page .future-appearance-switch');
    if(!picker)throw new Error('Missing Future appearance switch');
    window.__dayPaletteProbeRefs={
      picker,
      modeIndicator:picker.querySelector('.future-mode-indicator'),
      dayIndicator:picker.querySelector('.future-day-indicator'),
      light:picker.querySelector('[data-theme="day"]'),
      dark:picker.querySelector('[data-theme="night"]'),
      soft:picker.querySelector('[data-day-palette="soft"]'),
      original:picker.querySelector('[data-day-palette="original"]'),
    };
    return true;
  })()`);
  const indicatorState = () => evaluate(`(() => {
    const refs=window.__dayPaletteProbeRefs;
    if(!refs)throw new Error('Missing day-palette probe references');
    const picker=document.querySelector('#music-theme-page .future-appearance-switch');
    const options=picker?.querySelector('.future-day-options');
    const x=node=>{const value=getComputedStyle(node).transform;return new DOMMatrixReadOnly(value==='none'?undefined:value).m41;};
    return {
      same:refs.picker===picker&&refs.modeIndicator===picker?.querySelector('.future-mode-indicator')&&refs.dayIndicator===picker?.querySelector('.future-day-indicator')&&refs.light===picker?.querySelector('[data-theme="day"]')&&refs.dark===picker?.querySelector('[data-theme="night"]')&&refs.soft===picker?.querySelector('[data-day-palette="soft"]')&&refs.original===picker?.querySelector('[data-day-palette="original"]'),
      modeX:x(refs.modeIndicator), dayX:x(refs.dayIndicator),
      modeWidth:picker?.getBoundingClientRect().width??0,
      dayWidth:options?.getBoundingClientRect().width??0,
      modeDuration:getComputedStyle(refs.modeIndicator).transitionDuration,
      dayDuration:getComputedStyle(refs.dayIndicator).transitionDuration,
      activeIsSoft:document.activeElement===refs.soft,
      activeIsOriginal:document.activeElement===refs.original,
      activeIsDark:document.activeElement===refs.dark,
      scrollTop:document.querySelector('#theme-page-content')?.scrollTop??0,
      windowScrollY:window.scrollY,
    };
  })()`);
  const readDaySwatches = () => evaluate(`(() => {
    const buttons=[...document.querySelectorAll('#music-theme-page .future-appearance-switch [data-day-palette]')];
    return buttons.map(button=>{
      const dot=button.querySelector('.theme-mode-dot');
      const buttonStyle=getComputedStyle(button);
      const dotStyle=dot?getComputedStyle(dot):null;
      const dotRect=dot?.getBoundingClientRect();
      const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);
      const textRects=[];
      while(walker.nextNode()){
        const node=walker.currentNode;
        if(!node.textContent?.trim()||node.parentElement?.closest('.theme-mode-dot'))continue;
        const start=node.textContent.search(/\\S/),end=node.textContent.trimEnd().length;
        const range=document.createRange();
        range.setStart(node,start);range.setEnd(node,end);
        const rect=range.getBoundingClientRect();
        if(rect.width&&rect.height)textRects.push(rect);
      }
      const text=textRects.length?{left:Math.min(...textRects.map(rect=>rect.left)),right:Math.max(...textRects.map(rect=>rect.right)),width:textRects.reduce((sum,rect)=>sum+rect.width,0)}:null;
      const width=button.clientWidth;
      const paddingLeft=parseFloat(buttonStyle.paddingLeft)||0;
      const paddingRight=parseFloat(buttonStyle.paddingRight)||0;
      const gap=parseFloat(buttonStyle.columnGap)||parseFloat(buttonStyle.gap)||0;
      return {
        palette:button.dataset.dayPalette,
        clientWidth:width,
        scrollWidth:button.scrollWidth,
        requiredWidth:paddingLeft+(dotRect?.width??0)+gap+(text?.width??0)+paddingRight,
        dot:dot&&dotStyle?{left:dotRect.left,right:dotRect.right,width:dotRect.width,height:dotRect.height,borderRadius:dotStyle.borderRadius,backgroundColor:dotStyle.backgroundColor,backgroundImage:dotStyle.backgroundImage}:null,
        text,
      };
    });
  })()`);
  const pressKey = (selector, key) => evaluate(`(() => {
    const node=document.querySelector(${JSON.stringify(selector)});
    if(!node)throw new Error('Missing keyboard target: '+${JSON.stringify(selector)});
    node.focus({preventScroll:true});
    const event=new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true});
    node.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  const setReducedMotion = async checked => {
    await click('.music-topnav [data-action=settings]');
    await waitUntil(state=>state.page==='settings','open Settings for reduced motion');
    await click('#music-settings [data-settings-category-target=interface]');
    await waitUntil(state=>state.page==='settings'&&state.category==='interface','open interface settings');
    const result = await evaluate(`(() => {
      const input=document.querySelector('#reduced-motion');
      if(!input)throw new Error('Missing reduced-motion preference');
      input.checked=${JSON.stringify(checked)};
      input.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    })()`);
    if (!result) throw new Error('Could not set reduced-motion preference');
    await waitUntil(state=>state.prefs.reduced===checked,'save reduced-motion preference');
    await click('.music-topnav [data-action=theme]');
    await waitUntil(state=>state.page==='theme','return to STYLE after reduced-motion preference');
  };

  try {
    originalBounds = browserWindow.getBounds();
    originalContentSize = browserWindow.getContentSize();
    originalFullscreen = browserWindow.isFullScreen();
    await openStyle();
    initial = await snapshot();
    report.initialState = {
      design: initial.design, theme: initial.theme, page: initial.page,
      reducedMotion: initial.prefs.reduced ?? false,
      dayPalette: initial.prefs.style?.dayPalette ?? initial.prefs.styleProfiles?.rhine?.style?.dayPalette ?? 'soft',
      systemReducedMotion: initial.systemReducedMotion,
      contentSize: originalContentSize,
    };
    await evaluate(`(() => {window.__dayPaletteProbeInitial={focus:document.activeElement,scroller:document.querySelector('#theme-page-content')};})()`);
    refsCreated = true;

    await setDesign('rhine');
    if (initial.prefs.reduced === true && !initial.systemReducedMotion) await setReducedMotion(false);
    await setTheme('day');
    await setPalette('soft');
    const soft = await waitForDayTokens('soft','soft Future day colors');
    assert.ok(sameColor(soft.tokens.ink,hexToRgb('#232722'))&&sameColor(soft.tokens.accent,hexToRgb('#b56834')),
      `The original soft Future ink/accent should remain intact: ${JSON.stringify({ink:soft.tokens.ink,accent:soft.tokens.accent})}`);
    report.checks.softDayTokens = { ink: soft.tokens.ink, accent: soft.tokens.accent };
    await capture('old-soft');

    await saveSwitchRefs();
    const motionBase = await snapshot();
    if (!motionBase.systemReducedMotion) {
      assert.ok(motionBase.themeMotionReady,'The shared theme motion should be ready after the initial palette has painted');
      const transitionParts = motionBase.transitionDuration.split(',').map(value=>value.trim());
      assert.ok(transitionParts.some(value=>Math.abs(parseFloat(value)*1000-650)<2),
        `Shared theme tokens should use the 650ms transition: ${motionBase.transitionDuration}`);
      assert.ok(motionBase.transitionProperty.split(',').map(value=>value.trim()).includes('--ink'),
        `The shared ink token should participate in the palette transition: ${motionBase.transitionProperty}`);

      const focusAndScrollBefore = await evaluate(`(() => {
        const refs=window.__dayPaletteProbeRefs;
        const scroller=document.querySelector('#theme-page-content');
        scroller.scrollTop=Math.min(32,Math.max(0,scroller.scrollHeight-scroller.clientHeight));
        refs.original.focus({preventScroll:true});
        return {scrollTop:scroller.scrollTop,windowScrollY:window.scrollY,activeOriginal:document.activeElement===refs.original};
      })()`);
      assert.equal(focusAndScrollBefore.activeOriginal,true,'The palette action should begin with the chosen control focused');
      const clickStart = await indicatorState();
      assert.ok(clickStart.same,'All appearance controls should be mounted before the palette update');
      await evaluate(`window.__dayPaletteProbeRefs.original.click()`);
      await waitUntil(state=>state.palette==='original','apply original palette');
      const paletteMid = await (async()=>{
        await pause(180);
        const indicators=await indicatorState();
        assert.ok(indicators.same,'Palette sync must preserve both indicator nodes');
        assert.ok(indicators.dayX>1&&indicators.dayX<indicators.dayWidth/2-1,
          `The day-palette indicator should be between SOFT and ORIGINAL mid-transition: ${JSON.stringify(indicators)}`);
        await pause(145);
        const colors=await snapshot();
        assertIntermediateColor(colors.tokens.ink,'#232722','#080a08','Future ink');
        assertIntermediateColor(colors.tokens.accent,'#b56834','#9b7247','Future accent');
        assert.ok(Math.abs(colors.scrollTop-focusAndScrollBefore.scrollTop)<=1,
          `Changing the palette should preserve the Style page scroll: ${JSON.stringify({before:focusAndScrollBefore.scrollTop,after:colors.scrollTop})}`);
        const afterFocus=await evaluate('document.activeElement===window.__dayPaletteProbeRefs.original');
        assert.equal(afterFocus,true,'Changing the palette should keep focus on the selected button');
        return { tokens: colors.tokens, indicators, scrollTop: colors.scrollTop, activeOriginal: afterFocus };
      })();
      report.checks.midTransition = paletteMid;
      const original = await waitForDayTokens('original','original Future day colors');
      assertTokens(original.tokens, originalDay, 'Original Future day');
      const stableIndicators = await indicatorState();
      assert.ok(stableIndicators.same,'The controls and indicator nodes should remain mounted after palette selection');
      assert.ok(stableIndicators.dayX>=stableIndicators.dayWidth/2-2,
        `The day-palette indicator should settle on ORIGINAL: ${JSON.stringify(stableIndicators)}`);
      assert.ok(Math.abs(original.scrollTop-focusAndScrollBefore.scrollTop)<=1,
        'The Style page scroll should remain unchanged after the palette transition');
      assert.equal(await evaluate('document.activeElement===window.__dayPaletteProbeRefs.original'),true,
        'The selected day-palette button should retain keyboard focus');
      report.checks.originalDayTokens = original.tokens;
      report.checks.scrollAndFocus = { scrollTop: original.scrollTop, activeOriginal: true };
      await capture('original');

      const persisted = await snapshot();
      assert.equal(persisted.prefs.style?.dayPalette,'original','The active style preference should save the original day palette');
      assert.equal(persisted.prefs.styleProfiles?.rhine?.style?.dayPalette,'original',
        'Future’s saved style profile should retain the original day palette');
      report.checks.persistence = { style: persisted.prefs.style, rhineProfile: persisted.prefs.styleProfiles?.rhine?.style };

      await setTheme('night');
      const originalAtNight = await waitUntil(state=>state.theme==='night'&&state.mode==='night','Future night with original day preference');
      await pause(720);
      const nightOriginalTokens = (await snapshot()).tokens;
      await setTheme('day');
      await setPalette('soft');
      await waitForDayTokens('soft','soft Future day after night comparison');
      await setTheme('night');
      await waitUntil(state=>state.theme==='night'&&state.mode==='night','Future night with soft day preference');
      await pause(720);
      const nightSoftTokens = (await snapshot()).tokens;
      assert.deepEqual(nightSoftTokens,nightOriginalTokens,
        'Changing the saved day palette must not alter any Future night token');
      report.checks.nightPaletteIndependence = { tokens: nightSoftTokens, equalAfterDayPaletteChange: true };

      const inert = await evaluate(`(() => {
        const picker=document.querySelector('#music-theme-page .future-appearance-switch');
        const options=picker.querySelector('.future-day-options');
        const children=[...options.querySelectorAll('[data-day-palette]')];
        const before=document.activeElement;
        children[0].focus({preventScroll:true});
        return {inert:options.inert,attribute:options.hasAttribute('inert'),tabIndexes:children.map(node=>node.tabIndex),focusBlocked:!children.includes(document.activeElement),focusBeforeWasDark:before===picker.querySelector('[data-theme="night"]')};
      })()`);
      assert.equal(inert.inert,true,'The day-palette options should be inert in NIGHT mode');
      assert.equal(inert.attribute,true,'The NIGHT day-palette options should expose the inert attribute');
      assert.deepEqual(inert.tabIndexes,[-1,-1],'No day-palette button should be in the Tab order during NIGHT');
      assert.equal(inert.focusBlocked,true,'NIGHT day-palette buttons should reject focus');
      report.checks.nightInert = inert;

      await setTheme('day');
      const dayTabs = (await snapshot()).dayPaletteTabs;
      assert.ok(dayTabs.some(button=>button.value==='soft'&&button.tabIndex===0&&button.pressed==='true'),
        `The selected day palette should be reachable in LIGHT mode: ${JSON.stringify(dayTabs)}`);
      assert.ok(dayTabs.some(button=>button.value==='original'&&button.tabIndex===-1),
        'The unselected day palette should stay out of the Tab order in LIGHT mode');
      const daySwatches = await readDaySwatches();
      report.checks.daySwatches = daySwatches;
      assertDaySwatches(daySwatches,'Future STYLE day choices');
      await setPalette('soft');

      const arrowRightPrevented = await pressKey('.future-appearance-switch [data-day-palette="soft"]','ArrowRight');
      await waitUntil(state=>state.palette==='original','ArrowRight to select ORIGINAL');
      assert.equal(arrowRightPrevented,true,'ArrowRight should be handled by the appearance control');
      const arrowLeftPrevented = await pressKey('.future-appearance-switch [data-day-palette="original"]','ArrowLeft');
      await waitUntil(state=>state.palette==='soft','ArrowLeft to select SOFT');
      assert.equal(arrowLeftPrevented,true,'ArrowLeft should be handled by the appearance control');
      const homePrevented = await pressKey('.future-appearance-switch [data-day-palette="original"]','Home');
      await waitUntil(state=>state.palette==='soft','Home to select the first available choice');
      assert.equal(homePrevented,true,'Home should be handled by the appearance control');
      const endPrevented = await pressKey('.future-appearance-switch [data-day-palette="soft"]','End');
      await waitUntil(state=>state.theme==='night'&&state.mode==='night','End to select DARK');
      assert.equal(endPrevented,true,'End should be handled by the appearance control');
      const homeFromNightPrevented = await pressKey('.future-appearance-switch [data-theme="night"]','Home');
      await waitUntil(state=>state.theme==='day'&&state.mode==='day','Home from DARK to select LIGHT');
      assert.equal(homeFromNightPrevented,true,'Home from DARK should be handled by the appearance control');
      assert.equal((await snapshot()).palette,'soft','Returning to LIGHT should remember its selected day palette');
      report.checks.keyboard = { arrowRight: true, arrowLeft: true, home: true, end: true, homeFromNight: true };

      await setPalette('original');
      await setTheme('night');
      await pause(100);
      const reverseStart = await indicatorState();
      assert.ok(reverseStart.modeX>1&&reverseStart.modeX<reverseStart.modeWidth/2-1,
        `The NIGHT indicator should be sampled mid-transition before its reversal: ${JSON.stringify(reverseStart)}`);
      await click('.future-appearance-switch [data-theme="day"]');
      await waitUntil(state=>state.theme==='day'&&state.mode==='day','rapid reversal back to LIGHT');
      await pause(85);
      const modeReversal = await indicatorState();
      assert.ok(modeReversal.same,'The mode indicator should keep the same node during a quick reversal');
      assert.ok(modeReversal.modeX<reverseStart.modeX,
        `The NIGHT indicator should reverse toward LIGHT in place: ${JSON.stringify({reverseStart,modeReversal})}`);
      await click('.future-appearance-switch [data-day-palette="soft"]');
      await waitUntil(state=>state.palette==='soft','rapid reverse palette toward SOFT');
      await pause(70);
      const dayReversal = await indicatorState();
      assert.ok(dayReversal.same&&dayReversal.dayX<reverseStart.dayX,
        `The day-palette indicator should reverse toward SOFT in place: ${JSON.stringify({reverseStart,dayReversal})}`);
      await click('.future-appearance-switch [data-day-palette="original"]');
      await waitUntil(state=>state.palette==='original','rapid reverse palette back to ORIGINAL');
      await pause(760);
      const reversedEnd = await indicatorState();
      assert.ok(reversedEnd.same,'Rapid reversals should not rebuild the Future controls');
      assert.ok(reversedEnd.modeX<2,'The mode indicator should settle at LIGHT after reversal');
      assert.ok(reversedEnd.dayX>=reversedEnd.dayWidth/2-2,'The palette indicator should settle at ORIGINAL after reversal');
      assertTokens((await snapshot()).tokens,originalDay,'Original Future day after rapid reversal');
      report.checks.rapidReversal = { modeMidpoint: reverseStart, duringModeReversal: modeReversal, dayPaletteReversal: dayReversal, end: reversedEnd };

      await setTheme('night');
      const themeBeforeDesignSwitch = (await snapshot()).theme;
      await click('.design-family-card[data-style-design="archive"]');
      const archive = await waitUntil(state=>state.design==='archive'&&state.page==='theme','switch to Punk');
      assert.equal(archive.theme,themeBeforeDesignSwitch,'Switching to Punk must preserve the global day/night choice');
      assert.equal(archive.hasPicker,false,'Punk STYLE should not show the Future appearance switch');
      await click('.design-family-card[data-style-design="rhine"]');
      const futureAgain = await waitUntil(state=>state.design==='rhine'&&state.hasPicker,'return to Future');
      assert.equal(futureAgain.theme,themeBeforeDesignSwitch,'Returning to Future must preserve the global day/night choice');
      assert.equal(futureAgain.palette,'original','Future should remember its selected original day palette');
      assert.equal(futureAgain.prefs.styleProfiles?.rhine?.style?.dayPalette,'original',
        'Future profile should retain its day palette after switching through Punk');
      report.checks.designSwitch = { theme: themeBeforeDesignSwitch, punkControlHidden: !archive.hasPicker, rememberedPalette: futureAgain.palette };

      if (!initial.systemReducedMotion) {
        await setTheme('day');
        await setReducedMotion(true);
        const reduced = await snapshot();
        assert.equal(reduced.prefs.reduced,true,'The reduced-motion preference should be saved before measuring durations');
        assert.equal(reduced.reducedMotionClass,true,'The app should activate its reduced-motion class');
        const durations = await evaluate(`(() => {
          const app=document.querySelector('.music-app');
          const nodes=[...document.querySelectorAll('.future-mode-indicator,.future-day-indicator,.future-day-options,.future-appearance-switch button')];
          const measure=node=>({
            selector:node.className||node.dataset.theme||node.dataset.dayPalette,
            property:getComputedStyle(node).transitionProperty,
            duration:getComputedStyle(node).transitionDuration,
            activeTransitions:node.getAnimations().filter(animation=>animation.transitionProperty!==undefined).length,
          });
          return {app:measure(app),nodes:nodes.map(measure)};
        })()`);
        report.checks.reducedMotion = { durations };
        const maxDurationMs = value => Math.max(0,...String(value).matchAll(/([\d.eE+-]+)(ms|s)/g).map(match=>Number(match[1])*(match[2]==='s'?1000:1)));
        const effectivelyInstant = item => item.property==='none'||maxDurationMs(item.duration)<=1;
        assert.ok(effectivelyInstant(durations.app),
          `Reduced motion should disable shared palette transitions: ${JSON.stringify(durations.app)}`);
        assert.ok(durations.nodes.every(effectivelyInstant),
          `Reduced motion should disable both indicator layers and their control transitions: ${JSON.stringify(durations.nodes)}`);
        const nextFramePalette = () => evaluate(`new Promise(resolve=>requestAnimationFrame(()=>{
          const app=document.querySelector('.music-app');
          const picker=document.querySelector('#music-theme-page .future-appearance-switch');
          const options=picker.querySelector('.future-day-options');
          const modeIndicator=picker.querySelector('.future-mode-indicator');
          const dayIndicator=picker.querySelector('.future-day-indicator');
          const names=${JSON.stringify(paletteTokens)};
          const style=getComputedStyle(app);
          const tokens=Object.fromEntries(Object.entries(names).map(([name,property])=>[name,style.getPropertyValue(property).trim()]));
          const x=node=>new DOMMatrixReadOnly(getComputedStyle(node).transform==='none'?undefined:getComputedStyle(node).transform).m41;
          const tracked=[app,modeIndicator,dayIndicator,options,...picker.querySelectorAll('button')];
          const running=tracked.flatMap(node=>node.getAnimations().filter(animation=>animation.transitionProperty!==undefined&&['running','pending'].includes(animation.playState)).map(animation=>({property:animation.transitionProperty,playState:animation.playState,currentTime:animation.currentTime})));
          resolve({tokens,modeX:x(modeIndicator),modeWidth:picker.getBoundingClientRect().width,dayX:x(dayIndicator),dayWidth:options.getBoundingClientRect().width,running});
        }))`);
        await setPalette('soft');
        const softFrame = await nextFramePalette();
        assertTokens(softFrame.tokens,{ink:'#232722',accent:'#b56834'},'Reduced-motion SOFT frame');
        assert.equal(softFrame.running.length,0,`No palette transition should remain active one frame after selecting SOFT: ${JSON.stringify(softFrame.running)}`);
        await setPalette('original');
        const originalFrame = await nextFramePalette();
        assertTokens(originalFrame.tokens,originalDay,'Reduced-motion ORIGINAL frame');
        assert.ok(originalFrame.modeX<2&&originalFrame.dayX>=originalFrame.dayWidth/2-2,
          `Both indicators should reach their requested endpoints within one frame: ${JSON.stringify(originalFrame)}`);
        assert.equal(originalFrame.running.length,0,`No palette transition should remain active one frame after selecting ORIGINAL: ${JSON.stringify(originalFrame.running)}`);
        report.checks.reducedMotion = { durations, softFrame, originalFrame, paletteAppliedImmediately: true, noActiveTransitionsAfterOneFrame: true };
        await setReducedMotion(initial.prefs.reduced===true);
      } else {
        report.checks.reducedMotion = { skipped: true, reason: 'The host already requests reduced motion; system preference is not overridden by this probe.' };
      }

      await setTheme('day');
      await setPalette('original');
      browserWindow.setContentSize(800,900);
      await pause(450);
      const narrow = await evaluate(`(() => {
        const selectors=['html','body','#music-theme-page','#theme-page-content','.music-style-page','.design-family-layout','.theme-mode-controls','.future-appearance-switch','.future-day-palette-note'];
        const measures=selectors.map(selector=>{
          const node=document.querySelector(selector);
          return node?{selector,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,overflow:node.scrollWidth>node.clientWidth+1}:null;
        }).filter(Boolean);
        const page=document.querySelector('.music-style-page')?.getBoundingClientRect();
        const card=document.querySelector('.theme-mode-controls')?.getBoundingClientRect();
        const control=document.querySelector('.future-appearance-switch')?.getBoundingClientRect();
        return {
          viewport:{width:window.innerWidth,height:window.innerHeight},
          measures,
          withinViewport:!!card&&!!control&&card.left>=-1&&card.right<=window.innerWidth+1&&control.left>=card.left-1&&control.right<=card.right+1,
          withinStylePage:!!page&&!!card&&card.left>=page.left-1&&card.right<=page.right+1,
          appearance:{card:card?{left:card.left,right:card.right,width:card.width}:null,control:control?{left:control.left,right:control.right,width:control.width}:null},
        };
      })()`);
      narrow.daySwatches = await readDaySwatches();
      report.checks.narrowLayout = narrow;
      assert.ok(narrow.viewport.width<=804&&narrow.viewport.width>=780,
        `The narrow layout probe should use an 800px viewport: ${JSON.stringify(narrow.viewport)}`);
      assert.ok(narrow.measures.every(item=>!item.overflow),
        `STYLE content and its Appearance card should not overflow horizontally at an 800px viewport: ${JSON.stringify(narrow.measures)}`);
      assert.ok(narrow.withinViewport&&narrow.withinStylePage,
        `The Appearance card and palette control should remain inside the visible STYLE page: ${JSON.stringify(narrow)}`);
      assertDaySwatches(narrow.daySwatches,'800px Future STYLE day choices');
      await capture('narrow-layout');
    } else {
      report.checks.transition = { skipped: true, reason: 'The host system requests reduced motion.' };
      await setPalette('original');
      assertTokens((await waitForDayTokens('original','original Future day colors')).tokens,originalDay,'Original Future day');
    }

    report.ok = true;
  } catch (error) {
    failure = error;
    report.error = error?.stack ?? String(error);
  } finally {
    try {
      if (!browserWindow.isDestroyed()) {
        await openStyle().catch(()=>{});
        if (initial) {
          const after = await snapshot().catch(()=>null);
          if (after && after.prefs.reduced !== (initial.prefs.reduced===true)) {
            await setReducedMotion(initial.prefs.reduced===true);
          }
          await setDesign('rhine');
          await setTheme('day');
          const originalPalette = initial.prefs.style?.dayPalette ?? initial.prefs.styleProfiles?.rhine?.style?.dayPalette ?? 'soft';
          await setPalette(originalPalette === 'original' ? 'original' : 'soft');
          const originalDesign = initial.prefs.style?.design ?? initial.design ?? 'rhine';
          if (originalDesign !== 'rhine') await setDesign(originalDesign);
          if (initial.theme === 'night') {
            if (originalDesign !== 'rhine') {
              await click('.design-family-card[data-style-design="rhine"]');
              await waitUntil(state=>state.design==='rhine','restore Future before global theme');
              await setTheme('night');
              await click(`.design-family-card[data-style-design="${originalDesign}"]`);
              await waitUntil(state=>state.design===originalDesign,'restore original style');
            } else await setTheme('night');
          }
          if (initial.page === 'settings') {
            await click('.music-topnav [data-action=settings]');
            await waitUntil(state=>state.page==='settings','restore original Settings page');
          }
        }
        if (originalFullscreen !== null && browserWindow.isFullScreen() !== originalFullscreen) browserWindow.setFullScreen(originalFullscreen);
        if (originalContentSize) browserWindow.setContentSize(originalContentSize[0],originalContentSize[1]);
        if (originalBounds) browserWindow.setBounds(originalBounds);
        await pause(100);
        const restored = await evaluate(`(() => {
          const scroller=document.querySelector('#theme-page-content');
          const refs=window.__dayPaletteProbeInitial;
          if(refs?.scroller?.isConnected)scroller.scrollTop=refs.scroller.scrollTop;
          if(refs?.focus?.isConnected&&typeof refs.focus.focus==='function')refs.focus.focus({preventScroll:true});
          return true;
        })()`).catch(()=>false);
        if (refsCreated) await evaluate(`(() => {delete window.__dayPaletteProbeRefs;delete window.__dayPaletteProbeInitial;})()`).catch(()=>{});
        report.restoredWindow = { bounds: browserWindow.getBounds(), contentSize: browserWindow.getContentSize(), focusAndScroll: restored };
      }
    } catch (restoreError) {
      report.restoreError = restoreError?.stack ?? String(restoreError);
      if (!failure) failure = restoreError;
    }
    report.ok = !failure;
    await fs.mkdir(outputDirectory,{recursive:true});
    await fs.writeFile(report.reportPath,JSON.stringify(report,null,2),'utf8');
  }

  if (failure) throw failure;
  return report;
}
