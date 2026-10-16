import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import ts from "typescript";

function createSourceTree(source, fileName) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
}

function findFunction(tree, name) {
  const node = tree.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(node, `Could not extract production ${name} for unified controls.`);
  return node;
}

function findVariable(tree, name) {
  const node = tree.statements.find(statement =>
    ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
      ts.isIdentifier(declaration.name) && declaration.name.text === name,
    ),
  );
  assert.ok(node, `Could not extract production ${name} for unified controls.`);
  return node;
}

function transpile(source, fileName) {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

function extractProcessingInput(tree) {
  let callback;
  const walk = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "document.addEventListener" &&
      ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "input") {
      const candidate = node.arguments[1];
      if ((ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) &&
        candidate.getText(tree).includes("updateProcessingField(el)")) callback = candidate;
    }
    ts.forEachChild(node, walk);
  };
  walk(tree);
  assert.ok(callback, "Could not extract the production processing input handler.");
  return callback;
}

function splitShadowLayers(value) {
  if (!value || value === "none") return [];
  const layers = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++;
    else if (value[index] === ")") depth--;
    else if (value[index] === "," && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers;
}

function insetOnly(value) {
  return value === "none" || splitShadowLayers(value).every(layer => /\binset\b/.test(layer));
}

export async function checkUnifiedControls({ command, evaluate, output, project }) {
  assert.ok(command && evaluate && output && project, "Unified controls need the shared offline browser fixture.");
  await mkdir(output, { recursive: true });

  const appSource = await readFile(path.join(project, "src/music-app.ts"), "utf8");
  const appTree = createSourceTree(appSource, "music-app.ts");
  const settingsMarkup = transpile([
    findVariable(appTree, "settingsCategories").getText(appTree),
    findVariable(appTree, "audioSettingsSections").getText(appTree),
    findFunction(appTree, "settingsNavigationMarkup").getText(appTree),
  ].join("\n"), "unified-settings-markup.ts");
  const settingsRenderer = transpile([
    findFunction(appTree, "selectSettingsCategory").getText(appTree),
    findFunction(appTree, "renderSettingsPage").getText(appTree),
  ].join("\n"), "unified-settings-renderer.ts");
  const onlineRenderer = transpile([
    findFunction(appTree, "renderOnlinePanel").getText(appTree),
    findFunction(appTree, "drawShelfSwitch").getText(appTree),
    findFunction(appTree, "drawOnlineSources").getText(appTree),
  ].join("\n"), "unified-online-renderer.ts");
  const updateProcessingField = transpile(
    findFunction(appTree, "updateProcessingField").getText(appTree),
    "unified-processing-field.ts",
  );
  const processingInput = transpile(
    `const productionProcessingInput = ${extractProcessingInput(appTree).getText(appTree)};`,
    "unified-processing-input.ts",
  );

  const bundle = await build({
    stdin: {
      contents: `
        export { renderEqControls, setupEqControls } from "./src/eq-controls";
        export { normalizeProcessing } from "./src/audio-processing-model.mjs";
        export { enhanceSettingsSelectControls } from "./src/settings-select-controls";
        export { setupTerminalLighting } from "./src/terminal-lighting";
        export { syncPunkEqInstruments } from "./src/punk-eq-instruments";
      `,
      resolveDir: project,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "UnifiedControlsFixture",
    define: { "import.meta.glob": "fixtureGlob" },
    banner: { js: "const fixtureGlob = () => ({});" },
    logLevel: "silent",
  });

  await evaluate(bundle.outputFiles[0].text);
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const original = await evaluate(`(() => {
    const stage = fixture.stage;
    const settings = document.querySelector('#music-settings');
    const eqPage = document.querySelector('#music-eq-page');
    const scrim = document.querySelector('.music-panel-scrim');
    const panel = document.querySelector('.music-panel');
    const body = document.querySelector('#panel-body');
    const attr = (node, name) => node?.getAttribute(name) ?? null;
    return {
      stage: Object.fromEntries(['design','theme','page','layout','terminalLighting','playbackVisible'].map(key => [key, stage.dataset[key] ?? null])),
      shellHidden: document.querySelector('.foobar-shell')?.hidden ?? true,
      settings: { hidden: settings.hidden, inert: settings.inert, content: document.querySelector('#settings-page-content').innerHTML, nav: settings.querySelector('.settings-page-nav').innerHTML },
      themePage: { hidden: document.querySelector('#music-theme-page').hidden, inert: document.querySelector('#music-theme-page').inert },
      eqPage: { hidden: eqPage.hidden, inert: eqPage.inert, content: document.querySelector('#eq-page-content').innerHTML },
      scrim: { hidden: scrim.hidden, display: scrim.style.display, body: body.innerHTML, maxHeight: panel.style.maxHeight },
      browseHidden: document.querySelector('#music-browse')?.hidden ?? false,
      detailHidden: document.querySelector('#music-detail')?.hidden ?? false,
      themeButtons: [...document.querySelectorAll('.theme-switch button[data-theme]')].map(node => node.getAttribute('aria-pressed')),
    };
  })()`);

  const report = {
    viewport: { width: 1280, height: 900 },
    settings: {},
    onlineModal: {},
    lighting: {},
    eq: {},
    punk: {},
    screenshots: [],
  };

  const capture = async name => {
    const { data } = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(output, name), Buffer.from(data, "base64"));
    report.screenshots.push(name);
  };
  const waitPaint = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const captureFaderAlignment = async (selector, name) => {
    await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)});input.scrollIntoView({block:'center',behavior:'instant'}); })()`);
    await waitPaint();
    const rect = await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)});const r=input.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {left:r.left,top:r.top,width:r.width,height:r.height,visible:r.top>=0&&r.bottom<=innerHeight,hitRange:hit===input||input.contains(hit)}; })()`);
    assert.equal(rect.visible, true, `Fader paint target ${selector} must be fully in view.`);
    assert.equal(rect.hitRange, true, `Fader paint target ${selector} must receive pointer hits.`);
    const clip = { x: Math.max(0, Math.floor(rect.left) - 8), y: Math.max(0, Math.floor(rect.top) - 8),
      width: Math.ceil(rect.width) + 16, height: Math.ceil(rect.height) + 16, scale: 1 };
    const image = await command("Page.captureScreenshot", { format: "png", clip });
    await writeFile(path.join(output, name), Buffer.from(image.data, "base64"));
    report.screenshots.push(name);
    const pixels = await evaluate(`(async() => {
      const image=new Image();image.src='data:image/png;base64,${image.data}';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
      const data=context.getImageData(0,0,canvas.width,canvas.height).data;
      const color=(x,y)=>Array.from(data.slice((y*canvas.width+x)*4,(y*canvas.width+x)*4+3));
      const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
      const runs=values=>{const result=[];for(const value of values){const last=result[result.length-1];if(last&&value===last.end+1)last.end=value;else result.push({start:value,end:value});}return result;};
      const left=${rect.left - clip.x},top=${rect.top - clip.y},width=${rect.width},height=${rect.height};
      const centerX=left+width/2,centerY=top+height/2,background=(y)=>color(2,Math.max(1,Math.min(canvas.height-2,Math.round(y))));
      const scan=(y,threshold)=>{const base=background(y),values=[];for(let x=Math.max(2,Math.floor(left));x<Math.min(canvas.width-2,Math.ceil(left+width));x++)if(distance(color(x,y),base)>=threshold)values.push(x);return runs(values);};
      const railY=Math.max(2,Math.min(canvas.height-3,Math.round(top+height*.22)));
      const railRuns=scan(railY,18).filter(run=>run.end-run.start<12);
      const rail=railRuns.sort((a,b)=>Math.abs((a.start+a.end)/2-centerX)-Math.abs((b.start+b.end)/2-centerX))[0];
      const thumbY=Math.max(2,Math.min(canvas.height-3,Math.round(centerY+3)));
      const thumbRuns=scan(thumbY,18).filter(run=>run.end-run.start>4);
      const thumb=thumbRuns.sort((a,b)=>Math.abs((a.start+a.end)/2-centerX)-Math.abs((b.start+b.end)/2-centerX))[0];
      return {clip:{width:canvas.width,height:canvas.height},railY,thumbY,
        rail:rail?{left:rail.start,right:rail.end,width:rail.end-rail.start+1,center:(rail.start+rail.end)/2}:null,
        thumb:thumb?{left:thumb.start,right:thumb.end,width:thumb.end-thumb.start+1,center:(thumb.start+thumb.end)/2}:null,
        delta:rail&&thumb?Math.abs((rail.start+rail.end-thumb.start-thumb.end)/2):null};
    })()`);
    return { ...pixels, input:{width:rect.width,height:rect.height}, screenshot:name };
  };
  const captureResponsePanel = async (name) => {
    await evaluate(`(() => { document.querySelector('#eq-page-content .eq-response-figure').scrollIntoView({block:'center',behavior:'instant'}); })()`);
    await waitPaint();
    const rect = await evaluate(`(() => { const figure=document.querySelector('#eq-page-content .eq-response-figure'),r=figure.getBoundingClientRect(),playback=document.querySelector('#music-playback').getBoundingClientRect(),legend=figure.querySelector('.eq-response-legend').getBoundingClientRect(),caption=figure.querySelector('figcaption').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewportHeight:innerHeight,playbackTop:playback.top,legend:{top:legend.top,bottom:legend.bottom},caption:{top:caption.top,bottom:caption.bottom},border:[getComputedStyle(figure).borderTopWidth,getComputedStyle(figure).borderRightWidth,getComputedStyle(figure).borderBottomWidth,getComputedStyle(figure).borderLeftWidth],borderStyle:[getComputedStyle(figure).borderTopStyle,getComputedStyle(figure).borderRightStyle,getComputedStyle(figure).borderBottomStyle,getComputedStyle(figure).borderLeftStyle],position:getComputedStyle(figure).position}; })()`);
    assert.equal(rect.position, 'static', 'The response figure follows the production #eq-page-editor layout.');
    assert.ok(rect.top >= 0 && rect.bottom <= rect.playbackTop, `The complete response figure must be visible above the fixed playback bar: ${JSON.stringify(rect)}`);
    assert.ok(rect.legend.top >= rect.top && rect.legend.bottom <= rect.bottom && rect.caption.top >= rect.top && rect.caption.bottom <= rect.bottom,
      `The response legend and caption stay inside the closed panel: ${JSON.stringify(rect)}`);
    assert.deepEqual(rect.border, ['1px','1px','1px','1px']);
    assert.ok(rect.borderStyle.every(value=>value==='solid'));
    const clip={x:Math.floor(rect.left),y:Math.floor(rect.top),width:Math.ceil(rect.right)-Math.floor(rect.left),height:Math.ceil(rect.bottom)-Math.floor(rect.top),scale:1};
    const image=await command('Page.captureScreenshot',{format:'png',clip});
    await writeFile(path.join(output,name),Buffer.from(image.data,'base64'));
    report.screenshots.push(name);
    return rect;
  };
  const auditShadow = async selector => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error('Missing real control: ' + ${JSON.stringify(selector)});
    const style = getComputedStyle(node);
    const shadow = style.boxShadow;
    let depth = 0, start = 0;
    const layers = [];
    for (let index = 0; index < shadow.length; index++) {
      if (shadow[index] === '(') depth++;
      else if (shadow[index] === ')') depth--;
      else if (shadow[index] === ',' && depth === 0) { layers.push(shadow.slice(start, index).trim()); start = index + 1; }
    }
    if (shadow !== 'none') layers.push(shadow.slice(start).trim());
    return { shadow, insetOnly: shadow === 'none' || layers.every(layer => /\\binset\\b/.test(layer)), background: style.backgroundColor, borderRadius: style.borderRadius, receiver: node.getAttribute('data-terminal-receiver') };
  })()`);

  let setupComplete = false;
  try {
    await evaluate(`(() => {
      const stage = fixture.stage;
      fixture.shell.setActive(false);
      const settings = document.querySelector('#music-settings');
      const eqPage = document.querySelector('#music-eq-page');
      const scrim = document.querySelector('.music-panel-scrim');
      settings.hidden = false; settings.inert = false;
      eqPage.hidden = true; eqPage.inert = true;
      document.querySelector('#music-theme-page').hidden = true;
      document.querySelector('#music-theme-page').inert = true;
      document.querySelector('#music-browse').hidden = true;
      document.querySelector('#music-detail').hidden = true;
      scrim.hidden = true;
      scrim.style.display = 'flex';
      stage.dataset.theme = 'day';
      stage.dataset.page = 'settings';
      stage.dataset.layout = 'desktop';
      stage.dataset.playbackVisible = 'true';
      document.querySelector('#settings-page-content').innerHTML = '';
      document.querySelector('#music-settings .settings-page-nav').innerHTML = '';
    })()`);
    await evaluate(`(() => {
      fixture.designProfiles.rhine = { style: structuredClone(fixture.defaultMusicStyle), mode: 'day' };
      fixture.designProfiles.archive = { style: structuredClone(fixture.archiveMusicStyle), mode: 'day' };
    })()`);
    await evaluate(`fixture.switchDesign('rhine')`);
    await evaluate(`fixture.setTheme('day')`);
    await evaluate(`fixture.setPage('settings')`);

    const settingsBootstrap = `(() => {
      const trUi = value => value;
      const ui = (strings, ...values) => strings.reduce((text, part, index) => text + part + (values[index] ?? ''), '');
      const uiLanguage = () => 'en';
      const $ = selector => document.querySelector(selector);
      const preferences = { theme: 'day', style: { design: 'rhine' }, output: { backend: 'browser' }, volume: .65, songFade: true, reduced: false, sound: true, soundVolume: .3, bgm: false, bgmVolume: .2 };
      const themeNames = { day: 'DAY', night: 'NIGHT' };
      const sortLabels = { genre: { name: 'Genre' }, artist: { name: 'Artist' }, album: { name: 'Album' } };
      const musicArrangementPreset = () => 'genre';
      const dsdRouteSettingsMarkup = () => '';
      const outputSettingsMarkup = () => '';
      const sonySettingsMarkup = () => '';
      const ftpSettingsMarkup = () => '';
      const replayGainMarkup = () => '';
      const transitionMarkup = () => '';
      const resamplingMarkup = () => '';
      const precisionMarkup = () => '';
      const bufferMarkup = () => '';
      const setupLyricsSettings = () => ({ destroy() {}, refresh() {} });
      const enhanceSettingsSelectControls = UnifiedControlsFixture.enhanceSettingsSelectControls;
      const settingsScrollPositions = new Map();
      let settingsCategory = 'appearance';
      let audioSettingsSection = 'source';
      let settingsSelectControls;
      let eqControls;
      let standardEqPresets;
      let lyricsSettings;
      const editableRanges = fixture.ranges;
      const processingRestoreError = '';
      const notify = () => {};
      const markAudioSettingsSection = () => {};
      const syncAudioSettingsLocation = () => {};
      const updateCurrentAudioSummary = () => {};
      const updateIntroductionStatus = () => {};
      const updateSonyUI = () => {};
      const refreshSonyStatus = () => Promise.resolve();
      const refreshFtpStatus = () => Promise.resolve();
      const updateOutputUI = () => {};
      const updateProcessingSupportStatus = () => {};
      const syncProcessingPresetUi = () => {};
      const showProcessingPresetStatus = () => {};
      const refreshNativeStatus = () => Promise.resolve();
      ${settingsMarkup}
      ${settingsRenderer}
      const navigation = document.querySelector('#music-settings .settings-page-nav');
      navigation.innerHTML = settingsNavigationMarkup();
      renderSettingsPage();
      selectSettingsCategory('appearance');
      window.unifiedSettings = {
        select: selectSettingsCategory,
        close: () => settingsSelectControls?.close(),
        destroy: () => settingsSelectControls?.destroy(),
      };
      return { categories: document.querySelectorAll('#settings-page-content > .settings-category').length, current: document.querySelector('#music-settings .settings-page-nav [aria-current="page"]')?.dataset.settingsCategoryTarget ?? null };
    })()`;
    report.settings = await evaluate(settingsBootstrap);
    assert.ok(report.settings.categories >= 6, "The real settings renderer must create its production categories.");
    assert.equal(report.settings.current, "appearance", "The production settings navigation selects the active category.");
    await waitPaint();

    const selectAudit = await evaluate(`(() => {
      const trigger = document.querySelector('#appearance-settings .settings-select-trigger');
      if (!trigger) throw new Error('The production settings select did not render its custom trigger.');
      trigger.click();
      const menu = [...document.querySelectorAll('.settings-select-menu')].find(node => !node.hidden);
      if (!menu) throw new Error('The production custom select did not open its menu.');
      const style = getComputedStyle(menu);
      const scrollbar = getComputedStyle(menu, '::-webkit-scrollbar');
      return { triggerRadius: getComputedStyle(trigger).borderRadius, menuRadius: style.borderRadius, menuBackground: style.backgroundColor, menuShadow: style.boxShadow, scrollbarWidth: scrollbar.width };
    })()`);
    assert.notEqual(selectAudit.triggerRadius, "0px", "Future custom selects keep their rounded material edge.");
    assert.notEqual(selectAudit.menuRadius, "0px", "Future select menus have a closed rounded edge.");
    assert.notEqual(selectAudit.menuBackground, "rgba(0, 0, 0, 0)", "The custom select menu needs a material surface.");
    await evaluate(`document.querySelector('#appearance-settings .settings-select-trigger')?.click()`);
    await evaluate(`unifiedSettings.select('interface')`);
    report.settings.current = "interface";
    await waitPaint();
    const settingsControlAudit = await evaluate(`(() => {
      const range=document.querySelector('#interface-sound-settings input[type="range"]');
      const toggle=document.querySelector('#interface-sound-settings input[type="checkbox"][role="switch"]');
      const rangeTrack=getComputedStyle(range,'::-webkit-slider-runnable-track');
      const rangeThumb=getComputedStyle(range,'::-webkit-slider-thumb');
      const toggleThumb=getComputedStyle(toggle,'::after');
      const themeCard=document.querySelector('#appearance-settings .theme-cards button[data-theme="day"]');
      const trackRule=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules];}catch{return [];}})
        .find(rule=>rule.selectorText?.includes('#music-settings')&&rule.selectorText.includes('::-webkit-slider-runnable-track')&&rule.style?.height==='3px');
      return {
        range:{appearance:getComputedStyle(range).appearance,writingMode:getComputedStyle(range).writingMode,
          design:fixture.stage.dataset.design,insideSettings:Boolean(range.closest('#music-settings')),
          matchesFutureSelector:range.matches('html .music-app[data-design="rhine"] :is(#music-settings, #music-theme-page, .music-panel:has(#online-body)) input[type="range"]'),
          trackRule:trackRule?{selector:trackRule.selectorText,height:trackRule.style.height}:null},
        toggle:{appearance:getComputedStyle(toggle).appearance,radius:getComputedStyle(toggle).borderRadius,checked:toggle.checked,thumbRadius:toggleThumb.borderRadius,thumbWidth:toggleThumb.width},
        themeCard:{shadow:getComputedStyle(themeCard).boxShadow,background:getComputedStyle(themeCard).backgroundColor,radius:getComputedStyle(themeCard).borderRadius},
        tabs:[...document.querySelectorAll('#music-settings .settings-page-nav [data-settings-category-target]')].map(node=>({target:node.dataset.settingsCategoryTarget,current:node.getAttribute('aria-current')})),
      };
    })()`);
    const sliderRect = await evaluate(`(() => { const rect=document.querySelector('#interface-sound-settings input[type="range"]').getBoundingClientRect(); return {x:rect.left,y:rect.top,width:rect.width,height:rect.height}; })()`);
    const sliderShot = await command("Page.captureScreenshot", { format: "png", clip: { ...sliderRect, scale: 1 } });
    await writeFile(path.join(output, "future-settings-slider-geometry.png"), Buffer.from(sliderShot.data, "base64"));
    report.screenshots.push("future-settings-slider-geometry.png");
    const sliderPixelAudit = await evaluate(`(async() => {
      const image=new Image();image.src='data:image/png;base64,${sliderShot.data}';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      const color=(x,y)=>Array.from(pixels.slice((y*canvas.width+x)*4,(y*canvas.width+x)*4+3));
      const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
      const sampleX=Math.max(1,Math.min(canvas.width-2,Math.floor(canvas.width*.84)));
      const baseline=color(sampleX,1),rows=[];
      for(let y=1;y<canvas.height-1;y++){
        let changed=0;for(let x=3;x<canvas.width-3;x++)if(distance(color(x,y),baseline)>20)changed++;
        if(changed>canvas.width*.55)rows.push(y);
      }
      return {width:canvas.width,height:canvas.height,baseline,trackRows:rows,trackHeight:rows.length};
    })()`);
    settingsControlAudit.range.pixelTrack = sliderPixelAudit;
    assert.equal(settingsControlAudit.range.appearance, "none", "Future settings ranges suppress the native duplicate track.");
    assert.equal(settingsControlAudit.range.writingMode, "horizontal-tb");
    assert.equal(settingsControlAudit.range.trackRule?.height, "3px", `Future settings slider CSS declaration: ${JSON.stringify(settingsControlAudit.range)}`);
    assert.equal(settingsControlAudit.range.matchesFutureSelector, true);
    assert.equal(sliderPixelAudit.trackHeight, 3, `Painted Future slider track geometry: ${JSON.stringify(sliderPixelAudit)}`);
    assert.equal(settingsControlAudit.toggle.appearance, "none");
    assert.equal(settingsControlAudit.toggle.radius, "999px");
    assert.equal(settingsControlAudit.toggle.checked, true);
    assert.equal(settingsControlAudit.toggle.thumbRadius, "50%");
    assert.equal(settingsControlAudit.toggle.thumbWidth, "16px");
    assert.ok(insetOnly(settingsControlAudit.themeCard.shadow), `Future theme card keeps inset-only button feedback: ${settingsControlAudit.themeCard.shadow}`);
    assert.notEqual(settingsControlAudit.themeCard.background, "rgba(0, 0, 0, 0)");
    assert.notEqual(settingsControlAudit.themeCard.radius, "0px");
    assert.equal(settingsControlAudit.tabs.filter(tab => tab.current === "page").length, 1, "The production settings tabs keep one current category.");
    assert.equal(settingsControlAudit.tabs.find(tab => tab.target === "interface")?.current, "page");
    report.settings.controls = settingsControlAudit;

    const onlineBootstrap = `(() => {
      const trUi = value => value;
      const ui = (strings, ...values) => strings.reduce((text, part, index) => text + part + (values[index] ?? ''), '');
      const esc = value => String(value ?? '');
      const $ = selector => document.querySelector(selector);
      const panel = 'online';
      let shelf = 'online';
      let onlineSources;
      let onlineSnapshot;
      const onlineSearch = { source: 'internetarchive', collection: 'featured', q: '' };
      const onlineCollections = [['featured', '精选合集'], ['all', '全部']];
      const requestCalls = [];
      const request = async endpoint => {
        requestCalls.push(endpoint);
        if (endpoint === '/api/online/sources') return { sources: [{ id: 'internetarchive', configured: true }] };
        if (endpoint === '/api/online/library') return { albums: [] };
        throw new Error('Unexpected service request in the offline fixture: ' + endpoint);
      };
      const updateOnlineSourceNote = () => {};
      const drawOnlineResults = () => {};
      const drawOnlineList = () => {};
      const drawSubsonicForm = () => {};
      ${onlineRenderer}
      return renderOnlinePanel().then(() => ({ requestCalls, source: document.querySelector('#online-source')?.value ?? null, collection: document.querySelector('#online-collection')?.value ?? null, shelfButtons: document.querySelectorAll('#shelf-switch > button').length }));
    })()`;
    report.onlineModal = await evaluate(onlineBootstrap);
    assert.deepEqual(report.onlineModal.requestCalls, ["/api/online/sources", "/api/online/library"], "The production online renderer uses only the mocked local service boundary.");
    assert.equal(report.onlineModal.source, "internetarchive");
    assert.equal(report.onlineModal.collection, "featured");
    assert.equal(report.onlineModal.shelfButtons, 2, "The real online shelf switch renders both production actions.");
    await evaluate(`(() => { const panel = document.querySelector('.music-panel'); panel.style.maxHeight = '240px'; document.querySelector('.music-panel-scrim').hidden = false; })()`);
    await waitPaint();

    const dialogStyle = await evaluate(`(() => {
      const panel = document.querySelector('.music-panel:has(#online-body)');
      const style = getComputedStyle(panel);
      const bar = getComputedStyle(panel, '::-webkit-scrollbar');
      const track = getComputedStyle(panel, '::-webkit-scrollbar-track');
      const thumb = getComputedStyle(panel, '::-webkit-scrollbar-thumb');
      const button = getComputedStyle(panel, '::-webkit-scrollbar-button');
      const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=thumb.backgroundColor;ctx.fillRect(0,0,1,1);const thumbAlpha=ctx.getImageData(0,0,1,1).data[3]/255;
      return { scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight, scrollbarWidth: style.scrollbarWidth, scrollbarColor: style.scrollbarColor, webkitWidth: bar.width, track: track.backgroundColor, thumb: thumb.backgroundColor, thumbAlpha, buttonDisplay: button.display, buttonWidth: button.width, panelRadius: style.borderRadius, panelOverflow: style.overflowY };
    })()`);
    assert.ok(dialogStyle.scrollHeight > dialogStyle.clientHeight, "The online modal fixture must exercise its vertical scrollbar.");
    assert.equal(dialogStyle.scrollbarWidth, "thin");
    assert.equal(dialogStyle.webkitWidth, "7px");
    assert.match(dialogStyle.track, /rgba\(0, 0, 0, 0\)|transparent/, "Online scrollbar track stays transparent.");
    assert.ok(dialogStyle.thumbAlpha > 0 && dialogStyle.thumbAlpha <= .45, `Online scrollbar thumb stays low contrast: ${dialogStyle.thumbAlpha}`);
    assert.equal(dialogStyle.buttonDisplay, "none", "WebKit scrollbar arrows are removed.");
    assert.notEqual(dialogStyle.panelRadius, "0px");
    report.onlineModal.scrollbar = dialogStyle;

    const switchAudit = await evaluate(`(() => {
      const switcher = document.querySelector('.music-header .theme-switch');
      const buttons = [...switcher.querySelectorAll('button[data-theme]')];
      const buttonStyle = button => { const style = getComputedStyle(button); return { pressed: button.getAttribute('aria-pressed'), background: style.backgroundColor, border: style.borderWidth, radius: style.borderRadius, shadow: style.boxShadow }; };
      const pill = getComputedStyle(switcher, '::before');
      return { buttons: buttons.map(buttonStyle), pill: { radius: pill.borderRadius, backgroundImage: pill.backgroundImage, shadow: pill.boxShadow }, switcherShadow: getComputedStyle(switcher).boxShadow };
    })()`);
    assert.equal(switchAudit.buttons.length, 2, "The real day/night switch must render two controls.");
    for (const button of switchAudit.buttons) {
      assert.equal(button.background, "rgba(0, 0, 0, 0)", "Day/night labels stay transparent over their shared pill.");
      assert.equal(button.border, "0px", "Day/night labels have no rectangular button border.");
      assert.ok(insetOnly(button.shadow), `Day/night label shadow must be inset-only: ${button.shadow}`);
      assert.notEqual(button.radius, "0px");
    }
    assert.notEqual(switchAudit.pill.radius, "0px", "The selection pill stays rounded.");
    assert.match(switchAudit.pill.backgroundImage, /linear-gradient/i, "The day pill uses the shared Future material.");
    assert.ok(insetOnly(switchAudit.pill.shadow), `Day/night pill shadow must be inset-only: ${switchAudit.pill.shadow}`);
    assert.ok(insetOnly(switchAudit.switcherShadow), `Day/night container shadow must be inset-only: ${switchAudit.switcherShadow}`);
    report.settings.themeSwitch = switchAudit;
    await capture("future-controls-day.png");

    const lightSetup = await evaluate(`(() => {
      const stage = fixture.stage;
      const lighting = UnifiedControlsFixture.setupTerminalLighting(stage);
      window.unifiedControlsHarness = { lighting };
      return true;
    })()`);
    assert.equal(lightSetup, true);
    await evaluate(`document.querySelector('.music-panel-scrim').hidden = true`);
    await waitPaint();
    const setLighting = async mode => {
      await evaluate(`(() => { unifiedControlsHarness.lighting.setQuality({ terminalLight: ${JSON.stringify(mode)} }); unifiedControlsHarness.lighting.setDirection({x:-0.72,y:0.42}); unifiedControlsHarness.lighting.refresh(); })()`);
      await waitPaint();
      return evaluate(`(() => {
        const stage = fixture.stage;
        const receivers = [...stage.querySelectorAll('[data-terminal-receiver]')];
        const controls = receivers.filter(node => node.getAttribute('data-terminal-receiver') === 'control');
        const surfaces = receivers.filter(node => node.getAttribute('data-terminal-receiver') === 'surface');
        const activeNav = document.querySelector('#music-settings .settings-page-nav [aria-current="page"]');
        return { mode: stage.dataset.terminalLighting, count: receivers.length, controlCount: controls.length, surfaceCount: surfaces.length, activeNav: activeNav?.getAttribute('data-terminal-receiver') ?? null, activeLevel: Number(activeNav?.style.getPropertyValue('--terminal-light-level') || 0), settingsSurface: document.querySelector('#music-settings .settings-category[data-settings-category="interface"]')?.getAttribute('data-terminal-receiver') ?? null, idleButton: document.querySelector('#music-settings [data-action="sound-preview"]')?.getAttribute('data-terminal-receiver') ?? null };
      })()`);
    };
    const offLighting = await setLighting("off");
    assert.equal(offLighting.mode, "off");
    assert.equal(offLighting.count, 0, "Off quality restores all terminal receivers.");
    report.lighting.off = offLighting;

    const localLighting = await setLighting("local");
    assert.equal(localLighting.mode, "local");
    assert.equal(localLighting.settingsSurface, "surface", "The active settings surface receives environment light.");
    assert.equal(localLighting.activeNav, "control", "The current settings tab receives interaction light.");
    assert.ok(localLighting.activeLevel > 0, "Local terminal light computes a positive control level.");
    assert.ok(localLighting.count <= 18, `Local lighting keeps its receiver limit: ${localLighting.count}`);
    assert.equal(localLighting.idleButton, null, "Idle settings buttons are not lighting receivers.");
    report.lighting.local = localLighting;

    const dayButtonPoint = await evaluate(`(() => { const node=document.querySelector('.theme-switch button[data-theme="day"]'); const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: dayButtonPoint.x, y: dayButtonPoint.y, button: "none" });
    await evaluate(`unifiedControlsHarness.lighting.refresh()`);
    await waitPaint();
    const dayHover = await auditShadow('.theme-switch button[data-theme="day"]');
    const dayContainer = await auditShadow('.music-header .theme-switch');
    assert.equal(dayHover.receiver, null, "The theme labels do not cast separate receiver shadows.");
    assert.ok(insetOnly(dayHover.shadow), `Hovered day label has no external shadow: ${dayHover.shadow}`);
    assert.equal(dayContainer.receiver, "surface", "The day/night control receives light at its shared container.");
    assert.ok(insetOnly(dayContainer.shadow), `The shared theme container uses inset environment light: ${dayContainer.shadow}`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0, button: "none" });
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const themeFocus = await evaluate(`(() => { const node=document.querySelector('.theme-switch button[data-theme="night"]'); node.focus(); return {visible:node.matches(':focus-visible'),active:document.activeElement===node}; })()`);
    await evaluate(`unifiedControlsHarness.lighting.refresh()`);
    await waitPaint();
    const nightFocus = await auditShadow('.theme-switch button[data-theme="night"]');
    assert.equal(themeFocus.active, true);
    assert.equal(themeFocus.visible, true, "Theme focus test uses the keyboard-visible state.");
    assert.equal(nightFocus.receiver, null, "A focused day/night label still uses the shared container light.");
    assert.ok(insetOnly(nightFocus.shadow), `Focused night label has no external shadow: ${nightFocus.shadow}`);
    report.lighting.themeHover = { button: dayHover, container: dayContainer };
    report.lighting.themeFocus = { focus: themeFocus, button: nightFocus };

    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0, button: "none" });
    const hoverTarget = await evaluate(`(() => { const node = document.querySelector('#music-settings [data-action="sound-preview"]'); node.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = node.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2, visible: r.top >= 0 && r.bottom <= innerHeight }; })()`);
    assert.equal(hoverTarget.visible, true, "Scroll the production settings target into view before testing hover lighting.");
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverTarget.x, y: hoverTarget.y, button: "none" });
    await evaluate(`unifiedControlsHarness.lighting.refresh()`);
    await waitPaint();
    const hoverShadow = await auditShadow('#music-settings [data-action="sound-preview"]');
    assert.equal(hoverShadow.receiver, "control", "A hovered production settings button receives the control layer.");
    assert.ok(hoverShadow.insetOnly, `Hovered settings button must not cast an outer halo: ${hoverShadow.shadow}`);
    report.lighting.hover = hoverShadow;

    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0, button: "none" });
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const focusAudit = await evaluate(`(() => {
      const target = document.querySelector('#music-settings [data-action="sound-preview"]');
      target.focus();
      return { visible: target.matches(':focus-visible'), active: document.activeElement === target };
    })()`);
    await evaluate(`unifiedControlsHarness.lighting.refresh()`);
    await waitPaint();
    const focusShadow = await auditShadow('#music-settings [data-action="sound-preview"]');
    assert.equal(focusAudit.active, true);
    assert.equal(focusAudit.visible, true, "Settings focus test uses the keyboard-visible state.");
    assert.equal(focusShadow.receiver, "control", "A keyboard-focused production settings button receives the control layer.");
    assert.ok(focusShadow.insetOnly, `Focused settings button must not cast an outer halo: ${focusShadow.shadow}`);
    report.lighting.focus = { ...focusAudit, ...focusShadow };

    const fullLighting = await setLighting("full");
    assert.equal(fullLighting.mode, "full");
    assert.ok(fullLighting.count <= 64, `Full lighting keeps its receiver limit: ${fullLighting.count}`);
    assert.ok(fullLighting.settingsSurface, "Full quality retains the settings environment surface.");
    assert.ok(fullLighting.activeLevel > 0, "Full terminal light computes a positive control level.");
    assert.ok(fullLighting.activeLevel >= localLighting.activeLevel, "Full quality retains at least the local directional-light level.");
    report.lighting.full = fullLighting;

    await evaluate(`(() => { document.querySelector('.music-panel-scrim').hidden = false; })()`);
    await waitPaint();
    const modalFullLighting = await setLighting("full");
    assert.equal(modalFullLighting.mode, "full");
    assert.ok(modalFullLighting.surfaceCount > 0, "Full lighting keeps the online modal as an ambient surface.");
    report.onlineModal.receiver = await evaluate(`document.querySelector('.music-panel:has(#online-body)').getAttribute('data-terminal-receiver')`);
    assert.equal(report.onlineModal.receiver, "surface", "The online modal receives environment light at its container surface.");
    const primary = await auditShadow('.music-panel:has(#online-body) .online-search .primary-button');
    assert.ok(primary.insetOnly, `Online search primary button keeps an inset-only material edge: ${primary.shadow}`);
    assert.notEqual(primary.background, "rgba(0, 0, 0, 0)", "Online search primary keeps a visible surface.");
    assert.notEqual(primary.borderRadius, "0px");
    assert.equal(primary.receiver, null, "Idle online controls do not receive unconditional terminal projections.");
    report.onlineModal.primary = primary;
    report.lighting.onlineFull = modalFullLighting;
    const onlineHoverPoint = await evaluate(`(() => { const node=document.querySelector('.music-panel:has(#online-body) .online-search .primary-button'); node.scrollIntoView({block:'center',behavior:'instant'}); const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,visible:r.top>=0&&r.bottom<=innerHeight}; })()`);
    assert.equal(onlineHoverPoint.visible, true, "Scroll the production online search control into view before testing hover lighting.");
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: onlineHoverPoint.x, y: onlineHoverPoint.y, button: "none" });
    await evaluate(`unifiedControlsHarness.lighting.refresh()`);
    await waitPaint();
    const onlineHover = await auditShadow('.music-panel:has(#online-body) .online-search .primary-button');
    assert.equal(onlineHover.receiver, "control", "A hovered online search button receives the modal interaction layer.");
    assert.ok(onlineHover.insetOnly, `Hovered online search button casts no external halo: ${onlineHover.shadow}`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0, button: "none" });
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const onlineFocus = await evaluate(`(() => { const node=document.querySelector('.music-panel:has(#online-body) .online-search .primary-button'); node.focus(); return {active:document.activeElement===node,visible:node.matches(':focus-visible')}; })()`);
    await evaluate(`unifiedControlsHarness.lighting.refresh()`);
    await waitPaint();
    const onlineFocusShadow = await auditShadow('.music-panel:has(#online-body) .online-search .primary-button');
    assert.equal(onlineFocus.active, true);
    assert.equal(onlineFocus.visible, true, "Online modal focus test uses the keyboard-visible state.");
    assert.equal(onlineFocusShadow.receiver, "control");
    assert.ok(onlineFocusShadow.insetOnly, `Focused online search button casts no external halo: ${onlineFocusShadow.shadow}`);
    report.lighting.onlineHover = onlineHover;
    report.lighting.onlineFocus = { ...onlineFocus, ...onlineFocusShadow };
    await evaluate(`fixture.setTheme('night')`);
    await waitPaint();
    const nightSwitchAudit = await evaluate(`(() => {
      const switcher=document.querySelector('.music-header .theme-switch');
      const buttons=[...switcher.querySelectorAll('button[data-theme]')];
      const style=button=>{const s=getComputedStyle(button);return{pressed:button.getAttribute('aria-pressed'),background:s.backgroundColor,border:s.borderWidth,radius:s.borderRadius,shadow:s.boxShadow};};
      const pill=getComputedStyle(switcher,'::before');
      return{buttons:buttons.map(style),pill:{radius:pill.borderRadius,backgroundImage:pill.backgroundImage,shadow:pill.boxShadow},switcherShadow:getComputedStyle(switcher).boxShadow};
    })()`);
    for (const button of nightSwitchAudit.buttons) {
      assert.equal(button.background, "rgba(0, 0, 0, 0)", "Night theme labels remain transparent over the shared pill.");
      assert.equal(button.border, "0px");
      assert.ok(insetOnly(button.shadow));
    }
    assert.notEqual(nightSwitchAudit.pill.radius, "0px");
    assert.match(nightSwitchAudit.pill.backgroundImage, /linear-gradient/i);
    assert.ok(insetOnly(nightSwitchAudit.pill.shadow));
    assert.ok(insetOnly(nightSwitchAudit.switcherShadow));
    report.settings.themeSwitchNight = nightSwitchAudit;
    await capture("future-controls-night.png");

    await evaluate(`(() => {
      const panel = document.querySelector('.music-panel-scrim'); panel.hidden = true;
      const eqPage = document.querySelector('#music-eq-page'); eqPage.hidden = false; eqPage.inert = false;
      document.querySelector('#music-settings').hidden = true;
      document.querySelector('#music-settings').inert = true;
      document.querySelector('#music-browse').hidden = true;
    })()`);
    await evaluate(`fixture.setPage('eq')`);

    const eqMount = `(() => {
      const U = UnifiedControlsFixture;
      let processingSettings = U.normalizeProcessing(undefined);
      const eqController = { current: undefined };
      let processingEditStart;
      let lastProcessingError = '';
      const trUi = value => value;
      const cloneProcessing = value => U.normalizeProcessing(value);
      const processingUndoSnapshot = () => JSON.stringify(processingSettings);
      const setProcessingSettings = value => {
        processingSettings = U.normalizeProcessing(value, { clamp: false });
        lastProcessingError = '';
        eqController.current?.sync();
        fixture.ranges.sync();
        return true;
      };
      ${updateProcessingField}
      ${processingInput}
      document.addEventListener('input', productionProcessingInput);
      window.unifiedProductionProcessingInput = productionProcessingInput;
      const buildState = mode => {
        const state = U.normalizeProcessing(undefined);
        state.eq.engine = 'standard'; state.eq.enabled = true; state.eq.mode = mode;
        const source = state.eq.bands;
        const count = mode === 'parametric' ? 6 : Math.max(10, source.length);
        state.eq.bands = source.slice(0, count).map((band, index) => ({ ...band, type: mode === 'parametric' ? 3 : 2, q: mode === 'parametric' ? .707 : band.q, gain: index === 0 ? -6 : index === 1 ? 0 : (index % 2 ? 3 : -2), enabled: true, locked: index === 0 }));
        return state;
      };
      const mount = async mode => {
        await eqController.current?.destroy();
        processingSettings = buildState(mode);
        const content = document.querySelector('#eq-page-content');
        content.innerHTML = '<div id="eq-page-editor">' + U.renderEqControls(processingSettings) + '</div>';
        const root = content.querySelector('.eq-controls');
        eqController.current = U.setupEqControls(root, () => processingSettings, next => { processingSettings = next; });
        root.querySelector('.eq-legend-item[data-eq-focus-band="1"]')?.click();
        fixture.ranges.sync();
        return { mode, bandCount: processingSettings.eq.bands.length };
      };
      window.unifiedEq = { mount, get state() { return processingSettings; }, get root() { return document.querySelector('#eq-page-content .eq-controls'); }, get controller() { return eqController.current; }, destroy: async () => await eqController.current?.destroy() };
      return mount('parametric');
    })()`;
    report.eq.parametricMount = await evaluate(eqMount);
    assert.equal(report.eq.parametricMount.mode, "parametric");
    await waitPaint();

    const rangeSelector = '#eq-page-content .eq-parametric-gain input[type="range"][data-processing-field="eq.bands.1.gain"]';
    const parametricAudit = await evaluate(`(() => {
      const root = document.querySelector('#eq-page-content .eq-controls');
      const range = root.querySelector('.eq-parametric-gain input[type="range"][data-processing-field="eq.bands.1.gain"]');
      const figure = root.querySelector('.eq-response-figure');
      const legend = root.querySelector('.eq-legend-item[data-eq-focus-band="1"]');
      const card = root.querySelector('[data-eq-band-card="1"]');
      const track = getComputedStyle(range, '::-webkit-slider-runnable-track');
      const thumb = getComputedStyle(range, '::-webkit-slider-thumb');
      const rangeRect = range.getBoundingClientRect();
      const readout = range.closest('.eq-parametric-gain')?.querySelector('.editable-range-value');
      const readoutRect = readout?.getBoundingClientRect();
      const cardIndex=card.querySelector('.eq-band-index');
      const colorContext=document.createElement('canvas').getContext('2d');
      const rgb=color=>{colorContext.clearRect(0,0,1,1);colorContext.fillStyle=color;colorContext.fillRect(0,0,1,1);return [...colorContext.getImageData(0,0,1,1).data].slice(0,3);};
      const cssRules=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules];}catch{return [];}});
      const trackRule=cssRules.find(rule=>rule.selectorText?.includes('.eq-parametric-gain')&&rule.selectorText.includes('::-webkit-slider-runnable-track'));
      const thumbRule=cssRules.find(rule=>rule.selectorText?.includes('.eq-parametric-gain')&&rule.selectorText.includes('::-webkit-slider-thumb')&&rule.style?.width==='13px');
      const stripTrackRule=cssRules.find(rule=>rule.selectorText?.includes('[data-eq-strip-scroll]')&&rule.selectorText.includes('::-webkit-slider-runnable-track')&&rule.style?.height==='2px');
      const stripThumbRule=cssRules.find(rule=>rule.selectorText?.includes('[data-eq-strip-scroll]')&&rule.selectorText.includes('::-webkit-slider-thumb')&&rule.style?.width==='18px');
      const panel = figure.getBoundingClientRect();
      const children = ['.eq-response-chart','.eq-response-legend','figcaption'].map(selector => { const r=figure.querySelector(selector).getBoundingClientRect(); return { selector, left:r.left, right:r.right, top:r.top, bottom:r.bottom }; });
      return {
        range: { rect: rangeRect.toJSON(), writingMode: getComputedStyle(range).writingMode, direction: getComputedStyle(range).direction, appearance: getComputedStyle(range).appearance, accentColor: getComputedStyle(range).accentColor, backgroundImage: getComputedStyle(range).backgroundImage, backgroundSize: getComputedStyle(range).backgroundSize, trackWidth: track.width, thumbWidth: thumb.width, thumbHeight: thumb.height,
          matchesFutureSelector:range.matches('html .music-app[data-design="rhine"] #music-eq-page .eq-controls:not([data-eq-engine="lsp"]) .eq-parametric-gain input[type="range"]'),
          trackRule:trackRule?{width:trackRule.style.width,height:trackRule.style.height}:null,thumbRule:thumbRule?{width:thumbRule.style.width,height:thumbRule.style.height}:null },
        readout: readoutRect?.toJSON() ?? null,
        readoutCenterDelta: readoutRect ? Math.abs((readoutRect.top + readoutRect.height / 2) - (rangeRect.top + rangeRect.height / 2)) : null,
        figure: { rect: panel.toJSON(), position:getComputedStyle(figure).position,radius: getComputedStyle(figure).borderRadius, overflow: getComputedStyle(figure).overflow, border: [getComputedStyle(figure).borderTopWidth,getComputedStyle(figure).borderRightWidth,getComputedStyle(figure).borderBottomWidth,getComputedStyle(figure).borderLeftWidth], borderStyles: [getComputedStyle(figure).borderTopStyle,getComputedStyle(figure).borderRightStyle,getComputedStyle(figure).borderBottomStyle,getComputedStyle(figure).borderLeftStyle], children, scroll: [figure.scrollWidth,figure.clientWidth] },
        selected: { card: card.classList.contains('is-selected'), cardIndexWeight:getComputedStyle(cardIndex).fontWeight, cardDotRgb:rgb(getComputedStyle(cardIndex.querySelector('i')).backgroundColor), curve: root.querySelectorAll('.eq-response-band-line.is-selected').length, legend: legend.classList.contains('is-selected'), pressed: legend.getAttribute('aria-pressed'), dots: legend.querySelectorAll('i').length, pseudo: getComputedStyle(legend,'::before').content, dotRgb:rgb(getComputedStyle(legend.querySelector('i')).backgroundColor), curveRgb:rgb(getComputedStyle(root.querySelector('.eq-response-band-line.is-selected')).stroke) },
        strip: (() => { const node=root.querySelector('[data-eq-strip-scroll]'); const style=getComputedStyle(node); const trackStyle=getComputedStyle(node,'::-webkit-slider-runnable-track'); const thumbStyle=getComputedStyle(node,'::-webkit-slider-thumb'); const baseRule=cssRules.find(rule=>rule.selectorText?.includes('.eq-strip-navigation')&&rule.selectorText.includes('[data-eq-strip-scroll]')&&!rule.selectorText.includes('::-webkit-')); const trackRule=cssRules.find(rule=>rule.selectorText?.includes('[data-eq-strip-scroll]')&&rule.selectorText.includes('::-webkit-slider-runnable-track')&&rule.style?.height==='2px'); const thumbRule=cssRules.find(rule=>rule.selectorText?.includes('[data-eq-strip-scroll]')&&rule.selectorText.includes('::-webkit-slider-thumb')&&rule.style?.width==='18px'); const accentRules=cssRules.filter(rule=>rule.style?.accentColor&&!rule.selectorText?.includes('::-webkit-')).filter(rule=>{try{return node.matches(rule.selectorText);}catch{return false;}}).map(rule=>({selector:rule.selectorText,accentColor:rule.style.accentColor})); return {disabled:node.disabled,writingMode:style.writingMode,direction:style.direction,appearance:style.appearance,accentColor:style.accentColor,matchesFutureSelector:node.matches('html .music-app[data-design="rhine"] .music-settings-page.music-eq-page .eq-strip-navigation input[type="range"][data-eq-strip-scroll]'),baseRule:baseRule?{selector:baseRule.selectorText,accentColor:baseRule.style.accentColor,height:baseRule.style.height}:null,accentRules,track:trackStyle.backgroundColor,trackHeight:trackStyle.height,thumbWidth:thumbStyle.width,thumbHeight:thumbStyle.height,thumb:thumbStyle.backgroundColor,trackRule:trackRule?{height:trackRule.style.height}:null,thumbRule:thumbRule?{width:thumbRule.style.width,height:thumbRule.style.height,background:thumbRule.style.background,border:thumbRule.style.border}:null}; })(),
      };
    })()`);
    const parametricRange = parametricAudit.range;
    const parametricAlignment = await captureFaderAlignment(rangeSelector, 'future-eq-parametric-fader-alignment.png');
    parametricAudit.range.pixelAlignment = parametricAlignment;
    assert.ok(parametricAlignment.rail && parametricAlignment.thumb, `Painted parametric rail and thumb pixels are detectable: ${JSON.stringify(parametricAlignment)}`);
    assert.ok(parametricAlignment.rail.width >= 2 && parametricAlignment.rail.width <= 5, `Parametric rail is approximately 3 painted pixels wide: ${JSON.stringify(parametricAlignment)}`);
    assert.ok(parametricAlignment.thumb.width >= 9 && parametricAlignment.thumb.width <= 15, `Parametric thumb is approximately 13 painted pixels wide: ${JSON.stringify(parametricAlignment)}`);
    assert.ok(parametricAlignment.delta <= 1, `Parametric thumb and rail pixel centers align within one pixel: ${JSON.stringify(parametricAlignment)}`);
    assert.ok(parametricRange.rect.height > parametricRange.rect.width * 3, "Parametric gain fader remains vertically oriented.");
    assert.equal(parametricRange.writingMode, "vertical-lr");
    assert.equal(parametricRange.direction, "rtl");
    assert.equal(parametricRange.appearance, "none", "EQ gain ranges do not retain the native second track.");
    assert.equal(parametricRange.accentColor, "rgba(0, 0, 0, 0)", "The fader uses its custom band-colored track and thumb.");
    assert.match(parametricRange.backgroundImage, /linear-gradient/i, "The fader includes a visible zero reference tick.");
    assert.ok(parametricRange.backgroundSize.includes("12px"), "The zero reference extends across the rail.");
    assert.equal(parametricRange.matchesFutureSelector, true, "The parametric fader matches the real Future selector.");
    assert.equal(parametricRange.trackRule?.width, "3px", `Parametric track uses the real 3px rail declaration: ${JSON.stringify(parametricRange.trackRule)}`);
    assert.deepEqual(parametricRange.thumbRule, { width: "13px", height: "13px" }, "Parametric fader thumb keeps its 13px dimensions in the matched production rule.");
    assert.ok(parametricAudit.readout, "Parametric gain readout remains present beside its fader.");
    assert.ok(parametricAudit.readoutCenterDelta <= 2, `Parametric numeric readout aligns with the fader center: ${parametricAudit.readoutCenterDelta}`);
    assert.notEqual(parametricAudit.figure.radius, "0px", "Future response panel has a closed rounded edge.");
    assert.equal(parametricAudit.figure.overflow, "hidden", "Future response panel clips chart seams inside its border.");
    assert.equal(parametricAudit.figure.position, "static", "The production EQ editor wrapper keeps the response figure out of the fader hit area.");
    assert.deepEqual(parametricAudit.figure.border, ["1px","1px","1px","1px"], "All four response panel edges remain closed.");
    assert.ok(parametricAudit.figure.borderStyles.every(value => value === "solid"));
    assert.ok(parametricAudit.figure.children.every(child => child.left >= parametricAudit.figure.rect.left - 1 && child.right <= parametricAudit.figure.rect.right + 1), "Chart, legend and caption stay within the response panel edges.");
    assert.ok(parametricAudit.figure.scroll[0] <= parametricAudit.figure.scroll[1] + 1, "Response panel has no horizontal seam overflow.");
    assert.equal(parametricAudit.selected.card, true);
    assert.ok(Number(parametricAudit.selected.cardIndexWeight) >= 600, "The selected parametric band number is clearly emphasized.");
    assert.equal(parametricAudit.selected.curve, 1);
    assert.equal(parametricAudit.selected.legend, true);
    assert.equal(parametricAudit.selected.pressed, "true");
    assert.equal(parametricAudit.selected.dots, 1, "The response legend contains one DOM color dot.");
    assert.equal(parametricAudit.selected.pseudo, "none", "Future does not paint a duplicate pseudo color dot.");
    assert.deepEqual(parametricAudit.selected.dotRgb, parametricAudit.selected.curveRgb, "Legend dot and selected response curve use the same band color.");
    assert.deepEqual(parametricAudit.selected.cardDotRgb, parametricAudit.selected.curveRgb, "Selected card dot and curve use the same band color.");
    assert.equal(parametricAudit.strip.disabled, false, "Parametric overflow enables its horizontal position control.");
    assert.equal(parametricAudit.strip.writingMode, "horizontal-tb");
    assert.equal(parametricAudit.strip.direction, "ltr");
    assert.equal(parametricAudit.strip.appearance, "none");
    assert.equal(parametricAudit.strip.accentColor, "rgba(0, 0, 0, 0)", `Horizontal EQ navigator accent style: ${JSON.stringify(parametricAudit.strip)}`);
    assert.equal(parametricAudit.strip.trackRule?.height, "2px", "Horizontal EQ navigator uses its real 2px track rule.");
    assert.deepEqual(parametricAudit.strip.thumbRule && { width:parametricAudit.strip.thumbRule.width,height:parametricAudit.strip.thumbRule.height }, { width:"18px",height:"7px" }, "Horizontal EQ navigator keeps its quiet 18 by 7px thumb.");
    assert.match(parametricAudit.strip.thumbRule?.background ?? "", /future-eq-label/, "Horizontal EQ navigator thumb uses the neutral label color, not the band accent.");
    report.eq.parametric = parametricAudit;
    await evaluate(`unifiedControlsHarness.lighting.refresh()`);
    await waitPaint();
    const eqButtonStates = await evaluate(`(() => {
      const root=document.querySelector('#eq-page-content .eq-controls');
      const idle=root.querySelector('.eq-add-band');
      const disabled=root.querySelector('.eq-band-card[data-eq-band-card="0"] button[data-eq-action="remove-band"]');
      const selected=root.querySelector('.eq-legend-item[data-eq-focus-band="1"]');
      return {
        idle:{receiver:idle.getAttribute('data-terminal-receiver'),shadow:getComputedStyle(idle).boxShadow},
        disabled:{disabled:disabled.disabled,receiver:disabled.getAttribute('data-terminal-receiver'),shadow:getComputedStyle(disabled).boxShadow},
        selected:{pressed:selected.getAttribute('aria-pressed'),receiver:selected.getAttribute('data-terminal-receiver'),shadow:getComputedStyle(selected).boxShadow},
      };
    })()`);
    assert.equal(eqButtonStates.idle.receiver, null, "Idle EQ buttons are not unconditional lighting receivers.");
    assert.ok(insetOnly(eqButtonStates.idle.shadow), `Idle EQ button has no outer halo: ${eqButtonStates.idle.shadow}`);
    assert.equal(eqButtonStates.disabled.disabled, true, "Locked EQ actions remain disabled in the real markup.");
    assert.equal(eqButtonStates.disabled.receiver, null, "Disabled EQ buttons do not receive projected light.");
    assert.ok(insetOnly(eqButtonStates.disabled.shadow), `Disabled EQ button has no outer halo: ${eqButtonStates.disabled.shadow}`);
    assert.equal(eqButtonStates.selected.pressed, "true");
    assert.equal(eqButtonStates.selected.receiver, "control", "Selected EQ legend uses the interaction-light layer.");
    assert.ok(insetOnly(eqButtonStates.selected.shadow), `Selected EQ legend uses inset feedback: ${eqButtonStates.selected.shadow}`);
    report.eq.buttonStates = eqButtonStates;
    await capture("future-eq-parametric.png");

    const navScroll = await evaluate(`(() => {
      const control = document.querySelector('#eq-page-content [data-eq-strip-scroll]');
      const strip = document.querySelector('#eq-page-content .eq-parametric-strip');
      const overflow = strip.scrollWidth - strip.clientWidth;
      control.value = '500';
      control.dispatchEvent(new Event('input', { bubbles: true }));
      return { scrollLeft: strip.scrollLeft, expected: overflow / 2, overflow };
    })()`);
    assert.ok(navScroll.overflow > 0, "The EQ band strip provides real horizontal overflow.");
    assert.ok(Math.abs(navScroll.scrollLeft - navScroll.expected) <= 3, `Neutral navigation range moves the strip: ${JSON.stringify(navScroll)}`);
    report.eq.navigation = navScroll;

    await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(rangeSelector)}); input.value='0'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await waitPaint();
    const center = await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(rangeSelector)});input.scrollIntoView({block:'center',behavior:'instant'});const scroller=input.closest('.settings-page-content');const first=input.getBoundingClientRect();if(scroller)scroller.scrollTop+=first.top-280;const r=input.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {x:r.left+r.width/2,y:r.top+r.height/2,top:r.top,height:r.height,visible:r.top>=0&&r.bottom<=innerHeight,hitRange:hit===input||input.contains(hit)}; })()`);
    assert.equal(center.visible, true, "Scroll the production parametric fader into view before pointer interaction.");
    assert.equal(center.hitRange, true, "Expose the range above the sticky response figure before pointer interaction.");
    await waitPaint();
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x, y: center.y, button: "none" });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: center.x, y: center.y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: center.x, y: center.y, button: "left", clickCount: 1 });
    await waitPaint();
    const zeroRead = await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(rangeSelector)}); return { value:Number(input.value), state:unifiedEq.state.eq.bands[1].gain, readout:input.parentElement.querySelector('.editable-range-value')?.textContent ?? null }; })()`);
    assert.ok(Math.abs(zeroRead.value) <= 1 && Math.abs(zeroRead.state) <= 1, `The vertical zero mark and native thumb agree near 0 dB: ${JSON.stringify(zeroRead)}`);
    assert.ok(Math.abs(zeroRead.value - zeroRead.state) < .001, "The production input handler keeps the numeric setting synchronized with the actual fader value.");
    const dragStart = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(rangeSelector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    const dragEnd = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(rangeSelector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height*.16}; })()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragStart.x, y: dragStart.y, button: "none" });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: dragStart.x, y: dragStart.y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragEnd.x, y: dragEnd.y, button: "left", buttons: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: dragEnd.x, y: dragEnd.y, button: "left", clickCount: 1 });
    await waitPaint();
    const dragValue = await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(rangeSelector)}); fixture.ranges.sync(); return {value:Number(input.value),state:unifiedEq.state.eq.bands[1].gain,readout:input.parentElement.querySelector('.editable-range-value')?.textContent ?? null}; })()`);
    assert.ok(dragValue.value > 0, `Dragging the vertical fader upward increases gain: ${JSON.stringify({dragStart,dragEnd,dragValue})}`);
    assert.ok(Math.abs(dragValue.value - dragValue.state) < .001, "The production range callback tracks the dragged fader value.");
    assert.match(dragValue.readout ?? "", /dB/i, "The editable gain readout stays attached to the fader.");
    const keyBefore = dragValue.value;
    await evaluate(`document.querySelector(${JSON.stringify(rangeSelector)}).focus()`);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
    await waitPaint();
    const keyValue = await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(rangeSelector)}); return {value:Number(input.value),state:unifiedEq.state.eq.bands[1].gain}; })()`);
    assert.notEqual(keyValue.value, keyBefore, "Keyboard input changes the real vertical fader.");
    assert.ok(Math.abs(keyValue.value - keyValue.state) < .001, "The production input handler tracks the keyboard fader value.");
    report.eq.parametric.interaction = { zero: zeroRead, drag: dragValue, keyboard: keyValue };
    report.eq.parametric.responsePanel = await captureResponsePanel('future-eq-parametric-panel-legend.png');

    const graphicMount = await evaluate(`unifiedEq.mount('graphic')`);
    assert.equal(graphicMount.mode, "graphic");
    await waitPaint();
    const graphicSelector = '#eq-page-content .eq-graphic-gain input[type="range"][data-processing-field="eq.bands.1.gain"]';
    const graphicAudit = await evaluate(`(() => {
      const root=document.querySelector('#eq-page-content .eq-controls');
      const range=root.querySelector(${JSON.stringify(graphicSelector)});
      const figure=root.querySelector('.eq-response-figure');
      const legend=root.querySelector('.eq-legend-item[data-eq-focus-band="1"]');
      const card=root.querySelector('[data-eq-band-card="1"]');
      const node=root.querySelector('[data-eq-node="1"]');
      const thumb=getComputedStyle(range,'::-webkit-slider-thumb');
      const colorContext=document.createElement('canvas').getContext('2d');
      const rgb=color=>{colorContext.clearRect(0,0,1,1);colorContext.fillStyle=color;colorContext.fillRect(0,0,1,1);return [...colorContext.getImageData(0,0,1,1).data].slice(0,3);};
      const rangeRect=range.getBoundingClientRect();
      const readout=range.closest('.eq-graphic-gain')?.querySelector('.editable-range-value')?.getBoundingClientRect();
      const cardIndex=card.querySelector('.eq-band-index');
      const cardDot=getComputedStyle(cardIndex,'::before');
      const cssRules=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules];}catch{return [];}});
      const trackRule=cssRules.find(rule=>rule.selectorText?.includes('.eq-graphic-gain')&&rule.selectorText.includes('::-webkit-slider-runnable-track'));
      const thumbRule=cssRules.find(rule=>rule.selectorText?.includes('.eq-graphic-gain')&&rule.selectorText.includes('::-webkit-slider-thumb')&&rule.style?.width==='13px');
      return {range:{rect:rangeRect.toJSON(),writingMode:getComputedStyle(range).writingMode,direction:getComputedStyle(range).direction,appearance:getComputedStyle(range).appearance,accentColor:getComputedStyle(range).accentColor,trackWidth:getComputedStyle(range,'::-webkit-slider-runnable-track').width,thumbWidth:thumb.width,thumbHeight:thumb.height,matchesFutureSelector:range.matches('html .music-app[data-design="rhine"] #music-eq-page .eq-controls:not([data-eq-engine="lsp"]) .eq-graphic-gain input[type="range"]'),trackRule:trackRule?{width:trackRule.style.width,height:trackRule.style.height}:null,thumbRule:thumbRule?{width:thumbRule.style.width,height:thumbRule.style.height}:null},readout:readout?.toJSON()??null,readoutCenterDelta:readout?Math.abs((readout.left+readout.width/2)-(rangeRect.left+rangeRect.width/2)):null,selected:{card:card.classList.contains('is-selected'),cardIndexWeight:getComputedStyle(cardIndex).fontWeight,cardDotWidth:cardDot.width,cardDotHeight:cardDot.height,cardDotRgb:rgb(cardDot.backgroundColor),line:root.querySelectorAll('.eq-response-band-line.is-selected').length,legend:legend.classList.contains('is-selected'),pressed:legend.getAttribute('aria-pressed'),node:node?.classList.contains('is-selected')??false,nodeCount:root.querySelectorAll('.eq-response-node.is-selected').length,dots:legend.querySelectorAll('i').length,pseudo:getComputedStyle(legend,'::before').content,dotRgb:rgb(getComputedStyle(legend.querySelector('i')).backgroundColor),curveRgb:rgb(getComputedStyle(root.querySelector('.eq-response-band-line.is-selected')).stroke),nodeRgb:rgb(getComputedStyle(node).fill)},figure:{radius:getComputedStyle(figure).borderRadius,overflow:getComputedStyle(figure).overflow,border:[getComputedStyle(figure).borderTopWidth,getComputedStyle(figure).borderRightWidth,getComputedStyle(figure).borderBottomWidth,getComputedStyle(figure).borderLeftWidth]}};
    })()`);
    const graphicAlignment = await captureFaderAlignment(graphicSelector, 'future-eq-graphic-fader-alignment.png');
    graphicAudit.range.pixelAlignment = graphicAlignment;
    assert.ok(graphicAlignment.rail && graphicAlignment.thumb, `Painted graphic rail and thumb pixels are detectable: ${JSON.stringify(graphicAlignment)}`);
    assert.ok(graphicAlignment.rail.width >= 2 && graphicAlignment.rail.width <= 5, `Graphic rail is approximately 3 painted pixels wide: ${JSON.stringify(graphicAlignment)}`);
    assert.ok(graphicAlignment.thumb.width >= 9 && graphicAlignment.thumb.width <= 15, `Graphic thumb is approximately 13 painted pixels wide: ${JSON.stringify(graphicAlignment)}`);
    assert.ok(graphicAlignment.delta <= 1, `Graphic thumb and rail pixel centers align within one pixel: ${JSON.stringify(graphicAlignment)}`);
    assert.ok(graphicAudit.range.rect.height > graphicAudit.range.rect.width * 3, "Graphic gain fader remains vertically oriented.");
    assert.equal(graphicAudit.range.writingMode, "vertical-lr");
    assert.equal(graphicAudit.range.direction, "rtl");
    assert.equal(graphicAudit.range.appearance, "none");
    assert.equal(graphicAudit.range.accentColor, "rgba(0, 0, 0, 0)");
    assert.equal(graphicAudit.range.matchesFutureSelector, true);
    assert.equal(graphicAudit.range.trackRule?.width, "3px");
    assert.deepEqual(graphicAudit.range.thumbRule, { width:"13px",height:"13px" });
    assert.ok(graphicAudit.readout, "Graphic gain readout remains beside the vertical fader.");
    assert.ok(graphicAudit.readoutCenterDelta <= 2, `Graphic readout aligns with the fader rail: ${JSON.stringify({ range: graphicAudit.range.rect, readout: graphicAudit.readout, delta: graphicAudit.readoutCenterDelta })}`);
    assert.equal(graphicAudit.selected.card, true);
    assert.ok(Number(graphicAudit.selected.cardIndexWeight) >= 600, "The selected graphic band number is clearly emphasized.");
    assert.equal(graphicAudit.selected.cardDotWidth, "6px");
    assert.equal(graphicAudit.selected.cardDotHeight, "6px");
    assert.equal(graphicAudit.selected.line, 1);
    assert.equal(graphicAudit.selected.legend, true);
    assert.equal(graphicAudit.selected.pressed, "true");
    assert.equal(graphicAudit.selected.node, true, "The selected graphic band node follows the selected band.");
    assert.equal(graphicAudit.selected.nodeCount, 1);
    assert.equal(graphicAudit.selected.dots, 1);
    assert.equal(graphicAudit.selected.pseudo, "none");
    assert.deepEqual(graphicAudit.selected.dotRgb, graphicAudit.selected.curveRgb, "Graphic legend dot and selected curve share the band color.");
    assert.deepEqual(graphicAudit.selected.dotRgb, graphicAudit.selected.nodeRgb, "Graphic legend dot and selected response node share the band color.");
    assert.deepEqual(graphicAudit.selected.cardDotRgb, graphicAudit.selected.curveRgb, "Selected graphic card dot and curve share the band color.");
    assert.notEqual(graphicAudit.figure.radius, "0px");
    assert.equal(graphicAudit.figure.overflow, "hidden");
    assert.deepEqual(graphicAudit.figure.border, ["1px","1px","1px","1px"]);
    report.eq.graphic = graphicAudit;
    await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(graphicSelector)}); input.value='0'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await waitPaint();
    const graphicCenter = await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(graphicSelector)});input.scrollIntoView({block:'center',behavior:'instant'});const scroller=input.closest('.settings-page-content');const first=input.getBoundingClientRect();if(scroller)scroller.scrollTop+=first.top-280;const r=input.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {x:r.left+r.width/2,y:r.top+r.height/2,visible:r.top>=0&&r.bottom<=innerHeight,hitRange:hit===input||input.contains(hit)}; })()`);
    assert.equal(graphicCenter.visible, true, "Scroll the production graphic fader into view before pointer interaction.");
    assert.equal(graphicCenter.hitRange, true, "Expose the graphic fader above the sticky response figure before pointer interaction.");
    await waitPaint();
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: graphicCenter.x, y: graphicCenter.y, button: "none" });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: graphicCenter.x, y: graphicCenter.y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: graphicCenter.x, y: graphicCenter.y, button: "left", clickCount: 1 });
    await waitPaint();
    const graphicZero = await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(graphicSelector)}); return {value:Number(input.value),state:unifiedEq.state.eq.bands[1].gain}; })()`);
    assert.ok(Math.abs(graphicZero.value) <= 1 && Math.abs(graphicZero.state) <= 1, `Graphic fader zero position aligns with its thumb: ${JSON.stringify(graphicZero)}`);
    const graphicStart = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(graphicSelector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    const graphicEnd = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(graphicSelector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height*.16}; })()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: graphicStart.x, y: graphicStart.y, button: "none" });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: graphicStart.x, y: graphicStart.y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: graphicEnd.x, y: graphicEnd.y, button: "left", buttons: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: graphicEnd.x, y: graphicEnd.y, button: "left", clickCount: 1 });
    await waitPaint();
    const graphicDrag = await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(graphicSelector)}); fixture.ranges.sync(); return {value:Number(input.value),state:unifiedEq.state.eq.bands[1].gain,readout:input.parentElement.querySelector('.editable-range-value')?.textContent ?? null}; })()`);
    assert.ok(graphicDrag.value > 0, `Dragging the graphic fader upward increases gain: ${JSON.stringify(graphicDrag)}`);
    assert.ok(Math.abs(graphicDrag.value - graphicDrag.state) < .001, "The production input callback tracks the graphic fader drag.");
    const graphicBeforeKey = graphicDrag.value;
    await evaluate(`document.querySelector(${JSON.stringify(graphicSelector)}).focus()`);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
    await waitPaint();
    const graphicKey = await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(graphicSelector)}); return {value:Number(input.value),state:unifiedEq.state.eq.bands[1].gain}; })()`);
    assert.notEqual(graphicKey.value, graphicBeforeKey, "Keyboard input changes the graphic fader.");
    assert.ok(Math.abs(graphicKey.value - graphicKey.state) < .001, "The production input callback tracks the graphic fader keyboard value.");
    report.eq.graphic.interaction = { zero: graphicZero, drag: graphicDrag, keyboard: graphicKey };
    await capture("future-eq-graphic.png");
    report.eq.graphic.responsePanel = await captureResponsePanel('future-eq-graphic-panel-legend.png');

    await evaluate(`fixture.switchDesign('archive')`);
    await evaluate(`fixture.setTheme('day')`);
    await evaluate(`(() => { fixture.setPage('eq'); fixture.shell.setActive(true); })()`);
    await evaluate(`unifiedEq.mount('parametric')`);
    await evaluate(`UnifiedControlsFixture.syncPunkEqInstruments(document.querySelector('#eq-page-content'))`);
    await waitPaint();
    await evaluate(`unifiedControlsHarness.lighting.setQuality({ terminalLight: 'full' }); unifiedControlsHarness.lighting.refresh()`);
    await waitPaint();
    const punkAudit = await evaluate(`(() => {
      const stage=fixture.stage;
      const nav=document.querySelector('#music-settings .settings-page-nav button');
      const dial=document.querySelector('#eq-page-content .eq-parameter-dial');
      const figure=document.querySelector('#eq-page-content .eq-response-figure');
      return {design:stage.dataset.design, receivers:stage.querySelectorAll('[data-terminal-receiver]').length, navRadius:getComputedStyle(nav).borderRadius, dialRadius:dial?getComputedStyle(dial).borderRadius:null, figureRadius:figure?getComputedStyle(figure).borderRadius:null, punkTheme: getComputedStyle(document.querySelector('.foobar-header .theme-switch'),'::before').display};
    })()`);
    assert.equal(punkAudit.design, "archive");
    assert.equal(punkAudit.receivers, 0, "Punk skin does not receive Future terminal lighting.");
    assert.equal(punkAudit.navRadius, "0px", "Archive/Punk settings navigation keeps square geometry.");
    assert.equal(punkAudit.dialRadius, "0px", "Archive/Punk EQ dials keep square geometry.");
    assert.equal(punkAudit.figureRadius, "0px", "Archive/Punk EQ response panel keeps square geometry.");
    assert.equal(punkAudit.punkTheme, "none", "Archive/Punk theme switch keeps its original flat control.");
    report.punk = punkAudit;
    await capture("punk-controls-preserved.png");

    setupComplete = true;
  } finally {
    await evaluate(`(async() => {
      try { await window.unifiedEq?.destroy(); } catch {}
      try { window.unifiedSettings?.destroy(); } catch {}
      try { window.unifiedControlsHarness?.lighting?.destroy(); } catch {}
      if (window.unifiedProductionProcessingInput) document.removeEventListener('input', window.unifiedProductionProcessingInput);
      const stage=fixture.stage, original=${JSON.stringify(original)};
      const assign=(node,key,value)=>{if(value===null)delete node.dataset[key];else node.dataset[key]=value;};
      for (const [key,value] of Object.entries(original.stage)) assign(stage,key,value);
      const settings=document.querySelector('#music-settings');settings.hidden=original.settings.hidden;settings.inert=original.settings.inert;
      document.querySelector('#settings-page-content').innerHTML=original.settings.content;settings.querySelector('.settings-page-nav').innerHTML=original.settings.nav;
      const themePage=document.querySelector('#music-theme-page');themePage.hidden=original.themePage.hidden;themePage.inert=original.themePage.inert;
      const eqPage=document.querySelector('#music-eq-page');eqPage.hidden=original.eqPage.hidden;eqPage.inert=original.eqPage.inert;document.querySelector('#eq-page-content').innerHTML=original.eqPage.content;
      const scrim=document.querySelector('.music-panel-scrim'),panel=document.querySelector('.music-panel');scrim.hidden=original.scrim.hidden;scrim.style.display=original.scrim.display;document.querySelector('#panel-body').innerHTML=original.scrim.body;panel.style.maxHeight=original.scrim.maxHeight;
      document.querySelector('#music-browse').hidden=original.browseHidden;
      document.querySelector('#music-detail').hidden=original.detailHidden;
      document.querySelectorAll('.theme-switch button[data-theme]').forEach((button,index)=>{const value=original.themeButtons[index];if(value===null)button.removeAttribute('aria-pressed');else button.setAttribute('aria-pressed',value);});
      fixture.shell.setActive(!original.shellHidden);
      delete window.unifiedSettings;delete window.unifiedEq;delete window.unifiedControlsHarness;delete window.unifiedProductionProcessingInput;
    })()`);
  }

  await writeFile(path.join(output, "unified-controls.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!setupComplete) throw new Error("Unified controls fixture did not complete.");
  console.log(`Passed unified Future controls, lighting, EQ faders and Punk-skin checks; evidence saved under ${path.relative(project, output).replaceAll("\\", "/")}.`);
  return report;
}
