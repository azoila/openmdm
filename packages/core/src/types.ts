/**
 * OpenMDM Core Types
 *
 * These types define the core data structures for the MDM system.
 * Designed to be database-agnostic and framework-agnostic.
 */

// ============================================
// Device Types
// ============================================

/**
 * Device lifecycle states.
 *
 * `unenrolling` is the "armed" state of a two-phase unenroll: the server has
 * decided the device should go, and has told it to, but the device has not yet
 * confirmed. Flipping straight to `unenrolled` is what breaks fleets — the row
 * says the device is gone while the device, which never received the message,
 * keeps heartbeating against a server that no longer recognises it.
 */
export type DeviceStatus = 'pending' | 'enrolled' | 'blocked' | 'unenrolling' | 'unenrolled';

/**
 * Legal device status transitions.
 *
 * Every status write goes through this table. Before it existed, `devices.update`
 * accepted any status from anywhere, and `devices.delete` hard-deleted the row —
 * so "unenroll" and "erase all history of this device" were the same operation,
 * and a device could go from `unenrolled` back to `enrolled` without ever
 * re-enrolling.
 */
export const DEVICE_STATUS_TRANSITIONS: Record<DeviceStatus, readonly DeviceStatus[]> = {
  // Awaiting approval.
  pending: ['enrolled', 'blocked', 'unenrolling', 'unenrolled'],
  // The normal working state.
  enrolled: ['blocked', 'unenrolling', 'unenrolled'],
  // Administratively suspended; can be restored, or sent on its way.
  blocked: ['enrolled', 'unenrolling', 'unenrolled'],
  // Armed for unenroll. Can still be called off — a device that never got the
  // message, or an operator who changed their mind, must be able to come back.
  unenrolling: ['unenrolled', 'enrolled', 'blocked'],
  // Terminal. A device that comes back must enroll again, which creates a fresh
  // row rather than resurrecting this one.
  unenrolled: [],
} as const;

export interface Device {
  id: string;
  /**
   * Owning tenant. Set automatically on resources created through a
   * tenant-scoped instance (`mdm.withContext({ tenantId })`). `null` on
   * single-tenant deployments.
   */
  tenantId?: string | null;
  /**
   * The policy version this device last reported having applied. Compared
   * against the assigned policy's `version` to detect drift. `null` when the
   * device has never reported one.
   */
  appliedPolicyVersion?: number | null;
  /** When the device last reported its applied policy version. */
  policyAppliedAt?: Date | null;

  /**
   * What the server wants this device to look like — a declarative blob the
   * agent reconciles toward, rather than a sequence of imperative commands it
   * might miss.
   *
   * Commands are events: miss one and the intent is gone. Desired state is a
   * fact: it rides on every heartbeat until the device reports it has converged.
   * That is why "put this device in maintenance mode" belongs here and not in a
   * command — a maintenance flag that only exists client-side, or only in a
   * command the device never received, is a device nobody can account for.
   */
  desiredState?: Record<string, unknown> | null;

  /**
   * Bumped every time `desiredState` changes. The device echoes back the version
   * it has applied; `reportedStateVersion >= desiredStateVersion` means
   * converged.
   */
  desiredStateVersion?: number;

  /** The desired-state version the device last reported having applied. */
  reportedStateVersion?: number | null;

  /** When the device last reported its desired-state version. */
  stateReportedAt?: Date | null;

  /**
   * Soft-delete tombstone. `devices.delete()` used to hard-DELETE the row, which
   * took the device's entire command and audit history with it — so the one
   * question you ask after a bad unenroll ("what happened to this device?") was
   * the one question the data could no longer answer.
   */
  deletedAt?: Date | null;
  externalId?: string | null;
  enrollmentId: string;
  status: DeviceStatus;

  // Device Info
  model?: string | null;
  manufacturer?: string | null;
  osVersion?: string | null;
  serialNumber?: string | null;
  imei?: string | null;
  macAddress?: string | null;
  androidId?: string | null;

  // MDM State
  policyId?: string | null;
  agentVersion?: string | null; // MDM agent version installed on device
  lastHeartbeat?: Date | null;
  lastSync?: Date | null;

  // Device identity (Phase 2b — device-pinned ECDSA P-256 key)
  /**
   * Base64-encoded SPKI public key the device registered on first
   * enrollment. Requests from this device can be verified against
   * this key via `verifyDeviceRequest` / `verifyEcdsaSignature` from
   * `@openmdm/core`. `null` on devices that enrolled via the legacy
   * HMAC path and have never been migrated.
   */
  publicKey?: string | null;
  /**
   * How the device originally enrolled. `'hmac'` for the legacy
   * shared-secret path; `'pinned-key'` for the device-pinned ECDSA
   * path. `null` on pre-Phase-2b device rows that predate the
   * column (treated as `'hmac'`).
   */
  enrollmentMethod?: 'hmac' | 'pinned-key' | null;

  // Telemetry
  batteryLevel?: number | null;
  storageUsed?: number | null;
  storageTotal?: number | null;
  location?: DeviceLocation | null;
  installedApps?: InstalledApp[] | null;

  // Metadata
  tags?: Record<string, string> | null;
  metadata?: Record<string, unknown> | null;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: Date;
}

export interface InstalledApp {
  packageName: string;
  version: string;
  versionCode?: number;
  installedAt?: Date;
}

/**
 * One app on one device: what is actually installed, and what should be.
 *
 * App inventory used to live only inside the `installed_apps` JSON blob on the
 * device row, so "which devices are running player < 2.0?" meant walking JSON
 * for every device in the fleet. This is the canonical, queryable form, and it
 * is what the update engine reconciles against.
 */
export interface DeviceApp {
  deviceId: string;
  packageName: string;

  /** What the device reports having installed. `null` = not installed. */
  observedVersion?: string | null;
  observedVersionCode?: number | null;
  observedAt?: Date | null;

  /** What the server wants installed. `null` = no opinion. */
  desiredVersion?: string | null;
  desiredVersionCode?: number | null;

  /** Install attempts made for the current desired version. */
  updateAttempts: number;
  lastAttemptAt?: Date | null;

  /**
   * Set when the device has taken the install command repeatedly and the version
   * still has not moved. The device is not going to fix itself; a human needs to
   * look. Distinct from a delivery failure, which the command retry sweep owns.
   */
  escalatedAt?: Date | null;
}

/** Where a device stands relative to its desired state. */
export interface DeviceConvergence {
  deviceId: string;
  desiredStateVersion: number;
  reportedStateVersion: number | null;
  converged: boolean;
  /** Apps whose observed version does not match the desired one. */
  pendingApps: string[];
  lastReportedAt?: Date | null;
}

/**
 * A staged app rollout.
 *
 * `rolloutPercentage` is applied by hashing the device id, not by sampling at
 * random: the same device must land in the same bucket on every evaluation, or a
 * 10% rollout re-rolls the dice on every sweep and eventually hits everyone.
 */
export interface AppRollout {
  packageName: string;
  version: string;
  versionCode?: number;
  /** 0–100. Devices are selected deterministically by `hash(deviceId) % 100`. */
  rolloutPercentage?: number;
}

