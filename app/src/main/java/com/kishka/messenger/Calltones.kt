package com.kishka.messenger

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.sin

/**
 * Телефонні звуки дзвінка, які програє сам застосунок (не залежать від регіональних налаштувань системи):
 *  - довгі гудки, поки співрозмовник не підняв слухавку: 425 Гц, 1 с звук / 4 с тиші (як в Україні);
 *  - короткі гудки «слухавку покладено»: три сигнали по 0,35 с;
 *  - запасна мелодія вхідного дзвінка, якщо системний рингтон недоступний.
 * Гудки йдуть через той самий канал, що й голос розмови, тому їх чутно біля вуха і на гучному зв'язку, а гучність
 * регулюється кнопками гучності телефона.
 */
class CallTones {
    private val handler = Handler(Looper.getMainLooper())

    @Volatile private var ringbackOn = false
    private var ringbackThread: Thread? = null
    @Volatile private var ringbackTrack: AudioTrack? = null

    @Volatile private var melodyOn = false
    private var melodyThread: Thread? = null
    @Volatile private var melodyTrack: AudioTrack? = null

    private fun buildTrack(rate: Int, bytes: Int, voice: Boolean): AudioTrack? {
        return try {
            val attrs = AudioAttributes.Builder()
                .setUsage(if (voice) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(if (voice) AudioAttributes.CONTENT_TYPE_SPEECH else AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(rate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build()
            val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val builder = AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(format)
                .setBufferSizeInBytes(maxOf(min, bytes))
                .setTransferMode(AudioTrack.MODE_STREAM)
            builder.build()
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private fun tone(rate: Int, freqs: DoubleArray, ms: Int, amp: Double): ShortArray {
        val n = rate * ms / 1000
        val out = ShortArray(n)
        val fade = (rate * 0.01).toInt().coerceAtLeast(1) // 10 мс плавного входу/виходу — без клацання
        for (i in 0 until n) {
            var v = 0.0
            for (f in freqs) v += sin(2.0 * PI * f * i / rate)
            v = v / freqs.size * amp
            val env = when {
                i < fade -> i.toDouble() / fade
                i > n - fade -> (n - i).toDouble() / fade
                else -> 1.0
            }
            out[i] = (v * env * Short.MAX_VALUE).toInt().toShort()
        }
        return out
    }

    private fun silence(rate: Int, ms: Int) = ShortArray(rate * ms / 1000)

    // ---------------------------------------------------------------- довгі гудки (ringback)

    fun startRingback() {
        stopRingback()
        ringbackOn = true
        ringbackThread = thread(start = true, name = "KishkaRingback") {
            val rate = 16000
            val beep = tone(rate, doubleArrayOf(425.0), 1000, 0.55)
            val gap = silence(rate, 4000)
            val track = buildTrack(rate, rate * 2, voice = true)
            if (track == null) {
                ringbackOn = false
                return@thread
            }
            ringbackTrack = track
            try {
                track.setVolume(1f)
                track.play()
                while (ringbackOn) {
                    track.write(beep, 0, beep.size)
                    var left = gap.size
                    var offset = 0
                    while (ringbackOn && left > 0) {
                        val part = minOf(left, rate / 5)
                        track.write(gap, offset, part)
                        offset += part
                        left -= part
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                ringbackTrack = null
                try {
                    track.pause()
                    track.flush()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                try {
                    track.release()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }

    fun stopRingback() {
        ringbackOn = false
        try {
            ringbackTrack?.pause()
            ringbackTrack?.flush()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        try {
            ringbackThread?.join(400)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        ringbackThread = null
    }

    // ---------------------------------------------------------------- «слухавку покладено»

    /** Три короткі гудки; після них викликається onDone (повернути звукові налаштування телефона). */
    fun playHangup(onDone: () -> Unit) {
        stopRingback()
        thread(start = true, name = "KishkaHangupTone") {
            val rate = 16000
            val beep = tone(rate, doubleArrayOf(425.0), 350, 0.55)
            val gap = silence(rate, 350)
            val all = ShortArray(beep.size * 3 + gap.size * 3)
            var p = 0
            for (i in 0 until 3) {
                System.arraycopy(beep, 0, all, p, beep.size)
                p += beep.size
                System.arraycopy(gap, 0, all, p, gap.size)
                p += gap.size
            }
            val track = buildTrack(rate, all.size * 2, voice = true)
            if (track == null) {
                handler.post { onDone() }
                return@thread
            }
            try {
                track.setVolume(1f)
                track.play()
                track.write(all, 0, all.size)
                Thread.sleep((all.size * 1000L / rate) + 150L)
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                try {
                    track.stop()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                try {
                    track.release()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                handler.post { onDone() }
            }
        }
    }

    // ---------------------------------------------------------------- запасна мелодія вхідного дзвінка

    fun startIncomingMelody() {
        stopIncomingMelody()
        melodyOn = true
        melodyThread = thread(start = true, name = "KishkaIncomingMelody") {
            val rate = 16000
            val a = tone(rate, doubleArrayOf(659.0, 1318.0), 220, 0.5)
            val b = tone(rate, doubleArrayOf(523.0, 1046.0), 220, 0.5)
            val c = tone(rate, doubleArrayOf(784.0, 1568.0), 360, 0.5)
            val pause = silence(rate, 80)
            val long = silence(rate, 1800)
            val track = buildTrack(rate, rate * 2, voice = false)
            if (track == null) {
                melodyOn = false
                return@thread
            }
            melodyTrack = track
            try {
                // Запасна мелодія — тихіше, а не «на весь дім»
                track.setVolume(0.35f)
                track.play()
                while (melodyOn) {
                    for (part in arrayOf(a, pause, b, pause, a, pause, c, long)) {
                        if (!melodyOn) break
                        track.write(part, 0, part.size)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                melodyTrack = null
                try {
                    track.pause()
                    track.flush()
                    track.release()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }

    fun stopIncomingMelody() {
        melodyOn = false
        try {
            melodyTrack?.pause()
            melodyTrack?.flush()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        try {
            melodyThread?.join(400)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        melodyThread = null
    }

    fun stopAll() {
        stopRingback()
        stopIncomingMelody()
    }
}
