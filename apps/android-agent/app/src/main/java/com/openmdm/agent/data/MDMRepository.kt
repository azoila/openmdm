package com.openmdm.agent.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.openmdm.agent.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "mdm_settings")

/**
 * MDM enrollment and state data
 */
data class EnrollmentState(
    val isEnrolled: Boolean = false,
    val deviceId: String? = null,
    val enrollmentId: String? = null,
    val token: String? = null,
    val refreshToken: String? = null,
    val serverUrl: String = BuildConfig.MDM_SERVER_URL,
    val policyVersion: String? = null,
    val lastSync: Long? = null
)

/**
 * Repository for MDM state and preferences
 */
@Singleton
class MDMRepository @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private object Keys {
        val DEVICE_ID = stringPreferencesKey("device_id")
        val ENROLLMENT_ID = stringPreferencesKey("enrollment_id")
        val TOKEN = stringPreferencesKey("token")
        val REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        val SERVER_URL = stringPreferencesKey("server_url")
        val POLICY_VERSION = stringPreferencesKey("policy_version")
        val LAST_SYNC = stringPreferencesKey("last_sync")
    }

    val enrollmentState: Flow<EnrollmentState> = context.dataStore.data.map { preferences ->
        EnrollmentState(
            isEnrolled = preferences[Keys.DEVICE_ID] != null,
            deviceId = preferences[Keys.DEVICE_ID],
            enrollmentId = preferences[Keys.ENROLLMENT_ID],
            token = preferences[Keys.TOKEN],
            refreshToken = preferences[Keys.REFRESH_TOKEN],
            serverUrl = preferences[Keys.SERVER_URL] ?: BuildConfig.MDM_SERVER_URL,
            policyVersion = preferences[Keys.POLICY_VERSION],
            lastSync = preferences[Keys.LAST_SYNC]?.toLongOrNull()
        )
    }

    suspend fun getEnrollmentState(): EnrollmentState = enrollmentState.first()

    suspend fun saveEnrollment(
        deviceId: String,
        enrollmentId: String,
        token: String,
        refreshToken: String?,
        serverUrl: String,
        policyVersion: String?
    ) {
        context.dataStore.edit { preferences ->
            preferences[Keys.DEVICE_ID] = deviceId
            preferences[Keys.ENROLLMENT_ID] = enrollmentId
            preferences[Keys.TOKEN] = token
            refreshToken?.let { preferences[Keys.REFRESH_TOKEN] = it }
            preferences[Keys.SERVER_URL] = serverUrl
            policyVersion?.let { preferences[Keys.POLICY_VERSION] = it }
            preferences[Keys.LAST_SYNC] = System.currentTimeMillis().toString()
        }
    }

    suspend fun updateToken(token: String, refreshToken: String? = null) {
        context.dataStore.edit { preferences ->
            preferences[Keys.TOKEN] = token
            refreshToken?.let { preferences[Keys.REFRESH_TOKEN] = it }
        }
    }

    suspend fun updateLastSync() {
        context.dataStore.edit { preferences ->
            preferences[Keys.LAST_SYNC] = System.currentTimeMillis().toString()
        }
    }

    suspend fun updatePolicyVersion(version: String) {
        context.dataStore.edit { preferences ->
            preferences[Keys.POLICY_VERSION] = version
        }
    }

    suspend fun clearEnrollment() {
        context.dataStore.edit { preferences ->
            preferences.remove(Keys.DEVICE_ID)
            preferences.remove(Keys.ENROLLMENT_ID)
            preferences.remove(Keys.TOKEN)
            preferences.remove(Keys.REFRESH_TOKEN)
            preferences.remove(Keys.POLICY_VERSION)
            preferences.remove(Keys.LAST_SYNC)
        }
    }
}
