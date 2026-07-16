# Mobile testing deployment

MobileChat is a static PWA. There are two mobile testing routes:

1. local-file smoke testing through files pushed to the phone;
2. stable PWA testing through the same HTTPS origin.

For this repository, the default PWA URL used by the helper script is:

```text
https://uc83824985.github.io/MobileChat/
```

## Data preservation rule

MobileChat stores user data in browser IndexedDB under the current origin. Repeated deployments do not clear existing conversations/settings as long as all of these remain true:

- the phone uses the same browser profile;
- the app is opened from the same origin and path scope, for example `https://uc83824985.github.io/MobileChat/`;
- browser/site data is not manually cleared;
- the installed PWA is not uninstalled in a way that removes site data;
- future database migrations are additive or explicitly preserve existing records.

Changing from GitHub Pages to `file://`, a different host, a different path, or an APK/WebView origin creates a different storage bucket. That will look like a new empty app even if the UI code is identical.

The default ADB helper opens the local file entry for fast smoke testing. Use `-OpenTarget Url` when testing the persisted PWA origin.

Before testing risky schema changes, export a `.mobilechat` backup from Settings.

## Single-command ADB deploy

The usual mobile iteration command is:

```powershell
.\scripts\deploy-android.ps1
```

Equivalent npm shortcut:

```powershell
npm run mobile:adb
```

The deploy script is the single entry point for normal testing. It:

1. checks whether the newest `artifacts/mobilechat-mobile-*.zip` already matches the current source/build files;
2. reuses that zip when it is current;
3. otherwise runs the local-file build and creates a new date-named zip;
4. generates a phone-friendly local layout whose `index.html` inlines the local CSS and JS bundle instead of depending on ES modules, service workers, or sibling script permissions;
5. pushes `index.html` and `source/` to the phone;
6. opens `/sdcard/Download/MobileChat/index.html` on the phone by default.

Use `-ForcePackage` when you intentionally want to rebuild and repackage even if a current zip already exists.

Use `-OpenTarget Url` to open the HTTPS PWA URL instead of the local file entry.

The device layout is:

```text
/sdcard/Download/MobileChat/
  index.html      # self-contained local entry
  source/
    app.css
    app.js
    favicon.svg
```

The local-file layout is for fast smoke testing. It deliberately does not register the PWA service worker because `file://` / `content://` have different browser storage, module loading, script permission, and service worker rules from HTTPS. The `source/` folder is still copied for manual inspection, but the local entry does not depend on loading `source/app.js`.

## Package a zip only

Build and create a static zip:

```powershell
.\scripts\deploy-android.ps1 -PackageOnly
```

Equivalent npm shortcut:

```powershell
npm run mobile:package
```

This uses the same deploy script and exits before checking `adb`.

The output is written under `artifacts/`, for example:

```text
artifacts/mobilechat-mobile-YYYYMMDD.zip
```

This zip contains the same `index.html` + `source/` layout and is useful for manually transferring files to the phone. It is not the preferred long-term runtime because local `file://` pages have a separate browser storage bucket from the HTTPS PWA origin.

## ADB prerequisites and upgrade behavior

Prerequisites:

- Android platform-tools installed and `adb` available in `PATH`;
- USB debugging enabled on the phone;
- the phone has authorized the computer.

Upgrade behavior:

- the phone app directory defaults to `/sdcard/Download/MobileChat`;
- `-DevicePath` is the final app directory, not a parent directory;
- an absolute `-DevicePath "/sdcard/Documents/MyChat"` is used as-is;
- a relative `-DevicePath "MyChat"` is resolved beside Android's normal `Download` folder, as `/sdcard/MyChat`;
- a nested relative `-DevicePath "Documents/MyChat"` resolves to `/sdcard/Documents/MyChat`;
- before pushing local static files, the script clears only the paths it currently manages: `<DevicePath>/source` and `<DevicePath>/index.html`;
- copied zip packages are not pushed by default; existing zip packages on the phone are left untouched;
- use `-PushZip` only when you intentionally want to also copy the local zip artifact to the phone;
- use `-KeepPreviousDist` only when you intentionally want to merge over the existing local file layout.

Useful options:

```powershell
.\scripts\deploy-android.ps1 -ForcePackage
.\scripts\deploy-android.ps1 -PackageOnly
.\scripts\deploy-android.ps1 -SkipBuild
.\scripts\deploy-android.ps1 -NoOpen
.\scripts\deploy-android.ps1 -NoPushDist
.\scripts\deploy-android.ps1 -KeepPreviousDist
.\scripts\deploy-android.ps1 -PushZip
.\scripts\deploy-android.ps1 -OpenTarget Url
.\scripts\deploy-android.ps1 -DevicePath "MyChat"
.\scripts\deploy-android.ps1 -DevicePath "Documents/MobileChatDev"
.\scripts\deploy-android.ps1 -DevicePath "/sdcard/Documents/MobileChatDev"
.\scripts\deploy-android.ps1 -Url "https://uc83824985.github.io/MobileChat/"
```

The ADB script does not install an APK. It places static artifacts on the phone for manual file management and can open either the local file entry or the PWA URL.

## When an APK is needed

If later testing requires a real Android package, use a fixed package name and signing key from the first build onward. Android app data survives APK upgrades only when package name and signing identity remain stable. A WebView/Capacitor/TWA wrapper should therefore be introduced deliberately, not as a quick deployment shortcut.
