import fs from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const categories = ['interface', 'appearance', 'audio', 'lyrics', 'library', 'sources', 'about'];

export async function checkFutureSettings({ browserWindow, outputDirectory }) {
  const wc = browserWindow.webContents;
  const evaluate = script => wc.executeJavaScript(script, true);
  const click = selector => evaluate(`(() => {
    const node=document.querySelector(${JSON.stringify(selector)});
    if(!node)throw new Error('Missing Future Settings control: '+${JSON.stringify(selector)});
    node.click();
    return true;
  })()`);
  const result = {
    ok: false,
    screenshots: [],
    cases: [],
    checks: {},
    outputDirectory: path.join(outputDirectory, 'future-settings'),
    reportPath: path.join(outputDirectory,'future-settings','future-settings-report.json'),
    viewportChanges:[],
  };
  const originalSize = browserWindow.getContentSize();
  const originalBounds = browserWindow.getBounds();
  const originalFullscreen = browserWindow.isFullScreen();
  let windowAspectBefore=null;
  let cleanupError=null;
  let completed=false;

  const snapshot = () => evaluate(`(() => {
    const settings=document.querySelector('#music-settings');
    const stage=document.querySelector('#stage');
    const sections=[...settings?.querySelectorAll('[data-settings-category]')??[]];
    const active=[...settings?.querySelectorAll('[data-settings-category-target][aria-current="page"]')??[]];
    const visible=sections.filter(section=>!section.hidden&&getComputedStyle(section).display!=='none');
    const selected=active[0]?.dataset.settingsCategoryTarget??null;
    const content=settings?.querySelector('.settings-page-content');
    const section=sections.find(item=>item.dataset.settingsCategory===selected);
    const nav=settings?.querySelector('.settings-page-nav');
    const layout=settings?.querySelector('.settings-page-layout');
    const pageHeading=settings?.querySelector('.settings-page-heading');
    const gpuSelect=section?.querySelector('[data-gpu-preference]');
    const connectionGrid=section?.querySelector('.future-connection-grid');
    const connectionFields=[...(connectionGrid?.querySelectorAll('.future-connection-field')??[])];
    const rect=node=>{if(!node)return null;const b=node.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height}};
    const shown=node=>!!node&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden';
    const clippedText=[...(section?.querySelectorAll('h2,h3,p,label,span,small,button')??[])].filter(node=>{
      if(!shown(node)||node.clientWidth<2)return false;
      const style=getComputedStyle(node);
      return node.scrollWidth>node.clientWidth+3&&style.whiteSpace!=='normal'&&style.textOverflow!=='ellipsis';
    }).slice(0,24).map(node=>({tag:node.tagName,text:node.textContent?.trim().slice(0,72)??'',width:node.clientWidth,scrollWidth:node.scrollWidth,whiteSpace:getComputedStyle(node).whiteSpace,textOverflow:getComputedStyle(node).textOverflow}));
    const rows=[...(section?.querySelectorAll('.settings-row,.quality-control')??[])].filter(shown).map(row=>{
      const label=row.querySelector(':scope > span,:scope > label,:scope > legend,.settings-row-label');
      const control=row.querySelector('.settings-select-trigger')??row.querySelector(':scope > input,:scope > select,:scope > textarea,:scope > button,:scope > .quality-range');
      if(!shown(label)||!shown(control))return null;
      const a=label.getBoundingClientRect(),b=control.getBoundingClientRect(),r=row.getBoundingClientRect();
      const display=getComputedStyle(row);
      return {label:label.textContent?.trim().slice(0,56)??'',display:display.display,direction:display.flexDirection,
        labelRect:rect(label),controlRect:rect(control),rowRect:rect(row),
        centersY:Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2),
        horizontalOverlap:Math.min(a.right,b.right)-Math.max(a.left,b.left)>1,
        insideRow:a.left>=r.left-1&&a.right<=r.right+1&&b.left>=r.left-1&&b.right<=r.right+1};
    }).filter(Boolean);
    const controls=[...(section?.querySelectorAll('button,input,select,textarea,a,summary,[role="button"],[tabindex="0"]')??[])].filter(shown);
    const navItems=[...(nav?.querySelectorAll('button')??[])].filter(shown).map(button=>{
      const label=button.querySelector(':scope > span,span');
      const b=button.getBoundingClientRect(),l=label?.getBoundingClientRect();
      return {id:button.dataset.settingsCategoryTarget??button.dataset.settingsSubcategoryTarget??'',label:label?.textContent?.trim()??'',height:b.height,
        labelHeight:l?.height??0,labelBottom:l?.bottom??0,buttonBottom:b.bottom,labelScrollHeight:label?.scrollHeight??0,labelClientHeight:label?.clientHeight??0,
        clipped:!!label&&(label.scrollHeight>label.clientHeight+2||l.bottom>b.bottom+1||l.top<b.top-1)};
    });
    const selects=[...(section?.querySelectorAll('select')??[])].filter(shown).map(select=>({
      id:select.id,value:select.value,disabled:select.disabled,
      keepNative:select.hasAttribute('data-keep-native-select'),
      wrapper:select.nextElementSibling?.matches('.settings-select-trigger')??false,
      wrapperVisible:shown(select.nextElementSibling?.matches('.settings-select-trigger')?select.nextElementSibling:null),
    }));
    const ranges=[...(section?.querySelectorAll('input[type="range"]')??[])].filter(shown).map(range=>({
      id:range.id,min:range.min,max:range.max,value:range.value,
      valueButtons:range.parentElement?.querySelectorAll('.editable-range-value').length??0,
      visibleOutputs:[...(range.parentElement?.querySelectorAll('output[data-quality-output]')??[])].filter(shown).length,
    }));
    const switches=[...(section?.querySelectorAll('input[type="checkbox"][role="switch"]')??[])].filter(shown).map(node=>({id:node.id,checked:node.checked,disabled:node.disabled,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}));
    const panelCards=[...(section?.querySelectorAll('.panel-section')??[])].map(node=>{
      const style=getComputedStyle(node),ancestor=node.parentElement?.closest('.panel-section')??null;
      const borderVisible=['Top','Right','Bottom','Left'].every(side=>parseFloat(style['border'+side+'Width'])>0&&style['border'+side+'Style']!=='none'&&style['border'+side+'Color']!=='rgba(0, 0, 0, 0)');
      const backgroundVisible=style.backgroundColor!=='transparent'&&style.backgroundColor!=='rgba(0, 0, 0, 0)';
      const hasSurface=borderVisible||backgroundVisible||style.boxShadow!=='none';
      const ancestorStyle=ancestor?getComputedStyle(ancestor):null;
      const ancestorSurface=!!ancestorStyle&&(
        ['Top','Right','Bottom','Left'].every(side=>parseFloat(ancestorStyle['border'+side+'Width'])>0&&ancestorStyle['border'+side+'Style']!=='none'&&ancestorStyle['border'+side+'Color']!=='rgba(0, 0, 0, 0)')
        ||(ancestorStyle.backgroundColor!=='transparent'&&ancestorStyle.backgroundColor!=='rgba(0, 0, 0, 0)')
        ||ancestorStyle.boxShadow!=='none');
      return {id:node.id,className:String(node.className??''),padding:style.padding,nestedPanelCount:node.querySelectorAll('.panel-section').length,
        hasSurface,hasParentPanel:!!ancestor,ancestorSurface};
    });
    const windowDisplayHeadings=[...(section?.querySelectorAll('h2,h3,h4,legend')??[])].filter(node=>shown(node)&&/^window display$/i.test(node.textContent?.trim()??'')).length;
    const ftpIds=['ftp-host','ftp-port','ftp-security','ftp-user','ftp-password','ftp-root'];
    const ftpControls=ftpIds.map(id=>{
      const selector='#'+id;
      const node=section?.querySelector(selector);
      return {id,present:!!node,tag:node?.tagName??null,count:section?.querySelectorAll(selector).length??0,
        wrapper:node?.nextElementSibling?.matches('.settings-select-trigger')??false,
        valueSignature:node?.type==='password'?('length:'+node.value.length):node?.value??null};
    });
    const structure={padding:getComputedStyle(section??settings).padding,borderWidth:getComputedStyle(section??settings).borderWidth,
      nestedPanelCount:section?.querySelectorAll('.panel-section .panel-section').length??0,panelCards,
      sectionGridColumns:getComputedStyle(section??settings).gridTemplateColumns,
      connectionGrid:connectionGrid?{fields:connectionFields.length,visibleFields:connectionFields.filter(shown).length,
        columns:getComputedStyle(connectionGrid).gridTemplateColumns,rect:rect(connectionGrid),
        fieldContents:connectionFields.map(field=>({labels:field.querySelectorAll('label').length,controls:field.querySelectorAll('input,select,textarea,.settings-select-trigger').length}))}:null,
      feedbackGrid:(()=>{const node=section?.querySelector('.future-feedback-grid');return node?{columns:getComputedStyle(node).gridTemplateColumns,children:node.children.length,rect:rect(node)}:null})(),
      displayColumns:(()=>{const node=section?.querySelector('.future-display-columns');return node?{columns:getComputedStyle(node).gridTemplateColumns,children:node.children.length,rect:rect(node)}:null})(),
      lyricsColumns:(()=>{const node=section?.querySelector('.lyrics-global-settings');return node?{columns:getComputedStyle(node).gridTemplateColumns,children:node.children.length,rect:rect(node)}:null})(),
      windowDisplayHeadings};
    return {
      page:stage?.dataset.page??null,design:stage?.dataset.design??null,theme:stage?.dataset.theme??null,
      palette:document.querySelector('#music-theme-page .future-appearance-switch')?.dataset.dayChoice??null,locale:document.documentElement.lang,
      active:active.map(node=>node.dataset.settingsCategoryTarget),visible:visible.map(node=>node.dataset.settingsCategory),
      categories:sections.map(node=>node.dataset.settingsCategory),
      categoryButtons:sections.map(node=>({id:node.dataset.settingsCategory,count:settings?.querySelectorAll('[data-settings-category-target="'+node.dataset.settingsCategory+'"]').length??0})),
      viewport:{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth},
      stage:rect(stage),settings:rect(settings),pageHeading:rect(pageHeading),layout:rect(layout),nav:rect(nav),content:rect(content),section:rect(section),
      scroll:{contentClientWidth:content?.clientWidth??0,contentScrollWidth:content?.scrollWidth??0,contentClientHeight:content?.clientHeight??0,contentScrollHeight:content?.scrollHeight??0,sectionScrollWidth:section?.scrollWidth??0,sectionScrollHeight:section?.scrollHeight??0,scrollTop:content?.scrollTop??0},
      clippedText,rows,navItems,controls:controls.map(node=>({tag:node.tagName,id:node.id,type:node.type??'',disabled:node.disabled??false,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})),
      selects,ranges,switches,structure,gpu:{ready:!!gpuSelect&&!gpuSelect.disabled&&gpuSelect.options.length>1,disabled:gpuSelect?.disabled??null,options:gpuSelect?.options.length??0},ftpControls,
      language:section?.querySelector('#ui-language')?.value??null,
      activeTitle:section?.querySelector(':scope > h2')?.textContent?.trim()??'',
      activeText:section?.textContent?.trim().slice(0,1200)??'',
      activeCount:active.length,visibleCount:visible.length,
    };
  })()`);

  const waitFor = async (predicate, label, timeout = 7000) => {
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const state = await snapshot();
        if (predicate(state)) return state;
      } catch (error) { lastError = String(error?.message ?? error); }
      await pause(60);
    }
    let state = null;
    try { state = await snapshot(); } catch (error) { lastError = String(error?.message ?? error); }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state?{page:state.page,design:state.design,theme:state.theme,active:state.active}:{lastError})}`);
  };
  const openStyle = async () => {
    if ((await evaluate(`document.querySelector('#stage')?.dataset.page`)) !== 'theme') {
      await click('.music-topnav [data-action="theme"]');
    }
    await waitFor(state=>state.page==='theme','STYLE page');
  };
  const setAppearance = async (design, theme, palette = 'soft') => {
    await openStyle();
    let changed=false;
    let state=await snapshot();
    if(state.design!==design){
      await click(`.design-family-card[data-style-design="${design}"]`);
      await waitFor(value=>value.design===design&&value.page==='theme',`${design} style`);
      changed=true;
    }
    state=await snapshot();
    if(state.theme!==theme){
      await click(`aside.theme-mode-controls button[data-theme="${theme}"]`);
      await waitFor(value=>value.design===design&&value.theme===theme,`${design} ${theme}`);
      changed=true;
    }
    if(design==='rhine'&&theme==='day'){
      state=await snapshot();
      if(state.palette!==palette){
        await click(`#music-theme-page [data-day-palette="${palette}"]`);
        await waitFor(value=>value.design==='rhine'&&value.theme==='day'&&value.palette===palette,`Future ${palette} palette`);
        changed=true;
      }
    }
    if(changed)await pause(750);
  };
  const openSettings = async () => {
    if((await evaluate(`document.querySelector('#stage')?.dataset.page`))!=='settings')await click('.music-topnav [data-action="settings"]');
    return waitFor(state=>state.page==='settings','Settings page');
  };
  const openCategory = async id => {
    await openSettings();
    const current=await snapshot();
    if(current.active[0]!==id)await click(`#music-settings [data-settings-category-target="${id}"]`);
    return waitFor(state=>state.page==='settings'&&state.active.length===1&&state.active[0]===id&&state.visible.length===1&&state.visible[0]===id,`${id} category`);
  };
  const scrollToTop = async id => evaluate(`(() => {
    const content=document.querySelector('#music-settings .settings-page-content');
    const section=document.querySelector('#music-settings [data-settings-category="${id}"]');
    if(!content||!section)throw new Error('Missing Settings scroll region for ${id}');
    content.scrollTop=0;
    return {target:'top',scrollTop:content.scrollTop};
  })()`);
  const scrollToContent = async (id,targetSelector=null) => evaluate(`(() => {
    const content=document.querySelector('#music-settings .settings-page-content');
    const section=document.querySelector('#music-settings [data-settings-category="${id}"]');
    const selector=${JSON.stringify(targetSelector)};
    if(!content||!section)throw new Error('Missing Settings scroll region for ${id}');
    content.scrollTop=0;
    if(selector){
      const target=section.querySelector(selector);
      if(!target)throw new Error('Missing Settings screenshot target: '+selector);
      const a=target.getBoundingClientRect(),b=content.getBoundingClientRect();content.scrollTop+=a.top-b.top-8;
      return {target:target.className??target.tagName,scrollTop:content.scrollTop,targetTop:target.getBoundingClientRect().top-content.getBoundingClientRect().top};
    }
    const target=section.querySelector('.panel-section,fieldset,details,.settings-row')??section.querySelector(':scope > :not(h2)')??section.querySelector(':scope > h2');
    if(target){const a=target.getBoundingClientRect(),b=content.getBoundingClientRect();content.scrollTop+=a.top-b.top-8;}
    return {target:target?.className??target?.tagName??null,scrollTop:content.scrollTop,targetTop:target?target.getBoundingClientRect().top-content.getBoundingClientRect().top:null};
  })()`);
  const capture = async (label, palette, id, position='top', targetSelector=null) => {
    const scrollTarget=position==='top'?await scrollToTop(id):await scrollToContent(id,targetSelector);
    if(id==='appearance')await waitFor(state=>state.gpu.ready,'GPU list before Appearance screenshot',20000);
    await pause(280);
    const state=await snapshot();
    const file=path.join(result.outputDirectory,`future-settings-${label}-${id}-${position}.png`);
    await fs.writeFile(file,(await browserWindow.capturePage()).toPNG());
    result.screenshots.push(file);
    result.cases.push({label,palette,category:id,position,viewport:state.viewport,scrollTarget,visibleContent:{active:state.active,visible:state.visible,section:state.section,scroll:state.scroll},screenshot:file});
  };
  const revealNavItem = async id => evaluate(`(() => {
    const nav=document.querySelector('#music-settings .settings-page-nav');
    const item=nav?.querySelector('[data-settings-category-target="${id}"]');
    if(!nav||!item)throw new Error('Missing Settings navigation target: ${id}');
    const reveal=()=>{
      const n=nav.getBoundingClientRect(),b=item.getBoundingClientRect();
      if(b.left<n.left)nav.scrollLeft-=n.left-b.left+4;
      else if(b.right>n.right)nav.scrollLeft+=b.right-n.right+4;
      const next= item.getBoundingClientRect(),r=nav.getBoundingClientRect();
      if(next.top<r.top)nav.scrollTop-=r.top-next.top+4;
      else if(next.bottom>r.bottom)nav.scrollTop+=next.bottom-r.bottom+4;
    };
    reveal();
    const n=nav.getBoundingClientRect(),b=item.getBoundingClientRect();
    return {id:${JSON.stringify(id)},nav:{left:n.left,right:n.right,top:n.top,bottom:n.bottom},button:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},
      visible:b.left>=n.left-1&&b.right<=n.right+1&&b.top>=n.top-1&&b.bottom<=n.bottom+1,scrollLeft:nav.scrollLeft,scrollTop:nav.scrollTop,
      clientWidth:nav.clientWidth,scrollWidth:nav.scrollWidth};
  })()`);
  const readWindowAspect = () => evaluate(`(() => {
    const select=document.querySelector('#graphics-display-settings [data-window-aspect]');
    return select?{value:select.value,options:[...select.options].map(option=>option.value)}:null;
  })()`);
  const setWindowAspect = value => evaluate(`(() => {
    const select=document.querySelector('#graphics-display-settings [data-window-aspect]');
    if(!select||![...select.options].some(option=>option.value===${JSON.stringify(value)}))return false;
    select.value=${JSON.stringify(value)};
    select.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  const waitForWindowAspect = async value => {
    const deadline=Date.now()+7000;
    while(Date.now()<deadline){
      try{if(await readWindowAspect().then(state=>state?.value===value))return true;}catch{}
      await pause(60);
    }
    return false;
  };
  const setViewport = async (width,height=900) => {
    browserWindow.setContentSize(width,height);
    await pause(180);
    const actual=browserWindow.getContentSize();
    result.viewportChanges.push({requested:[width,height],actual});
    return actual;
  };
  const inspectNarrowBoundaries = async id => {
    await openCategory(id);
    await scrollToContent(id);
    await pause(80);
    const state=await snapshot();
    const overflows=[];
    const edges=await evaluate(`(() => {
      const settings=document.querySelector('#music-settings'),content=settings?.querySelector('.settings-page-content'),section=content?.querySelector('[data-settings-category="${id}"]');
      const bounds=node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth}};
      const nodeOverflow=[...section?.querySelectorAll('.panel-section,fieldset,details,.settings-row,button,input,select,textarea')??[]].filter(node=>node.getClientRects().length).map(node=>({tag:node.tagName,id:node.id,className:String(node.className??''),...bounds(node)})).filter(item=>item.left < (content?.getBoundingClientRect().left??0)-1 || item.right > (content?.getBoundingClientRect().right??innerWidth)+1 || item.scrollWidth > item.clientWidth+3).slice(0,24);
      return{documentWidth:document.documentElement.scrollWidth,windowWidth:innerWidth,content:content?bounds(content):null,section:section?bounds(section):null,nodeOverflow};
    })()`);
    const textProblems=state.clippedText;
    const rowProblems=state.rows.filter(row=>!row.insideRow||row.horizontalOverlap||(row.display==='flex'&&row.direction!=='column'&&row.centersY>30));
    const navProblems=state.navItems.filter(item=>item.clipped);
    return {id,state,edges,textProblems,rowProblems,navProblems,hasHorizontalOverflow:edges.documentWidth>edges.windowWidth+1||(edges.content&&edges.content.scrollWidth>edges.content.clientWidth+3)||edges.nodeOverflow.some(node=>node.left<edges.content.left-1||node.right>edges.content.right+1)};
  };
  const inspectReachability = async id => {
    await openCategory(id);
    const before=await snapshot();
    const outcome=await evaluate(`(() => {
      const content=document.querySelector('#music-settings .settings-page-content'),section=document.querySelector('#music-settings [data-settings-category="${id}"]');
      const nodes=[...section.querySelectorAll('button,input,select,textarea,a,summary,[role="button"],[tabindex="0"]')].filter(node=>{
        if(!node.getClientRects().length||getComputedStyle(node).visibility==='hidden')return false;
        const disclosure=node.closest('details:not([open])');
        return !disclosure||node.matches('summary');
      });
      const reachable=[];
      for(const node of nodes){
        node.scrollIntoView({block:'nearest',inline:'nearest'});
        const r=node.getBoundingClientRect(),c=content.getBoundingClientRect();
        const visible=r.width>0&&r.height>0&&r.right>c.left-1&&r.left<c.right+1&&r.bottom>c.top-1&&r.top<c.bottom+1;
        reachable.push({tag:node.tagName,id:node.id,type:node.type??'',visible,disabled:node.disabled??false,width:r.width,height:r.height});
      }
      return{count:nodes.length,unreachable:reachable.filter(item=>!item.visible),reachable};
    })()`);
    return {id,count:outcome.count,unreachable:outcome.unreachable,initialScroll:before.scroll};
  };
  const inspectDetails = async id => evaluate(`(async () => {
    const section=document.querySelector('#music-settings [data-settings-category="${id}"]');
    const content=document.querySelector('#music-settings .settings-page-content');
    const details=[...section.querySelectorAll('details:not([open])')].filter(node=>node.getClientRects().length);
    const states=[];
    for(const item of details){
      const summary=item.querySelector('summary');
      summary?.scrollIntoView({block:'nearest'});
      const sr=summary?.getBoundingClientRect(),cr=content?.getBoundingClientRect();
      const summaryReachable=!!summary&&!!sr&&!!cr&&sr.width>0&&sr.height>0&&sr.bottom>cr.top-1&&sr.top<cr.bottom+1;
      item.open=true;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const body=[...item.children].find(node=>node!==summary);
      body?.scrollIntoView({block:'nearest'});
      const br=body?.getBoundingClientRect(),afterContent=content?.getBoundingClientRect();
      const bodyText=body?.textContent?.trim()??'';
      const bodyVisible=!!body&&!!br&&!!afterContent&&br.width>0&&br.height>0&&br.bottom>afterContent.top-1&&br.top<afterContent.bottom+1;
      const nested=[...item.querySelectorAll('button,input,select,textarea,a')].filter(node=>node.getClientRects().length);
      states.push({summary:summary?.textContent?.trim().slice(0,80)??'',summaryReachable,bodyVisible,bodyTextLength:bodyText.length,expanded:bodyVisible&&bodyText.length>0,expandedControlCount:nested.length});
      item.open=false;
    }
    return states;
  })()`);

  const applyLanguage = async language => {
    await openCategory('interface');
    const current=await evaluate(`document.querySelector('#ui-language')?.value??null`);
    if(current===language)return await snapshot();
    try {
      await evaluate(`(() => {
        const select=document.querySelector('#ui-language'),apply=document.querySelector('[data-action="apply-language"]');
        if(!select||!apply)throw new Error('Missing language controls');
        select.value=${JSON.stringify(language)};
        select.dispatchEvent(new Event('change',{bubbles:true}));
        apply.click();
        return true;
      })()`);
    } catch (error) {
      if(!/frame was navigated|context.*destroy|execution context|navigation/i.test(String(error?.message??error)))throw error;
    }
    const ready=await waitFor(state=>state.page==='settings'&&state.language===language&&state.locale===language&&state.active[0]==='interface',`${language} language reload`,30000);
    wc.setBackgroundThrottling(false);
    return ready;
  };

  try {
    await fs.mkdir(result.outputDirectory,{recursive:true});
    const initialDisplay=await evaluate(`(() => ({page:document.querySelector('#stage')?.dataset.page,design:document.querySelector('#stage')?.dataset.design,theme:document.querySelector('#stage')?.dataset.theme,language:document.querySelector('#ui-language')?.value??null}))()`);
    result.initialDisplay=initialDisplay;

    await setViewport(1440);
    await setAppearance('rhine','day','soft');
    await openSettings();
    const wideDayCases=[];
    for(const id of categories){
      const state=await openCategory(id);
      wideDayCases.push({id,state});
      await capture('day-warmwhite','soft',id,'top');
      if(id==='audio'||id==='lyrics')await capture('day-warmwhite','soft',id,'panel');
    }
    result.checks.sevenCategories = wideDayCases.length===7&&wideDayCases.every(item=>item.state.categories.length===7&&item.state.activeCount===1&&item.state.visibleCount===1);
    result.checks.allCategorySectionsUnique = wideDayCases.every(item=>item.state.categories.length===7&&new Set(item.state.categories).size===7&&item.state.categoryButtons.every(button=>button.count===1));
    result.checks.defaultEnglish = wideDayCases.find(item=>item.id==='interface')?.state.language==='en';
    result.checks.dynamicCategoryContent = wideDayCases.every(item=>item.state.activeTitle.length>0&&item.state.activeText.length>0);
    const allSelects=wideDayCases.flatMap(item=>item.state.selects.map(select=>({category:item.id,...select})));
    result.selectDiagnostics=allSelects;
    const wrappedSelects=allSelects.filter(select=>!select.keepNative);
    const nativeSelects=allSelects.filter(select=>select.keepNative);
    result.checks.selectWrappersPreserved = wrappedSelects.length>0&&wrappedSelects.every(select=>select.wrapper&&select.wrapperVisible);
    result.checks.explicitNativeSelectsPreserved=nativeSelects.length>0&&nativeSelects.every(select=>!select.wrapper);
    const allRanges=wideDayCases.flatMap(item=>item.state.ranges.map(range=>({category:item.id,...range})));
    result.rangeDiagnostics=allRanges;
    result.checks.singleRangeValue = allRanges.length>0&&allRanges.every(range=>range.valueButtons===1&&range.visibleOutputs===0);
    const structures=wideDayCases.map(item=>({category:item.id,...item.state.structure}));
    result.structureDiagnostics=structures;
    result.checks.categoryHasNoOuterPadding=structures.every(item=>item.padding==='0px');
    result.checks.noNestedPanelCards=structures.every(item=>item.panelCards.every(card=>!card.hasParentPanel||!card.hasSurface||!card.ancestorSurface));
    result.checks.noDuplicateWindowDisplayHeading=structures.find(item=>item.category==='appearance')?.windowDisplayHeadings===1;

    const sourceInitial=wideDayCases.find(item=>item.id==='sources')?.state;
    result.ftpInitial={controls:sourceInitial?.ftpControls??[],grid:sourceInitial?.structure.connectionGrid??null};
    result.checks.ftpSixFieldGrid=!!sourceInitial?.structure.connectionGrid&&sourceInitial.structure.connectionGrid.fields===6;
    result.checks.ftpFieldContents=sourceInitial?.structure.connectionGrid?.fieldContents.length===6&&sourceInitial.structure.connectionGrid.fieldContents.every(field=>field.labels===1&&field.controls>=1);
    result.checks.ftpTwoColumnsWide=sourceInitial?.structure.connectionGrid?.columns.trim().split(/\s+/).length===2;
    result.checks.ftpControlIdsUnique=sourceInitial?.ftpControls.length===6&&sourceInitial.ftpControls.every(control=>control.present&&control.count===1);
    await openCategory('sources');
    await evaluate(`(() => {window.__futureSettingsFtpRefs=Object.fromEntries(['ftp-host','ftp-port','ftp-security','ftp-user','ftp-password','ftp-root'].map(id=>[id,document.querySelector('#'+id)]));return true})()`);
    await capture('day-warmwhite','soft','sources','panel','.future-connection-grid');
    await openCategory('about');
    await openCategory('sources');
    result.ftpPreservation=await evaluate(`(() => {
      const ids=['ftp-host','ftp-port','ftp-security','ftp-user','ftp-password','ftp-root'];
      const before=window.__futureSettingsFtpRefs??{};
      const controls=ids.map(id=>{const node=document.querySelector('#'+id),old=before[id];return{id,identityPreserved:!!node&&node===old,
        valueSignature:node?.type==='password'?('length:'+node.value.length):node?.value??null,
        triggerPreserved:node?.nextElementSibling?.matches('.settings-select-trigger')??false}});
      const baseline=${JSON.stringify(sourceInitial?.ftpControls.map(item=>({id:item.id,valueSignature:item.valueSignature,wrapper:item.wrapper}))??[])};
      return{controls,valuesPreserved:controls.every(item=>baseline.some(entry=>entry.id===item.id&&entry.valueSignature===item.valueSignature&&entry.wrapper===item.triggerPreserved)),identityPreserved:controls.every(item=>item.identityPreserved)};
    })()`);
    result.checks.ftpNodeIdentityStable=result.ftpPreservation.identityPreserved;
    result.checks.ftpValuesStable=result.ftpPreservation.valuesPreserved;

    await setAppearance('rhine','day','original');
    await openSettings();
    for(const id of categories){await openCategory(id);await capture('day-original','original',id,'top');}

    await setAppearance('rhine','night');
    await openSettings();
    for(const id of ['interface','appearance','audio']){await openCategory(id);await capture('night','night',id,'top');}

    await setAppearance('rhine','day','soft');
    await applyLanguage('zh-CN');
    const chineseInterface=await openCategory('interface');
    result.chineseInterface={locale:chineseInterface.locale,language:chineseInterface.language,columns:chineseInterface.structure.sectionGridColumns,layout:chineseInterface.layout,
      feedbackGrid:chineseInterface.structure.feedbackGrid,clippedText:chineseInterface.clippedText};
    await capture('zh-CN','zh-CN','interface','top');
    result.checks.chineseLocaleApplied=chineseInterface.locale==='zh-CN'&&chineseInterface.language==='zh-CN';
    result.checks.chineseInterfaceTwoColumns=chineseInterface.structure.sectionGridColumns.trim().split(/\s+/).length===2&&chineseInterface.clippedText.length===0;
    const feedback=chineseInterface.structure.feedbackGrid;
    result.checks.chineseFeedbackChannels=!!feedback&&feedback.children===2&&feedback.columns.trim().split(/\s+/).length===2;
    await capture('zh-CN','zh-CN','interface','panel','#interface-sound-settings');
    const initialSound=await evaluate(`(() => ({effects:document.querySelector('#sound-setting')?.checked??null,ambience:document.querySelector('#bgm-setting')?.checked??null,
      effectVolume:document.querySelector('#sound-volume')?.value??null,ambienceVolume:document.querySelector('#bgm-volume')?.value??null}))()`);
    await openCategory('audio');
    await openCategory('interface');
    const afterSound=await evaluate(`(() => ({effects:document.querySelector('#sound-setting')?.checked??null,ambience:document.querySelector('#bgm-setting')?.checked??null,
      effectVolume:document.querySelector('#sound-volume')?.value??null,ambienceVolume:document.querySelector('#bgm-volume')?.value??null}))()`);
    result.soundSettingsPreservation={before:initialSound,after:afterSound,unchanged:JSON.stringify(initialSound)===JSON.stringify(afterSound)};
    result.checks.soundControlsPreservedWithoutActivation=result.soundSettingsPreservation.unchanged;
    await applyLanguage('en');
    result.checks.englishRestoredAfterChinese=await evaluate(`document.documentElement.lang==='en'&&document.querySelector('#ui-language')?.value==='en'`);

    await setViewport(800,450);
    const narrowCases=[];
    await setAppearance('rhine','day','soft');
    await openSettings();
    for(const id of categories){
      const geometry=await inspectNarrowBoundaries(id);
      narrowCases.push(geometry);
    }
    result.narrowCases=narrowCases.map(({id,state,edges,textProblems,rowProblems,navProblems,hasHorizontalOverflow})=>({id,viewport:state.viewport,stage:state.stage,settings:state.settings,pageHeading:state.pageHeading,layout:state.layout,nav:state.nav,content:state.content,edges,textProblems,rowProblems,navProblems,hasHorizontalOverflow}));
    result.checks.narrowContentWithinBounds=narrowCases.every(item=>!item.hasHorizontalOverflow);
    result.checks.noUnintentionalTextClipping=narrowCases.every(item=>item.textProblems.length===0);
    result.checks.labelControlsAligned=narrowCases.every(item=>item.rowProblems.length===0);
    result.checks.navigationLabelsFit=narrowCases.every(item=>item.navProblems.length===0);
    result.checks.narrowViewportIs800=narrowCases.every(item=>item.state.viewport.width===800);
    await openCategory('audio');
    const fixedAudioNav=await revealNavItem('audio');
    const fixedAudioState=await snapshot();
    result.narrowFixedAudio={stage:fixedAudioState.stage,settings:fixedAudioState.settings,pageHeading:fixedAudioState.pageHeading,nav:fixedAudioState.nav,content:fixedAudioState.content,
      viewport:fixedAudioState.viewport,navigation:fixedAudioNav};
    result.checks.fixedAspectAudioNavReachable=fixedAudioNav.visible;
    await capture('narrow','soft','audio','top');
    const reaches=[];
    for(const id of categories)reaches.push(await inspectReachability(id));
    result.reachability=reaches;
    result.checks.allVisibleTargetsReachable=reaches.every(item=>item.unreachable.length===0);

    const audioState=await openCategory('audio');
    result.audioScroll={viewport:audioState.viewport,content:audioState.scroll,section:audioState.section};
    result.checks.longAudioFormScrolls=audioState.scroll.contentScrollHeight>audioState.scroll.contentClientHeight+2;
    const details=await inspectDetails('audio');
    result.audioDetails=details;
    result.checks.collapsedDetailsExpand=details.length>0&&details.every(item=>item.summaryReachable&&item.expanded);

    await openCategory('appearance');
    const aspectBefore=await readWindowAspect();
    windowAspectBefore=aspectBefore?.value??null;
    const fixedAspectState=await snapshot();
    result.narrowFixedStage={aspect:aspectBefore,viewport:fixedAspectState.viewport,stage:fixedAspectState.stage,settings:fixedAspectState.settings,pageHeading:fixedAspectState.pageHeading};
    result.checks.fixedAspectStageMeasured=!!fixedAspectState.stage&&fixedAspectState.stage.width>0&&fixedAspectState.stage.height>0;
    result.checks.fixedAspectStageMatchesSixteenNine=!!fixedAspectState.stage&&Math.abs(fixedAspectState.stage.width/fixedAspectState.stage.height-16/9)<0.06;
    const freeAvailable=!!aspectBefore?.options.includes('free');
    result.checks.freeAspectOptionAvailable=freeAvailable;
    if(freeAvailable&&await setWindowAspect('free')){
      const aspectApplied=await waitForWindowAspect('free');
      await setViewport(800,900);
      await pause(260);
      await openCategory('audio');
      const freeAudioNav=await revealNavItem('audio');
      await capture('narrow-free','soft','audio','top');
      const freeState=await snapshot();
      result.narrowFreeAspect={aspect:await readWindowAspect(),aspectApplied,viewport:freeState.viewport,stage:freeState.stage,settings:freeState.settings,
        pageHeading:freeState.pageHeading,nav:freeState.nav,content:freeState.content,navigation:freeAudioNav};
      result.checks.freeAspectUsesVerticalSpace=!!freeState.stage&&freeState.stage.height>fixedAspectState.stage.height+100;
      result.checks.freeAspectAudioNavReachable=freeAudioNav.visible;
      await openCategory('appearance');
      await setWindowAspect(windowAspectBefore);
      result.checks.windowAspectPreferenceRestored=await waitForWindowAspect(windowAspectBefore);
      await setViewport(800,450);
    }else{
      result.narrowFreeAspect={available:freeAvailable,changed:false};
      result.checks.freeAspectUsesVerticalSpace=false;
      result.checks.freeAspectAudioNavReachable=false;
      result.checks.windowAspectPreferenceRestored=false;
    }

    await setAppearance('archive','day');
    await setViewport(1440);
    await openSettings();
    await openCategory('audio');
    await capture('punk-comparison','punk','audio','top');
    result.checks.punkComparisonCaptured=result.screenshots.some(file=>file.includes('punk-comparison'));
    result.checks.captureCount=result.screenshots.length===25;
    completed=true;
    return result;
  } finally {
    try {
      if(windowAspectBefore){
        const current=await readWindowAspect();
        if(current?.value!==windowAspectBefore){
          await openCategory('appearance');
          await setWindowAspect(windowAspectBefore);
          await waitForWindowAspect(windowAspectBefore);
        }
      }
      const currentLocale=await evaluate(`document.documentElement.lang`);
      if(currentLocale!=='en')await applyLanguage('en');
      await setAppearance('rhine','day','soft');
      await openSettings();
      await openCategory('interface');
      if((await evaluate(`document.querySelector('#stage')?.dataset.page`))!=='theme')await click('.music-topnav [data-action="theme"]');
      await waitFor(state=>state.page==='theme','restore STYLE route');
      wc.setBackgroundThrottling(false);
      const state=await snapshot();
      result.checks.followingGraphicsStateRestored=state.design==='rhine'&&state.theme==='day'&&state.locale==='en'&&state.page==='theme'&&state.active[0]==='interface';
      result.finalState={design:state.design,theme:state.theme,locale:state.locale,page:state.page,active:state.active,backgroundThrottling:wc.getBackgroundThrottling()};
    } catch(error){
      cleanupError=String(error?.stack??error);
      result.cleanupError=cleanupError;
      result.checks.followingGraphicsStateRestored=false;
      try{wc.setBackgroundThrottling(false);}catch{}
    }
    if(!browserWindow.isDestroyed()){
      if(browserWindow.isFullScreen()!==originalFullscreen)browserWindow.setFullScreen(originalFullscreen);
      browserWindow.setContentSize(originalSize[0],originalSize[1]);
      browserWindow.setBounds(originalBounds);
    }
    result.completed=completed;
    result.ok=completed&&Object.values(result.checks).every(value=>value===true);
    try{await fs.mkdir(result.outputDirectory,{recursive:true});await fs.writeFile(result.reportPath,`${JSON.stringify(result,null,2)}\n`,'utf8');}catch{}
  }
}
