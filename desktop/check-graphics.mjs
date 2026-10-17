import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkDayPalette } from './check-day-palette.mjs';
import { checkFutureSettings } from './check-future-settings.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settingsCategories = ['interface', 'appearance', 'audio', 'lyrics', 'library', 'sources', 'about'];
const categoryTitlePatterns = {
  interface: /界面与交互|interface.{0,24}interaction/i,
  appearance: /显示与性能|display.{0,24}performance/i,
  audio: /音频|audio/i,
  lyrics: /歌词|lyrics/i,
  library: /音乐库|library/i,
  sources: /音乐来源|来源|music sources/i,
  about: /关于|about/i,
};

export async function checkGraphics({ browserWindow, outputDirectory }) {
  const wc = browserWindow.webContents;
  const evaluate = script => wc.executeJavaScript(script, true);
  const click = selector => evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node)throw new Error('Missing UI control: '+${JSON.stringify(selector)}); node.click(); return true; })()`);
  const snapshot = () => evaluate(`(() => {
    const settingsCategories=${JSON.stringify(settingsCategories)};
    const stage=document.querySelector('#stage');
    const settings=document.querySelector('#music-settings');
    const stylePage=document.querySelector('#music-theme-page');
    const display= settings?.querySelector('#graphics-display-settings');
    const activeCategory=settings?.querySelector('[data-settings-category-target][aria-current="page"]')?.dataset.settingsCategoryTarget??null;
    const interfaceSection=settings?.querySelector('[data-settings-category="interface"]');
    const appearanceSection=settings?.querySelector('[data-settings-category="appearance"]');
    const interfaceSettings=interfaceSection?.querySelector('#interface-settings');
    const motionSettings=interfaceSection?.querySelector('#motion-settings');
    const motionGroup=motionSettings?.matches('.graphics-motion-settings')?motionSettings:motionSettings?.querySelector('.graphics-motion-settings');
    const entrySettings=interfaceSection?.querySelector('#entry-settings');
    const styleSlot=stylePage?.querySelector('#theme-quality-slot');
    const categoryDetails=[...settings?.querySelectorAll('[data-settings-category]')??[]].map(section=>({
      id:section.dataset.settingsCategory,
      title:section.querySelector(':scope > h2')?.textContent?.trim()??'',
      titleId:section.getAttribute('aria-labelledby'),
      titleTarget:section.querySelector(':scope > h2')?.id??'',
      buttonCount:settings.querySelectorAll('[data-settings-category-target="'+section.dataset.settingsCategory+'"]').length,
      sectionCount:settings.querySelectorAll('[data-settings-category="'+section.dataset.settingsCategory+'"]').length,
      buttonLabel:settings.querySelector('[data-settings-category-target="'+section.dataset.settingsCategory+'"]')?.textContent?.trim()??''
    }));
    const displaySelectors=['[data-window-aspect]','[data-action=fullscreen]','[data-gpu-preference]','.quality-settings','.quality-detection'];
    const motionSelectors=['#reduced-motion','[data-quality=wave]'];
    const styleForbidden='#graphics-display-settings,#motion-settings,#reduced-motion,[data-quality],.quality-settings,[data-gpu-settings],[data-gpu-preference],[data-window-aspect],[data-action=fullscreen],#entry-settings,#ui-language';
    const gpuSelect=display?.querySelector('[data-gpu-preference]');
    const fullScreen=display?.querySelector('[data-action=fullscreen]');
    const caseEditor=stylePage?.querySelector('#theme-case-editor');
    return {
      design:stage?.dataset.design??null,
      page:stage?.dataset.page??null,
      category:activeCategory,
      styleTitle:stylePage?.querySelector('#music-style-title')?.textContent?.trim()??null,
      styleKicker:stylePage?.querySelector('.music-style-heading small')?.textContent?.trim()??null,
      styleNavLabel:document.querySelector('.music-topnav [data-action=theme]')?.textContent?.trim()??null,
      stylePageOpen:!!stylePage&&!stylePage.hidden,
      styleHasThemeCards:!!stylePage?.querySelector('.design-family-card[data-style-design]'),
      styleHasDayNight:!!stylePage?.querySelector('.theme-mode-controls [data-theme=day]')&&!!stylePage?.querySelector('.theme-mode-controls [data-theme=night]'),
      styleHasColorChoices:!!stylePage?.querySelector('[data-style-scheme],.theme-choice-preview'),
      styleHasCaseEditor:!!stylePage?.querySelector('#theme-case-editor .case-editor,.case-editor'),
      styleHasScenePreview:!!stylePage?.querySelector('[data-style-preview-content],.music-style-preview,.foobar-style-preview,.theme-choice-scene'),
      styleQualitySlotEmpty:!!styleSlot&&styleSlot.children.length===0,
      styleCaseEditorBeforeQualitySlot:!!caseEditor&&!!styleSlot&&!!(caseEditor.compareDocumentPosition(styleSlot)&Node.DOCUMENT_POSITION_FOLLOWING),
      styleHasForbiddenControls:!!stylePage?.querySelector(styleForbidden),
      categories:categoryDetails,
      categoryCounts:Object.fromEntries(settingsCategories.map(id=>[id,{
        buttons:settings?.querySelectorAll('[data-settings-category-target="'+id+'"]').length??0,
        sections:settings?.querySelectorAll('[data-settings-category="'+id+'"]').length??0
      }])),
      activeCategoryCount:settings?.querySelectorAll('[data-settings-category-target][aria-current="page"]').length??0,
      visibleCategories:[...settings?.querySelectorAll('[data-settings-category]')??[]].filter(section=>!section.hidden).map(section=>section.dataset.settingsCategory),
      interface:{
        sectionVisible:!!interfaceSection&&!interfaceSection.hidden,
        sectionTitle:interfaceSection?.querySelector(':scope > h2')?.textContent?.trim()??null,
        hasSettings:!!interfaceSettings,
        hasLanguage:!!interfaceSettings?.querySelector('#ui-language'),
        hasLanguageApply:!!interfaceSettings?.querySelector('[data-action=apply-language]'),
        hasStyleLink:!!interfaceSettings?.querySelector('[data-action=theme]'),
        hasMotion:!!motionSettings,
        hasMotionGroup:!!motionGroup,
        hasReducedMotion:!!motionGroup?.querySelector('#reduced-motion'),
        hasWaveQuality:!!motionGroup?.querySelector('[data-quality=wave]'),
        hasEntry:!!entrySettings,
        hasEntryControls:!!entrySettings?.querySelector('#entry-on-open,[data-action=entry-replay],#entry-welcome,#entry-identity'),
        hasInterfaceSound:!!interfaceSection?.querySelector('#interface-sound-settings'),
        languageValue:interfaceSettings?.querySelector('#ui-language')?.value??null
      },
      appearance:{
        sectionVisible:!!appearanceSection&&!appearanceSection.hidden,
        sectionTitle:appearanceSection?.querySelector(':scope > h2')?.textContent?.trim()??null,
        hasDisplay:!!display,
        hasWindowAspect:!!display?.querySelector('[data-window-aspect]'),
        hasFullscreen:!!fullScreen,
        pressed:fullScreen?.getAttribute('aria-pressed')??null,
        disabled:fullScreen?.disabled??null,
        label:fullScreen?.textContent?.trim()??null,
        hasGpu:!!gpuSelect,
        hasQuality:!!display?.querySelector('.quality-settings [data-quality]'),
        hasDetection:!!display?.querySelector('.quality-detection'),
        hasMotion:!!appearanceSection?.querySelector('#motion-settings,#reduced-motion,.graphics-motion-settings,[data-quality=wave]'),
        hasLanguage:!!appearanceSection?.querySelector('#ui-language'),
        grouped:!!display&&displaySelectors.every(selector=>display.querySelector(selector)),
        motionSelectorsInInterface:!!motionGroup&&motionSelectors.every(selector=>motionGroup.querySelector(selector)),
        counts:Object.fromEntries(['#interface-settings','#ui-language','[data-action=apply-language]','#motion-settings','#entry-settings','#interface-sound-settings','#graphics-display-settings','select[data-window-aspect]','#reduced-motion','select[data-quality=wave]','[data-action=fullscreen]','#quality-preset','[data-gpu-preference]','.quality-detection'].map(selector=>[selector,document.querySelectorAll(selector).length])),
        gpu:{value:gpuSelect?.value,disabled:gpuSelect?.disabled,
          options:[...display?.querySelectorAll('[data-gpu-preference] option')||[]].map(option=>({value:option.value,label:option.textContent?.trim()??'',disabled:option.disabled})),
          status:display?.querySelector('[data-gpu-status]')?.textContent?.trim()??'',error:display?.querySelector('[data-gpu-error]')?.textContent?.trim()??'',active:display?.querySelector('[data-gpu-active]')?.textContent?.trim()??''}
      },
      prefs:JSON.parse(localStorage.getItem('rhine-music-preferences')||'{}')
    };
  })()`);
  const until = async (predicate, label) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { const state = await snapshot(); if (predicate(state)) return state; await pause(100); }
    const state = await snapshot();
    throw new Error(`Timed out: ${label}, ${JSON.stringify({design:state.design,page:state.page,category:state.category,styleTitle:state.styleTitle,fullscreen:state.appearance?.pressed,gpu:state.appearance?.gpu})}`);
  };
  const screenshots = [];
  const capture = async (name, selector) => {
    await evaluate(`(() => {const node=document.querySelector(${JSON.stringify(selector)}),scroller=node?.closest('.settings-page-content,#theme-page-content');if(!node)throw new Error('Missing screenshot target: '+${JSON.stringify(selector)});if(scroller)scroller.scrollTop+=node.getBoundingClientRect().top-scroller.getBoundingClientRect().top-12;else node.scrollIntoView({block:'start'});})()`);
    await pause(500);
    const file = path.join(outputDirectory, `graphics-${name}.png`);
    await fs.writeFile(file, (await browserWindow.capturePage()).toPNG());
    screenshots.push(file);
  };
  const rangeChecks = [];
  const checkSettingsRange = async (design, theme) => {
    await click('#music-settings [data-settings-category-target=appearance]');
    await until(state=>state.page==='settings'&&state.category==='appearance'&&state.appearance?.grouped,`${design}/${theme} slider settings`);
    const initial = await evaluate(`(() => {
      const details=document.querySelector('#graphics-display-settings .quality-settings details.quality-advanced');
      const range=document.querySelector('#graphics-display-settings .quality-settings input[type="range"][data-quality="scale"]');
      if(!details||!range)throw new Error('Missing graphics quality range');
      const detailsWasOpen=details.open;
      details.open=true;
      range.scrollIntoView({block:'center'});
      const button=range.parentElement.querySelector('.editable-range-value');
      if(!button)throw new Error('Missing editable quality range value');
      const output=range.parentElement.querySelector('output[data-quality-output]');
      if(output?.getClientRects().length)throw new Error('Slider value is duplicated by its legacy output');
      const probe={range,details,original:{value:range.value,min:range.getAttribute('min'),max:range.getAttribute('max'),disabled:range.disabled,detailsOpen:detailsWasOpen},events:[],listener:event=>probe.events.push(event.type)};
      range.addEventListener('input',probe.listener);
      range.addEventListener('change',probe.listener);
      range.addEventListener('click',probe.listener);
      window.__graphicsRangeProbe=probe;
      return {min:Number(range.min),max:Number(range.max),step:Number(range.step)||1,value:Number(range.value),buttonText:button.textContent};
    })()`);
    const middle = Math.round(((initial.min + initial.max) / 2 - initial.min) / initial.step) * initial.step + initial.min;
    const setValue = async value => evaluate(`(() => {
      const range=window.__graphicsRangeProbe.range;
      range.value=${JSON.stringify(String(value))};
      range.dispatchEvent(new Event('input',{bubbles:true}));
      range.dispatchEvent(new Event('change',{bubbles:true}));
      return {value:Number(range.value),progress:range.style.getPropertyValue('--range-progress')};
    })()`);
    const percent = text => Number(String(text).replace('%',''));
    let mouseIsDown=false;
    try {
      for (const [value, expected] of [[initial.min,0],[middle,50],[initial.max,100]]) {
        const result=await setValue(value);
        assert.equal(result.value,value,`${design}/${theme} range accepts value ${value}`);
        assert.ok(Math.abs(percent(result.progress)-expected)<0.02,`${design}/${theme} ${value} must set --range-progress to ${expected}%: ${JSON.stringify(result)}`);
      }
      await evaluate(`(() => {
        const range=window.__graphicsRangeProbe.range;
        range.value=${JSON.stringify(String(middle))};
        range.setAttribute('max',range.getAttribute('max')??'');
      })()`);
      await pause(30);
      const programmatic=await evaluate(`(() => {const range=window.__graphicsRangeProbe.range;return {value:Number(range.value),progress:range.style.getPropertyValue('--range-progress')}})()`);
      assert.ok(Math.abs(percent(programmatic.progress)-50)<0.02,`${design}/${theme} sync must refresh progress after a property-only value update: ${JSON.stringify(programmatic)}`);

      await setValue(middle);
      const metrics=await evaluate(`(() => {
        const range=window.__graphicsRangeProbe.range;
        const input=getComputedStyle(range),track=getComputedStyle(range,'::-webkit-slider-runnable-track'),thumb=getComputedStyle(range,'::-webkit-slider-thumb');
        const rules=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules]}catch{return []}});
        const trackRules=rules.filter(rule=>rule.selectorText?.includes('[data-design="rhine"]')&&rule.selectorText.includes('input[type="range"]::-webkit-slider-runnable-track')&&rule.selectorText.includes('#music-settings'));
        const thumbRules=rules.filter(rule=>rule.selectorText?.includes('[data-design="rhine"]')&&rule.selectorText.includes('input[type="range"]::-webkit-slider-thumb')&&rule.selectorText.includes('#music-settings')&&!rule.selectorText.includes(':hover')&&!rule.selectorText.includes(':focus-visible')&&!rule.selectorText.includes(':active'));
        const hoverRules=rules.filter(rule=>rule.selectorText?.includes('input[type="range"]:hover:not(:disabled)::-webkit-slider-thumb')&&rule.selectorText.includes('#music-settings'));
        const focusRules=rules.filter(rule=>rule.selectorText?.includes('input[type="range"]:focus-visible:not(:disabled)::-webkit-slider-thumb')&&rule.selectorText.includes('#music-settings'));
        const activeRules=rules.filter(rule=>rule.selectorText?.includes('input[type="range"]:active:not(:disabled)::-webkit-slider-thumb')&&rule.selectorText.includes('#music-settings'));
        return {height:parseFloat(input.height),appearance:input.appearance,inputBackground:input.backgroundColor,trackHeight:parseFloat(track.height),trackRadius:track.borderTopLeftRadius,trackImage:track.backgroundImage,trackRuleCount:trackRules.length,trackRuleHeight:parseFloat(trackRules[0]?.style.height),trackRuleText:trackRules[0]?.cssText,thumbWidth:parseFloat(thumb.width),thumbHeight:parseFloat(thumb.height),thumbRadius:thumb.borderTopLeftRadius,thumbShadow:thumb.boxShadow,thumbRuleCount:thumbRules.length,thumbRuleWidth:parseFloat(thumbRules[0]?.style.width),thumbRuleHeight:parseFloat(thumbRules[0]?.style.height),thumbRuleRadius:thumbRules[0]?.style.borderRadius,hoverRuleCount:hoverRules.length,focusRuleCount:focusRules.length,activeRuleCount:activeRules.length,activeTransform:activeRules[0]?.style.transform,children:range.childElementCount,progress:range.style.getPropertyValue('--range-progress')};
      })()`);
      assert.equal(metrics.children,0,`${design}/${theme} range must remain a single native input rail`);
      if(design==='rhine'){
        assert.equal(metrics.appearance,'none','Future slider must use its single custom track');
        assert.equal(metrics.inputBackground,'rgba(0, 0, 0, 0)','Future slider input background must not create a second rail');
        assert.equal(metrics.height,28,'Future slider must retain a 28px hit area');
        assert.equal(metrics.trackRuleCount,1,'Future slider must keep one WebKit rail rule');
        assert.equal(metrics.trackRuleHeight,5,'Future slider track rule must be 5px high');
        assert.ok(metrics.trackRuleText.includes('linear-gradient'),'Future slider track must paint its progress fill');
        assert.equal(metrics.thumbRuleCount,1,'Future slider must keep one base WebKit thumb rule');
        assert.equal(metrics.thumbRuleWidth,16,'Future slider thumb rule must be 16px wide');
        assert.equal(metrics.thumbRuleHeight,16,'Future slider thumb rule must be 16px high');
        assert.equal(metrics.thumbRuleRadius,'50%','Future slider thumb must stay round');
        assert.equal(metrics.hoverRuleCount,1,'Future slider must have a hover thumb state');
        assert.equal(metrics.focusRuleCount,1,'Future slider must have a focus thumb state');
        assert.equal(metrics.activeRuleCount,1,'Future slider must have an active thumb state');
        assert.equal(metrics.activeTransform,'scale(1.08)');
      }else{
        assert.equal(metrics.trackRadius,'0px','Punk slider rail must keep its square corners');
        assert.equal(metrics.thumbRadius,'0px','Punk slider thumb must keep its square corners');
      }

      await evaluate(`(() => {const range=window.__graphicsRangeProbe.range;range.disabled=true})()`);
      const disabled=await evaluate(`(() => {const range=window.__graphicsRangeProbe.range,style=getComputedStyle(range);return {opacity:Number(style.opacity),cursor:style.cursor}})()`);
      if(design==='rhine'){
        assert.ok(disabled.opacity<=0.5,`${design}/${theme} disabled slider must be visibly dimmed: ${JSON.stringify(disabled)}`);
        assert.equal(disabled.cursor,'not-allowed');
      }
      await evaluate(`(() => {window.__graphicsRangeProbe.range.disabled=window.__graphicsRangeProbe.original.disabled})()`);

      await setValue(middle);
      await evaluate(`(() => {const range=window.__graphicsRangeProbe.range;range.focus()})()`);
      browserWindow.focus();
      wc.sendInputEvent({type:'keyDown',keyCode:'RIGHT'});
      wc.sendInputEvent({type:'keyUp',keyCode:'RIGHT'});
      await pause(40);
      const afterArrow=await evaluate(`(() => {const range=window.__graphicsRangeProbe.range;return {value:Number(range.value),progress:range.style.getPropertyValue('--range-progress'),focusVisible:range.matches(':focus-visible'),outline:getComputedStyle(range).outlineStyle}})()`);
      assert.ok(afterArrow.value>middle,`${design}/${theme} ArrowRight must advance the native range`);
      assert.ok(percent(afterArrow.progress)>50,`${design}/${theme} ArrowRight must refresh progress`);
      assert.ok(afterArrow.focusVisible&&afterArrow.outline!=='none',`${design}/${theme} keyboard focus must remain visible`);
      wc.sendInputEvent({type:'keyDown',keyCode:'PAGEUP'});
      wc.sendInputEvent({type:'keyUp',keyCode:'PAGEUP'});
      await pause(40);
      const afterPageUp=await evaluate(`(() => {const range=window.__graphicsRangeProbe.range;return {value:Number(range.value),progress:range.style.getPropertyValue('--range-progress')}})()`);
      assert.ok(afterPageUp.value>afterArrow.value,`${design}/${theme} PageUp must advance farther than ArrowRight`);
      assert.ok(percent(afterPageUp.progress)>percent(afterArrow.progress),`${design}/${theme} PageUp must refresh progress`);

      await setValue(middle);
      const bounds=await evaluate(`(() => {const r=window.__graphicsRangeProbe.range.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
      const y=Math.round(bounds.top+bounds.height/2), startX=Math.round(bounds.left+bounds.width/2), endX=Math.round(bounds.left+bounds.width-2);
      browserWindow.focus();
      await evaluate(`window.__graphicsRangeProbe.nativeEventStart=window.__graphicsRangeProbe.events.length`);
      wc.sendInputEvent({type:'mouseMove',x:startX,y});
      await pause(30);
      const hover=await evaluate(`(() => {const range=window.__graphicsRangeProbe.range,thumb=getComputedStyle(range,'::-webkit-slider-thumb');return {hover:range.matches(':hover'),shadow:thumb.boxShadow}})()`);
      if(design==='rhine')assert.ok(hover.hover&&metrics.hoverRuleCount===1,`${design}/${theme} hover must visibly respond`);
      wc.sendInputEvent({type:'mouseMove',x:endX,y,movementX:endX-startX,movementY:0});
      wc.sendInputEvent({type:'mouseDown',x:endX,y,button:'left',clickCount:1});
      mouseIsDown=true;
      const active=await evaluate(`(() => {const range=window.__graphicsRangeProbe.range;return {active:range.matches(':active')}})()`);
      if(design==='rhine')assert.ok(active.active&&metrics.activeTransform==='scale(1.08)',`${design}/${theme} active drag must visibly respond`);
      wc.sendInputEvent({type:'mouseUp',x:endX,y,button:'left',clickCount:1});
      mouseIsDown=false;
      await pause(40);
      const afterDrag=await evaluate(`(() => {const probe=window.__graphicsRangeProbe,range=probe.range;return {value:Number(range.value),progress:range.style.getPropertyValue('--range-progress'),events:probe.events.slice(probe.nativeEventStart)}})()`);
      assert.ok(afterDrag.value>middle,`${design}/${theme} native pointer input must update the range: ${JSON.stringify(afterDrag)}`);
      assert.ok(percent(afterDrag.progress)>50,`${design}/${theme} native pointer input must update progress`);

      await setValue(middle);
      await evaluate(`(() => {
        const probe=window.__graphicsRangeProbe,range=probe.range,button=range.parentElement.querySelector('.editable-range-value');
        if(!button)throw new Error('Missing editable range value button');
        probe.eventStart=probe.events.length;
        button.click();
      })()`);
      await pause(30);
      const editorState=await evaluate(`(() => {
        const probe=window.__graphicsRangeProbe,range=probe.range,editor=range.parentElement.querySelector('.editable-range-number');
        return {editor:!!editor,editorFocused:!!editor&&document.activeElement===editor,value:Number(range.value),events:probe.events.slice(probe.eventStart)};
      })()`);
      assert.ok(editorState.editor&&editorState.editorFocused,`${design}/${theme} numeric button must open and focus its editor without label activation`);
      assert.equal(editorState.value,middle,`${design}/${theme} opening the numeric editor must not change the slider`);
      assert.ok(!editorState.events.includes('click')&&!editorState.events.includes('input')&&!editorState.events.includes('change'),`${design}/${theme} numeric button must not reactivate its wrapping label`);
      await evaluate(`(() => {const probe=window.__graphicsRangeProbe,editor=probe.range.parentElement.querySelector('.editable-range-number');editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))})()`);
      if(design==='rhine'){
        await setValue(initial.min);
        await capture(`${design}-sliders-${theme}-low`, '#graphics-display-settings .quality-settings .quality-range');
        await setValue(middle);
        await capture(`${design}-sliders-${theme}-middle`, '#graphics-display-settings .quality-settings .quality-range');
        await setValue(initial.max);
        await capture(`${design}-sliders-${theme}-high`, '#graphics-display-settings .quality-settings .quality-range');
      }else{
        await setValue(middle);
        await capture(`${design}-sliders-${theme}`, '#graphics-display-settings .quality-settings .quality-range');
      }
      rangeChecks.push({design,theme,minProgress:0,middleProgress:percent((await setValue(middle)).progress),maxProgress:100,dimensions:metrics,disabled,arrowRight:afterArrow.value,pageUp:afterPageUp.value,nativePointer:afterDrag.value,numericButtonFocused:editorState.editorFocused});
    } finally {
      if(mouseIsDown){
        const point=await evaluate(`(() => {const r=window.__graphicsRangeProbe.range.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
        wc.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1});
      }
      await evaluate(`(() => {
        const probe=window.__graphicsRangeProbe;
        if(!probe)return;
        const {range,details,original,listener}=probe;
        const editor=range.parentElement.querySelector('.editable-range-number');
        editor?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        range.removeEventListener('input',listener);
        range.removeEventListener('change',listener);
        range.removeEventListener('click',listener);
        if(original.min===null)range.removeAttribute('min');else range.setAttribute('min',original.min);
        if(original.max===null)range.removeAttribute('max');else range.setAttribute('max',original.max);
        range.disabled=original.disabled;
        range.value=original.value;
        range.dispatchEvent(new Event('input',{bubbles:true}));
        range.dispatchEvent(new Event('change',{bubbles:true}));
        details.open=original.detailsOpen;
        delete window.__graphicsRangeProbe;
      })()`);
      await pause(30);
    }
  };
  const cases = [];
  const switchChecks = [];
  wc.setBackgroundThrottling(false);
  let assertDefaultSettingsCategory = true;
  const openStyle = async () => {
    const state=await snapshot();
    if(!state.stylePageOpen) await click('.music-topnav [data-action=theme]');
    return until(value=>value.page==='theme'&&value.stylePageOpen&&value.styleTitle==='STYLE','open STYLE');
  };
  const openAppearanceSettings = async () => {
    if((await snapshot()).page!=='settings') await click('.music-topnav [data-action=settings]');
    const opened=await until(state=>state.page==='settings','open Settings');
    if(assertDefaultSettingsCategory){
      assert.equal(opened.category,'interface','Settings should open on the Interface & Interaction category by default');
      assert.ok(opened.interface.sectionVisible&&opened.interface.hasLanguage&&opened.interface.hasLanguageApply&&opened.interface.hasStyleLink&&opened.interface.hasMotion&&opened.interface.hasEntry,
        'The default Interface & Interaction category must own language, STYLE, motion and entry settings');
      assertDefaultSettingsCategory=false;
    }
    await click('#music-settings [data-settings-category-target=appearance]');
    return until(state=>state.page==='settings'&&state.category==='appearance'&&state.appearance?.grouped,'open display and performance settings');
  };
  const closeSettingsToStyle = async () => {
    await click('.music-topnav [data-action=settings]');
    await until(state=>state.page!=='settings','close Settings');
    if((await snapshot()).page!=='theme') await click('.music-topnav [data-action=theme]');
    return until(state=>state.page==='theme'&&state.stylePageOpen,'return to STYLE');
  };
  try {
    const futureSettings = await checkFutureSettings({ browserWindow, outputDirectory });
    if(!(await snapshot()).stylePageOpen) await openStyle();
    for (const design of ['rhine', 'archive']) {
      await openStyle();
      await click(`.design-family-card[data-style-design=${design}]`);
      const styled=await until(state=>state.design===design&&state.stylePageOpen&&state.styleTitle==='STYLE',`${design} STYLE`);
      assert.ok(styled.styleTitle==='STYLE'&&/STYLE/i.test(styled.styleKicker??'')&&/STYLE/i.test(styled.styleNavLabel??''),
        `${design} STYLE route, title, navigation and kicker should all use the STYLE label`);
      assert.ok(styled.styleHasThemeCards&&styled.styleHasDayNight&&styled.styleHasColorChoices&&styled.styleHasCaseEditor&&styled.styleHasScenePreview,
        `${design} STYLE should contain theme, day/night, colour, case and scene appearance controls: ${JSON.stringify({theme:styled.styleHasThemeCards,dayNight:styled.styleHasDayNight,colors:styled.styleHasColorChoices,case:styled.styleHasCaseEditor,preview:styled.styleHasScenePreview})}`);
      assert.ok(styled.styleQualitySlotEmpty&&styled.styleCaseEditorBeforeQualitySlot&&!styled.styleHasForbiddenControls,
        `${design} STYLE must mount the case editor before an empty quality slot and keep Settings controls out of STYLE`);

      await click('.music-topnav [data-action=settings]');
      await until(state=>state.page==='settings','open Settings from STYLE');
      const categories=await openAppearanceSettings();
      const actualCategoryIds=categories.categories.map(item=>item.id);
      assert.equal(actualCategoryIds.length,settingsCategories.length,'Settings must expose exactly seven categories');
      assert.deepEqual([...actualCategoryIds].sort(),[...settingsCategories].sort(),'Settings must expose interface, appearance, audio, lyrics, library, sources and about');
      assert.equal(categories.activeCategoryCount,1,'Settings must have exactly one active category');
      assert.deepEqual(categories.visibleCategories,['appearance'],'Only display and performance should be visible for this check');
      for(const category of categories.categories){
        assert.equal(categories.categoryCounts[category.id]?.buttons,1,`Settings category ${category.id} must have one navigation button`);
        assert.equal(categories.categoryCounts[category.id]?.sections,1,`Settings category ${category.id} must have one content section`);
        assert.ok(category.title&&category.titleId&&category.titleTarget===category.titleId,`Settings category ${category.id} must have a labelled heading`);
        assert.ok(categoryTitlePatterns[category.id]?.test(category.title)&&categoryTitlePatterns[category.id]?.test(category.buttonLabel),
          `Settings category ${category.id} title/label mismatch: ${JSON.stringify({title:category.title,label:category.buttonLabel})}`);
      }
      assert.ok(Object.values(categories.appearance.counts).every(count=>count===1),
        `Interface, display, motion and quality controls must each appear once: ${JSON.stringify(categories.appearance.counts)}`);
      assert.ok(categories.interface.hasSettings&&categories.interface.hasLanguage&&categories.interface.hasLanguageApply&&categories.interface.hasStyleLink&&categories.interface.hasMotion&&categories.interface.hasEntry&&categories.interface.hasInterfaceSound,
        'Interface must own language, the STYLE link, motion, entry and interface-sound settings');
      assert.ok(categories.interface.hasReducedMotion&&categories.interface.hasWaveQuality,'Motion category must own reduced motion and wave quality');
      assert.ok(categories.appearance.hasDisplay&&categories.appearance.hasWindowAspect&&categories.appearance.hasFullscreen&&categories.appearance.hasGpu&&categories.appearance.hasQuality&&categories.appearance.hasDetection,
        'Display and performance category must own window, fullscreen, GPU, quality and performance detection');
      assert.ok(!categories.appearance.hasMotion&&!categories.appearance.hasLanguage,'Display and performance must not contain interface settings');

      const before=categories;
      const originalQualityPreset=await evaluate('document.querySelector("#quality-preset").value');
      const originalWave=await evaluate('document.querySelector("#motion-settings [data-quality=wave]").value');
      const bounds = browserWindow.getBounds();
      browserWindow.focus();
      await pause(150);
      await click('[data-action=fullscreen]');
      const entered = await until(state => browserWindow.isFullScreen() && state.appearance.pressed === 'true' && !state.appearance.disabled, `${design} enter fullscreen`);
      assert.equal(entered.page,'settings','Entering fullscreen must stay in Settings');
      assert.equal(entered.category,'appearance','Entering fullscreen must stay in display and performance');
      await click('[data-action=fullscreen]');
      const buttonExited=await until(state => !browserWindow.isFullScreen() && state.appearance.pressed === 'false' && !state.appearance.disabled, `${design} exit fullscreen`);
      assert.equal(buttonExited.page,'settings','The fullscreen button must return to Settings');
      assert.equal(buttonExited.category,'appearance','The fullscreen button must keep display and performance selected');
      await click('[data-action=fullscreen]');
      await until(state => browserWindow.isFullScreen() && !state.appearance.disabled, `${design} reenter fullscreen`);
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      const after = await until(state => !browserWindow.isFullScreen() && state.appearance.pressed === 'false' && !state.appearance.disabled, `${design} Escape exit`);
      assert.equal(after.page,'settings','Exiting fullscreen must keep Settings open');
      assert.equal(after.category,'appearance','Exiting fullscreen must keep the display and performance category selected');
      assert.deepEqual(after.prefs, before.prefs, 'Window controls must not change saved graphics preferences');
      assert.ok(Object.entries(browserWindow.getBounds()).every(([key,value])=>Math.abs(value-bounds[key])<=1), 'Fullscreen exit must restore the original window bounds within Windows DPI rounding');

      const gpuLoaded = await until(state => !state.appearance.gpu.disabled && state.appearance.gpu.options.some(option=>option.value==='auto') && state.appearance.gpu.options.some(option=>option.value!=='auto'&&!option.disabled), `${design} usable GPU list`);
      assert.equal(gpuLoaded.appearance.gpu.error,'','Real hardware enumeration must succeed');
      assert.ok(!/Not yet confirmed|尚未确认/.test(gpuLoaded.appearance.gpu.active), 'Current driver-reported GPU must be shown');
      const inventory = await evaluate('window.rhineDesktop.gpuInfo()');
      assert.equal(inventory.adapters.length, new Set(inventory.adapters.map(adapter=>adapter.deviceIdentifier)).size, 'Each physical GPU identity must appear once');
      assert.ok(inventory.adapters.every(adapter=>adapter.location && !adapter.location.startsWith('@')), 'GPU choices must show readable physical device positions');
      assert.ok(gpuLoaded.appearance.gpu.options.filter(option=>option.value!=='auto').every(option=>/GiB|PCI|Device|设备/.test(option.label)), 'GPU labels must distinguish the selected device beyond its model name');
      const previousGpu = gpuLoaded.appearance.gpu.value;
      const alternative = previousGpu === 'auto'
        ? gpuLoaded.appearance.gpu.options.find(option=>option.value!=='auto'&&!option.disabled)?.value
        : 'auto';
      assert.ok(alternative,'GPU selection needs an available adapter and the automatic option');
      await evaluate(`(() => {const select=document.querySelector('#graphics-display-settings [data-gpu-preference]');select.value=${JSON.stringify(alternative)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      const saved = await until(state => !state.appearance.gpu.disabled && state.appearance.gpu.value === alternative && /Saved|已保存/.test(state.appearance.gpu.status), `${design} save GPU preference`);
      assert.ok(/reopen|重新打开/.test(saved.appearance.gpu.status), 'A changed startup GPU preference must explain the required restart');
      const invalidSelectionRejected = await evaluate(`window.rhineDesktop.selectGpu('untrusted-adapter-id').then(()=>false,()=>true)`);
      assert.equal(invalidSelectionRejected, true, 'Forged/nonexistent adapter IDs must not be accepted');
      await evaluate(`(() => {const select=document.querySelector('#graphics-display-settings [data-gpu-preference]');select.value=${JSON.stringify(previousGpu)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(state => !state.appearance.gpu.disabled && state.appearance.gpu.value === previousGpu && /Saved|已保存/.test(state.appearance.gpu.status), `${design} restore GPU preference`);
      await click('#music-settings [data-settings-category-target=interface]');
      await evaluate(`(() => {const wave=document.querySelector('#motion-settings [data-quality=wave]');wave.value='off';wave.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      const originalRenderQuality={...(await snapshot()).prefs.renderQuality,wave:originalWave};
      assert.equal(await evaluate('document.querySelector("#quality-preset").value'), originalQualityPreset, 'Changing motion must not turn the unchanged render preset into Custom');
      await click('#music-settings [data-settings-category-target=appearance]');
      await evaluate(`(() => {const preset=document.querySelector('#quality-preset');preset.value='performance';preset.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.equal((await snapshot()).prefs.renderQuality.wave,'off','Render presets must retain the independent motion preference');
      await evaluate(`(() => {const preset=document.querySelector('#quality-preset');preset.value=${JSON.stringify(originalQualityPreset)};preset.dispatchEvent(new Event('change',{bubbles:true}));const wave=document.querySelector('#motion-settings [data-quality=wave]');wave.value=${JSON.stringify(originalWave)};wave.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.deepEqual((await snapshot()).prefs.renderQuality,originalRenderQuality,'The motion/preset check must restore the original render preferences');
      await capture(`${design}-window`, '#graphics-display-settings');
      await capture(`${design}-gpu`, '#graphics-display-settings .gpu-settings');
      await capture(`${design}-render`, '#graphics-display-settings .quality-settings');
      cases.push({ design, styleAppearanceOnly:true, settingsCategories:settingsCategories, fullscreenInAppearance:true, nativeEnterAndExit:true, escapeExit:true, boundsRestored:true, gpuChoices:gpuLoaded.appearance.gpu.options, gpuInventory:inventory.diagnostics, activeGpu:gpuLoaded.appearance.gpu.active, gpuSaveAndReset:true, invalidGpuRejected:true });
      if(design!=='archive') await closeSettingsToStyle();
    }
    const savedTheme = await evaluate('document.querySelector("#stage").dataset.theme');
    for (const design of ['rhine', 'archive']) {
      for (const theme of ['day', 'night']) {
        await openStyle();
        await click(`.design-family-card[data-style-design=${design}]`);
        await until(state=>state.design===design&&state.styleTitle==='STYLE',`${design} switch appearance`);
        await click(`aside.theme-mode-controls button[data-theme=${theme}]`);
        await click('.music-topnav [data-action=settings]');
        await until(state=>state.page==='settings','Settings switch check');
        await click('#music-settings [data-settings-category-target=interface]');
        await until(state=>state.category==='interface','interface switch controls');
        const interfaceSound = await evaluate(`(() => ({
          disabled:document.querySelector('#sound-setting').disabled,
          volumeDisabled:document.querySelector('#sound-volume').disabled,
          status:document.querySelector('#interface-sound-status').textContent,
        }))()`);
        assert.equal(interfaceSound.disabled,design==='archive','Only Future may enable the reference interface sounds');
        assert.equal(interfaceSound.volumeDisabled,design==='archive','Punk sound volume must remain reserved');
        assert.match(interfaceSound.status,design==='archive'?/Punk/:/Future/);
        if(theme==='day')await capture(`${design}-interface-sound`,'#interface-sound-settings');
        await evaluate(`(() => {
          // Background state sync owns the real controls. Use an identical
          // stand-in for this CSS-only endpoint check without changing any
          // sound/BGM preference or dispatching user-input events.
          window.__settingsSwitchProbe=[...document.querySelectorAll('#music-settings input[type=checkbox][role=switch]')].filter(node=>node.getClientRects().length).map(original=>{
            const node=original.cloneNode(true),sourceId=original.id,display=original.style.getPropertyValue('display'),priority=original.style.getPropertyPriority('display');
            node.removeAttribute('id');original.after(node);original.style.setProperty('display','none','important');
            return {node,original,sourceId,display,priority};
          });
        })()`);
        try {
          for (const checked of [false, true]) {
            await evaluate(`(() => {
              window.__settingsSwitchProbe.forEach(({node})=>{
                node.checked=${checked};node.indeterminate=false;
                getComputedStyle(node,'::after').transform;
              });
              return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            })()`);
            const endpointDeadline=Date.now()+2000;
            let measurements=[];
            let endpointReached=false;
            while(Date.now()<endpointDeadline){
              measurements=await evaluate(`window.__settingsSwitchProbe.map(({node,sourceId})=>{
              const thumb=getComputedStyle(node,'::after'),style=getComputedStyle(node),x=new DOMMatrixReadOnly(thumb.transform==='none'?undefined:thumb.transform).m41;
              const inset=parseFloat(thumb.left),left=inset+x,top=parseFloat(thumb.top),size=parseFloat(thumb.width);
              return {id:sourceId,checked:node.checked,indeterminate:node.indeterminate,width:node.getBoundingClientRect().width,flexBasis:style.flexBasis,inset,left,right:node.clientWidth-left-size,top,bottom:node.clientHeight-top-parseFloat(thumb.height),transform:thumb.transform};
              })`);
              endpointReached=measurements.length>=4&&measurements.every(item=>item.checked===checked&&Math.abs((checked?item.right:item.left)-item.inset)<=1&&Math.abs(item.top-item.bottom)<=1);
              if(endpointReached)break;
              await pause(50);
            }
            assert.ok(measurements.length>=4, 'The interface category must expose its real settings switches');
            for(const item of measurements){
              assert.equal(item.checked,checked,`${design}/${theme}/${item.id} must retain the requested binary state`);
              assert.equal(item.indeterminate,false);
              assert.ok(Math.abs((checked?item.right:item.left)-item.inset)<=1,`${design}/${theme}/${item.id} thumb must reach the ${checked?'right':'left'} endpoint within 2s; backgroundThrottling=${wc.getBackgroundThrottling()}: ${JSON.stringify(item)}`);
              assert.ok(Math.abs(item.top-item.bottom)<=1,`${design}/${theme}/${item.id} thumb must be vertically centered`);
            }
            switchChecks.push({design,theme,checked,measurements,backgroundThrottling:wc.getBackgroundThrottling(),endpointReached});
            if(design==='rhine'&&theme==='day') await capture(`future-switches-${checked?'on':'off'}`,'#motion-settings');
          }
        } finally {
          await evaluate(`window.__settingsSwitchProbe?.forEach(({node,original,display,priority})=>{node.remove();if(display)original.style.setProperty('display',display,priority);else original.style.removeProperty('display')});delete window.__settingsSwitchProbe;`);
        }
        await checkSettingsRange(design,theme);
      }
    }
    await openStyle();
    await click(`aside.theme-mode-controls button[data-theme=${savedTheme}]`);
    const dayPalette = await checkDayPalette({ browserWindow, outputDirectory });
    return { ok: futureSettings.ok, cases, screenshots: [...screenshots, ...dayPalette.screenshots, ...futureSettings.screenshots], switchChecks, rangeChecks, dayPalette, futureSettings };
  } finally {
    if (!browserWindow.isDestroyed()) { if (browserWindow.isFullScreen()) browserWindow.setFullScreen(false); wc.setBackgroundThrottling(true); }
  }
}
