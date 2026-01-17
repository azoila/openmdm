package com.openmdm.agent.ui

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.openmdm.agent.BuildConfig
import com.openmdm.agent.R
import com.openmdm.agent.data.*
import com.openmdm.agent.receiver.MDMDeviceAdminReceiver
import com.openmdm.agent.service.MDMService
import com.openmdm.agent.ui.theme.OpenMDMAgentTheme
import com.openmdm.agent.util.DeviceInfoCollector
import com.openmdm.agent.util.SignatureGenerator
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var mdmRepository: MDMRepository

    @Inject
    lateinit var mdmApi: MDMApi

    @Inject
    lateinit var deviceInfoCollector: DeviceInfoCollector

    @Inject
    lateinit var signatureGenerator: SignatureGenerator

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        // Handle permission results
    }

    private val deviceAdminLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        // Handle device admin result
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestPermissions()

        setContent {
            OpenMDMAgentTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainScreen(
                        mdmRepository = mdmRepository,
                        mdmApi = mdmApi,
                        deviceInfoCollector = deviceInfoCollector,
                        signatureGenerator = signatureGenerator,
                        onRequestDeviceAdmin = { requestDeviceAdmin() },
                        onStartService = { startMDMService() }
                    )
                }
            }
        }
    }

    private fun requestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.READ_PHONE_STATE
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            permissions.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }

        permissionLauncher.launch(permissions.toTypedArray())
    }

    private fun requestDeviceAdmin() {
        val componentName = ComponentName(this, MDMDeviceAdminReceiver::class.java)
        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, componentName)
            putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                getString(R.string.device_admin_description)
            )
        }
        deviceAdminLauncher.launch(intent)
    }

    private fun startMDMService() {
        val intent = Intent(this, MDMService::class.java).apply {
            action = MDMService.ACTION_START
        }
        startForegroundService(intent)
    }
}

@Composable
fun MainScreen(
    mdmRepository: MDMRepository,
    mdmApi: MDMApi,
    deviceInfoCollector: DeviceInfoCollector,
    signatureGenerator: SignatureGenerator,
    onRequestDeviceAdmin: () -> Unit,
    onStartService: () -> Unit
) {
    val enrollmentState by mdmRepository.enrollmentState.collectAsStateWithLifecycle(
        initialValue = EnrollmentState()
    )
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var isEnrolling by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineMedium
        )

        Spacer(modifier = Modifier.height(32.dp))

        // Status Card
        Card(
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp)
            ) {
                Text(
                    text = "Status",
                    style = MaterialTheme.typography.titleMedium
                )
                Spacer(modifier = Modifier.height(8.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val statusColor = when {
                        enrollmentState.isEnrolled -> MaterialTheme.colorScheme.primary
                        else -> MaterialTheme.colorScheme.error
                    }
                    Surface(
                        color = statusColor,
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.size(12.dp)
                    ) {}
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = if (enrollmentState.isEnrolled)
                            stringResource(R.string.status_enrolled)
                        else
                            stringResource(R.string.status_not_enrolled)
                    )
                }

                if (enrollmentState.isEnrolled) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Device ID: ${enrollmentState.deviceId}",
                        style = MaterialTheme.typography.bodySmall
                    )
                    enrollmentState.lastSync?.let { timestamp ->
                        val dateFormat = SimpleDateFormat("MMM dd, HH:mm", Locale.getDefault())
                        Text(
                            text = stringResource(R.string.last_sync, dateFormat.format(Date(timestamp))),
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Device Admin Card
        Card(
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp)
            ) {
                Text(
                    text = "Device Administrator",
                    style = MaterialTheme.typography.titleMedium
                )
                Spacer(modifier = Modifier.height(8.dp))

                val isDeviceAdmin = isDeviceAdmin(context)
                Text(
                    text = if (isDeviceAdmin) "Enabled" else "Not enabled",
                    style = MaterialTheme.typography.bodyMedium
                )

                if (!isDeviceAdmin) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = onRequestDeviceAdmin) {
                        Text(stringResource(R.string.device_admin_enable))
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Error message
        errorMessage?.let { error ->
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(16.dp)
                )
            }
            Spacer(modifier = Modifier.height(16.dp))
        }

        // Actions
        if (!enrollmentState.isEnrolled) {
            Button(
                onClick = {
                    scope.launch {
                        isEnrolling = true
                        errorMessage = null
                        try {
                            val deviceInfo = deviceInfoCollector.collectDeviceInfo()
                            val timestamp = SimpleDateFormat(
                                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                                Locale.US
                            ).apply {
                                timeZone = TimeZone.getTimeZone("UTC")
                            }.format(Date())

                            val signature = signatureGenerator.generateEnrollmentSignature(
                                model = deviceInfo.model,
                                manufacturer = deviceInfo.manufacturer,
                                osVersion = deviceInfo.osVersion,
                                serialNumber = deviceInfo.serialNumber,
                                imei = deviceInfo.imei,
                                macAddress = deviceInfo.macAddress,
                                androidId = deviceInfo.androidId,
                                method = "app-only",
                                timestamp = timestamp
                            )

                            val request = EnrollmentRequest(
                                model = deviceInfo.model,
                                manufacturer = deviceInfo.manufacturer,
                                osVersion = deviceInfo.osVersion,
                                sdkVersion = deviceInfo.sdkVersion,
                                serialNumber = deviceInfo.serialNumber,
                                imei = deviceInfo.imei,
                                macAddress = deviceInfo.macAddress,
                                androidId = deviceInfo.androidId,
                                agentVersion = BuildConfig.VERSION_NAME,
                                agentPackage = BuildConfig.APPLICATION_ID,
                                method = "app-only",
                                timestamp = timestamp,
                                signature = signature
                            )

                            val response = mdmApi.enroll(request)

                            if (response.isSuccessful) {
                                response.body()?.let { body ->
                                    mdmRepository.saveEnrollment(
                                        deviceId = body.deviceId,
                                        enrollmentId = body.enrollmentId,
                                        token = body.token,
                                        refreshToken = body.refreshToken,
                                        serverUrl = body.serverUrl,
                                        policyVersion = body.policy?.version
                                    )
                                    onStartService()
                                }
                            } else {
                                errorMessage = "Enrollment failed: ${response.code()}"
                            }
                        } catch (e: Exception) {
                            errorMessage = e.message ?: "Unknown error"
                        } finally {
                            isEnrolling = false
                        }
                    }
                },
                enabled = !isEnrolling,
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isEnrolling) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text(
                    if (isEnrolling)
                        stringResource(R.string.enrollment_in_progress)
                    else
                        stringResource(R.string.enrollment_button)
                )
            }
        } else {
            Button(
                onClick = {
                    scope.launch {
                        // Trigger sync
                        onStartService()
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(stringResource(R.string.action_sync))
            }

            Spacer(modifier = Modifier.height(8.dp))

            OutlinedButton(
                onClick = {
                    scope.launch {
                        mdmRepository.clearEnrollment()
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(stringResource(R.string.action_unenroll))
            }
        }
    }
}

private fun isDeviceAdmin(context: Context): Boolean {
    val devicePolicyManager = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    val componentName = ComponentName(context, MDMDeviceAdminReceiver::class.java)
    return devicePolicyManager.isAdminActive(componentName)
}
