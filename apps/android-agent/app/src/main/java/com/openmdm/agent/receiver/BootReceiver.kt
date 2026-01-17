package com.openmdm.agent.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.openmdm.agent.service.MDMService

/**
 * Boot Receiver to start MDM service on device boot
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                // Start MDM service
                val serviceIntent = Intent(context, MDMService::class.java).apply {
                    action = MDMService.ACTION_START
                }
                context.startForegroundService(serviceIntent)
            }
        }
    }
}
