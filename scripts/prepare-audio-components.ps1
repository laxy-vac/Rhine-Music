[CmdletBinding()]
param(
    [switch]$StageOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$audioRoot = Join-Path $projectRoot 'vendor/audio'
$lockPath = Join-Path $audioRoot 'open-components.json'
$toolsRoot = Join-Path $projectRoot '.tools'
$downloadsRoot = Join-Path $toolsRoot 'downloads'
$stagingRoot = Join-Path $toolsRoot 'dependency-staging'

function Get-HashBytes([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-HashFile([string]$Path) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Assert-RealDirectory([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "$Label must be a real directory: $Path"
    }
}

function Assert-RegularFile([string]$Path, [string]$Label) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "$Label must be a regular file: $Path"
    }
}

function Assert-SafeRelativePath([string]$Path, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Path) -or [IO.Path]::IsPathRooted($Path) -or $Path -match '^[A-Za-z]:') {
        throw "$Label is not a safe relative path: $Path"
    }
    $parts = $Path -split '[\\/]'
    if ($parts.Count -eq 0 -or $parts.Where({ $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }).Count -gt 0) {
        throw "$Label contains an unsafe path segment: $Path"
    }
}

function Get-SafeChildPath([string]$Root, [string]$RelativePath, [string]$Label) {
    Assert-SafeRelativePath $RelativePath $Label
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $fullPath = [IO.Path]::GetFullPath((Join-Path $fullRoot $RelativePath))
    $prefix = $fullRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label escapes its authorized directory: $RelativePath"
    }
    return $fullPath
}

