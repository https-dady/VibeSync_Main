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
