param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [switch]$InstallApproved
)
$ErrorActionPreference='Stop'
if(-not $InstallApproved){throw 'This check installs software and writes its HKCU uninstall entry. Obtain explicit approval, then pass -InstallApproved.'}
$taskProject=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskRoot=Join-Path $taskProject '.tools/preview-release/installer-acceptance'
$taskInstall=Join-Path $taskRoot '验收目录'
$taskPrefix=$taskProject.TrimEnd('\')+'\.tools\preview-release\'
if(-not ([IO.Path]::GetFullPath($taskInstall)).StartsWith($taskPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Test target escapes the project scratch area'}
$taskRegistry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RhineMusicPreview'
if(Test-Path -LiteralPath $taskRegistry){throw 'An existing Rhine Music Preview registration exists; it will not be overwritten.'}
if(Test-Path -LiteralPath $taskInstall){throw 'The acceptance install directory already exists; it will not be overwritten.'}
$taskInstaller=(Resolve-Path -LiteralPath $Installer).Path
New-Item -ItemType Directory -Path $taskRoot -Force | Out-Null
$taskTemp=Join-Path $taskRoot 'tmp'
New-Item -ItemType Directory -Path $taskTemp | Out-Null
$env:TEMP=$taskTemp;$env:TMP=$taskTemp;$env:RHINE_SOURCE_PREVIEW='0'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$taskExe=Join-Path $taskInstall 'Rhine Music Preview.exe'
$taskUninstaller=Join-Path $taskInstall 'Uninstall.exe'
$taskReport=[ordered]@{ok=$false;syntheticDataOnly=$true;realDevicesUsed=$false;checks=[ordered]@{};installerSha256=(Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash.ToLowerInvariant()}
$taskInstalled=$false
try{
  # NSIS requires /D to be the final argument and parses its full remaining path.
  $taskProcess=Start-Process -FilePath $taskInstaller -ArgumentList ('/S /D='+$taskInstall) -WindowStyle Hidden -PassThru -Wait
  if($taskProcess.ExitCode -ne 0){throw "Installer exit code: $($taskProcess.ExitCode)"}
  if(-not (Test-Path -LiteralPath $taskUninstaller)){throw 'Uninstall.exe was not generated'}
  $taskInstalled=$true
  foreach($taskPath in @($taskExe,(Join-Path $taskInstall 'presets/themes'),(Join-Path $taskInstall 'presets/eq'))){if(-not (Test-Path -LiteralPath $taskPath)){throw "Installed component missing: $taskPath"}}
  $taskEntry=Get-ItemProperty -LiteralPath $taskRegistry
  if($taskEntry.InstallLocation -ne $taskInstall){throw 'InstallLocation does not match the chosen directory'}
  if($taskEntry.UninstallString -ne ('"'+$taskUninstaller+'"')){throw 'UninstallString is not correctly quoted'}
  $taskReport.checks.customUnicodeDirectory=$true
  $taskReport.checks.installedExeUninstallerPresetDirectories=$true
  $taskReport.checks.currentUserRegistration=$true

  $taskGui=Start-Process -FilePath $taskExe -ArgumentList '--check-preview-ui' -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $taskRoot 'ui-stdout.log') -RedirectStandardError (Join-Path $taskRoot 'ui-stderr.log')
  if($taskGui.ExitCode -ne 0){throw "Installed synthetic GUI check failed: $($taskGui.ExitCode)"}
  $taskGuiFile=Join-Path $taskInstall 'data/logs/preview-ui-check.json'
  $taskGuiReport=Get-Content -LiteralPath $taskGuiFile -Raw | ConvertFrom-Json
  if(-not $taskGuiReport.ok -or $taskGuiReport.realAudioDevicesUsed -or $taskGuiReport.musicScanInvoked){throw 'Installed GUI isolation failed'}
  $taskReport.checks.installedSyntheticGui=$true
  $taskReport.checks.futureAndPunkDom=$taskGuiReport.checks.futureTheme -and $taskGuiReport.checks.punkTheme
  $taskReport.checks.noUncaughtJavascriptErrors=$taskGuiReport.checks.noUncaughtJavaScriptErrors
  $taskReport.checks.noPersonalLibraryOrDevices=$true

  $taskTheme=Join-Path $taskInstall 'presets/themes/theme-presets.json'
  $taskEq=Join-Path $taskInstall 'presets/eq/audio-processing-presets.json'
  if(-not (Test-Path -LiteralPath $taskTheme)){throw 'Theme preset file was not persisted under the installation'}
  [IO.File]::WriteAllText($taskEq,'{"schemaVersion":1,"activeId":null,"presets":[],"eqBanks":{}}',[Text.UTF8Encoding]::new($false))
  $taskDataProof=Join-Path $taskInstall 'data/config/acceptance-proof.txt'
  [IO.File]::WriteAllText($taskDataProof,'Synthetic acceptance fixture only',[Text.UTF8Encoding]::new($false))
  $taskForeign=Join-Path $taskInstall 'keep-me.txt'
  [IO.File]::WriteAllText($taskForeign,'Synthetic unknown file; uninstall must preserve it',[Text.UTF8Encoding]::new($false))
  $taskProofs=@($taskTheme,$taskEq,$taskDataProof,$taskForeign)
  $taskHashes=@{}
  foreach($taskPath in $taskProofs){$taskHashes[$taskPath]=(Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash}
  $taskReport.checks.separateThemeAndEqFiles=$true

  $taskRemoval=Start-Process -FilePath $taskUninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
  if($taskRemoval.ExitCode -ne 0){throw "Uninstaller exit code: $($taskRemoval.ExitCode)"}
  for($taskTry=0;$taskTry -lt 100 -and (Test-Path -LiteralPath $taskExe);$taskTry++){Start-Sleep -Milliseconds 100}
  if(Test-Path -LiteralPath $taskExe){throw 'Uninstall left the application executable'}
  if(Test-Path -LiteralPath $taskRegistry){throw 'Uninstall left the test registration'}
  foreach($taskPath in $taskProofs){if((Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash -ne $taskHashes[$taskPath]){throw "Uninstall changed retained data: $taskPath"}}
  $taskReport.checks.programRemoved=$true
  $taskReport.checks.registrationRemoved=$true
  $taskReport.checks.defaultRetainsDataAndPresets=$true
  $taskReport.checks.unknownFilePreserved=$true
  $taskReport.ok=$true
}catch{
  $taskReport.error=$_.Exception.Message
  throw
}finally{
  # On failure remove only this test installation, with normal default retention.
  if($taskInstalled -and (Test-Path -LiteralPath $taskExe) -and (Test-Path -LiteralPath $taskUninstaller)){
    $taskCleanup=Start-Process -FilePath $taskUninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    $taskReport.cleanupExitCode=$taskCleanup.ExitCode
  }
  [IO.File]::WriteAllText((Join-Path $taskRoot 'acceptance-report.json'),($taskReport | ConvertTo-Json -Depth 10)+"`n",[Text.UTF8Encoding]::new($false))
  Write-Output ($taskReport | ConvertTo-Json -Depth 10)
}
