package io.github.superthom196.gaia

import android.service.dreams.DreamService
import android.webkit.WebView

/**
 * The screensaver: the same player page, watching the box's shared ambient
 * stream (slow spin, and every minute or so a visit to a recent event). Not
 * interactive, so any key wakes the TV as usual.
 */
class GaiaDream : DreamService() {
    private var web: WebView? = null

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        isScreenBright = true
        web = GaiaWeb.create(this).also { setContentView(it) }
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        web?.onResume()
    }

    override fun onDreamingStopped() {
        web?.onPause()
        super.onDreamingStopped()
    }

    override fun onDetachedFromWindow() {
        web?.destroy()
        web = null
        super.onDetachedFromWindow()
    }
}
