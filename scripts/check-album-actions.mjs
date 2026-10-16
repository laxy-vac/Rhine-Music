import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function checkAlbumActions({ command, evaluate, output, main }) {
  const playSource = main.match(/function playSelectedAlbum\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(playSource, "The production playSelectedAlbum function must remain extractable.");
  assert.match(playSource, /const album = currentAlbum\(\)/);
  assert.match(playSource, /if \(!album\?\.tracks\.length \|\| album\.offline\) return/);
  assert.match(playSource, /player\.play\(album\.tracks\[0\]\.id, album\.tracks\)/);
  assert.doesNotMatch(playSource, /setMode|presentation|scene\./,
    "Playing an album must stay independent of navigation, presentation, and scene callbacks.");
  const selectionSource = main.match(/function updateSelection\([\s\S]*?\n\}/)?.[0];
  assert.ok(selectionSource, "The production selection updater must remain extractable.");
  const formatSummarySource = main.match(/function albumFormatSummary\([\s\S]*?\n\}/)?.[0];
  assert.ok(formatSummarySource, "The production album format summary must remain extractable.");
  assert.match(formatSummarySource, /valueRange\(/,
    "Album metadata ranges use the production valueRange helper.");
  assert.match(selectionSource,
    /const formatLabel\s*=\s*demo\s*\?\s*"DEMO"\s*:\s*albumFormatSummary\(sourceAlbum,\s*foobar\)/,
    "Selection text uses the focused source album and the design-specific format summary.");
  assert.match(selectionSource, /format:\s*formatLabel/,
    "The real text-motion controller receives the computed format label.");
  assert.match(selectionSource,
    /\$<HTMLButtonElement>\("\.browse-play-album"\)\.disabled = !a\?\.tracks\.length \|\| !!a\.offline;/,
    "The play button is disabled for empty and offline albums.");
  assert.match(main, /case "play-album":\s*playSelectedAlbum\(\);\s*break;/,
    "The production click action must delegate to playSelectedAlbum.");
  assert.match(main, /class="browse-play-album" data-action="play-album"/);
  assert.match(main, /class="play-album-icon"[^>]*>\$\{icons\.play\}/,
    "The play control must use the existing production play icon.");

  assert.equal(await evaluate("fixture.productionClickListenerInstalled"), true,
    "The browser fixture must install the extracted production click listener.");
  await command("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

  const visuals = [];
  for (const design of ["archive", "rhine"]) {
    for (const theme of ["day", "night"]) {
      await evaluate(`(async()=>{
        const f=fixture,style={...f.preferences.style,design:${JSON.stringify(design)},scheme:${JSON.stringify(design === "archive" ? "archive" : "rhine")}};
        f.setPage('music');f.stage.dataset.layout='desktop';f.preferences.style=style;f.preferences.theme=${JSON.stringify(theme)};
        f.stage.dataset.theme=${JSON.stringify(theme)};f.stage.dataset.mode='archive';f.applyStylePalette(f.stage,style,${JSON.stringify(theme)});
        f.musicApplication.mode='archive';f.syncDesignIdentity();
        f.renderSourceDetail();f.sharedPanel.setVisible(true);f.sharedPanel.setOpen(false);f.sharedPanel.finish();
        await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        await new Promise(r=>setTimeout(r,200));
      })()`);
      const appearance = await evaluate(`(()=>{
        const f=fixture,actions=document.querySelector('.album-panel .album-actions');
        const play=actions?.querySelector('.browse-play-album'),open=actions?.querySelector('.open-album');
        const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const style=e=>{const s=getComputedStyle(e);return{display:s.display,fontFamily:s.fontFamily,fontSize:s.fontSize,minHeight:s.minHeight,
          letterSpacing:s.letterSpacing,background:s.backgroundColor,color:s.color,borderRadius:s.borderRadius,outlineWidth:s.outlineWidth,
          outlineStyle:s.outlineStyle,outlineColor:s.outlineColor,outlineOffset:s.outlineOffset,
          borderTopWidth:s.borderTopWidth,borderTopStyle:s.borderTopStyle,borderTopColor:s.borderTopColor,
          borderRightWidth:s.borderRightWidth,borderRightStyle:s.borderRightStyle,borderRightColor:s.borderRightColor,
          borderBottomWidth:s.borderBottomWidth,borderBottomStyle:s.borderBottomStyle,borderBottomColor:s.borderBottomColor,
          borderLeftWidth:s.borderLeftWidth,borderLeftStyle:s.borderLeftStyle,borderLeftColor:s.borderLeftColor};};
        const labelStyle=e=>{const s=getComputedStyle(e);return{fontSize:s.fontSize,lineHeight:s.lineHeight};};
        const ink=e=>{const raw=getComputedStyle(e).getPropertyValue('--ink').trim(),probe=document.createElement('span');
          probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;transition:none!important;color:var(--ink)!important';
          e.append(probe);const resolved=getComputedStyle(probe).color;probe.remove();return{raw,resolved};};
        const icon=play?.querySelector('.play-album-icon'),svg=icon?.querySelector('svg');
        const arrow=open?.querySelector('.open-album-punk-arrow'),arrowStyle=arrow&&getComputedStyle(arrow),arrowSvg=arrow?.querySelector('svg');
        return{design:f.stage.dataset.design,theme:f.stage.dataset.theme,mode:f.stage.dataset.mode,
          pointer:{coarse:matchMedia('(any-pointer: coarse)').matches},
          page:f.stage.dataset.page,actions:{count:actions?.children.length,role:actions?.getAttribute('role'),aria:actions?.getAttribute('aria-label'),hidden:actions?.hidden,inert:actions?.inert,
            display:getComputedStyle(actions).display,flexDirection:getComputedStyle(actions).flexDirection,
            justifyContent:getComputedStyle(actions).justifyContent,columnGap:getComputedStyle(actions).columnGap,rowGap:getComputedStyle(actions).rowGap,rect:rect(actions),
            style:style(actions),
            order:[...actions.children].map(node=>node.dataset.action)},
          ink:{stage:ink(f.stage),panel:ink(document.querySelector('.album-panel')),play:ink(play),open:ink(open)},
          counts:{play:document.querySelectorAll('.browse-play-album').length,open:document.querySelectorAll('.open-album').length},
          native:{playTag:play?.tagName,playType:play?.type,playAction:play?.dataset.action,openTag:open?.tagName,openType:open?.type,openAction:open?.dataset.action},
          play:{aria:play?.getAttribute('aria-label'),disabled:play?.disabled,visible:!play?.hidden&&play?.getClientRects().length>0,
            label:play?.querySelector('.play-album-label')?.textContent.trim(),labelDisplay:getComputedStyle(play?.querySelector('.play-album-label')).display,
            labelStyle:labelStyle(play?.querySelector('.play-album-label')),
            access:play?.querySelector('.play-album-access-label')?.textContent.trim(),accessDisplay:getComputedStyle(play?.querySelector('.play-album-access-label')).display,
            rect:rect(play),style:style(play),iconDisplay:getComputedStyle(icon).display,
            iconRect:rect(icon),labelRect:rect(play?.querySelector('.play-album-label')),
            svg:svg?{width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,viewBox:svg.getAttribute('viewBox'),markup:svg.outerHTML}:null},
          open:{aria:open?.getAttribute('aria-label'),visible:!open?.hidden&&open?.getClientRects().length>0,
            label:open?.querySelector('.open-album-label')?.textContent.trim(),labelDisplay:getComputedStyle(open?.querySelector('.open-album-label')).display,
            labelStyle:labelStyle(open?.querySelector('.open-album-label')),
            access:open?.querySelector('.open-album-access-label')?.textContent.trim(),accessDisplay:getComputedStyle(open?.querySelector('.open-album-access-label')).display,
            rect:rect(open),labelRect:rect(open?.querySelector('.open-album-label')),style:style(open),
            arrow:arrow?{display:arrowStyle.display,color:arrowStyle.color,
              svg:arrowSvg?{width:arrowSvg.getBoundingClientRect().width,height:arrowSvg.getBoundingClientRect().height,
                viewBox:arrowSvg.getAttribute('viewBox'),markup:arrowSvg.outerHTML}:null,rect:rect(arrow)}:null},
          article:{hidden:document.querySelector('#album-detail-content').hidden,inert:document.querySelector('#album-detail-content').inert}};
      })()`);
      assert.equal(appearance.design, design);
      assert.equal(appearance.theme, theme);
      assert.equal(appearance.mode, "archive");
      assert.equal(appearance.page, "music");
      assert.equal(appearance.counts.play, 1, `${design}/${theme}: exactly one play action`);
      assert.equal(appearance.counts.open, 1, `${design}/${theme}: exactly one open action`);
      assert.equal(appearance.actions.count, 2);
      assert.equal(appearance.actions.hidden, false);
      assert.equal(appearance.actions.inert, false);
      assert.equal(appearance.actions.role,"group");
      assert.equal(appearance.actions.aria,"专辑操作");
      assert.deepEqual(appearance.native,{playTag:"BUTTON",playType:"button",playAction:"play-album",openTag:"BUTTON",openType:"button",openAction:"open"},
        `${design}/${theme}: play and open remain distinct native button actions.`);
      assert.equal(appearance.actions.order[0], "play-album");
      assert.equal(appearance.actions.order[1], "open");
      assert.equal(appearance.play.disabled, false);
      assert.equal(appearance.play.visible, true);
      assert.equal(appearance.open.visible, true);
      assert.equal(appearance.article.hidden, true);
      assert.equal(appearance.article.inert, true);
      assert.equal(appearance.play.style.borderRadius, "0px");
      assert.equal(appearance.open.style.borderRadius, "0px");
      assert.equal(appearance.play.style.fontFamily, appearance.open.style.fontFamily);
      assert.equal(appearance.play.style.fontSize, appearance.open.style.fontSize);

      if (design === "archive") {
        assert.equal(appearance.actions.flexDirection, "row");
        assert.equal(appearance.actions.justifyContent, "flex-start");
        assert.equal(appearance.play.label, "播放专辑");
        assert.notEqual(appearance.play.labelDisplay, "none");
        assert.equal(appearance.play.accessDisplay, "none");
        assert.equal(appearance.open.label, "打开专辑");
        assert.notEqual(appearance.open.labelDisplay, "none");
        assert.ok(appearance.play.rect.x < appearance.open.rect.x,
          `${theme}: Punk play is left of open.`);
        assert.ok(Math.abs(appearance.play.rect.y - appearance.open.rect.y) <= 2,
          `${theme}: Punk actions share a row.`);
        assert.deepEqual(appearance.play.labelStyle, appearance.open.labelStyle,
          `${theme}: Punk visible play/open labels share font size and line height.`);
        assert.ok(Math.abs(appearance.play.rect.height - appearance.open.rect.height) <= 1,
          `${theme}: Punk play/open buttons have matching heights.`);
        assert.ok(Math.abs(appearance.play.rect.right-appearance.open.rect.x)<=.25,
          `${theme}: the two Punk button halves meet with no gap.`);
        assert.ok(Math.abs(appearance.actions.rect.x-(appearance.play.rect.x-1))<=.25&&
          Math.abs(appearance.actions.rect.right-(appearance.open.rect.right+1))<=.25&&
          Math.abs(appearance.actions.rect.width-(appearance.play.rect.width+appearance.open.rect.width+2))<=.5,
          `${theme}: the Punk group bounds tightly wrap both buttons and the shared 1px outer frame.`);
        assert.equal(appearance.actions.columnGap,"0px",`${theme}: the Punk action group has no inter-button gap.`);
        assert.equal(appearance.actions.rowGap,"0px");
        assert.deepEqual([appearance.actions.style.borderTopWidth,appearance.actions.style.borderRightWidth,
          appearance.actions.style.borderBottomWidth,appearance.actions.style.borderLeftWidth],Array(4).fill("1px"),
          `${theme}: Punk uses one shared fine frame around the complete action group.`);
        assert.deepEqual([appearance.actions.style.borderTopColor,appearance.actions.style.borderRightColor,
          appearance.actions.style.borderBottomColor,appearance.actions.style.borderLeftColor],Array(4).fill(appearance.ink.stage.resolved),
          `${theme}: the shared Punk frame follows the current foreground.`);
        assert.equal(appearance.actions.style.outlineWidth,"1px");assert.equal(appearance.actions.style.outlineStyle,"solid");
        assert.equal(appearance.actions.style.outlineColor,appearance.open.arrow.color,
          `${theme}: the shared Punk outer frame follows the active accent.`);
        assert.equal(appearance.actions.style.outlineOffset,"4px");
        assert.equal(appearance.play.style.fontSize, "12px", `${theme}: Punk action text stays small.`);
        assert.equal(appearance.play.labelStyle.fontSize, "12px");
        assert.equal(appearance.play.labelStyle.lineHeight, "15px");
        const expectedMinHeight=appearance.pointer.coarse?"44px":"40px";
        assert.equal(appearance.play.style.minHeight, expectedMinHeight, `${theme}: Punk actions preserve the fine/coarse pointer target size.`);
        assert.equal(appearance.open.style.minHeight, expectedMinHeight);
        assert.ok(["flex","inline-flex"].includes(appearance.play.iconDisplay));
        assert.equal(appearance.play.svg?.width, 18);
        assert.equal(appearance.play.svg?.height, 18);
        assert.ok(appearance.play.iconRect.x < appearance.play.labelRect.x && appearance.play.iconRect.right <= appearance.play.labelRect.x + 2,
          `${theme}: Punk play triangle sits to the left of the label.`);
        assert.ok(appearance.play.svg?.markup.includes("m8 4.5 12 7.5-12 7.5Z"),
          "The Punk play control retains the production triangle icon.");
        assert.equal(appearance.open.style.background, "rgba(0, 0, 0, 0)", `${theme}: Punk open action has a transparent fill.`);
        assert.deepEqual([appearance.play.style.borderTopWidth,appearance.play.style.borderRightWidth,
          appearance.play.style.borderBottomWidth,appearance.play.style.borderLeftWidth],["0px","0px","0px","0px"],
          `${theme}: the play half does not duplicate the shared outer frame.`);
        assert.deepEqual([appearance.open.style.borderTopWidth,appearance.open.style.borderRightWidth,
          appearance.open.style.borderBottomWidth,appearance.open.style.borderLeftWidth],["0px","0px","0px","1px"],
          `${theme}: open contributes only the single shared divider.`);
        assert.ok(appearance.open.style.outlineStyle==="none"||appearance.open.style.outlineWidth==="0px",`${theme}: idle open has no independent outer outline.`);
        assert.ok(appearance.play.style.outlineStyle==="none"||appearance.play.style.outlineWidth==="0px",`${theme}: idle play has no independent outer outline.`);
        assert.ok(["flex","inline-flex"].includes(appearance.open.arrow.display));
        assert.equal(appearance.open.arrow.svg?.width, 18);
        assert.equal(appearance.open.arrow.svg?.height, 18);
        assert.equal(appearance.open.arrow.svg?.viewBox, "0 0 18 18");
        assert.ok(appearance.open.arrow.svg?.markup.includes("m4 14 10-10"),
          `${theme}: Punk open action uses the diagonal SVG arrow.`);
      } else {
        assert.equal(appearance.actions.flexDirection, "column");
        assert.equal(appearance.play.labelDisplay, "none");
        assert.equal(appearance.play.access, "PLAY ALBUM");
        assert.notEqual(appearance.play.accessDisplay, "none");
        assert.equal(appearance.open.labelDisplay, "none");
        assert.equal(appearance.open.access, "ACCESS ALBUM");
        assert.notEqual(appearance.open.accessDisplay, "none");
        assert.ok(appearance.play.rect.y < appearance.open.rect.y,
          `${theme}: Future PLAY ALBUM sits above ACCESS ALBUM.`);
        assert.ok(Math.abs(appearance.play.rect.x - appearance.open.rect.x) <= 1,
          `${theme}: Future action text and icon columns align.`);
        assert.ok(appearance.play.rect.bottom <= appearance.open.rect.y + 1,
          `${theme}: Future actions do not overlap.`);
        assert.ok(Math.abs(appearance.actions.rect.width - 188) <= 1,
          `${theme}: Future actions remain a tightly wrapped 188px vertical group.`);
        assert.ok(Math.abs(appearance.play.rect.width - appearance.actions.rect.width) <= 1 &&
          Math.abs(appearance.open.rect.width - appearance.actions.rect.width) <= 1,
          `${theme}: Future action rows retain their established full group width.`);
        assert.equal(appearance.play.style.background, "rgba(0, 0, 0, 0)");
        assert.equal(appearance.play.style.color, appearance.open.style.color,
          `${theme}: Future play/access text share a color. ${JSON.stringify(appearance.ink)}`);
        assert.equal(appearance.play.style.color, appearance.ink.stage.resolved,
          `${theme}: Future text follows the current stage --ink token. ${JSON.stringify(appearance.ink)}`);
        assert.equal(appearance.ink.play.resolved, appearance.ink.stage.resolved,
          `${theme}: Future play inherits the current stage --ink token. ${JSON.stringify(appearance.ink)}`);
        assert.equal(appearance.ink.open.resolved, appearance.ink.stage.resolved,
          `${theme}: Future access inherits the current stage --ink token. ${JSON.stringify(appearance.ink)}`);
        assert.notEqual(appearance.play.iconDisplay, "none");
        assert.ok(appearance.play.svg);
        assert.equal(appearance.play.svg.width, 20);
        assert.equal(appearance.play.svg.height, 20);
        assert.ok(appearance.play.svg.markup.includes("m8 4.5 12 7.5-12 7.5Z"),
          "The rendered control retains the production icons.play triangle.");
        assert.ok(appearance.play.style.fontFamily.includes("Archive Mono"));
      }

      const screenshot = `album-actions-${design}-${theme}.png`;
      const image = await command("Page.captureScreenshot", {
        format: "png",
        clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      });
      await writeFile(path.join(output, screenshot), Buffer.from(image.data, "base64"));
      let detailScreenshot;
      if (design === "archive" && theme === "day") {
        const r = appearance.actions.rect;
        const clip = { x: Math.max(0, Math.floor(r.x - 16)), y: Math.max(0, Math.floor(r.y - 16)),
          width: Math.ceil(r.width + 32), height: Math.ceil(r.height + 32), scale: 3 };
        const detail = await command("Page.captureScreenshot", { format: "png", clip });
        detailScreenshot = "punk-actions-near.png";
        await writeFile(path.join(output, detailScreenshot), Buffer.from(detail.data, "base64"));
      }
      visuals.push({ ...appearance, screenshot, ...(detailScreenshot ? { detailScreenshot } : {}) });
    }
  }

  const punkPaletteChecks = [];
  const futurePaletteResets = [];
  const formatFixtureAlbum = { tracks: [{ format: "FLAC", sampleRate: 88_200, bitsPerSample: 24, lossless: true }] };
  for (const scheme of ["archive", "field", "hazard"]) {
    for (const theme of ["day", "night"]) {
      const check = await evaluate(`(async()=>{
        const f=fixture,style={...f.preferences.style,design:'archive',scheme:${JSON.stringify(scheme)}},theme=${JSON.stringify(theme)};
        f.preferences.style=style;f.preferences.theme=theme;f.stage.dataset.theme=theme;
        const play=document.querySelector('.browse-play-album'),open=document.querySelector('.open-album');
        const transitionBefore=[play,open].map(element=>({value:element.style.getPropertyValue('transition'),priority:element.style.getPropertyPriority('transition')}));
        for(const element of [play,open])element.style.setProperty('transition','none','important');
        const palette=f.stylePalette(style,theme);
        f.applyStylePalette(f.stage,style,theme);f.syncDesignIdentity();
        const formatAlbum=${JSON.stringify(formatFixtureAlbum)},formatLabel=f.albumFormatSummary(formatAlbum,true),formatNode=document.querySelector('#selection-format');
        f.textMotion.update({...f.selection,format:formatLabel},false);formatNode.hidden=!formatLabel;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const color=value=>{const probe=document.createElement('span');probe.style.color=value;f.stage.append(probe);const resolved=getComputedStyle(probe).color;probe.remove();return resolved;};
        const groupStyle=getComputedStyle(document.querySelector('.album-actions'));
        const border=getComputedStyle(open),arrow=getComputedStyle(open.querySelector('.open-album-punk-arrow'));
        const formatStyle=getComputedStyle(formatNode),formatDot=getComputedStyle(formatNode,'::before'),formatRect=formatNode.getBoundingClientRect();
        const playStyle=getComputedStyle(play),actions=document.querySelector('.album-actions').getBoundingClientRect();
        return {scheme:${JSON.stringify(scheme)},theme,transitionBefore,expected:{accent:color(palette.accent),ink:color(palette.fg),pageBg:color(palette.bg)},
          computed:{outline:groupStyle.outlineColor,arrow:arrow.color,groupBorders:[groupStyle.borderTopColor,groupStyle.borderRightColor,groupStyle.borderBottomColor,groupStyle.borderLeftColor],
            divider:[border.borderTopWidth,border.borderRightWidth,border.borderBottomWidth,border.borderLeftWidth],
            playBackground:playStyle.backgroundColor,playColor:playStyle.color,format:{text:formatNode.innerText.trim(),display:formatStyle.display,
              rects:formatNode.getClientRects().length,borders:[formatStyle.borderTopWidth,formatStyle.borderRightWidth,formatStyle.borderBottomWidth,formatStyle.borderLeftWidth],
              borderColor:formatStyle.borderTopColor,color:formatStyle.color,background:formatStyle.backgroundColor,width:formatRect.width,height:formatRect.height,
              dot:{content:formatDot.content,display:formatDot.display,width:formatDot.width,height:formatDot.height,background:formatDot.backgroundColor}}},
          clip:{x:Math.max(0,Math.floor(actions.x-16)),y:Math.max(0,Math.floor(actions.y-16)),
            width:Math.ceil(actions.width+32),height:Math.ceil(actions.height+32),scale:3},
          formatClip:(()=>{const r=document.querySelector('.selection-rule').getBoundingClientRect();return{x:Math.max(0,Math.floor(r.x-8)),y:Math.max(0,Math.floor(r.y-5)),width:Math.ceil(r.width+16),height:Math.ceil(r.height+10),scale:3};})()};
      })()`);
      assert.equal(check.computed.outline, check.expected.accent,
        `${scheme}/${theme}: Punk open outline follows the real stylePalette accent.`);
      assert.equal(check.computed.arrow, check.expected.accent,
        `${scheme}/${theme}: Punk diagonal arrow follows the real stylePalette accent.`);
      assert.deepEqual(check.computed.groupBorders, Array(4).fill(check.expected.ink),
        `${scheme}/${theme}: the shared Punk frame follows the real stylePalette ink.`);
      assert.deepEqual(check.computed.divider,["0px","0px","0px","1px"],
        `${scheme}/${theme}: open contributes only the shared group divider.`);
      assert.equal(check.computed.playBackground, check.expected.ink,
        `${scheme}/${theme}: Punk play uses the real stylePalette ink as its solid fill.`);
      assert.equal(check.computed.playColor, check.expected.pageBg,
        `${scheme}/${theme}: Punk play text uses the real stylePalette page background.`);
      assert.equal(check.computed.format.text, "FLAC 24/88.2", `${scheme}/${theme}: Punk uses the compact source summary.`);
      assert.ok(["flex", "inline-flex"].includes(check.computed.format.display), `${scheme}/${theme}: Punk format summary is a compact framed label.`);
      assert.equal(check.computed.format.rects, 1, `${scheme}/${theme}: Punk format summary occupies one compact label.`);
      assert.ok(check.computed.format.width < 160 && check.computed.format.height <= 24,
        `${scheme}/${theme}: Punk format frame stays compact (${JSON.stringify(check.computed.format)}).`);
      assert.deepEqual(check.computed.format.borders, Array(4).fill("1px"),
        `${scheme}/${theme}: Punk format summary keeps its small border.`);
      assert.equal(check.computed.format.borderColor, check.expected.accent,
        `${scheme}/${theme}: Punk format frame follows the active stylePalette accent.`);
      assert.equal(check.computed.format.color, check.expected.ink,
        `${scheme}/${theme}: Punk format text follows the active ink.`);
      assert.equal(check.computed.format.dot.width, "5px");assert.equal(check.computed.format.dot.height, "5px");
      assert.equal(check.computed.format.dot.background, check.expected.accent,
        `${scheme}/${theme}: Punk format square follows the active stylePalette accent.`);
      if (scheme === "field" && theme === "day") {
        const image = await command("Page.captureScreenshot", { format: "png", clip: check.clip });
        check.detailScreenshot = "punk-actions-field-day.png";
        await writeFile(path.join(output, check.detailScreenshot), Buffer.from(image.data, "base64"));
        const headerImage = await command("Page.captureScreenshot", { format: "png", clip: check.formatClip });
        check.formatScreenshot = "album-header-punk-field-day.png";
        await writeFile(path.join(output, check.formatScreenshot), Buffer.from(headerImage.data, "base64"));
      }
      punkPaletteChecks.push(check);

      const future = await evaluate(`(async()=>{
        const f=fixture,style={...f.preferences.style,design:'rhine',scheme:'rhine'};
        f.preferences.style=style;f.preferences.theme=${JSON.stringify(theme)};f.stage.dataset.theme=${JSON.stringify(theme)};
        f.applyStylePalette(f.stage,style,${JSON.stringify(theme)});f.syncDesignIdentity();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const actions=document.querySelector('.album-actions'),play=document.querySelector('.browse-play-album'),open=document.querySelector('.open-album');
        const formatAlbum=${JSON.stringify(formatFixtureAlbum)},formatLabel=f.albumFormatSummary(formatAlbum,false),formatNode=document.querySelector('#selection-format');
        f.textMotion.update({...f.selection,format:formatLabel},false);formatNode.hidden=!formatLabel;
        const formatStyle=getComputedStyle(formatNode),formatDot=getComputedStyle(formatNode,'::before');
        return {design:f.stage.dataset.design,inlineAccent:f.stage.style.getPropertyValue('--accent'),
          direction:getComputedStyle(actions).flexDirection,playBackground:getComputedStyle(play).backgroundColor,
          groupWidth:actions.getBoundingClientRect().width,playWidth:play.getBoundingClientRect().width,playLabel:getComputedStyle(play.querySelector('.play-album-access-label')).display,
          openLabel:getComputedStyle(open.querySelector('.open-album-access-label')).display,
          format:{text:formatNode.innerText.trim(),display:formatStyle.display,rects:formatNode.getClientRects().length,
            borders:[formatStyle.borderTopWidth,formatStyle.borderRightWidth,formatStyle.borderBottomWidth,formatStyle.borderLeftWidth],
            color:formatStyle.color,background:formatStyle.backgroundColor,outline:formatStyle.outlineWidth,shadow:formatStyle.boxShadow,dotContent:formatDot.content}};
      })()`);
      assert.equal(future.design, "rhine", `${scheme}/${theme}: real Future palette application follows Punk checks.`);
      assert.equal(future.inlineAccent, "", `${scheme}/${theme}: Future clears inline Punk palette tokens.`);
      assert.equal(future.direction, "column");
      assert.equal(future.playBackground, "rgba(0, 0, 0, 0)");
      assert.ok(Math.abs(future.groupWidth - 188) <= 1);
      assert.ok(Math.abs(future.playWidth - future.groupWidth) <= 1);
      assert.notEqual(future.playLabel, "none");
      assert.notEqual(future.openLabel, "none");
      assert.equal(future.format.text, "FLAC · 24 bit / 88.2 kHz", `${theme}: Future retains depth and kHz in the plain text summary.`);
      assert.notEqual(future.format.display, "none");assert.equal(future.format.rects, 1);
      assert.deepEqual(future.format.borders, Array(4).fill("0px"), `${theme}: Future format remains unframed.`);
      assert.equal(future.format.background, "rgba(0, 0, 0, 0)");
      assert.equal(future.format.outline, "0px");assert.equal(future.format.shadow, "none");
      assert.ok(["none", "normal"].includes(future.format.dotContent), `${theme}: Future has no format square.`);
      if (theme === "day" && scheme === "field") {
        const clip = await evaluate(`(()=>{const r=document.querySelector('.selection-rule').getBoundingClientRect();return{x:Math.max(0,Math.floor(r.x-8)),y:Math.max(0,Math.floor(r.y-5)),width:Math.ceil(r.width+16),height:Math.ceil(r.height+10),scale:3};})()`);
        const image = await command("Page.captureScreenshot", { format: "png", clip });
        future.formatScreenshot = "album-header-future-day.png";
        await writeFile(path.join(output, future.formatScreenshot), Buffer.from(image.data, "base64"));
      }
      futurePaletteResets.push({ scheme, theme, ...future });
      await evaluate(`(()=>{
        const elements=[document.querySelector('.browse-play-album'),document.querySelector('.open-album')],snapshots=${JSON.stringify(check.transitionBefore)};
        elements.forEach((element,index)=>{const saved=snapshots[index];if(saved.value)element.style.setProperty('transition',saved.value,saved.priority);else element.style.removeProperty('transition');});
      })()`);
    }
  }
  assert.ok(new Set(punkPaletteChecks.map(check => check.computed.outline)).size >= 5,
    "Archive/Field/Hazard day/night must produce visibly different Punk accent colors.");
  const futureDay = visuals.find(item => item.design === "rhine" && item.theme === "day");
  const futureNight = visuals.find(item => item.design === "rhine" && item.theme === "night");
  assert.ok(futureDay && futureNight);
  assert.notEqual(futureNight.ink.stage.resolved, futureDay.ink.stage.resolved,
    `Future night text must resolve to the night --ink color, not the day color. Day=${JSON.stringify(futureDay.ink)} Night=${JSON.stringify(futureNight.ink)}`);

  const metadataCases = {
    flac24: { tracks: [{ format: "FLAC", sampleRate: 88_200, bitsPerSample: 24, lossless: true }] },
    mixedRange: { tracks: [
      { format: "FLAC", sampleRate: 96_000, bitsPerSample: 24, lossless: true },
      { format: "FLAC", sampleRate: 44_100, bitsPerSample: 16, lossless: true },
    ] },
    unknownFields: { tracks: [{ format: "FLAC", lossless: true }] },
    allUnknown: { tracks: [{ format: "", lossless: true }] },
    lossyNominalDepth: { tracks: [{ format: "AAC", sampleRate: 96_000, bitsPerSample: 24, lossless: false }] },
    dsd: { tracks: [{ format: "DSF", sampleRate: 2_822_400, bitsPerSample: 1, lossless: true }] },
  };
  const metadata = await evaluate(`(()=>{
    const f=fixture,format=document.querySelector('#selection-format'),cases=${JSON.stringify(metadataCases)},result={};
    for(const [name,album] of Object.entries(cases)){
      const compact=f.albumFormatSummary(album,true),plain=f.albumFormatSummary(album,false);
      f.stage.dataset.design='archive';f.textMotion.update({...f.selection,format:compact},false);format.hidden=!compact;
      const compactText=format.innerText.trim(),compactHidden=format.hidden;
      f.stage.dataset.design='rhine';f.textMotion.update({...f.selection,format:plain},false);format.hidden=!plain;
      result[name]={compact,plain,compactText,plainText:format.innerText.trim(),compactHidden};
    }
    return result;
  })()`);
  assert.equal(metadata.flac24.compact, "FLAC 24/88.2");
  assert.equal(metadata.flac24.plain, "FLAC · 24 bit / 88.2 kHz");
  assert.equal(metadata.flac24.compactText, metadata.flac24.compact);
  assert.equal(metadata.flac24.plainText, metadata.flac24.plain);
  assert.equal(metadata.mixedRange.compact, "FLAC 16–24/44.1–96");
  assert.equal(metadata.mixedRange.plain, "FLAC · 16–24 bit / 44.1–96 kHz");
  assert.equal(metadata.mixedRange.compactText, metadata.mixedRange.compact);
  assert.equal(metadata.unknownFields.compact, "FLAC");assert.equal(metadata.unknownFields.plain, "FLAC");
  assert.equal(metadata.allUnknown.compact, "");assert.equal(metadata.allUnknown.plain, "");assert.equal(metadata.allUnknown.compactHidden, true);
  assert.equal(metadata.lossyNominalDepth.compact, "AAC 96 kHz");assert.equal(metadata.lossyNominalDepth.plain, "AAC · 96 kHz");
  assert.doesNotMatch(metadata.lossyNominalDepth.compact, /24/);assert.doesNotMatch(metadata.lossyNominalDepth.plain, /24 bit/);
  assert.equal(metadata.dsd.compact, "DSF 1/2822.4");assert.equal(metadata.dsd.plain, "DSF · 1 bit / 2822.4 kHz");
  assert.equal(metadata.dsd.compactText, metadata.dsd.compact);assert.equal(metadata.dsd.plainText, metadata.dsd.plain);
  await writeFile(path.join(output, "album-format-summary.json"), JSON.stringify({ metadata, punkPaletteChecks: punkPaletteChecks.map(({scheme,theme,expected,computed,formatScreenshot})=>({scheme,theme,expected,format:computed.format,formatScreenshot})),
    futurePaletteResets:futurePaletteResets.map(({scheme,theme,format,formatScreenshot})=>({scheme,theme,format,formatScreenshot})) }, null, 2));

  await evaluate(`(()=>{
    const f=fixture;f.setPage('music');f.stage.dataset.design='archive';f.stage.dataset.theme='day';f.preferences.theme='day';
    const style={...f.preferences.style,design:'archive',scheme:'archive'};f.preferences.style=style;
    f.applyStylePalette(f.stage,style,'day');f.stage.dataset.mode='archive';f.musicApplication.mode='archive';f.syncDesignIdentity();
    f.sharedPanel.setVisible(true);f.sharedPanel.setOpen(false);f.sharedPanel.finish();
    f.musicApplication.view=Object.freeze({...f.musicApplication.view,show:'tracks'});
    f.focusMusicEntry('track|fixture-album|fixture-track-2');
    f.stage.dataset.operationFocus='right';f.presentation.pendingSelection={token:'keep-pending-selection'};
  })()`);
  const playback = await evaluate(`(()=>{
    const f=fixture,button=document.querySelector('.browse-play-album'),album=f.records[0].album;
    window.__albumOpenCallbackCalls=0;f.scene.onOpenAlbum=()=>{window.__albumOpenCallbackCalls++;};
    const stable=()=>JSON.stringify({appMode:f.musicApplication.mode,stageMode:f.stage.dataset.mode,page:f.stage.dataset.page,
      browseHidden:document.querySelector('#music-browse').hidden,detailHidden:document.querySelector('#music-detail').hidden,
      selectedIndex:f.musicApplication.selectedIndex,selectedAlbumId:f.musicApplication.selectedAlbumId,
      selectedTrackId:f.musicApplication.selectedTrackId,catalogFocus:f.musicApplication.catalogFocus,view:f.musicApplication.view,
      panelState:f.sharedPanel.element.dataset.panelState,articleHidden:document.querySelector('#album-detail-content').hidden,
      articleInert:document.querySelector('#album-detail-content').inert,actionsHidden:document.querySelector('.album-actions').hidden,
      actionsInert:document.querySelector('.album-actions').inert,pendingSelection:f.presentation.pendingSelection,
      presentationOpen:f.presentation.openCalls,presentationBack:f.presentation.backCalls});
    const before=stable(),plays=f.playCalls.length,played=f.played.length,wasPlaying=f.state.playing;
    button.focus({preventScroll:true});button.click();button.click();
    const calls=f.playCalls.slice(plays),last=calls.at(-1);
    return{focusEntry:f.musicApplication.catalogFocus?.trackId,expectedFocus:'fixture-track-2',firstTrackId:album.tracks[0].id,
      calls:calls.length,played:f.played.length-played,ids:calls.map(call=>call.id),queueLengths:calls.map(call=>call.tracks.length),
      sameAlbumQueue:calls.every(call=>call.tracks===album.tracks),lastQueueIsComplete:last?.tracks?.length===album.tracks.length,
      modeUnchanged:stable()===before,presentationOpen:f.presentation.openCalls,presentationBack:f.presentation.backCalls,
      openCallbackCalls:window.__albumOpenCallbackCalls,operationFocus:f.stage.dataset.operationFocus,
      domFocusRetained:document.activeElement===button,playingUnchanged:f.state.playing===wasPlaying&&f.state.playing===true,
      state:{appMode:f.musicApplication.mode,stageMode:f.stage.dataset.mode,panelState:f.sharedPanel.element.dataset.panelState,
        articleHidden:document.querySelector('#album-detail-content').hidden,articleInert:document.querySelector('#album-detail-content').inert,
        actionsHidden:document.querySelector('.album-actions').hidden,actionsInert:document.querySelector('.album-actions').inert}};
  })()`);
  assert.equal(playback.focusEntry, "fixture-track-2", "Fixture focuses a non-first TRACKS catalog entry.");
  assert.equal(playback.calls, 2, "Repeated action clicks each start playback instead of toggling pause.");
  assert.equal(playback.played, 2);
  assert.deepEqual(playback.ids, [playback.firstTrackId, playback.firstTrackId]);
  assert.deepEqual(playback.queueLengths, [30, 30], "The complete album track list is passed to the player.");
  assert.equal(playback.sameAlbumQueue, true);
  assert.equal(playback.lastQueueIsComplete, true);
  assert.equal(playback.modeUnchanged, true, "Play leaves browse mode and panel state unchanged.");
  assert.equal(playback.presentationOpen, 0);
  assert.equal(playback.presentationBack, 0);
  assert.equal(playback.openCallbackCalls, 0);
  assert.equal(playback.operationFocus, "right");
  assert.equal(playback.domFocusRetained, true);
  assert.equal(playback.playingUnchanged, true);
  assert.deepEqual(playback.state, { appMode: "archive", stageMode: "archive", panelState: "browse",
    articleHidden: true, articleInert: true, actionsHidden: false, actionsInert: false });

  const unavailable = await evaluate(`(()=>{
    const f=fixture,button=document.querySelector('.browse-play-album'),record=f.records[0],original=record.album;
    const start=f.playCalls.length;button.disabled=false;record.album={...original,offline:true};
    button.click();f.playSelectedAlbum();const offlineNoPlay=f.playCalls.length===start;
    record.album={...original,tracks:[]};button.click();f.playSelectedAlbum();const emptyNoPlay=f.playCalls.length===start;
    record.album=original;return{offlineNoPlay,emptyNoPlay,calls:f.playCalls.length-start};
  })()`);
  assert.equal(unavailable.offlineNoPlay, true, "Offline albums do not play through either click or the extracted helper.");
  assert.equal(unavailable.emptyNoPlay, true, "Empty albums do not play through either click or the extracted helper.");
  assert.equal(unavailable.calls, 0);

  const navigation = await evaluate(`(()=>{
    const f=fixture,play=document.querySelector('.browse-play-album'),open=document.querySelector('.open-album');
    f.stage.dataset.mode='archive';f.musicApplication.mode='archive';f.stage.dataset.operationFocus='right';
    document.querySelector('#music-browse').hidden=false;document.querySelector('#music-detail').hidden=true;
    open.focus({preventScroll:true});open.click();
    const actions=document.querySelector('.album-actions'),article=document.querySelector('#album-detail-content');
    const opened={mode:f.musicApplication.mode,panelState:f.sharedPanel.element.dataset.panelState,
      articleHidden:article.hidden,articleInert:article.inert,actionsHidden:actions.hidden,actionsInert:actions.inert,
      children:[...actions.querySelectorAll('button')].map(button=>({hidden:button.hidden,inert:button.inert})),
      focusInPanel:f.sharedPanel.element.contains(document.activeElement)};
    play.focus({preventScroll:true});const playFocusBlocked=document.activeElement!==play;
    open.focus({preventScroll:true});const openFocusBlocked=document.activeElement!==open;
    const back=document.querySelector('#music-detail .music-back');back.focus({preventScroll:true});back.click();
    return{opened,playFocusBlocked,openFocusBlocked,restored:{mode:f.musicApplication.mode,panelState:f.sharedPanel.element.dataset.panelState,
      articleHidden:article.hidden,articleInert:article.inert,actionsHidden:actions.hidden,actionsInert:actions.inert,
      playVisible:!play.hidden&&play.getClientRects().length>0,openVisible:!open.hidden&&open.getClientRects().length>0,
      focusOnOpen:document.activeElement===open,presentationOpen:f.presentation.openCalls,presentationBack:f.presentation.backCalls}};
  })()`);
  assert.equal(navigation.opened.mode, "detail");
  assert.equal(navigation.opened.panelState, "expanded");
  assert.equal(navigation.opened.articleHidden, false);
  assert.equal(navigation.opened.articleInert, false);
  assert.equal(navigation.opened.actionsHidden, true);
  assert.equal(navigation.opened.actionsInert, true);
  assert.ok(navigation.opened.children.every(button => button.hidden && button.inert),
    "Both actions leave the tab order together while the article is open.");
  assert.equal(navigation.opened.focusInPanel, true);
  assert.equal(navigation.playFocusBlocked, true);
  assert.equal(navigation.openFocusBlocked, true);
  assert.equal(navigation.restored.mode, "archive");
  assert.equal(navigation.restored.panelState, "browse");
  assert.equal(navigation.restored.articleHidden, true);
  assert.equal(navigation.restored.articleInert, true);
  assert.equal(navigation.restored.actionsHidden, false);
  assert.equal(navigation.restored.actionsInert, false);
  assert.equal(navigation.restored.playVisible, true);
  assert.equal(navigation.restored.openVisible, true);
  assert.equal(navigation.restored.presentationOpen, 1);
  assert.equal(navigation.restored.presentationBack, 1);

  const guards = await evaluate(`(async()=>{
    const f=fixture,p=f.sharedPanel,actions=document.querySelector('.album-actions'),article=document.querySelector('#album-detail-content');
    p.setOpen(true);await new Promise(r=>setTimeout(r,35));f.stage.dataset.design='rhine';f.shell.setActive(false);
    p.setOpen(false);p.finish();const switched={active:p.active,state:p.element.dataset.panelState,actionsHidden:actions.hidden,
      actionsInert:actions.inert,articleHidden:article.hidden,articleInert:article.inert};
    f.setReduced(true);p.setOpen(true);p.finish();const reducedOpen=p.element.dataset.panelState==='expanded'&&actions.hidden&&actions.inert;
    p.setOpen(false);p.finish();const reducedClose=p.element.dataset.panelState==='browse'&&!actions.hidden&&!actions.inert;
    f.setReduced(false);p.setActive(false);const inactiveBefore={active:p.active,panelHidden:p.element.hidden,state:p.element.dataset.panelState};
    p.setOpen(true);p.finish();const inactiveGuard={active:p.active,panelHidden:p.element.hidden,state:p.element.dataset.panelState,
      calloutParent:document.querySelector('.album-callout').parentElement.id,articleParent:article.parentElement.id,
      actionsHidden:actions.hidden,actionsInert:actions.inert};
    p.setActive(true);p.setOpen(false);p.finish();
    return{switched,reducedOpen,reducedClose,inactiveBefore,inactiveGuard,reactivated:p.active};
  })()`);
  assert.equal(guards.switched.active, true);
  assert.equal(guards.switched.state, "browse");
  assert.equal(guards.switched.actionsHidden, false);
  assert.equal(guards.switched.actionsInert, false);
  assert.equal(guards.switched.articleHidden, true);
  assert.equal(guards.switched.articleInert, true);
  assert.equal(guards.reducedOpen, true);
  assert.equal(guards.reducedClose, true);
  assert.equal(guards.inactiveBefore.active, false);
  assert.equal(guards.inactiveBefore.panelHidden, true);
  assert.equal(guards.inactiveGuard.active, false, "An inactive panel ignores a new open request.");
  assert.equal(guards.inactiveGuard.panelHidden, true);
  assert.equal(guards.inactiveGuard.state, "browse");
  assert.equal(guards.inactiveGuard.calloutParent, "music-browse");
  assert.equal(guards.inactiveGuard.articleParent, "music-detail");
  assert.equal(guards.inactiveGuard.actionsHidden, false);
  assert.equal(guards.inactiveGuard.actionsInert, false);
  assert.equal(guards.reactivated, true);

  await evaluate(`(()=>{
    const f=fixture,style={...f.preferences.style,design:'rhine',scheme:'rhine'};
    f.preferences.style=style;f.preferences.theme='day';f.stage.dataset.theme='day';
    f.applyStylePalette(f.stage,style,'day');f.syncDesignIdentity();
  })()`);
  await evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);

  const report = {
    fixture: "Production music-app markup, extracted production playSelectedAlbum(), and extracted production document click listener; player is a recording mock, with no audio backend started.",
    visuals,
    playback,
    unavailable,
    navigation,
    guards,
    punkPaletteChecks,
    futurePaletteResets,
    metadata,
  };
  await writeFile(path.join(output, "album-actions-report.json"), JSON.stringify(report, null, 2));
}

// Narrow alias for the unified native-button group. It deliberately avoids the
// legacy responsive matrix and unrelated album-panel regressions.
export async function checkUnifiedAlbumActions({ command, evaluate, output, main }) {
  const evidence = { fixture: "Production markup and extracted production click listener with synthetic catalog and recording player.", styles: [], focus: [], screenshots: [] };
  const reportPath = path.join(output, "unified-album-actions.json");
  const saveEvidence = async (status = "in-progress", error = undefined) => {
    await writeFile(reportPath, JSON.stringify({ status, ...(error ? { error } : {}), evidence }, null, 2));
  };
  try {
    const playSource = main.match(/function playSelectedAlbum\(\)\s*\{[\s\S]*?\n\}/)?.[0];
    assert.ok(playSource, "The production playSelectedAlbum function must remain extractable.");
    assert.match(playSource, /const album = currentAlbum\(\)/);
    assert.match(playSource, /if \(!album\?\.tracks\.length \|\| album\.offline\) return/);
    assert.match(playSource, /player\.play\(album\.tracks\[0\]\.id, album\.tracks\)/);
    assert.doesNotMatch(playSource, /setMode|presentation|scene\./,
      "Playing an album stays independent from navigation and presentation.");
    assert.match(main, /class="album-actions" role="group"/);
    assert.match(main, /<button type="button" class="browse-play-album" data-action="play-album"/);
    assert.match(main, /<button type="button" class="open-album" data-action="open"/);
    assert.match(main, /case "play-album":\s*playSelectedAlbum\(\);\s*break;/);
    assert.match(main, /case "open":\s*setMode\("detail"\);\s*break;/);
    const selectionSource = main.match(/function updateSelection\([\s\S]*?\n\}/)?.[0];
    assert.ok(selectionSource, "The production selection updater must remain extractable.");
    assert.match(selectionSource, /\.browse-play-album"\)\.disabled = !a\?\.tracks\.length \|\| !!a\.offline;/,
      "Offline and empty albums disable only the play action through the production selection path.");
    assert.equal(await evaluate("fixture.productionClickListenerInstalled"), true,
      "The isolated fixture must install the extracted production click listener.");

    await command("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    for (const design of ["archive", "rhine"]) {
      for (const theme of ["day", "night"]) {
        await evaluate(`(async()=>{
          const f=fixture,design=${JSON.stringify(design)},theme=${JSON.stringify(theme)};
          const style={...f.preferences.style,design,scheme:design==='archive'?'archive':'rhine'};
          f.setPage('music');f.stage.dataset.layout='desktop';f.preferences.style=style;f.preferences.theme=theme;
          f.stage.dataset.design=design;f.stage.dataset.theme=theme;f.stage.dataset.mode='archive';f.musicApplication.mode='archive';
          f.applyStylePalette(f.stage,style,theme);f.shell.setActive(design==='archive');f.syncDesignIdentity();
          f.sharedPanel.setVisible(true);f.sharedPanel.setOpen(false);f.sharedPanel.finish();f.renderSourceDetail();
          document.activeElement instanceof HTMLElement&&document.activeElement.blur();
          await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        })()`);
        const sample = await evaluate(`(()=>{
          const f=fixture,group=document.querySelector('.album-panel .album-actions'),play=group?.querySelector('.browse-play-album'),open=group?.querySelector('.open-album');
          const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
          const style=node=>{const s=getComputedStyle(node);return{display:s.display,flexDirection:s.flexDirection,columnGap:s.columnGap,rowGap:s.rowGap,
            background:s.backgroundColor,color:s.color,fontSize:s.fontSize,minHeight:s.minHeight,outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle,
            outlineColor:s.outlineColor,outlineOffset:s.outlineOffset,borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],
            borderColors:[s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor]};};
          const label=node=>({text:node?.textContent?.trim()??'',display:getComputedStyle(node).display});
          return{design:fixture.stage.dataset.design,theme:fixture.stage.dataset.theme,mode:fixture.musicApplication.mode,
            viewport:rect(f.sharedPanel.scrollTarget()),
            group:{role:group?.getAttribute('role'),aria:group?.getAttribute('aria-label'),rect:rect(group),style:style(group),hidden:group?.hidden,inert:group?.inert,
              children:[...group.children].map(node=>node.dataset.action)},
            play:{tag:play?.tagName,type:play?.type,action:play?.dataset.action,aria:play?.getAttribute('aria-label'),rect:rect(play),style:style(play),
              label:label(play?.querySelector('.play-album-label')),access:label(play?.querySelector('.play-album-access-label')),
              icon:play?.querySelector('.play-album-icon')?.getBoundingClientRect().toJSON(),disabled:play?.disabled},
            open:{tag:open?.tagName,type:open?.type,action:open?.dataset.action,aria:open?.getAttribute('aria-label'),rect:rect(open),style:style(open),
              label:label(open?.querySelector('.open-album-label')),access:label(open?.querySelector('.open-album-access-label')),
              arrow:getComputedStyle(open?.querySelector('.open-album-punk-arrow')).color},
            article:{hidden:document.querySelector('#album-detail-content').hidden,inert:document.querySelector('#album-detail-content').inert}};
        })()`);
        evidence.styles.push(sample);
        const screenshot = `actions-${design}-${theme}.png`;
        const groupRect = sample.group.rect;
        const clip = { x: Math.max(0, Math.floor(groupRect.x - 16)), y: Math.max(0, Math.floor(groupRect.y - 16)),
          width: Math.ceil(groupRect.width + 32), height: Math.ceil(groupRect.height + 32), scale: 3 };
        const image = await command("Page.captureScreenshot", { format: "png", clip });
        await writeFile(path.join(output, screenshot), Buffer.from(image.data, "base64"));
        evidence.screenshots.push(screenshot);
        await saveEvidence();

        assert.equal(sample.mode, "archive");
        assert.equal(sample.group.role, "group");assert.equal(sample.group.aria, "专辑操作");
        assert.deepEqual(sample.group.children, ["play-album", "open"]);
        assert.equal(sample.play.tag, "BUTTON");assert.equal(sample.play.type, "button");assert.equal(sample.play.action, "play-album");
        assert.equal(sample.open.tag, "BUTTON");assert.equal(sample.open.type, "button");assert.equal(sample.open.action, "open");
        assert.equal(sample.group.hidden, false);assert.equal(sample.group.inert, false);
        assert.equal(sample.article.hidden, true);assert.equal(sample.article.inert, true);
        if (design === "archive") {
          // Chrome blockifies inline-flex when the group is itself a flex item.
          assert.ok(["flex","inline-flex"].includes(sample.group.style.display));assert.equal(sample.group.style.flexDirection, "row");
          assert.equal(sample.group.style.columnGap, "0px");
          assert.equal(sample.play.label.text, "播放专辑");assert.notEqual(sample.play.label.display, "none");
          assert.equal(sample.open.label.text, "打开专辑");assert.notEqual(sample.open.label.display, "none");
          assert.equal(sample.play.access.display, "none");assert.equal(sample.open.access.display, "none");
          assert.ok(Math.abs(sample.play.rect.right - sample.open.rect.x) <= .25,
            `${theme}: the two Punk halves have no gap.`);
          assert.ok(Math.abs(sample.group.rect.x - sample.play.rect.x + 1) <= .25 &&
            Math.abs(sample.group.rect.right - sample.open.rect.right - 1) <= .25 &&
            Math.abs(sample.group.rect.width - sample.play.rect.width - sample.open.rect.width - 2) <= .5,
            `${theme}: Punk group bounds tightly wrap both buttons and the shared frame. ${JSON.stringify(sample)}`);
          assert.ok(sample.group.rect.x-5>=sample.viewport.x-1&&sample.group.rect.right+5<=sample.viewport.right+1,
            `${theme}: the shared accent outline stays inside the album scroll viewport. ${JSON.stringify(sample)}`);
          assert.deepEqual(sample.group.style.borders, ["1px", "1px", "1px", "1px"]);
          assert.ok(sample.group.style.borderColors.every(color => color === sample.open.style.color),
            `${theme}: the shared fine frame follows the foreground.`);
          assert.equal(sample.group.style.outlineWidth, "1px");assert.equal(sample.group.style.outlineStyle, "solid");
          assert.equal(sample.group.style.outlineColor, sample.open.arrow);assert.equal(sample.group.style.outlineOffset, "4px");
          assert.equal(sample.play.style.background, sample.open.style.color);
          assert.notEqual(sample.play.style.color, sample.open.style.color);
          assert.equal(sample.open.style.background, "rgba(0, 0, 0, 0)");
          assert.deepEqual(sample.play.style.borders, ["0px", "0px", "0px", "0px"]);
          assert.deepEqual(sample.open.style.borders, ["0px", "0px", "0px", "1px"]);
          assert.ok(sample.play.style.outlineStyle==="none"||sample.play.style.outlineWidth==="0px");
          assert.ok(sample.open.style.outlineStyle==="none"||sample.open.style.outlineWidth==="0px");
        } else {
          assert.equal(sample.group.style.flexDirection, "column");
          assert.equal(sample.group.rect.width, 188, `${theme}: Future action group stays naturally packed to 188px.`);
          assert.ok(sample.play.rect.y < sample.open.rect.y);
          assert.ok(Math.abs(sample.play.rect.x - sample.open.rect.x) <= 1);
          assert.ok(Math.abs(sample.play.rect.width - 188) <= 1 && Math.abs(sample.open.rect.width - 188) <= 1);
          assert.equal(sample.play.label.display, "none");assert.equal(sample.open.label.display, "none");
          assert.equal(sample.play.access.text, "PLAY ALBUM");assert.notEqual(sample.play.access.display, "none");
          assert.equal(sample.open.access.text, "ACCESS ALBUM");assert.notEqual(sample.open.access.display, "none");
          assert.equal(sample.play.style.background, "rgba(0, 0, 0, 0)");
          assert.equal(sample.open.style.background, "rgba(0, 0, 0, 0)");
        }

        if (design === "archive") {
          for (const [name, selector] of [["play", ".browse-play-album"], ["open", ".open-album"]]) {
            await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            const focus = await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});button.focus({preventScroll:true});const s=getComputedStyle(button);
              return{active:document.activeElement===button,visible:button.matches(':focus-visible'),outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle,
                outlineColor:s.outlineColor,outlineOffset:s.outlineOffset,groupOutline:getComputedStyle(button.parentElement).outlineColor};})()`);
            evidence.focus.push({design, theme, name, ...focus});await saveEvidence();
            assert.equal(focus.active, true, `${design}/${theme}: ${name} remains independently focusable.`);
            assert.equal(focus.visible, true, `${design}/${theme}: ${name} receives keyboard focus-visible styling.`);
            assert.equal(focus.outlineWidth, "2px");assert.equal(focus.outlineStyle, "solid");
            assert.equal(focus.outlineOffset, "-4px");assert.equal(focus.outlineColor, focus.groupOutline,
              `${design}/${theme}: ${name} focus follows the group accent.`);
          }
        }
      }
    }

    // The first action cycle is a real production click. Do not open/close the
    // panel beforehand: the initial exit timing is part of the evidence.
    await evaluate(`(()=>{
      const f=fixture;f.setPage('music');f.stage.dataset.design='archive';f.stage.dataset.theme='day';f.stage.dataset.mode='archive';
      f.musicApplication.mode='archive';f.preferences.theme='day';f.preferences.style={...f.preferences.style,design:'archive',scheme:'archive'};
      f.applyStylePalette(f.stage,f.preferences.style,'day');f.shell.setActive(true);f.syncDesignIdentity();
      f.sharedPanel.setVisible(true);f.sharedPanel.setOpen(false);f.sharedPanel.finish();f.renderSourceDetail();
      f.musicApplication.view=Object.freeze({...f.musicApplication.view,show:'tracks'});f.focusMusicEntry('track|fixture-album|fixture-track-2');
      f.stage.dataset.operationFocus='right';f.presentation.pendingSelection={token:'retain'};
    })()`);
    const initial = await evaluate(`(()=>({state:fixture.sharedPanel.element.dataset.panelState,
      play:document.querySelector('.play-album-label').textContent.trim(),open:document.querySelector('.open-album-label').textContent.trim()}))()`);
    evidence.initial = initial;await saveEvidence();
    assert.equal(initial.state, "browse");assert.equal(initial.play, "播放专辑");assert.equal(initial.open, "打开专辑");

    const playback = await evaluate(`(()=>{
      const f=fixture,button=document.querySelector('.browse-play-album'),album=f.records[0].album;
      const stable=()=>JSON.stringify({appMode:f.musicApplication.mode,stageMode:f.stage.dataset.mode,page:f.stage.dataset.page,
        selectedIndex:f.musicApplication.selectedIndex,selectedAlbumId:f.musicApplication.selectedAlbumId,selectedTrackId:f.musicApplication.selectedTrackId,
        catalogFocus:f.musicApplication.catalogFocus,view:f.musicApplication.view,panelState:f.sharedPanel.element.dataset.panelState,
        articleHidden:document.querySelector('#album-detail-content').hidden,articleInert:document.querySelector('#album-detail-content').inert,
        actionsHidden:document.querySelector('.album-actions').hidden,actionsInert:document.querySelector('.album-actions').inert,
        pendingSelection:f.presentation.pendingSelection,presentationOpen:f.presentation.openCalls,presentationBack:f.presentation.backCalls});
      button.focus({preventScroll:true});const before=stable(),start=f.playCalls.length;button.click();const calls=f.playCalls.slice(start),last=calls.at(-1);
      return{focusTrack:f.musicApplication.catalogFocus?.trackId,firstTrack:album.tracks[0].id,calls:calls.length,ids:calls.map(call=>call.id),
        queueLengths:calls.map(call=>call.tracks.length),sameQueue:calls.every(call=>call.tracks===album.tracks),modeUnchanged:stable()===before,
        operationFocus:f.stage.dataset.operationFocus,focusRetained:document.activeElement===button,presentationOpen:f.presentation.openCalls,
        presentationBack:f.presentation.backCalls,complete:last?.tracks?.length===album.tracks.length};
    })()`);
    evidence.playback = playback;await saveEvidence();
    assert.equal(playback.focusTrack, "fixture-track-2");assert.equal(playback.calls, 1);
    assert.deepEqual(playback.ids, [playback.firstTrack]);assert.deepEqual(playback.queueLengths, [30]);
    assert.equal(playback.sameQueue, true);assert.equal(playback.complete, true);
    assert.equal(playback.modeUnchanged, true, "Play starts at the first track and preserves browse, view, and presentation state.");
    assert.equal(playback.operationFocus, "right");assert.equal(playback.focusRetained, true);
    assert.equal(playback.presentationOpen, 0);assert.equal(playback.presentationBack, 0);

    const opening = await evaluate(`(()=>{
      const f=fixture,button=document.querySelector('.open-album'),group=document.querySelector('.album-actions');
      button.focus({preventScroll:true});const before={state:f.sharedPanel.element.dataset.panelState,opacity:getComputedStyle(group).opacity,
        transform:getComputedStyle(group).transform,width:group.getBoundingClientRect().width};
      const calls=f.presentation.openCalls;button.click();const animation=group.getAnimations()[0];
      return{before,afterClick:{state:f.sharedPanel.element.dataset.panelState,mode:f.musicApplication.mode,stageMode:f.stage.dataset.mode,
        actionsHidden:group.hidden,actionsInert:group.inert,openCalls:f.presentation.openCalls-calls,
        currentTime:animation?.currentTime??null,
        duration:animation?.effect?.getComputedTiming().duration??null,keyframes:animation?.effect?.getKeyframes()??[],
        opacity:getComputedStyle(group).opacity,transform:getComputedStyle(group).transform,width:group.getBoundingClientRect().width,
        labels:{play:document.querySelector('.play-album-label').textContent.trim(),open:document.querySelector('.open-album-label').textContent.trim()}}};
    })()`);
    const openingTimeline=[opening.afterClick];
    for(let frame=0;frame<24;frame++){
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const frameSample=await evaluate(`(()=>{const group=document.querySelector('.album-actions'),style=getComputedStyle(group),m=new DOMMatrixReadOnly(style.transform==='none'?'matrix(1,0,0,1,0,0)':style.transform),animation=group.getAnimations()[0];
        return{state:fixture.sharedPanel.element.dataset.panelState,time:performance.now(),opacity:Number(style.opacity),clip:style.clipPath,transform:style.transform,
          matrix:[m.a,m.b,m.c,m.d,m.e,m.f],rect:group.getBoundingClientRect().toJSON(),animationTime:animation?.currentTime??null,
          labels:{play:document.querySelector('.play-album-label').textContent.trim(),open:document.querySelector('.open-album-label').textContent.trim()}};})()`);
      openingTimeline.push(frameSample);
      if(!evidence.exitMiddleScreenshot&&frameSample.animationTime>=140&&frameSample.animationTime<=240){
        const clip=await evaluate("(()=>{const r=document.querySelector('.album-actions').getBoundingClientRect();return{x:Math.max(0,Math.floor(r.left-18)),y:Math.max(0,Math.floor(r.top-18)),width:Math.ceil(r.width+36),height:Math.ceil(r.height+36),scale:3};})()");
        const image=await command("Page.captureScreenshot",{format:"png",clip});
        evidence.exitMiddleScreenshot="punk-action-group-exit-mid.png";
        evidence.screenshots.push(evidence.exitMiddleScreenshot);
        await writeFile(path.join(output,evidence.exitMiddleScreenshot),Buffer.from(image.data,"base64"));
      }
      if(frameSample.state!=="button-exit")break;
    }
    evidence.opening = openingTimeline;await saveEvidence();
    assert.equal(opening.before.state, "browse");assert.equal(opening.afterClick.state, "button-exit");
    assert.equal(opening.afterClick.mode, "detail");assert.equal(opening.afterClick.stageMode, "detail");
    assert.equal(opening.afterClick.openCalls, 1);assert.equal(opening.afterClick.duration, 360);
    assert.ok(evidence.exitMiddleScreenshot,"Capture the actual first Punk exit at its animation midpoint.");
    assert.ok(openingTimeline.every(frame=>frame.labels?.play==="播放专辑"&&frame.labels?.open==="打开专辑"),
      `Punk labels stay complete throughout the first opening exit: ${JSON.stringify(openingTimeline.map(frame=>frame.labels))}`);
    const earlyExit=openingTimeline.find(frame=>frame.opacity<.99&&frame.matrix?.[3]<.995&&frame.matrix?.[5]<-.1);
    assert.ok(earlyExit,`Punk exit must immediately fade, move upward, and compress: ${JSON.stringify(openingTimeline)}`);
    assert.ok(opening.afterClick.keyframes.length >= 2, "The group exit animation exposes both keyframes.");
    let opened;
    for (let attempt = 0; attempt < 70; attempt++) {
      opened = await evaluate(`(()=>{const f=fixture,a=document.querySelector('.album-actions'),article=document.querySelector('#album-detail-content');return{
        state:f.sharedPanel.element.dataset.panelState,mode:f.musicApplication.mode,groupHidden:a.hidden,groupInert:a.inert,
        actions:[...a.querySelectorAll('button')].map(button=>({hidden:button.hidden,inert:button.inert})),articleHidden:article.hidden,articleInert:article.inert,
        labels:{play:document.querySelector('.play-album-label').textContent.trim(),open:document.querySelector('.open-album-label').textContent.trim()}};})()`);
      if (opened.state === "expanded") break;
      await evaluate("new Promise(resolve=>setTimeout(resolve,30))");
    }
    evidence.opened = opened;await saveEvidence();
    assert.equal(opened?.state, "expanded");assert.equal(opened.mode, "detail");
    assert.equal(opened.groupHidden, true);assert.equal(opened.groupInert, true);
    assert.ok(opened.actions.every(action=>action.hidden&&action.inert), "Both buttons become hidden and inert together.");
    assert.equal(opened.articleHidden, false);assert.equal(opened.articleInert, false);
    assert.deepEqual(opened.labels,{play:"播放专辑",open:"打开专辑"});
    const openSelection=await evaluate(`(()=>{const f=fixture;f.musicApplication.selectedIndex=1;f.renderSourceDetail();f.sharedPanel.contentChanged('selection-change-while-open');
      return{state:f.sharedPanel.element.dataset.panelState,play:document.querySelector('.play-album-label').textContent.trim(),open:document.querySelector('.open-album-label').textContent.trim()};})()`);
    evidence.openSelectionStable=openSelection;await saveEvidence();
    assert.equal(openSelection.state,"expanded");assert.equal(openSelection.play,"播放专辑");assert.equal(openSelection.open,"打开专辑");
    await saveEvidence("passed");
  } catch (error) {
    await saveEvidence("failed", { name: error?.name, message: error?.message, stack: error?.stack });
    throw error;
  }
}

// Focused regression for the production rolling text inside the framed format label.
export async function checkAlbumFormatMotion({ command, evaluate, output }) {
  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  const viewport=await evaluate(`({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})`);
  assert.deepEqual(viewport,{width:1920,height:1080,deviceScaleFactor:1},'Format reel bounds use the 1920×1080 project desktop viewport.');
  const transitions = [];
  const geometryViolations=[];
  const designs = ["archive", "rhine"];
  const themes = ["day", "night"];
  const measure = `(()=>{
    const host=document.querySelector('#selection-format'),reel=host.querySelector('.selection-format-reel');
    const rnRoot=reel?.classList.contains('rn-root')?reel:reel?.querySelector('.rn-root');
    const visual=rnRoot?.querySelector('.rn-visual');
    const rect=node=>{const r=node.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const hostRect=rect(host),hostStyle=getComputedStyle(host),before=getComputedStyle(host,'::before');
    const border={left:parseFloat(hostStyle.borderLeftWidth)||0,right:parseFloat(hostStyle.borderRightWidth)||0,
      top:parseFloat(hostStyle.borderTopWidth)||0,bottom:parseFloat(hostStyle.borderBottomWidth)||0};
    const padding={left:parseFloat(hostStyle.paddingLeft)||0,right:parseFloat(hostStyle.paddingRight)||0,
      top:parseFloat(hostStyle.paddingTop)||0,bottom:parseFloat(hostStyle.paddingBottom)||0};
    const pseudo={content:before.content,display:before.display,width:before.width,height:before.height,
      background:before.backgroundColor,color:before.color};
    let marker=null;
    if(before.content!=='none'&&before.display!=='none'&&parseFloat(before.width)>0&&parseFloat(before.height)>0){
      const width=parseFloat(before.width),height=parseFloat(before.height),contentTop=hostRect.top+border.top+padding.top;
      const contentHeight=hostRect.height-border.top-border.bottom-padding.top-padding.bottom;
      marker={left:hostRect.left+border.left+padding.left,top:contentTop+(contentHeight-height)/2,
        right:hostRect.left+border.left+padding.left+width,bottom:contentTop+(contentHeight-height)/2+height,width,height};
    }
    const slots=[...(visual?.querySelectorAll('.rn-slot')??[])];
    const slotRects=slots.map(slot=>({text:(slot.textContent??'').trim(),rect:rect(slot)}));
    const glyphRects=[];
    for(const slot of slots){
      const walker=document.createTreeWalker(slot,NodeFilter.SHOW_TEXT);let node;
      while((node=walker.nextNode())){
        if(!node.data.trim())continue;
        const range=document.createRange();range.selectNodeContents(node);
        for(const r of range.getClientRects())if(r.width>0&&r.height>0)glyphRects.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom,
          width:r.width,height:r.height,text:node.data,slotText:(slot.textContent??'').trim(),slot:rect(slot),
          ancestors:[node.parentElement?.className??''].concat(node.parentElement?.parentElement?.className??'')});
      }
    }
    const firstSlot=slotRects[0]?.rect??null,firstGlyph=glyphRects[0]??null;
    return{design:fixture.stage.dataset.design,theme:fixture.stage.dataset.theme,host:hostRect,hostDisplay:hostStyle.display,
      hostClass:host.className,hostIsRoot:host.classList.contains('rn-root'),border,padding,gap:parseFloat(hostStyle.columnGap)||0,
      inlineMinWidth:host.style.getPropertyValue('min-width'),computedMinWidth:hostStyle.minWidth,
      pseudo,marker,reelClass:reel?.className??'',reelIsRoot:reel?.classList.contains('rn-root')??false,
      rnRootCount:host.querySelectorAll('.rn-root').length,rootClass:rnRoot?.className??'',root:rnRoot?rect(rnRoot):null,
      visual:visual?rect(visual):null,slotRects,glyphRects,
      layoutEvidence:{outerLeft:hostRect.left,outerRight:hostRect.right,paddingLeft:padding.left,paddingRight:padding.right,
        markerRight:marker?.right??null,markerToGlyph:firstGlyph&&marker?firstGlyph.left-marker.right:null,
        rootLeft:rnRoot?rnRoot.getBoundingClientRect().left:null,visualLeft:visual?visual.getBoundingClientRect().left:null,
        firstSlotLeft:firstSlot?.left??null,firstTextLeft:firstGlyph?.left??null},
      ready:rnRoot?.hasAttribute('data-rn-ready')??false,
      text:rnRoot?.querySelector('.rn-value')?.textContent?.trim()??''};
  })()`;
  const saveSample = async (sample, label, {requireVisual=true}={}) => {
    const record=(issue,glyph)=>geometryViolations.push({sample:`${sample.design}/${sample.theme}/${label}`,issue,
      layoutEvidence:sample.layoutEvidence,host:sample.host,marker:sample.marker,glyph});
    if(sample.hostIsRoot)record('outer format host unexpectedly owns rn-root');
    if(!sample.reelIsRoot)record('inner selection-format-reel is missing rn-root');
    if(sample.rnRootCount!==1)record(`expected one rn-root, found ${sample.rnRootCount}`);
    if(requireVisual){
      if(!sample.visual||!sample.ready)record('real .rn-visual is absent or not ready');
      if(sample.slotRects.length===0)record('no real .rn-slot rectangles were sampled');
      if(sample.glyphRects.length===0)record('no text-node character bounds were sampled');
    }
    const framed=sample.border.left+sample.border.right+sample.border.top+sample.border.bottom>0;
    const left=sample.host.left+sample.border.left+.25;
    const right=sample.host.right-sample.border.right-.25;
    if(sample.marker&&framed){
      if(sample.marker.left<sample.host.left+sample.border.left)record('Punk square crosses host left border');
      if(sample.marker.right>sample.host.right-sample.border.right)record('Punk square crosses host right border');
    }
    for(const glyph of sample.glyphRects){
      if(framed&&glyph.left<left)record('glyph crosses host left border',glyph);
      if(framed&&glyph.right>right)record('glyph crosses host right border',glyph);
      if(sample.marker){
        if(glyph.left<sample.marker.right+sample.gap-1)record('glyph intrudes into the Punk square gap',glyph);
      }
    }
    return sample;
  };

  for(const design of designs)for(const theme of themes){
    const compact=design==='archive';
    const sequence=compact
      ? ['FLAC 24/192','FLAC 16/44.1','FLAC 24/88.2','FLAC 24/192']
      : ['FLAC · 24 bit / 192 kHz','FLAC · 16 bit / 44.1 kHz','FLAC · 24 bit / 88.2 kHz','FLAC · 24 bit / 192 kHz'];
    await evaluate(`(()=>{
      const f=fixture,style={...f.preferences.style,design:${JSON.stringify(design)},scheme:${JSON.stringify(design==='archive'?'archive':'rhine')}};
      f.textMotion.finish();f.preferences.style=style;f.preferences.theme=${JSON.stringify(theme)};
      f.stage.dataset.design=${JSON.stringify(design)};f.stage.dataset.theme=${JSON.stringify(theme)};
      f.applyStylePalette(f.stage,style,${JSON.stringify(theme)});f.syncDesignIdentity();
      f.textMotion.update({...f.selection,format:${JSON.stringify(sequence[0])}},false);
    })()`);
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    const baseline=await evaluate(measure);
    assert.equal(baseline.text,sequence[0],`${design}/${theme}: the source summary uses its real ${compact?'compact':'plain'} format.`);

    let from=sequence[0];
    for(const target of sequence.slice(1)){
      await evaluate(`fixture.textMotion.update({...fixture.selection,format:${JSON.stringify(target)}},true)`);
      await evaluate(`(async()=>{for(let i=0;i<3;i++){const root=document.querySelector('#selection-format .selection-format-reel.rn-root');if(root?.hasAttribute('data-rn-ready'))break;await new Promise(resolve=>requestAnimationFrame(resolve));}})()`);
      const start=await saveSample(await evaluate(measure),`${target} start`);
      assert.ok(parseFloat(start.inlineMinWidth)>0,`${design}/${theme}: temporary host min-width is locked at animated start.`);
      await evaluate(`new Promise(resolve=>setTimeout(resolve,170))`);
      const middle=await saveSample(await evaluate(measure),`${target} middle`);
      assert.ok(parseFloat(middle.inlineMinWidth)>0,`${design}/${theme}: temporary host min-width remains locked during the reel.`);
      const clip=await evaluate(`(()=>{const r=document.querySelector('#selection-format').getBoundingClientRect();return{x:Math.max(0,Math.floor(r.left-12)),y:Math.max(0,Math.floor(r.top-8)),width:Math.ceil(r.width+24),height:Math.ceil(r.height+16),scale:3};})()`);
      const image=await command('Page.captureScreenshot',{format:'png',clip});
      const suffix=target.includes('16 bit / 44.1')||target.includes('16/44.1')?'16-44'
        :target.includes('88.2')?'24-88':'24-192';
      const screenshot=`format-reel-${design}-${theme}-${suffix}-mid.png`;
      await writeFile(path.join(output,screenshot),Buffer.from(image.data,'base64'));
      await evaluate(`new Promise(resolve=>setTimeout(resolve,380))`);
      const end=await saveSample(await evaluate(measure),`${target} end`);
      assert.equal(end.text,target,`${design}/${theme}: the real reel settles on ${target}.`);
      assert.equal(end.inlineMinWidth,'',`${design}/${theme}: motion duration releases the temporary host min-width.`);
      const natural=await evaluate(`(()=>{
        fixture.textMotion.update({...fixture.selection,format:${JSON.stringify(target)}},false);
        return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
          const host=document.querySelector('#selection-format'),style=getComputedStyle(host),r=host.getBoundingClientRect();
          resolve({width:r.width,inlineMinWidth:host.style.getPropertyValue('min-width'),computedMinWidth:style.minWidth,
            text:host.querySelector('.rn-value')?.textContent?.trim()??''});
        })));
      })()`);
      assert.equal(natural.inlineMinWidth,'',`${design}/${theme}: a static target has no leftover inline min-width.`);
      assert.equal(natural.text,target);
      assert.ok(Math.abs(end.host.width-natural.width)<.5,
        `${design}/${theme}: the final label returns to its natural width after the lock releases (${JSON.stringify({end:end.host,natural})}).`);
      transitions.push({design,theme,from,to:target,start,middle,end,natural,screenshot});
      from=target;
    }

    const afterRefresh=await evaluate(`(()=>{
      const f=fixture,host=document.querySelector('#selection-format'),before=host.getBoundingClientRect();
      f.textMotion.refresh();
      return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
        const after=host.getBoundingClientRect(),style=getComputedStyle(host),pseudo=getComputedStyle(host,'::before');
        resolve({before:{x:before.x,y:before.y,width:before.width,height:before.height},after:{x:after.x,y:after.y,width:after.width,height:after.height},
          hostRoot:host.classList.contains('rn-root'),reelRoot:host.querySelector('.selection-format-reel')?.classList.contains('rn-root')??false,
          inlineMinWidth:host.style.getPropertyValue('min-width'),
          border:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],pseudo:{content:pseudo.content,width:pseudo.width,height:pseudo.height},
          text:host.querySelector('.rn-value')?.textContent?.trim()??''});
      })));
    })()`);
    assert.equal(afterRefresh.hostRoot,false,`${design}/${theme}: refresh keeps the outer host outside rn-root.`);
    assert.equal(afterRefresh.reelRoot,true,`${design}/${theme}: refresh preserves the inner reel root.`);
    assert.equal(afterRefresh.inlineMinWidth,'',`${design}/${theme}: refresh leaves no stale temporary min-width.`);
    assert.deepEqual(afterRefresh.border,design==='archive'?['1px','1px','1px','1px']:['0px','0px','0px','0px']);
    assert.equal(afterRefresh.text,sequence.at(-1));
    assert.ok(Math.abs(afterRefresh.before.width-afterRefresh.after.width)<1&&Math.abs(afterRefresh.before.height-afterRefresh.after.height)<1,
      `${design}/${theme}: refresh must keep the label box stable (${JSON.stringify(afterRefresh)}).`);

    const hostPoint=await evaluate(`(()=>{const r=document.querySelector('#selection-format').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    const stableLayout=await evaluate(measure);
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:hostPoint.x,y:hostPoint.y});
    const hovered=await saveSample(await evaluate(measure),`${design}/${theme} hover`,{requireVisual:false});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});
    const departed=await saveSample(await evaluate(measure),`${design}/${theme} pointer out`,{requireVisual:false});
    for(const sample of [hovered,departed])assert.equal(sample.text,sequence.at(-1));
    for(const sample of [hovered,departed])assert.equal(sample.inlineMinWidth,'');
    for(const sample of [hovered,departed]){
      assert.ok(Math.abs(sample.host.left-stableLayout.host.left)<.25&&Math.abs(sample.host.top-stableLayout.host.top)<.25&&
        Math.abs(sample.host.width-stableLayout.host.width)<.25&&Math.abs(sample.host.height-stableLayout.host.height)<.25,
        `${design}/${theme}: hover and pointer-out preserve the label host box.`);
      if(stableLayout.marker){
        for(const key of ['left','top','right','bottom'])assert.ok(Math.abs(sample.marker[key]-stableLayout.marker[key])<.25,
          `${design}/${theme}: hover and pointer-out preserve the Punk square (${key}).`);
      }
    }
    transitions.push({design,theme,afterRefresh,hovered,departed});
  }
  await writeFile(path.join(output,'album-format-reel-motion.json'),JSON.stringify({fixture:'Production setupMusicTextMotion, actual .rn-visual/.rn-slot and Text-node Range bounds, offline Chromium; no player or audio service.',viewport,transitions,geometryViolations},null,2));
  assert.deepEqual(geometryViolations,[],`Rolling format text geometry failed; full host/marker/root/slot/Text-node bounds are in album-format-reel-motion.json: ${JSON.stringify(geometryViolations)}`);
}
