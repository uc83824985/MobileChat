package com.uc83824985.mobilechat;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST_CODE = 22018;
    private static final String EXPORT_DIRECTORY_NAME = "MobileChat";
    private static final String MOBILECHAT_ARCHIVE_EXTENSION = ".mobilechat";
    private static final String MOBILECHAT_ARCHIVE_MIME_TYPE = "application/vnd.mobilechat+zip";

    private WebView webView;
    private boolean statusBarHidden = false;
    @Nullable
    private ValueCallback<Uri[]> pendingFileChooser;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        webView = new WebView(this);
        webView.setLayoutParams(
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        setContentView(webView);

        configureWebView(webView);
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(BuildConfig.MOBILECHAT_WEBVIEW_ENTRY_URL);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyStatusBarVisibility();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view) {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        view.addJavascriptInterface(new MobileChatAndroidBridge(), "MobileChatAndroid");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .setDomain(BuildConfig.MOBILECHAT_WEBVIEW_ASSET_DOMAIN)
            .addPathHandler(
                BuildConfig.MOBILECHAT_WEBVIEW_ASSET_PATH,
                new WebViewAssetLoader.AssetsPathHandler(this)
            )
            .build();

        view.setWebViewClient(new WebViewClientCompat() {
            @Override
            @Nullable
            public WebResourceResponse shouldInterceptRequest(
                WebView view,
                WebResourceRequest request
            ) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            @Nullable
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                if (pendingFileChooser != null) {
                    pendingFileChooser.onReceiveValue(null);
                }

                pendingFileChooser = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                } catch (ActivityNotFoundException error) {
                    pendingFileChooser = null;
                    filePathCallback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });
    }

    private final class MobileChatAndroidBridge {
        @JavascriptInterface
        public String saveArchive(String fileName, String base64Data) {
            try {
                String safeFileName = sanitizeArchiveFileName(fileName);
                byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
                String path = saveArchiveBytes(safeFileName, data);
                return createBridgeResult(true, path, null);
            } catch (Exception error) {
                return createBridgeResult(false, null, error.getMessage());
            }
        }

        @JavascriptInterface
        public void setStatusBarHidden(boolean enabled) {
            runOnUiThread(() -> {
                statusBarHidden = enabled;
                applyStatusBarVisibility();
            });
        }
    }

    private String sanitizeArchiveFileName(@Nullable String fileName) {
        String fallbackName = "mobilechat-export" + MOBILECHAT_ARCHIVE_EXTENSION;
        if (fileName == null) {
            return fallbackName;
        }

        String sanitized = fileName
            .replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", "_")
            .trim();
        if (sanitized.isEmpty()) {
            return fallbackName;
        }
        if (!sanitized.endsWith(MOBILECHAT_ARCHIVE_EXTENSION)) {
            sanitized = sanitized + MOBILECHAT_ARCHIVE_EXTENSION;
        }
        return sanitized;
    }

    private String saveArchiveBytes(String fileName, byte[] data) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return saveArchiveWithMediaStore(fileName, data);
        }
        return saveArchiveToLegacyDownloads(fileName, data);
    }

    private String saveArchiveWithMediaStore(String fileName, byte[] data) throws IOException {
        ContentResolver resolver = getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
        values.put(MediaStore.Downloads.MIME_TYPE, MOBILECHAT_ARCHIVE_MIME_TYPE);
        values.put(
            MediaStore.Downloads.RELATIVE_PATH,
            Environment.DIRECTORY_DOWNLOADS + File.separator + EXPORT_DIRECTORY_NAME
        );
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            throw new IOException("无法创建下载文件。");
        }

        try (OutputStream outputStream = resolver.openOutputStream(uri)) {
            if (outputStream == null) {
                throw new IOException("无法打开下载文件。");
            }
            outputStream.write(data);
        } catch (IOException error) {
            resolver.delete(uri, null, null);
            throw error;
        }

        ContentValues publishedValues = new ContentValues();
        publishedValues.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, publishedValues, null, null);

        return "/sdcard/"
            + Environment.DIRECTORY_DOWNLOADS
            + "/"
            + EXPORT_DIRECTORY_NAME
            + "/"
            + fileName;
    }

    @SuppressWarnings("deprecation")
    private String saveArchiveToLegacyDownloads(String fileName, byte[] data) throws IOException {
        File directory = new File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            EXPORT_DIRECTORY_NAME
        );
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("无法创建导出目录：" + directory.getAbsolutePath());
        }

        File outputFile = new File(directory, fileName);
        try (FileOutputStream outputStream = new FileOutputStream(outputFile)) {
            outputStream.write(data);
        }
        return outputFile.getAbsolutePath();
    }

    private String createBridgeResult(boolean ok, @Nullable String path, @Nullable String error) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", ok);
            if (path != null) {
                result.put("path", path);
            }
            if (error != null) {
                result.put("error", error);
            }
            return result.toString();
        } catch (JSONException ignored) {
            return ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Android bridge failed.\"}";
        }
    }

    private void applyStatusBarVisibility() {
        Window window = getWindow();
        applyDisplayCutoutMode(window);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(!statusBarHidden);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);

            WindowInsetsController controller = window.getInsetsController();
            if (controller == null) {
                return;
            }

            if (statusBarHidden) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            } else {
                controller.show(WindowInsets.Type.systemBars());
            }
            return;
        }

        View decorView = window.getDecorView();
        int flags = decorView.getSystemUiVisibility();
        if (statusBarHidden) {
            window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            flags |= View.SYSTEM_UI_FLAG_FULLSCREEN;
            flags |= View.SYSTEM_UI_FLAG_HIDE_NAVIGATION;
            flags |= View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            flags |= View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
            flags |= View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            flags |= View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            flags &= ~View.SYSTEM_UI_FLAG_FULLSCREEN;
            flags &= ~View.SYSTEM_UI_FLAG_HIDE_NAVIGATION;
            flags &= ~View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            flags &= ~View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
            flags &= ~View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            flags &= ~View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        }
        decorView.setSystemUiVisibility(flags);
    }

    private void applyDisplayCutoutMode(Window window) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return;
        }

        WindowManager.LayoutParams attributes = window.getAttributes();
        attributes.layoutInDisplayCutoutMode = statusBarHidden
            ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
        window.setAttributes(attributes);
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyStatusBarVisibility();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyStatusBarVisibility();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST_CODE || pendingFileChooser == null) {
            return;
        }

        Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        pendingFileChooser.onReceiveValue(results);
        pendingFileChooser = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            webView.saveState(outState);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingFileChooser != null) {
            pendingFileChooser.onReceiveValue(null);
            pendingFileChooser = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
