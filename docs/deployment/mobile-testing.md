# Mobile testing deployment

MobileChat now has three mobile testing routes:

1. **Android WebView APK**: default route for repeated phone iteration and local data stability.
2. HTTPS PWA origin: useful for testing GitHub Pages/service-worker behavior.
3. Local-file smoke test: compatibility fallback only; not recommended for persistent data.

For this repository, the default HTTPS PWA URL used by the helper script remains:

```text
https://uc83824985.github.io/MobileChat/
```

## Stable WebView storage contract

The default Android route packages the static frontend into a small native WebView app. The shell loads local assets through AndroidX `WebViewAssetLoader` at a fixed HTTPS origin:

```text
applicationId: com.uc83824985.mobilechat
launcher label: 对话助手
WebView origin: https://appassets.androidplatform.net
entry URL: https://appassets.androidplatform.net/app/index.html
IndexedDB name: MobileChatDB
repository signing key: android/signing/mobilechat-dev.jks
launcher icon source: android/Icon.jpg
```

These values are persistence-critical. Changing `applicationId`, signing key, WebView origin/domain, or `MobileChatDB` creates a different Android app or a different WebView storage bucket. That will look like data loss even if the UI code is unchanged.

The launcher label and `android/Icon.jpg` can be changed later. They affect the installed app's visible name/icon, not the WebView storage bucket, as long as the package/signing/origin/database constants above remain unchanged.

The settings item **沉浸显示（Android）** is implemented by the Android wrapper through the local `MobileChatAndroid.setStatusBarHidden(...)` bridge. It hides Android system bars and allows the WebView to draw into short-edge cutout areas so landscape layouts can use the space normally reserved for the status/cutout letterbox. It does not affect desktop windows, ordinary browsers, the HTTPS PWA route, or the local-file smoke route.

The settings export action **导出 .mobilechat** is implemented by the Android wrapper through `MobileChatAndroid.saveArchive(...)`. In the WebView APK it writes the backup to:

```text
/sdcard/Download/MobileChat/
```

For example:

```text
/sdcard/Download/MobileChat/mobilechat-YYYY-MM-DDTHH-MM-SS.mobilechat
```

This is a normal user-visible download folder, not the private WebView IndexedDB directory. Ordinary desktop/mobile browsers still use their own browser download behavior.

Normal APK upgrades preserve local data when all of these remain true:

- the APK is installed over the previous app with the same `applicationId`;
- the signing key is the same;
- the WebView origin stays `https://appassets.androidplatform.net`;
- the frontend IndexedDB name stays `MobileChatDB`;
- the user does not clear app data, uninstall the app, or clear WebView/app storage;
- schema changes remain compatible with the current rapid-iteration rules.

The deployment script uses `adb install -r -d` and never uninstalls the app. If installation fails because the signature differs, export a `.mobilechat` backup before taking any manual uninstall/reinstall path. The repository carries a stable development signing key so normal clones build update-compatible APKs.

Some vendor ROMs require a separate phone-side permission for ADB installation. If `adb install` returns `INSTALL_FAILED_USER_RESTRICTED`, enable options such as **USB 安装**, **通过 USB 安装应用**, or the vendor-specific security setting, then rerun the script.

## Single-command WebView deploy

The usual mobile iteration command is:

```powershell
.\scripts\deploy-android.ps1
```

Equivalent npm shortcut:

```powershell
npm run mobile:adb
```

The default deploy flow:

1. checks whether the newest `artifacts/mobilechat-webview-*.apk` already matches the current source, Android shell, build files, and signing key hash;
2. reuses that APK when it is current;
3. otherwise runs the local WebView bundle build;
4. copies the generated frontend into `android/app/src/main/assets`;
5. verifies the repository signing key exists;
6. builds the Android APK;
7. installs it with `adb install -r -d`;
8. opens `com.uc83824985.mobilechat/.MainActivity`.

Use `-ForcePackage` when you intentionally want to rebuild and repackage even if the current APK appears fresh.

Use `-PackageOnly` to build the APK without requiring a connected phone:

```powershell
.\scripts\deploy-android.ps1 -PackageOnly
npm run mobile:package
```

Output is written under `artifacts/`, for example:

```text
artifacts/mobilechat-webview-YYYYMMDD.apk
```

The script writes a matching sidecar hash next to the APK:

```text
artifacts/mobilechat-webview-YYYYMMDD.apk.signing.sha256
```

If the repository signing key changes, the existing APK is treated as stale and rebuilt.

Having a stable signing key does not skip frontend or APK packaging after source changes. It only removes the old "generate/copy local key" step and allows the script to safely reuse an existing APK when the source inputs and signing hash already match.

## Signing key handling

The stable development signing key is committed at:

```text
android/signing/mobilechat-dev.jks
```

Use the same file for every development machine and CI build. This is intentionally a public development key for this personal testing app. Changing it after installation makes Android reject in-place upgrades. The safe recovery path is:

1. open the existing app;
2. export a `.mobilechat` backup;
3. uninstall/reinstall only after the backup exists;
4. import the backup into the newly signed app.

## Legacy local-file mode

The previous local-file route is still available for smoke testing:

```powershell
.\scripts\deploy-android.ps1 -DeployMode LocalFile
npm run mobile:file
```

Package-only local-file zip:

```powershell
.\scripts\deploy-android.ps1 -DeployMode LocalFile -PackageOnly
npm run mobile:file:package
```

This mode writes:

```text
/sdcard/Download/MobileChat/
  index.html
  source/
    app.css
    app.js
    favicon.svg
```

Local-file mode is not a stable persistence route. `file://` and `content://` entries can differ by browser, file manager, permission grant, and shortcut provider. They also use a different storage bucket from both the HTTPS PWA and the WebView app.

## Useful options

```powershell
.\scripts\deploy-android.ps1 -ForcePackage
.\scripts\deploy-android.ps1 -PackageOnly
.\scripts\deploy-android.ps1 -SkipBuild
.\scripts\deploy-android.ps1 -NoOpen
.\scripts\deploy-android.ps1 -OpenTarget Url
.\scripts\deploy-android.ps1 -DeployMode LocalFile
.\scripts\deploy-android.ps1 -DeployMode LocalFile -PushZip
.\scripts\deploy-android.ps1 -DeployMode LocalFile -NoPushDist
.\scripts\deploy-android.ps1 -DeployMode LocalFile -KeepPreviousDist
.\scripts\deploy-android.ps1 -DeployMode LocalFile -DevicePath "MyChat"
.\scripts\deploy-android.ps1 -DeployMode LocalFile -DevicePath "Documents/MobileChatDev"
.\scripts\deploy-android.ps1 -DeployMode LocalFile -DevicePath "/sdcard/Documents/MobileChatDev"
.\scripts\deploy-android.ps1 -Url "https://uc83824985.github.io/MobileChat/"
```

`-DevicePath`, `-PushZip`, `-NoPushDist`, and `-KeepPreviousDist` only affect legacy local-file mode.

## Data preservation rule

Before testing risky schema changes, export a `.mobilechat` backup from Settings.

Storage buckets are separate between:

- WebView APK: `https://appassets.androidplatform.net`;
- GitHub Pages PWA: `https://uc83824985.github.io/MobileChat/`;
- browser local-file/content entries.

Moving between those routes will not automatically carry IndexedDB data. Use `.mobilechat` export/import for transfer.