function Ensure-ParentDirectory([string]$Root, [string]$FilePath, [string]$Label) {
    $parent = Split-Path -Parent $FilePath
    $relative = $parent.Substring($Root.TrimEnd('\').Length).TrimStart('\')
    if ([string]::IsNullOrEmpty($relative)) {
        Assert-RealDirectory $Root $Label
        return
    }
    $current = $Root.TrimEnd('\')
    foreach ($part in ($relative -split '[\\/]')) {
        $current = Join-Path $current $part
        Assert-RealDirectory $current $Label
    }
}

function Write-NewFile([string]$Path, [byte[]]$Bytes, [string]$Label) {
    $stream = $null
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Write($Bytes, 0, $Bytes.Length)
    } catch [IO.IOException] {
        throw "Refusing to overwrite an existing or unknown file for $Label`: $Path"
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Get-ArchiveEntryBytes([IO.Compression.ZipArchive]$Archive, [string]$EntryName, [string]$Label) {
    $matches = @($Archive.Entries | Where-Object { $_.FullName -ceq $EntryName })
    if ($matches.Count -ne 1 -or $matches[0].FullName.EndsWith('/')) {
        throw "Expected exactly one regular archive entry for $Label`: $EntryName"
    }
    $entryStream = $matches[0].Open()
    $memory = [IO.MemoryStream]::new()
    try {
        $entryStream.CopyTo($memory)
        return ,$memory.ToArray()
    } finally {
        $memory.Dispose()
        $entryStream.Dispose()
    }
}

function Assert-ArchivePathsSafe([IO.Compression.ZipArchive]$Archive, [string]$ComponentName) {
    foreach ($entry in $Archive.Entries) {
        $entryName = $entry.FullName.TrimEnd('/')
        if ($entryName.Length -gt 0) {
            Assert-SafeRelativePath $entryName "${ComponentName} archive entry"
        }
    }
}

function Get-TreeRelativeFiles([string]$Root) {
    if (-not (Test-Path -LiteralPath $Root)) { return @() }
    $rootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $result = @()
    foreach ($item in Get-ChildItem -LiteralPath $Root -Recurse -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing a reparse point in owned tree: $($item.FullName)"
        }
        if (-not $item.PSIsContainer) {
            $result += $item.FullName.Substring($rootPrefix.Length).Replace('\', '/')
        }
    }
    return $result
}

function Assert-OnlyExpectedFiles([string]$Root, [string[]]$Expected, [string]$Label) {
    $expectedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in $Expected) { [void]$expectedSet.Add($path.Replace('\', '/')) }
    foreach ($actual in (Get-TreeRelativeFiles $Root)) {
        if (-not $expectedSet.Contains($actual)) {
            throw "Refusing unknown file in $Label`: $actual"
        }
    }
}

function Read-Manifest([string]$Path) {
    try {
        $raw = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
        return [pscustomobject]@{ Raw = $raw; Value = ($raw | ConvertFrom-Json) }
    } catch {
        throw "Component lock is unreadable or invalid JSON: $Path ($($_.Exception.Message))"
    }
}

function Save-ManifestIfChanged([string]$Path, [string]$OriginalHash, $Manifest) {
    $currentHash = Get-HashFile $Path
    if ($currentHash -ne $OriginalHash) {
        throw 'The component lock changed while preparation was running; refusing to replace it.'
    }
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    $backup = "$Path.$([Guid]::NewGuid().ToString('N')).backup"
    $encoding = [Text.UTF8Encoding]::new($false)
    try {
        [IO.File]::WriteAllText($temporary, (($Manifest | ConvertTo-Json -Depth 32) + "`n"), $encoding)
        [IO.File]::Replace($temporary, $Path, $backup)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    }
}

Assert-RealDirectory $projectRoot 'Project root'
Assert-RealDirectory $audioRoot 'Audio vendor root'
Assert-RealDirectory $toolsRoot 'Project tools directory'
Assert-RealDirectory $downloadsRoot 'Component downloads directory'
Assert-RealDirectory $stagingRoot 'Dependency staging directory'
Assert-RegularFile $lockPath 'Component lock'

$manifestState = Read-Manifest $lockPath
$manifestHashAtStart = Get-HashFile $lockPath
$manifest = $manifestState.Value
if ($manifest.schemaVersion -ne 1 -or @($manifest.components).Count -lt 1) {
    throw 'The component lock has an unsupported structure.'
}

foreach ($component in $manifest.components) {
    $componentName = [string]$component.name
    if ($componentName -notin @('iir1', 'r8brain-free-src')) {
        throw "Unsupported component in lock: $componentName"
    }
    $vendorDirectory = [string]$component.vendorDirectory
    if ($vendorDirectory -notin @('iir1', 'r8brain')) {
        throw "Unsupported vendor destination for $componentName`: $vendorDirectory"
    }
    if ($component.commit -notmatch '^[a-f0-9]{40}$' -or $component.archive.sha256 -notmatch '^[a-f0-9]{64}$') {
        throw "The commit or archive checksum is invalid for $componentName."
    }
    $repository = [string]$component.repository
    $expectedUrl = ($repository -replace '^https://github\.com/', 'https://codeload.github.com/') + "/zip/$($component.commit)"
    if ($component.archive.url -cne $expectedUrl -or -not $component.archive.file -or [IO.Path]::GetFileName($component.archive.file) -cne $component.archive.file) {
        throw "The source archive URL or filename is not pinned to the official repository commit for $componentName."
    }
    if ([string]$component.license -cne 'MIT') {
        throw "Unexpected license for ${componentName}: $($component.license)"
    }

    $archivePath = Get-SafeChildPath $downloadsRoot ([string]$component.archive.file) "$componentName archive"
    if (Test-Path -LiteralPath $archivePath) {
        Assert-RegularFile $archivePath "$componentName source archive"
        if ((Get-HashFile $archivePath) -ne ([string]$component.archive.sha256).ToLowerInvariant()) {
            throw "The existing $componentName source archive has an unexpected SHA-256; it was left untouched."
        }
    } else {
        $partialPath = "$archivePath.partial.$([Guid]::NewGuid().ToString('N'))"
        try {
            [void](Invoke-WebRequest -Uri $component.archive.url -OutFile $partialPath -MaximumRedirection 5)
            Assert-RegularFile $partialPath "$componentName downloaded archive"
            if ((Get-HashFile $partialPath) -ne ([string]$component.archive.sha256).ToLowerInvariant()) {
                throw "Downloaded $componentName archive SHA-256 does not match the component lock."
            }
            Move-Item -LiteralPath $partialPath -Destination $archivePath
        } finally {
            if (Test-Path -LiteralPath $partialPath) { Remove-Item -LiteralPath $partialPath -Force }
        }
    }

    $stageRoot = Join-Path $stagingRoot "$componentName-$($component.commit)"
    Assert-RealDirectory $stageRoot "$componentName staging directory"
    $markerPath = Join-Path $stageRoot '.rhine-audio-stage.json'
    $marker = [ordered]@{
        kind = 'rhine-audio-component-stage'
        name = $componentName
        commit = [string]$component.commit
        archiveSha256 = ([string]$component.archive.sha256).ToLowerInvariant()
    }
    $markerJson = ($marker | ConvertTo-Json -Compress)
    if (Test-Path -LiteralPath $markerPath) {
        Assert-RegularFile $markerPath "$componentName staging marker"
        if ([IO.File]::ReadAllText($markerPath, [Text.Encoding]::UTF8).Trim() -cne $markerJson) {
            throw "Refusing to reuse an unfamiliar $componentName staging directory."
        }
    } else {
        Write-NewFile $markerPath ([Text.Encoding]::UTF8.GetBytes($markerJson + "`n")) "$componentName staging marker"
    }

    $expectedStageFiles = @('.rhine-audio-stage.json') + @($component.files | ForEach-Object { [string]$_.path })
    Assert-OnlyExpectedFiles $stageRoot $expectedStageFiles "$componentName staging directory"
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        Assert-ArchivePathsSafe $archive $componentName
        $archiveRoot = "$componentName-$($component.commit)/"
        foreach ($file in $component.files) {
            $sourceRelative = [string]$file.source
            $destinationRelative = [string]$file.path
            Assert-SafeRelativePath $sourceRelative "$componentName source path"
            Assert-SafeRelativePath $destinationRelative "$componentName destination path"
            $entryName = $archiveRoot + $sourceRelative
            $bytes = Get-ArchiveEntryBytes $archive $entryName $componentName
            $actualHash = Get-HashBytes $bytes
            $lockedHash = ([string]$file.sha256).ToLowerInvariant()
            if ($lockedHash -and $lockedHash -notmatch '^[a-f0-9]{64}$') {
                throw "Invalid source file SHA-256 in lock: $componentName/$destinationRelative"
            }
            if ($lockedHash -and $actualHash -ne $lockedHash) {
                throw "Source file hash mismatch in the pinned $componentName archive: $sourceRelative"
            }
            if (-not $lockedHash -and -not $StageOnly) {
                throw "Missing per-file hashes for $componentName; run with -StageOnly to derive them from the verified pinned archive."
            }
            if (-not $lockedHash -and $StageOnly) {
                $file.sha256 = $actualHash
            }

            $stageFile = Get-SafeChildPath $stageRoot $destinationRelative "$componentName staged file"
            Ensure-ParentDirectory $stageRoot $stageFile "$componentName staging parent"
            if (Test-Path -LiteralPath $stageFile) {
                Assert-RegularFile $stageFile "$componentName staged file"
                if ((Get-HashFile $stageFile) -ne $actualHash) {
                    throw "Refusing to overwrite unknown staged contents: $stageFile"
                }
            } else {
                Write-NewFile $stageFile $bytes "$componentName staged file"
            }
            Write-Output ("{0}/{1} sha256={2}" -f $componentName, $destinationRelative, $actualHash)
        }
    } finally {
        $archive.Dispose()
    }

    if (-not $StageOnly) {
        $vendorRoot = Join-Path $audioRoot $vendorDirectory
        Assert-RealDirectory $vendorRoot "$componentName vendor directory"
        $expectedVendorFiles = @($component.files | ForEach-Object { [string]$_.path })
        Assert-OnlyExpectedFiles $vendorRoot $expectedVendorFiles "$componentName vendor directory"
        foreach ($file in $component.files) {
            $relative = [string]$file.path
            $expectedHash = ([string]$file.sha256).ToLowerInvariant()
            if ($expectedHash -notmatch '^[a-f0-9]{64}$') {
                throw "Missing locked file hash for $componentName/$relative"
            }
            $sourcePath = Get-SafeChildPath $stageRoot $relative "$componentName staged source"
            $destinationPath = Get-SafeChildPath $vendorRoot $relative "$componentName vendor file"
            if ((Get-HashFile $sourcePath) -ne $expectedHash) {
                throw "Staged file hash mismatch for $componentName/$relative"
            }
            Ensure-ParentDirectory $vendorRoot $destinationPath "$componentName vendor parent"
            if (Test-Path -LiteralPath $destinationPath) {
                Assert-RegularFile $destinationPath "$componentName vendor file"
                if ((Get-HashFile $destinationPath) -ne $expectedHash) {
                    throw "Refusing to overwrite unknown vendor contents: $destinationPath"
                }
            } else {
                $bytes = [IO.File]::ReadAllBytes($sourcePath)
                Write-NewFile $destinationPath $bytes "$componentName vendor file"
            }
        }
        Write-Output "Prepared verified $componentName source in $vendorRoot"
    }
}

if ($StageOnly) {
    Save-ManifestIfChanged $lockPath $manifestHashAtStart $manifest
    Write-Output 'Verified and staged pinned component sources. Per-file SHA-256 values were written to open-components.json; vendor files were not copied.'
} else {
    Write-Output 'All pinned audio component files passed archive, license, tree, and SHA-256 checks.'
}
