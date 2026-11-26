# VibeSync rebuilt source

React Native 0.81.6/React19 synchronized media rooms with Android Kotlin/iOS Swift nearby transport and Express5/MongoDB/Redis/Socket.IO backend. The rebuild preserves the existing architecture and repairs actual joining, session, playback, BLE and local-server defects.

**Validation:** read [TEST_REPORT.md](TEST_REPORT.md), [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md) and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). This is a production-oriented source deliverable. Native/device acceptance must be established before calling the application production-ready.

## Start

```sh
npm run install:all
cp services/api/.env.example services/api/.env
cp apps/mobile/.env.example apps/mobile/.env
docker compose up -d --build
npm run configure:mobile
npm run mobile:start
# Separate terminal, after native toolchain setup:
npm run mobile:android
# macOS only: npm run mobile:ios
```

PowerShell uses Copy-Item. Replace credentials and configure phone networking as explained in [DEPLOYMENT.md](DEPLOYMENT.md). MongoDB must be a replica set. The default Compose stack binds API4000 to loopback; physical-device LAN use requires an explicit development network setup or adb reverse.

## Implementation

- Atomic room creation/join/approval/capacity/membership and authenticated subscription/recovery.
- Strict room-code/invite handling, bounded requests, loading/errors and replay.
- Host-authoritative playback sequences, clocks, scheduled starts and buffer-aware drift correction.
- Scoped chat idempotency, stable pagination/replay and visible delivery/retry states.
- Modular direct MP4/audio/HLS/Android DASH provider validation and compatible licensed DRM boundaries.
- Private uploaded media Range/HEAD access with optional S3-compatible storage.
- Repaired BLE advertisement/GATT lifecycle and native HTTP/session/Range/resource management.
- Native authenticated host re-addressing, local chat retry/moderation and an offline guest entry from Login.
- Actual mobile LiveKit SDK voice with mesh fallback, audio-output controls and server permission enforcement.
- Responsive shared components, rotation-aware onboarding and all-screen source audit.
- Session revocation, production guards, database migration, readiness, TLS/TURN/CI configuration.

The final per-area source evidence in [AUDIT_REPORT.md](AUDIT_REPORT.md) describes voice/nearby changes and verification boundaries. Credentials, node_modules, generated builds, accidental backups and signing keys are excluded from the source archive.

## Checks

```sh
npm run lint
npm test
npm run check:source
npm run benchmark -- --output result.json
```

Original baseline was independently reproduced: backend10/10, mobile sync8/8. Final expanded counts are in TEST_REPORT.md. Protocol/JS tests do not measure device acoustic drift, BLE/hotspot behavior, decoder buffering, audio routing or battery use.

## Delivery and setup guides

- [Audit](AUDIT_REPORT.md), [execution ledger](PROJECT_EXECUTION_LEDGER.md), [changes](CHANGELOG.md), [modified files](MODIFIED_FILES.md)
- [Deployment](DEPLOYMENT.md), [production environment](PRODUCTION_ENV.example)
- [Android build](docs/ANDROID_BUILD.md), [iOS build](docs/IOS_BUILD.md)
- [Security checklist](SECURITY_CHECKLIST.md), [device validation](docs/DEVICE_VALIDATION.md), [UI audit](docs/UI_AUDIT.md)
- [API/events](docs/API.md), [nearby protocol](docs/NEARBY.md), [third-party services](docs/THIRD_PARTY.md)

No DRM/paywall bypass or unauthorized media extraction is implemented. Nearby LAN HTTP requires a trusted local network. No zero-latency or untested participant-count claim is made. No distribution license has been granted; choose an appropriate license before distributing the project.
