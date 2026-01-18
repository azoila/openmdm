/**
 * OpenMDM Core Types
 *
 * These types define the core data structures for the MDM system.
 * Designed to be database-agnostic and framework-agnostic.
 */

// ============================================
// Device Types
// ============================================

export type DeviceStatus = 'pending' | 'enrolled' | 'unenrolled' | 'blocked';

export interface Device {
  id: string;
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
  lastHeartbeat?: Date | null;
  lastSync?: Date | null;

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

export interface CreateDeviceInput {
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
  externalId?: string | null;
  status?: DeviceStatus;
  policyId?: string | null;
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
}

export interface DeviceFilter {
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
  name: string;
  description?: string | null;
  isDefault: boolean;
  settings: PolicySettings;
  createdAt: Date;
  updatedAt: Date;
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
  name: string;
  description?: string;
  isDefault?: boolean;
  settings: PolicySettings;
}

export interface UpdatePolicyInput {
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
  | 'whitelistBattery'      // Whitelist app from battery optimization (Doze)
  | 'enablePermissiveMode'  // Enable permissive mode for debugging
  | 'setTimeZone'           // Set device timezone
  | 'enableAdb'             // Enable/disable ADB debugging
  | 'rollbackApp'           // Rollback to previous app version
  | 'custom';

export type CommandStatus =
  | 'pending'
  | 'sent'
  | 'acknowledged'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Command {
  id: string;
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
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

export interface SendCommandInput {
  deviceId: string;
  type: CommandType;
  payload?: Record<string, unknown>;
}

export interface CommandFilter {
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
  | 'command.received'
  | 'command.acknowledged'
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
  name: string;
  description?: string | null;
  policyId?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateGroupInput {
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

export type EnrollmentMethod =
  | 'qr'
  | 'nfc'
  | 'zero-touch'
  | 'knox'
  | 'manual'
  | 'app-only'
  | 'adb';

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
  signature: string;

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
}

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
  /** HMAC secret for device signature verification */
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
  updateCommand(id: string, data: Partial<Command>): Promise<Command>;
  getPendingCommands(deviceId: string): Promise<Command[]>;

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

export type PluginMiddleware = (
  context: unknown,
  next: () => Promise<unknown>
) => Promise<unknown>;

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
  /** Verify device token */
  verifyDeviceToken(token: string): Promise<{ deviceId: string } | null>;

  /** Get loaded plugins */
  getPlugins(): MDMPlugin[];
  /** Get plugin by name */
  getPlugin(name: string): MDMPlugin | undefined;
}

// ============================================
// Manager Interfaces
// ============================================

export interface DeviceManager {
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
  getPending(deviceId: string): Promise<Command[]>;
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
export type PermissionResource = 'devices' | 'policies' | 'apps' | 'groups' | 'commands' | 'users' | 'roles' | 'tenants' | 'audit' | '*';

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

export type AuditAction = 'create' | 'read' | 'update' | 'delete' | 'login' | 'logout' | 'enroll' | 'unenroll' | 'command' | 'export' | 'import' | 'custom';

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
  byType: Record<string, {
    total: number;
    completed: number;
    failed: number;
    successRate: number;
    avgExecutionTimeMs?: number;
  }>;
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
  can(userId: string, action: PermissionAction, resource: PermissionResource, resourceId?: string): Promise<boolean>;
  canAny(userId: string, permissions: Array<{ action: PermissionAction; resource: PermissionResource }>): Promise<boolean>;
  requirePermission(userId: string, action: PermissionAction, resource: PermissionResource, resourceId?: string): Promise<void>;
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
  event: MDMEvent<EventPayloadMap[T]>
) => Promise<void> | void;

export interface EventPayloadMap {
  'device.enrolled': { device: Device };
  'device.unenrolled': { device: Device; reason?: string };
  'device.blocked': { device: Device; reason: string };
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
  'command.received': { device: Device; command: Command };
  'command.acknowledged': { device: Device; command: Command };
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
    public details?: unknown
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
