<div align="center">

# OpenMDM

**A modern, embeddable Mobile Device Management SDK for TypeScript**

[![npm version](https://img.shields.io/npm/v/@openmdm/core.svg)](https://www.npmjs.com/package/@openmdm/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Documentation](https://openmdm.dev/docs) | [Quick Start](#quick-start) | [Examples](./examples) | [Discord](https://discord.gg/openmdm)

---

**OpenMDM is the "better-auth of MDM"** - a flexible, framework-agnostic SDK that lets you add device management to any application without deploying a separate MDM server.

</div>

> [!CAUTION]
> **This project is under active development and is NOT ready for production use.**
> APIs may change without notice. Use at your own risk. We welcome contributions and feedback!

## Why OpenMDM?

### The Problem with Existing Solutions

**Headwind MDM** and similar open-source MDM solutions are powerful but:
- Require separate deployment (Java/Tomcat server)
- Have their own database (can't use yours)
- Limited integration options (no SDKs)
- Session-based auth with legacy patterns
- Hard to embed in existing applications

**Commercial MDMs** (Intune, VMware, etc.) are:
- Expensive at scale
- Cloud-dependent
- Vendor lock-in
- Overkill for many use cases

### The OpenMDM Solution

```typescript
// Install OpenMDM into YOUR application
import { createMDM } from '@openmdm/core';
import { drizzleAdapter } from '@openmdm/drizzle-adapter';
import { fcmPushAdapter } from '@openmdm/push-fcm';

const mdm = createMDM({
  database: drizzleAdapter(db), // Your existing database
  push: fcmPushAdapter({
    credentialPath: './firebase-service-account.json',
  }),
  enrollment: {
    deviceSecret: process.env.DEVICE_HMAC_SECRET,
    autoEnroll: true,
  },
});

// Now you have full MDM capabilities
const devices = await mdm.devices.list();
await mdm.devices.sendCommand(deviceId, { type: 'reboot' });
```

## Features

- **Embeddable** - Works within your existing application, not as a separate service
- **Framework Agnostic** - Use with Express, Hono, Fastify, Next.js, or any HTTP framework
- **Database Agnostic** - Bring your own database with Drizzle, Prisma, or raw SQL
- **Push Notifications** - FCM, MQTT, and WebSocket support
- **S3 Storage** - Presigned URLs for APK uploads (AWS S3, MinIO, DigitalOcean Spaces)
- **Webhooks** - HMAC-signed outbound webhooks with retry logic
- **Plugin System** - Extend with kiosk, geofence, and custom plugins
- **TypeScript First** - Full type safety with IntelliSense support

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@openmdm/core`](./packages/core) | Core MDM SDK - devices, policies, commands, events | Stable |
| [`@openmdm/storage-s3`](./packages/storage/s3) | S3 storage adapter for APK uploads | Stable |
| [`@openmdm/drizzle-adapter`](./packages/adapters/drizzle) | Database adapter for Drizzle ORM | Stable |
| [`@openmdm/hono`](./packages/adapters/hono) | Hono framework adapter with REST API routes | Stable |
| [`@openmdm/push-fcm`](./packages/push/fcm) | Firebase Cloud Messaging push adapter | Stable |
| [`@openmdm/push-mqtt`](./packages/push/mqtt) | MQTT push adapter for private networks | Stable |
| [`@openmdm/client`](./packages/client) | Device-side SDK for Android agents | Stable |
| [`@openmdm/plugin-kiosk`](./packages/plugins/kiosk) | Kiosk/lockdown mode plugin | Stable |
| [`@openmdm/plugin-geofence`](./packages/plugins/geofence) | Geofencing and location-based policies | Stable |
| [`@openmdm/cli`](./packages/cli) | Command-line tools for administration | Stable |

## Quick Start

### 1. Install

```bash
npm install @openmdm/core @openmdm/drizzle-adapter @openmdm/push-fcm
# or
pnpm add @openmdm/core @openmdm/drizzle-adapter @openmdm/push-fcm
```

### 2. Configure

```typescript
import { createMDM } from '@openmdm/core';
import { drizzleAdapter } from '@openmdm/drizzle-adapter';
import { fcmPushAdapter } from '@openmdm/push-fcm';
import { kioskPlugin } from '@openmdm/plugin-kiosk';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Database connection
const db = drizzle(postgres(process.env.DATABASE_URL!));

// Create MDM instance
export const mdm = createMDM({
  database: drizzleAdapter(db),
  push: fcmPushAdapter({
    credentialPath: './firebase-service-account.json',
  }),
  enrollment: {
    deviceSecret: process.env.DEVICE_SECRET!,
    autoEnroll: true,
  },
  auth: {
    deviceTokenSecret: process.env.JWT_SECRET!,
  },
  webhooks: {
    endpoints: [{
      id: 'main',
      url: 'https://your-app.com/webhooks/mdm',
      events: ['*'],
      enabled: true,
    }],
    signingSecret: process.env.WEBHOOK_SECRET,
  },
  serverUrl: 'https://mdm.example.com',
  plugins: [
    kioskPlugin({ defaultExitPassword: 'admin123' }),
  ],
});
```

### 3. Use the API

```typescript
// List enrolled devices
const { devices, total } = await mdm.devices.list({ status: 'enrolled' });

// Get device details
const device = await mdm.devices.get('device-123');

// Send command
await mdm.commands.send({
  deviceId: 'device-123',
  type: 'sync',
});

// Create policy
const policy = await mdm.policies.create({
  name: 'Kiosk Mode',
  settings: {
    kioskMode: true,
    mainApp: 'com.example.app',
    lockStatusBar: true,
    lockNavigationBar: true,
  },
});

// Apply policy to device
await mdm.devices.assignPolicy('device-123', policy.id);

// Subscribe to events
mdm.on('device.enrolled', async (event) => {
  console.log('New device:', event.payload.device);
});
```

### 4. Framework Integration

<details>
<summary><b>Hono</b></summary>

```typescript
import { Hono } from 'hono';
import { honoAdapter } from '@openmdm/hono';

const app = new Hono();
app.route('/mdm', honoAdapter(mdm));
```

</details>

<details>
<summary><b>Express</b></summary>

```typescript
import express from 'express';
import { expressAdapter } from '@openmdm/express';

const app = express();
app.use('/mdm', expressAdapter(mdm));
```

</details>

<details>
<summary><b>Fastify</b></summary>

```typescript
import Fastify from 'fastify';
import { fastifyPlugin } from '@openmdm/fastify';

const app = Fastify();
app.register(fastifyPlugin(mdm), { prefix: '/mdm' });
```

</details>

<details>
<summary><b>Next.js (App Router)</b></summary>

```typescript
// app/api/mdm/[...path]/route.ts
import { nextjsHandler } from '@openmdm/nextjs';
import { mdm } from '@/lib/mdm';

export const { GET, POST, PUT, DELETE } = nextjsHandler(mdm);
```

</details>

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      YOUR APPLICATION                        │
│                                                              │
│    ┌────────────────────────────────────────────────────┐   │
│    │                    OpenMDM SDK                      │   │
│    │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────┐ │   │
│    │  │ Devices │  │ Policies│  │Commands │  │ Push  │ │   │
│    │  └─────────┘  └─────────┘  └─────────┘  └───────┘ │   │
│    │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────┐ │   │
│    │  │  Apps   │  │ Groups  │  │ Events  │  │Webhooks│ │   │
│    │  └─────────┘  └─────────┘  └─────────┘  └───────┘ │   │
│    └────────────────────────────────────────────────────┘   │
│                              │                               │
│              ┌───────────────┼───────────────┐              │
│              │               │               │              │
│      ┌───────▼───────┐ ┌────▼────┐ ┌───────▼───────┐       │
│      │ Your Database │ │  FCM/   │ │ Android Agent │       │
│      │   (Drizzle)   │ │  MQTT   │ │    (Kotlin)   │       │
│      └───────────────┘ └─────────┘ └───────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Android Agent

The Android Agent is maintained in a separate repository for easier customization and forking:

**Repository**: [openmdm/openmdm-android](https://github.com/openmdm/openmdm-android)

### Features

- Device enrollment with QR code or token
- FCM push notification support
- Automatic heartbeat/check-in scheduling
- Command processing (sync, lock, wipe, app install, etc.)
- Device Owner / Device Admin capabilities
- Silent app installation and permission granting
- Kiosk mode support
- Location reporting

### Getting Started

```bash
# Clone the Android agent
git clone https://github.com/openmdm/openmdm-android

# Build the full agent app
cd openmdm-android
./gradlew :agent:assembleRelease

# Or use the library in your own app
implementation("com.github.openmdm:openmdm-android:library:0.1.0")
```

See the [openmdm-android README](https://github.com/openmdm/openmdm-android) for full documentation.

## Push Notification Providers

### FCM (Firebase Cloud Messaging)

Recommended for devices with Google Play Services.

```typescript
import { fcmPushAdapter } from '@openmdm/push-fcm';

const push = fcmPushAdapter({
  credentialPath: './firebase-service-account.json',
  dataOnly: true,
});
```

### MQTT

For private networks, air-gapped environments, or devices without Google Play Services.

```typescript
import { mqttPushAdapter } from '@openmdm/push-mqtt';

const push = mqttPushAdapter({
  brokerUrl: 'mqtt://mqtt.example.com:1883',
  username: 'mdm-server',
  password: 'secret',
  qos: 1,
});
```

## Plugins

### Kiosk Mode

Lock devices to a single app or set of apps.

```typescript
import { kioskPlugin } from '@openmdm/plugin-kiosk';

const mdm = createMDM({
  plugins: [
    kioskPlugin({
      defaultExitPassword: 'admin123',
      allowRemoteExit: true,
      autoRestart: true,
    }),
  ],
});
```

### Geofencing

Location-based policies and alerts.

```typescript
import { geofencePlugin } from '@openmdm/plugin-geofence';

const mdm = createMDM({
  plugins: [
    geofencePlugin({
      onEnter: async (device, zone) => {
        await mdm.devices.assignPolicy(device.id, 'office-policy');
      },
      onExit: async (device, zone) => {
        await mdm.devices.assignPolicy(device.id, 'default-policy');
      },
    }),
  ],
});
```

## CLI Tools

```bash
# Initialize project
npx openmdm init

# Run database migrations
npx openmdm migrate

# List devices
npx openmdm device list
npx openmdm device show <deviceId>

# Manage policies
npx openmdm policy list
npx openmdm policy create
npx openmdm policy apply <policyId> <deviceId>

# Generate enrollment
npx openmdm enroll qr --output enrollment.png
npx openmdm enroll token

# View statistics
npx openmdm stats
```

## Project Structure

```
openmdm/                          # This repository (SDK monorepo)
├── packages/
│   ├── core/                     # Core MDM SDK
│   ├── storage/s3/               # S3 storage adapter
│   ├── adapters/
│   │   ├── drizzle/              # Drizzle ORM adapter
│   │   └── hono/                 # Hono framework adapter
│   ├── push/
│   │   ├── fcm/                  # FCM push adapter
│   │   └── mqtt/                 # MQTT push adapter
│   ├── plugins/
│   │   ├── kiosk/                # Kiosk mode plugin
│   │   └── geofence/             # Geofencing plugin
│   ├── client/                   # Device-side SDK (TypeScript types)
│   └── cli/                      # CLI tools
├── examples/                     # Example applications
└── docs/                         # Documentation website

openmdm-android/                  # Separate repository
├── agent/                        # Full-featured MDM agent app
├── library/                      # Core MDM library (embeddable)
└── docs/                         # Android-specific docs
```

## Comparison

| Feature | OpenMDM | Headwind MDM | Commercial |
|---------|---------|--------------|------------|
| Embeddable | Yes | No | No |
| Use your DB | Yes | No | No |
| Self-hosted | Yes | Yes | Some |
| Framework agnostic | Yes | No | No |
| Plugin system | Yes | Limited | Limited |
| Webhooks | Yes | Enterprise | Yes |
| S3 Storage | Yes | No | Yes |
| Kiosk mode | Yes | Yes | Yes |
| Device Owner | Yes | Yes | Yes |
| TypeScript | Native | No | No |
| Price | Free | Free/Paid | $$$ |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Watch mode
pnpm dev
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

## Community

- [Discord](https://discord.gg/openmdm) - Chat with the community
- [GitHub Discussions](https://github.com/openmdm/openmdm/discussions) - Ask questions, share ideas
- [Twitter](https://twitter.com/openmdm) - Updates and announcements

## Documentation

- [API Reference](https://openmdm.dev/docs/api)
- [Architecture & Design](./docs/MDM-ANALYSIS-AND-ARCHITECTURE.md)
- [Migration from Headwind](./docs/migration-headwind.md)
- [Android Agent Setup](https://github.com/openmdm/openmdm-android)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Headwind MDM](https://h-mdm.com/) - For years of MDM knowledge
- [better-auth](https://better-auth.com/) - For the embeddable SDK design pattern
- [Android Enterprise](https://developers.google.com/android/work) - For the platform APIs

---

<div align="center">

**Built with TypeScript. Inspired by [better-auth](https://github.com/better-auth/better-auth).**

[Documentation](https://openmdm.dev) | [GitHub](https://github.com/openmdm/openmdm) | [Discord](https://discord.gg/openmdm)

</div>
