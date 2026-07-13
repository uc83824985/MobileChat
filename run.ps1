param(
  [int]$Port = 5173,
  [switch]$NoBrowser,
  [switch]$KeepExistingWindow,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$TmpDir = Join-Path $Root '.tmp'
$DesktopDir = Join-Path $TmpDir 'desktop'
$ProfileDir = Join-Path $TmpDir 'desktop-profile'
$PidFile = Join-Path $DesktopDir 'vite.pid'
$OutLog = Join-Path $DesktopDir 'vite.out.log'
$ErrLog = Join-Path $DesktopDir 'vite.err.log'
$Url = "http://127.0.0.1:$Port/MobileChat/"

function Resolve-CommandPath {
  param([string]$CommandName)

  $Command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($Command) {
    return $Command.Source
  }

  return $null
}

function Resolve-BrowserPath {
  $Candidates = @()

  if ($env:MOBILECHAT_BROWSER) {
    $Candidates += $env:MOBILECHAT_BROWSER
  }

  $Edge = Resolve-CommandPath 'msedge.exe'
  if ($Edge) { $Candidates += $Edge }

  $Chrome = Resolve-CommandPath 'chrome.exe'
  if ($Chrome) { $Candidates += $Chrome }

  $Candidates += @(
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
  )

  foreach ($Candidate in $Candidates) {
    if ($Candidate -and (Test-Path -LiteralPath $Candidate)) {
      return (Resolve-Path -LiteralPath $Candidate).Path
    }
  }

  throw 'Chrome or Edge executable not found. Set MOBILECHAT_BROWSER to a browser executable path.'
}

function Test-DevServer {
  param([string]$TargetUrl)

  try {
    $Response = Invoke-WebRequest -UseBasicParsing -Uri $TargetUrl -TimeoutSec 2
    return ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 500)
  }
  catch {
    return $false
  }
}

function Stop-DesktopBrowserWindow {
  $Needle = $ProfileDir.ToLowerInvariant()
  $Processes = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($Needle) }

  if ($Processes) {
    Write-Host "Stopping existing MobileChat desktop window process(es): $($Processes.ProcessId -join ', ')"
    foreach ($ProcessInfo in $Processes) {
      Stop-Process -Id $ProcessInfo.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Stop-DevServer {
  if (-not (Test-Path -LiteralPath $PidFile)) {
    $RecordedPid = $null
  }
  else {
    $RecordedPid = (Get-Content -Raw -LiteralPath $PidFile).Trim()
  }

  if ($RecordedPid) {
    $Process = Get-Process -Id ([int]$RecordedPid) -ErrorAction SilentlyContinue
    if ($Process) {
      Write-Host "Stopping MobileChat dev server PID=$RecordedPid"
      $Process | Stop-Process -Force
    }
  }

  $Listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($Listener in $Listeners) {
    $Owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($Listener.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $Owner) {
      continue
    }

    $CommandLine = [string]$Owner.CommandLine
    $IsMobileChatVite = $CommandLine.Contains($Root) -and $CommandLine.Contains('vite')
    if (-not $IsMobileChatVite) {
      continue
    }

    Write-Host "Stopping MobileChat Vite listener PID=$($Listener.OwningProcess)"
    Stop-Process -Id $Listener.OwningProcess -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path -LiteralPath $PidFile) {
    Remove-Item -LiteralPath $PidFile -Force
  }
}

New-Item -ItemType Directory -Force -Path $DesktopDir | Out-Null
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

if ($Stop) {
  Stop-DesktopBrowserWindow
  Stop-DevServer
  exit 0
}

Push-Location $Root
try {
  $Npm = Resolve-CommandPath 'npm.cmd'
  if (-not $Npm) {
    throw 'npm.cmd not found. Install Node.js and ensure npm is on PATH.'
  }

  if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
    Write-Host 'node_modules not found. Running npm install...'
    & $Npm install
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }

  if (-not (Test-DevServer $Url)) {
    $Arguments = @(
      'run',
      'dev',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      "$Port",
      '--strictPort'
    )

    $Process = Start-Process `
      -FilePath $Npm `
      -ArgumentList $Arguments `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -RedirectStandardOutput $OutLog `
      -RedirectStandardError $ErrLog `
      -PassThru

    Set-Content -LiteralPath $PidFile -Value $Process.Id -Encoding ascii
    Write-Host "Started Vite dev server PID=$($Process.Id)"

    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
      if (Test-DevServer $Url) {
        $Ready = $true
        break
      }
      Start-Sleep -Milliseconds 500
    }

    if (-not $Ready) {
      Write-Host "Vite stdout log: $OutLog"
      Write-Host "Vite stderr log: $ErrLog"
      throw "Dev server did not become ready: $Url"
    }
  }
  else {
    Write-Host "Reusing existing dev server: $Url"
  }

  if ($NoBrowser) {
    Write-Host "MobileChat dev URL: $Url"
    exit 0
  }

  if (-not $KeepExistingWindow) {
    Stop-DesktopBrowserWindow
  }

  $Browser = Resolve-BrowserPath
  $BrowserArguments = @(
    "--app=$Url",
    "--user-data-dir=$ProfileDir",
    '--no-first-run',
    '--disable-features=Translate'
  )

  $BrowserProcess = Start-Process `
    -FilePath $Browser `
    -ArgumentList $BrowserArguments `
    -WorkingDirectory $Root `
    -PassThru

  Write-Host "Started MobileChat desktop window PID=$($BrowserProcess.Id)"
  Write-Host "URL=$Url"
}
finally {
  Pop-Location
}
