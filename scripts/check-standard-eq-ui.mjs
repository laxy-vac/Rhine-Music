import assert from 'node:assert/strict';

export async function checkStandardEqUi({ evaluate }) {
  const audit = await evaluate(`(async()=>{
    const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
    const root=document.createElement('section');
    root.id='standard-eq-ui-fixture';
    root.innerHTML=EqFixture.standardEqPresetMarkup();
    document.body.append(root);
    let settings=EqFixture.normalizeProcessing({eq:{enabled:true,mode:'parametric',name:'Working',bands:[{type:3,frequency:1000,q:1,gain:4}]}});
    const originalText=EqFixture.serializeStandardEqPresetFile(settings);
    let directory='Mock EQ folder';
    let entries=[
      {fileName:'Desk preset.rhine-eq',name:'Desk preset',revision:'a1',format:'rhine-standard'},
      {fileName:'Backup.rhine-eq',name:'Desk preset',revision:'b1',format:'rhine-standard'},
    ];
    let applyCount=0;
    const applied=[];
    const requests=[];
    let cancelAction='';
    let conflictFileName='';
    const copy=value=>JSON.parse(JSON.stringify(value));
    const selectedFor=(entry,sourceText=originalText)=>({...entry,sourceText});
    const mockRequest=async request=>{
      requests.push(copy(request));
      if(request.action===cancelAction){cancelAction='';return {ok:true,cancelled:true};}
      if(request.action==='list')return {ok:true,directory,presets:copy(entries)};
      if(request.action==='read'){
        const entry=entries.find(value=>value.fileName===request.fileName);
        if(!entry)return {ok:false,error:'missing file'};
        return {ok:true,selected:selectedFor(entry,entry.fileName==='Fresh.json'?JSON.stringify({parametric:false,preamp:0,bands:[31,62,125,250,500].map(frequency=>({type:2,channels:0,frequency,q:0,gain:1,color:0}))}):originalText)};
      }
      if(request.action==='choose-directory'){
        directory='Mock EQ folder 2';
        entries=[{fileName:'Fresh.json',name:'Fresh',revision:'fresh-r1',format:'poweramp'}];
        return {ok:true,directory,presets:copy(entries)};
      }
      if(request.action==='save'){
        if(request.fileName===conflictFileName&&entries.find(value=>value.fileName===request.fileName)?.revision!==request.revision)return {ok:false,error:'预设文件已在外部更改'};
        const old=entries.find(value=>value.fileName===request.fileName);
        if(!old)return {ok:false,error:'missing file'};
        const selected={...old,revision:'a2',sourceText:request.content};
        entries=entries.map(value=>value.fileName===old.fileName?{...selected}:value);
        return {ok:true,directory,presets:copy(entries),selected};
      }
      if(request.action==='save-copy'||request.action==='save-as'){
        const base=request.name.trim()||'Untitled';
        const fileName=(request.action==='save-copy'?base+' copy':base)+'.rhine-eq';
        const selected={fileName,name:fileName.replace(/\\.rhine-eq$/,''),revision:request.action==='save-copy'?'copy-r1':'as-r1',format:'rhine-standard',sourceText:request.content};
        entries=[...entries.filter(value=>value.fileName!==fileName),{...selected}];
        return {ok:true,directory,presets:copy(entries),selected};
      }
      if(request.action==='rename'){
        const old=entries.find(value=>value.fileName===request.fileName);
        if(!old)return {ok:false,error:'missing file'};
        const fileName=request.name.trim()+'.rhine-eq';
        const selected={...old,fileName,name:request.name.trim(),revision:'rename-r1'};
        entries=[...entries.filter(value=>value.fileName!==old.fileName&&value.fileName!==fileName),selected];
        return {ok:true,directory,presets:copy(entries),selected};
      }
      if(request.action==='import'){
        entries=[...entries,{fileName:'Imported source.json',name:'Imported source',revision:'import-r1',format:'poweramp'}];
        return {ok:true,directory,presets:copy(entries)};
      }
      if(request.action==='open-directory')return {ok:true,directory};
      return {ok:false,error:'unexpected '+request.action};
    };
    let state={directory,entries:copy(entries),selected:selectedFor(entries[0]),name:entries[0].name};
    const hooks={
      request:mockRequest,
      getSettings:()=>settings,
      apply:value=>{applyCount++;applied.push(copy(value));if(value.eq)settings=EqFixture.normalizeProcessing({...settings,eq:value.eq,...(value.tone?{tone:{...settings.tone,...value.tone}}:{})});},
      restore:()=>{},undo:()=>{},canUndo:()=>false,legacy:()=>[],loadLegacy:()=>{},changed:()=>{},
    };
    const controller=EqFixture.setupStandardEqPresets(root,state,hooks);
    await wait();
    const select=root.querySelector('[data-standard-eq-select]');
    const name=root.querySelector('[data-standard-eq-name]');
    const snapshot=()=>JSON.stringify({directory:state.directory,entries:state.entries.map(value=>value.fileName),selected:state.selected&&{fileName:state.selected.fileName,revision:state.selected.revision},name:state.name,settings:settings});
    const initial={directory:state.directory,selectedFile:state.selected.fileName,name:name.value,options:[...select.options].map(option=>({value:option.value,text:option.textContent}))};
    const click=async action=>{root.querySelector('[data-standard-eq-action="'+action+'"]').click();await wait();await wait();};

    const beforeCancel=snapshot();
    cancelAction='choose-directory';await click('choose-directory');
    const directoryCancelUnchanged=beforeCancel===snapshot();
    const beforeImport=applyCount;
    cancelAction='import';await click('import');
    const importCancelUnchanged=beforeCancel===snapshot()&&applyCount===beforeImport;
    cancelAction='save-as';await click('save-as');
    const saveAsCancelUnchanged=beforeCancel===snapshot();

    await click('save');
    const saveRequest=requests.filter(value=>value.action==='save').at(-1);
    const save={fileName:saveRequest?.fileName,revision:saveRequest?.revision,format:JSON.parse(saveRequest?.content||'{}').format,selectedFile:state.selected.fileName,selectedRevision:state.selected.revision};

    await click('save-copy');
    const copyRequest=requests.filter(value=>value.action==='save-copy').at(-1);
    const saveCopy={fileName:copyRequest?.fileName,revision:copyRequest?.revision,format:JSON.parse(copyRequest?.content||'{}').format,selectedFile:state.selected.fileName};

    name.value='Saved As';name.dispatchEvent(new Event('input',{bubbles:true}));
    await click('save-as');
    const saveAsRequest=requests.filter(value=>value.action==='save-as').at(-1);
    const saveAs={requestedName:saveAsRequest?.name,format:JSON.parse(saveAsRequest?.content||'{}').format,selectedFile:state.selected.fileName};

    name.value='Renamed preset';name.dispatchEvent(new Event('input',{bubbles:true}));
    await click('rename');
    const renameRequest=requests.filter(value=>value.action==='rename').at(-1);
    const rename={requestedName:renameRequest?.name,oldFileName:renameRequest?.fileName,newFileName:state.selected.fileName,selectedName:state.selected.name,optionText:select.selectedOptions[0]?.textContent};

    const beforeImportAction={selectedFile:state.selected.fileName,selectedRevision:state.selected.revision,settings:copy(settings),applyCount};
    await click('import');
    const importRequest=requests.filter(value=>value.action==='import').at(-1);
    const afterImportAction={selectedFile:state.selected.fileName,selectedRevision:state.selected.revision,settings:copy(settings),applyCount};
    const importAction={requestAction:importRequest?.action,unchanged:JSON.stringify(beforeImportAction)===JSON.stringify(afterImportAction),entryPresent:state.entries.some(value=>value.fileName==='Imported source.json')};

    const listBeforeFocus=requests.filter(value=>value.action==='list').length;
    window.dispatchEvent(new Event('focus'));await wait();await wait();
    const refocusListDelta=requests.filter(value=>value.action==='list').length-listBeforeFocus;

    await click('choose-directory');
    const directoryChange={directory:state.directory,selected:state.selected?.fileName??null,entryFiles:state.entries.map(value=>value.fileName)};
    select.value='Fresh.json';select.dispatchEvent(new Event('change',{bubbles:true}));await wait();await wait();
    const selection={fileName:state.selected?.fileName,displayName:name.value,format:applied.at(-1)?.format,appliedCount:applyCount};

    settings.eq.bands[0].gain=9.25;
    conflictFileName='Fresh.json';
    entries=entries.map(value=>value.fileName==='Fresh.json'?{...value,revision:'fresh-r2'}:value);
    const restoredRoot=document.createElement('section');restoredRoot.id='standard-eq-restore-fixture';restoredRoot.innerHTML=EqFixture.standardEqPresetMarkup();document.body.append(restoredRoot);
    const restoredState={directory:'',entries:[],name:'',restored:{directory:state.directory,fileName:'Fresh.json',revision:'fresh-r1'}};
    let restoredApplyCount=0;
    const restoredSettings=copy(settings);
    const restoredController=EqFixture.setupStandardEqPresets(restoredRoot,restoredState,{...hooks,getSettings:()=>restoredSettings,apply:()=>{restoredApplyCount++;}});
    await wait();await wait();
    const restoredStatus=restoredRoot.querySelector('[data-standard-eq-status]').textContent;
    const restored={fileName:restoredState.selected?.fileName,revision:restoredState.selected?.revision,status:restoredStatus,applyCount:restoredApplyCount};
    const beforeConflictSettings=JSON.stringify(restoredSettings);
    const beforeConflictApply=restoredApplyCount;
    restoredRoot.querySelector('[data-standard-eq-action="save"]').click();await wait();await wait();
    const conflictRequest=requests.filter(value=>value.action==='save'&&value.fileName==='Fresh.json').at(-1);
    const conflict={requestedRevision:conflictRequest?.revision,settingsPreserved:beforeConflictSettings===JSON.stringify(restoredSettings),applyPreserved:beforeConflictApply===restoredApplyCount,selectedRevision:restoredState.selected?.revision,status:restoredRoot.querySelector('[data-standard-eq-status]').textContent};

    controller.destroy();restoredController.destroy();root.remove();restoredRoot.remove();
    return {initial,directoryCancelUnchanged,importCancelUnchanged,saveAsCancelUnchanged,save,saveCopy,saveAs,rename,importAction,refocusListDelta,directoryChange,selection,restored,conflict};
  })()`);

  assert.equal(audit.initial.directory, 'Mock EQ folder');
  assert.equal(audit.initial.selectedFile, 'Desk preset.rhine-eq');
  assert.equal(audit.initial.name, 'Desk preset');
  assert.deepEqual(audit.initial.options.slice(1), [
    { value: 'Desk preset.rhine-eq', text: 'Desk preset.rhine-eq' },
    { value: 'Backup.rhine-eq', text: 'Backup.rhine-eq' },
  ], 'Duplicate preset names must remain distinguishable by file name.');
  assert.equal(audit.directoryCancelUnchanged, true, 'Cancelling the directory picker changed the selected preset state.');
  assert.equal(audit.importCancelUnchanged, true, 'Cancelling the import picker changed state or applied a preset.');
  assert.equal(audit.saveAsCancelUnchanged, true, 'Cancelling Save As changed the selected preset state.');
  assert.deepEqual(audit.save, { fileName: 'Desk preset.rhine-eq', revision: 'a1', format: 'rhine-standard-eq-preset', selectedFile: 'Desk preset.rhine-eq', selectedRevision: 'a2' });
  assert.deepEqual(audit.saveCopy, { fileName: 'Desk preset.rhine-eq', revision: 'a2', format: 'rhine-standard-eq-preset', selectedFile: 'Desk preset copy.rhine-eq' });
  assert.deepEqual(audit.saveAs, { requestedName: 'Saved As', format: 'rhine-standard-eq-preset', selectedFile: 'Saved As.rhine-eq' });
  assert.deepEqual(audit.rename, { requestedName: 'Renamed preset', oldFileName: 'Saved As.rhine-eq', newFileName: 'Renamed preset.rhine-eq', selectedName: 'Renamed preset', optionText: 'Renamed preset' });
  assert.deepEqual(audit.importAction, { requestAction: 'import', unchanged: true, entryPresent: true }, 'Import must copy/list the file without applying it or replacing the current selection.');
  assert.equal(audit.refocusListDelta, 1, 'Refocusing the document must refresh the host file list.');
  assert.deepEqual(audit.directoryChange, { directory: 'Mock EQ folder 2', selected: null, entryFiles: ['Fresh.json'] });
  assert.deepEqual(audit.selection, { fileName: 'Fresh.json', displayName: 'Fresh', format: 'poweramp', appliedCount: 1 });
  assert.deepEqual(audit.restored, { fileName: 'Fresh.json', revision: 'fresh-r1', status: '预设文件已在外部更改；可重新选择载入，或另存当前修改。', applyCount: 0 });
  assert.deepEqual(audit.conflict, { requestedRevision: 'fresh-r1', settingsPreserved: true, applyPreserved: true, selectedRevision: 'fresh-r1', status: '预设文件已在外部更改' });
  return audit;
}
