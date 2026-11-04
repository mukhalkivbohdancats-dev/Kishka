package com.kishka.messenger

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.DisplayMetrics
import android.util.Range
import android.util.Size
import android.view.Display
import android.view.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import io.socket.client.Ack
import org.json.JSONObject
import java.nio.ByteBuffer
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * Відео в дзвінку: камера (задня за замовчуванням, перемикання на передню) і трансляція екрана телефона.
 *
 * Як це працює:
 *  - зображення з камери / екрана кодується апаратним H.264 (MediaCodec) в HD: камера 1280x720 30 к/с, екран до 1920 по довгій стороні;
 *  - кадри йдуть бінарно через той самий сервер Kishka (подія video_frame), без Firebase і без сторонніх серверів;
 *  - у співрозмовника кадри розкодовує MediaCodec прямо на екран (TextureView);
 *  - поворот телефона НЕ зупиняє відео: для камери передається кут повороту, для екрана кодер перебудовується під нову орієнтацію;
 *  - якщо мережа слабка, бітрейт сам знижується (контроль затору через підтвердження кадрів), а за потреби просимо ключовий кадр.
 *
 * Усе керування камерою/кодером виконується в одному окремому потоці (worker), стан для екрана — у полях з mutableStateOf.
 */
object CallVideo {

    private const val HEADER = 7                 // 1 байт прапорців, 2 байти номера, 4 байти часу
    private const val MAX_OUTSTANDING = 6        // скільки кадрів може бути «в дорозі», далі кадри відкидаються
    private const val MIN_BITRATE = 600_000

    // ------------------------------------------------------------------ стан для екрана (Compose)

    var localOn by mutableStateOf(false)
        private set
    var localSource by mutableStateOf("camera")   // "camera" | "screen"
        private set
    var frontCamera by mutableStateOf(false)
        private set
    var localW by mutableStateOf(1280)
        private set
    var localH by mutableStateOf(720)
        private set
    var localRot by mutableStateOf(0)
        private set

    var remoteOn by mutableStateOf(false)
        private set
    var remoteSource by mutableStateOf("camera")
        private set
    var remoteW by mutableStateOf(1280)
        private set
    var remoteH by mutableStateOf(720)
        private set
    var remoteRot by mutableStateOf(0)
        private set

    // ------------------------------------------------------------------ внутрішнє

    private val mainHandler = Handler(Looper.getMainLooper())
    private val workerThread: HandlerThread by lazy { HandlerThread("KishkaVideo").also { it.start() } }
    private val wh: Handler by lazy { Handler(workerThread.looper) }

    private var appCtx: Context? = null
    @Volatile private var me = ""
    @Volatile private var peer = ""

    private val videoRx = Receiver()

    private fun ui(block: () -> Unit) {
        mainHandler.post(block)
    }

    fun hasCameraPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun fail() {
        val ctx = appCtx ?: return
        ui { Notice.show(CallStrings.get("video_failed", AuthManager.getSavedLanguage(ctx))) }
    }

    // ------------------------------------------------------------------ життєвий цикл (викликає CallService)

