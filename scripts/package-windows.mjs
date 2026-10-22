import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stageWindowsPayload, inspectWindowsPayloadInputs } from './stage-windows-payload.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8'));
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const versionMatch = semanticVersionPattern.exec(String(version));
if (!versionMatch) throw new Error('package.json must contain a valid semantic version.');
if (versionMatch.slice(1, 4).some(part => Number(part) > 65535)) {
 throw new Error('Windows version resources require major, minor, and patch values no greater than 65535.');
}
const releaseRoot = path.join(project,'.tools/releases');
const run = path.join(releaseRoot,`${version}-${Date.now()}`);
const preparedIndex=process.argv.indexOf('--prepared-payload');
const payload=preparedIndex<0?path.join(run,'payload'):path.resolve(process.argv[preparedIndex+1]||'');
const compiler = path.join(project,'.tools/installer-tools/nsis/3.13/nsis-3.13/makensis.exe');
await fs.access(compiler).catch(()=>{throw new Error('缺少已批准的项目内 NSIS 3.13；此入口不会下载或安装工具。')});
const toolsInfo=await fs.lstat(path.join(project,'.tools'));
if(toolsInfo.isSymbolicLink()||!toolsInfo.isDirectory())throw new Error('Project tools path must be a real directory.');
try{await fs.mkdir(releaseRoot)}catch(error){if(error.code!=='EEXIST')throw error;}
const releaseInfo=await fs.lstat(releaseRoot);
if(releaseInfo.isSymbolicLink()||!releaseInfo.isDirectory())throw new Error('Release output path must be a real directory.');
await fs.mkdir(run);
const runInfo=await fs.lstat(run);
if(runInfo.isSymbolicLink()||!runInfo.isDirectory())throw new Error('Release run path must be a real directory.');
let staged;
if(preparedIndex<0)staged=await stageWindowsPayload({projectRoot:project,outputDir:payload,version});
else{
 const boundary=releaseRoot+path.sep;
 if(!payload.startsWith(boundary))throw new Error('A prepared payload must be inside this project\'s .tools/releases directory.');
 const inputs=await inspectWindowsPayloadInputs({projectRoot:project,version});
 const record=JSON.parse(await fs.readFile(path.join(payload,'release-manifest.json'),'utf8'));
 if(record.version!==version||record.nativeRuntime.sourceSha256!==inputs.native.manifest.sourceSha256)throw new Error('载荷版本/原生来源过期');
 for(const item of record.files){
  if(item.path.includes('..')||path.isAbsolute(item.path))throw new Error('载荷路径无效');
  const bytes=await fs.readFile(path.join(payload,item.path));
  if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error(`载荷内容变化：${item.path}`);
 }
 for(const relative of inputs.graph.files){
  const original=await fs.readFile(path.join(project,relative));
  const copy=await fs.readFile(path.join(payload,'resources/app',relative));
  if(!original.equals(copy))throw new Error(`载荷后台源码过期：${relative}`);
 }
 for(const [relative,destination] of [
  ['README.md','resources/app/docs/README.md'],
  ['docs/DEVELOPMENT.md','resources/app/docs/DEVELOPMENT.md'],
  ['LICENSE','resources/app/LICENSE'],
  ['NOTICE.md','resources/app/NOTICE.md'],
 ]){
  const original=await fs.readFile(path.join(project,relative));
  const copy=await fs.readFile(path.join(payload,destination));
  if(!original.equals(copy))throw new Error(`Prepared payload source file is out of date: ${relative}`);
 }
 staged={warnings:inputs.warnings};
}
const installer = path.join(run,`Rhine-Music-${version}-Setup.exe`);
const coreVersion = version.split(/[-+]/, 1)[0];
const q = value => String(value).replaceAll('$','$$').replaceAll('"','$\\"');
async function enumerate(directory,relative='') {
 const files=[];const directories=[];
 for(const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})) {
  const name=path.join(relative,entry.name);
  if(entry.isSymbolicLink())throw new Error('安装包文件不能为链接');
  if(entry.isDirectory()){directories.push(name);const child=await enumerate(directory,name);files.push(...child.files);directories.push(...child.directories)}
  else if(entry.isFile())files.push(name);
 }
 return{files,directories};
}
const entries=await enumerate(payload);
for(const name of entries.files){
 const relative=name.replaceAll('\\','/').toLowerCase();
 if(relative.startsWith('data/')||(relative.startsWith('presets/')&&relative.endsWith('.json')))
  throw new Error(`安装载荷混入运行数据或用户预设，未继续：${name}`);
}
// A generated exact removal list avoids recursive deletion of the chosen folder.
const removal=entries.files.map(name=>`  Delete "$INSTDIR\\${q(name)}"`).join('\n');
const rmdirs=entries.directories.sort((a,b)=>b.split(path.sep).length-a.split(path.sep).length).map(name=>`  RMDir "$INSTDIR\\${q(name)}"`).join('\n');
const script=`Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "x64.nsh"
Name "Rhine Music ${version}"
OutFile "${q(installer)}"
InstallDir "$EXEDIR\\Rhine Music"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "Rhine Music"
Icon "${q(path.join(project,'windows/app.ico'))}"
UninstallIcon "${q(path.join(project,'windows/app.ico'))}"
VIProductVersion "${coreVersion}.0"
VIAddVersionKey "ProductName" "Rhine Music"
VIAddVersionKey "FileDescription" "Rhine Music Installer"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "LegalCopyright" "2026 RonaldDeng; RhineLabUI: LBEILC"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_TEXT "Installation is complete. Start Rhine Music.exe from the installation folder."
!define MUI_FINISHPAGE_RUN "$INSTDIR\\Rhine Music.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${q(path.join(project,'LICENSE'))}"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE VerifyDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
UninstPage custom un.DataPage un.DataLeave
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"
Var ClearData
Var ClearDataCheckbox

Function .onInit
  \${IfNot} \${RunningX64}
    MessageBox MB_ICONSTOP "Rhine Music requires 64-bit Windows."
    Abort
  \${EndIf}
FunctionEnd

Function VerifyDirectory
  \${GetRoot} "$INSTDIR" $0
  \${If} "$INSTDIR" == "$0\\"
    MessageBox MB_ICONSTOP "请选择独立的应用文件夹，不能直接安装在磁盘根目录。"
    Abort
  \${EndIf}
  IfFileExists "$INSTDIR\\.rhine-music.ini" known existing
  known:
    ReadINIStr $0 "$INSTDIR\\.rhine-music.ini" "RhineMusic" "Product"
    \${If} $0 != "RhineMusic"
      MessageBox MB_ICONSTOP "该目录包含来源不明的安装标记，请选择空目录。"
      Abort
    \${EndIf}
    Goto probe
  existing:
    FindFirst $0 $1 "$INSTDIR\\*"
    loop:
      \${If} $1 == ""
        Goto empty
      \${EndIf}
      \${If} $1 != "."
      \${AndIf} $1 != ".."
        FindClose $0
        MessageBox MB_ICONSTOP "Choose an empty folder or an existing Rhine Music installation folder. Other files will not be overwritten."
        Abort
      \${EndIf}
      FindNext $0 $1
      Goto loop
    empty:
      FindClose $0
  probe:
    ClearErrors
    CreateDirectory "$INSTDIR"
    GetTempFileName $2 "$INSTDIR"
    \${If} \${Errors}
      MessageBox MB_ICONSTOP "该目录不可写。请选择普通用户可写的目录。"
      Abort
    \${EndIf}
    FileOpen $0 "$2" w
    \${If} \${Errors}
      MessageBox MB_ICONSTOP "该目录不可写。请选择普通用户可写的目录；不会提权、修改权限或改存 AppData。"
      Abort
    \${EndIf}
    FileWrite $0 "Rhine Music installer write probe"
    FileClose $0
    Delete "$2"
FunctionEnd

Section "应用程序（必选）" Core
  SectionIn RO
  Call VerifyDirectory
  SetOutPath "$INSTDIR"
  File /r "${q(payload)}\\*"
  CreateDirectory "$INSTDIR\\presets\\themes"
  CreateDirectory "$INSTDIR\\presets\\eq"
  CreateDirectory "$INSTDIR\\data"
  WriteINIStr "$INSTDIR\\.rhine-music.ini" "RhineMusic" "Product" "RhineMusic"
  WriteINIStr "$INSTDIR\\.rhine-music.ini" "RhineMusic" "Version" "${version}"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic" "DisplayName" "Rhine Music"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic" "Publisher" "RonaldDeng / RhineLabUI: LBEILC"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic" "DisplayIcon" "$INSTDIR\\Rhine Music.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic" "UninstallString" '$\\"$INSTDIR\\Uninstall.exe$\\"'
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic" "NoRepair" 1
SectionEnd

Function un.onInit
  ReadINIStr $0 "$INSTDIR\\.rhine-music.ini" "RhineMusic" "Product"
  \${If} $0 != "RhineMusic"
    MessageBox MB_ICONSTOP "安装标记缺失或无效，卸载已取消。"
    Abort
  \${EndIf}
  StrCpy $ClearData 0
FunctionEnd
Function un.DataPage
  nsDialogs::Create 1018
  Pop $0
  \${NSD_CreateLabel} 0 0 100% 35u "默认保留主题/EQ 预设、设置和曲库索引。不会删除音乐文件所在的外部目录。"
  Pop $0
  \${NSD_CreateCheckbox} 0 45u 100% 24u "同时删除此安装目录中的 data 和 presets（不可恢复）"
  Pop $ClearDataCheckbox
  nsDialogs::Show
FunctionEnd
Function un.DataLeave
  \${NSD_GetState} $ClearDataCheckbox $ClearData
FunctionEnd
Section "Uninstall"
${removal}
${rmdirs}
  Delete "$INSTDIR\\Uninstall.exe"
  ReadRegStr $0 HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic" "InstallLocation"
  \${If} $0 == "$INSTDIR"
    DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusic"
  \${EndIf}
  \${If} $ClearData == \${BST_CHECKED}
    ; The user explicitly chooses this; paths are fixed under this installation.
    RMDir /r "$INSTDIR\\data"
    RMDir /r "$INSTDIR\\presets"
    Delete "$INSTDIR\\.rhine-music.ini"
    RMDir "$INSTDIR"
  \${Else}
    ; Keep the marker so reinstalling into this folder can reuse retained data.
  \${EndIf}
SectionEnd
`;
const scriptFile=path.join(run,'installer.nsi');
await fs.writeFile(scriptFile,'\uFEFF'+script,'utf8');
const compilerTemp=path.join(run,'compiler-temp');
await fs.mkdir(compilerTemp);
await new Promise((resolve,reject)=>{
 const child=spawn(compiler,['/V2',scriptFile],{cwd:run,stdio:'inherit',windowsHide:true,env:{...process.env,TEMP:compilerTemp,TMP:compilerTemp}});
 child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`NSIS 编译失败：${code}`)));
});
const digest=createHash('sha256').update(await fs.readFile(installer)).digest('hex');
await fs.writeFile(installer+'.sha256',`${digest}  ${path.basename(installer)}\n`);
await fs.writeFile(path.join(run,'build-report.json'),JSON.stringify({version,installer:path.basename(installer),sha256:digest,payloadFiles:entries.files.length,stagedWarnings:staged.warnings??[],validation:'compiled; not installed or audio/device tested'},null,2)+'\n');
console.log(`安装包：${installer}\nSHA256：${digest}\n仅编译，未安装或修改系统。`);
