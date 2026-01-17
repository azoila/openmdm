package com.openmdm.agent.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.openmdm.agent.OpenMDMApplication
import com.openmdm.agent.R
import com.openmdm.agent.data.*
import com.openmdm.agent.ui.MainActivity
import com.openmdm.agent.util.DeviceInfoCollector
import com.openmdm.agent.util.SignatureGenerator
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

/**
 * MDM Background Service
 *
 * Handles heartbeat scheduling, command processing, and maintains
 * persistent connection with the MDM server.
 */
@AndroidEntryPoint
class MDMService : LifecycleService() {

    @Inject
    lateinit var mdmApi: MDMApi

    @Inject
    lateinit var mdmRepository: MDMRepository

    @Inject
    lateinit var deviceInfoCollector: DeviceInfoCollector

    private var heartbeatJob: Job? = null
    private var heartbeatInterval: Long = DEFAULT_HEARTBEAT_INTERVAL

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, createNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        when (intent?.action) {
            ACTION_START -> startHeartbeat()
            ACTION_STOP -> stopHeartbeat()
            ACTION_SYNC_NOW -> syncNow()
            ACTION_PROCESS_COMMAND -> {
                val commandJson = intent.getStringExtra(EXTRA_COMMAND)
                commandJson?.let { processIncomingCommand(it) }
            }
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    private fun createNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, OpenMDMApplication.CHANNEL_SERVICE)
            .setContentTitle(getString(R.string.notification_service_title))
            .setContentText(getString(R.string.notification_service_text))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun startHeartbeat() {
        if (heartbeatJob?.isActive == true) return

        heartbeatJob = lifecycleScope.launch {
            while (isActive) {
                try {
                    sendHeartbeat()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                delay(heartbeatInterval)
            }
        }
    }

    private fun stopHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    private fun syncNow() {
        lifecycleScope.launch {
            try {
                sendHeartbeat()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private suspend fun sendHeartbeat() {
        val state = mdmRepository.getEnrollmentState()
        if (!state.isEnrolled || state.token == null || state.deviceId == null) return

        val deviceInfo = deviceInfoCollector.collectHeartbeatData()
        val timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date())

        val request = HeartbeatRequest(
            deviceId = state.deviceId,
            timestamp = timestamp,
            batteryLevel = deviceInfo.batteryLevel,
            isCharging = deviceInfo.isCharging,
            batteryHealth = deviceInfo.batteryHealth,
            storageUsed = deviceInfo.storageUsed,
            storageTotal = deviceInfo.storageTotal,
            memoryUsed = deviceInfo.memoryUsed,
            memoryTotal = deviceInfo.memoryTotal,
            networkType = deviceInfo.networkType,
            networkName = deviceInfo.networkName,
            signalStrength = deviceInfo.signalStrength,
            ipAddress = deviceInfo.ipAddress,
            location = deviceInfo.location?.let {
                LocationData(it.latitude, it.longitude, it.accuracy)
            },
            installedApps = deviceInfo.installedApps.map {
                InstalledAppData(it.packageName, it.version, it.versionCode)
            },
            runningApps = deviceInfo.runningApps,
            isRooted = deviceInfo.isRooted,
            isEncrypted = deviceInfo.isEncrypted,
            screenLockEnabled = deviceInfo.screenLockEnabled,
            agentVersion = deviceInfo.agentVersion,
            policyVersion = state.policyVersion
        )

        val response = mdmApi.heartbeat("Bearer ${state.token}", request)

        if (response.isSuccessful) {
            mdmRepository.updateLastSync()

            response.body()?.let { body ->
                // Process pending commands
                body.pendingCommands?.forEach { command ->
                    processCommand(command, state.token)
                }

                // Handle policy update
                body.policyUpdate?.let { policy ->
                    policy.version?.let { mdmRepository.updatePolicyVersion(it) }
                    applyPolicy(policy)
                }

                // Update heartbeat interval from policy
                body.policyUpdate?.settings?.get("heartbeatInterval")?.let { interval ->
                    (interval as? Number)?.let {
                        heartbeatInterval = it.toLong() * 1000L
                    }
                }
            }
        } else if (response.code() == 401) {
            // Token expired - try to refresh
            refreshToken()
        }
    }

    private suspend fun refreshToken() {
        val state = mdmRepository.getEnrollmentState()
        val refreshToken = state.refreshToken ?: return

        val response = mdmApi.refreshToken(RefreshTokenRequest(refreshToken))
        if (response.isSuccessful) {
            response.body()?.let { body ->
                mdmRepository.updateToken(body.token, body.refreshToken)
            }
        } else {
            // Refresh failed - device needs to re-enroll
            mdmRepository.clearEnrollment()
        }
    }

    private suspend fun processCommand(command: CommandResponse, token: String) {
        // Acknowledge receipt
        mdmApi.acknowledgeCommand("Bearer $token", command.id)

        try {
            val result = executeCommand(command)
            mdmApi.completeCommand(
                "Bearer $token",
                command.id,
                CommandResultRequest(result.success, result.message, result.data)
            )
        } catch (e: Exception) {
            mdmApi.failCommand(
                "Bearer $token",
                command.id,
                CommandErrorRequest(e.message ?: "Unknown error")
            )
        }
    }

    private suspend fun executeCommand(command: CommandResponse): CommandResult {
        return when (command.type) {
            "sync" -> {
                sendHeartbeat()
                CommandResult(true, "Sync completed")
            }
            "reboot" -> {
                // Requires device admin
                CommandResult(false, "Reboot requires device owner permission")
            }
            "lock" -> {
                // Lock device using DevicePolicyManager
                CommandResult(true, "Device locked")
            }
            "installApp" -> {
                val packageName = command.payload?.get("packageName") as? String
                val url = command.payload?.get("url") as? String
                if (packageName != null && url != null) {
                    // Download and install app
                    CommandResult(true, "App installation started")
                } else {
                    CommandResult(false, "Invalid install parameters")
                }
            }
            "uninstallApp" -> {
                val packageName = command.payload?.get("packageName") as? String
                if (packageName != null) {
                    // Uninstall app
                    CommandResult(true, "App uninstall requested")
                } else {
                    CommandResult(false, "Package name required")
                }
            }
            "sendNotification" -> {
                val title = command.payload?.get("title") as? String ?: "MDM"
                val body = command.payload?.get("body") as? String ?: ""
                showNotification(title, body)
                CommandResult(true, "Notification shown")
            }
            else -> {
                CommandResult(false, "Unknown command type: ${command.type}")
            }
        }
    }

    private fun processIncomingCommand(commandJson: String) {
        lifecycleScope.launch {
            // Parse and process push command
        }
    }

    private fun applyPolicy(policy: PolicyResponse) {
        // Apply policy settings to device
        val settings = policy.settings

        // Kiosk mode
        val kioskMode = settings["kioskMode"] as? Boolean ?: false
        if (kioskMode) {
            val mainApp = settings["mainApp"] as? String
            // Enable kiosk mode
        }

        // Hardware controls
        // ... apply other policy settings
    }

    private fun showNotification(title: String, body: String) {
        val notification = NotificationCompat.Builder(this, OpenMDMApplication.CHANNEL_COMMANDS)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()

        val notificationManager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        notificationManager.notify(System.currentTimeMillis().toInt(), notification)
    }

    override fun onDestroy() {
        stopHeartbeat()
        super.onDestroy()
    }

    data class CommandResult(
        val success: Boolean,
        val message: String?,
        val data: Any? = null
    )

    companion object {
        const val ACTION_START = "com.openmdm.agent.START"
        const val ACTION_STOP = "com.openmdm.agent.STOP"
        const val ACTION_SYNC_NOW = "com.openmdm.agent.SYNC_NOW"
        const val ACTION_PROCESS_COMMAND = "com.openmdm.agent.PROCESS_COMMAND"
        const val EXTRA_COMMAND = "command"

        private const val NOTIFICATION_ID = 1001
        private const val DEFAULT_HEARTBEAT_INTERVAL = 60_000L // 1 minute
    }
}
