import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkGraphics({ browserWindow, outputDirectory }) {
  const wc = browserWindow.webContents;
  const evaluate = script => wc.executeJavaScript(script, true);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const snapshot = () => evaluate(`(() => {
    const group=document.querySelector('#graphics-display-settings'),button=group?.querySelector('[data-action=fullscreen]');
    return {design:document.querySelector('#stage').dataset.design,page:document.querySelector('#stage').dataset.page,
      title:group?.querySelector('h2')?.textContent.trim(),pressed:button?.getAttribute('aria-pressed'),disabled:button?.disabled,label:button?.textContent,
      grouped:!!group&&['[data-window-aspect]','#reduced-motion','[data-quality=wave]','#quality-preset','.quality-settings'].every(selector=>group.querySelector(selector)),
      counts:Object.fromEntries(['select[data-window-aspect]','#reduced-motion','select[data-quality=wave]','[data-action=fullscreen]','#quality-preset'].map(selector=>[selector,document.querySelectorAll(selector).length])),
      unique:['select[data-window-aspect]','#reduced-motion','select[data-quality=wave]','[data-action=fullscreen]','#quality-preset'].every(selector=>document.querySelectorAll(selector).length===1),
      motionGroup:!!group?.querySelector('.graphics-motion-settings #reduced-motion')&&!!group?.querySelector('.graphics-motion-settings [data-quality=wave]'),
      renderWithoutMotion:!group?.querySelector('.quality-settings [data-quality=wave]'),
      gpu:{value:group?.querySelector('[data-gpu-preference]')?.value,disabled:group?.querySelector('[data-gpu-preference]')?.disabled,
        options:[...group?.querySelectorAll('[data-gpu-preference] option')||[]].map(option=>({value:option.value,label:option.textContent,disabled:option.disabled})),
        status:group?.querySelector('[data-gpu-status]')?.textContent,error:group?.querySelector('[data-gpu-error]')?.textContent,active:group?.querySelector('[data-gpu-active]')?.textContent},
      prefs:JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}')};
  })()`);
  const until = async (predicate, label) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { const state = await snapshot(); if (predicate(state)) return state; await pause(100); }
    const state = await snapshot();
    throw new Error(`Timed out: ${label}, ${JSON.stringify({design:state.design,page:state.page,pressed:state.pressed,disabled:state.disabled,gpu:state.gpu})}`);
  };
  const screenshots = [];
  const capture = async (name, selector) => {
    await evaluate(`(() => {const page=document.querySelector('#theme-page-content'),node=document.querySelector(${JSON.stringify(selector)});page.scrollTop+=node.getBoundingClientRect().top-page.getBoundingClientRect().top-12;})()`);
    await pause(500);
    const file = path.join(outputDirectory, `graphics-${name}.png`);
    await fs.writeFile(file, (await browserWindow.capturePage()).toPNG());
    screenshots.push(file);
  };
  const cases = [];
  wc.setBackgroundThrottling(false);
  try {
    if (await evaluate(`document.querySelector('#music-theme-page').hidden`)) {
      await click('.music-topnav [data-action=theme]');
      await until(state => state.page === 'theme' && state.grouped, 'open Graphics');
    }
    for (const design of ['rhine', 'archive']) {
      await click(`.design-family-card[data-style-design=${design}]`);
      const before = await until(state => state.design === design && state.grouped, `${design} settings`);
      assert.ok(before.unique && before.motionGroup && before.renderWithoutMotion, `Settings grouping: ${JSON.stringify({counts:before.counts,motionGroup:before.motionGroup,renderWithoutMotion:before.renderWithoutMotion})}`);
      const bounds = browserWindow.getBounds();
      browserWindow.focus();
      await pause(150);
      await click('[data-action=fullscreen]');
      const entered = await until(state => browserWindow.isFullScreen() && state.pressed === 'true' && !state.disabled, `${design} enter fullscreen`);
      assert.equal(entered.page, 'theme');
      await click('[data-action=fullscreen]');
      await until(state => !browserWindow.isFullScreen() && state.pressed === 'false' && !state.disabled, `${design} exit fullscreen`);
      await click('[data-action=fullscreen]');
      await until(state => browserWindow.isFullScreen() && !state.disabled, `${design} reenter fullscreen`);
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      const after = await until(state => !browserWindow.isFullScreen() && state.pressed === 'false' && !state.disabled, `${design} Escape exit`);
      assert.equal(after.page, 'theme', 'Exiting fullscreen must keep the Graphics route');
      assert.deepEqual(after.prefs, before.prefs, 'Window controls must not change saved graphics preferences');
      assert.ok(Object.entries(browserWindow.getBounds()).every(([key,value])=>Math.abs(value-bounds[key])<=1), 'Fullscreen exit must restore the original window bounds within Windows DPI rounding');
      const gpuLoaded = await until(state => !state.gpu.disabled && state.gpu.options.length > 1, `${design} usable GPU list`);
      assert.equal(gpuLoaded.gpu.error, '', 'Real hardware enumeration must succeed');
      assert.ok(!/Not yet confirmed|尚未确认/.test(gpuLoaded.gpu.active), 'Current driver-reported GPU must be shown');
      const previousGpu = gpuLoaded.gpu.value;
      const alternative = previousGpu === 'auto' ? gpuLoaded.gpu.options[1].value : 'auto';
      await evaluate(`(() => {const select=document.querySelector('[data-gpu-preference]');select.value=${JSON.stringify(alternative)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      const saved = await until(state => !state.gpu.disabled && state.gpu.value === alternative && /Saved|已保存/.test(state.gpu.status), `${design} save GPU preference`);
      assert.ok(/reopen|重新打开/.test(saved.gpu.status), 'A changed startup GPU preference must explain the required restart');
      const invalidSelectionRejected = await evaluate(`window.rhineDesktop.selectGpu('untrusted-adapter-id').then(()=>false,()=>true)`);
      assert.equal(invalidSelectionRejected, true, 'Forged/nonexistent adapter IDs must not be accepted');
      await evaluate(`(() => {const select=document.querySelector('[data-gpu-preference]');select.value=${JSON.stringify(previousGpu)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(state => !state.gpu.disabled && state.gpu.value === previousGpu && /Saved|已保存/.test(state.gpu.status), `${design} restore GPU preference`);
      await capture(`${design}-window-motion`, '#graphics-display-settings');
      await capture(`${design}-gpu`, '#graphics-display-settings .gpu-settings');
      await capture(`${design}-render`, '#graphics-display-settings .quality-settings');
      cases.push({ design, grouped: true, unique: true, nativeEnterAndExit: true, escapeExit: true, boundsRestored: true, gpuChoices: gpuLoaded.gpu.options, activeGpu: gpuLoaded.gpu.active, gpuSaveAndReset: true, invalidGpuRejected: true });
    }
    return { ok: true, cases, screenshots };
  } finally {
    if (!browserWindow.isDestroyed()) { if (browserWindow.isFullScreen()) browserWindow.setFullScreen(false); wc.setBackgroundThrottling(true); }
  }
}
