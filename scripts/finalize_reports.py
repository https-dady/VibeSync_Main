"""Record actual completed checks; explicitly keep native/device release gates open."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write(name, text):
    target = ROOT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text.strip() + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    args = parser.parse_args()
    workspace = Path(args.workspace)
    evidence = []
    suite_rows = []
    for label, file in [("Backend", "api-tests.json"), ("Mobile", "mobile-tests.json")]:
        result = json.loads((ROOT / ".verification" / file).read_text(encoding="utf-8-sig"))
        if not result["success"]:
            raise RuntimeError(f"{label} checks did not pass")
        item = {"area": label, "passed": result["numPassedTests"], "failed": result["numFailedTests"],
                "pending": result["numPendingTests"], "suites": result["numPassedTestSuites"], "tests": []}
        for suite in result["testResults"]:
            name = Path(suite["name"]).relative_to(ROOT).as_posix()
            assertions = suite["assertionResults"]
            count = sum(test["status"] == "passed" for test in assertions)
            suite_rows.append(f"| `{name}` | {count} | {suite['status']} |")
            item["tests"].extend({"file": name, "name": test["fullName"], "status": test["status"]} for test in assertions)
        evidence.append(item)
    kotlin_log = (ROOT / ".qa" / "native-protocol-test.log").read_text(encoding="utf-8-sig")
    if "OK (4 tests)" not in kotlin_log:
        raise RuntimeError("Missing successful Kotlin protocol result")
    build_log = (workspace / "android-final-build.log").read_text(encoding="utf-8-sig")
    if "SDK location not found" not in build_log:
        raise RuntimeError("Review changed Android build result before generating report")
    for platform in ["android", "ios"]:
        log = (ROOT / ".verification" / f"{platform}-bundle.log").read_text(encoding="utf-8-sig")
        if "Done writing bundle output" not in log:
            raise RuntimeError(f"{platform} JS bundle success is not established")
    for area in ["backend", "mobile"]:
        audit = json.loads((workspace / f"{area}-audit.json").read_text(encoding="utf-8-sig"))
        if "metadata" not in audit:
            raise RuntimeError(f"{area} dependency audit unavailable")
        write(f"docs/security/{area}-audit.json", json.dumps(audit, indent=2))
    write("docs/verification/test-results.json", json.dumps(evidence, indent=2))
    backend, mobile = evidence
    total = backend["passed"] + mobile["passed"] + 4
    report = f"""# VibeSync test report

Executed 18 November 2026 on Windows, Node 24.18.1, npm, JDK 17 and cached Gradle 8.14.3. Tests use the installed lockfiles. Original-source baseline was independently reproduced: backend 10/10 and mobile synchronization 8/8. This report describes executed checks, not promised feature behavior.

## Final executed checks

| Check | Passed | Failed | Status / limit |
| --- | --- | --- | --- |
| Backend Jest API/Socket/Mongo replica-set tests | {backend['passed']} | {backend['failed']} | {backend['suites']} suites; real local HTTP/Socket.IO and MongoDB 8.0.14 |
| Mobile Jest | {mobile['passed']} | {mobile['failed']} | {mobile['suites']} suites; algorithm/component/lifecycle contracts |
| Pure Kotlin protocol JUnit | 4 | 0 | Actual NearbyProtocol.kt compiled on JVM; Range and RFC4231 HMAC vector |
| Automated test total | {total} | 0 | Native app/device claims excluded |
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
""" + "\n".join(suite_rows) + """

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
"""
    write("TEST_REPORT.md", report)
    write("KNOWN_LIMITATIONS.md", """
# VibeSync remaining limitations and release gates

This is the implemented rebuilt source, with tested protocol/application logic. Production acceptance is incomplete. See TEST_REPORT.md for executed counts and PERFORMANCE_REPORT.md for actual loopback measurements.

## Unverified critical acceptance conditions

