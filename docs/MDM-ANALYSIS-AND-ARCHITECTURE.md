# Modern MDM Solution: Analysis & Architecture Proposal

**Date:** 2026-01-16
**Project:** android-mdm
**Status:** Research & Design Phase

---

## Executive Summary

This document analyzes the current state of Android MDM solutions, specifically Headwind MDM, and proposes a modern, embeddable MDM framework inspired by better-auth's architecture. The goal is to create a flexible, SDK-style MDM solution that can be integrated into any application regardless of the technology stack.

---

## 1. Current State Analysis

### 1.1 Headwind MDM Assessment

**Strengths:**
- Open-source with active community (449+ stars, 204 forks)
- Mature feature set (kiosk mode, device owner, remote control)
- Plugin architecture for extensibility
- Samsung Knox SDK integration
- MQTT-based push notifications (works in private networks)
- F-Droid compatible launcher

**Weaknesses:**
- **Legacy Architecture**: Spring Boot + Tomcat (Java monolith)
- **Poorly Documented API**: Discovered via web panel inspection, not officially documented as REST
- **Session-based Auth**: MD5 password hashing, JSESSIONID cookies
- **Tight Coupling**: Cannot use MDM features without deploying entire server
- **Limited Integration**: No SDKs for other languages/frameworks
- **Database Lock-in**: Requires dedicated PostgreSQL instance
- **No Webhooks (Community)**: Enterprise-only feature forces polling

**Community Pain Points (from qa.h-mdm.com):**
1. Kiosk mode failures on Android 13/14/15
2. Remote operations timing issues
3. QR provisioning complexity
4. OEMConfig support gaps (Zebra, DataWedge)
5. Plugin development restrictions
6. Integration difficulties with existing systems

### 1.2 Android Enterprise Landscape (2025-2026)

**Critical Change: Custom DPC Allowlist**
Google now requires all DPCs to be on an approved allowlist. Non-approved DPCs trigger "Harmful app blocked" during enrollment. This fundamentally changes the MDM landscape.

**Two Paths Forward:**

