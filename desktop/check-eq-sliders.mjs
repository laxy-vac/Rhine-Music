import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkEqSliders({ browserWindow, outputDirectory }) {
  const wc = browserWindow.webContents;
  const evaluate = script => wc.executeJavaScript(script, true);
  const click = selector => evaluate(`(() => {const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Missing EQ probe control: '+${JSON.stringify(selector)});node.click();return true;})()`);
  const openPage = async (page, selector) => {
    const current = await evaluate(`document.querySelector('#stage')?.dataset.page??null`);
    if (current !== page) await click(selector);
  };
  const until = async (predicate, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = await evaluate(`(() => ({page:document.querySelector('#stage')?.dataset.page,design:document.querySelector('#stage')?.dataset.design,theme:document.querySelector('#stage')?.dataset.theme,mode:document.querySelector('#eq-page-editor .eq-controls')?.dataset.eqMode,lighting:document.querySelector('#stage')?.getAttribute('data-terminal-lighting')}))()`);
      if (predicate(state)) return state;
      await pause(80);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const rectEqual = (a, b, label) => {
    for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height'])
      assert.ok(Math.abs(a[key] - b[key]) <= .5, `${label} moved/resized on hover (${key}): ${JSON.stringify({ before: a, after: b })}`);
  };
  const initial = await evaluate(`(() => ({design:document.querySelector('#stage')?.dataset.design,theme:document.querySelector('#stage')?.dataset.theme}))()`);
  const report = { ok: false, syntheticDataOnly: true, audioOrServicesUsed: false, lightingInitial: null, cases: [], screenshots: [] };
  const capture = async name => {
    const file = path.join(outputDirectory, `eq-sliders-${name}.png`);
    await fs.writeFile(file, (await browserWindow.capturePage()).toPNG());
    report.screenshots.push(file);
    return file;
  };
  const inspect = async selector => evaluate(`(() => {
    const range=document.querySelector(${JSON.stringify(selector)});
    if(!range)throw new Error('Missing EQ range: '+${JSON.stringify(selector)});
    range.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    const r=range.getBoundingClientRect(),s=getComputedStyle(range);
    return {value:range.value,min:Number(range.min),max:Number(range.max),disabled:range.disabled,field:range.dataset.processingField||'strip-navigation',
      rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},
      writingMode:s.writingMode,direction:s.direction,appearance:s.appearance,borderRadius:s.borderRadius,boxShadow:s.boxShadow,
      hover:range.matches(':hover'),receiver:range.hasAttribute('data-terminal-receiver'),
      floating:range.hasAttribute('data-future-range-floating')||range.hasAttribute('data-future-range-expanded')||range.hasAttribute('data-future-range-dragging'),
      placeholder:!!document.querySelector('#music-eq-page .future-range-placeholder')};
  })()`);
  const hover = async (selector, expectedVertical, label) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
    await pause(100);
    const before = await inspect(selector);
    assert.equal(before.disabled, false, `${label} must remain enabled in the synthetic browser-output fixture.`);
    assert.equal(before.appearance, 'none', `${label} must use the shared native range skin.`);
    assert.equal(before.borderRadius, '999px', `${label} must retain the shared rounded rail host.`);
    assert.equal(before.boxShadow, 'none', `${label} must not paint a square host shadow.`);
    assert.equal(before.writingMode, expectedVertical ? 'vertical-lr' : 'horizontal-tb', `${label} must preserve its original orientation.`);
    if (expectedVertical) {
      assert.ok(before.rect.height > 100, `${label} must remain a usable vertical rail: ${JSON.stringify(before.rect)}`);
    }
    else assert.ok(Math.abs(before.rect.height - 28) <= 1, `${label} must retain its horizontal range height.`);
    const x = Math.round(before.rect.left + before.rect.width / 2), y = Math.round(before.rect.top + before.rect.height / 2);
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    await pause(180);
    const after = await inspect(selector);
    assert.equal(after.hover, true, `${label} must receive a real pointer hover.`);
    assert.equal(after.receiver, false, `${label} must not become a terminal-light receiver.`);
    assert.equal(after.floating, false, `${label} must not be expanded by Future range interaction.`);
    assert.equal(after.placeholder, false, `${label} must not create a floating placeholder.`);
    assert.equal(after.boxShadow, 'none', `${label} must remain free of a square host shadow while hovered.`);
    assert.equal(after.value, before.value, `${label} hover must not change its value.`);
    rectEqual(before.rect, after.rect, label);
    return { field: before.field, writingMode: before.writingMode, direction: before.direction, before: before.rect, after: after.rect, receiver: after.receiver, floating: after.floating, boxShadow: after.boxShadow };
  };
  const dragAndRestore = async (selector, vertical, label) => {
    const state = await inspect(selector);
    const r = state.rect;
    const positions = vertical
      ? [.22, .45, .78].map(ratio => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * ratio) }))
      : [.22, .48, .78].map(ratio => ({ x: Math.round(r.left + r.width * ratio), y: Math.round(r.top + r.height / 2) }));
    const original = Number(state.value);
    const values = [];
    const readValue = async () => Number(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`));
    wc.sendInputEvent({ type: 'mouseMove', x: positions[0].x, y: positions[0].y });
    await pause(30);
    wc.sendInputEvent({ type: 'mouseDown', x: positions[0].x, y: positions[0].y, button: 'left', clickCount: 1, modifiers: ['leftbuttondown'] });
    try {
      for (let index = 1; index < positions.length; index++) {
        const from = positions[index - 1], to = positions[index];
        wc.sendInputEvent({ type: 'mouseMove', x: to.x, y: to.y, movementX: to.x - from.x, movementY: to.y - from.y, button: 'left', modifiers: ['leftbuttondown'] });
        await pause(60);
        values.push(await readValue());
      }
    } finally {
      const end = positions.at(-1);
      wc.sendInputEvent({ type: 'mouseUp', x: end.x, y: end.y, button: 'left', clickCount: 1, modifiers: [] });
    }
    assert.ok(values.some(value => value !== original), `${label} held pointer drag must change the native range value: ${JSON.stringify({ original, values })}`);
    assert.ok(values.length >= 2 && values[0] !== values[1], `${label} held pointer moves must update the value continuously: ${JSON.stringify(values)}`);
    assert.ok(values.slice(0, -1).every(value => value > state.min && value < state.max), `${label} intermediate drag value must remain within the range: ${JSON.stringify({ min: state.min, max: state.max, values })}`);
    await evaluate(`(() => {const range=document.querySelector(${JSON.stringify(selector)});range.value=${JSON.stringify(String(original))};range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(120);
    const restored = await readValue();
    assert.equal(restored, original, `${label} must return to its saved value after the drag.`);
    wc.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
    await pause(100);
    const clean = await inspect(selector);
    assert.equal(clean.receiver, false, `${label} must remain outside terminal lighting after release.`);
    assert.equal(clean.floating, false, `${label} must leave no floating range state after release.`);
    return { field: state.field, original, values, restored, heldButton: true };
  };

  try {
    let terminalLight = await evaluate(`document.querySelector('#graphics-display-settings [data-quality="terminalLight"]')?.value??null`);
    if (!terminalLight) {
      await openPage('settings', '.music-topnav [data-action=settings]');
      await until(state => state.page === 'settings', 'open Settings for terminal-light state');
      await click('#music-settings [data-settings-category-target=appearance]');
      await pause(120);
      terminalLight = await evaluate(`document.querySelector('#graphics-display-settings [data-quality="terminalLight"]')?.value??null`);
    }
    assert.ok(['off', 'local', 'full'].includes(terminalLight), 'The existing terminal-light setting must be available for the isolated hover check.');
    report.lightingInitial = terminalLight;
    if (terminalLight === 'off') {
      await evaluate(`(() => {const control=document.querySelector('#graphics-display-settings [data-quality="terminalLight"]');control.value='local';control.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(state => state.lighting === 'local', 'enable local terminal lighting for the hover check');
    }

    await openPage('theme', '.music-topnav [data-action=theme]');
    await until(state => state.page === 'theme', 'open STYLE');
    if (initial.design !== 'rhine') {
      await click('.design-family-card[data-style-design=rhine]');
      await until(state => state.design === 'rhine', 'select Future/Rhine');
    }

    let originalMode = 'graphic';
    for (const theme of ['day', 'night']) {
      await click(`aside.theme-mode-controls button[data-theme=${theme}]`);
      await until(state => state.theme === theme, `switch ${theme} palette`);
      await pause(760);
      await openPage('eq', '.music-topnav [data-action=eq]');
      await until(state => state.page === 'eq', 'open EQ');
      await pause(160);
      const engine = await evaluate(`document.querySelector('#eq-page-editor .eq-controls')?.dataset.eqEngine??null`);
      if (engine !== 'standard') {
        await click('#eq-page-editor [data-eq-engine-target=standard]');
        await pause(180);
      }
      originalMode = await evaluate(`document.querySelector('#eq-page-editor select[data-processing-field="eq.mode"]')?.value??'graphic'`);
      for (const mode of ['graphic', 'parametric']) {
        await evaluate(`(() => {const select=document.querySelector('#eq-page-editor select[data-processing-field="eq.mode"]');select.value=${JSON.stringify(mode)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await until(state => state.mode === mode, `mount ${mode} EQ`);
        const gainSelector = mode === 'graphic'
          ? '#eq-page-editor .eq-graphic-gain input[type="range"]:not(:disabled)'
          : '#eq-page-editor .eq-parametric-gain input[type="range"]:not(:disabled)';
        const gain = await hover(gainSelector, true, `${mode} gain`);
        await capture(`${theme}-${mode}`);
        report.cases.push({ theme, mode, gain });
        if (theme === 'day' && mode === 'graphic') report.verticalDrag = await dragAndRestore(gainSelector, true, 'graphic gain');
        for (const key of ['bass', 'treble']) {
          const selector = `#tone-settings input[data-processing-field="tone.${key}.gain"]`;
          const tone = await hover(selector, false, `${key} tone gain`);
          if (mode === 'graphic' && key === 'bass') await capture(`${theme}-tone`);
          report.cases.at(-1)[key] = tone;
          if (theme === 'day' && mode === 'graphic' && key === 'bass') report.horizontalDrag = await dragAndRestore(selector, false, 'bass tone gain');
        }
        wc.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
        await pause(80);
      }
      await evaluate(`(() => {const select=document.querySelector('#eq-page-editor select[data-processing-field="eq.mode"]');if(select){select.value=${JSON.stringify(originalMode)};select.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
      await until(state => state.mode === originalMode, 'restore EQ mode');
      await openPage('theme', '.music-topnav [data-action=theme]');
    }
    if (terminalLight === 'off') {
      await openPage('settings', '.music-topnav [data-action=settings]');
      await until(state => state.page === 'settings', 'restore terminal-light setting');
      await click('#music-settings [data-settings-category-target=appearance]');
      await evaluate(`(() => {const control=document.querySelector('#graphics-display-settings [data-quality="terminalLight"]');control.value='off';control.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(state => state.lighting === 'off', 'restore terminal lighting off');
    }
    await openPage('theme', '.music-topnav [data-action=theme]');
    await until(state => state.page === 'theme', 'return to STYLE');
    if (initial.design !== 'rhine') {
      await click(`.design-family-card[data-style-design=${initial.design}]`);
      await until(state => state.design === initial.design, 'restore initial design');
    }
    await click(`aside.theme-mode-controls button[data-theme=${initial.theme}]`);
    await until(state => state.theme === initial.theme, 'restore initial theme');
    await pause(760);
    await openPage('settings', '.music-topnav [data-action=settings]');
    await until(state => state.page === 'settings', 'return to Settings');
    await click('#music-settings [data-settings-category-target=interface]');
    await pause(120);
    report.ok = true;
    return report;
  } finally {
    if (!browserWindow.isDestroyed()) {
      wc.sendInputEvent({ type: 'mouseUp', x: 2, y: 2, button: 'left', clickCount: 1, modifiers: [] });
    }
  }
}
