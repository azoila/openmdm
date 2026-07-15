---
'@openmdm/cli': minor
---

`openmdm enroll qr` now generates a real Android provisioning QR code.

The command used to encode a plain enrollment URL
(`https://…/enroll?token=…`). A factory-reset Android device scanning a
provisioning QR expects the setup wizard's JSON format — the
`android.app.extra.PROVISIONING_*` extras — so scanning the old output did
nothing, with no error anywhere. Users following the README's QR flow hit a
dead end and could not tell whether their agent build or their server was at
fault.

The command now emits the device-owner provisioning payload the OpenMDM
Android agent's `QREnrollmentParser` reads: the DPC package/component extras,
optional `PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION` /
`SIGNATURE_CHECKSUM` for factory-reset installs, and the `openmdm.*`
admin-extras bundle (server URL, device secret, enrollment token, policy,
group).

New options: `--server-url` (required, or `SERVER_URL` env), `--secret` (or
`DEVICE_SECRET` env), `--apk-url`, `--checksum`, `--token`, `--json`. The
command warns when `--apk-url` and `--checksum` aren't passed together, and
explains that without an APK URL the QR only works on devices that already
have the agent installed. `.svg` output is now supported alongside `.png`.
