package com.openmdm.agent.service

import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.openmdm.agent.data.MDMApi
import com.openmdm.agent.data.MDMRepository
import com.openmdm.agent.data.PushTokenRequest
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Firebase Cloud Messaging service for receiving push commands
 */
@AndroidEntryPoint
class MDMFirebaseMessagingService : FirebaseMessagingService() {

    @Inject
    lateinit var mdmApi: MDMApi

    @Inject
    lateinit var mdmRepository: MDMRepository

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        super.onNewToken(token)

        // Register new token with server
        serviceScope.launch {
            try {
                val state = mdmRepository.getEnrollmentState()
                if (state.isEnrolled && state.token != null) {
                    mdmApi.registerPushToken(
                        "Bearer ${state.token}",
                        PushTokenRequest(provider = "fcm", token = token)
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        // Handle data message
        remoteMessage.data.let { data ->
            val type = data["type"] ?: return@let
            val payload = data["payload"]
            val timestamp = data["timestamp"]

            when (type) {
                "sync" -> {
                    // Trigger immediate sync
                    startMDMService(MDMService.ACTION_SYNC_NOW)
                }
                "command" -> {
                    // Process command
                    payload?.let {
                        startMDMService(MDMService.ACTION_PROCESS_COMMAND, it)
                    }
                }
                "wipe" -> {
                    // High-priority wipe command
                    // Handle device wipe
                }
                "lock" -> {
                    // High-priority lock command
                    // Lock device immediately
                }
                else -> {
                    // Unknown message type - trigger sync to get commands
                    startMDMService(MDMService.ACTION_SYNC_NOW)
                }
            }
        }

        // Handle notification message (if any)
        remoteMessage.notification?.let { notification ->
            // Show notification to user
        }
    }

    private fun startMDMService(action: String, command: String? = null) {
        val intent = Intent(this, MDMService::class.java).apply {
            this.action = action
            command?.let { putExtra(MDMService.EXTRA_COMMAND, it) }
        }
        startForegroundService(intent)
    }
}
