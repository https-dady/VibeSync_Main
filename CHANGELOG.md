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
