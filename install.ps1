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
  Invoke-WebRequest "$base/$asset" -OutFile $binary
  Invoke-WebRequest "$base/$asset.sha256" -OutFile $checksum

  $expected = ((Get-Content $checksum -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 $binary).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw "Checksum verification failed." }

  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  $destination = Join-Path $installDir "chat-harness.exe"
  $stage = Join-Path $installDir (".chat-harness-install-" + [guid]::NewGuid().ToString() + ".exe")
  Copy-Item $binary $stage
  Move-Item $stage $destination -Force
  $stage = $null

  $metadata = Join-Path $installDir ".chat-harness-install.json"
  $metadataTemp = "$metadata.tmp." + [guid]::NewGuid().ToString()
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
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
  if ($metadataTemp) { Remove-Item -Force $metadataTemp -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}
