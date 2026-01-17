# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of OpenMDM
- Core SDK (`@openmdm/core`) with device, policy, application, command, and group management
- S3 storage adapter (`@openmdm/storage-s3`) for APK uploads with presigned URLs
- FCM push adapter (`@openmdm/push-fcm`) for Firebase Cloud Messaging
- MQTT push adapter (`@openmdm/push-mqtt`) for private network deployments
- Drizzle ORM adapter (`@openmdm/drizzle-adapter`) for database integration
- Hono framework adapter (`@openmdm/hono`) for REST API routes
- Kiosk mode plugin (`@openmdm/plugin-kiosk`)
- Geofencing plugin (`@openmdm/plugin-geofence`)
- Device-side client SDK (`@openmdm/client`)
- CLI tools (`@openmdm/cli`)
- Android Agent app with Kotlin/Jetpack Compose
- Webhook delivery system with HMAC signing and retry logic
- App version tracking and rollback support
- Comprehensive database schema for MDM operations

### Security
- HMAC-SHA256 device authentication
- JWT device tokens with configurable expiration
- Webhook signature verification
- Secure enrollment flow

## [0.1.0] - 2024-XX-XX

### Added
- Initial public release

---

## Release Notes Format

### Types of Changes

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes

[Unreleased]: https://github.com/azoila/openmdm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/azoila/openmdm/releases/tag/v0.1.0
