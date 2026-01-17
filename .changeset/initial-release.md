---
"@openmdm/core": minor
"@openmdm/client": minor
"@openmdm/cli": minor
"@openmdm/hono": minor
"@openmdm/drizzle-adapter": minor
"@openmdm/storage-s3": minor
"@openmdm/push-fcm": minor
"@openmdm/push-mqtt": minor
"@openmdm/plugin-kiosk": minor
"@openmdm/plugin-geofence": minor
---

Initial release of OpenMDM - a modern, embeddable Mobile Device Management SDK for TypeScript.

**Core Features:**
- Device enrollment and management
- Policy configuration and deployment
- Command execution (sync, lock, wipe, reboot)
- Application management
- Event system with webhooks

**Adapters:**
- Hono framework adapter for HTTP endpoints
- Drizzle ORM adapter for database operations
- S3 storage adapter for APK uploads

**Push Notifications:**
- Firebase Cloud Messaging (FCM) adapter
- MQTT adapter for private networks

**Plugins:**
- Kiosk mode plugin
- Geofencing plugin

**Tools:**
- CLI for device and policy management
- Client SDK for device-side integration