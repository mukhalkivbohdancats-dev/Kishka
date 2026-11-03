package com.kishka.messenger

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper

/**
 * Телефонні звуки дзвінка (як у звичайному телефоні):
 *  - довгі гудки, поки співрозмовник не підняв слухавку (startRingback / stopRingback);
 *  - сигнал «слухавку покладено» при завершенні дзвінка (playHangup).
 * Звуки йдуть через потік голосового дзвінка, тому слухаються в динамік біля вуха або на гучному зв'язку.
 */
class CallTones {
    private var ringback: ToneGenerator? = null
    private val handler = Handler(Looper.getMainLooper())

    fun startRingback() {
        stopRingback()
        try {
            ringback = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 80).also {
                it.startTone(ToneGenerator.TONE_SUP_RINGTONE)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun stopRingback() {
        try {
            ringback?.stopTone()
            ringback?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        ringback = null
    }

    fun playHangup() {
        stopRingback()
        try {
            val generator = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 80)
            generator.startTone(ToneGenerator.TONE_SUP_BUSY, 900)
            handler.postDelayed({
                try {
                    generator.release()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }, 1300)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