| Aspect | Custom DPC | Android Management API (AMAPI) |
|--------|-----------|-------------------------------|
| Development | Build & maintain DPC app | Use Google's Android Device Policy |
| Approval | Must be on Google allowlist | Automatic (uses Google's app) |
| Features | Full control, may lag new Android | First-class support, new features fast |
| Maintenance | High (test each Android version) | Low (Google maintains) |
| Flexibility | Maximum | API-constrained |

**Recommendation:** Hybrid approach - AMAPI for standard enterprise features, lightweight custom companion app for value-adds.

---

## 2. Proposed Architecture: "OpenMDM"

### 2.1 Design Philosophy (Inspired by better-auth)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          YOUR APPLICATION                            │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐   │
│  │   Next.js     │  │    Express    │  │   Spring Boot/Go/Rust │   │
│  │   Nuxt        │  │    Hono       │  │   Any Backend         │   │
│  │   SvelteKit   │  │    Fastify    │  │                       │   │
│  └───────┬───────┘  └───────┬───────┘  └───────────┬───────────┘   │
│          │                  │                       │               │
│          └──────────────────┼───────────────────────┘               │
│                             │                                        │
│                    ┌────────▼────────┐                              │
│                    │    OpenMDM      │                              │
│                    │  SDK/Library    │                              │
│                    └────────┬────────┘                              │
│                             │                                        │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
      ┌───────▼───────┐ ┌────▼────┐ ┌───────▼───────┐
      │  Your Database │ │  AMAPI  │ │  Device Agent │
      │  (Postgres/    │ │ (Google)│ │  (Android App)│
      │  MySQL/SQLite) │ └─────────┘ └───────────────┘
      └───────────────┘
```

### 2.2 Core Principles

1. **Embeddable, Not Standalone**
   - Works within your existing app, not as a separate service
   - Uses your database, your auth, your infrastructure

2. **Framework Agnostic**
   - Core in TypeScript with adapters for any HTTP framework
   - Database adapters for Drizzle, Prisma, TypeORM, Kysely
   - Future: Go, Rust, Python SDKs

3. **Progressive Enhancement**
   - Start simple: device inventory + app distribution
   - Add features as needed: kiosk, geofence, remote control
   - Plugin system for custom functionality

4. **Non-Locking**
   - Standard database schema, export anytime
   - Open protocols (REST, WebSocket, MQTT)
   - No proprietary cloud dependency

### 2.3 Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Admin UI   │  │  REST API   │  │  React/Vue Components   │  │
│  │ (Optional)  │  │  (Auto-gen) │  │  (Embeddable widgets)   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                         CORE LAYER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Device    │  │   Policy    │  │    Application          │  │
│  │   Manager   │  │   Engine    │  │    Manager              │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Command   │  │   Event     │  │    Telemetry            │  │
│  │   Queue     │  │   Bus       │  │    Collector            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                       ADAPTER LAYER                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Database   │  │   HTTP      │  │     Push Service        │  │
│  │  Adapter    │  │   Adapter   │  │     Adapter             │  │
│  │ Drizzle/    │  │ Hono/Express│  │  FCM/MQTT/WebSocket     │  │
│  │ Prisma/etc  │  │ /Fastify    │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      PLUGIN LAYER                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Kiosk     │  │  Geofence   │  │    Remote Control       │  │
│  │   Plugin    │  │  Plugin     │  │    Plugin               │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Knox      │  │   AMAPI     │  │    Custom               │  │
│  │   Plugin    │  │  Integration│  │    Plugins              │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. SDK Design

### 3.1 TypeScript/JavaScript SDK (Primary)

```typescript
// Installation
// npm install @openmdm/core @openmdm/drizzle-adapter @openmdm/hono

// Basic Setup
import { createMDM } from '@openmdm/core';
import { drizzleAdapter } from '@openmdm/drizzle-adapter';
import { honoPlugin } from '@openmdm/hono';
import { db } from './db';

export const mdm = createMDM({
  // Database adapter
  database: drizzleAdapter(db),

  // Authentication integration (use your existing auth)
  auth: {
    getUser: async (req) => req.user,
    requireAdmin: async (user) => user.role === 'admin',
  },

  // Push notification service
  push: {
    provider: 'fcm', // or 'mqtt', 'websocket'
    credentials: process.env.FCM_CREDENTIALS,
  },

  // Device enrollment
  enrollment: {
    // Auto-enroll devices that present valid signature
    autoEnroll: true,
    // HMAC secret for device authentication
    deviceSecret: process.env.DEVICE_HMAC_SECRET,
    // Enrollment webhook
    onEnroll: async (device) => {
      await notifyAdmins(`New device enrolled: ${device.model}`);
    },
  },

  // Plugins
  plugins: [
    kioskPlugin({ defaultPolicy: 'standard' }),
    geofencePlugin(),
    // amApiPlugin({ projectId: 'my-project' }), // Optional AMAPI integration
  ],
});

// Mount on your framework
app.use('/mdm/*', honoPlugin(mdm));
```

### 3.2 API Usage Examples

```typescript
// Device Management
const devices = await mdm.devices.list({ status: 'active' });
const device = await mdm.devices.get('device-123');
await mdm.devices.sendCommand('device-123', { type: 'reboot' });
await mdm.devices.assignPolicy('device-123', 'kiosk-policy');

// Application Management
await mdm.apps.register({
  name: 'My App',
  packageName: 'com.example.myapp',
  url: 'https://storage.example.com/app.apk',
  version: '1.2.3',
});

await mdm.apps.deploy('com.example.myapp', {
  devices: ['device-123', 'device-456'],
  // or: policies: ['default-policy'],
  // or: groups: ['warehouse-team'],
});

// Policy Management
const policy = await mdm.policies.create({
  name: 'Kiosk Mode',
  settings: {
    kioskMode: true,
    mainApp: 'com.example.myapp',
    lockStatusBar: true,
    lockSettings: true,
    allowedApps: ['com.example.myapp', 'com.android.settings'],
  },
});

// Events & Webhooks
mdm.on('device.enrolled', async (event) => {
  console.log('Device enrolled:', event.device);
});

mdm.on('device.heartbeat', async (event) => {
  // Update device status in your system
});

mdm.on('app.installed', async (event) => {
  console.log(`${event.packageName} installed on ${event.deviceId}`);
});
```

### 3.3 Database Schema (Framework-Agnostic)

```typescript
// @openmdm/core/schema.ts
export const mdmSchema = {
  devices: {
    id: 'string', // UUID
    externalId: 'string', // Your system's device ID (optional link)
    enrollmentId: 'string', // Unique enrollment identifier
    status: 'enum', // pending | enrolled | unenrolled | blocked

    // Device Info
    model: 'string',
    manufacturer: 'string',
    osVersion: 'string',
    serialNumber: 'string',
    imei: 'string?',
    macAddress: 'string?',

    // MDM State
    policyId: 'string?',
    groupId: 'string?',
    lastHeartbeat: 'datetime',
    lastSync: 'datetime',

    // Telemetry
    batteryLevel: 'number?',
    storageUsed: 'number?',
    storageTotal: 'number?',
    location: 'json?', // { lat, lng, accuracy, timestamp }
    installedApps: 'json', // [{ pkg, version, versionCode }]

    // Metadata
    tags: 'json', // { key: value } for custom categorization
    createdAt: 'datetime',
    updatedAt: 'datetime',
  },

  policies: {
    id: 'string',
    name: 'string',
    description: 'string?',
    isDefault: 'boolean',

    // Policy Settings (JSON for flexibility)
    settings: 'json', // See PolicySettings type

    createdAt: 'datetime',
    updatedAt: 'datetime',
  },

  applications: {
    id: 'string',
    name: 'string',
    packageName: 'string',
    version: 'string',
    versionCode: 'number',
    url: 'string', // Download URL
    hash: 'string', // SHA-256 for integrity
    size: 'number',
    minSdkVersion: 'number?',

    // Deployment settings
    showIcon: 'boolean',
    runAfterInstall: 'boolean',
    runAtBoot: 'boolean',

    // Metadata
    isActive: 'boolean',
    createdAt: 'datetime',
    updatedAt: 'datetime',
  },

  commands: {
    id: 'string',
    deviceId: 'string',
    type: 'string', // reboot | sync | install | uninstall | shell | etc
    payload: 'json?',
    status: 'enum', // pending | sent | acknowledged | completed | failed
    result: 'json?',
    createdAt: 'datetime',
    sentAt: 'datetime?',
    completedAt: 'datetime?',
  },

  events: {
    id: 'string',
    deviceId: 'string',
    type: 'string', // heartbeat | app.installed | app.crashed | location.updated | etc
    payload: 'json',
    createdAt: 'datetime',
  },

  groups: {
    id: 'string',
    name: 'string',
    description: 'string?',
    policyId: 'string?', // Default policy for group
    createdAt: 'datetime',
  },
};
```

### 3.4 Policy Settings Type

```typescript
interface PolicySettings {
  // Kiosk Mode
  kioskMode?: boolean;
  mainApp?: string; // Package name of kiosk app
  allowedApps?: string[]; // Whitelisted packages

  // Lock Features
  lockStatusBar?: boolean;
  lockNavigationBar?: boolean;
  lockSettings?: boolean;
  lockPowerButton?: boolean;
  blockInstall?: boolean;
  blockUninstall?: boolean;

  // Hardware Controls
  bluetooth?: 'on' | 'off' | 'user';
  wifi?: 'on' | 'off' | 'user';
  gps?: 'on' | 'off' | 'user';
  mobileData?: 'on' | 'off' | 'user';
  camera?: 'on' | 'off' | 'user';
  microphone?: 'on' | 'off' | 'user';
  usb?: 'on' | 'off' | 'user';

  // Update Settings
  systemUpdatePolicy?: 'auto' | 'windowed' | 'postpone' | 'manual';
  updateWindow?: { start: string; end: string }; // "02:00" - "04:00"

  // Security
  passwordPolicy?: {
    required: boolean;
    minLength?: number;
    complexity?: 'none' | 'numeric' | 'alphanumeric' | 'complex';
  };
  encryptionRequired?: boolean;

  // Telemetry
  heartbeatInterval?: number; // seconds
  locationReportInterval?: number; // seconds

  // Applications
  applications?: Array<{
    packageName: string;
    action: 'install' | 'remove' | 'update';
    version?: string; // Specific version or 'latest'
  }>;
}
```

---

## 4. Android Agent Architecture

### 4.1 Dual-Mode Agent Design

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenMDM Android Agent                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Agent Core                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │  Enrollment │  │  Heartbeat  │  │   Command       │   │   │
│  │  │  Manager    │  │  Service    │  │   Executor      │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │   Policy    │  │    App      │  │   Telemetry     │   │   │
│  │  │   Enforcer  │  │  Installer  │  │   Collector     │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│           ┌──────────────────┼──────────────────┐               │
│           │                  │                  │               │
│  ┌────────▼───────┐  ┌──────▼──────┐  ┌───────▼───────┐        │
│  │  Device Owner  │  │   AMAPI     │  │  Profile      │        │
│  │  Mode (DPC)    │  │  Mode       │  │  Owner Mode   │        │
│  │                │  │  (ADP)      │  │  (BYOD)       │        │
│  │ Full control   │  │  Standard   │  │  Work profile │        │
│  │ Custom features│  │  enterprise │  │  separation   │        │
│  └────────────────┘  └─────────────┘  └───────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Enrollment Options

| Method | Android | Best For | Complexity |
|--------|---------|----------|------------|
| QR Code | 7.0+ | General deployment | Low |
| Zero-Touch | 8.0+ | Enterprise (authorized resellers) | Medium |
| Knox KME | Samsung | Samsung fleet | Medium |
| NFC Bump | 5.0+ | On-site provisioning | Low |
| AOSP Baked | Any | Custom hardware/kiosk | High |
| App-Only | 5.0+ | BYOD, light management | Lowest |

### 4.3 Companion App vs Device Owner

**Recommended Hybrid Approach:**

```kotlin
// Agent detects best management mode on enrollment
class EnrollmentManager {
    suspend fun enroll(config: EnrollmentConfig): EnrollmentResult {
        return when {
            // If device already has AMAPI (Android Device Policy)
            isAmapiManaged() -> {
                // Register as companion, leverage AMAPI for policies
                enrollAsCompanion(config)
            }
            // If we can become Device Owner
            canBecomeDeviceOwner() -> {
                // Full control mode for kiosk/dedicated devices
                enrollAsDeviceOwner(config)
            }
            // Fallback to app-only mode
            else -> {
                // Limited features but still useful
                enrollAsAppOnly(config)
            }
        }
    }
}
```

---

## 5. Multi-Language SDK Strategy

### 5.1 Phase 1: TypeScript (Foundation)

```
@openmdm/core         - Core MDM logic, types, schema
@openmdm/client       - Browser/React Native client
@openmdm/hono         - Hono framework adapter
@openmdm/express      - Express adapter
@openmdm/fastify      - Fastify adapter
@openmdm/nextjs       - Next.js integration
@openmdm/drizzle      - Drizzle ORM adapter
@openmdm/prisma       - Prisma adapter
```

### 5.2 Phase 2: Protocol Buffer Definition

```protobuf
// openmdm.proto - Canonical API definition
syntax = "proto3";

package openmdm.v1;

service DeviceService {
  rpc ListDevices(ListDevicesRequest) returns (ListDevicesResponse);
  rpc GetDevice(GetDeviceRequest) returns (Device);
  rpc EnrollDevice(EnrollDeviceRequest) returns (EnrollDeviceResponse);
  rpc SendCommand(SendCommandRequest) returns (CommandResponse);
}

message Device {
  string id = 1;
  string enrollment_id = 2;
  DeviceStatus status = 3;
  DeviceInfo info = 4;
  // ...
}
```

### 5.3 Phase 3: Native SDKs (Generated + Hand-Tuned)

```
openmdm-go/           - Go SDK (gRPC + REST)
openmdm-rust/         - Rust SDK
openmdm-java/         - Java/Kotlin SDK
openmdm-python/       - Python SDK
```

---

## 6. Feature Comparison

### 6.1 OpenMDM vs Headwind MDM vs Commercial

| Feature | OpenMDM | Headwind (OSS) | Headwind (Ent) | Commercial |
|---------|---------|----------------|----------------|------------|
| **Integration** | | | | |
| Embeddable SDK | Yes | No | No | Some |
| Use your database | Yes | No | No | No |
| Framework agnostic | Yes | No | No | No |
| Multi-language | Yes | Java only | Java only | Varies |
| | | | | |
| **Device Management** | | | | |
| Device enrollment | Yes | Yes | Yes | Yes |
| QR provisioning | Yes | Yes | Yes | Yes |
| Zero-Touch | Planned | Limited | Yes | Yes |
| Device Owner mode | Yes | Yes | Yes | Yes |
| AMAPI integration | Planned | No | No | Most |
| | | | | |
| **App Management** | | | | |
| Silent install | Yes | Yes | Yes | Yes |
| Version control | Yes | Yes | Yes | Yes |
| Rollback | Yes | Limited | Yes | Yes |
| Private app store | Planned | Plugin | Yes | Yes |
| | | | | |
| **Policies** | | | | |
| Kiosk mode | Yes | Yes | Yes | Yes |
| Hardware controls | Yes | Yes | Yes | Yes |
| Password policies | Yes | Limited | Yes | Yes |
| Geofencing | Plugin | No | Plugin | Yes |
| Time-based policies | Planned | No | No | Some |
| | | | | |
| **Telemetry** | | | | |
| Real-time location | Yes | Plugin | Plugin | Yes |
| App crash reports | Planned | Plugin | Plugin | Yes |
| Usage analytics | Planned | No | Plugin | Yes |
| Custom telemetry | Yes | Limited | Limited | Varies |
| | | | | |
| **Communication** | | | | |
| FCM push | Yes | No | No | Most |
| MQTT push | Yes | Yes | Yes | Some |
| WebSocket | Yes | No | No | Some |
| Webhooks | Yes | No | Yes | Yes |
| | | | | |
| **Deployment** | | | | |
| Self-hosted | Yes | Yes | Yes | Some |
| Cloud option | Planned | No | No | Yes |
| Private network | Yes | Yes | Yes | Some |

---

## 7. Migration Path from Headwind

### 7.1 Data Migration

```typescript
// Migration script: Headwind -> OpenMDM
import { HeadwindMDMClient } from './headwind-client';
import { mdm } from './openmdm';

async function migrateFromHeadwind() {
  const headwind = new HeadwindMDMClient(HEADWIND_URL, '');
  await headwind.authenticate(HEADWIND_USER, HEADWIND_PASS);

  // Migrate devices
  const devices = await headwind.getDevices();
  for (const device of devices) {
    await mdm.devices.import({
      enrollmentId: device.number,
      model: device.info?.model,
      osVersion: device.info?.androidVersion,
      // ... map other fields
    });
  }

  // Migrate applications
  const apps = await headwind.getApplications();
  for (const app of apps) {
    await mdm.apps.register({
      name: app.name,
      packageName: app.pkg,
      version: app.version,
      url: app.url,
    });
  }

  // Migrate configurations -> policies
  const configs = await headwind.getConfigurations();
  for (const config of configs) {
    await mdm.policies.create({
      name: config.name,
      settings: mapHeadwindConfigToPolicy(config),
    });
  }
}
```

### 7.2 Gradual Transition

```
Phase 1: Shadow Mode
├── Run OpenMDM alongside Headwind
├── Sync data bidirectionally
├── Devices report to both
└── Compare results

Phase 2: Feature Parity
├── Implement missing features
├── Test all enrollment methods
└── Validate policy enforcement

Phase 3: Cutover
├── Point new devices to OpenMDM
├── Migrate existing devices in batches
└── Decommission Headwind
```

---

## 8. Implementation Roadmap

### Phase 1: Core SDK (MVP)

**Goal:** Basic device management embeddable in any TypeScript backend

- [ ] Core library with device/policy/app management
- [ ] Drizzle database adapter
- [ ] Hono HTTP adapter
- [ ] FCM push notifications
- [ ] Basic Android agent (app-only mode)
- [ ] QR enrollment support
- [ ] REST API auto-generation

### Phase 2: Device Owner Mode

**Goal:** Full enterprise device management

- [ ] Device Owner provisioning (QR, NFC)
- [ ] Kiosk mode plugin
- [ ] Hardware controls enforcement
- [ ] Remote commands (reboot, wipe, lock)
- [ ] MQTT push (for private networks)
- [ ] Express, Fastify adapters

### Phase 3: Enterprise Features

**Goal:** Feature parity with commercial MDM

- [ ] AMAPI integration plugin
- [ ] Zero-Touch enrollment
- [ ] Knox KME integration
- [ ] Geofencing plugin
- [ ] Advanced telemetry
- [ ] Role-based access control
- [ ] Audit logging

### Phase 4: Multi-Language

**Goal:** True polyglot support

- [ ] Protocol buffer API definitions
- [ ] Go SDK
- [ ] Rust SDK
- [ ] Java SDK
- [ ] Python SDK

### Phase 5: Ecosystem

**Goal:** Full MDM platform

- [ ] Admin dashboard (optional)
- [ ] Managed cloud offering
- [ ] App store functionality
- [ ] Compliance reporting
- [ ] Multi-tenant support

---

## 9. Technical Decisions

### 9.1 Why AMAPI + Custom Agent (Hybrid)?

| Pure Custom DPC | Pure AMAPI | Hybrid (Recommended) |
|-----------------|------------|----------------------|
| Full control | Easy setup | Best of both |
| Must be allowlisted | Auto-approved | Flexible deployment |
| High maintenance | Feature-limited | Targeted customization |
| All features custom | Google features only | Standard + custom |

**Hybrid Approach:**
- Use AMAPI/ADP for standard enterprise features (policies, app install)
- Lightweight companion app for custom features (telemetry, geofence, UI)
- Fallback to Device Owner mode for dedicated/kiosk devices

### 9.2 Why TypeScript First?

1. **Developer adoption**: Most web developers know TS/JS
2. **better-auth pattern**: Proven embeddable SDK design
3. **Cross-platform**: Runs in Node, Deno, Bun, edge functions
4. **Type safety**: Better DX with IntelliSense
5. **Protobuf generation**: Can generate other language SDKs

### 9.3 Database Agnostic

Unlike Headwind (PostgreSQL only), OpenMDM uses adapter pattern:

```typescript
// Bring your own database
const mdm = createMDM({
  database: drizzleAdapter(db),      // PostgreSQL, MySQL, SQLite
  // or: prismaAdapter(prisma),
  // or: kyselyAdapter(kysely),
  // or: typeormAdapter(dataSource),
});
```

### 9.4 Push Notification Strategy

| Method | Pros | Cons | Use Case |
|--------|------|------|----------|
| FCM | Reliable, battery efficient | Requires Google services | Standard deployment |
| MQTT | Works offline, private networks | Requires server | Air-gapped networks |
| WebSocket | Real-time, bidirectional | Connection overhead | Dashboard sync |
| Polling | Simple, always works | Battery drain, latency | Fallback |

**Default:** FCM with MQTT fallback for private networks

---

## 10. Community & Knowledge Transfer

### 10.1 Leveraging Headwind Community

**Documentation to study:**
- [Headwind API documentation](https://h-mdm.com/headwind-mdm-api/)
- [Q&A common issues](https://qa.h-mdm.com/)
- GitHub issues and PRs

**Key learnings to incorporate:**
1. QR enrollment edge cases (Xiaomi, Huawei issues)
2. Kiosk mode stability (Android 13+ changes)
3. Battery optimization whitelisting patterns
4. MQTT reliability improvements
5. Knox SDK integration patterns

### 10.2 Open Source Strategy

```
License: MIT (core) + Apache 2.0 (enterprise plugins)

Repository Structure:
├── openmdm/                    # Monorepo
│   ├── packages/
│   │   ├── core/               # MIT - Core SDK
│   │   ├── client/             # MIT - Frontend client
│   │   ├── adapters/           # MIT - DB/HTTP adapters
│   │   └── plugins/
│   │       ├── kiosk/          # MIT - Kiosk mode
│   │       ├── geofence/       # MIT - Geofencing
│   │       └── enterprise/     # Apache 2.0 - Enterprise features
│   ├── apps/
│   │   ├── android-agent/      # Apache 2.0 - Android app
│   │   └── admin-dashboard/    # Apache 2.0 - Optional admin UI
│   └── docs/
```

---

## 11. Conclusion

Building a modern MDM solution requires:

1. **Embeddable design** (like better-auth) - not a monolithic server
2. **Framework agnostic** - adapters for any stack
3. **Database agnostic** - use what you already have
4. **Hybrid Android strategy** - AMAPI where possible, custom agent for value-adds
5. **Plugin architecture** - core is minimal, features are composable
6. **Open protocols** - no lock-in, easy migration

The Headwind MDM community has solved many hard problems. By studying their Q&A, issues, and implementation, we can create a better solution that addresses the pain points (integration difficulty, API limitations, framework lock-in) while preserving the strengths (offline operation, kiosk mode, device owner features).

---

## References

### Headwind MDM
- [GitHub - hmdm-server](https://github.com/h-mdm/hmdm-server)
- [Headwind MDM Community](https://h-mdm.com/open-source/)
- [Q&A Platform](https://qa.h-mdm.com/)
- [Samsung Knox Partnership](https://www.samsungknox.com/en/partner-solutions/headwind-mdm)

### Android Enterprise
- [Build a DPC](https://developer.android.com/work/dpc/build-dpc)
- [Android Management API](https://developers.google.com/android/work/tools)
- [DPC Allowlist Changes](https://bayton.org/blog/2025/12/the-dpc-allowlist/)
- [Device Trust](https://bayton.org/blog/2025/10/device-trust-android-enterprise/)

### Better-Auth (Design Inspiration)
- [GitHub - better-auth](https://github.com/better-auth/better-auth)
- [Documentation](https://www.better-auth.com/)

### SDK Design Patterns
- [Auth0 SDK Principles](https://auth0.com/blog/guiding-principles-for-building-sdks/)
- [REST API SDK Patterns](https://vineeth.io/posts/sdk-development)
