# Installs this repository's layout or mods into your Herdr home (Windows; macOS and Linux:
# install/install.sh). The same installer can serve other repositories: only the $Repo line
# differs, and what it installs is in install/manifest.
#
#   irm https://raw.githubusercontent.com/<Repo>/main/install/install.ps1 | iex
#   $env:HERDR_YES = 1; irm .../install/install.ps1 | iex          no questions
#   $env:HERDR_UNINSTALL = 1; irm .../install/install.ps1 | iex    remove it again
#   .\install\install.ps1 [-Yes] [-Home <dir>] [-Uninstall]        from a clone
#
# It follows Herdr's own rules for shared layouts and mods: say what they reach, copy them in,
# merge keys.json asking before it replaces a key you use, `herdr-app check` every mod. Anything
# it replaces is backed up first under <home>\community\<repo>\backup-<time>\; uninstalling
# removes only what it added (and keys you haven't changed since). Windows PowerShell 5.1 or 7.
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 writes an array that passed through an object as {"value":[...],"Count":n} without this.
if ($PSVersionTable.PSVersion.Major -lt 6) { Remove-TypeData System.Array -ErrorAction SilentlyContinue }
$Repo = 'miguelalexanderdiaz/herdr-session-restore'
$Branch = if ($env:HERDR_INSTALL_BRANCH) { $env:HERDR_INSTALL_BRANCH } else { 'main' }

$Yes = [bool]$env:HERDR_YES; $Uninstall = [bool]$env:HERDR_UNINSTALL; $H = $env:HERDR_APP_HOME
for ($i = 0; $i -lt $args.Count; $i++) {
  switch -regex ($args[$i]) {
    '^-(y|yes)$' { $Yes = $true }
    '^-uninstall$' { $Uninstall = $true }
    '^-home$' { $i++; $H = $args[$i] }
    default { throw "Unknown option: $($args[$i])" }
  }
}

function Say($text) { Write-Host $text }
function Ask($question) {
  if ($Yes) { return $true }
  try { $reply = Read-Host "$question [y/N]" } catch { return $false }
  return $reply -match '^(y|yes)$'
}
$Utf8 = New-Object System.Text.UTF8Encoding $false
function Read-Json($path) { [IO.File]::ReadAllText($path) | ConvertFrom-Json }
function Write-Json($path, $value) { [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $value -Depth 100) + "`n", $Utf8) }

