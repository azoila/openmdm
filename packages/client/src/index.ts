/**
 * OpenMDM Client SDK
 *
 * Device-side SDK for communicating with OpenMDM server.
 * Platform-agnostic - works with any HTTP client implementation.
 *
 * @example
 * ```typescript
 * import { createMDMClient } from '@openmdm/client';
 *
 * const client = createMDMClient({
 *   serverUrl: 'https://mdm.example.com',
 *   deviceSecret: 'your-shared-secret',
 * });
 *
 * // Enroll device
 * const enrollment = await client.enroll({
 *   model: 'Pixel 6',
 *   manufacturer: 'Google',
 *   osVersion: '14',
 *   serialNumber: 'ABC123',
 *   method: 'app-only',
 * });
 *
 * // Send heartbeat
 * await client.heartbeat({
 *   batteryLevel: 85,
 *   isCharging: true,
 *   storageUsed: 32000000000,
 *   storageTotal: 128000000000,
 *   memoryUsed: 2000000000,
 *   memoryTotal: 8000000000,
 *   installedApps: [{ packageName: 'com.example.app', version: '1.0.0' }],
 * });
 * ```
 */

// ============================================
// Client Types
// ============================================

export type DeviceStatus = 'pending' | 'enrolled' | 'unenrolled' | 'blocked';
export type CommandStatus = 'pending' | 'sent' | 'acknowledged' | 'completed' | 'failed' | 'cancelled';
export type EnrollmentMethod = 'qr' | 'nfc' | 'zero-touch' | 'knox' | 'manual' | 'app-only' | 'adb';
export type HardwareControl = 'on' | 'off' | 'user';
export type SystemUpdatePolicy = 'auto' | 'windowed' | 'postpone' | 'manual';

export interface MDMClientConfig {
  /** MDM server URL */
  serverUrl: string;

  /** Shared secret for device enrollment signature */
  deviceSecret: string;

  /** Custom HTTP fetch implementation (defaults to global fetch) */
  fetch?: typeof fetch;

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Custom headers to include in all requests */
  headers?: Record<string, string>;

  /** Retry configuration */
  retry?: {
    maxRetries?: number;
    retryDelay?: number;
    backoffMultiplier?: number;
  };

  /** Event callbacks */
  onTokenRefresh?: (token: string, refreshToken?: string) => void;
  onEnrollmentLost?: () => void;
  onError?: (error: MDMClientError) => void;
}

export interface MDMClientState {
  deviceId?: string;
  enrollmentId?: string;
  token?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  policyVersion?: string;
  lastSync?: Date;
}

export interface DeviceInfo {
  model: string;
  manufacturer: string;
  osVersion: string;
  sdkVersion?: number;
  serialNumber?: string;
  imei?: string;
  macAddress?: string;
  androidId?: string;
  agentVersion?: string;
  agentPackage?: string;
}

export interface EnrollmentRequest extends DeviceInfo {
  method: EnrollmentMethod;
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
  tokenExpiresAt?: string;
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

export interface Policy {
  id: string;
  name: string;
  version?: string;
  settings: PolicySettings;
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
  updateWindow?: { start: string; end: string };

  // Security
  passwordPolicy?: {
    required: boolean;
    minLength?: number;
    complexity?: 'none' | 'numeric' | 'alphanumeric' | 'complex';
    maxFailedAttempts?: number;
    expirationDays?: number;
  };
  encryptionRequired?: boolean;
  factoryResetProtection?: boolean;
  safeBootDisabled?: boolean;

  // Telemetry
  heartbeatInterval?: number;
  locationReportInterval?: number;
  locationEnabled?: boolean;