    fun attach(context: Context, myEmail: String, peerEmail: String) {
        appCtx = context.applicationContext
        me = myEmail.trim().lowercase()
        peer = peerEmail.trim().lowercase()
        if (me.isEmpty()) return
        try {
            val s = KishkaManager.getSocket()
            s.off("video_frame_$me")
            s.on("video_frame_$me") { args ->
                val bytes = args.firstOrNull() as? ByteArray
                if (bytes != null) videoRx.push(bytes)
            }
            s.off("video_ctl_$me")
            s.on("video_ctl_$me") { args ->
                val obj = args.firstOrNull() as? JSONObject
                if (obj != null) onCtl(obj)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        videoRx.start()
    }

    fun detach() {
        val old = me
        wh.post { stopLocal(notifyPeer = false, keepUi = false) }
        videoRx.stop()
        if (old.isNotEmpty()) {
            try {
                val s = KishkaManager.getSocket()
                s.off("video_frame_$old")
                s.off("video_ctl_$old")
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        me = ""
        peer = ""
        ui {
            remoteOn = false
            localOn = false
        }
    }

    // ------------------------------------------------------------------ керування з екрана / сервісу

    fun startCamera(front: Boolean) {
        wh.post { startCameraInternal(front) }
    }

    fun flipCamera() {
        wh.post { if (mode == "camera") startCameraInternal(!frontNow) }
    }

    fun startScreen(resultCode: Int, data: Intent) {
        wh.post { startScreenInternal(resultCode, data) }
    }

    fun stopLocal() {
        wh.post { stopLocal(notifyPeer = true, keepUi = false) }
    }

    /** Поверхня віддаленого відео (TextureView на екрані дзвінка); null — екран згорнуто / відео вимкнено. */
    fun setRemoteSurface(surface: Surface?) {
        videoRx.surface = surface
        if (surface != null) videoRx.requestKey()
    }

    /** Маленьке вікно «я» для камери. */
    fun setLocalPreview(surface: Surface?, texture: SurfaceTexture?) {
        wh.post {
            localPreview = surface
            localPreviewTexture = texture
            if (mode == "camera" && camera != null) createSession()
        }
    }

    // ------------------------------------------------------------------ сигнали між телефонами

    private fun emitCtl(obj: JSONObject) {
        val target = peer
        if (target.isEmpty()) return
        try {
            val s = KishkaManager.getSocket()
            if (!s.connected()) return
            val json = JSONObject().apply {
                put("targetEmail", target)
                put("ctl", obj)
            }
            s.emit("video_ctl", json)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun sendState(on: Boolean) {
        emitCtl(JSONObject().apply {
            put("type", "state")
            put("on", on)
            put("source", if (mode.isEmpty()) "camera" else mode)
            put("w", encW)
            put("h", encH)
            put("rot", currentRot())
        })
    }

    private fun onCtl(o: JSONObject) {
        when (o.optString("type")) {
            "state" -> {
                val on = o.optBoolean("on", false)
                if (on) {
                    val w = o.optInt("w", 0)
                    val h = o.optInt("h", 0)
                    val rot = o.optInt("rot", 0)
                    val src = o.optString("source", "camera")
                    videoRx.configure(w, h)
                    ui {
                        remoteW = if (w > 0) w else 1280
                        remoteH = if (h > 0) h else 720
                        remoteRot = rot
                        remoteSource = src
                        remoteOn = true
                    }
                } else {
                    videoRx.reset()
                    ui { remoteOn = false }
                }
            }
            "pli" -> wh.post { requestSync() }
        }
    }

    // ================================================================== ВІДПРАВНИК (кодер + камера / екран)

    private class Enc(val codec: MediaCodec, val surface: Surface, val w: Int, val h: Int) {
        @Volatile var running = true
        @Volatile var csd: ByteArray? = null
        var worker: Thread? = null

        fun stop() {
            running = false
            try {
                worker?.join(400)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            try {
                codec.stop()
            } catch (e: Exception) {
                e.printStackTrace()
            }
            try {
                codec.release()
            } catch (e: Exception) {
                e.printStackTrace()
            }
            try {
                surface.release()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    @Volatile private var enc: Enc? = null
    @Volatile private var encW = 1280
    @Volatile private var encH = 720
    @Volatile private var mode = ""                 // "", "camera", "screen"
    @Volatile private var frontNow = false
    @Volatile private var needKey = true
    @Volatile private var lastAck = 0L
    private val outstanding = AtomicInteger(0)
    private var seq = 0

    private var camera: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var projection: MediaProjection? = null
    private var vdisplay: VirtualDisplay? = null
    private var gen = 0

    @Volatile private var localPreview: Surface? = null
    private var localPreviewTexture: SurfaceTexture? = null

    private var camSize = Size(1280, 720)
    private var camSensor = 90
    private var fpsRange: Range<Int>? = null

    private var curBitrate = 3_000_000
    private var maxBitrate = 3_000_000
    private var okTicks = 0
    private var tickCount = 0
    private var lastRotSent = -1
    private var screenLong = 1920
    private var lastLandscape = false

    private val tick = object : Runnable {
        override fun run() {
            if (mode.isEmpty()) return
            tickCount++
            try {
                adaptBitrate()
                if (mode == "screen") checkScreenOrientation()
                val rot = currentRot()
                if (rot != lastRotSent || tickCount % 6 == 0) {
                    lastRotSent = rot
                    ui { localRot = rot }
                    sendState(true)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            wh.postDelayed(this, 500)
        }
    }

    private fun displayRotationDeg(): Int {
        val dm = appCtx?.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
        val d = dm?.getDisplay(Display.DEFAULT_DISPLAY)
        return when (d?.rotation) {
            Surface.ROTATION_90 -> 90
            Surface.ROTATION_180 -> 180
            Surface.ROTATION_270 -> 270
            else -> 0
        }
    }

    /** Кут (за годинниковою стрілкою), на який треба повернути кадр, щоб він був прямим. Для екрана кадр уже прямий. */
    private fun currentRot(): Int {
        if (mode != "camera") return 0
        val dev = displayRotationDeg()
        return if (frontNow) (camSensor + dev) % 360 else (camSensor - dev + 360) % 360
    }

    // ---------------------------------------------------------------- кодер

    private fun encoderSupports(w: Int, h: Int): Boolean {
        return try {
            val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
            for (info in list.codecInfos) {
                if (!info.isEncoder) continue
                if (!info.supportedTypes.any { it.equals("video/avc", true) }) continue
                val caps = info.getCapabilitiesForType("video/avc").videoCapabilities ?: continue
                if (caps.isSizeSupported(w, h)) return true
            }
            false
        } catch (e: Exception) {
            e.printStackTrace()
            true
        }
    }

    private fun startEncoder(w: Int, h: Int, bitrate: Int, fps: Int, repeatFrames: Boolean): Enc? {
        var codec: MediaCodec? = null
        return try {
            val format = MediaFormat.createVideoFormat("video/avc", w, h).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
                setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)
                if (repeatFrames) setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 250_000L)
                if (Build.VERSION.SDK_INT >= 23) setInteger(MediaFormat.KEY_PRIORITY, 0)
                if (Build.VERSION.SDK_INT >= 30) setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
            }
            val c = MediaCodec.createEncoderByType("video/avc")
            codec = c
            c.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            val surface = c.createInputSurface()
            c.start()
            val e = Enc(c, surface, w, h)
            e.worker = thread(start = true, name = "KishkaVideoEnc") { encoderLoop(e) }
            e
        } catch (ex: Exception) {
            ex.printStackTrace()
            try {
                codec?.release()
            } catch (e2: Exception) {
                e2.printStackTrace()
            }
            null
        }
    }

    private fun encoderLoop(e: Enc) {
        val info = MediaCodec.BufferInfo()
        while (e.running) {
            val index = try {
                e.codec.dequeueOutputBuffer(info, 20_000)
            } catch (ex: Exception) {
                break
            }
            if (index < 0) continue
            try {
                val buf = e.codec.getOutputBuffer(index)
                if (buf != null && info.size > 0) {
                    buf.position(info.offset)
                    buf.limit(info.offset + info.size)
                    val data = ByteArray(info.size)
                    buf.get(data)
                    if ((info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                        e.csd = data
                    } else {
                        onEncoded(e, data, (info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0, info.presentationTimeUs)
                    }
                }
            } catch (ex: Exception) {
                ex.printStackTrace()
            }
            try {
                e.codec.releaseOutputBuffer(index, false)
            } catch (ex: Exception) {
                break
            }
        }
    }

    private fun onEncoded(e: Enc, data: ByteArray, key: Boolean, ptsUs: Long) {
        if (e !== enc) return
        if (key) needKey = false else if (needKey) return

        if (!key && outstanding.get() > MAX_OUTSTANDING) {
            if (SystemClock.elapsedRealtime() - lastAck > 3000L) {
                outstanding.set(0) // підтвердження не приходять (обрив) — не блокуємося назавжди
            } else {
                needKey = true
                requestSync()
                return
            }
        }

        val csd = e.csd
        val extra = if (key && csd != null) csd.size else 0
        val pkt = ByteArray(HEADER + extra + data.size)
        seq = (seq + 1) and 0xFFFF
        pkt[0] = if (key) 1.toByte() else 0.toByte()
        pkt[1] = (seq shr 8).toByte()
        pkt[2] = seq.toByte()
        val ms = (ptsUs / 1000L) and 0xFFFFFFFFL
        pkt[3] = (ms shr 24).toByte()
        pkt[4] = (ms shr 16).toByte()
        pkt[5] = (ms shr 8).toByte()
        pkt[6] = ms.toByte()
        var off = HEADER
        if (extra > 0 && csd != null) {
            System.arraycopy(csd, 0, pkt, off, extra)
            off += extra
        }
        System.arraycopy(data, 0, pkt, off, data.size)

        val target = peer
        if (target.isEmpty()) return
        try {
            val s = KishkaManager.getSocket()
            if (!s.connected()) return
            val json = JSONObject().apply {
                put("targetEmail", target)
                put("chunk", pkt)
            }
            outstanding.incrementAndGet()
            s.emit("video_frame", json, Ack {
                lastAck = SystemClock.elapsedRealtime()
                if (outstanding.decrementAndGet() < 0) outstanding.set(0)
            })
        } catch (ex: Exception) {
            ex.printStackTrace()
        }
    }

    private fun requestSync() {
        try {
            val c = enc?.codec ?: return
            c.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun setBitrate(value: Int) {
        try {
            val c = enc?.codec ?: return
            curBitrate = value
            c.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, value) })
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /** Мережа слабка (кадри не встигають доходити) — знижуємо якість, щоб не було затримки; стало краще — повертаємо. */
    private fun adaptBitrate() {
        val out = outstanding.get()
        if (out >= 4) {
            okTicks = 0
            val next = (curBitrate * 7 / 10).coerceAtLeast(MIN_BITRATE)
            if (next < curBitrate) setBitrate(next)
        } else if (out <= 1) {
            okTicks++
            if (okTicks >= 8) {
                okTicks = 0
                if (curBitrate < maxBitrate) setBitrate((curBitrate * 12 / 10).coerceAtMost(maxBitrate))
            }
        }
    }

    // ---------------------------------------------------------------- камера

    private fun pickSize(ch: CameraCharacteristics): Size {
        val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val sizes: Array<Size> = map?.getOutputSizes(MediaCodec::class.java)
            ?: map?.getOutputSizes(SurfaceTexture::class.java)
            ?: return Size(1280, 720)
        sizes.firstOrNull { it.width == 1280 && it.height == 720 }?.let { return it }
        val fit = sizes.filter { it.width <= 1280 && it.height <= 720 }.maxByOrNull { it.width * it.height }
        if (fit != null) return fit
        return sizes.minByOrNull { it.width * it.height } ?: Size(1280, 720)
    }

    @SuppressLint("MissingPermission")
    private fun startCameraInternal(front: Boolean) {
        val ctx = appCtx ?: return
        if (peer.isEmpty()) return
        if (!hasCameraPermission(ctx)) {
            fail()
            return
        }
        stopLocal(notifyPeer = false, keepUi = true)
        val myGen = ++gen
        try {
            val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val wanted = if (front) CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK
            var id: String? = null
            for (candidate in cm.cameraIdList) {
                if (cm.getCameraCharacteristics(candidate).get(CameraCharacteristics.LENS_FACING) == wanted) {
                    id = candidate
                    break
                }
            }
            if (id == null) id = cm.cameraIdList.firstOrNull()
            if (id == null) {
                fail()
                ui { localOn = false }
                return
            }
            val ch = cm.getCameraCharacteristics(id)
            frontNow = ch.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
            camSensor = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
            val size = pickSize(ch)
            camSize = size

            val ranges = ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
            fpsRange = ranges?.filter { it.upper == 30 }?.maxByOrNull { it.lower }
                ?: ranges?.maxByOrNull { it.upper }

            maxBitrate = 3_000_000
            curBitrate = maxBitrate
            val e = startEncoder(size.width, size.height, curBitrate, 30, false)
            if (e == null) {
                fail()
                ui { localOn = false }
                return
            }
            enc = e
            encW = size.width
            encH = size.height
            needKey = true
            mode = "camera"
            okTicks = 0
            lastRotSent = -1

            cm.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(cam: CameraDevice) {
                    if (myGen != gen) {
                        cam.close()
                        return
                    }
                    camera = cam
                    createSession()
                }

                override fun onDisconnected(cam: CameraDevice) {
                    cam.close()
                    if (myGen == gen) {
                        stopLocal(notifyPeer = true, keepUi = false)
                        fail()
                    }
                }

                override fun onError(cam: CameraDevice, error: Int) {
                    cam.close()
                    if (myGen == gen) {
                        stopLocal(notifyPeer = true, keepUi = false)
                        fail()
                    }
                }
            }, wh)

            val front2 = frontNow
            ui {
                localSource = "camera"
                frontCamera = front2
                localW = size.width
                localH = size.height
                localRot = 0
                localOn = true
            }
            sendState(true)
            wh.removeCallbacks(tick)
            wh.postDelayed(tick, 300)
        } catch (ex: Exception) {
            ex.printStackTrace()
            stopLocal(notifyPeer = false, keepUi = false)
            fail()
        }
    }

    @Suppress("DEPRECATION")
    private fun createSession() {
        val cam = camera ?: return
        val e = enc ?: return
        val myGen = gen
        val targets = ArrayList<Surface>()
        targets.add(e.surface)
        val prev = localPreview
        if (prev != null && prev.isValid) {
            try {
                localPreviewTexture?.setDefaultBufferSize(camSize.width, camSize.height)
            } catch (ex: Exception) {
                ex.printStackTrace()
            }
            targets.add(prev)
        }
        try {
            session?.close()
        } catch (ex: Exception) {
            ex.printStackTrace()
        }
        session = null
        try {
            cam.createCaptureSession(targets, object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(s: CameraCaptureSession) {
                    if (myGen != gen || camera !== cam) {
                        try {
                            s.close()
                        } catch (ex: Exception) {
                            ex.printStackTrace()
                        }
                        return
                    }
                    session = s
                    try {
                        val rb = cam.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
                        targets.forEach { rb.addTarget(it) }
                        rb.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                        fpsRange?.let { rb.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }
                        s.setRepeatingRequest(rb.build(), null, wh)
                    } catch (ex: Exception) {
                        ex.printStackTrace()
                    }
                }

                override fun onConfigureFailed(s: CameraCaptureSession) {
                    if (myGen == gen) {
                        stopLocal(notifyPeer = true, keepUi = false)
                        fail()
                    }
                }
            }, wh)
        } catch (ex: Exception) {
            ex.printStackTrace()
            stopLocal(notifyPeer = true, keepUi = false)
            fail()
        }
    }

    // ---------------------------------------------------------------- екран телефона

    private fun screenMetrics(): Triple<Int, Int, Int> {
        val dm = appCtx?.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
        val d = dm?.getDisplay(Display.DEFAULT_DISPLAY)
        val m = DisplayMetrics()
        @Suppress("DEPRECATION")
        d?.getRealMetrics(m)
        val w = if (m.widthPixels > 0) m.widthPixels else 1080
        val h = if (m.heightPixels > 0) m.heightPixels else 1920
        return Triple(w, h, if (m.densityDpi > 0) m.densityDpi else 320)
    }

    /** Розмір кадра трансляції: довга сторона = longSide, пропорції екрана, кратні 16 (так кодери працюють надійно). */
    private fun screenEncSize(sw: Int, sh: Int, longSide: Int): Pair<Int, Int> {
        val big = maxOf(sw, sh).toFloat()
        val scale = minOf(1f, longSide / big)
        fun align(v: Float): Int = (Math.round(v / 16f) * 16).coerceAtLeast(16)
        return Pair(align(sw * scale), align(sh * scale))
    }

    private fun startScreenInternal(resultCode: Int, data: Intent) {
        val ctx = appCtx ?: return
        if (peer.isEmpty()) return
        stopLocal(notifyPeer = false, keepUi = true)
        val myGen = ++gen
        try {
            val mpm = ctx.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val mp = mpm.getMediaProjection(resultCode, data)
            if (mp == null) {
                fail()
                ui { localOn = false }
                return
            }
            mp.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    // Користувач зупинив трансляцію системною кнопкою
                    if (projection === mp && myGen == gen) stopLocal(notifyPeer = true, keepUi = false)
                }
            }, wh)
            projection = mp

            val (sw, sh, dpi) = screenMetrics()
            var chosen: Enc? = null
            for (long in intArrayOf(1920, 1280, 960)) {
                val (ew, eh) = screenEncSize(sw, sh, long)
                if (!encoderSupports(ew, eh)) continue
                val bitrate = if (long >= 1920) 4_000_000 else 2_500_000
                maxBitrate = bitrate
                curBitrate = bitrate
                chosen = startEncoder(ew, eh, bitrate, 30, true)
                if (chosen != null) {
                    screenLong = long
                    break
                }
            }
            if (chosen == null) {
                stopLocal(notifyPeer = false, keepUi = false)
                fail()
                return
            }
            enc = chosen
            encW = chosen.w
            encH = chosen.h
            needKey = true
            mode = "screen"
            okTicks = 0
            lastRotSent = -1
            lastLandscape = sw > sh

            vdisplay = mp.createVirtualDisplay(
                "KishkaScreen", chosen.w, chosen.h, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, chosen.surface, null, null
            )

            val cw = chosen.w
            val chh = chosen.h
            ui {
                localSource = "screen"
                frontCamera = false
                localW = cw
                localH = chh
                localRot = 0
                localOn = true
            }
            sendState(true)
            wh.removeCallbacks(tick)
            wh.postDelayed(tick, 300)
        } catch (ex: Exception) {
            ex.printStackTrace()
            stopLocal(notifyPeer = false, keepUi = false)
            fail()
        }
    }

    /** Телефон повернули (портрет <-> «ігрове» положення): перебудовуємо кодер під нові пропорції, трансляція не переривається. */
    private fun checkScreenOrientation() {
        val vd = vdisplay ?: return
        val (sw, sh, dpi) = screenMetrics()
        val landscape = sw > sh
        if (landscape == lastLandscape) return
        lastLandscape = landscape

        val (ew, eh) = screenEncSize(sw, sh, screenLong)
        val ne = startEncoder(ew, eh, curBitrate, 30, true) ?: return
        val old = enc
        enc = ne
        encW = ne.w
        encH = ne.h
        needKey = true
        try {
            vd.setSurface(ne.surface)
            vd.resize(ne.w, ne.h, dpi)
        } catch (ex: Exception) {
            ex.printStackTrace()
        }
        old?.stop()
        sendState(true)
        val nw = ne.w
        val nh = ne.h
        ui {
            localW = nw
            localH = nh
        }
    }

    // ---------------------------------------------------------------- зупинка

    private fun stopLocal(notifyPeer: Boolean, keepUi: Boolean) {
        val had = mode.isNotEmpty()
        mode = ""
        gen++
        wh.removeCallbacks(tick)
        try {
            session?.close()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        session = null
        try {
            camera?.close()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        camera = null
        try {
            vdisplay?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        vdisplay = null
        val p = projection
        projection = null
        try {
            p?.stop()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        val e = enc
        enc = null
        e?.stop()
        outstanding.set(0)
        if (!keepUi) ui { localOn = false }
        if (notifyPeer && had) {
            emitCtl(JSONObject().apply {
                put("type", "state")
                put("on", false)
            })
        }
    }

    // ================================================================== ОТРИМУВАЧ (розкодування на екран)

    private class Receiver {
        @Volatile var surface: Surface? = null
        @Volatile private var w = 0
        @Volatile private var h = 0
        @Volatile private var running = false
        @Volatile private var forceKey = false
        @Volatile private var lastPli = 0L
        private var worker: Thread? = null
        private val queue = LinkedBlockingQueue<ByteArray>()

        fun start() {
            if (running) return
            running = true
            queue.clear()
            worker = thread(start = true, name = "KishkaVideoDec") { loop() }
        }

        fun stop() {
            running = false
            try {
                worker?.interrupt()
            } catch (e: Exception) {
                e.printStackTrace()
            }
            worker = null
            queue.clear()
            w = 0
            h = 0
        }

        fun configure(nw: Int, nh: Int) {
            if (nw != w || nh != h) {
                w = nw
                h = nh
                queue.clear()
                forceKey = true
            }
        }

        fun reset() {
            w = 0
            h = 0
            queue.clear()
        }

        fun push(packet: ByteArray) {
            if (!running) return
            if (queue.size > 12) {
                // Не встигаємо розкодовувати: викидаємо чергу й чекаємо ключовий кадр, щоб затримка не росла
                queue.clear()
                forceKey = true
                requestKey()
                return
            }
            queue.offer(packet)
        }

        fun requestKey() {
            val now = SystemClock.elapsedRealtime()
            if (now - lastPli < 600L) return
            lastPli = now
            val target = peer
            if (target.isEmpty()) return
            try {
                val s = KishkaManager.getSocket()
                if (!s.connected()) return
                val json = JSONObject().apply {
                    put("targetEmail", target)
                    put("ctl", JSONObject().apply { put("type", "pli") })
                }
                s.emit("video_ctl", json)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        private fun u8(b: Byte): Int = b.toInt() and 0xFF

        private fun loop() {
            var codec: MediaCodec? = null
            var codecSurface: Surface? = null
            var cw = 0
            var ch = 0
            var expect = -1
            var waitKey = true
            val info = MediaCodec.BufferInfo()

            fun release() {
                val c = codec
                codec = null
                try {
                    c?.stop()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                try {
                    c?.release()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            try {
                while (running) {
                    val pkt = try {
                        queue.poll(15, TimeUnit.MILLISECONDS)
                    } catch (e: InterruptedException) {
                        break
                    }
                    val surf = surface
                    if (forceKey) {
                        forceKey = false
                        waitKey = true
                    }
                    if (codec != null && (surf == null || surf !== codecSurface || w != cw || h != ch)) {
                        release()
                        waitKey = true
                        expect = -1
                        if (surf != null) requestKey()
                    }

                    if (pkt != null && pkt.size > HEADER) {
                        val key = (pkt[0].toInt() and 1) != 0
                        val seqNo = (u8(pkt[1]) shl 8) or u8(pkt[2])
                        if (expect >= 0 && seqNo != expect && !key) {
                            waitKey = true
                            requestKey()
                        }
                        expect = (seqNo + 1) and 0xFFFF
                        if (key) waitKey = false

                        if (!waitKey && surf != null && w > 0 && h > 0) {
                            if (codec == null && key) {
                                codec = createDecoder(surf, w, h, pkt)
                                if (codec != null) {
                                    codecSurface = surf
                                    cw = w
                                    ch = h
                                } else {
                                    waitKey = true
                                    requestKey()
                                }
                            }
                            val c = codec
                            if (c != null && !feed(c, pkt, key)) {
                                release()
                                waitKey = true
                                requestKey()
                            }
                        }
                    }

                    val c2 = codec
                    if (c2 != null && !drain(c2, info)) {
                        release()
                        waitKey = true
                        requestKey()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                release()
            }
        }

        private fun createDecoder(surf: Surface, w: Int, h: Int, pkt: ByteArray): MediaCodec? {
            var c: MediaCodec? = null
            return try {
                val format = MediaFormat.createVideoFormat("video/avc", w, h)
                val (sps, pps) = findParamSets(pkt, HEADER)
                if (sps != null) format.setByteBuffer("csd-0", ByteBuffer.wrap(sps))
                if (pps != null) format.setByteBuffer("csd-1", ByteBuffer.wrap(pps))
                format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 1024 * 1024)
                if (Build.VERSION.SDK_INT >= 30) format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
                val created = MediaCodec.createDecoderByType("video/avc")
                c = created
                created.configure(format, surf, null, 0)
                created.start()
                created
            } catch (e: Exception) {
                e.printStackTrace()
                try {
                    c?.release()
                } catch (e2: Exception) {
                    e2.printStackTrace()
                }
                null
            }
        }

        private fun feed(c: MediaCodec, pkt: ByteArray, key: Boolean): Boolean {
            return try {
                val index = c.dequeueInputBuffer(10_000)
                if (index < 0) return false
                val buf = c.getInputBuffer(index) ?: return false
                buf.clear()
                val len = pkt.size - HEADER
                if (len > buf.capacity()) {
                    c.queueInputBuffer(index, 0, 0, 0, 0)
                    return false
                }
                buf.put(pkt, HEADER, len)
                val ms = (u8(pkt[3]).toLong() shl 24) or (u8(pkt[4]).toLong() shl 16) or
                    (u8(pkt[5]).toLong() shl 8) or u8(pkt[6]).toLong()
                c.queueInputBuffer(index, 0, len, ms * 1000L, if (key) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                true
            } catch (e: Exception) {
                e.printStackTrace()
                false
            }
        }

        private fun drain(c: MediaCodec, info: MediaCodec.BufferInfo): Boolean {
            return try {
                var guard = 0
                while (guard++ < 8) {
                    val out = c.dequeueOutputBuffer(info, 0)
                    if (out >= 0) {
                        c.releaseOutputBuffer(out, true) // true = показати кадр одразу
                    } else if (out == MediaCodec.INFO_TRY_AGAIN_LATER) {
                        break
                    }
                }
                true
            } catch (e: Exception) {
                e.printStackTrace()
                false
            }
        }

        /** Знаходить SPS (тип 7) і PPS (тип 8) у потоці Annex-B: вони потрібні декодеру для запуску. */
        private fun findParamSets(d: ByteArray, from: Int): Pair<ByteArray?, ByteArray?> {
            val starts = ArrayList<IntArray>() // [початок стартового коду, початок NAL]
            var i = from
            while (i + 3 < d.size) {
                if (d[i].toInt() == 0 && d[i + 1].toInt() == 0 && d[i + 2].toInt() == 1) {
                    val sc = if (i > from && d[i - 1].toInt() == 0) i - 1 else i
                    starts.add(intArrayOf(sc, i + 3))
                    i += 3
                } else {
                    i++
                }
            }
            var sps: ByteArray? = null
            var pps: ByteArray? = null
            for (k in starts.indices) {
                val nalStart = starts[k][1]
                if (nalStart >= d.size) continue
                val end = if (k + 1 < starts.size) starts[k + 1][0] else d.size
                val type = d[nalStart].toInt() and 0x1F
                if (type == 7 && sps == null) sps = d.copyOfRange(starts[k][0], end)
                else if (type == 8 && pps == null) pps = d.copyOfRange(starts[k][0], end)
            }
            return Pair(sps, pps)
        }
    }
}