# ---- the files: this clone, or the repository's branch downloaded ----------------------
$Tmp = $null
$Src = $null
if ($PSCommandPath -and (Test-Path (Join-Path (Split-Path $PSCommandPath) 'manifest'))) { $Src = Split-Path (Split-Path $PSCommandPath) }
try {
if (-not $Src) {
  $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("herdr-install-" + [guid]::NewGuid())
  New-Item -ItemType Directory $Tmp | Out-Null
  $zip = Join-Path $Tmp 'repo.zip'
  # HERDR_INSTALL_URL: another zip of the repository (tests use a local file).
  $url = if ($env:HERDR_INSTALL_URL) { $env:HERDR_INSTALL_URL } else { "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" }
  Say "Downloading $Repo ($Branch)..."
  if (Test-Path $url) { Copy-Item $url $zip } else { Invoke-WebRequest -UseBasicParsing $url -OutFile $zip }
  Expand-Archive $zip -DestinationPath (Join-Path $Tmp 'x')
  $Src = (Get-ChildItem (Join-Path $Tmp 'x') -Directory | Select-Object -First 1).FullName
  if (-not (Test-Path (Join-Path $Src 'install\manifest'))) { throw 'the download has no install/manifest' }
}
$Manifest = Get-Content (Join-Path $Src 'install\manifest')
function Field($word) {
  $line = $Manifest | Where-Object { $_ -match "^$word\s+" } | Select-Object -First 1
  if ($line) { ($line -replace "^$word\s+", '').Trim() } else { '' }
}
function Words($word) { @((Field $word) -split '\s+' | Where-Object { $_ }) }
$Name = Field 'name'; $Mods = Words 'mods'; $Bundled = Words 'bundled'; $Layouts = Words 'layouts'
$SwitchTo = Field 'switch'; $Keys = Field 'keys'; $Panel = Words 'panel'
$Slug = $Repo.Split('/')[1]
$HerdrApp = Get-Command herdr-app -ErrorAction SilentlyContinue

# ---- the Herdr home ------------------------------------------------------------------
if (-not $H -and $HerdrApp) {
  $line = (& herdr-app --help 2>$null) | Where-Object { $_ -match '^Home: ' } | Select-Object -First 1
  if ($line) { $H = ($line -replace '^Home: (\S+).*', '$1') -replace '^~', $HOME }
}
if (-not $H) { $H = Join-Path $HOME '.config\herdr-app' }
if (-not (Test-Path $H -PathType Container)) { throw "no Herdr home at ${H}: open Herdr once, or pass -Home <folder>" }
$State = Join-Path $H "community\$Slug"
$List = Join-Path $State 'installed.txt'
New-Item -ItemType Directory -Force $State | Out-Null
$Backup = Join-Path $State ("backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
function Backup($rel) {
  $from = Join-Path $H $rel
  if (-not (Test-Path $from)) { return }
  $to = Join-Path $Backup $rel
  New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
  Copy-Item -Recurse -Force $from $to
}
function Recorded($line) { (Test-Path $List) -and ((Get-Content $List) -contains $line) }
function Record($line) { if (-not (Recorded $line)) { Add-Content -Encoding UTF8 $List $line } }
function Running { if (-not $HerdrApp) { return $false }; $env:HERDR_APP_HOME = $H; & herdr-app status *> $null; return $LASTEXITCODE -eq 0 }
function Find-Node($node, $id) {
  if ($null -eq $node) { return $null }
  if ($node.id -eq $id) { return $node }
  foreach ($c in @($node.children)) { $f = Find-Node $c $id; if ($f) { return $f } }
  return $null
}

# ---- uninstall -------------------------------------------------------------------------
if ($Uninstall) {
  if (-not (Test-Path $List)) { throw "nothing from $Repo is recorded as installed in $H" }
  if (-not (Ask "Remove what $Repo installed in ${H}?")) { Say 'Nothing removed.'; return }
  if ($SwitchTo -and (Running)) {
    $current = ((& herdr-app status) | ConvertFrom-Json).layout
    if ($Layouts -contains $current) { & herdr-app do layout.switch '{"name":"main"}' *> $null }
  }
  $remove = @()
  foreach ($line in Get-Content $List) {
    if ($line -like 'mod *') { $m = $line.Substring(4); Backup "mods\$m"; Remove-Item -Recurse -Force (Join-Path $H "mods\$m") -ErrorAction SilentlyContinue; Say "  removed mods/$m" }
    elseif ($line -like 'layout *') { $l = $line.Substring(7); Backup "layouts\$l.json"; Remove-Item -Force (Join-Path $H "layouts\$l.json"), (Join-Path $H "layouts\$l.svg") -ErrorAction SilentlyContinue; Say "  removed layouts/$l" }
    elseif ($line -like "key`t*") { $remove += ,($line.Substring(4) -split "`t") }
  }
  if ($remove.Count) {
    Backup 'keys.json'
    $kf = Join-Path $H 'keys.json'; $k = Read-Json $kf
    foreach ($r in $remove) {
      $sec = $k.PSObject.Properties[$r[0]]
      if ($sec -and $sec.Value.PSObject.Properties[$r[1]] -and $sec.Value.($r[1]) -eq $r[2]) {
        $sec.Value.PSObject.Properties.Remove($r[1])
        if (-not @($sec.Value.PSObject.Properties).Count) { $k.PSObject.Properties.Remove($r[0]) }
      }
    }
    Write-Json $kf $k
    Say '  removed its keys from keys.json'
  }
  Remove-Item -Force $List
  if (Test-Path $Backup) { Say "Backed up first to $Backup" }
  Say 'Done.'
  return
}

# ---- install ---------------------------------------------------------------------------
Say "$Name, from $Repo"
Say "Into: $H"
$Manifest | Where-Object { $_ -match '^say\s+' } | ForEach-Object { Say ('  ' + ($_ -replace '^say\s+', '')) }
if (-not (Ask 'Install?')) { Say 'Nothing installed.'; return }
$first = -not (Test-Path $List)

# A mod folder goes in whole: copied next to the old one, then swapped, so Herdr never loads a
# half-copied folder. The editor typings Herdr writes into a mod folder are left out.
function Put-Mod($m) {
  $from = Join-Path $Src "mods\$m"
  if (-not (Test-Path $from)) { throw "mods/$m is missing from the download" }
  $stage = Join-Path $State ".new-$m"
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  Copy-Item -Recurse $from $stage
  Remove-Item -Force (Join-Path $stage 'gpui-kit.d.ts'), (Join-Path $stage 'jsconfig.json') -ErrorAction SilentlyContinue
  $to = Join-Path $H "mods\$m"
  if (Test-Path $to) { Backup "mods\$m"; Remove-Item -Recurse -Force $to }
  New-Item -ItemType Directory -Force (Join-Path $H 'mods') | Out-Null
  Move-Item $stage $to
  Record "mod $m"
}
foreach ($m in $Mods) { Put-Mod $m; Say "  mods/$m" }
foreach ($m in $Bundled) {
  if ((Test-Path (Join-Path $H "mods\$m")) -and -not (Recorded "mod $m")) { Say "  mods/${m}: yours is kept" }
  else { Put-Mod $m; Say "  mods/$m" }
}

if ($Layouts.Count) {
  New-Item -ItemType Directory -Force (Join-Path $H 'layouts') | Out-Null
  foreach ($l in $Layouts) {
    Backup "layouts\$l.json"; Backup "layouts\$l.svg"
    Copy-Item -Force (Join-Path $Src "layouts\$l.json") (Join-Path $H "layouts\$l.json")
    $svg = Join-Path $Src "layouts\$l.svg"; if (Test-Path $svg) { Copy-Item -Force $svg (Join-Path $H "layouts\$l.svg") }
    Record "layout $l"
    $extra = ''
    if ($Panel.Count -eq 3 -and (Test-Path (Join-Path $H "mods\$($Panel[0])"))) {
      $file = Join-Path $H "layouts\$l.json"; $layout = Read-Json $file
      $root = if ($layout.root) { $layout.root } else { $layout }
      $node = Find-Node $root $Panel[2]
      $snippet = Read-Json (Join-Path $Src $Panel[1])
      if ($node -and -not (@($node.children) | Where-Object { $_.id -eq $snippet.id })) {
        $node.children = @($node.children) + $snippet
        Write-Json $file $layout
      }
      $extra = " (with the $($Panel[0]) panel)"
    }
    Say "  layouts/$l$extra"
  }
}

if ($Keys -and (Test-Path (Join-Path $Src $Keys))) {
  $kf = Join-Path $H 'keys.json'
  $hadKeys = Test-Path $kf
  $mine = if ($hadKeys) { Read-Json $kf } else { New-Object PSObject }
  $repoKeys = Read-Json (Join-Path $Src $Keys)
  $added = @()
  foreach ($sec in $repoKeys.PSObject.Properties) {
    if (-not $mine.PSObject.Properties[$sec.Name]) { $mine | Add-Member -NotePropertyName $sec.Name -NotePropertyValue (New-Object PSObject) }
    $have = $mine.($sec.Name)
    foreach ($b in $sec.Value.PSObject.Properties) {
      $cur = $have.PSObject.Properties[$b.Name]
      if (-not $cur) { $have | Add-Member -NotePropertyName $b.Name -NotePropertyValue $b.Value; $added += "$($sec.Name)`t$($b.Name)`t$($b.Value)" }
      elseif ($cur.Value -ne $b.Value) {
        if (-not $Yes -and (Ask "keys.json [$($sec.Name)] $($b.Name) is `"$($cur.Value)`"; use `"$($b.Value)`" from $Slug instead?")) {
          $cur.Value = $b.Value; $added += "$($sec.Name)`t$($b.Name)`t$($b.Value)"
        } else { Say "  kept your [$($sec.Name)] $($b.Name) ($($cur.Value)); $Slug's $($b.Value) is not bound" }
      }
    }
  }
  if ($added.Count) {
    if ($hadKeys) { Backup 'keys.json' }
    Write-Json $kf $mine
    foreach ($a in $added) { Record "key`t$a" }
    Say "  keys.json: $($added.Count) key(s) added"
  } else { Say '  keys.json: nothing to add' }
}

if ($HerdrApp) {
  $failed = $false
  foreach ($m in @($Mods) + @($Bundled)) {
    $dir = Join-Path $H "mods\$m"
    if (-not (Test-Path $dir)) { continue }
    $env:HERDR_APP_HOME = $H; & herdr-app check $dir *> $null
    if ($LASTEXITCODE -ne 0) { Say "  herdr-app check failed: mods/$m"; $failed = $true }
  }
  if (-not $failed) { Say '  herdr-app check: every mod loads' }
} else { Say '  herdr-app is not on PATH: run herdr-app check on each mod yourself' }

if ($first -and $SwitchTo -and (Running)) {
  & herdr-app do layout.switch ('{"name":"' + $SwitchTo + '"}') *> $null
  if ($LASTEXITCODE -eq 0) { Say "  switched to the $SwitchTo layout (ctrl-shift-l switches back)" }
}
if (Test-Path $Backup) { Say "Replaced files were backed up to $Backup" }
if ($Tmp) { Say "Done. To remove it: `$env:HERDR_UNINSTALL = 1; irm https://raw.githubusercontent.com/$Repo/$Branch/install/install.ps1 | iex" }
else { Say 'Done. To remove it: .\install\install.ps1 -Uninstall' }
} finally {
  if ($Tmp) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
}