  // Network
  wifiConfigs?: Array<{
    ssid: string;
    securityType: 'none' | 'wep' | 'wpa' | 'wpa2' | 'wpa3';
    password?: string;
    hidden?: boolean;
    autoConnect?: boolean;
  }>;
  vpnConfig?: {
    type: 'pptp' | 'l2tp' | 'ipsec' | 'openvpn' | 'wireguard';
    server: string;
    username?: string;
    password?: string;
    certificate?: string;
    config?: Record<string, unknown>;
  };

  // Applications
  applications?: Array<{
    packageName: string;
    action: 'install' | 'update' | 'uninstall';
    version?: string;
    required?: boolean;
    autoUpdate?: boolean;
  }>;

  // Custom settings
  custom?: Record<string, unknown>;
}

export interface HeartbeatData {
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
  networkName?: string;
  signalStrength?: number;
  ipAddress?: string;

  // Location
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };

  // Apps
  installedApps: Array<{
    packageName: string;
    version: string;
    versionCode?: number;
  }>;
  runningApps?: string[];

  // Security
  isRooted?: boolean;
  isEncrypted?: boolean;
  screenLockEnabled?: boolean;

  // Agent status
  agentVersion?: string;
  policyVersion?: string;
}

export interface HeartbeatResponse {
  success: boolean;
  pendingCommands?: Command[];
  policyUpdate?: Policy;
  message?: string;
}

export interface Command {
  id: string;
  type: CommandType;
  payload?: Record<string, unknown>;
  status: CommandStatus;
  createdAt: string;
}

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
  | 'custom';

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

export interface DeviceConfig {
  policy?: Policy;
  applications?: Array<{
    name: string;
    packageName: string;
    version: string;
    url: string;
    hash?: string;
    showIcon?: boolean;
    runAfterInstall?: boolean;
    runAtBoot?: boolean;
  }>;
  pendingCommands?: Command[];
}

// ============================================
// Error Types
// ============================================

export class MDMClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'MDMClientError';
  }
}

export class NetworkError extends MDMClientError {
  constructor(message: string = 'Network error', details?: unknown) {
    super(message, 'NETWORK_ERROR', 0, details);
  }
}

export class AuthenticationError extends MDMClientError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
  }
}

export class EnrollmentRequiredError extends MDMClientError {
  constructor() {
    super('Device not enrolled', 'ENROLLMENT_REQUIRED', 401);
  }
}

export class ServerError extends MDMClientError {
  constructor(message: string, statusCode: number = 500, details?: unknown) {
    super(message, 'SERVER_ERROR', statusCode, details);
  }
}

// ============================================
// Crypto Utilities
// ============================================

/**
 * Generate HMAC-SHA256 signature
 * Uses Web Crypto API for cross-platform compatibility
 */
