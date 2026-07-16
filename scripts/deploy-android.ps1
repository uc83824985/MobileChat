[CmdletBinding()]
param(
    [string]$Url = "https://uc83824985.github.io/MobileChat/",
    [Alias("DeviceRoot")]
    [string]$DevicePath = "/sdcard/Download/MobileChat",
    [string]$OutputDir = "artifacts",
    [ValidateSet("LocalFile", "Url")]
    [string]$OpenTarget = "LocalFile",
    [switch]$SkipBuild,
    [switch]$ForcePackage,
    [switch]$PackageOnly,
    [switch]$NoPushDist,
    [switch]$NoOpen,
    [switch]$KeepPreviousDist,
    [switch]$PushZip
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$MobileFileDistDir = Join-Path $RepoRoot ".tmp\mobile-file-dist"
$ArtifactDir = Join-Path $RepoRoot $OutputDir
$MobileLayoutDir = Join-Path $RepoRoot ".tmp\mobile-layout"

function Invoke-Adb {
    param([Parameter(Mandatory = $true)][string[]]$AdbArgs)

    & adb @AdbArgs
    if ($LASTEXITCODE -ne 0) {
        throw "adb command failed: adb $($AdbArgs -join ' ')"
    }
}

function Resolve-AndroidAppPath {
    param([string]$Path)

    $RawPath = if ($null -eq $Path) { "" } else { $Path }
    $Normalized = $RawPath.Trim().Replace("\", "/").TrimEnd("/")
    if (-not $Normalized) {
        throw "Android path cannot be empty."
    }
    if (-not $Normalized.StartsWith("/")) {
        $Normalized = "/sdcard/$Normalized"
    }
    if ($Normalized -in @("/", "/sdcard", "/storage", "/mnt")) {
        throw "Android path is too broad: $Normalized"
    }
    if ($Normalized.IndexOf("'") -ge 0) {
        throw "Android path cannot contain a single quote: $Normalized"
    }

    return $Normalized
}

function Get-LatestPackageZip {
    if (-not (Test-Path -LiteralPath $ArtifactDir)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $ArtifactDir -Filter "mobilechat-mobile-*.zip" -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
}

function Get-NewestWriteTimeUtc {
    param([string[]]$Paths)

    $Newest = [datetime]::MinValue.ToUniversalTime()
    foreach ($Path in $Paths) {
        if (-not (Test-Path -LiteralPath $Path)) {
            continue
        }

        $Item = Get-Item -LiteralPath $Path
        if ($Item.PSIsContainer) {
            $Files = Get-ChildItem -LiteralPath $Path -Recurse -File -Force
            foreach ($File in $Files) {
                if ($File.LastWriteTimeUtc -gt $Newest) {
                    $Newest = $File.LastWriteTimeUtc
                }
            }
        } elseif ($Item.LastWriteTimeUtc -gt $Newest) {
            $Newest = $Item.LastWriteTimeUtc
        }
    }

    return $Newest
}

function Get-PackageInputPaths {
    $Paths = @(
        (Join-Path $RepoRoot "src"),
        (Join-Path $RepoRoot "public"),
        (Join-Path $RepoRoot "index.html"),
        (Join-Path $RepoRoot "package.json"),
        (Join-Path $RepoRoot "package-lock.json"),
        (Join-Path $RepoRoot "vite.config.ts"),
        (Join-Path $RepoRoot "tsconfig.json"),
        (Join-Path $RepoRoot "tsconfig.app.json"),
        (Join-Path $RepoRoot "tsconfig.node.json"),
        (Join-Path $RepoRoot "vite.mobile-file.config.ts"),
        (Join-Path $RepoRoot "scripts\deploy-android.ps1"),
        (Join-Path $RepoRoot ".env"),
        (Join-Path $RepoRoot ".env.local"),
        (Join-Path $RepoRoot ".env.production"),
        (Join-Path $RepoRoot ".env.production.local")
    )

    if (Test-Path -LiteralPath $MobileFileDistDir) {
        $Paths += $MobileFileDistDir
    }

    if ($SkipBuild) {
        return @($MobileFileDistDir)
    }

    return $Paths
}

function Test-PackageZipIsCurrent {
    param([System.IO.FileInfo]$Zip)

    if ($null -eq $Zip) {
        return $false
    }

    $ScriptPath = Join-Path $MobileFileDistDir "app.js"
    $StylePath = Join-Path $MobileFileDistDir "app.css"
    if (-not (Test-Path -LiteralPath $ScriptPath) -or -not (Test-Path -LiteralPath $StylePath)) {
        return $false
    }

    $NewestInput = Get-NewestWriteTimeUtc (Get-PackageInputPaths)
    if ($NewestInput -eq [datetime]::MinValue.ToUniversalTime()) {
        return $false
    }

    return $Zip.LastWriteTimeUtc -ge $NewestInput.AddSeconds(-2)
}

function New-MobileFileLayout {
    $BuildStamp = Get-Date -Format "yyyyMMddHHmmss"
    $ScriptPath = Join-Path $MobileFileDistDir "app.js"
    $StylePath = Join-Path $MobileFileDistDir "app.css"
    if (-not (Test-Path -LiteralPath $ScriptPath) -or -not (Test-Path -LiteralPath $StylePath)) {
        throw "Mobile file build output was not found at $MobileFileDistDir. Run without -SkipBuild first, or create the file build before using -SkipBuild."
    }

    $InlineStyle = (Get-Content -Raw -Encoding utf8 $StylePath).Replace("</style", "<\/style")
    $InlineScript = (Get-Content -Raw -Encoding utf8 $ScriptPath).Replace("</script", "<\/script")

    if (Test-Path -LiteralPath $MobileLayoutDir) {
        Remove-Item -LiteralPath $MobileLayoutDir -Recurse -Force
    }

    $SourceDir = Join-Path $MobileLayoutDir "source"
    New-Item -ItemType Directory -Force -Path $SourceDir | Out-Null

    Get-ChildItem -LiteralPath $MobileFileDistDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $SourceDir -Recurse -Force
    }

    $PublicIconPath = Join-Path $RepoRoot "public\favicon.svg"
    if (Test-Path -LiteralPath $PublicIconPath) {
        Copy-Item -LiteralPath $PublicIconPath -Destination $SourceDir -Force
    }

    $Html = @'
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="source/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="MobileChat local-first mobile chat client" />
    <meta name="theme-color" content="#f7f7f2" />
    <script>
      (() => {
        try {
          const raw = localStorage.getItem("mobilechat:ui-preferences");
          const preferences = raw ? JSON.parse(raw) : {};
          const themeMode = preferences.themeMode;
          if (themeMode === "light" || themeMode === "dark") {
            document.documentElement.dataset.theme = themeMode;
            document.documentElement.style.colorScheme = themeMode;
          } else {
            document.documentElement.style.colorScheme = "light dark";
          }
        } catch {
          document.documentElement.style.colorScheme = "light dark";
        }
      })();
    </script>
    <script>
      (() => {
        let pendingBootError = "";
        const showBootError = (message) => {
          const root = document.getElementById("root");
          if (!root || root.childElementCount > 0) {
            if (!root) {
              pendingBootError = String(message);
            }
            return;
          }
          root.innerHTML =
            '<main style="font-family: system-ui, sans-serif; padding: 20px; color: #f5f5f5; background: #111; min-height: 100vh;">' +
            '<h1 style="font-size: 20px;">MobileChat boot failed</h1>' +
            '<p style="white-space: pre-wrap; color: #c9c9c9;">' +
            String(message).replace(/[&<>"']/g, (character) => ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[character]) +
            "</p>" +
            '<p style="color: #888;">Local file test boot diagnostics.</p>' +
            "</main>";
        };

        document.addEventListener("DOMContentLoaded", () => {
          if (pendingBootError) {
            showBootError(pendingBootError);
          }
        });
        window.addEventListener("error", (event) => {
          showBootError(event.message || "Script runtime error.");
        });
        window.addEventListener("unhandledrejection", (event) => {
          showBootError(event.reason?.message || event.reason || "Async boot error.");
        });
        window.setTimeout(() => {
          const root = document.getElementById("root");
          if (root && root.childElementCount === 0) {
            showBootError("The app script did not mount the UI. This browser may block local script execution, or the app crashed before rendering.");
          }
        }, 2500);
      })();
    </script>
    <title>MobileChat</title>
    <style>
__MOBILECHAT_INLINE_STYLE__
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
__MOBILECHAT_INLINE_SCRIPT__
    </script>
  </body>
</html>
'@
    $Html = $Html.Replace("__MOBILECHAT_BUILD_STAMP__", $BuildStamp)
    $Html = $Html.Replace("__MOBILECHAT_INLINE_STYLE__", $InlineStyle)
    $Html = $Html.Replace("__MOBILECHAT_INLINE_SCRIPT__", $InlineScript)

    Set-Content -LiteralPath (Join-Path $MobileLayoutDir "index.html") -Value $Html -Encoding utf8 -NoNewline

    return $MobileLayoutDir
}

function New-PackageZip {
    Push-Location $RepoRoot
    try {
        if (-not $SkipBuild) {
            Write-Host "Building MobileChat local file bundle..."
            npm run build:mobile-file | ForEach-Object { Write-Host $_ }
            if ($LASTEXITCODE -ne 0) {
                throw "npm run build:mobile-file failed."
            }
        }

        $LayoutDir = New-MobileFileLayout
        New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null

        $Stamp = Get-Date -Format "yyyyMMdd"
        $ZipPath = Join-Path $ArtifactDir "mobilechat-mobile-$Stamp.zip"

        if (Test-Path -LiteralPath $ZipPath) {
            Remove-Item -LiteralPath $ZipPath -Force
        }

        Compress-Archive -Path (Join-Path $LayoutDir "*") -DestinationPath $ZipPath -Force

        Write-Host "Packaged static build:"
        Write-Host $ZipPath

        return $ZipPath
    } finally {
        Pop-Location
    }
}

$LatestZip = Get-LatestPackageZip
if (-not $ForcePackage -and (Test-PackageZipIsCurrent $LatestZip)) {
    $ZipPath = $LatestZip.FullName
    Write-Host "Using existing latest package:"
    Write-Host $ZipPath
} else {
    if ($ForcePackage) {
        Write-Host "ForcePackage was set; creating a fresh package..."
    } else {
        Write-Host "No current package was found, or the existing package is stale; creating a fresh package..."
    }

    $ZipPath = New-PackageZip
    if (-not $ZipPath -or -not (Test-Path -LiteralPath $ZipPath)) {
        throw "Packaging did not produce a zip artifact."
    }
}

if ($PackageOnly) {
    Write-Host ""
    Write-Host "Package complete."
    Write-Host $ZipPath
    exit 0
}

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "adb was not found in PATH. Install Android platform-tools and enable USB debugging on the phone."
}

$State = (& adb get-state 2>$null)
if ($LASTEXITCODE -ne 0 -or ($State -join "").Trim() -ne "device") {
    Write-Host "Connected adb devices:"
    & adb devices
    throw "No ready Android device was found. Connect the phone, authorize USB debugging, then retry."
}

$DevicePath = Resolve-AndroidAppPath $DevicePath
$DeviceSourcePath = "$DevicePath/source"

Write-Host "Preparing device folder: $DevicePath"
Invoke-Adb -AdbArgs @("shell", "mkdir -p '$DevicePath'")

if ($PushZip) {
    Write-Host "Pushing zip artifact to device..."
    Invoke-Adb -AdbArgs @("push", $ZipPath, "$DevicePath/")
}

if (-not $NoPushDist) {
    $LayoutDir = New-MobileFileLayout

    if (-not $KeepPreviousDist) {
        Write-Host "Cleaning previous local static files for upgrade overwrite..."
        Invoke-Adb -AdbArgs @(
            "shell",
            "rm -rf '$DeviceSourcePath' '$DevicePath/index.html' && mkdir -p '$DevicePath'"
        )
    } else {
        Write-Host "Keeping previous local static files and overwriting matching files..."
        Invoke-Adb -AdbArgs @("shell", "mkdir -p '$DevicePath'")
    }

    Write-Host "Pushing local static layout to device..."
    Invoke-Adb -AdbArgs @("push", (Join-Path $LayoutDir "."), "$DevicePath/")
}

if (-not $NoOpen) {
    if ($OpenTarget -eq "Url") {
        Write-Host "Opening PWA URL on device:"
        Write-Host $Url
        Invoke-Adb -AdbArgs @("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", $Url)
    } else {
        $OpenStamp = Get-Date -Format "yyyyMMddHHmmss"
        $LocalFileUrl = "file://$DevicePath/index.html?v=$OpenStamp"
        Write-Host "Opening local file entry on device:"
        Write-Host $LocalFileUrl
        Invoke-Adb -AdbArgs @("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", $LocalFileUrl, "-t", "text/html")
    }
}

Write-Host ""
Write-Host "Android test deployment complete."
Write-Host "Local package: $ZipPath"
if (-not $NoPushDist) {
    Write-Host "Device entry: $DevicePath/index.html"
    Write-Host "Device source files: $DeviceSourcePath"
}
