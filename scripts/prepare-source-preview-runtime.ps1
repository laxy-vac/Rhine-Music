[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-NormalizedAbsolutePath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.Length -gt $pathRoot.Length) {
        $fullPath = $fullPath.TrimEnd([char[]]@('\', '/'))
    }
    return $fullPath
}

function Assert-PathEquals {
    param(
        [Parameter(Mandatory = $true)][string]$ActualPath,
        [Parameter(Mandatory = $true)][string]$ExpectedPath,
        [Parameter(Mandatory = $true)][string]$Description
    )

    $actual = ConvertTo-NormalizedAbsolutePath -Path $ActualPath
    $expected = ConvertTo-NormalizedAbsolutePath -Path $ExpectedPath
    if (-not [System.String]::Equals($actual, $expected, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Description resolved to '$actual'; expected exactly '$expected'. Refusing to continue."
    }
}

function Assert-NotReparsePoint {
    param(
        [Parameter(Mandatory = $true)]$Item,
        [Parameter(Mandatory = $true)][string]$Description
    )

    if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Description is a reparse point. Refusing to follow it: '$($Item.FullName)'."
    }
}

function Assert-ExistingDirectoryAtPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedPath,
        [Parameter(Mandatory = $true)][string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Description directory does not exist: '$Path'."
    }
    $item = Get-Item -LiteralPath $Path -Force
    Assert-NotReparsePoint -Item $item -Description $Description
    $resolved = (Resolve-Path -LiteralPath $Path).ProviderPath
    Assert-PathEquals -ActualPath $resolved -ExpectedPath $ExpectedPath -Description $Description
}

