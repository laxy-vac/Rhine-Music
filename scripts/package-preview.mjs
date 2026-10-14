import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stagePreviewPayload, inspectPreviewPayloadInputs } from './stage-preview-payload.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8'));
if (!/^\d+\.\d+\.\d+-preview\.\d+$/.test(version)) throw new Error('品尝版版本号无效');
const run = path.join(project,'.tools/preview-release',`${version}-${Date.now()}`);
const preparedIndex=process.argv.indexOf('--prepared-payload');
const payload=preparedIndex<0?path.join(run,'payload'):path.resolve(process.argv[preparedIndex+1]||'');
const compiler = path.join(project,'.tools/installer-tools/nsis/3.13/nsis-3.13/makensis.exe');
await fs.access(compiler).catch(()=>{throw new Error('缺少已批准的项目内 NSIS 3.13；此入口不会下载或安装工具。')});
await fs.mkdir(run,{recursive:true});
let staged;
if(preparedIndex<0)staged=await stagePreviewPayload({projectRoot:project,outputDir:payload,version});
else{
 const boundary=path.join(project,'.tools/preview-release')+path.sep;
 if(!payload.startsWith(boundary))throw new Error('复用载荷必须在本项目preview-release内');
 const inputs=await inspectPreviewPayloadInputs({projectRoot:project,version});
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
 for(const relative of ['README.md','docs/PROJECT-STATUS.md','docs/UNIFIED-ARCHITECTURE.md','docs/PREVIEW-RELEASE.md']){
  const original=await fs.readFile(path.join(project,relative));
  const copy=await fs.readFile(path.join(payload,'resources/app/docs',path.basename(relative)));
  if(!original.equals(copy))throw new Error(`载荷文档过期：${relative}`);
 }
 staged={warnings:inputs.warnings};
}
const installer = path.join(run,`Rhine-Music-${version}-Setup.exe`);
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
Name "Rhine Music · 品尝版 ${version}"
OutFile "${q(installer)}"
InstallDir "$EXEDIR\\Rhine Music Preview"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "开发中的朋友品尝版 · 不代表项目完成"
Icon "${q(path.join(project,'windows/app.ico'))}"
UninstallIcon "${q(path.join(project,'windows/app.ico'))}"
VIProductVersion "${version.split('-')[0]}.1"
VIAddVersionKey "ProductName" "Rhine Music Preview"
VIAddVersionKey "FileDescription" "Rhine Music 品尝版安装程序"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "LegalCopyright" "2026 RonaldDeng; RhineLabUI: LBEILC"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_TEXT "品尝版已安装。请从安装目录启动 Rhine Music Preview.exe。项目仍在开发中，四阶段进度及已知限制见随附文档。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\\Rhine Music Preview.exe"
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
    MessageBox MB_ICONSTOP "此品尝版需要支持 x64 应用的 Windows。"
    Abort
  \${EndIf}
FunctionEnd

Function VerifyDirectory
  \${GetRoot} "$INSTDIR" $0
  \${If} "$INSTDIR" == "$0\\"
    MessageBox MB_ICONSTOP "请选择独立的应用文件夹，不能直接安装在磁盘根目录。"
    Abort
  \${EndIf}
  IfFileExists "$INSTDIR\\.rhine-music-preview.ini" known existing
  known:
    ReadINIStr $0 "$INSTDIR\\.rhine-music-preview.ini" "RhineMusic" "Product"
    \${If} $0 != "RhineMusicPreview"
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
        MessageBox MB_ICONSTOP "请选择空目录或已有的 Rhine Music 品尝版目录，避免覆盖其他文件。"
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
  WriteINIStr "$INSTDIR\\.rhine-music-preview.ini" "RhineMusic" "Product" "RhineMusicPreview"
  WriteINIStr "$INSTDIR\\.rhine-music-preview.ini" "RhineMusic" "Version" "${version}"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview" "DisplayName" "Rhine Music 品尝版"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview" "Publisher" "RonaldDeng / RhineLabUI: LBEILC"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview" "DisplayIcon" "$INSTDIR\\Rhine Music Preview.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview" "UninstallString" '$\\"$INSTDIR\\Uninstall.exe$\\"'
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview" "NoRepair" 1
SectionEnd

Function un.onInit
  ReadINIStr $0 "$INSTDIR\\.rhine-music-preview.ini" "RhineMusic" "Product"
  \${If} $0 != "RhineMusicPreview"
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
  ReadRegStr $0 HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview" "InstallLocation"
  \${If} $0 == "$INSTDIR"
    DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RhineMusicPreview"
  \${EndIf}
  \${If} $ClearData == \${BST_CHECKED}
    ; The user explicitly chooses this; paths are fixed under this installation.
    RMDir /r "$INSTDIR\\data"
    RMDir /r "$INSTDIR\\presets"
    Delete "$INSTDIR\\.rhine-music-preview.ini"
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
