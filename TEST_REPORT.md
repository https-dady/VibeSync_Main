# VibeSync test report

Executed 18 November 2026 on Windows, Node 24.18.1, npm, JDK 17 and cached Gradle 8.14.3. Tests use the installed lockfiles. Original-source baseline was independently reproduced: backend 10/10 and mobile synchronization 8/8. This report describes executed checks, not promised feature behavior.

## Final executed checks

| Check | Passed | Failed | Status / limit |
| --- | --- | --- | --- |
| Backend Jest API/Socket/Mongo replica-set tests | 40 | 0 | 3 suites; real local HTTP/Socket.IO and MongoDB 8.0.14 |
| Mobile Jest | 102 | 0 | 9 suites; algorithm/component/lifecycle contracts |
| Pure Kotlin protocol JUnit | 4 | 0 | Actual NearbyProtocol.kt compiled on JVM; Range and RFC4231 HMAC vector |
| Automated test total | 146 | 0 | Native app/device claims excluded |
| Backend + mobile ESLint | — | 0 | No lint errors/warnings |
| JavaScript parsing | — | 0 | npm run check:source passed |
| Android release JavaScript bundle | — | 0 | Metro successful; no APK/native compilation claim |
| iOS release JavaScript bundle | — | 0 | Metro successful; no Xcode/native compilation claim |
| Android testDebugUnitTest/assembleDebug/assembleRelease | — | 1 attempt | BLOCKED at configuration: SDK location not found |
| iOS Xcode/CocoaPods build | — | — | UNVERIFIED: Windows host lacks macOS/Xcode |
| Maestro/Detox device E2E | — | — | Flows supplied; not executed without installed native app/device |
| Physical phones/radio/audio | — | — | UNVERIFIED; no connected physical devices |

Backend and mobile final Jest runs report no pending tests. Tests deliberately isolate optional service boundaries; SDK mocks in tests never replace application implementations.

## Suite detail

| Suite | Passing tests | Result |
| --- | --- | --- |
| `services/api/tests/reliability.test.js` | 18 | passed |
| `services/api/tests/integration.test.js` | 10 | passed |
| `services/api/tests/transport.test.js` | 12 | passed |
| `apps/mobile/__tests__/player.test.js` | 5 | passed |
| `apps/mobile/__tests__/accessibility.test.js` | 3 | passed |
| `apps/mobile/__tests__/room-lifecycle.test.js` | 5 | passed |
| `apps/mobile/__tests__/voice.test.js` | 11 | passed |
| `apps/mobile/__tests__/nearby.test.js` | 24 | passed |
| `apps/mobile/__tests__/core-regression.test.js` | 25 | passed |
| `apps/mobile/__tests__/session.test.js` | 8 | passed |
| `apps/mobile/__tests__/layout-config.test.js` | 13 | passed |
| `apps/mobile/__tests__/sync.test.js` | 8 | passed |

Individual case names and statuses are in docs/verification/test-results.json. Regression coverage includes concurrent joins/approvals/capacity, refresh reuse/revocation and password migration, scoped access, playback races/sequences/scheduled clocks, REST/socket message deduplication and pagination, local Range bounds, presence expiry and signed SFU webhook integrity. Mobile coverage includes real React provider/player callback lifecycles with controlled external boundaries, session races/origins, invite parsing, reconnect state merge, clock/drift policies, nearby request/auth recovery, voice SDK/mesh cleanup and reduced-motion behavior.

## Native build evidence

The actual command `gradlew.bat testDebugUnitTest assembleDebug assembleRelease --no-daemon --offline` exited 1. Gradle's React Native plugin tasks resolved from cache, then `com.facebook.react.rootproject` failed configuring `:app`: **SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or sdk.dir in local.properties.** Neither the Kotlin Android module nor debug/release app reached native compilation. The standalone Kotlin compiler/JUnit run proves only the pure protocol helper, not Android/CoreBluetooth/Swift correctness. No APK, AAB or IPA was produced.

## Dependency and infrastructure checks

`npm audit --omit=dev --json`: backend 0 advisories; mobile 19 high, 0 critical. Mobile results propagate the picomatch ReDoS advisory GHSA-fc5q-39xc-vjpf through React Native/Metro/Jest tooling; latest npm-published picomatch was 4.0.7 and remains in the affected range. These are dependency reports, not 19 independently reproduced application exploits. No speculative major React Native replacement was made. Keep build tools private and obtain a verified remediation before release; reports are in docs/security/.

Docker, authenticated production Mongo/Redis, cloud S3, multi-instance Redis failover, actual TURN and LiveKit connectivity/revocation were not deployed/executed. The SFU webhook test validates real SDK signature/hash logic; it does not prove remote media or server cutoff enforcement. S3/local store interfaces are implemented; remote bucket behavior is unverified. CI jobs and configuration templates require a real run.

The committed CI mobile dependency gate is expected to fail while the high-severity tooling advisory remains unresolved. Gradle plugin deprecation warnings also appeared during the blocked native attempt; they require evaluation with the complete native toolchain.

## Feature acceptance matrix

| Requirement | Executed evidence | Remaining acceptance test |
| --- | --- | --- |
| Register/login/refresh/revoke | API + session races passed | Native secure-storage and real TLS session lifecycle |
| Create/code/private/approval joins | API concurrent independent clients + provider lifecycle passed | Phone QR/app links/internet errors and keyboard states |
| Socket/chat/reconnect/moderation | Real server sockets and mobile replay/idempotency passed | Radio interruption/end-to-end UI delivery |
| Clock/seek/rate/late join/media switch | API sequence + pure clock + player callbacks passed | Real native decoder, media startup, buffering and acoustic drift |
| External MP4/audio/HLS/DASH | Validation/capability tests passed | Authorized real media on Android/iOS; DASH Android only |
| BLE/discovery/permissions | Source fixes + request contracts | All physical scan/advertise/GATT/permission paths |
| LAN/hotspot/local Range | Pure Kotlin parser + JS admission/deadline/recovery passed | Native HTTP and Android↔iOS router/hotspot transfers |
| Voice/mesh/SFU/TURN/routes | SDK/mesh lifecycles + grants/webhook checks passed | Actual microphones, speakers, ICE/relay/SFU moderation |
| All-screen responsiveness | Shared component decisions, source audit, lint/bundles | 21-screen native screenshots/font/keyboard/notch/accessibility matrix |
| Security/deployment | Source guards, tests, private service templates | TLS/backup/restore/migration/remote-service/release-signing drills |

## Reproduce

Install lockfiles with `npm run install:all`, run `npm run lint`, `npm test` and `npm run check:source`. Backend tests download an isolated MongoDB binary on first run; they do not use production data. Native build commands are in docs/ANDROID_BUILD.md and docs/IOS_BUILD.md. Device/network conditions and measurements are in docs/DEVICE_VALIDATION.md. Every unexecuted acceptance condition above remains UNVERIFIED; this build is not declared production-ready.

Both backend and mobile locked install plans passed `npm ci --dry-run --offline --ignore-scripts` (mobile includes `--legacy-peer-deps`). This verifies package/lock consistency, not a native build or production install with external services.

## Delivery verification

The sanitized ZIP passed CRC, exact entry-set checks and SHA256 validation for all 268 source files after actual extraction into a new directory. The extracted project passed both locked npm install plans and mobile release configuration generation. Private environment/signing files, node_modules and generated builds/classes were excluded. The ZIP checksum sidecar and internal SOURCE_MANIFEST.sha256.json accompany the delivery. These checks verify source delivery integrity, not the open native/device/production acceptance conditions.