- Full Android debug/release/Kotlin Android builds are blocked by the missing Android SDK. Pure Kotlin protocol tests passed, but are not Android compilation. iOS/Swift/CocoaPods need macOS/Xcode and remain UNVERIFIED.
- No physical-device BLE, GATT, runtime permissions, router/hotspot transfers, cross-platform discovery, media decoding, microphone/audio routing, TURN/SFU connectivity or 2/5/10/20-phone capacity was tested. Startup/buffering/acoustic drift/battery goals are unmeasured.
- Nearby uses plaintext HTTP. Random session tokens, private-address admission and HMAC re-address proofs enforce access but do not stop passive LAN token capture or a malicious peer. TLS with pinned pairing/identity negotiation remains a hostile-LAN security gap. Use trusted WPA2/WPA3 networks while validating this feature.
- LiveKit mobile SDK and server grant/webhook/reconciliation code are implemented. Real server `revokeTokenTs` enforcement is UNVERIFIED. Old bearer tokens may rejoin until their 60-second expiry if the server ignores revocation; active connections do not expire with JWTs. Five-second reconciliation cannot guarantee immediate cutoff during outages. Validate captured old tokens and actual audio before enabling SFU publicly.
- Npm reports 19 high mobile toolchain dependencies from picomatch ReDoS (latest 4.0.7 remains affected). Backend production audit is clean. An upstream/verified fix is required before a clean release claim.

## Platform and product constraints

- BLE carries discovery/pairing metadata, and LAN carries media. Wi-Fi Direct, Apple MultipeerConnectivity and LE Audio/Auracast are not implemented. No unrestricted multi-phone Bluetooth audio capability is claimed. Hotspots are enabled manually in OS settings; iOS cannot programmatically create one.
- Nearby hosting is foreground and ephemeral. App termination/suspension/network loss may end playback. HMAC-authenticated rediscovery can recover a changed host address when BLE is available; manual host address is the fallback. Client isolation/VPNs may block the LAN.
- Local chat is a bounded 200-message in-memory log with retry IDs, statuses and host delete/kick moderation. It has no durable history, pagination, private DM or voice. Host migration would require transferring media ownership/content and is not implemented. Scheduled starts do not provide a participant buffer-readiness quorum.
- NearbyGuest is accessible from Login without a cloud sign-in and creates no fake account/cloud JWT. Online features still require authentication. Cloud sessions saved before origin/session-family protections require a fresh sign-in after upgrade.
- Mesh voice is bounded to six room members by policy, not a verified hardware capacity. Larger-room voice uses configured LiveKit. Media/chat remain available when mesh voice is unavailable.
- Direct MP4/audio/HLS and Android DASH are supported source types; actual codec/DRM/provider compatibility still needs native playback tests. iOS AVPlayer does not support DASH. Widevine is Android-only; FairPlay is iOS-only and needs an authorized certificate/content ID/license. PlayReady/ClearKey are unsupported by this player. Arbitrary YouTube/Netflix/Spotify website pages are rejected; no protected extraction or DRM bypass exists.
- Provider metadata is user-supplied. There is no scraping, server-side URL fetch, transcoding or official licensed streaming account integration. Signed public media URLs are supported without proxying provider credentials. For strict deployments use MEDIA_ALLOWED_HOSTS: URL validation alone cannot prove DNS/redirect destinations of native external streams.
- Background media playback, lock-screen controls, a web player, platform admin/reporting, account recovery/email verification/MFA/OAuth and APNs/FCM push remain outside the implemented feature set. English is the current UI language.
- QR generation and invite parsing use shared codes/links. Scanning uses the OS camera/QR reader; no in-app camera scanner was added. Android/iOS app-link declarations/association templates require your domains, team ID and signing fingerprints deployed on HTTPS.

## Deployment work requiring a real environment

- Docker production overlay, authenticated replica-set initialization/migration, backup/restore, private remote S3 Range/deletion, Redis multi-instance recovery, TURN relay and SFU config are supplied but UNVERIFIED in a deployed environment.
- One-node Mongo replica sets satisfy transactions, not high availability. Multiple APIs require shared Redis and shared local storage or private S3; local disk alone is not suitable across isolated replicas. No paid service is mandatory; hosting, storage/egress and developer accounts have operator/provider-dependent costs.
- REST/auth and socket-connection limit windows are per API instance; chat can use Redis. Use aggregate ingress/edge limits across replicas. S3 and Mongo cannot share a transaction: process crashes can orphan uploaded objects, so bucket lifecycle/audited orphan cleanup and backup policy are operator responsibilities.
- Legacy bcrypt accounts already truncated beyond 72 UTF8 bytes need password reset to eliminate existing ambiguity, even though new password hashing avoids truncation and successful legacy login upgrades the hash.
- CI configuration is committed but has not run remotely. Release signing keys/credentials, production DNS/TLS, licensed media and service accounts are intentionally operator supplied. Native visual/accessibility results must be verified on all 21 screens before commercial release.
""")
    write("CHANGELOG.md", """
