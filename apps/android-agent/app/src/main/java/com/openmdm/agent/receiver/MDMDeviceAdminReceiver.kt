package com.openmdm.agent.receiver

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import com.openmdm.agent.R

/**
 * Device Admin Receiver for MDM policies
 *
 * Handles device administrator events and enables device management features
 * such as password policies, wipe, and lock.
 */
class MDMDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Toast.makeText(
            context,
            "Device admin enabled",
            Toast.LENGTH_SHORT
        ).show()
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Toast.makeText(
            context,
            "Device admin disabled",
            Toast.LENGTH_SHORT
        ).show()
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        return context.getString(R.string.device_admin_description)
    }

    override fun onPasswordChanged(context: Context, intent: Intent, userHandle: android.os.UserHandle) {
        super.onPasswordChanged(context, intent, userHandle)
        // Report password change event
    }

    override fun onPasswordFailed(context: Context, intent: Intent, userHandle: android.os.UserHandle) {
        super.onPasswordFailed(context, intent, userHandle)
        // Report failed password attempt
    }

    override fun onPasswordSucceeded(context: Context, intent: Intent, userHandle: android.os.UserHandle) {
        super.onPasswordSucceeded(context, intent, userHandle)
        // Report successful unlock
    }

    companion object {
        fun getComponentName(context: Context): android.content.ComponentName {
            return android.content.ComponentName(context, MDMDeviceAdminReceiver::class.java)
        }
    }
}
