"""Consolidate source findings; never infer device success from unit tests."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = """# VibeSync source audit

Audited source: supplied SpareVibeSync-main.zip, 18 November 2026. The archive was extracted without overwriting the original and separately extracted for baseline reproduction. The original backend 10/10 and mobile 8/8 baseline tests passed. The source includes React Native 0.81.6/React19, Kotlin/Swift nearby modules, Express5/Mongo/Redis/Socket.IO, native media and mesh voice.

Severity: P0 critical production blocker; P1 major functional/security failure; P2 performance/UX defect; P3 enhancement. Findings record file/feature, existing behavior, expected behavior, root cause, correction and validation. Status is evidence-based: a corrected source path is not equivalent to a verified phone feature. See TEST_REPORT.md and KNOWN_LIMITATIONS.md.

## Architecture and feature trace

Online: screen → RoomContext/API session → REST membership transaction → durable Mongo membership → authenticated Socket.IO subscription → playback sequence/clock state → native player. Chat uses durable message IDs and scoped replay. Voice uses authenticated room membership, native WebRTC/SFU SDK and TURN. Nearby: screen → native BLE/GATT discovery → private LAN address → code admission/random local token → HTTP session/Range server → scheduled clock-aware playback. BLE carries metadata, LAN carries media.

All 21 screens and shared components were inspected; docs/UI_AUDIT.md contains the screen matrix. Both native bridges, app manifests/plists/build configurations, root/package locks, services/routes/models/middleware/realtime/configuration, deployment and tests were inventoried. Binary resources and signing material are inspected as file metadata; no secret contents are reproduced. SOURCE_MANIFEST.sha256.json in the deliverable records every packaged source byte.

## Additional shared UI, configuration and infrastructure findings

| ID | Severity | File / feature | Existing behavior and root cause | Expected correction | Validation |
| --- | --- | --- | --- | --- | --- |
| R01 | P1 | apps/mobile/src/config/index.js; LoginScreen/SettingsScreen | Runtime override accepts credential/path/HTTP release URL; changing server immediately reuses existing session on a new origin. | Validate origin/HTTPS/port and clear old credentials before origin change; bind stored session to origin. | Mobile config and session regression tests; release device validation pending. |
| R02 | P2 | apps/mobile/src/screens/OnboardingScreen.js | Module-level Dimensions width remains fixed after rotation; fixed page cannot scroll at large fonts/short height. | useWindowDimensions and vertically scrollable pages. | JS parsing/layout decision tests; native screenshots UNVERIFIED. |
| R03 | P2 | apps/mobile/src/components/Screen/Header/Button/Input/Sheet.js | Fixed header columns/heights, rigid labels and unscrollable modal content clip or hide inputs. | Flexible minima, wrapping labels, tablet width bound and scrollable keyboard-aware sheets. | Lint/parsing; full native layout matrix UNVERIFIED. |
| R04 | P2 | Home/Profile/HostControls/Participants/JoinRequests/MicRequests/Notifications screens | Rigid action groups/metric and metadata rows overflow narrow screens or large text. | Responsive action group, wrapping metrics/metadata and readable text contrast. | Layout tests and docs/UI_AUDIT.md matrix. |
| R05 | P1 | DiscoverRoomsScreen.js | Delayed old search response overwrites latest search; repeated pagination appends duplicate rooms. | Request generations and append guard with ID deduplication. | Source trace/lint; native scrolling/network test pending. |
| R06 | P1 | CreateRoomScreen.js | Nearby creation attempts a cloud API registration, adds offline delay and can create an orphan room with incompatible code. | Entirely native local creation; duplicate submission guard. | Source trace; native hosting UNVERIFIED. |
| R07 | P2 | Login/Register/CreateRoom/Splash screens | Rapid submission races state updates; looping splash animation has no stop cleanup. | Synchronous submit guard and animation cleanup. | JS lint; UI repeat-tap/mount tests pending. |
| R08 | P1 | SettingsScreen/NotificationsScreen.js | Failed global session revocation and notification-read writes can show artificial success. | Wait for successful server write and expose failure. | Source trace; offline native UI test pending. |
| R09 | P1 | docker-compose.yml; deployment configuration | Unauthenticated standalone Mongo and public API binding conflict with atomic transactions and safe ingress. | rs0 development initialization; authenticated production overlay, private DB/Redis, readWrite app user, loopback API. | Configuration/source checks; Docker runtime not available here unless TEST_REPORT records otherwise. |
| R10 | P1 | services/api/scripts/migrate.js | Old Room TTL can delete live rooms; deployed indexes/counters lack migration path. | Backup-first reconciliation/createIndexes/drop specific obsolete TTL before ingress. | Script syntax; staging migration/restore is required. |
| R11 | P2 | README/docs/config/build.env.js | Documentation claims tests/architecture inconsistent with actual native verification; generated file contains personal IP. | Current evidence reports and environment-only defaults. | Default release configuration generated; archive inspection. |
| R12 | P1 | mobile dependency tree | npm reports transitive picomatch ReDoS under React Native build tooling; current registry latest remains affected. | Record actual audit, keep Metro/CLI private and require upstream patch/verified remediation before a clean toolchain release. Preserve existing RN compatibility rather than inventing a safe upgrade. | npm audit report; unresolved status in security/known limits. |
| R13 | P3 | .github/workflows/verify.yml; .maestro | No committed native/E2E CI coverage. | Actual install/test/lint/bundle/Android/iOS jobs and native smoke flow. | Workflow/flow provided; remote CI and device execution UNVERIFIED. |

## Backend findings

"""

def main():
    sections = [HEADER]
    for title, name in [("", "agent-backend-report.md"), ("Mobile core findings", "agent-mobile-report.md"), ("Nearby/native findings", "agent-nearby-report.md")]:
        report = ROOT / "docs" / name
        if title:
            sections.append(f"\n\n## {title}\n\n")
        sections.append(report.read_text(encoding="utf-8") if report.exists() else "Audit report pending; do not infer completion.\n")
    sections.append("\n\n## Release acceptance\n\nProduction readiness is not established by this audit. Native build/device, hostile-LAN transport, actual decoder/voice/radio and measured drift/capacity gates are explicitly tracked in TEST_REPORT.md, PERFORMANCE_REPORT.md and KNOWN_LIMITATIONS.md.\n")
    (ROOT / "AUDIT_REPORT.md").write_text("".join(sections), encoding="utf-8")

if __name__ == "__main__":
    main()
