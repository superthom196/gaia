package io.github.superthom196.gaia

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView

/**
 * Gaia on the TV. The remote drives the globe: left and right spin it, up and
 * down zoom, OK or Menu opens the menu, and Back steps out: it closes the
 * menu, then returns to slow spin, then leaves the app. The box decides when
 * there's nothing left to undo and the page calls `GaiaApp.exit()`.
 *
 * `adb shell am start -n io.github.superthom196.gaia/.MainActivity -e url http://…/tv`
 * points the app (and the screensaver) at another address, and keeps it.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private var stopped = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        takeUrl(intent)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = GaiaWeb.create(this)
        web.addJavascriptInterface(Bridge(), "GaiaApp")
        setContentView(web)
        web.requestFocus()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (takeUrl(intent)) web.loadUrl(GaiaWeb.url(this))
    }

    private fun takeUrl(intent: Intent?): Boolean {
        val url = intent?.getStringExtra("url")?.takeIf { it.startsWith("http") } ?: return false
        GaiaWeb.saveUrl(this, url)
        return true
    }

    private inner class Bridge {
        @JavascriptInterface
        fun exit() = runOnUiThread { finish() }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean =
        GaiaWeb.forward(web, event) || super.dispatchKeyEvent(event)

    // Off screen (Home, another app, the TV in standby) the WebView would
    // keep watching, and the box would keep rendering for nobody. Hang up,
    // and pick up again when Gaia is back on screen.
    override fun onStart() {
        super.onStart()
        if (stopped) web.loadUrl(GaiaWeb.url(this))
        stopped = false
    }

    override fun onStop() {
        web.loadUrl("about:blank")
        stopped = true
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
