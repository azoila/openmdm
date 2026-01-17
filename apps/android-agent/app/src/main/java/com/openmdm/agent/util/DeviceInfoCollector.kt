package com.openmdm.agent.util

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import android.telephony.TelephonyManager
import com.openmdm.agent.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.net.NetworkInterface
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Collects device information for heartbeat and enrollment
 */
@Singleton
class DeviceInfoCollector @Inject constructor(
    @ApplicationContext private val context: Context
) {
    data class HeartbeatData(
        val batteryLevel: Int,
        val isCharging: Boolean,
        val batteryHealth: String?,
        val storageUsed: Long,
        val storageTotal: Long,
        val memoryUsed: Long,
        val memoryTotal: Long,
        val networkType: String?,
        val networkName: String?,
        val signalStrength: Int?,
        val ipAddress: String?,
        val location: LocationInfo?,
        val installedApps: List<InstalledAppInfo>,
        val runningApps: List<String>?,
        val isRooted: Boolean?,
        val isEncrypted: Boolean?,
        val screenLockEnabled: Boolean?,
        val agentVersion: String
    )

    data class LocationInfo(
        val latitude: Double,
        val longitude: Double,
        val accuracy: Float?
    )

    data class InstalledAppInfo(
        val packageName: String,
        val version: String,
        val versionCode: Long
    )

    data class DeviceInfo(
        val model: String,
        val manufacturer: String,
        val osVersion: String,
        val sdkVersion: Int,
        val serialNumber: String?,
        val imei: String?,
        val macAddress: String?,
        val androidId: String?
    )

    fun collectDeviceInfo(): DeviceInfo {
        return DeviceInfo(
            model = Build.MODEL,
            manufacturer = Build.MANUFACTURER,
            osVersion = Build.VERSION.RELEASE,
            sdkVersion = Build.VERSION.SDK_INT,
            serialNumber = getSerialNumber(),
            imei = getImei(),
            macAddress = getMacAddress(),
            androidId = getAndroidId()
        )
    }

    fun collectHeartbeatData(): HeartbeatData {
        return HeartbeatData(
            batteryLevel = getBatteryLevel(),
            isCharging = isCharging(),
            batteryHealth = getBatteryHealth(),
            storageUsed = getStorageUsed(),
            storageTotal = getStorageTotal(),
            memoryUsed = getMemoryUsed(),
            memoryTotal = getMemoryTotal(),
            networkType = getNetworkType(),
            networkName = getNetworkName(),
            signalStrength = getSignalStrength(),
            ipAddress = getIpAddress(),
            location = getLocation(),
            installedApps = getInstalledApps(),
            runningApps = getRunningApps(),
            isRooted = isRooted(),
            isEncrypted = isEncrypted(),
            screenLockEnabled = isScreenLockEnabled(),
            agentVersion = BuildConfig.VERSION_NAME
        )
    }

    private fun getBatteryLevel(): Int {
        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun isCharging(): Boolean {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        return status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
    }

    private fun getBatteryHealth(): String? {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        return when (intent?.getIntExtra(BatteryManager.EXTRA_HEALTH, -1)) {
            BatteryManager.BATTERY_HEALTH_GOOD -> "good"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "overheat"
            BatteryManager.BATTERY_HEALTH_DEAD -> "dead"
            BatteryManager.BATTERY_HEALTH_COLD -> "cold"
            else -> "unknown"
        }
    }

    private fun getStorageUsed(): Long {
        val stat = StatFs(Environment.getDataDirectory().path)
        val total = stat.blockCountLong * stat.blockSizeLong
        val available = stat.availableBlocksLong * stat.blockSizeLong
        return total - available
    }

    private fun getStorageTotal(): Long {
        val stat = StatFs(Environment.getDataDirectory().path)
        return stat.blockCountLong * stat.blockSizeLong
    }

    private fun getMemoryUsed(): Long {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memInfo)
        return memInfo.totalMem - memInfo.availMem
    }

    private fun getMemoryTotal(): Long {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memInfo)
        return memInfo.totalMem
    }

    private fun getNetworkType(): String? {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivityManager.activeNetwork ?: return "none"
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return "none"

        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "unknown"
        }
    }

    @SuppressLint("MissingPermission")
    private fun getNetworkName(): String? {
        return try {
            when (getNetworkType()) {
                "wifi" -> {
                    val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                    wifiManager.connectionInfo?.ssid?.removeSurrounding("\"")
                }
                "cellular" -> {
                    val telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
                    telephonyManager.networkOperatorName
                }
                else -> null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun getSignalStrength(): Int? {
        // Requires permission and API 28+
        return null
    }

    private fun getIpAddress(): String? {
        return try {
            NetworkInterface.getNetworkInterfaces()?.toList()
                ?.flatMap { it.inetAddresses.toList() }
                ?.firstOrNull { !it.isLoopbackAddress && it.hostAddress?.contains(':') == false }
                ?.hostAddress
        } catch (e: Exception) {
            null
        }
    }

    @SuppressLint("MissingPermission")
    private fun getLocation(): LocationInfo? {
        return try {
            val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

            val location: Location? = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)

            location?.let {
                LocationInfo(it.latitude, it.longitude, it.accuracy)
            }
        } catch (e: Exception) {
            null
        }
    }

    @SuppressLint("QueryPermissionsNeeded")
    private fun getInstalledApps(): List<InstalledAppInfo> {
        return try {
            val packageManager = context.packageManager
            val packages = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getInstalledPackages(PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getInstalledPackages(0)
            }

            packages.map { packageInfo ->
                InstalledAppInfo(
                    packageName = packageInfo.packageName,
                    version = packageInfo.versionName ?: "unknown",
                    versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        packageInfo.longVersionCode
                    } else {
                        @Suppress("DEPRECATION")
                        packageInfo.versionCode.toLong()
                    }
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun getRunningApps(): List<String>? {
        // Requires PACKAGE_USAGE_STATS permission
        return null
    }

    private fun isRooted(): Boolean {
        val paths = arrayOf(
            "/system/app/Superuser.apk",
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/system/sd/xbin/su",
            "/system/bin/failsafe/su",
            "/data/local/su"
        )

        return paths.any { File(it).exists() }
    }

    private fun isEncrypted(): Boolean {
        val devicePolicyManager = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return devicePolicyManager.storageEncryptionStatus == DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE
    }

    private fun isScreenLockEnabled(): Boolean {
        val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
        return keyguardManager.isDeviceSecure
    }

    @SuppressLint("HardwareIds")
    private fun getAndroidId(): String? {
        return try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        } catch (e: Exception) {
            null
        }
    }

    @SuppressLint("HardwareIds", "MissingPermission")
    private fun getImei(): String? {
        return try {
            val telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                null // IMEI is not accessible on Android 10+
            } else {
                @Suppress("DEPRECATION")
                telephonyManager.deviceId
            }
        } catch (e: Exception) {
            null
        }
    }

    @SuppressLint("HardwareIds")
    private fun getSerialNumber(): String? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                null // Serial is not accessible on Android 10+
            } else {
                @Suppress("DEPRECATION")
                Build.SERIAL
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun getMacAddress(): String? {
        return try {
            NetworkInterface.getNetworkInterfaces()?.toList()
                ?.find { it.name.equals("wlan0", ignoreCase = true) }
                ?.hardwareAddress
                ?.joinToString(":") { String.format("%02X", it) }
        } catch (e: Exception) {
            null
        }
    }
}