function Test-IsExcludedPackagedAppPath {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $normalized = $RelativePath -replace '/', '\'
    $excludedRoots = @(
        'resources\app',
        'resources\app.asar',
        'resources\app.asar.unpacked'
    )
    foreach ($excludedRoot in $excludedRoots) {
        if ([System.String]::Equals($normalized, $excludedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
            $normalized.StartsWith($excludedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Add-TreeEntries {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string]$CurrentPath,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$RelativeParent,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Entries,
        [switch]$ExcludePackagedApp,
        [switch]$ExcludeStagingInstructions,
        [switch]$ExcludeManifest
    )

    foreach ($item in Get-ChildItem -LiteralPath $CurrentPath -Force) {
        if ($RelativeParent.Length -eq 0) {
            $relativePath = $item.Name
        }
        else {
            $relativePath = $RelativeParent + '\' + $item.Name
        }

        if ($ExcludePackagedApp -and (Test-IsExcludedPackagedAppPath -RelativePath $relativePath)) {
            continue
        }
        if ($ExcludeStagingInstructions -and $RelativeParent.Length -eq 0 -and
            [System.String]::Equals($item.Name, '使用说明-Windows.txt', [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }

        Assert-NotReparsePoint -Item $item -Description 'Runtime entry'

        $isDirectory = [bool]$item.PSIsContainer
        if ($ExcludeManifest -and -not $isDirectory -and $RelativeParent.Length -eq 0 -and
            [System.String]::Equals($item.Name, 'source-preview-runtime.manifest.json', [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }

        $length = [long]0
        if (-not $isDirectory) {
            $length = [long]$item.Length
        }
        $Entries.Add([PSCustomObject]@{
            FullName     = $item.FullName
            RelativePath = $relativePath
            IsDirectory  = $isDirectory
            Length       = $length
        })

        if ($isDirectory) {
            Add-TreeEntries -RootPath $RootPath -CurrentPath $item.FullName -RelativeParent $relativePath -Entries $Entries `
                -ExcludePackagedApp:$ExcludePackagedApp -ExcludeStagingInstructions:$ExcludeStagingInstructions -ExcludeManifest:$ExcludeManifest
        }
    }
}

function Get-TreeEntries {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [switch]$ExcludePackagedApp,
        [switch]$ExcludeStagingInstructions,
        [switch]$ExcludeManifest
    )

    $entries = New-Object 'System.Collections.Generic.List[object]'
    Add-TreeEntries -RootPath $RootPath -CurrentPath $RootPath -RelativeParent '' -Entries $entries `
        -ExcludePackagedApp:$ExcludePackagedApp -ExcludeStagingInstructions:$ExcludeStagingInstructions -ExcludeManifest:$ExcludeManifest
    return $entries.ToArray()
}

function Get-ManifestField {
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = $Manifest.PSObject.Properties[$Name]
    if ($null -eq $property) {
        throw "Runtime manifest is missing required field '$Name'."
    }
    return $property.Value
}

function Get-FileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-TreeInventoryMatches {
    param(
        [Parameter(Mandatory = $true)][object[]]$ExpectedEntries,
        [Parameter(Mandatory = $true)][object[]]$ActualEntries,
        [Parameter(Mandatory = $true)][string]$Context
    )

    $expectedFiles = @($ExpectedEntries | Where-Object { -not $_.IsDirectory } | ForEach-Object { "{0}`t{1}" -f $_.RelativePath, $_.Length } | Sort-Object)
    $actualFiles = @($ActualEntries | Where-Object { -not $_.IsDirectory } | ForEach-Object { "{0}`t{1}" -f $_.RelativePath, $_.Length } | Sort-Object)
    $expectedDirectories = @($ExpectedEntries | Where-Object { $_.IsDirectory } | ForEach-Object { $_.RelativePath } | Sort-Object)
    $actualDirectories = @($ActualEntries | Where-Object { $_.IsDirectory } | ForEach-Object { $_.RelativePath } | Sort-Object)

    if (Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $actualFiles) {
        throw "$Context file inventory differs from the source runtime. No files were replaced; inspect the target manually."
    }
    if (Compare-Object -ReferenceObject $expectedDirectories -DifferenceObject $actualDirectories) {
        throw "$Context directory inventory differs from the source runtime. No files were replaced; inspect the target manually."
    }
}

function Assert-ManifestValueEquals {
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)]$ExpectedValue
    )

    $actualValue = Get-ManifestField -Manifest $Manifest -Name $Name
    if ($actualValue -ne $ExpectedValue) {
        throw "Runtime manifest field '$Name' does not match the current source or target. Refusing to overwrite the existing target."
    }
}

# Anchor all paths to the project that contains this script. ProjectRoot is
# accepted for callers that want to pass it explicitly, but cannot redirect
# this script to another project.
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "ProjectRoot must name the project directory containing this script: '$ProjectRoot'."
}
$projectRootResolved = (Resolve-Path -LiteralPath $ProjectRoot).ProviderPath
$scriptDirectoryResolved = (Resolve-Path -LiteralPath $PSScriptRoot).ProviderPath
$projectRootItem = Get-Item -LiteralPath $projectRootResolved -Force
$scriptDirectoryItem = Get-Item -LiteralPath $scriptDirectoryResolved -Force
Assert-NotReparsePoint -Item $projectRootItem -Description 'ProjectRoot'
Assert-NotReparsePoint -Item $scriptDirectoryItem -Description 'Script directory'
$expectedProjectRoot = ConvertTo-NormalizedAbsolutePath -Path (Split-Path -Parent $scriptDirectoryResolved)
Assert-PathEquals -ActualPath $projectRootResolved -ExpectedPath $expectedProjectRoot -Description 'ProjectRoot'
$projectRootResolved = ConvertTo-NormalizedAbsolutePath -Path $projectRootResolved

$releasePath = Join-Path $projectRootResolved 'release'
$expectedReleasePath = ConvertTo-NormalizedAbsolutePath -Path $releasePath
Assert-ExistingDirectoryAtPath -Path $releasePath -ExpectedPath $expectedReleasePath -Description 'Runtime source parent'

$sourceRoot = Join-Path $releasePath '.desktop-staging'
$expectedSourceRoot = ConvertTo-NormalizedAbsolutePath -Path $sourceRoot
Assert-ExistingDirectoryAtPath -Path $sourceRoot -ExpectedPath $expectedSourceRoot -Description 'Runtime source'
$sourceRoot = (Resolve-Path -LiteralPath $sourceRoot).ProviderPath

$toolsRoot = Join-Path $projectRootResolved '.tools'
$expectedToolsRoot = ConvertTo-NormalizedAbsolutePath -Path $toolsRoot
$targetRoot = Join-Path $toolsRoot 'source-preview-electron'
$expectedTargetRoot = ConvertTo-NormalizedAbsolutePath -Path $targetRoot
Assert-PathEquals -ActualPath $sourceRoot -ExpectedPath $expectedSourceRoot -Description 'Runtime source'
Assert-PathEquals -ActualPath $targetRoot -ExpectedPath $expectedTargetRoot -Description 'Runtime target'

$toolsItem = Get-Item -LiteralPath $toolsRoot -Force -ErrorAction SilentlyContinue
if ($null -ne $toolsItem) {
    if (-not $toolsItem.PSIsContainer) {
        throw "The project tools path exists as a non-directory: '$toolsRoot'."
    }
    Assert-NotReparsePoint -Item $toolsItem -Description 'Project tools directory'
    $resolvedToolsRoot = (Resolve-Path -LiteralPath $toolsRoot).ProviderPath
    Assert-PathEquals -ActualPath $resolvedToolsRoot -ExpectedPath $expectedToolsRoot -Description 'Project tools directory'
}

foreach ($requiredRelativePath in @('electron.exe', 'resources\default_app.asar')) {
    $requiredPath = Join-Path $sourceRoot $requiredRelativePath
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required runtime file is missing: '$requiredPath'."
    }
    $requiredItem = Get-Item -LiteralPath $requiredPath -Force
    Assert-NotReparsePoint -Item $requiredItem -Description 'Required runtime file'
}

$sourceEntries = @(Get-TreeEntries -RootPath $sourceRoot -ExcludePackagedApp -ExcludeStagingInstructions)
$sourceFiles = @($sourceEntries | Where-Object { -not $_.IsDirectory })
$sourceDirectories = @($sourceEntries | Where-Object { $_.IsDirectory })
$runtimeTotalBytes = [long]0
foreach ($sourceFile in $sourceFiles) {
    $runtimeTotalBytes += [long]$sourceFile.Length
}

$sourceElectronPath = Join-Path $sourceRoot 'electron.exe'
$sourceDefaultAppPath = Join-Path $sourceRoot 'resources\default_app.asar'
$sourceElectronSha256 = Get-FileSha256 -Path $sourceElectronPath
$sourceDefaultAppSha256 = Get-FileSha256 -Path $sourceDefaultAppPath
$sourceLocation = 'release/.desktop-staging'
$targetLocation = '.tools/source-preview-electron'
$manifestLeaf = 'source-preview-runtime.manifest.json'
$manifestPath = Join-Path $targetRoot $manifestLeaf

# Existing targets are verification-only. In particular, never repair them by
# replacing files or removing stale Electron app payloads.
$targetItem = Get-Item -LiteralPath $targetRoot -Force -ErrorAction SilentlyContinue
if ($null -ne $targetItem) {
    if (-not $targetItem.PSIsContainer) {
        throw "The runtime target exists as a non-directory: '$targetRoot'. Refusing to replace it."
    }
    Assert-NotReparsePoint -Item $targetItem -Description 'Runtime target'
    $targetResolved = (Resolve-Path -LiteralPath $targetRoot).ProviderPath
    Assert-PathEquals -ActualPath $targetResolved -ExpectedPath $expectedTargetRoot -Description 'Runtime target'

    foreach ($packagedAppRelativePath in @('resources\app', 'resources\app.asar', 'resources\app.asar.unpacked')) {
        $packagedAppPath = Join-Path $targetRoot $packagedAppRelativePath
        if (Test-Path -LiteralPath $packagedAppPath) {
            throw "The existing target contains '$packagedAppRelativePath', which can make Electron ignore the source CLI app. Remove or move it manually, then rerun this script."
        }
    }

    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "The existing target has no valid '$manifestLeaf'. It may be incomplete or from another source; inspect it and handle it manually."
    }
    $manifestItem = Get-Item -LiteralPath $manifestPath -Force
    Assert-NotReparsePoint -Item $manifestItem -Description 'Runtime manifest'

    try {
        $existingManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "The existing runtime manifest cannot be read as JSON. Inspect the target manually: '$manifestPath'."
    }
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'schemaVersion' -ExpectedValue 1
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'sourceLocation' -ExpectedValue $sourceLocation
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'targetLocation' -ExpectedValue $targetLocation
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'sourceElectronSha256' -ExpectedValue $sourceElectronSha256
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'sourceDefaultAppSha256' -ExpectedValue $sourceDefaultAppSha256

    $targetElectronPath = Join-Path $targetRoot 'electron.exe'
    $targetDefaultAppPath = Join-Path $targetRoot 'resources\default_app.asar'
    if (-not (Test-Path -LiteralPath $targetElectronPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $targetDefaultAppPath -PathType Leaf)) {
        throw 'The existing target is missing electron.exe or resources\default_app.asar. Inspect the target manually.'
    }
    $targetElectronSha256 = Get-FileSha256 -Path $targetElectronPath
    $targetDefaultAppSha256 = Get-FileSha256 -Path $targetDefaultAppPath
    if ($targetElectronSha256 -ne $sourceElectronSha256 -or $targetDefaultAppSha256 -ne $sourceDefaultAppSha256) {
        throw 'The existing target electron.exe or default_app.asar differs from the source. Inspect the target manually; it was not changed.'
    }
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'targetElectronSha256' -ExpectedValue $targetElectronSha256
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'targetDefaultAppSha256' -ExpectedValue $targetDefaultAppSha256

    $targetEntries = @(Get-TreeEntries -RootPath $targetRoot -ExcludeManifest)
    Assert-TreeInventoryMatches -ExpectedEntries $sourceEntries -ActualEntries $targetEntries -Context 'Existing target'
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'runtimeFileCount' -ExpectedValue $sourceFiles.Count
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'runtimeDirectoryCount' -ExpectedValue $sourceDirectories.Count
    Assert-ManifestValueEquals -Manifest $existingManifest -Name 'runtimeTotalBytes' -ExpectedValue $runtimeTotalBytes

    Write-Output "Existing source-preview runtime is complete and matches '$sourceLocation'; reused '$targetLocation'."
    Write-Output ("Runtime files: {0}; directories: {1}; bytes: {2}" -f $sourceFiles.Count, $sourceDirectories.Count, $runtimeTotalBytes)
    return
}

# The only writes are inside the exact project-local target. Do not follow a
# pre-existing .tools link/junction and do not overwrite any target content.
if ($null -eq $toolsItem) {
    if ($null -ne (Get-Item -LiteralPath $toolsRoot -Force -ErrorAction SilentlyContinue)) {
        throw "The project tools path appeared after validation: '$toolsRoot'. Refusing to follow or alter it."
    }
    New-Item -ItemType Directory -Path $toolsRoot -ErrorAction Stop | Out-Null
    Assert-ExistingDirectoryAtPath -Path $toolsRoot -ExpectedPath $expectedToolsRoot -Description 'Project tools directory'
}

if (Test-Path -LiteralPath $targetRoot) {
    throw "The target appeared after validation: '$targetRoot'. Refusing to overwrite it."
}
New-Item -ItemType Directory -Path $targetRoot -ErrorAction Stop | Out-Null
Assert-ExistingDirectoryAtPath -Path $targetRoot -ExpectedPath $expectedTargetRoot -Description 'Runtime target'

$directoriesToCreate = @($sourceEntries | Where-Object { $_.IsDirectory } | Sort-Object @{ Expression = { ($_.RelativePath -split '\\').Length } }, RelativePath)
foreach ($directoryEntry in $directoriesToCreate) {
    $destinationDirectory = Join-Path $targetRoot $directoryEntry.RelativePath
    if (-not (Test-Path -LiteralPath $destinationDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $destinationDirectory -ErrorAction Stop | Out-Null
    }
}

foreach ($fileEntry in $sourceFiles) {
    $destinationFile = Join-Path $targetRoot $fileEntry.RelativePath
    if (Test-Path -LiteralPath $destinationFile) {
        throw "Unexpected destination already exists: '$destinationFile'. Refusing to overwrite it."
    }
    Copy-Item -LiteralPath $fileEntry.FullName -Destination $destinationFile -ErrorAction Stop
}

foreach ($packagedAppRelativePath in @('resources\app', 'resources\app.asar', 'resources\app.asar.unpacked')) {
    $packagedAppPath = Join-Path $targetRoot $packagedAppRelativePath
    if (Test-Path -LiteralPath $packagedAppPath) {
        throw "The target unexpectedly contains '$packagedAppRelativePath'. Inspect the target manually."
    }
}

$targetEntries = @(Get-TreeEntries -RootPath $targetRoot)
Assert-TreeInventoryMatches -ExpectedEntries $sourceEntries -ActualEntries $targetEntries -Context 'New target'

$sourceElectronSha256AfterCopy = Get-FileSha256 -Path $sourceElectronPath
$sourceDefaultAppSha256AfterCopy = Get-FileSha256 -Path $sourceDefaultAppPath
$targetElectronPath = Join-Path $targetRoot 'electron.exe'
$targetDefaultAppPath = Join-Path $targetRoot 'resources\default_app.asar'
$targetElectronSha256 = Get-FileSha256 -Path $targetElectronPath
$targetDefaultAppSha256 = Get-FileSha256 -Path $targetDefaultAppPath
if ($sourceElectronSha256AfterCopy -ne $sourceElectronSha256 -or $targetElectronSha256 -ne $sourceElectronSha256) {
    throw 'electron.exe changed during preparation or failed SHA-256 verification. The target was left for manual inspection.'
}
if ($sourceDefaultAppSha256AfterCopy -ne $sourceDefaultAppSha256 -or $targetDefaultAppSha256 -ne $sourceDefaultAppSha256) {
    throw 'resources\default_app.asar changed during preparation or failed SHA-256 verification. The target was left for manual inspection.'
}

$manifest = [ordered]@{
    schemaVersion            = 1
    sourceLocation           = $sourceLocation
    targetLocation           = $targetLocation
    sourceElectronSha256     = $sourceElectronSha256
    sourceDefaultAppSha256   = $sourceDefaultAppSha256
    targetElectronSha256     = $targetElectronSha256
    targetDefaultAppSha256   = $targetDefaultAppSha256
    runtimeFileCount         = $sourceFiles.Count
    runtimeDirectoryCount    = $sourceDirectories.Count
    runtimeTotalBytes        = $runtimeTotalBytes
    preparedAtUtc            = [System.DateTime]::UtcNow.ToString('o')
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($manifestPath, $manifestJson + [System.Environment]::NewLine, $utf8NoBom)

Write-Output "Prepared a clean source-preview Electron runtime at '$targetLocation'."
Write-Output ("Runtime files: {0}; directories: {1}; bytes: {2}" -f $sourceFiles.Count, $sourceDirectories.Count, $runtimeTotalBytes)
