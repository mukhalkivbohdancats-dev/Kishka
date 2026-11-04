package com.kishka.messenger

import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Масштабує кадр у вікні так, щоб він був цілий (без розтягування), повертає на кут rot (за годинниковою стрілкою)
 * і, за потреби, віддзеркалює (для «себе» з передньої камери).
 * TextureView спершу розтягує кадр на все вікно, тому спочатку повертаємо його власні пропорції, потім обертаємо.
 */
fun applyVideoTransform(view: TextureView, videoW: Int, videoH: Int, rot: Int, mirror: Boolean) {
    val viewW = view.width.toFloat()
    val viewH = view.height.toFloat()
    if (viewW <= 0f || viewH <= 0f || videoW <= 0 || videoH <= 0) return

    val rotated = rot == 90 || rot == 270
    val shownW = (if (rotated) videoH else videoW).toFloat()
    val shownH = (if (rotated) videoW else videoH).toFloat()
    val scale = minOf(viewW / shownW, viewH / shownH)

    val cx = viewW / 2f
    val cy = viewH / 2f
    val m = Matrix()
    m.setScale(videoW * scale / viewW, videoH * scale / viewH, cx, cy)
    if (rot != 0) m.postRotate(rot.toFloat(), cx, cy)
    if (mirror) m.postScale(-1f, 1f, cx, cy)
    view.setTransform(m)
}

/** Відео співрозмовника (камера або екран його телефона). Кадри виводить декодер прямо на цю поверхню. */
@Composable
fun RemoteVideoView(modifier: Modifier = Modifier) {
    val vw = CallVideo.remoteW
    val vh = CallVideo.remoteH
    val rot = CallVideo.remoteRot

    AndroidView(
        modifier = modifier,
        factory = { context ->
            TextureView(context).apply {
                surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                    private var surface: Surface? = null

                    override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
                        val s = Surface(st)
                        surface = s
                        CallVideo.setRemoteSurface(s)
                        applyVideoTransform(this@apply, CallVideo.remoteW, CallVideo.remoteH, CallVideo.remoteRot, false)
                    }

                    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
                        applyVideoTransform(this@apply, CallVideo.remoteW, CallVideo.remoteH, CallVideo.remoteRot, false)
                    }

                    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                        CallVideo.setRemoteSurface(null)
                        try {
                            surface?.release()
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                        surface = null
                        return true
                    }

                    override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
                }
            }
        },
        update = { view -> applyVideoTransform(view, vw, vh, rot, false) }
    )
}

/** Маленьке вікно «я» (лише для камери). Передня камера показується дзеркально, як у звичайних відеодзвінках. */
@Composable
fun LocalPreviewView(modifier: Modifier = Modifier) {
    val vw = CallVideo.localW
    val vh = CallVideo.localH
    val rot = CallVideo.localRot
    val mirror = CallVideo.frontCamera

    AndroidView(
        modifier = modifier,
        factory = { context ->
            TextureView(context).apply {
                surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                    private var surface: Surface? = null

                    override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
                        val s = Surface(st)
                        surface = s
                        CallVideo.setLocalPreview(s, st)
                        applyVideoTransform(this@apply, CallVideo.localW, CallVideo.localH, CallVideo.localRot, CallVideo.frontCamera)
                    }

                    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
                        applyVideoTransform(this@apply, CallVideo.localW, CallVideo.localH, CallVideo.localRot, CallVideo.frontCamera)
                    }

                    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                        CallVideo.setLocalPreview(null, null)
                        try {
                            surface?.release()
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                        surface = null
                        return true
                    }

                    override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
                }
            }
        },
        update = { view -> applyVideoTransform(view, vw, vh, rot, mirror) }
    )
}
