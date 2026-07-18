[CmdletBinding()]
param(
    [string]$Url = "https://uc83824985.github.io/MobileChat/",
    [Alias("DeviceRoot")]
    [string]$DevicePath = "/sdcard/Download/MobileChat",
    [string]$OutputDir = "artifacts",
    [ValidateSet("WebViewApk", "LocalFile")]
    [string]$DeployMode = "WebViewApk",
    [ValidateSet("WebViewApp", "LocalFile", "Url")]
    [string]$OpenTarget = "WebViewApp",
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
$AndroidProjectDir = Join-Path $RepoRoot "android"
$AndroidAssetsAppDir = Join-Path $AndroidProjectDir "app\src\main\assets"
$LocalSigningDir = Join-Path $RepoRoot ".local\android-signing"
$LocalKeystorePath = Join-Path $LocalSigningDir "mobilechat-dev.jks"

# Persistence-critical constants. Do not change after installing on a phone unless
# the user has exported data and accepts creating a new app/WebView storage bucket.
$AndroidApplicationId = "com.uc83824985.mobilechat"
$AndroidAssetOrigin = "https://appassets.androidplatform.net"
$AndroidAssetPath = "/app/"
$AndroidEntryUrl = "${AndroidAssetOrigin}${AndroidAssetPath}index.html"
$IndexedDbName = "MobileChatDB"
$SigningAlias = "mobilechat-local-dev"
$SigningPassword = "mobilechat-local-dev"

function Invoke-Adb {
    param([Parameter(Mandatory = $true)][string[]]$AdbArgs)

    & adb @AdbArgs
    if ($LASTEXITCODE -ne 0) {
        throw "adb command failed: adb $($AdbArgs -join ' ')"
    }
}

function Assert-AndroidDeviceReady {
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
        throw "adb was not found in PATH. Install Android platform-tools and enable USB debugging on the phone."
    }

    $State = (& adb get-state 2>$null)
    if ($LASTEXITCODE -ne 0 -or ($State -join "").Trim() -ne "device") {
        Write-Host "Connected adb devices:"
        & adb devices
        throw "No ready Android device was found. Connect the phone, authorize USB debugging, then retry."
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

function Get-SharedInputPaths {
    return @(
        (Join-Path $RepoRoot "src"),
        (Join-Path $RepoRoot "public"),
        (Join-Path $RepoRoot "index.html"),
        (Join-Path $RepoRoot "package.json"),
        (Join-Path $RepoRoot "package-lock.json"),
        (Join-Path $RepoRoot "vite.config.ts"),
        (Join-Path $RepoRoot "vite.mobile-file.config.ts"),
        (Join-Path $RepoRoot "tsconfig.json"),
        (Join-Path $RepoRoot "tsconfig.app.json"),
        (Join-Path $RepoRoot "tsconfig.node.json"),
        (Join-Path $RepoRoot "scripts\deploy-android.ps1"),
        (Join-Path $RepoRoot ".env"),
        (Join-Path $RepoRoot ".env.local"),
        (Join-Path $RepoRoot ".env.production"),
        (Join-Path $RepoRoot ".env.production.local")
    )
}

function Get-LocalFilePackageInputPaths {
    $Paths = @(Get-SharedInputPaths)
    if (Test-Path -LiteralPath $MobileFileDistDir) {
        $Paths += $MobileFileDistDir
    }
    if ($SkipBuild) {
        return @($MobileFileDistDir)
    }
    return $Paths
}

function Get-WebViewPackageInputPaths {
    $Paths = @(Get-SharedInputPaths)
    $AndroidFiles = Get-ChildItem -LiteralPath $AndroidProjectDir -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object {
            $FullName = $_.FullName
            -not $FullName.Contains("\.gradle\") -and
            -not $FullName.Contains("\build\") -and
            -not $FullName.Contains("\app\src\main\assets\app\")
        } |
        ForEach-Object { $_.FullName }
    $Paths += $AndroidFiles
    if ($SkipBuild) {
        return @($AndroidProjectDir, $MobileFileDistDir)
    }
    return $Paths
}

function Get-LatestPackageZip {
    if (-not (Test-Path -LiteralPath $ArtifactDir)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $ArtifactDir -Filter "mobilechat-mobile-*.zip" -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
}

function Get-LatestWebViewApk {
    if (-not (Test-Path -LiteralPath $ArtifactDir)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $ArtifactDir -Filter "mobilechat-webview-*.apk" -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
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

    $NewestInput = Get-NewestWriteTimeUtc (Get-LocalFilePackageInputPaths)
    if ($NewestInput -eq [datetime]::MinValue.ToUniversalTime()) {
        return $false
    }

    return $Zip.LastWriteTimeUtc -ge $NewestInput.AddSeconds(-2)
}

function Test-WebViewApkIsCurrent {
    param([System.IO.FileInfo]$Apk)

    if ($null -eq $Apk) {
        return $false
    }

    $NewestInput = Get-NewestWriteTimeUtc (Get-WebViewPackageInputPaths)
    if ($NewestInput -eq [datetime]::MinValue.ToUniversalTime()) {
        return $false
    }

    return $Apk.LastWriteTimeUtc -ge $NewestInput.AddSeconds(-2)
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
            '<p style="color: #888;">WebView/local bundle boot diagnostics.</p>' +
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
            showBootError("The app script did not mount the UI. This browser/WebView may block local script execution, or the app crashed before rendering.");
          }
        }, 2500);
      })();
    </script>
    <title>MobileChat</title>
    <style>
__MOBILECHAT_INLINE_STYLE__
    </style>
  </head>
  <body data-mobilechat-build="__MOBILECHAT_BUILD_STAMP__">
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

function Ensure-JavaHome {
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
        $JavaBin = Join-Path $env:JAVA_HOME "bin"
        if (-not ($env:PATH.Split(";") -contains $JavaBin)) {
            $env:PATH = "$JavaBin;$env:PATH"
        }
        return
    }

    $AndroidStudioJbr = "C:\Program Files\Android\Android Studio\jbr"
    if (Test-Path -LiteralPath (Join-Path $AndroidStudioJbr "bin\java.exe")) {
        $env:JAVA_HOME = $AndroidStudioJbr
        $env:PATH = "$(Join-Path $AndroidStudioJbr 'bin');$env:PATH"
        return
    }

    throw "Java was not found. Install Android Studio or set JAVA_HOME to a JDK 17+ directory."
}

function Ensure-AndroidSigningKeystore {
    Ensure-JavaHome
    if (Test-Path -LiteralPath $LocalKeystorePath) {
        return
    }

    New-Item -ItemType Directory -Force -Path $LocalSigningDir | Out-Null
    $Keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
    if (-not (Test-Path -LiteralPath $Keytool)) {
        throw "keytool was not found under JAVA_HOME: $env:JAVA_HOME"
    }

    Write-Host "Creating stable local Android signing key:"
    Write-Host $LocalKeystorePath
    & $Keytool `
        -genkeypair `
        -v `
        -keystore $LocalKeystorePath `
        -storepass $SigningPassword `
        -keypass $SigningPassword `
        -alias $SigningAlias `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -dname "CN=MobileChat Local Dev,O=MobileChat,C=CN" |
        ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create Android signing keystore."
    }
}

function Get-GradleExecutable {
    $GlobalGradle = Get-Command gradle -ErrorAction SilentlyContinue
    if ($GlobalGradle) {
        return $GlobalGradle.Source
    }

    $CachedGradle = Get-ChildItem "$env:USERPROFILE\.gradle\wrapper\dists" -Recurse -Filter gradle.bat -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($CachedGradle) {
        return $CachedGradle.FullName
    }

    throw "Gradle was not found. Install Gradle, or open/build once from Android Studio so a Gradle distribution is available."
}

function Invoke-Gradle {
    param([Parameter(Mandatory = $true)][string[]]$GradleArgs)

    Ensure-JavaHome
    $Gradle = Get-GradleExecutable
    Push-Location $AndroidProjectDir
    try {
        & $Gradle @GradleArgs | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) {
            throw "Gradle command failed: $Gradle $($GradleArgs -join ' ')"
        }
    } finally {
        Pop-Location
    }
}

function Copy-WebViewAssets {
    $LayoutDir = New-MobileFileLayout
    $ResolvedAssetsDir = [System.IO.Path]::GetFullPath($AndroidAssetsAppDir)
    $ResolvedAndroidDir = [System.IO.Path]::GetFullPath($AndroidProjectDir)
    if (-not $ResolvedAssetsDir.StartsWith($ResolvedAndroidDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to write WebView assets outside android project: $ResolvedAssetsDir"
    }

    if (Test-Path -LiteralPath $AndroidAssetsAppDir) {
        Remove-Item -LiteralPath $AndroidAssetsAppDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $AndroidAssetsAppDir | Out-Null
    Get-ChildItem -LiteralPath $LayoutDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $AndroidAssetsAppDir -Recurse -Force
    }
}

function New-WebViewApk {
    Push-Location $RepoRoot
    try {
        if (-not $SkipBuild) {
            Write-Host "Building MobileChat WebView bundle..."
            npm run build:mobile-file | ForEach-Object { Write-Host $_ }
            if ($LASTEXITCODE -ne 0) {
                throw "npm run build:mobile-file failed."
            }
        }

        Copy-WebViewAssets
        Ensure-AndroidSigningKeystore

        Write-Host "Building Android WebView APK..."
        Invoke-Gradle -GradleArgs @(":app:assembleDebug")

        $BuiltApk = Join-Path $AndroidProjectDir "app\build\outputs\apk\debug\app-debug.apk"
        if (-not (Test-Path -LiteralPath $BuiltApk)) {
            throw "Android build did not produce expected APK: $BuiltApk"
        }

        New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
        $Stamp = Get-Date -Format "yyyyMMdd"
        $ApkPath = Join-Path $ArtifactDir "mobilechat-webview-$Stamp.apk"
        if (Test-Path -LiteralPath $ApkPath) {
            Remove-Item -LiteralPath $ApkPath -Force
        }
        Copy-Item -LiteralPath $BuiltApk -Destination $ApkPath -Force

        Write-Host "Packaged WebView APK:"
        Write-Host $ApkPath
        return $ApkPath
    } finally {
        Pop-Location
    }
}

function Invoke-LocalFileDeployment {
    $LatestZip = Get-LatestPackageZip
    if (-not $ForcePackage -and (Test-PackageZipIsCurrent $LatestZip)) {
        $ZipPath = $LatestZip.FullName
        Write-Host "Using existing latest package:"
        Write-Host $ZipPath
    } else {
        if ($ForcePackage) {
            Write-Host "ForcePackage was set; creating a fresh local-file package..."
        } else {
            Write-Host "No current local-file package was found, or the existing package is stale; creating a fresh package..."
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
        return
    }

    Assert-AndroidDeviceReady

    $ResolvedDevicePath = Resolve-AndroidAppPath $DevicePath
    $DeviceSourcePath = "$ResolvedDevicePath/source"

    Write-Host "Preparing device folder: $ResolvedDevicePath"
    Invoke-Adb -AdbArgs @("shell", "mkdir -p '$ResolvedDevicePath'")

    if ($PushZip) {
        Write-Host "Pushing zip artifact to device..."
        Invoke-Adb -AdbArgs @("push", $ZipPath, "$ResolvedDevicePath/")
    }

    if (-not $NoPushDist) {
        $LayoutDir = New-MobileFileLayout

        if (-not $KeepPreviousDist) {
            Write-Host "Cleaning previous local static files for upgrade overwrite..."
            Invoke-Adb -AdbArgs @(
                "shell",
                "rm -rf '$DeviceSourcePath' '$ResolvedDevicePath/index.html' && mkdir -p '$ResolvedDevicePath'"
            )
        } else {
            Write-Host "Keeping previous local static files and overwriting matching files..."
            Invoke-Adb -AdbArgs @("shell", "mkdir -p '$ResolvedDevicePath'")
        }

        Write-Host "Pushing local static layout to device..."
        Invoke-Adb -AdbArgs @("push", (Join-Path $LayoutDir "."), "$ResolvedDevicePath/")
    }

    if (-not $NoOpen) {
        if ($OpenTarget -eq "Url") {
            Write-Host "Opening PWA URL on device:"
            Write-Host $Url
            Invoke-Adb -AdbArgs @("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", $Url)
        } else {
            $OpenStamp = Get-Date -Format "yyyyMMddHHmmss"
            $LocalFileUrl = "file://$ResolvedDevicePath/index.html?v=$OpenStamp"
            Write-Host "Opening local file entry on device:"
            Write-Host $LocalFileUrl
            Invoke-Adb -AdbArgs @("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", $LocalFileUrl, "-t", "text/html")
        }
    }

    Write-Host ""
    Write-Host "Android local-file test deployment complete."
    Write-Host "Local package: $ZipPath"
    if (-not $NoPushDist) {
        Write-Host "Device entry: $ResolvedDevicePath/index.html"
        Write-Host "Device source files: $DeviceSourcePath"
    }
}

function Invoke-WebViewDeployment {
    $LatestApk = Get-LatestWebViewApk
    if (-not $ForcePackage -and (Test-WebViewApkIsCurrent $LatestApk)) {
        $ApkPath = $LatestApk.FullName
        Write-Host "Using existing latest WebView APK:"
        Write-Host $ApkPath
    } else {
        if ($ForcePackage) {
            Write-Host "ForcePackage was set; creating a fresh WebView APK..."
        } else {
            Write-Host "No current WebView APK was found, or the existing APK is stale; creating a fresh package..."
        }

        $ApkPath = New-WebViewApk
        if (-not $ApkPath -or -not (Test-Path -LiteralPath $ApkPath)) {
            throw "Packaging did not produce an APK artifact."
        }
    }

    Write-Host ""
    Write-Host "WebView persistence constants:"
    Write-Host "  applicationId: $AndroidApplicationId"
    Write-Host "  WebView origin: $AndroidAssetOrigin"
    Write-Host "  entry URL: $AndroidEntryUrl"
    Write-Host "  IndexedDB name: $IndexedDbName"
    Write-Host "  signing key: $LocalKeystorePath"

    if ($PackageOnly) {
        Write-Host ""
        Write-Host "Package complete."
        Write-Host $ApkPath
        return
    }

    Assert-AndroidDeviceReady

    Write-Host "Installing APK with adb install -r -d. This preserves app data when package name and signing key match."
    Invoke-Adb -AdbArgs @("install", "-r", "-d", $ApkPath)

    if (-not $NoOpen) {
        if ($OpenTarget -eq "Url") {
            Write-Host "Opening PWA URL on device:"
            Write-Host $Url
            Invoke-Adb -AdbArgs @("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", $Url)
        } else {
            Write-Host "Opening MobileChat WebView app on device..."
            Invoke-Adb -AdbArgs @("shell", "am", "start", "-n", "$AndroidApplicationId/.MainActivity")
        }
    }

    Write-Host ""
    Write-Host "Android WebView deployment complete."
    Write-Host "APK: $ApkPath"
}

if ($DeployMode -eq "LocalFile") {
    Invoke-LocalFileDeployment
} else {
    Invoke-WebViewDeployment
}
