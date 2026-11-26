"""Keep setup entry points consistent with the authoritative rebuild guides."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FILES = {
    "README.md": """# VibeSync rebuilt source

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
""",
    "docs/INSTALL.md": """# Installation

Use the current [deployment/setup guide](../DEPLOYMENT.md), [Android guide](ANDROID_BUILD.md) and [iOS guide](IOS_BUILD.md). Run locked npm ci installs, configure environment templates and initialize Mongo rs0. Standalone Mongo is unsupported in this rebuild.

Default Compose API port4000 is loopback-only. adb reverse supports a USB Android development phone; a physical iPhone/LAN phone needs an explicit private LAN API address. BLE/local media still requires phones on a shared router or existing hotspot. See [device validation](DEVICE_VALIDATION.md) and [limitations](../KNOWN_LIMITATIONS.md).
""",
    "docs/DEPLOYMENT.md": """# Deployment

The authoritative current guide is [DEPLOYMENT.md](../DEPLOYMENT.md) at repository root. It includes development/staging/production, Mongo replica sets and migration, authenticated Redis, TLS, media storage, TURN, optional SFU, backups, scaling and CI. See [production template](../PRODUCTION_ENV.example) and [security checklist](../SECURITY_CHECKLIST.md).
""",
    "apps/mobile/README.md": """# VibeSync mobile

React Native0.81.6/React19, JavaScript, Android Kotlin and iOS Swift. See repository [README](../../README.md), [Android build](../../docs/ANDROID_BUILD.md), [iOS build](../../docs/IOS_BUILD.md) and [TEST_REPORT](../../TEST_REPORT.md).

```sh
npm ci --legacy-peer-deps
npm run configure
npm start
npm test -- --runInBand
npm run lint
```

Copy .env.example to .env and configure HTTPS release origins. Run npm run configure:release before release compilation. All21 screens use the shared VibeSync visual system; native screenshots/audio/radio verification remains separate. Device sign-in/account credentials and release signing keys are not included.
""",
    "services/api/README.md": """# VibeSync API

Express5/Mongoose8/Mongo replica set/Socket.IO with optional Redis and private S3-compatible media. See root [deployment guide](../../DEPLOYMENT.md) and [test report](../../TEST_REPORT.md).

```sh
cp .env.example .env
npm ci
npm run dev
npm test
npm run lint
npm run benchmark -- --output result.json
```

Mongo standalone is unsupported. Set a replica-set URI and random JWT secrets. Run npm run migrate with ingress closed after a backup. /api/health/live is liveness; /api/health/ready checks readiness. Tests start real HTTP/Socket.IO and ephemeral Mongo replica sets. Online source behavior is tested independently from native phone playback.
""",
}

def main():
    for name, source in FILES.items():
        (ROOT / name).write_text(source, encoding="utf-8")

if __name__ == "__main__":
    main()
