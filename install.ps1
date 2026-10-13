$ErrorActionPreference = "Stop"

$repo = "carlosboeing/chat-harness"
$version = if ($env:CHAT_HARNESS_VERSION) { $env:CHAT_HARNESS_VERSION } else { "latest" }
$installDir = if ($env:CHAT_HARNESS_INSTALL_DIR) { $env:CHAT_HARNESS_INSTALL_DIR } else { Join-Path $HOME ".local\bin" }

if (-not [Environment]::Is64BitOperatingSystem) { throw "Only 64-bit Windows is supported." }
$asset = "chat-harness-windows-x64.exe"

if ($version -eq "latest") {
  $base = "https://github.com/$repo/releases/latest/download"
} else {
  $tag = if ($version.StartsWith("v")) { $version } else { "v$version" }
  $base = "https://github.com/$repo/releases/download/$tag"
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("chat-harness-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tempDir | Out-Null
$stage = $null
$metadataTemp = $null
try {
  $binary = Join-Path $tempDir $asset
  $checksum = "$binary.sha256"
  Invoke-WebRequest -UseBasicParsing "$base/$asset" -OutFile $binary
  Invoke-WebRequest -UseBasicParsing "$base/$asset.sha256" -OutFile $checksum

  $expected = ((Get-Content $checksum -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 $binary).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw "Checksum verification failed." }

  $binaryVersion = (& $binary --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $binaryVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Downloaded executable version verification failed." }
  if ($version -ne "latest" -and $binaryVersion -ne $version.TrimStart("v")) { throw "Downloaded version does not match the requested release." }
  $nativeHelper = $null
  $nativeDigest = $null
  if ([int]($binaryVersion.Split('.')[0]) -ge 1) {
    $nativeAsset = "$asset.windows-safe-move.exe"
    $nativeHelper = Join-Path $tempDir $nativeAsset
    Invoke-WebRequest -UseBasicParsing "$base/$nativeAsset" -OutFile $nativeHelper
    Invoke-WebRequest -UseBasicParsing "$base/$nativeAsset.sha256" -OutFile "$nativeHelper.sha256"
    $nativeDigest = (Get-FileHash -Algorithm SHA256 $nativeHelper).Hash.ToLowerInvariant()
    $nativeChecksum = [System.IO.File]::ReadAllText("$nativeHelper.sha256")
    if ($nativeChecksum -ne "$nativeDigest  $nativeAsset`n") { throw "Native helper checksum verification failed." }
    $probe = (& $nativeHelper --probe | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $probe -ne "chat-harness-native-helper/1 win32-x64") { throw "Native helper protocol verification failed." }
  }

  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  $destination = Join-Path $installDir "chat-harness.exe"
  $stage = Join-Path $installDir (".chat-harness-install-" + [guid]::NewGuid().ToString() + ".exe")
  Copy-Item $binary $stage
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $moves = @(@{ Source=$stage; Target=$destination; BackedUp=$false; Installed=$false })
  if ($nativeHelper) {
    Copy-Item $nativeHelper "$stage.windows-safe-move.exe"
    [System.IO.File]::WriteAllText("$stage.windows-safe-move.exe.sha256", "$nativeDigest  chat-harness.exe.windows-safe-move.exe`n", $utf8NoBom)
    $moves += @{ Source="$stage.windows-safe-move.exe"; Target="$destination.windows-safe-move.exe"; BackedUp=$false; Installed=$false }
    $moves += @{ Source="$stage.windows-safe-move.exe.sha256"; Target="$destination.windows-safe-move.exe.sha256"; BackedUp=$false; Installed=$false }
  }
  try {
    foreach ($move in $moves) {
      $move.Backup = "$($move.Target).install-backup." + [guid]::NewGuid().ToString()
      if (Test-Path -LiteralPath $move.Target) { Move-Item -LiteralPath $move.Target -Destination $move.Backup; $move.BackedUp=$true }
      Move-Item -LiteralPath $move.Source -Destination $move.Target
      $move.Installed=$true
    }
  } catch {
    [array]::Reverse($moves)
    foreach ($move in $moves) {
      if ($move.Installed) { Remove-Item -LiteralPath $move.Target -Force }
      if ($move.BackedUp) { Move-Item -LiteralPath $move.Backup -Destination $move.Target }
    }
    throw
  }
  foreach ($move in $moves) { if ($move.BackedUp) { Remove-Item -LiteralPath $move.Backup -Force -ErrorAction SilentlyContinue } }
  $stage = $null

  $metadata = Join-Path $installDir ".chat-harness-install.json"
  $metadataTemp = "$metadata.tmp." + [guid]::NewGuid().ToString()
  [System.IO.File]::WriteAllText(
    $metadataTemp,
    '{"schema":1,"channel":"standalone"}' + [Environment]::NewLine,
    $utf8NoBom
  )
  Move-Item $metadataTemp $metadata -Force
  $metadataTemp = $null

  Write-Host "Installed chat-harness to $destination"
} finally {
  if ($stage) { Remove-Item -Force $stage -ErrorAction SilentlyContinue }
  if ($stage) { Remove-Item -Force "$stage.windows-safe-move.exe", "$stage.windows-safe-move.exe.sha256" -ErrorAction SilentlyContinue }
  if ($metadataTemp) { Remove-Item -Force $metadataTemp -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}