export interface CreateDeviceInput {
  /** Owning tenant. Injected automatically by a tenant-scoped instance. */
  tenantId?: string;
  enrollmentId: string;
  externalId?: string;
  model?: string;
  manufacturer?: string;
  osVersion?: string;
  serialNumber?: string;
  imei?: string;
  macAddress?: string;
  androidId?: string;
  policyId?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface UpdateDeviceInput {
  /** Policy version the device reports having applied. */
  appliedPolicyVersion?: number | null;
  /** When the device reported its applied policy version. */
  policyAppliedAt?: Date | null;
  /** Declarative state the device reconciles toward. */
  desiredState?: Record<string, unknown> | null;
  desiredStateVersion?: number;
  reportedStateVersion?: number | null;
  stateReportedAt?: Date | null;
  /** Soft-delete tombstone. */
  deletedAt?: Date | null;
  externalId?: string | null;
  status?: DeviceStatus;
  policyId?: string | null;
  agentVersion?: string | null;
  model?: string;
  manufacturer?: string;
  osVersion?: string;
  batteryLevel?: number | null;
  storageUsed?: number | null;
  storageTotal?: number | null;
  lastHeartbeat?: Date;
  lastSync?: Date;
  installedApps?: InstalledApp[];
  location?: DeviceLocation;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
  /** Phase 2b — pin a new public key on first enroll. */
  publicKey?: string | null;
  /** Phase 2b — record which auth path the device enrolled via. */
  enrollmentMethod?: 'hmac' | 'pinned-key' | null;
}

export interface DeviceFilter {
  /**
   * Restrict results to one tenant. Set automatically by
   * `mdm.withContext({ tenantId })` — passing it by hand on the root
   * instance works too, but the scoped instance is the safer path because it
   * cannot be forgotten.
   */
  tenantId?: string;
  /**
   * Exclude soft-deleted devices. Defaults to true — a deleted device should
   * not show up in a device list just because its row still exists for audit.
   */
  includeDeleted?: boolean;
  status?: DeviceStatus | DeviceStatus[];
  policyId?: string;
  groupId?: string;
  search?: string;
  tags?: Record<string, string>;
  limit?: number;
  offset?: number;
}

export interface DeviceListResult {
  devices: Device[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================
// Policy Types
// ============================================

export interface Policy {
  id: string;
  /** Owning tenant — see {@link Device.tenantId}. */
  tenantId?: string | null;
  name: string;
  description?: string | null;
  isDefault: boolean;
  settings: PolicySettings;
  /**
   * Monotonic revision, starting at 1 and incremented on every change to
   * `settings`. Renaming a policy does not bump it — only a change a device
   * would have to act on does.
   *
   * This is what makes "is this device running the current policy?" a
   * question with an answer. Devices report the version they have applied in
   * their heartbeat; core compares the two (see {@link PolicyCompliance}).
   */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An immutable snapshot of a policy's settings at one version. Written on
 * every settings change, so a policy's history is replayable and any prior
 * version can be rolled back to.
 */
export interface PolicyVersion {
  id: string;
  policyId: string;
  version: number;
  settings: PolicySettings;
  /** The user who made the change, when it came through a scoped instance. */
  createdBy?: string | null;
  /** Free-text note, e.g. the reason for a rollback. */
  note?: string | null;
  createdAt: Date;
}

/**
 * Where a device stands relative to its assigned policy.
 *
 * - `compliant` — the device has applied the current version.
 * - `pending` — a newer version exists; the device has not reported it yet.
 *   Normal and transient right after a policy change.
 * - `unknown` — the device has never reported a policy version (an old agent,
 *   or one that has not checked in since being assigned).
 * - `unassigned` — no policy is assigned to the device.
 */
export type PolicyComplianceStatus = 'compliant' | 'pending' | 'unknown' | 'unassigned';

export interface DevicePolicyCompliance {
  deviceId: string;
  policyId?: string | null;
  /** Current version of the assigned policy. */
  currentVersion?: number | null;
  /** Version the device last reported having applied. */
  appliedVersion?: number | null;
  status: PolicyComplianceStatus;
  /** When the device last reported a policy version. */
  lastReportedAt?: Date | null;
}

/** Fleet-level rollout state for one policy. */
export interface PolicyCompliance {
  policyId: string;
  version: number;
  total: number;
  compliant: number;
  pending: number;
  unknown: number;
  /** Devices that have not applied the current version, for follow-up. */
  laggingDeviceIds: string[];
}

export interface PolicySettings {
  // Kiosk Mode
  kioskMode?: boolean;
  mainApp?: string;
  allowedApps?: string[];
  kioskExitPassword?: string;

  // Lock Features
  lockStatusBar?: boolean;
  lockNavigationBar?: boolean;
  lockSettings?: boolean;
  lockPowerButton?: boolean;
  blockInstall?: boolean;
  blockUninstall?: boolean;

  // Hardware Controls
  bluetooth?: HardwareControl;
  wifi?: HardwareControl;
  gps?: HardwareControl;
  mobileData?: HardwareControl;
  camera?: HardwareControl;
  microphone?: HardwareControl;
  usb?: HardwareControl;
  nfc?: HardwareControl;

  // Update Settings
  systemUpdatePolicy?: SystemUpdatePolicy;
  updateWindow?: TimeWindow;

  // Security
  passwordPolicy?: PasswordPolicy;
  encryptionRequired?: boolean;
  factoryResetProtection?: boolean;
  safeBootDisabled?: boolean;

  // Telemetry
  heartbeatInterval?: number;
  locationReportInterval?: number;
  locationEnabled?: boolean;

  // Network
  wifiConfigs?: WifiConfig[];
  vpnConfig?: VpnConfig;

  // Applications
  applications?: PolicyApplication[];

  // Custom settings (for plugins)
  custom?: Record<string, unknown>;
}

export type HardwareControl = 'on' | 'off' | 'user';
export type SystemUpdatePolicy = 'auto' | 'windowed' | 'postpone' | 'manual';

export interface TimeWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface PasswordPolicy {
  required: boolean;
  minLength?: number;
  complexity?: 'none' | 'numeric' | 'alphanumeric' | 'complex';
  maxFailedAttempts?: number;
  expirationDays?: number;
  historyLength?: number;
}

export interface WifiConfig {
  ssid: string;
  securityType: 'none' | 'wep' | 'wpa' | 'wpa2' | 'wpa3';
  password?: string;
  hidden?: boolean;
  autoConnect?: boolean;
}

export interface VpnConfig {
  type: 'pptp' | 'l2tp' | 'ipsec' | 'openvpn' | 'wireguard';
  server: string;
  username?: string;
  password?: string;
  certificate?: string;
  config?: Record<string, unknown>;
}

export interface PolicyApplication {
  packageName: string;
  action: 'install' | 'update' | 'uninstall';
  version?: string;
  required?: boolean;
  autoUpdate?: boolean;
}

export interface CreatePolicyInput {
  /** Owning tenant. Injected automatically by a tenant-scoped instance. */
  tenantId?: string;
  /** Set by core; callers do not pass this. */
  version?: number;
  name: string;
  description?: string;
  isDefault?: boolean;
  settings: PolicySettings;
}

export interface UpdatePolicyInput {
  /** Set by core when settings change; callers do not pass this. */
  version?: number;
  name?: string;
  description?: string | null;
  isDefault?: boolean;
  settings?: PolicySettings;
}

// ============================================
// Application Types
// ============================================

export interface Application {
  id: string;
  /** Owning tenant — see {@link Device.tenantId}. */
  tenantId?: string | null;
  name: string;
  packageName: string;
  version: string;
  versionCode: number;
  url: string;
  hash?: string | null;
  size?: number | null;
  minSdkVersion?: number | null;

  // Deployment settings
  showIcon: boolean;
  runAfterInstall: boolean;
  runAtBoot: boolean;
  isSystem: boolean;

  // State
  isActive: boolean;

  // Metadata
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApplicationInput {
  /** Owning tenant. Injected automatically by a tenant-scoped instance. */
  tenantId?: string;
  name: string;
  packageName: string;
  version: string;
  versionCode: number;
  url: string;
  hash?: string;
  size?: number;
  minSdkVersion?: number;
  showIcon?: boolean;
  runAfterInstall?: boolean;
  runAtBoot?: boolean;
  isSystem?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateApplicationInput {
  name?: string;
  version?: string;
  versionCode?: number;
  url?: string;
  hash?: string | null;
  size?: number | null;
  minSdkVersion?: number | null;
  showIcon?: boolean;
  runAfterInstall?: boolean;
  runAtBoot?: boolean;
  isActive?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface DeployTarget {
  devices?: string[];
  policies?: string[];
  groups?: string[];
}

// ============================================
// App Version & Rollback Types
// ============================================

export interface AppVersion {
  id: string;
  applicationId: string;
  packageName: string;
  version: string;
  versionCode: number;
  url: string;
  hash?: string | null;
  size?: number | null;
  releaseNotes?: string | null;
  isMinimumVersion: boolean;
  createdAt: Date;
}

export interface AppRollback {
  id: string;
  deviceId: string;
  packageName: string;
  fromVersion: string;
  fromVersionCode: number;
  toVersion: string;
  toVersionCode: number;
  reason?: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  error?: string | null;
  initiatedBy?: string | null;
  createdAt: Date;
  completedAt?: Date | null;
}

export interface CreateAppRollbackInput {
  deviceId: string;
  packageName: string;
  toVersionCode: number;
  reason?: string;
  initiatedBy?: string;
}

// ============================================
// Command Types
// ============================================

export type CommandType =
  | 'reboot'
  | 'shutdown'
  | 'sync'
  | 'lock'
  | 'unlock'
  | 'wipe'
  | 'factoryReset'
  /** Leave the fleet cleanly: drop enrollment state without wiping user data. */
  | 'unenroll'
  | 'installApp'
  | 'uninstallApp'
  | 'updateApp'
  | 'runApp'
  | 'clearAppData'
  | 'clearAppCache'
  | 'shell'
  | 'setPolicy'
  | 'grantPermissions'
  | 'exitKiosk'
  | 'enterKiosk'
  | 'setWifi'
  | 'screenshot'
  | 'getLocation'
  | 'setVolume'
  | 'sendNotification'
  | 'whitelistBattery' // Whitelist app from battery optimization (Doze)
  | 'enablePermissiveMode' // Enable permissive mode for debugging
  | 'setTimeZone' // Set device timezone
  | 'enableAdb' // Enable/disable ADB debugging
  | 'rollbackApp' // Rollback to previous app version
  | 'updateAgent' // Update MDM agent to a new version
  | 'custom';

export type CommandStatus =
  | 'pending'
  | 'sent'
  | 'acknowledged'
  | 'completed'
  | 'failed'
  | 'cancelled'
  /**
   * The command passed its `expiresAt` before the device picked it up. A
   * `factoryReset` queued for a device that stayed offline for three months
   * must not fire when it finally checks in — it expires instead.
   */
  | 'expired';

export interface Command {
  id: string;
  /** Owning tenant — see {@link Device.tenantId}. */
  tenantId?: string | null;
  deviceId: string;
  type: CommandType;
  payload?: Record<string, unknown> | null;
  status: CommandStatus;
  result?: CommandResult | null;
  error?: string | null;
  createdAt: Date;
  sentAt?: Date | null;
  acknowledgedAt?: Date | null;
  completedAt?: Date | null;

  /**
   * Caller-supplied deduplication key. Two `send` calls with the same key
   * return the same command instead of queueing the operation twice — the
   * thing you want when a retrying HTTP client double-posts "wipe this
   * device". Unique per device when set.
   */
  idempotencyKey?: string | null;

  /**
   * When set, the command must not be delivered after this instant. Reaped
   * by `commands.expireStale()`, and filtered out of `getPending` so an
   * expired command is never handed to a device even if the reaper has not
   * run yet.
   */
  expiresAt?: Date | null;

  /** Delivery attempts made so far (incremented per push attempt). */
  attemptCount: number;

  /**
   * Delivery attempts allowed before the command is dead-lettered (moved to
   * `failed` with a `DELIVERY_EXHAUSTED` error). This bounds *delivery*
   * attempts, not device-side execution retries.
   */
  maxAttempts: number;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

export interface SendCommandInput {
  /** Owning tenant. Injected automatically by a tenant-scoped instance. */
  tenantId?: string;
  deviceId: string;
  type: CommandType;
  payload?: Record<string, unknown>;

  /** Deduplication key — see {@link Command.idempotencyKey}. */
  idempotencyKey?: string;

  /**
   * Time-to-live in seconds. Sets `expiresAt` to now + ttl. Ignored when
   * `expiresAt` is passed explicitly. Falls back to
   * `config.commands.defaultTtlSeconds`.
   */
  ttlSeconds?: number;

  /** Absolute expiry. Takes precedence over `ttlSeconds`. */
  expiresAt?: Date;

  /** Delivery attempts allowed. Falls back to `config.commands.defaultMaxAttempts`. */
  maxAttempts?: number;
}

/**
 * Result of a delivery sweep. Returned by `commands.retryPending()`.
 */
export interface CommandRetryResult {
  /** Commands that were re-pushed successfully on this sweep. */
  delivered: number;
  /** Commands whose push failed again but still have attempts left. */
  retried: number;
  /** Commands that exhausted `maxAttempts` and were dead-lettered. */
  deadLettered: number;
}

export interface CommandFilter {
  /** Restrict results to one tenant. See {@link DeviceFilter.tenantId}. */
  tenantId?: string;
  deviceId?: string;
  status?: CommandStatus | CommandStatus[];
  type?: CommandType | CommandType[];
  limit?: number;
  offset?: number;
}

// ============================================
// Event Types
// ============================================

export type EventType =
  | 'device.enrolled'
  | 'device.unenrolled'
  | 'device.blocked'
  | 'device.heartbeat'
  | 'device.locationUpdated'
  | 'device.statusChanged'
  | 'device.policyChanged'
  | 'app.installed'
  | 'app.uninstalled'
  | 'app.updated'
  | 'app.crashed'
  | 'app.started'
  | 'app.stopped'
  | 'policy.applied'
  | 'policy.failed'
  | 'policy.updated'
  | 'policy.rolledBack'
  | 'device.policyDrifted'
  | 'device.converged'
  | 'device.appVersionChanged'
  | 'device.updateEscalated'
  | 'command.received'
  | 'command.acknowledged'
  | 'command.requeued'
  | 'command.completed'
  | 'command.failed'
  | 'security.tamper'
  | 'security.rootDetected'
  | 'security.screenLocked'
  | 'security.screenUnlocked'
  | 'custom';

export interface MDMEvent<T = unknown> {
  id: string;
  deviceId: string;
  type: EventType;
  payload: T;
  createdAt: Date;
}

export interface EventFilter {
  deviceId?: string;
  type?: EventType | EventType[];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

// ============================================
// Group Types
// ============================================

export interface Group {
  id: string;
  /** Owning tenant — see {@link Device.tenantId}. */
  tenantId?: string | null;
  name: string;
  description?: string | null;
  policyId?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateGroupInput {
  /** Owning tenant. Injected automatically by a tenant-scoped instance. */
  tenantId?: string;
  name: string;
  description?: string;
  policyId?: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string | null;
  policyId?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ============================================
// Enrollment Types
// ============================================

export type EnrollmentMethod = 'qr' | 'nfc' | 'zero-touch' | 'knox' | 'manual' | 'app-only' | 'adb';

export interface EnrollmentRequest {
  // Device identifiers (at least one required)
  macAddress?: string;
  serialNumber?: string;
  imei?: string;
  androidId?: string;

  // Device info
  model: string;
  manufacturer: string;
  osVersion: string;
  sdkVersion?: number;

  // Agent info
  agentVersion?: string;
  agentPackage?: string;

  // Enrollment details
  method: EnrollmentMethod;
  timestamp: string;

  /**
   * Signature over the canonical enrollment message.
   *
   * Phase 2a (HMAC path, backwards-compatible): hex-encoded
   * HMAC-SHA256 of the nine-field pipe-delimited canonical form
   * (see `concepts/enrollment`).
   *
   * Phase 2b (device-pinned-key path, preferred): base64-encoded
   * DER ECDSA-P256 signature produced by the device's Keystore
   * private key, over `canonicalEnrollmentMessage(...)` including
   * the public key and challenge. The server distinguishes the
   * two paths by whether `publicKey` is present on the request.
   */
  signature: string;

  /**
   * Base64-encoded SPKI public key (EC P-256) the device generated
   * in its Keystore. When present, enrollment follows the Phase 2b
   * device-pinned-key path and `signature` must verify as an ECDSA
   * signature against this key. The server pins this key on the
   * device row on first successful enroll; any future enroll
   * attempting a different key for the same `enrollmentId` is
   * rejected with `PublicKeyMismatchError`.
   *
   * Omit for the legacy HMAC path. Callers that want to migrate a
   * fleet gradually can run both paths in parallel.
   */
  publicKey?: string;

  /**
   * Opaque challenge issued by `GET /agent/enroll/challenge`. Must
   * be present whenever `publicKey` is present — the server uses
   * it to prevent replay of captured enrollment payloads. The
   * challenge is single-use: the server consumes it on first
   * successful verify.
   */
  attestationChallenge?: string;

  // Optional pre-assigned policy/group
  policyId?: string;
  groupId?: string;
}

export interface EnrollmentResponse {
  deviceId: string;
  enrollmentId: string;
  policyId?: string;
  policy?: Policy;
  serverUrl: string;
  pushConfig: PushConfig;
  token: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

// ============================================
// Device Identity (Phase 2b)
// ============================================

/**
 * Single-use nonce issued by `GET /agent/enroll/challenge` and
 * consumed on first successful verify of a device-pinned-key
 * enrollment. A persisted record; the `consume*` adapter methods
 * enforce the single-use invariant.
 */
export interface EnrollmentChallenge {
  challenge: string;
  expiresAt: Date;
  consumedAt?: Date | null;
  createdAt: Date;
}

/**
 * Result of calling `verifyDeviceRequest`. Callers pattern-match on
 * `ok` and, when `false`, on `reason` to decide their response
 * shape:
 *
 *  - `not-found`         — unknown device id. Return 401.
 *  - `no-pinned-key`     — device exists but never migrated off the
 *                          legacy HMAC path. Caller should fall back
 *                          to their HMAC verifier, or fail if
 *                          they've completed their migration.
 *  - `signature-invalid` — signature did not verify against the
 *                          pinned key. Return 401. Never re-pin
 *                          in response to this.
 */
export type DeviceIdentityVerification =
  | { ok: true; device: Device }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'no-pinned-key'; device: Device }
  | { ok: false; reason: 'signature-invalid'; device: Device };

export interface PushConfig {
  provider: 'fcm' | 'mqtt' | 'websocket' | 'polling';
  fcmSenderId?: string;
  mqttUrl?: string;
  mqttTopic?: string;
  mqttUsername?: string;
  mqttPassword?: string;
  wsUrl?: string;
  pollingInterval?: number;
}

// ============================================
// Telemetry Types
// ============================================

export interface Heartbeat {
  deviceId: string;
  timestamp: Date;

  // Battery
  batteryLevel: number;
  isCharging: boolean;
  batteryHealth?: 'good' | 'overheat' | 'dead' | 'cold' | 'unknown';

  // Storage
  storageUsed: number;
  storageTotal: number;

  // Memory
  memoryUsed: number;
  memoryTotal: number;

  // Network
  networkType?: 'wifi' | 'cellular' | 'ethernet' | 'none';
  networkName?: string; // SSID or carrier
  signalStrength?: number;
  ipAddress?: string;

  // Location
  location?: DeviceLocation;

  // Apps
  installedApps: InstalledApp[];
  runningApps?: string[];

  // Security
  isRooted?: boolean;
  isEncrypted?: boolean;
  screenLockEnabled?: boolean;

  // Agent status
  agentVersion?: string;
  policyVersion?: string;
  lastPolicySync?: Date;
  /**
   * The desired-state version the device has applied. Echoed back so the server
   * can tell convergence from "has not got there yet".
   */
  desiredStateVersion?: number | string;
}

// ============================================
// Push Token Types
// ============================================

export interface PushToken {
  id: string;
  deviceId: string;
  provider: 'fcm' | 'mqtt' | 'websocket';
  token: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterPushTokenInput {
  deviceId: string;
  provider: 'fcm' | 'mqtt' | 'websocket';
  token: string;
}

// ============================================
// Configuration Types
// ============================================

export interface MDMConfig {
  /** Database adapter for persistence */
  database: DatabaseAdapter;

  /** Authentication/authorization configuration */
  auth?: AuthConfig;

  /** Push notification provider configuration */
  push?: PushProviderConfig;

  /** Device enrollment configuration */
  enrollment?: EnrollmentConfig;

  /** Server URL (used in enrollment responses) */
  serverUrl?: string;

  /** APK/file storage configuration */
  storage?: StorageConfig;

  /** Outbound webhook configuration */
  webhooks?: WebhookConfig;

  /** Plugins to extend functionality */
  plugins?: MDMPlugin[];

  /** Event handlers */
  onDeviceEnrolled?: (device: Device) => Promise<void>;
  onDeviceUnenrolled?: (device: Device) => Promise<void>;
  onDeviceBlocked?: (device: Device) => Promise<void>;
  onHeartbeat?: (device: Device, heartbeat: Heartbeat) => Promise<void>;
  onCommand?: (command: Command) => Promise<void>;
  onEvent?: (event: MDMEvent) => Promise<void>;

  // Enterprise features
  /** Multi-tenancy configuration */
  multiTenancy?: {
    enabled: boolean;
    defaultTenantId?: string;
    tenantResolver?: (context: unknown) => Promise<string | null>;
  };

  /** Authorization (RBAC) configuration */
  authorization?: {
    enabled: boolean;
    defaultRole?: string;
  };

  /** Audit logging configuration */
  audit?: {
    enabled: boolean;
    retentionDays?: number;
  };

  /** Scheduling configuration */
  scheduling?: {
    enabled: boolean;
    timezone?: string;
  };

  /** Plugin storage configuration */
  pluginStorage?: {
    adapter: 'database' | 'memory';
  };

  /** App update enforcement. */
  updates?: {
    /**
     * Base delay between install attempts for the same (device, app), doubling
     * each attempt. Defaults to 3600 (1 hour) — an app install is expensive and
     * disruptive; hammering a device that just failed one is worse than waiting.
     */
    retryBackoffSeconds?: number;

    /**
     * Install attempts before the (device, app) is escalated for human
     * attention. Defaults to 5. A device that has taken the command five times
     * and is still on the old version is not going to fix itself.
     */
    maxAttempts?: number;
  };

  /** Command delivery durability defaults. */
  commands?: {
    /**
     * Default TTL applied to commands that don't pass one. Commands not
     * delivered within this window are reaped to `expired`.
     *
     * Defaults to 604800 (7 days). Set to 0 for no default expiry — but
     * note that a command with no expiry queued for a long-offline device
     * will still fire whenever that device returns, months later.
     */
    defaultTtlSeconds?: number;

    /**
     * Delivery attempts allowed before a command is dead-lettered.
     * Defaults to 5. This bounds delivery, not device-side execution.
     */
    defaultMaxAttempts?: number;

    /**
     * Base delay, in seconds, for exponential backoff between delivery
     * attempts (attempt N waits `base * 2^(N-1)`). Defaults to 60.
     */
    retryBackoffSeconds?: number;

    /**
     * How long a command may sit `acknowledged` — the device confirmed receipt
     * but never reported completion — before `commands.sweepStuck()` requeues
     * it for re-delivery. Defaults to 900 (15 minutes).
     *
     * This closes the ack-then-crash hole: `getPendingCommands` only returns
     * `pending`/`sent`, so a device that acknowledged a command and then died
     * mid-execution would never be given it again, and it would sit
     * `acknowledged` forever.
     *
     * Delivery is therefore **at-least-once**: a device can receive an
     * acknowledged-but-unfinished command a second time. Agents must be
     * idempotent per `commandId` — which the OpenMDM Android agent is, since it
     * persists command ids. Set to 0 to disable the sweep entirely if your
     * agents cannot deduplicate.
     */
    ackTimeoutSeconds?: number;
  };

  /**
   * Structured logger. Replaces OpenMDM's internal `console.*` calls
   * so log output lands in the host application's logging pipeline
   * (pino, winston, bunyan, OTEL collector, etc.) instead of raw
   * stderr.
   *
   * The shape is a strict subset of the pino / winston / bunyan
   * interface — any of those can be passed directly. If omitted, a
   * default logger that writes to the console with an `[openmdm]`
   * prefix is used. To silence OpenMDM entirely, pass a no-op
   * implementation (see `createSilentLogger()` in the package
   * exports).
   */
  logger?: Logger;
}

/**
 * Minimal structured-logger interface OpenMDM calls internally.
 *
 * The shape is deliberately the pino-compatible subset: an optional
 * context object as the first argument followed by a message string.
 * pino, winston, bunyan, and most other structured loggers accept
 * this shape natively.
 *
 * Implementations should be side-effect-free on unconfigured levels
 * (a production logger filtered to `info` should still accept
 * `.debug()` calls cheaply).
 */
export interface Logger {
  /** Human-ignorable, high-volume tracing. Off in production by default. */
  debug(context: LogContext, message: string): void;
  debug(message: string): void;

  /** Normal operational events. Enrollment, policy changes, command delivery. */
  info(context: LogContext, message: string): void;
  info(message: string): void;

  /** Something is wrong but the server is still running. Retries, fallbacks, degraded modes. */
  warn(context: LogContext, message: string): void;
  warn(message: string): void;

  /** Something failed and a request/operation did not complete. */
  error(context: LogContext, message: string): void;
  error(message: string): void;

  /**
   * Return a new logger with the given fields attached to every
   * subsequent call. Used by managers and plugins to scope logs to
   * a specific subsystem without repeating context.
   */
  child(bindings: LogContext): Logger;
}

/**
 * Arbitrary structured context attached to a log line. Values must
 * be JSON-serializable so host loggers can ship them to any backend.
 */
export type LogContext = Record<string, unknown>;

export interface StorageConfig {
  /** Storage provider (s3, local, custom) */
  provider: 's3' | 'local' | 'custom';

  /** S3 configuration */
  s3?: {
    bucket: string;
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string; // For S3-compatible services
    presignedUrlExpiry?: number; // Seconds, default 3600
  };

  /** Local storage path */
  localPath?: string;

  /** Custom storage adapter */
  customAdapter?: {
    upload: (file: Buffer, key: string) => Promise<string>;
    getUrl: (key: string) => Promise<string>;
    delete: (key: string) => Promise<void>;
  };
}

export interface WebhookConfig {
  /** Webhook endpoints to notify */
  endpoints?: WebhookEndpoint[];

  /** Retry configuration */
  retry?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };

  /** Sign webhooks with HMAC secret */
  signingSecret?: string;
}

export interface WebhookEndpoint {
  /** Unique identifier */
  id: string;
  /** Webhook URL */
  url: string;
  /** Events to trigger this webhook */
  events: (EventType | '*')[];
  /** Custom headers */
  headers?: Record<string, string>;
  /** Whether endpoint is active */
  enabled: boolean;
}

/**
 * Who is acting, and on whose data.
 *
 * Passed to `mdm.withContext(...)` to get an instance that enforces tenant
 * isolation, RBAC, and audit logging on every call. The root instance remains
 * unscoped — it is the "system" caller (enrollment, background jobs, sweeps),
 * and it deliberately bypasses these checks because there is no user to
 * authorize and no tenant to infer.
 */
export interface MDMContext {
  /**
   * Restricts every read and write to this tenant. Reads from other tenants
   * return empty/null as if the data did not exist, rather than raising —
   * a cross-tenant lookup must not confirm that an id exists elsewhere.
   */
  tenantId?: string;

  /**
   * The acting user. When set and `authorization.enabled` is on, every
   * operation is permission-checked before it runs. Also recorded as the
   * actor on audit entries.
   */
  userId?: string;

  /** Recorded on audit entries. */
  ipAddress?: string;
  /** Recorded on audit entries. */
  userAgent?: string;
}

/**
 * A tenant- and actor-scoped view of an MDM instance. Same manager APIs as the
 * root instance, but every call is isolated, authorized, and audited.
 */
export interface ScopedMDM {
  readonly context: MDMContext;
  devices: DeviceManager;
  policies: PolicyManager;
  apps: ApplicationManager;
  commands: CommandManager;
  groups: GroupManager;
}

export interface AuthConfig {
  /** Get current user from request context */
  getUser: <T = unknown>(context: unknown) => Promise<T | null>;
  /** Check if user has admin privileges */
  isAdmin?: (user: unknown) => Promise<boolean>;
  /** Check if user can access specific device */
  canAccessDevice?: (user: unknown, deviceId: string) => Promise<boolean>;
  /** Device JWT secret (for device auth tokens) */
  deviceTokenSecret?: string;
  /** Device token expiration in seconds (default: 365 days) */
  deviceTokenExpiration?: number;
  /**
   * Grace window, in seconds, during which an EXPIRED device token is still
   * accepted for token renewal — and only for renewal, never for regular
   * request authentication. This lets an agent that was offline past its
   * token expiry recover with a refresh call instead of self-unenrolling.
   * Default: 30 days. Set to 0 to require renewal strictly before expiry.
   */
  deviceTokenRenewalGraceSeconds?: number;
}

export interface VerifyDeviceTokenOptions {
  /**
   * Accept tokens whose `exp` lies at most this many seconds in the past.
   * Intended exclusively for the token-renewal endpoint; regular request
   * authentication must not set this.
   */
  ignoreExpirationWithinSeconds?: number;
}

export interface PushProviderConfig {
  provider: 'fcm' | 'mqtt' | 'websocket' | 'polling';

  // FCM configuration
  fcmCredentials?: string | Record<string, unknown>;
  fcmProjectId?: string;

  // MQTT configuration
  mqttUrl?: string;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttTopicPrefix?: string;

  // WebSocket configuration
  wsPath?: string;
  wsPingInterval?: number;

  // Polling fallback
  pollingInterval?: number;
}

export interface EnrollmentConfig {
  /** Auto-enroll devices with valid signature */
  autoEnroll?: boolean;
  /** HMAC secret for device signature verification (Phase 2a path) */
  deviceSecret: string;
  /** Allowed enrollment methods */
  allowedMethods?: EnrollmentMethod[];
  /** Default policy for new devices */
  defaultPolicyId?: string;
  /** Default group for new devices */
  defaultGroupId?: string;
  /** Require manual approval for enrollment */
  requireApproval?: boolean;
  /** Custom enrollment validation */
  validate?: (request: EnrollmentRequest) => Promise<boolean>;

  /**
   * Maximum allowed clock skew, in seconds, between the signed enrollment
   * `timestamp` and the server clock on the HMAC (Phase 2a) path. The
   * timestamp is covered by the HMAC signature, so enforcing freshness
   * bounds how long a captured enrollment request can be replayed. The
   * pinned-key path needs no equivalent — its single-use challenge already
   * prevents replay. Default: 900 (15 minutes). Set to 0 to disable.
   */
  timestampToleranceSeconds?: number;

  /**
   * Phase 2b device-pinned-key configuration. Optional — when
   * omitted, enrollment continues to accept the Phase 2a HMAC path
   * exclusively, matching pre-0.9 behaviour.
   */
  pinnedKey?: PinnedKeyConfig;
}

/**
 * Device-pinned-key enrollment options. See
 * `docs/concepts/enrollment` for the full flow.
 */
export interface PinnedKeyConfig {
  /**
   * Require every new enrollment to use the pinned-key path. When
   * `true`, requests without `publicKey` are rejected. When `false`
   * (the default), both paths coexist during rollout — the server
   * pins a public key when one is provided, falls back to HMAC when
   * it isn't.
   */
  required?: boolean;

  /**
   * TTL for enrollment challenges, in seconds. Defaults to 300
   * (5 minutes). Challenges are single-use; this only bounds how
   * long an unused challenge stays valid.
   */
  challengeTtlSeconds?: number;
}

// ============================================
// Adapter Interfaces
// ============================================

export interface DatabaseAdapter {
  // Devices
  findDevice(id: string): Promise<Device | null>;
  findDeviceByEnrollmentId(enrollmentId: string): Promise<Device | null>;
  listDevices(filter?: DeviceFilter): Promise<DeviceListResult>;
  createDevice(data: CreateDeviceInput): Promise<Device>;
  updateDevice(id: string, data: UpdateDeviceInput): Promise<Device>;
  deleteDevice(id: string): Promise<void>;
  countDevices(filter?: DeviceFilter): Promise<number>;

  // Policies
  findPolicy(id: string): Promise<Policy | null>;
  findDefaultPolicy(): Promise<Policy | null>;
  listPolicies(): Promise<Policy[]>;
  createPolicy(data: CreatePolicyInput): Promise<Policy>;
  updatePolicy(id: string, data: UpdatePolicyInput): Promise<Policy>;
  deletePolicy(id: string): Promise<void>;

  // Applications
  findApplication(id: string): Promise<Application | null>;
  findApplicationByPackage(packageName: string, version?: string): Promise<Application | null>;
  listApplications(activeOnly?: boolean): Promise<Application[]>;
  createApplication(data: CreateApplicationInput): Promise<Application>;
  updateApplication(id: string, data: UpdateApplicationInput): Promise<Application>;
  deleteApplication(id: string): Promise<void>;

  // Commands
  findCommand(id: string): Promise<Command | null>;
  listCommands(filter?: CommandFilter): Promise<Command[]>;
  createCommand(data: SendCommandInput): Promise<Command>;
  updateCommand(id: string, data: Partial<Command>): Promise<Command | null>;
  getPendingCommands(deviceId: string): Promise<Command[]>;

  /**
   * Insert a command, or return the existing one when a command with the
   * same `idempotencyKey` already exists for this device. `created` tells
   * the caller which happened.
   *
   * Adapters should implement this as a single atomic statement (Postgres:
   * `INSERT ... ON CONFLICT DO NOTHING` against a unique index on
   * `(device_id, idempotency_key)`). When an adapter does not implement it,
   * core falls back to find-then-create, which closes the duplicate window
   * only approximately — two concurrent sends can still both insert.
   */
  // ----- Canonical app inventory -----

  /** Replace a device's app inventory with what it just reported. */
  syncDeviceApps?(deviceId: string, apps: InstalledApp[]): Promise<void>;

  /** A device's canonical app inventory. */
  listDeviceApps?(deviceId: string): Promise<DeviceApp[]>;

  /** Set the desired version for an app on specific devices. */
  setDesiredAppVersion?(
    deviceIds: string[],
    packageName: string,
    version: string,
    versionCode?: number,
  ): Promise<void>;

  /**
   * Devices whose observed app version does not match the desired one, are not
   * escalated, and whose backoff window has elapsed.
   */
  listAppsNeedingUpdate?(options: {
    now: Date;
    backoffSeconds: number;
    limit: number;
  }): Promise<DeviceApp[]>;

  /** Record an install attempt for a (device, app). */
  recordAppUpdateAttempt?(deviceId: string, packageName: string): Promise<void>;

  /** Flag a (device, app) for human attention. */
  escalateAppUpdate?(deviceId: string, packageName: string): Promise<void>;

  /** Escalated (device, app) pairs. */
  listEscalatedApps?(packageName?: string): Promise<DeviceApp[]>;

  /**
   * Declares that this adapter honours `tenantId` on filters and persists it
   * on create. Core refuses to serve a tenant-scoped instance against an
   * adapter that does not set this — silently ignoring the filter and
   * returning every tenant's data is the one failure mode multi-tenancy
   * cannot have.
   */
  supportsTenantScoping?: boolean;

  /**
   * Persist an immutable snapshot of a policy's settings. Called on every
   * settings change. Adapters that do not implement it lose policy history and
   * rollback, but versioning and drift detection still work.
   */
  createPolicyVersion?(data: Omit<PolicyVersion, 'id' | 'createdAt'>): Promise<PolicyVersion>;

  /** Versions of a policy, newest first. */
  listPolicyVersions?(policyId: string): Promise<PolicyVersion[]>;

  /** One version of a policy. */
  findPolicyVersion?(policyId: string, version: number): Promise<PolicyVersion | null>;

  createCommandIdempotent?(data: SendCommandInput): Promise<{ command: Command; created: boolean }>;

  /** Look up a command by its per-device idempotency key. */
  findCommandByIdempotencyKey?(deviceId: string, idempotencyKey: string): Promise<Command | null>;

  /**
   * Transition every undelivered command whose `expiresAt` is at or before
   * `now` to `expired`. Returns the number of rows changed.
   */
  expireCommands?(now: Date): Promise<number>;

  /**
   * Commands stuck in `acknowledged` past the ack timeout — acknowledged by the
   * device but never completed or failed.
   */
  listStuckAcknowledgedCommands?(options: {
    now: Date;
    ackTimeoutSeconds: number;
    limit: number;
  }): Promise<Command[]>;

  /**
   * Commands still awaiting a successful push: `pending`, not expired, with
   * `attemptCount < maxAttempts`, whose backoff window has elapsed.
   */
  listRetryableCommands?(options: {
    now: Date;
    backoffSeconds: number;
    limit: number;
  }): Promise<Command[]>;

  // Events
  createEvent(event: Omit<MDMEvent, 'id' | 'createdAt'>): Promise<MDMEvent>;
  listEvents(filter?: EventFilter): Promise<MDMEvent[]>;

  // Groups
  findGroup(id: string): Promise<Group | null>;
  listGroups(): Promise<Group[]>;
  createGroup(data: CreateGroupInput): Promise<Group>;
  updateGroup(id: string, data: UpdateGroupInput): Promise<Group>;
  deleteGroup(id: string): Promise<void>;
  listDevicesInGroup(groupId: string): Promise<Device[]>;
  addDeviceToGroup(deviceId: string, groupId: string): Promise<void>;
  removeDeviceFromGroup(deviceId: string, groupId: string): Promise<void>;
  getDeviceGroups(deviceId: string): Promise<Group[]>;

  // Push Tokens
  findPushToken(deviceId: string, provider: string): Promise<PushToken | null>;
  upsertPushToken(data: RegisterPushTokenInput): Promise<PushToken>;
  deletePushToken(deviceId: string, provider?: string): Promise<void>;

  // App Versions (optional - for version tracking)
  listAppVersions?(packageName: string): Promise<AppVersion[]>;
  createAppVersion?(data: Omit<AppVersion, 'id' | 'createdAt'>): Promise<AppVersion>;
  setMinimumVersion?(packageName: string, versionCode: number): Promise<void>;
  getMinimumVersion?(packageName: string): Promise<AppVersion | null>;

  // Rollback History (optional)
  createRollback?(data: CreateAppRollbackInput): Promise<AppRollback>;
  updateRollback?(id: string, data: Partial<AppRollback>): Promise<AppRollback>;
  listRollbacks?(filter?: { deviceId?: string; packageName?: string }): Promise<AppRollback[]>;

  // Group Hierarchy (optional)
  getGroupChildren?(parentId: string | null): Promise<Group[]>;
  getGroupAncestors?(groupId: string): Promise<Group[]>;
  getGroupDescendants?(groupId: string): Promise<Group[]>;
  getGroupTree?(rootId?: string): Promise<GroupTreeNode[]>;
  getGroupEffectivePolicy?(groupId: string): Promise<Policy | null>;
  moveGroup?(groupId: string, newParentId: string | null): Promise<Group>;
  getGroupHierarchyStats?(): Promise<GroupHierarchyStats>;

  // Enrollment challenges (optional - for Phase 2b device-pinned-key)
  /**
   * Persist a new single-use enrollment challenge. The adapter
   * should store it with `consumed_at = null` and enforce a
   * primary-key constraint on `challenge` so duplicate inserts
   * fail loudly.
   */
  createEnrollmentChallenge?(challenge: EnrollmentChallenge): Promise<void>;
  /**
   * Look up a challenge by its opaque value. Returns `null` if not
   * found. Does NOT filter on expiry — the core layer checks
   * freshness so the adapter stays dumb.
   */
  findEnrollmentChallenge?(challenge: string): Promise<EnrollmentChallenge | null>;
  /**
   * Atomically mark a challenge as consumed. Must set
   * `consumed_at = now()` and return the updated row only when the
   * challenge was previously unused. Adapters should implement
   * this as a conditional UPDATE (e.g. Postgres
   * `UPDATE ... WHERE consumed_at IS NULL RETURNING *`) so two
   * concurrent consume attempts cannot both succeed.
   */
  consumeEnrollmentChallenge?(challenge: string): Promise<EnrollmentChallenge | null>;
  /**
   * Delete expired, unconsumed challenges. Called periodically by
   * the core layer; adapters can no-op if they rely on a TTL index
   * elsewhere.
   */
  pruneExpiredEnrollmentChallenges?(now: Date): Promise<number>;

  // Tenants (optional - for multi-tenancy)
  findTenant?(id: string): Promise<Tenant | null>;
  findTenantBySlug?(slug: string): Promise<Tenant | null>;
  listTenants?(filter?: TenantFilter): Promise<TenantListResult>;
  createTenant?(data: CreateTenantInput): Promise<Tenant>;
  updateTenant?(id: string, data: UpdateTenantInput): Promise<Tenant>;
  deleteTenant?(id: string): Promise<void>;
  getTenantStats?(tenantId: string): Promise<TenantStats>;

  // Users (optional - for RBAC)
  findUser?(id: string): Promise<User | null>;
  findUserByEmail?(email: string, tenantId?: string): Promise<User | null>;
  listUsers?(filter?: UserFilter): Promise<UserListResult>;
  createUser?(data: CreateUserInput): Promise<User>;
  updateUser?(id: string, data: UpdateUserInput): Promise<User>;
  deleteUser?(id: string): Promise<void>;

  // Roles (optional - for RBAC)
  findRole?(id: string): Promise<Role | null>;
  listRoles?(tenantId?: string): Promise<Role[]>;
  createRole?(data: CreateRoleInput): Promise<Role>;
  updateRole?(id: string, data: UpdateRoleInput): Promise<Role>;
  deleteRole?(id: string): Promise<void>;
  assignRoleToUser?(userId: string, roleId: string): Promise<void>;
  removeRoleFromUser?(userId: string, roleId: string): Promise<void>;
  getUserRoles?(userId: string): Promise<Role[]>;

  // Audit Logs (optional - for compliance)
  createAuditLog?(data: CreateAuditLogInput): Promise<AuditLog>;
  listAuditLogs?(filter?: AuditLogFilter): Promise<AuditLogListResult>;
  deleteAuditLogs?(filter: { olderThan?: Date; tenantId?: string }): Promise<number>;

  // Scheduled Tasks (optional - for scheduling)
  findScheduledTask?(id: string): Promise<ScheduledTask | null>;
  listScheduledTasks?(filter?: ScheduledTaskFilter): Promise<ScheduledTaskListResult>;
  createScheduledTask?(data: CreateScheduledTaskInput): Promise<ScheduledTask>;
  updateScheduledTask?(id: string, data: UpdateScheduledTaskInput): Promise<ScheduledTask>;
  deleteScheduledTask?(id: string): Promise<void>;
  getUpcomingTasks?(hours: number): Promise<ScheduledTask[]>;
  createTaskExecution?(data: { taskId: string }): Promise<TaskExecution>;
  updateTaskExecution?(id: string, data: Partial<TaskExecution>): Promise<TaskExecution>;
  listTaskExecutions?(taskId: string, limit?: number): Promise<TaskExecution[]>;

  // Message Queue (optional - for persistent messaging)
  enqueueMessage?(data: EnqueueMessageInput): Promise<QueuedMessage>;
  dequeueMessages?(deviceId: string, limit?: number): Promise<QueuedMessage[]>;
  peekMessages?(deviceId: string, limit?: number): Promise<QueuedMessage[]>;
  acknowledgeMessage?(messageId: string): Promise<void>;
  failMessage?(messageId: string, error: string): Promise<void>;
  retryFailedMessages?(maxAttempts?: number): Promise<number>;
  purgeExpiredMessages?(): Promise<number>;
  getQueueStats?(tenantId?: string): Promise<QueueStats>;

  // Plugin Storage (optional)
  getPluginValue?(pluginName: string, key: string): Promise<unknown | null>;
  setPluginValue?(pluginName: string, key: string, value: unknown): Promise<void>;
  deletePluginValue?(pluginName: string, key: string): Promise<void>;
  listPluginKeys?(pluginName: string, prefix?: string): Promise<string[]>;
  clearPluginData?(pluginName: string): Promise<void>;

  // Dashboard (optional - for analytics)
  getDashboardStats?(tenantId?: string): Promise<DashboardStats>;
  getDeviceStatusBreakdown?(tenantId?: string): Promise<DeviceStatusBreakdown>;
  getEnrollmentTrend?(days: number, tenantId?: string): Promise<EnrollmentTrendPoint[]>;
  getCommandSuccessRates?(tenantId?: string): Promise<CommandSuccessRates>;
  getAppInstallationSummary?(tenantId?: string): Promise<AppInstallationSummary>;

  // Transactions (optional)
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}

export interface PushAdapter {
  /** Send push message to a device */
  send(deviceId: string, message: PushMessage): Promise<PushResult>;
  /** Send push message to multiple devices */
  sendBatch(deviceIds: string[], message: PushMessage): Promise<PushBatchResult>;
  /** Register device push token */
  registerToken?(deviceId: string, token: string): Promise<void>;
  /** Unregister device push token */
  unregisterToken?(deviceId: string): Promise<void>;
  /** Subscribe device to topic */
  subscribe?(deviceId: string, topic: string): Promise<void>;
  /** Unsubscribe device from topic */
  unsubscribe?(deviceId: string, topic: string): Promise<void>;
  /**
   * Release the adapter's resources (sockets, timers, in-flight waiters).
   *
   * Adapters that hold a long-lived connection — MQTT, WebSocket — leak it
   * without this. Call it on process shutdown.
   */
  disconnect?(): Promise<void>;
}

export interface PushMessage {
  type: string;
  payload?: Record<string, unknown>;
  priority?: 'high' | 'normal';
  ttl?: number;
  collapseKey?: string;
}

export interface PushResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface PushBatchResult {
  successCount: number;
  failureCount: number;
  results: Array<{ deviceId: string; result: PushResult }>;
}

// ============================================
// Plugin Interface
// ============================================

export interface MDMPlugin {
  /** Unique plugin name */
  name: string;
  /** Plugin version */
  version: string;

  /** Called when MDM is initialized */
  onInit?(mdm: MDMInstance): Promise<void>;

  /** Called when MDM is destroyed */
  onDestroy?(): Promise<void>;

  /** Additional routes to mount */
  routes?: PluginRoute[];

  /** Middleware to apply to all routes */
  middleware?: PluginMiddleware[];

  /** Extend enrollment process */
  onEnroll?(device: Device, request: EnrollmentRequest): Promise<void>;

  /** Extend device processing */
  onDeviceEnrolled?(device: Device): Promise<void>;
  onDeviceUnenrolled?(device: Device): Promise<void>;
  onHeartbeat?(device: Device, heartbeat: Heartbeat): Promise<void>;

  /** Extend policy processing */
  policySchema?: Record<string, unknown>;
  validatePolicy?(settings: PolicySettings): Promise<{ valid: boolean; errors?: string[] }>;
  applyPolicy?(device: Device, policy: Policy): Promise<void>;

  /** Extend command processing */
  commandTypes?: CommandType[];
  executeCommand?(device: Device, command: Command): Promise<CommandResult>;
}

export interface PluginRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: (context: unknown) => Promise<unknown>;
  auth?: boolean;
  admin?: boolean;
}

export type PluginMiddleware = (context: unknown, next: () => Promise<unknown>) => Promise<unknown>;

// ============================================
// MDM Instance Interface
// ============================================

export interface WebhookManager {
  /** Deliver an event to all matching webhook endpoints */
  deliver<T>(event: MDMEvent<T>): Promise<WebhookDeliveryResult[]>;
  /** Add a webhook endpoint at runtime */
  addEndpoint(endpoint: WebhookEndpoint): void;
  /** Remove a webhook endpoint */
  removeEndpoint(endpointId: string): void;
  /** Update a webhook endpoint */
  updateEndpoint(endpointId: string, updates: Partial<WebhookEndpoint>): void;
  /** Get all configured endpoints */
  getEndpoints(): WebhookEndpoint[];
  /** Test a webhook endpoint with a test payload */
  testEndpoint(endpointId: string): Promise<WebhookDeliveryResult>;
}

export interface WebhookDeliveryResult {
  endpointId: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  retryCount: number;
  deliveredAt?: Date;
}

export interface MDMInstance {
  /** Device management */
  devices: DeviceManager;
  /** Policy management */
  policies: PolicyManager;
  /** Application management */
  apps: ApplicationManager;
  /** Command management */
  commands: CommandManager;
  /** Group management */
  groups: GroupManager;

  /** Tenant management (if multi-tenancy enabled) */
  tenants?: TenantManager;
  /** Authorization management (RBAC) */
  authorization?: AuthorizationManager;
  /** Audit logging */
  audit?: AuditManager;
  /** Scheduled task management */
  schedules?: ScheduleManager;
  /** Persistent message queue */
  messageQueue?: MessageQueueManager;
  /** Dashboard analytics */
  dashboard?: DashboardManager;
  /** Plugin storage */
  pluginStorage?: PluginStorageAdapter;

  /** Push notification service */
  push: PushAdapter;

  /** Webhook delivery (if configured) */
  webhooks?: WebhookManager;

  /** Database adapter */
  db: DatabaseAdapter;

  /** Structured logger. Already scoped to the `openmdm` namespace. Plugins should call `.child({...})` to scope further. */
  logger: Logger;

  /** Configuration */
  config: MDMConfig;

  /** Subscribe to events */
  on<T extends EventType>(event: T, handler: EventHandler<T>): () => void;
  /** Emit an event */
  emit<T extends EventType>(event: T, data: EventPayloadMap[T]): Promise<void>;

  /** Process device enrollment */
  enroll(request: EnrollmentRequest): Promise<EnrollmentResponse>;
  /** Process device heartbeat */
  processHeartbeat(deviceId: string, heartbeat: Heartbeat): Promise<void>;
  /**
   * Return a tenant- and actor-scoped view of this instance.
   *
   * Every call made through it is tenant-isolated, permission-checked (when
   * `authorization.enabled` and a `userId` is supplied), and audit-logged
   * (when `audit.enabled`). Prefer this over the root instance for anything
   * driven by a user request — the root instance is the unscoped system
   * caller and performs none of those checks.
   *
   * @example
   * ```typescript
   * const scoped = mdm.withContext({ tenantId: 'acme', userId: user.id });
   * await scoped.devices.list();          // only Acme's devices
   * await scoped.devices.delete(id);      // 'delete:devices' enforced + audited
   * ```
   */
  withContext(context: MDMContext): ScopedMDM;

  /** Verify device token */
  verifyDeviceToken(
    token: string,
    options?: VerifyDeviceTokenOptions,
  ): Promise<{ deviceId: string } | null>;
  /**
   * Issue a fresh device token for an enrolled device. Used by HTTP
   * adapters to implement token renewal. Throws DeviceNotFoundError when
   * the device does not exist and EnrollmentError when its status makes it
   * ineligible (unenrolled/blocked devices cannot renew).
   */
  issueDeviceToken(deviceId: string): Promise<{ token: string; expiresAt: Date }>;

  /** App update enforcement (observed-vs-desired reconcile). */
  updates: UpdateManager;

  /** Get loaded plugins */
  getPlugins(): MDMPlugin[];
  /** Get plugin by name */
  getPlugin(name: string): MDMPlugin | undefined;
}

// ============================================
// Manager Interfaces
// ============================================

export interface DeviceManager {
  /** Where this device stands relative to its assigned policy. */
  getPolicyCompliance(deviceId: string): Promise<DevicePolicyCompliance>;

  // ----- Lifecycle -----

  /**
   * Suspend a device. It stays enrolled and keeps its history; it just stops
   * being allowed to act.
   */
  block(id: string, reason?: string): Promise<Device>;

  /** Lift a block, returning the device to `enrolled`. */
  unblock(id: string): Promise<Device>;

  /**
   * Phase one of unenrolling: move to `unenrolling` and tell the device to go.
   *
   * The device is NOT considered gone yet. Flipping straight to `unenrolled` is
   * what breaks fleets — the row says the device left while the device, which
   * never received the message, keeps heartbeating at a server that no longer
   * knows it. `wipe: true` also issues a factory reset.
   *
   * By default the queued command is `unenroll` (or `factoryReset` with
   * `wipe: true`) deduped under the idempotency key `unenroll:${id}`. Fleets
   * whose agents consume a different wire shape (e.g. mid-migration from a
   * legacy agent protocol) can pass `command` to override what is queued —
   * the default idempotency key still applies unless the override carries its
   * own — or `queueCommand: false` to arm the status without queueing
   * anything. With `queueCommand: false` no command will ever ACK, so the
   * caller is responsible for eventually calling {@link completeUnenroll}
   * (or {@link cancelUnenroll}).
   */
  beginUnenroll(
    id: string,
    options?: {
      wipe?: boolean;
      reason?: string;
      /**
       * Override the queued command entirely. Takes precedence over `wipe`
       * for command selection — the caller owns the wire shape.
       */
      command?: Omit<SendCommandInput, 'deviceId'>;
      /** Set to `false` to arm the status without queueing a command. */
      queueCommand?: boolean;
    },
  ): Promise<Device>;

  /**
   * Phase two: the device confirmed (or an operator forced it). Terminal.
   */
  completeUnenroll(id: string, options?: { force?: boolean }): Promise<Device>;

  /** Call off an armed unenroll and return the device to service. */
  cancelUnenroll(id: string): Promise<Device>;

  // ----- Desired state -----

  /**
   * Merge a patch into the device's desired state and bump its version.
   *
   * Desired state is declarative and rides on every heartbeat until the device
   * reports convergence — unlike a command, which is an event the device can
   * simply miss.
   */
  setDesiredState(id: string, patch: Record<string, unknown>): Promise<Device>;

  /** Where the device stands relative to its desired state. */
  getConvergence(id: string): Promise<DeviceConvergence>;

  // ----- App inventory -----

  /** Canonical, queryable app inventory for one device. */
  getApps(id: string): Promise<DeviceApp[]>;

  get(id: string): Promise<Device | null>;
  getByEnrollmentId(enrollmentId: string): Promise<Device | null>;
  list(filter?: DeviceFilter): Promise<DeviceListResult>;
  create(data: CreateDeviceInput): Promise<Device>;
  update(id: string, data: UpdateDeviceInput): Promise<Device>;
  delete(id: string): Promise<void>;
  assignPolicy(deviceId: string, policyId: string | null): Promise<Device>;
  addToGroup(deviceId: string, groupId: string): Promise<void>;
  removeFromGroup(deviceId: string, groupId: string): Promise<void>;
  getGroups(deviceId: string): Promise<Group[]>;
  sendCommand(deviceId: string, input: Omit<SendCommandInput, 'deviceId'>): Promise<Command>;
  sync(deviceId: string): Promise<Command>;
  reboot(deviceId: string): Promise<Command>;
  lock(deviceId: string, message?: string): Promise<Command>;
  wipe(deviceId: string, preserveData?: boolean): Promise<Command>;
}

export interface PolicyManager {
  get(id: string): Promise<Policy | null>;
  getDefault(): Promise<Policy | null>;
  list(): Promise<Policy[]>;
  create(data: CreatePolicyInput): Promise<Policy>;
  update(id: string, data: UpdatePolicyInput): Promise<Policy>;
  delete(id: string): Promise<void>;
  setDefault(id: string): Promise<Policy>;
  getDevices(policyId: string): Promise<Device[]>;
  applyToDevice(policyId: string, deviceId: string): Promise<void>;

  /** Every version of this policy, newest first. */
  history(policyId: string): Promise<PolicyVersion[]>;

  /** One historical version, or null if it never existed. */
  getVersion(policyId: string, version: number): Promise<PolicyVersion | null>;

  /**
   * Restore a policy's settings to an earlier version.
   *
   * This moves *forward*, not backward: the restored settings are written as a
   * NEW version (n+1) rather than resetting the counter. A device that already
   * applied version 5 must be able to tell that "5 again, but rolled back" is
   * something it has to re-apply — rewinding the counter would make the
   * rollback invisible to it.
   */
  rollback(policyId: string, toVersion: number, options?: { note?: string }): Promise<Policy>;

  /** Rollout state for this policy across the fleet. */
  getCompliance(policyId: string): Promise<PolicyCompliance>;
}

export interface ApplicationManager {
  get(id: string): Promise<Application | null>;
  getByPackage(packageName: string, version?: string): Promise<Application | null>;
  list(activeOnly?: boolean): Promise<Application[]>;
  register(data: CreateApplicationInput): Promise<Application>;
  update(id: string, data: UpdateApplicationInput): Promise<Application>;
  delete(id: string): Promise<void>;
  activate(id: string): Promise<Application>;
  deactivate(id: string): Promise<Application>;
  deploy(packageName: string, target: DeployTarget): Promise<void>;
  installOnDevice(packageName: string, deviceId: string, version?: string): Promise<Command>;
  uninstallFromDevice(packageName: string, deviceId: string): Promise<Command>;
}

export interface CommandManager {
  get(id: string): Promise<Command | null>;
  list(filter?: CommandFilter): Promise<Command[]>;
  send(input: SendCommandInput): Promise<Command>;
  cancel(id: string): Promise<Command>;
  acknowledge(id: string): Promise<Command>;
  complete(id: string, result: CommandResult): Promise<Command>;
  fail(id: string, error: string): Promise<Command>;
  /**
   * Commands awaiting delivery to this device. Expired commands are never
   * returned, and are transitioned to `expired` on the way out.
   */
  getPending(deviceId: string): Promise<Command[]>;

  /**
   * Re-push commands that are still `pending` because their original push
   * failed. Commands that exhaust `maxAttempts` are dead-lettered (moved to
   * `failed` with a `DELIVERY_EXHAUSTED` error) rather than being retried
   * forever.
   *
   * Call this from a scheduled job. Without it, a command whose push failed
   * sits `pending` until the device happens to poll — which is exactly the
   * "silently stuck forever" failure mode this exists to prevent.
   */
  retryPending(options?: { limit?: number }): Promise<CommandRetryResult>;

  /**
   * Transition commands past their `expiresAt` to `expired`. Returns the
   * number reaped. Call from the same scheduled job as `retryPending`.
   */
  expireStale(): Promise<number>;

  /**
   * Requeue commands stuck in `acknowledged` — the device confirmed receipt and
   * then never reported completion, which is what an agent crashing
   * mid-execution looks like from the server.
   *
   * Without this, such a command is lost: `getPendingCommands` only returns
   * `pending`/`sent`, so the device is never given it again.
   *
   * Requeued commands go back to `pending` and are re-pushed by the next
   * `retryPending()` sweep; commands that have exhausted `maxAttempts` are
   * dead-lettered instead. Delivery is at-least-once — see
   * `config.commands.ackTimeoutSeconds`.
   */
  sweepStuck(options?: { limit?: number }): Promise<{ requeued: number; deadLettered: number }>;
}

/**
 * App update enforcement.
 *
 * Issuing an `installApp` command is not the same as an app being installed. The
 * command can be delivered, acknowledged, and still leave the device on the old
 * version — a failed install, a crash mid-update, a user who declined. Command
 * durability (retry, dead-letter) covers *delivery*; nothing covered *outcome*.
 *
 * This engine closes that loop: it compares what each device reports having
 * installed against what it should have, re-issues the install with bounded
 * backoff, and escalates when a device keeps taking the command and not moving.
 */
export interface UpdateManager {
  /**
   * Declare the version an app should be on, optionally to a fraction of the
   * fleet. Devices are selected deterministically by `hash(deviceId) % 100`, so
   * the same 10% stay in the 10% — sampling at random would re-roll the dice on
   * every sweep and eventually hit everyone.
   */
  setDesiredAppVersion(rollout: AppRollout): Promise<{ targeted: number }>;

  /**
   * One reconcile pass: for every device whose observed version does not match
   * its desired one, issue an install (subject to backoff), or escalate if it
   * has taken the command too many times without converging.
   *
   * Call from a scheduled job.
   */
  reconcile(options?: { limit?: number }): Promise<UpdateReconcileResult>;

  /** Devices that keep taking the install and not converging. */
  listEscalated(packageName?: string): Promise<DeviceApp[]>;
}

export interface UpdateReconcileResult {
  /** Devices already on the desired version. */
  converged: number;
  /** Install commands issued this pass. */
  issued: number;
  /** Devices skipped because their backoff window has not elapsed. */
  backoff: number;
  /** Devices escalated for human attention this pass. */
  escalated: number;
}

export interface GroupManager {
  // Basic CRUD operations
  get(id: string): Promise<Group | null>;
  list(): Promise<Group[]>;
  create(data: CreateGroupInput): Promise<Group>;
  update(id: string, data: UpdateGroupInput): Promise<Group>;
  delete(id: string): Promise<void>;

  // Device management
  getDevices(groupId: string): Promise<Device[]>;
  addDevice(groupId: string, deviceId: string): Promise<void>;
  removeDevice(groupId: string, deviceId: string): Promise<void>;

  // Hierarchy operations
  getChildren(groupId: string): Promise<Group[]>;
  getTree(rootId?: string): Promise<GroupTreeNode[]>;
  getAncestors(groupId: string): Promise<Group[]>;
  getDescendants(groupId: string): Promise<Group[]>;
  move(groupId: string, newParentId: string | null): Promise<Group>;
  getEffectivePolicy(groupId: string): Promise<Policy | null>;
  getHierarchyStats(): Promise<GroupHierarchyStats>;
}

// ============================================
// Group Hierarchy Types
// ============================================

export interface GroupTreeNode extends Group {
  children: GroupTreeNode[];
  depth: number;
  path: string[];
  effectivePolicyId?: string | null;
}

export interface GroupHierarchyStats {
  totalGroups: number;
  maxDepth: number;
  groupsWithDevices: number;
  groupsWithPolicies: number;
}

// ============================================
// Tenant Types (Multi-tenancy)
// ============================================

export type TenantStatus = 'active' | 'suspended' | 'pending';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  settings?: TenantSettings | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSettings {
  maxDevices?: number;
  maxUsers?: number;
  features?: string[];
  branding?: {
    logo?: string;
    primaryColor?: string;
  };
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  settings?: TenantSettings;
  metadata?: Record<string, unknown>;
}

export interface UpdateTenantInput {
  name?: string;
  slug?: string;
  status?: TenantStatus;
  settings?: TenantSettings;
  metadata?: Record<string, unknown>;
}

export interface TenantFilter {
  status?: TenantStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface TenantListResult {
  tenants: Tenant[];
  total: number;
  limit: number;
  offset: number;
}

export interface TenantStats {
  deviceCount: number;
  userCount: number;
  policyCount: number;
  appCount: number;
}

// ============================================
// RBAC Types (Role-Based Access Control)
// ============================================

export type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'manage' | '*';
export type PermissionResource =
  | 'devices'
  | 'policies'
  | 'apps'
  | 'groups'
  | 'commands'
  | 'users'
  | 'roles'
  | 'tenants'
  | 'audit'
  | '*';

export interface Permission {
  action: PermissionAction;
  resource: PermissionResource;
  resourceId?: string;
}

export interface Role {
  id: string;
  tenantId?: string | null;
  name: string;
  description?: string | null;
  permissions: Permission[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoleInput {
  tenantId?: string;
  name: string;
  description?: string;
  permissions: Permission[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: Permission[];
}

export interface User {
  id: string;
  tenantId?: string | null;
  email: string;
  name?: string | null;
  status: 'active' | 'inactive' | 'pending';
  metadata?: Record<string, unknown> | null;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithRoles extends User {
  roles: Role[];
}

export interface CreateUserInput {
  tenantId?: string;
  email: string;
  name?: string;
  status?: 'active' | 'inactive' | 'pending';
  metadata?: Record<string, unknown>;
}

export interface UpdateUserInput {
  email?: string;
  name?: string;
  status?: 'active' | 'inactive' | 'pending';
  metadata?: Record<string, unknown>;
}

export interface UserFilter {
  tenantId?: string;
  status?: 'active' | 'inactive' | 'pending';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UserListResult {
  users: User[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================
// Audit Types
// ============================================

export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'enroll'
  | 'unenroll'
  | 'command'
  | 'export'
  | 'import'
  | 'custom';

export interface AuditLog {
  id: string;
  tenantId?: string | null;
  userId?: string | null;
  action: AuditAction;
  resource: string;
  resourceId?: string | null;
  status: 'success' | 'failure';
  error?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

export interface CreateAuditLogInput {
  tenantId?: string;
  userId?: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  status?: 'success' | 'failure';
  error?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditConfig {
  enabled: boolean;
  retentionDays?: number;
  skipReadOperations?: boolean;
  logActions?: AuditAction[];
  logResources?: string[];
}

export interface AuditSummary {
  totalLogs: number;
  byAction: Record<AuditAction, number>;
  byResource: Record<string, number>;
  byStatus: { success: number; failure: number };
  topUsers: Array<{ userId: string; count: number }>;
  recentFailures: AuditLog[];
}

export interface AuditLogFilter {
  tenantId?: string;
  userId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogListResult {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================
// Schedule Types
// ============================================

export type TaskType = 'command' | 'policy_update' | 'app_install' | 'maintenance' | 'custom';
export type ScheduledTaskStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface MaintenanceWindow {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  timezone: string;
}

export interface TaskSchedule {
  type: 'once' | 'recurring' | 'window';
  executeAt?: Date;
  cron?: string;
  window?: MaintenanceWindow;
}

export interface ScheduledTask {
  id: string;
  tenantId?: string | null;
  name: string;
  description?: string | null;
  taskType: TaskType;
  schedule: TaskSchedule;
  target?: DeployTarget;
  payload?: Record<string, unknown> | null;
  status: ScheduledTaskStatus;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  maxRetries: number;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduledTaskInput {
  tenantId?: string;
  name: string;
  description?: string;
  taskType: TaskType;
  schedule: TaskSchedule;
  target?: DeployTarget;
  payload?: Record<string, unknown>;
  maxRetries?: number;
}

export interface UpdateScheduledTaskInput {
  name?: string;
  description?: string;
  schedule?: TaskSchedule;
  target?: DeployTarget;
  payload?: Record<string, unknown>;
  status?: ScheduledTaskStatus;
  maxRetries?: number;
}

export interface ScheduledTaskFilter {
  tenantId?: string;
  taskType?: TaskType | TaskType[];
  status?: ScheduledTaskStatus | ScheduledTaskStatus[];
  limit?: number;
  offset?: number;
}

export interface ScheduledTaskListResult {
  tasks: ScheduledTask[];
  total: number;
  limit: number;
  offset: number;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date | null;
  devicesProcessed: number;
  devicesSucceeded: number;
  devicesFailed: number;
  error?: string | null;
  details?: Record<string, unknown> | null;
}

// ============================================
// Message Queue Types
// ============================================

export type QueueMessageStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'expired';

export interface QueuedMessage {
  id: string;
  tenantId?: string | null;
  deviceId: string;
  messageType: string;
  payload: Record<string, unknown>;
  priority: 'high' | 'normal' | 'low';
  status: QueueMessageStatus;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: Date | null;
  lastError?: string | null;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueMessageInput {
  tenantId?: string;
  deviceId: string;
  messageType: string;
  payload: Record<string, unknown>;
  priority?: 'high' | 'normal' | 'low';
  maxAttempts?: number;
  ttlSeconds?: number;
}

export interface QueueStats {
  pending: number;
  processing: number;
  delivered: number;
  failed: number;
  expired: number;
  byDevice: Record<string, number>;
  oldestPending?: Date;
}

// ============================================
// Dashboard Types
// ============================================

export interface DashboardStats {
  devices: {
    total: number;
    enrolled: number;
    active: number;
    blocked: number;
    pending: number;
  };
  policies: {
    total: number;
    deployed: number;
  };
  applications: {
    total: number;
    deployed: number;
  };
  commands: {
    pendingCount: number;
    last24hTotal: number;
    last24hSuccess: number;
    last24hFailed: number;
  };
  groups: {
    total: number;
    withDevices: number;
  };
}

export interface DeviceStatusBreakdown {
  byStatus: Record<DeviceStatus, number>;
  byOs: Record<string, number>;
  byManufacturer: Record<string, number>;
  byModel: Record<string, number>;
}

export interface EnrollmentTrendPoint {
  date: Date;
  enrolled: number;
  unenrolled: number;
  netChange: number;
  totalDevices: number;
}

export interface CommandSuccessRates {
  overall: {
    total: number;
    completed: number;
    failed: number;
    successRate: number;
  };
  byType: Record<
    string,
    {
      total: number;
      completed: number;
      failed: number;
      successRate: number;
      avgExecutionTimeMs?: number;
    }
  >;
  last24h: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
  };
}

export interface AppInstallationSummary {
  total: number;
  byStatus: Record<string, number>;
  recentFailures: Array<{
    packageName: string;
    deviceId: string;
    error: string;
    timestamp: Date;
  }>;
  topInstalled: Array<{
    packageName: string;
    name: string;
    installedCount: number;
  }>;
}

// ============================================
// Plugin Storage Types
// ============================================

export interface PluginStorageAdapter {
  get<T>(pluginName: string, key: string): Promise<T | null>;
  set<T>(pluginName: string, key: string, value: T): Promise<void>;
  delete(pluginName: string, key: string): Promise<void>;
  list(pluginName: string, prefix?: string): Promise<string[]>;
  clear(pluginName: string): Promise<void>;
}

export interface PluginStorageEntry {
  pluginName: string;
  key: string;
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Enterprise Manager Interfaces
// ============================================

export interface TenantManager {
  get(id: string): Promise<Tenant | null>;
  getBySlug(slug: string): Promise<Tenant | null>;
  list(filter?: TenantFilter): Promise<TenantListResult>;
  create(data: CreateTenantInput): Promise<Tenant>;
  update(id: string, data: UpdateTenantInput): Promise<Tenant>;
  delete(id: string, cascade?: boolean): Promise<void>;
  getStats(tenantId: string): Promise<TenantStats>;
  activate(id: string): Promise<Tenant>;
  deactivate(id: string): Promise<Tenant>;
}

export interface AuthorizationManager {
  createRole(data: CreateRoleInput): Promise<Role>;
  getRole(id: string): Promise<Role | null>;
  listRoles(tenantId?: string): Promise<Role[]>;
  updateRole(id: string, data: UpdateRoleInput): Promise<Role>;
  deleteRole(id: string): Promise<void>;
  createUser(data: CreateUserInput): Promise<User>;
  getUser(id: string): Promise<UserWithRoles | null>;
  getUserByEmail(email: string, tenantId?: string): Promise<UserWithRoles | null>;
  listUsers(filter?: UserFilter): Promise<UserListResult>;
  updateUser(id: string, data: UpdateUserInput): Promise<User>;
  deleteUser(id: string): Promise<void>;
  assignRole(userId: string, roleId: string): Promise<void>;
  removeRole(userId: string, roleId: string): Promise<void>;
  getUserRoles(userId: string): Promise<Role[]>;
  can(
    userId: string,
    action: PermissionAction,
    resource: PermissionResource,
    resourceId?: string,
  ): Promise<boolean>;
  canAny(
    userId: string,
    permissions: Array<{ action: PermissionAction; resource: PermissionResource }>,
  ): Promise<boolean>;
  requirePermission(
    userId: string,
    action: PermissionAction,
    resource: PermissionResource,
    resourceId?: string,
  ): Promise<void>;
  isAdmin(userId: string): Promise<boolean>;
}

export interface AuditManager {
  log(entry: CreateAuditLogInput): Promise<AuditLog>;
  list(filter?: AuditLogFilter): Promise<AuditLogListResult>;
  getByResource(resource: string, resourceId: string): Promise<AuditLog[]>;
  getByUser(userId: string, filter?: AuditLogFilter): Promise<AuditLogListResult>;
  export(filter: AuditLogFilter, format: 'json' | 'csv'): Promise<string>;
  purge(olderThanDays?: number): Promise<number>;
  getSummary(tenantId?: string, days?: number): Promise<AuditSummary>;
}

export interface ScheduleManager {
  get(id: string): Promise<ScheduledTask | null>;
  list(filter?: ScheduledTaskFilter): Promise<ScheduledTaskListResult>;
  create(data: CreateScheduledTaskInput): Promise<ScheduledTask>;
  update(id: string, data: UpdateScheduledTaskInput): Promise<ScheduledTask>;
  delete(id: string): Promise<void>;
  pause(id: string): Promise<ScheduledTask>;
  resume(id: string): Promise<ScheduledTask>;
  runNow(id: string): Promise<TaskExecution>;
  getUpcoming(hours: number): Promise<ScheduledTask[]>;
  getExecutions(taskId: string, limit?: number): Promise<TaskExecution[]>;
  calculateNextRun(schedule: TaskSchedule): Date | null;
}

export interface MessageQueueManager {
  enqueue(message: EnqueueMessageInput): Promise<QueuedMessage>;
  enqueueBatch(messages: EnqueueMessageInput[]): Promise<QueuedMessage[]>;
  dequeue(deviceId: string, limit?: number): Promise<QueuedMessage[]>;
  acknowledge(messageId: string): Promise<void>;
  fail(messageId: string, error: string): Promise<void>;
  retryFailed(maxAttempts?: number): Promise<number>;
  purgeExpired(): Promise<number>;
  getStats(tenantId?: string): Promise<QueueStats>;
  peek(deviceId: string, limit?: number): Promise<QueuedMessage[]>;
}

export interface DashboardManager {
  getStats(tenantId?: string): Promise<DashboardStats>;
  getDeviceStatusBreakdown(tenantId?: string): Promise<DeviceStatusBreakdown>;
  getEnrollmentTrend(days: number, tenantId?: string): Promise<EnrollmentTrendPoint[]>;
  getCommandSuccessRates(tenantId?: string): Promise<CommandSuccessRates>;
  getAppInstallationSummary(tenantId?: string): Promise<AppInstallationSummary>;
}

// ============================================
// Event Handler Types
// ============================================

export type EventHandler<T extends EventType> = (
  event: MDMEvent<EventPayloadMap[T]>,
) => Promise<void> | void;

export interface EventPayloadMap {
  'device.enrolled': { device: Device };
  'device.unenrolled': { device: Device; reason?: string };
  'device.blocked': { device: Device; reason?: string };
  'device.heartbeat': { device: Device; heartbeat: Heartbeat };
  'device.locationUpdated': { device: Device; location: DeviceLocation };
  'device.statusChanged': { device: Device; oldStatus: DeviceStatus; newStatus: DeviceStatus };
  'device.policyChanged': { device: Device; oldPolicyId?: string; newPolicyId?: string };
  'app.installed': { device: Device; app: InstalledApp };
  'app.uninstalled': { device: Device; packageName: string };
  'app.updated': { device: Device; app: InstalledApp; oldVersion: string };
  'app.crashed': { device: Device; packageName: string; error?: string };
  'app.started': { device: Device; packageName: string };
  'app.stopped': { device: Device; packageName: string };
  'policy.applied': { device: Device; policy: Policy };
  'policy.failed': { device: Device; policy: Policy; error: string };
  'policy.updated': { policy: Policy; previousVersion: number; affectedDeviceCount: number };
  'policy.rolledBack': { policy: Policy; fromVersion: number; restoredVersion: number };
  /** The device reported that it has applied the current desired state. */
  'device.converged': { device: Device; stateVersion: number };
  /**
   * A device reported a different version of an app than we last saw. The diff
   * used to happen nowhere: versions were overwritten inside a JSON blob with no
   * record that anything had changed, so "when did this fleet start running the
   * broken build?" was unanswerable.
   */
  'device.appVersionChanged': {
    device: Device;
    packageName: string;
    fromVersion: string | null;
    toVersion: string | null;
  };
  /**
   * A device has taken an install command repeatedly and its version still has
   * not moved. A human needs to look.
   */
  'device.updateEscalated': {
    device: Device;
    packageName: string;
    desiredVersion: string;
    observedVersion: string | null;
    attempts: number;
  };
  /**
   * A device reported a policy version older than the current one. Fired on
   * heartbeat, so a device that never converges keeps announcing itself rather
   * than going quiet.
   */
  'device.policyDrifted': {
    device: Device;
    policy: Policy;
    appliedVersion: number | null;
    currentVersion: number;
  };
  'command.received': { device: Device; command: Command };
  'command.acknowledged': { device: Device; command: Command };
  /**
   * A command the device acknowledged but never completed was requeued for
   * re-delivery. Usually means the agent crashed mid-execution.
   */
  'command.requeued': { device: Device; command: Command; reason: 'ACK_TIMEOUT' };
  'command.completed': { device: Device; command: Command; result: CommandResult };
  'command.failed': { device: Device; command: Command; error: string };
  'security.tamper': { device: Device; type: string; details?: unknown };
  'security.rootDetected': { device: Device };
  'security.screenLocked': { device: Device };
  'security.screenUnlocked': { device: Device };
  custom: Record<string, unknown>;
}

// ============================================
// Error Types
// ============================================

export class MDMError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'MDMError';
  }
}

export class DeviceNotFoundError extends MDMError {
  constructor(deviceId: string) {
    super(`Device not found: ${deviceId}`, 'DEVICE_NOT_FOUND', 404);
  }
}

export class PolicyNotFoundError extends MDMError {
  constructor(policyId: string) {
    super(`Policy not found: ${policyId}`, 'POLICY_NOT_FOUND', 404);
  }
}

export class ApplicationNotFoundError extends MDMError {
  constructor(identifier: string) {
    super(`Application not found: ${identifier}`, 'APPLICATION_NOT_FOUND', 404);
  }
}

export class CommandNotFoundError extends MDMError {
  constructor(commandId: string) {
    super(`Command not found: ${commandId}`, 'COMMAND_NOT_FOUND', 404);
  }
}

export class TenantNotFoundError extends MDMError {
  constructor(identifier: string) {
    super(`Tenant not found: ${identifier}`, 'TENANT_NOT_FOUND', 404);
  }
}

export class RoleNotFoundError extends MDMError {
  constructor(identifier: string) {
    super(`Role not found: ${identifier}`, 'ROLE_NOT_FOUND', 404);
  }
}

export class GroupNotFoundError extends MDMError {
  constructor(identifier: string) {
    super(`Group not found: ${identifier}`, 'GROUP_NOT_FOUND', 404);
  }
}

export class UserNotFoundError extends MDMError {
  constructor(identifier: string) {
    super(`User not found: ${identifier}`, 'USER_NOT_FOUND', 404);
  }
}

export class EnrollmentError extends MDMError {
  constructor(message: string, details?: unknown) {
    super(message, 'ENROLLMENT_ERROR', 400, details);
  }
}

export class AuthenticationError extends MDMError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTHENTICATION_ERROR', 401);
  }
}

export class AuthorizationError extends MDMError {
  constructor(message: string = 'Access denied') {
    super(message, 'AUTHORIZATION_ERROR', 403);
  }
}

export class ValidationError extends MDMError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

/**
 * The instance is configured in a way that cannot serve the request safely —
 * e.g. a tenant-scoped instance on an adapter that cannot scope by tenant.
 * Thrown at construction time, not per request.
 */
export class ConfigurationError extends MDMError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIGURATION_ERROR', 500, details);
  }
}
