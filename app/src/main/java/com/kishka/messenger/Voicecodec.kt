package com.kishka.messenger

/**
 * Стиснення голосу для дзвінків Kishka (IMA ADPCM, 4 біти на семпл).
 *
 * Порівняно зі старою схемою (сирий PCM 16 кГц у base64 ≈ 340 кбіт/с) обсяг даних зменшено у 3–4 рази,
 * а якість підвищено: 24 кГц (HD-голос) ≈ 97 кбіт/с, 16 кГц ≈ 65 кбіт/с.
 *
 * Кожен пакет самодостатній (у заголовку лежить стан декодера), тому втрата або запізнення одного пакета
 * не псує наступні.
 *
 * Формат пакета (всі числа big-endian):
 *   [0]    магічний байт 0x4B
 *   [1]    код частоти дискретизації: 1 = 16000 Гц, 2 = 24000 Гц
 *   [2..3] номер пакета (0..65535)
 *   [4..5] початковий предиктор (int16)
 *   [6]    початковий індекс кроку (0..88)
 *   [7..]  семпли по 4 біти (молодша половина байта = перший семпл)
 */
object VoiceCodec {

    const val HEADER_SIZE = 7
    private const val MAGIC: Byte = 0x4B

    private val STEP_TABLE = intArrayOf(
        7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97,
        107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
        876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
        5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623,
        27086, 29794, 32767
    )

    private val INDEX_TABLE = intArrayOf(-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8)

    /** Стан кодувальника (зберігається між пакетами одного виклику). */
    class EncoderState {
        var predictor: Int = 0
        var index: Int = 0
    }

    fun rateToCode(sampleRate: Int): Int = if (sampleRate == 24000) 2 else 1

    fun codeToRate(code: Int): Int = when (code) {
        2 -> 24000
        1 -> 16000
        else -> 0
    }

    /** Повертає частоту дискретизації пакета або 0, якщо це не наш пакет. */
    fun packetSampleRate(packet: ByteArray): Int {
        if (packet.size <= HEADER_SIZE || packet[0] != MAGIC) return 0
        return codeToRate(packet[1].toInt() and 0xFF)
    }

    fun packetSequence(packet: ByteArray): Int {
        if (packet.size < HEADER_SIZE) return -1
        return ((packet[2].toInt() and 0xFF) shl 8) or (packet[3].toInt() and 0xFF)
    }

    private fun encodeSample(state: EncoderState, sample: Int): Int {
        val step = STEP_TABLE[state.index]
        var diff = sample - state.predictor
        var code = 0
        if (diff < 0) {
            code = 8
            diff = -diff
        }
        var vpdiff = step shr 3
        var temp = step
        if (diff >= temp) {
            code = code or 4
            diff -= temp
            vpdiff += temp
        }
        temp = temp shr 1
        if (diff >= temp) {
            code = code or 2
            diff -= temp
            vpdiff += temp
        }
        temp = temp shr 1
        if (diff >= temp) {
            code = code or 1
            vpdiff += temp
        }
        if ((code and 8) != 0) state.predictor -= vpdiff else state.predictor += vpdiff
        if (state.predictor > 32767) state.predictor = 32767
        if (state.predictor < -32768) state.predictor = -32768
        state.index += INDEX_TABLE[code]
        if (state.index < 0) state.index = 0
        if (state.index > 88) state.index = 88
        return code
    }

    /** Кодує [count] семплів PCM16 у пакет. [count] округлюється вниз до парного числа. */
    fun encodePacket(rateCode: Int, sequence: Int, pcm: ShortArray, count: Int, state: EncoderState): ByteArray {
        val n = count - (count % 2)
        val out = ByteArray(HEADER_SIZE + n / 2)
        out[0] = MAGIC
        out[1] = rateCode.toByte()
        out[2] = (sequence shr 8).toByte()
        out[3] = sequence.toByte()
        out[4] = (state.predictor shr 8).toByte()
        out[5] = state.predictor.toByte()
        out[6] = state.index.toByte()

        var outPos = HEADER_SIZE
        var i = 0
        while (i < n) {
            val low = encodeSample(state, pcm[i].toInt())
            val high = encodeSample(state, pcm[i + 1].toInt())
            out[outPos] = (low or (high shl 4)).toByte()
            outPos++
            i += 2
        }
        return out
    }

    /** Розкодовує пакет у PCM16. Повертає null, якщо пакет некоректний. */
    fun decodePacket(packet: ByteArray): ShortArray? {
        if (packet.size <= HEADER_SIZE || packet[0] != MAGIC) return null

        var predictor = (packet[4].toInt() shl 8) or (packet[5].toInt() and 0xFF)
        var index = packet[6].toInt() and 0xFF
        if (index > 88) index = 88

        val samples = (packet.size - HEADER_SIZE) * 2
        val out = ShortArray(samples)
        var outPos = 0

        for (b in HEADER_SIZE until packet.size) {
            val value = packet[b].toInt() and 0xFF
            for (half in 0..1) {
                val code = if (half == 0) (value and 0x0F) else ((value shr 4) and 0x0F)
                val step = STEP_TABLE[index]
                var vpdiff = step shr 3
                if ((code and 4) != 0) vpdiff += step
                if ((code and 2) != 0) vpdiff += step shr 1
                if ((code and 1) != 0) vpdiff += step shr 2
                if ((code and 8) != 0) predictor -= vpdiff else predictor += vpdiff
                if (predictor > 32767) predictor = 32767
                if (predictor < -32768) predictor = -32768
                index += INDEX_TABLE[code]
                if (index < 0) index = 0
                if (index > 88) index = 88
                out[outPos] = predictor.toShort()
                outPos++
            }
        }
        return out
    }
}
