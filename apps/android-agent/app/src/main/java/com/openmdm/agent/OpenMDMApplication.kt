package com.openmdm.agent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * OpenMDM Agent Application class
 *
 * Initializes Hilt dependency injection, notification channels,
 * and WorkManager for background processing.
 */
@HiltAndroidApp
class OpenMDMApplication : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(NotificationManager::class.java)

            // Service notification channel
            val serviceChannel = NotificationChannel(
                CHANNEL_SERVICE,
                getString(R.string.notification_channel_service),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_service_desc)
                setShowBadge(false)
            }
            notificationManager.createNotificationChannel(serviceChannel)

            // Commands notification channel
            val commandsChannel = NotificationChannel(
                CHANNEL_COMMANDS,
                getString(R.string.notification_channel_commands),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = getString(R.string.notification_channel_commands_desc)
                enableVibration(true)
            }
            notificationManager.createNotificationChannel(commandsChannel)
        }
    }

    companion object {
        const val CHANNEL_SERVICE = "mdm_service"
        const val CHANNEL_COMMANDS = "mdm_commands"
    }
}