async function generateHMAC(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate enrollment signature
 */
async function generateEnrollmentSignature(
  request: EnrollmentRequest,
  timestamp: string,
  secret: string
): Promise<string> {
  const message = [
    request.model,
    request.manufacturer,
    request.osVersion,
    request.serialNumber || '',
    request.imei || '',
    request.macAddress || '',
    request.androidId || '',
    request.method,
    timestamp,
  ].join('|');

  return generateHMAC(message, secret);
}

// ============================================
// MDM Client Implementation
// ============================================

export interface MDMClient {
  /** Current client state */
  readonly state: MDMClientState;

  /** Check if device is enrolled */
  isEnrolled(): boolean;

  /** Enroll device with MDM server */
  enroll(request: EnrollmentRequest): Promise<EnrollmentResponse>;

  /** Send heartbeat/check-in */
  heartbeat(data: HeartbeatData): Promise<HeartbeatResponse>;

  /** Get current device configuration */
  getConfig(): Promise<DeviceConfig>;

  /** Get pending commands */
  getPendingCommands(): Promise<Command[]>;

  /** Acknowledge command receipt */
  acknowledgeCommand(commandId: string): Promise<void>;

  /** Report command completion */
  completeCommand(commandId: string, result: CommandResult): Promise<void>;

  /** Report command failure */
  failCommand(commandId: string, error: string): Promise<void>;

  /** Register push token (FCM/MQTT) */
  registerPushToken(provider: 'fcm' | 'mqtt', token: string): Promise<void>;

  /** Unregister push token */
  unregisterPushToken(provider: 'fcm' | 'mqtt'): Promise<void>;

  /** Report event to server */
  reportEvent(type: string, payload?: Record<string, unknown>): Promise<void>;

  /** Set client state (for persistence restoration) */
  setState(state: MDMClientState): void;

  /** Clear enrollment and state */
  unenroll(): void;
}

/**
 * Create MDM client for device-side communication
 */
export function createMDMClient(config: MDMClientConfig): MDMClient {
  const fetchFn = config.fetch || fetch;
  const timeout = config.timeout ?? 30000;
  const maxRetries = config.retry?.maxRetries ?? 3;
  const retryDelay = config.retry?.retryDelay ?? 1000;
  const backoffMultiplier = config.retry?.backoffMultiplier ?? 2;

  let state: MDMClientState = {};

  /**
   * Make authenticated request to server
   */
  async function request<T>(
    path: string,
    options: RequestInit = {},
    retry = 0
  ): Promise<T> {
    const url = `${config.serverUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
      ...(options.headers as Record<string, string>),
    };

    // Add auth token if available
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetchFn(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(errorBody);
        } catch {
          errorData = { message: errorBody };
        }

        if (response.status === 401) {
          // Token expired or invalid
          if (state.refreshToken && retry === 0) {
            // Try to refresh token
            await refreshAuthToken();
            return request<T>(path, options, retry + 1);
          }
          config.onEnrollmentLost?.();
          throw new AuthenticationError(errorData.message);
        }

        throw new ServerError(
          errorData.message || `Server error: ${response.status}`,
          response.status,
          errorData
        );
      }

      const data = await response.json();
      return data as T;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new NetworkError('Request timeout');
      }

      if (error instanceof MDMClientError) {
        config.onError?.(error);
        throw error;
      }

      // Network error - retry with backoff
      if (retry < maxRetries) {
        const delay = retryDelay * Math.pow(backoffMultiplier, retry);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return request<T>(path, options, retry + 1);
      }

      const networkError = new NetworkError(error.message, error);
      config.onError?.(networkError);
      throw networkError;
    }
  }

  /**
   * Refresh authentication token
   */
  async function refreshAuthToken(): Promise<void> {
    if (!state.refreshToken) {
      throw new AuthenticationError('No refresh token available');
    }

    const response = await request<{
      token: string;
      refreshToken?: string;
      expiresAt?: string;
    }>('/agent/refresh-token', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    });

    state.token = response.token;
    if (response.refreshToken) {
      state.refreshToken = response.refreshToken;
    }
    if (response.expiresAt) {
      state.tokenExpiresAt = new Date(response.expiresAt);
    }

    config.onTokenRefresh?.(response.token, response.refreshToken);
  }

  return {
    get state() {
      return { ...state };
    },

    isEnrolled(): boolean {
      return !!(state.deviceId && state.token);
    },

    async enroll(enrollRequest: EnrollmentRequest): Promise<EnrollmentResponse> {
      const timestamp = new Date().toISOString();
      const signature = await generateEnrollmentSignature(
        enrollRequest,
        timestamp,
        config.deviceSecret
      );

      const response = await request<EnrollmentResponse>('/agent/enroll', {
        method: 'POST',
        body: JSON.stringify({
          ...enrollRequest,
          timestamp,
          signature,
        }),
      });

      // Update state with enrollment response
      state = {
        deviceId: response.deviceId,
        enrollmentId: response.enrollmentId,
        token: response.token,
        refreshToken: response.refreshToken,
        tokenExpiresAt: response.tokenExpiresAt
          ? new Date(response.tokenExpiresAt)
          : undefined,
        policyVersion: response.policy?.version,
        lastSync: new Date(),
      };

      config.onTokenRefresh?.(response.token, response.refreshToken);

      return response;
    },

    async heartbeat(data: HeartbeatData): Promise<HeartbeatResponse> {
      if (!this.isEnrolled()) {
        throw new EnrollmentRequiredError();
      }

      const response = await request<HeartbeatResponse>('/agent/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: state.deviceId,
          timestamp: new Date().toISOString(),
          ...data,
        }),
      });

      state.lastSync = new Date();

      if (response.policyUpdate) {
        state.policyVersion = response.policyUpdate.version;
      }

      return response;
    },

    async getConfig(): Promise<DeviceConfig> {
      if (!this.isEnrolled()) {
        throw new EnrollmentRequiredError();
      }

      return request<DeviceConfig>('/agent/config');
    },

    async getPendingCommands(): Promise<Command[]> {
      if (!this.isEnrolled()) {
        throw new EnrollmentRequiredError();
      }

      const response = await request<{ commands: Command[] }>(
        '/agent/commands/pending'
      );
      return response.commands;
    },

    async acknowledgeCommand(commandId: string): Promise<void> {
      if (!this.isEnrolled()) {
        throw new EnrollmentRequiredError();
      }

      await request(`/agent/commands/${commandId}/ack`, {
        method: 'POST',
      });
    },

    async completeCommand(
      commandId: string,
      result: CommandResult
    ): Promise<void> {
      if (!this.isEnrolled()) {
        throw new EnrollmentRequiredError();
      }

      await request(`/agent/commands/${commandId}/complete`, {
        method: 'POST',
        body: JSON.stringify(result),
      });
    },

    async failCommand(commandId: string, error: string): Promise<void> {
      if (!this.isEnrolled()) {
        throw new EnrollmentRequiredError();
      }

      await request(`/agent/commands/${commandId}/fail`, {
        method: 'POST',
        body: JSON.stringify({ error }),
      });
    },

    async registerPushToken(
      provider: 'fcm' | 'mqtt',
      token: string
    ): Promise<void> {
      if (!this.isEnrolled()) {
        throw new EnrollmentRequiredError();
      }

      await request('/agent/push-token', {
        method: 'POST',
        body: JSON.stringify({ provider, token }),
      });
    },

    async unregisterPushToken(provider: 'fcm' | 'mqtt'): Promise<void> {
      if (!this.isEnrolled()) {
        throw new EnrollmentRequiredError();
      }

      await request('/agent/push-token', {
        method: 'DELETE',
        body: JSON.stringify({ provider }),
      });
    },

    async reportEvent(
      type: string,
      payload?: Record<string, unknown>
    ): Promise<void> {
      if (!this.isEnrolled()) {
        throw new EnrollmentRequiredError();
      }

      await request('/agent/events', {
        method: 'POST',
        body: JSON.stringify({
          type,
          payload,
          timestamp: new Date().toISOString(),
        }),
      });
    },

    setState(newState: MDMClientState): void {
      state = { ...newState };
      if (newState.tokenExpiresAt && typeof newState.tokenExpiresAt === 'string') {
        state.tokenExpiresAt = new Date(newState.tokenExpiresAt);
      }
      if (newState.lastSync && typeof newState.lastSync === 'string') {
        state.lastSync = new Date(newState.lastSync);
      }
    },

    unenroll(): void {
      state = {};
      config.onEnrollmentLost?.();
    },
  };
}

// ============================================
// Command Handler Utilities
// ============================================

export interface CommandHandler {
  type: CommandType;
  execute: (payload?: Record<string, unknown>) => Promise<CommandResult>;
}

export interface CommandProcessor {
  /** Register a command handler */
  register(handler: CommandHandler): void;

  /** Process a command */
  process(command: Command): Promise<CommandResult>;

  /** Check if command type is supported */
  supports(type: CommandType): boolean;
}

/**
 * Create command processor for handling MDM commands
 */
export function createCommandProcessor(): CommandProcessor {
  const handlers = new Map<CommandType, CommandHandler['execute']>();

  return {
    register(handler: CommandHandler): void {
      handlers.set(handler.type, handler.execute);
    },

    async process(command: Command): Promise<CommandResult> {
      const handler = handlers.get(command.type);

      if (!handler) {
        return {
          success: false,
          message: `Unsupported command type: ${command.type}`,
        };
      }

      try {
        return await handler(command.payload);
      } catch (error: any) {
        return {
          success: false,
          message: error.message || 'Command execution failed',
        };
      }
    },

    supports(type: CommandType): boolean {
      return handlers.has(type);
    },
  };
}

// ============================================
// Heartbeat Scheduler
// ============================================

export interface HeartbeatSchedulerConfig {
  /** Heartbeat interval in milliseconds (default: 60000 = 1 minute) */
  interval?: number;

  /** Function to collect heartbeat data */
  collectData: () => Promise<HeartbeatData> | HeartbeatData;

  /** Callback when heartbeat succeeds */
  onSuccess?: (response: HeartbeatResponse) => void;

  /** Callback when heartbeat fails */
  onError?: (error: Error) => void;

  /** Callback when commands are received */
  onCommands?: (commands: Command[]) => void;

  /** Callback when policy update is received */
  onPolicyUpdate?: (policy: Policy) => void;
}

export interface HeartbeatScheduler {
  /** Start sending heartbeats */
  start(): void;

  /** Stop sending heartbeats */
  stop(): void;

  /** Send heartbeat immediately */
  sendNow(): Promise<HeartbeatResponse>;

  /** Check if scheduler is running */
  isRunning(): boolean;

  /** Update interval */
  setInterval(ms: number): void;
}

/**
 * Create heartbeat scheduler for automatic check-ins
 */
export function createHeartbeatScheduler(
  client: MDMClient,
  config: HeartbeatSchedulerConfig
): HeartbeatScheduler {
  let interval = config.interval ?? 60000;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function sendHeartbeat(): Promise<HeartbeatResponse> {
    try {
      const data = await config.collectData();
      const response = await client.heartbeat(data);

      config.onSuccess?.(response);

      if (response.pendingCommands && response.pendingCommands.length > 0) {
        config.onCommands?.(response.pendingCommands);
      }

      if (response.policyUpdate) {
        config.onPolicyUpdate?.(response.policyUpdate);
      }

      return response;
    } catch (error: any) {
      config.onError?.(error);
      throw error;
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;

      // Send immediately, then schedule
      sendHeartbeat().catch(() => {});

      timerId = setInterval(() => {
        sendHeartbeat().catch(() => {});
      }, interval);
    },

    stop(): void {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      running = false;
    },

    async sendNow(): Promise<HeartbeatResponse> {
      return sendHeartbeat();
    },

    isRunning(): boolean {
      return running;
    },

    setInterval(ms: number): void {
      interval = ms;
      if (running) {
        this.stop();
        this.start();
      }
    },
  };
}

// ============================================
// Persistence Helpers
// ============================================

/**
 * Serialize client state for storage
 */
export function serializeState(state: MDMClientState): string {
  return JSON.stringify({
    ...state,
    tokenExpiresAt: state.tokenExpiresAt?.toISOString(),
    lastSync: state.lastSync?.toISOString(),
  });
}

/**
 * Deserialize client state from storage
 */
export function deserializeState(data: string): MDMClientState {
  const parsed = JSON.parse(data);
  return {
    ...parsed,
    tokenExpiresAt: parsed.tokenExpiresAt
      ? new Date(parsed.tokenExpiresAt)
      : undefined,
    lastSync: parsed.lastSync ? new Date(parsed.lastSync) : undefined,
  };
}

// ============================================
// Re-exports
// ============================================

export { generateHMAC, generateEnrollmentSignature };
