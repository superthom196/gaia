package io.github.superthom196.gaia

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.view.KeyEvent
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * The WebView both the app and the screensaver show: Gaia's TV player page,
 * which plays the stream the box renders and sends key presses back to it.
 * The TV does no 3D work itself.
 */
object GaiaWeb {
    private const val PREFS = "gaia"
    private const val KEY_URL = "url"

    /** The player's address: set over ADB by Nexiom's TV setup, or the built-in default. */
    fun url(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_URL, null) ?: BuildConfig.DEFAULT_URL

    fun saveUrl(context: Context, url: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_URL, url).apply()
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun create(context: Context): WebView = WebView(context).apply {
        setBackgroundColor(Color.rgb(13, 15, 17))
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        webViewClient = object : WebViewClient() {
            // Retry until the box answers: it may still be starting up.
            override fun onReceivedError(
                view: WebView,
                request: android.webkit.WebResourceRequest,
                error: android.webkit.WebResourceError,
            ) {
                if (request.isForMainFrame) view.postDelayed({ view.loadUrl(url(context)) }, 5000)
            }
        }
        isFocusable = true
        isFocusableInTouchMode = true
        loadUrl(url(context))
    }

    /**
     * Keys the page can't see on its own. Arrows and OK reach the WebView as
     * ordinary key events; Menu and Back are handed to the page by name.
     */
    fun forward(view: WebView, event: KeyEvent): Boolean {
        val name = when (event.keyCode) {
            KeyEvent.KEYCODE_MENU -> "ContextMenu"
            KeyEvent.KEYCODE_BACK -> "Escape"
            else -> return false
        }
        if (event.action == KeyEvent.ACTION_UP) {
            view.evaluateJavascript("window.gaiaKey && window.gaiaKey('$name')", null)
        }
        return true
    }
}
