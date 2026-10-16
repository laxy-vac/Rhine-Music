import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const viewports = [{ width: 1280, height: 900 }, { width: 1920, height: 1080 }];
const themes = ["day", "night"];
const modes = ["parametric", "graphic"];
const waitPaint = evaluate => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");

export async function checkEqLegend({ command, evaluate, output, project }) {
  assert.ok(command && evaluate && output && project, "EQ legend check needs the shared offline browser fixture.");
  await mkdir(output, { recursive: true });
  const bundle = await build({
    stdin: {
      contents: `export { renderEqControls, setupEqControls } from "./src/eq-controls";\nexport { normalizeProcessing } from "./src/audio-processing-model.mjs";`,
      resolveDir: project,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "EqLegendFixture",
    define: { "import.meta.glob": "fixtureGlob" },
    banner: { js: "const fixtureGlob = () => ({});" },
    logLevel: "silent",
  });
  await evaluate(bundle.outputFiles[0].text);

  const report = { ok: false, mode: "eq-legend", syntheticDataOnly: true, audioOrServicesUsed: false, cases: [], failures: [], screenshots: [] };
  const capture = async (name, rect, viewport) => {
    const left = Math.max(0, Math.floor(rect.left));
    const top = Math.max(0, Math.floor(rect.top));
    const right = Math.min(viewport.width, Math.ceil(rect.right));
    const bottom = Math.min(viewport.height, Math.ceil(rect.bottom));
    const clip = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top), scale: 1 };
    const { data } = await command("Page.captureScreenshot", { format: "png", clip });
    await writeFile(path.join(output, name), Buffer.from(data, "base64"));
    report.screenshots.push({ name, clip });
    return name;
  };
  const measure = selector => evaluate(`(() => {
    const button=document.querySelector(${JSON.stringify(selector)});
    const root=button?.closest('.eq-controls'), figure=root?.querySelector('.eq-response-figure');
    const chart=figure?.querySelector('.eq-response-chart'), legend=figure?.querySelector('.eq-response-legend');
    const caption=figure?.querySelector('figcaption');
    if(!button||!root||!figure||!chart||!legend||!caption) return {missing:true};
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const bounds=node=>{const r=node.getBoundingClientRect();return {left:r.left+node.clientLeft,top:r.top+node.clientTop,right:r.left+node.clientLeft+node.clientWidth,bottom:r.top+node.clientTop+node.clientHeight};};
    const clips=[];let clip={left:0,top:0,right:innerWidth,bottom:innerHeight};
    for(let node=button.parentElement;node;node=node.parentElement){
      const s=getComputedStyle(node), x=s.overflowX!=='visible', y=s.overflowY!=='visible';
      if(!x&&!y) continue;
      if(node.clientWidth<1||node.clientHeight<1) continue;
      const r=bounds(node), entry={node:node.id?'#'+node.id:'.'+String(node.className?.baseVal??node.className??'').trim().replace(/\\s+/g,'.'),overflowX:s.overflowX,overflowY:s.overflowY,rect:r};
      clips.push(entry);
      if(x){clip.left=Math.max(clip.left,r.left);clip.right=Math.min(clip.right,r.right);}
      if(y){clip.top=Math.max(clip.top,r.top);clip.bottom=Math.min(clip.bottom,r.bottom);}
    }
    const b=rect(button), point={x:b.left+b.width/2,y:Math.min(b.bottom-0.5,b.top+1.5)};
    const hit=document.elementFromPoint(point.x,point.y), stack=document.elementsFromPoint(point.x,point.y).slice(0,5);
    const f=getComputedStyle(figure), l=getComputedStyle(legend), c=getComputedStyle(chart), bs=getComputedStyle(button);
    return {
      state:{selected:button.classList.contains('is-selected'),pressed:button.getAttribute('aria-pressed'),hover:button.matches(':hover'),focusVisible:button.matches(':focus-visible')},
      rects:{figure:rect(figure),chart:rect(chart),legend:rect(legend),button:b},
      chartBottomToLegendTop:rect(legend).top-rect(chart).bottom,
      legendTopClearance:b.top-rect(legend).top,
      containment:{legendInside:rect(legend).top>=rect(figure).top&&rect(legend).bottom<=rect(figure).bottom,captionInside:rect(caption).top>=rect(figure).top&&rect(caption).bottom<=rect(figure).bottom,figureScroll:{scrollWidth:figure.scrollWidth,clientWidth:figure.clientWidth,scrollHeight:figure.scrollHeight,clientHeight:figure.clientHeight}},
      clip:{effective:clip,ancestors:clips,clippedTop:Math.max(0,clip.top-b.top),clippedBottom:Math.max(0,b.bottom-clip.bottom),visibleHeight:Math.max(0,Math.min(b.bottom,clip.bottom)-Math.max(b.top,clip.top))},
      upperHit:{point,hitTag:hit?.tagName??null,hitClass:String(hit?.className?.baseVal??hit?.className??''),hitsButton:hit===button||button.contains(hit),svgOnTop:!!hit?.closest?.('svg.eq-response-chart'),stack:stack.map(node=>({tag:node.tagName,class:String(node.className?.baseVal??node.className??'')}))},
      styles:{figure:{overflow:f.overflow,gridTemplateRows:f.gridTemplateRows,gap:f.rowGap,height:f.height,paddingTop:f.paddingTop,paddingBottom:f.paddingBottom},chart:{overflow:c.overflow,height:c.height},legend:{overflowX:l.overflowX,overflowY:l.overflowY,height:l.height,paddingTop:l.paddingTop,paddingBottom:l.paddingBottom},button:{height:bs.height,minHeight:bs.minHeight,paddingTop:bs.paddingTop,paddingBottom:bs.paddingBottom,borderTopWidth:bs.borderTopWidth,boxShadow:bs.boxShadow,outline:bs.outline,outlineStyle:bs.outlineStyle,outlineWidth:bs.outlineWidth,outlineOffset:bs.outlineOffset,outlineColor:bs.outlineColor,transform:bs.transform}},
      focusRing:{width:parseFloat(bs.outlineWidth)||0,offset:parseFloat(bs.outlineOffset)||0,outerExtent:button.matches(':focus-visible')?(parseFloat(bs.outlineWidth)||0)+Math.max(0,parseFloat(bs.outlineOffset)||0):0,topClearance:b.top-rect(legend).top,estimatedClippedTop:button.matches(':focus-visible')?Math.max(0,(parseFloat(bs.outlineWidth)||0)+Math.max(0,parseFloat(bs.outlineOffset)||0)-(b.top-rect(legend).top)):0},
    };
  })()`);

  for (const viewport of viewports) {
    await command("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
    for (const theme of themes) {
      const pageState = await evaluate(`(async()=>{
        await fixture.switchDesign('rhine');fixture.shell.setActive(false);await fixture.setTheme(${JSON.stringify(theme)});fixture.setPage('eq');
        for(const id of ['music-settings','music-theme-page','music-lyrics-page','music-signal-page','music-detail']){const node=document.getElementById(id);if(node){node.hidden=true;node.inert=true;}}
        const eq=document.querySelector('#music-eq-page');eq.hidden=false;eq.inert=false;
        const browse=document.querySelector('#music-browse');if(browse){browse.hidden=true;browse.inert=true;}
        return {design:fixture.stage.dataset.design,theme:fixture.stage.dataset.theme,page:fixture.stage.dataset.page,eqHidden:eq.hidden,shellActive:fixture.shell.active??null};
      })()`);
      assert.equal(pageState.design, "rhine", "The fixture keeps Future/Rhine design while changing theme palettes.");
      assert.equal(pageState.eqHidden, false, "The actual EQ page is visible in the fixture.");
      await waitPaint(evaluate);
      for (const mode of modes) {
        const mount = await evaluate(`(() => {
          const U=EqLegendFixture, settings=U.normalizeProcessing(undefined);
          settings.eq.engine='standard';settings.eq.enabled=true;settings.eq.mode=${JSON.stringify(mode)};
          const count=${mode === "parametric" ? 6 : 10};
          settings.eq.bands=settings.eq.bands.slice(0,count).map((band,index)=>({...band,type:${mode === "parametric" ? 3 : 2},q:${mode === "parametric" ? .707 : 0},gain:index===0?-6:index===1?0:(index%2?3:-2),enabled:true,locked:false}));
          const content=document.querySelector('#eq-page-content');content.replaceChildren();
          const editor=document.createElement('div');editor.id='eq-page-editor';editor.innerHTML=U.renderEqControls(settings);content.append(editor);
          const root=editor.querySelector('.eq-controls');let current=settings;
          const controller=U.setupEqControls(root,()=>current,next=>{current=next;});
          window.eqLegendFixture={root,controller,get settings(){return current;}};
          return {mode:${JSON.stringify(mode)},bandCount:current.eq.bands.length,design:fixture.stage.dataset.design,theme:fixture.stage.dataset.theme};
        })()`);
        assert.equal(mount.mode, mode);
        const selector=`#eq-page-content .eq-response-legend button[data-eq-focus-band="1"]`;
        await waitPaint(evaluate);
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
        await waitPaint(evaluate);
        const placement = await evaluate(`(()=>{
          const page=document.querySelector('#eq-page-content'),figure=page.querySelector('.eq-response-figure'),playback=document.querySelector('#music-playback');
          figure.scrollIntoView({block:'center',behavior:'instant'});
          const playTop=playback?.getBoundingClientRect().top??innerHeight;
          page.scrollTop+=Math.max(0,figure.getBoundingClientRect().bottom-(playTop-6));
          const f=figure.getBoundingClientRect();return {figure:{top:f.top,bottom:f.bottom},playbackTop:playTop,scrollTop:page.scrollTop};
        })()`);
        assert.ok(placement.figure.bottom <= placement.playbackTop, `EQ response figure must be above the playback overlay: ${JSON.stringify(placement)}`);
        await waitPaint(evaluate);
        const figureRect = await evaluate(`(()=>{const r=document.querySelector('#eq-page-content .eq-response-figure').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};})()`);
        const viewportData = { ...viewport, theme, mode, mount, pageState, placement, figure: figureRect, states: {}, screenshots: {} };
        const fullName = `future-${mode}-${theme}-${viewport.width}x${viewport.height}-figure.png`;
        viewportData.screenshots.full = await capture(fullName, figureRect, viewport);
        for (const state of ["selected", "hover", "focus"]) {
          if (state === "hover") {
            const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
            await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
            await waitPaint(evaluate);
          } else if (state === "focus") {
            await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0, button: "none" });
            await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
            await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            await waitPaint(evaluate);
          }
          const data = await measure(selector);
          assert.equal(data.missing, undefined, `Legend target exists in ${mode}/${theme}/${viewport.width}.`);
          assert.ok(data.rects.figure.width>0&&data.rects.figure.height>0&&data.rects.legend.width>0&&data.rects.legend.height>0&&data.rects.button.width>0&&data.rects.button.height>0, `Future EQ/legend/button have real visible geometry in ${mode}/${theme}/${viewport.width}: ${JSON.stringify(data.rects)}`);
          if (state === "focus") assert.equal(data.state.focusVisible, true, `Legend receives keyboard-visible focus in ${mode}/${theme}/${viewport.width}.`);
          viewportData.states[state] = data;
          const chart = data.rects.chart, button = data.rects.button, figure = data.rects.figure;
          const detail = { left: Math.max(figure.left, button.left - 12), top: Math.min(chart.bottom - 8, button.top - 8), right: Math.min(figure.right, button.right + 12), bottom: Math.min(figure.bottom, button.bottom + 10) };
          const closeName = `future-${mode}-${theme}-${viewport.width}x${viewport.height}-${state}-legend-closeup.png`;
          viewportData.screenshots[state] = await capture(closeName, detail, viewport);
          if (data.chartBottomToLegendTop < 6) report.failures.push(`${mode}/${theme}/${viewport.width}: chart-to-legend gap is ${data.chartBottomToLegendTop.toFixed(2)}px, below 6px in ${state}.`);
          if (data.clip.clippedTop > 0.5 || data.clip.clippedBottom > 0.5) report.failures.push(`${mode}/${theme}/${viewport.width}: legend button is clipped by ${data.clip.clippedTop.toFixed(2)}px top / ${data.clip.clippedBottom.toFixed(2)}px bottom in ${state}.`);
          if (state === "focus" && data.focusRing.estimatedClippedTop > 0.5) report.failures.push(`${mode}/${theme}/${viewport.width}: focus outline clips at legend top by an estimated ${data.focusRing.estimatedClippedTop.toFixed(2)}px (outline ${data.focusRing.width}px + offset ${data.focusRing.offset}px, top clearance ${data.focusRing.topClearance.toFixed(2)}px).`);
          if (!data.containment.legendInside || !data.containment.captionInside || data.containment.figureScroll.scrollWidth > data.containment.figureScroll.clientWidth + 1 || data.containment.figureScroll.scrollHeight > data.containment.figureScroll.clientHeight + 1) report.failures.push(`${mode}/${theme}/${viewport.width}: figure, legend, or caption exceeds the closed response panel in ${state}: ${JSON.stringify(data.containment)}.`);
          if (!data.upperHit.hitsButton || data.upperHit.svgOnTop) report.failures.push(`${mode}/${theme}/${viewport.width}: legend upper edge hit lands on ${data.upperHit.hitTag}.${data.upperHit.hitClass ? '.' + data.upperHit.hitClass : ''} in ${state}.`);
        }
        viewportData.palette = await evaluate(`(()=>{const page=document.querySelector('#music-eq-page'),style=getComputedStyle(page);return {design:fixture.stage.dataset.design,theme:fixture.stage.dataset.theme,panel:style.getPropertyValue('--future-eq-panel').trim(),accent:style.getPropertyValue('--future-eq-accent').trim()};})()`);
        report.cases.push(viewportData);
        await evaluate(`window.eqLegendFixture?.controller?.destroy()`);
      }
    }
  }
  report.ok = report.failures.length === 0;
  report.generatedAt = new Date().toISOString();
  report.reportPath = path.join(output, "eq-legend-report.json");
  await writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!report.ok) throw new Error(`EQ legend baseline found ${report.failures.length} clipping/hit-test issue(s); details and screenshots are in ${report.reportPath}.`);
  return report;
}
