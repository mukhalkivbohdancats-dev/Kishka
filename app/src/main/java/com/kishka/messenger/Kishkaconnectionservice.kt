package com.kishka.messenger

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.auth.FirebaseAuth

/**
 * Фонова служба: тримає зʼєднання з сервером, коли застосунок згорнуто або закрито, щоб нові повідомлення
 * приходили у вигляді сповіщень. Не використовує Firebase Cloud Messaging (Firebase потрібен лише для реєстрації).
 *
 * Фоновий режим завжди активний (окремого перемикача в налаштуваннях акаунта більше немає).
 * Служба також слухає вхідні дзвінки, тому дзвінок приходить, навіть коли застосунок закрито.
 */
class KishkaConnectionService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val user = FirebaseAuth.getInstance().currentUser
        val email = if (user != null && user.isEmailVerified) user.email?.trim()?.lowercase() else null
        if (email.isNullOrEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }

        createChannel()
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            e.printStackTrace()
            stopSelf()
            return START_NOT_STICKY
        }

        // Підключаємося до сервера та вмикаємо глобальний слухач повідомлень (показує сповіщення)
        try {
            KishkaManager(applicationContext).startGlobalMessageListener(email)
            CallCoordinator.init(applicationContext, email)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        return START_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                AppText.tr(this, "bg_channel"),
                NotificationManager.IMPORTANCE_MIN
            )
            channel.setShowBadge(false)
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(AppText.tr(this, "bg_notif_title"))
            .setContentText(AppText.tr(this, "bg_notif_text"))
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(pendingIntent)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "KishkaBackgroundChannel"
        private const val NOTIFICATION_ID = 4711
        private const val PREFS = "kishka_service_prefs"

        /** Фоновий режим завжди увімкнений. */
        @Suppress("UNUSED_PARAMETER")
        fun isEnabled(context: Context): Boolean = true

        /** Лишається для сумісності: фоновий режим вимкнути не можна. */
        @Suppress("UNUSED_PARAMETER")
        fun setEnabled(context: Context, enabled: Boolean) {
            start(context)
        }

        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, KishkaConnectionService::class.java))
            } catch (e: Exception) {
                // Android може заборонити запуск зі згорнутого стану — це не критично
                e.printStackTrace()
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, KishkaConnectionService::class.java))
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        /** Просить дозволити роботу без обмежень батареї (один раз) — так службу не вимикають агресивні оболонки. */
        fun requestBatteryExemption(context: Context) {
            try {
                val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                if (prefs.getBoolean("battery_asked", false)) return
                prefs.edit().putBoolean("battery_asked", true).apply()
                val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
                    val intent = Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + context.packageName)
                    ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                    context.startActivity(intent)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}

/** Після перезавантаження телефону знову запускає фонову службу. */
class KishkaBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        if (action == Intent.ACTION_BOOT_COMPLETED || action == "android.intent.action.QUICKBOOT_POWERON") {
            KishkaConnectionService.start(context)
        }
    }
}