# VibeSync rebuild changelog — 18 November 2026

## Implemented repairs

- Serialized room creation/join/approval/leave/capacity, playback commands and refresh rotation using Mongo transactions; publish after commit and preserve consistent identities/counts.
- Normalized online codes without silent truncation, private-room access, bounded room entry, approval cancellation/polling, initial state and reconnect subscription/replay.
- Protected Keychain/Keystore operations against stale async writes/logout/refresh and bound sessions to API origin. Revoke access-session families and active sockets; SHA256-prehashed bcrypt avoids long-password truncation with legacy-login upgrade.
- Kept existing server clock/playback design and 120/850ms correction thresholds; added expiring RTT samples, scheduled starts, sequence rejection, buffer/load gating, controlled seek cooldown, rate persistence and recoverable loading/error states.
- Added direct-provider capabilities/URL/platform/DRM validation; reject protected website pages. Private uploaded Range/HEAD streaming validates file size/signature and supports optional private S3 storage.
- Implemented actual LiveKit mobile SDK transport, retained bounded mesh on the same native WebRTC fork, cleaned mic/ICE/peer races, added output selection/system picker and backend grant/revoke/signed-webhook reconciliation.
- Made chat writes idempotent across socket/REST retries, ordered composite pagination, optimistic sent/failed/retry states, authoritative moderation and reconnect history.
- Repaired BLE advertisement packet size and scan/GATT epochs/refresh, Swift HTTP connection ownership, strict native Range/body bounds, guest expiry, host IP refresh and HMAC-authenticated address recovery.
- Added local scheduled playback, clock/rate/seek/load recovery, local chat IDs/delivery states and host kick/delete controls. Added local-only NearbyGuest entry on Login.
- Updated all-screen shared responsive components, keyboard sheets, narrow action/metric rows, rotation-aware onboarding, loading submission guards, request cancellation and reduced-motion preferences. Preserved black/orange/yellow/off-white styling.
- Added production Mongo/Redis overlay, health/readiness/shutdown, migrations, TLS/TURN/SFU/storage templates, CI/native smoke flows, measured loopback benchmarks and sanitized archive/manifest tooling.

## Compatibility and deployment changes

- MongoDB replica set is required for transactions; standalone Mongo is unsupported. Backup and run the documented migration before upgrading. Obsolete room TTL indexes are removed and counters/indexes reconciled with ingress closed.
- Legacy cloud tokens require fresh sign-in. NearbyGuest needs no cloud account. Nearby admission now requires the existing four-character code; updated hosts/clients should ship together.
- Mobile installs the LiveKit WebRTC fork once for both mesh and SFU. Reinstall lockfiles and CocoaPods/native dependencies; an old binary cannot load new native module methods.
- DASH is Android-only, Widevine Android-only, FairPlay iOS-only; certificate/content ID fields are required for authorized FairPlay. Unsupported DRM/source paths show actionable errors.
- Default API Docker binding is loopback. Production needs HTTPS ingress and explicit origins/random secrets. Multiple APIs require Redis plus shared private media storage. No production credentials or signing keys are shipped.

## Evidence

See TEST_REPORT.md, PERFORMANCE_REPORT.md, AUDIT_REPORT.md and MODIFIED_FILES.md. Source fixes do not prove native/device behavior. The project is delivered with explicit open release gates and is not declared production-ready.
""")
    write("docs/LIMITATIONS.md", "# Known limitations\n\nThe current authoritative [limitations report](../KNOWN_LIMITATIONS.md) and [test evidence](../TEST_REPORT.md) replace the original baseline-only limitations.\n")


if __name__ == "__main__":
    main()
