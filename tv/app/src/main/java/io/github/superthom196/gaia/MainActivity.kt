package io.github.superthom196.gaia

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.WebView

/**
 * Gaia on the TV. The remote drives the globe: left and right spin it, up and
 * down zoom, OK flies to the next event, Menu opens the layers and Back
 * returns to slow spin. Home leaves the app, as on any TV app.
 *
 * `adb shell am start -n io.github.superthom196.gaia/.MainActivity -e url http://…/tv`
 * points the app (and the screensaver) at another address, and keeps it.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        takeUrl(intent)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = GaiaWeb.create(this)
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

    override fun dispatchKeyEvent(event: KeyEvent): Boolean =
        GaiaWeb.forward(web, event) || super.dispatchKeyEvent(event)

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
