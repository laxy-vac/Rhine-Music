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
          page:f.stage.dataset.page,actions:{count:actions?.children.length,hidden:actions?.hidden,inert:actions?.inert,
            display:getComputedStyle(actions).display,flexDirection:getComputedStyle(actions).flexDirection,
            justifyContent:getComputedStyle(actions).justifyContent,columnGap:getComputedStyle(actions).columnGap,rowGap:getComputedStyle(actions).rowGap,rect:rect(actions),
            order:[...actions.children].map(node=>node.dataset.action)},
          ink:{stage:ink(f.stage),panel:ink(document.querySelector('.album-panel')),play:ink(play),open:ink(open)},
          counts:{play:document.querySelectorAll('.browse-play-album').length,open:document.querySelectorAll('.open-album').length},
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
        assert.ok(appearance.play.rect.right <= appearance.open.rect.x + 1,
          `${theme}: Punk actions do not overlap.`);
        assert.equal(appearance.actions.columnGap, "20px", `${theme}: Punk actions keep the compact wrapping group gap.`);
        assert.equal(appearance.actions.rowGap, "20px", `${theme}: wrapped Punk actions keep the same compact gap.`);
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
        assert.deepEqual(
          [appearance.open.style.borderTopWidth,appearance.open.style.borderRightWidth,appearance.open.style.borderBottomWidth,appearance.open.style.borderLeftWidth],
          ["1px","1px","1px","1px"],
          `${theme}: Punk open action keeps a thin frame.`,
        );
        assert.deepEqual(
          [appearance.open.style.borderTopStyle,appearance.open.style.borderRightStyle,appearance.open.style.borderBottomStyle,appearance.open.style.borderLeftStyle],
          ["solid","solid","solid","solid"],
          `${theme}: Punk open action uses a solid frame.`,
        );
        assert.equal(appearance.open.style.outlineWidth, "1px", `${theme}: Punk open action keeps its accent emphasis outline.`);
        assert.equal(appearance.open.style.outlineStyle, "solid");
        assert.equal(appearance.open.style.outlineOffset, "4px");
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
        assert.ok(Math.abs(appearance.play.rect.width - 188) <= 1,
          `${theme}: Future play action uses the shared 188px action width.`);
        assert.ok(Math.abs(appearance.open.rect.width - 188) <= 1,
          `${theme}: Future open action retains its 188px width.`);
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
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const color=value=>{const probe=document.createElement('span');probe.style.color=value;f.stage.append(probe);const resolved=getComputedStyle(probe).color;probe.remove();return resolved;};
        const border=getComputedStyle(open),arrow=getComputedStyle(open.querySelector('.open-album-punk-arrow'));
        const playStyle=getComputedStyle(play),actions=document.querySelector('.album-actions').getBoundingClientRect();
        return {scheme:${JSON.stringify(scheme)},theme,transitionBefore,expected:{accent:color(palette.accent),ink:color(palette.fg),pageBg:color(palette.bg)},
          computed:{outline:border.outlineColor,arrow:arrow.color,borders:[border.borderTopColor,border.borderRightColor,border.borderBottomColor,border.borderLeftColor],
            playBackground:playStyle.backgroundColor,playColor:playStyle.color},
          clip:{x:Math.max(0,Math.floor(actions.x-16)),y:Math.max(0,Math.floor(actions.y-16)),
            width:Math.ceil(actions.width+32),height:Math.ceil(actions.height+32),scale:3}};
      })()`);
      assert.equal(check.computed.outline, check.expected.accent,
        `${scheme}/${theme}: Punk open outline follows the real stylePalette accent.`);
      assert.equal(check.computed.arrow, check.expected.accent,
        `${scheme}/${theme}: Punk diagonal arrow follows the real stylePalette accent.`);
      assert.deepEqual(check.computed.borders, Array(4).fill(check.expected.ink),
        `${scheme}/${theme}: Punk open base frame follows the real stylePalette ink.`);
      assert.equal(check.computed.playBackground, check.expected.ink,
        `${scheme}/${theme}: Punk play uses the real stylePalette ink as its solid fill.`);
      assert.equal(check.computed.playColor, check.expected.pageBg,
        `${scheme}/${theme}: Punk play text uses the real stylePalette page background.`);
      if (scheme === "field" && theme === "day") {
        const image = await command("Page.captureScreenshot", { format: "png", clip: check.clip });
        check.detailScreenshot = "punk-actions-field-day.png";
        await writeFile(path.join(output, check.detailScreenshot), Buffer.from(image.data, "base64"));
      }
      punkPaletteChecks.push(check);

      const future = await evaluate(`(async()=>{
        const f=fixture,style={...f.preferences.style,design:'rhine',scheme:'rhine'};
        f.preferences.style=style;f.preferences.theme=${JSON.stringify(theme)};f.stage.dataset.theme=${JSON.stringify(theme)};
        f.applyStylePalette(f.stage,style,${JSON.stringify(theme)});f.syncDesignIdentity();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const actions=document.querySelector('.album-actions'),play=document.querySelector('.browse-play-album'),open=document.querySelector('.open-album');
        return {design:f.stage.dataset.design,inlineAccent:f.stage.style.getPropertyValue('--accent'),
          direction:getComputedStyle(actions).flexDirection,playBackground:getComputedStyle(play).backgroundColor,
          playWidth:play.getBoundingClientRect().width,playLabel:getComputedStyle(play.querySelector('.play-album-access-label')).display,
          openLabel:getComputedStyle(open.querySelector('.open-album-access-label')).display};
      })()`);
      assert.equal(future.design, "rhine", `${scheme}/${theme}: real Future palette application follows Punk checks.`);
      assert.equal(future.inlineAccent, "", `${scheme}/${theme}: Future clears inline Punk palette tokens.`);
      assert.equal(future.direction, "column");
      assert.equal(future.playBackground, "rgba(0, 0, 0, 0)");
      assert.ok(Math.abs(future.playWidth - 188) <= 1);
      assert.notEqual(future.playLabel, "none");
      assert.notEqual(future.openLabel, "none");
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
  };
  await writeFile(path.join(output, "album-actions-report.json"), JSON.stringify(report, null, 2));
}
