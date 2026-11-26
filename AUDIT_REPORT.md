# VibeSync source audit

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

# Backend audit and implementation evidence

Backend scope: every API source route, model, service, middleware, realtime handler/configuration and existing test was traced. Infrastructure and mobile/native ownership are recorded in the root ledger. Original baseline independently reproduced by root: 10/10 API tests. Updated backend: 40/40 tests passed, 3 suites, 18.587 seconds; ESLint passed with zero errors/warnings. Tests use a real temporary MongoDB single-node replica set, HTTP server, Socket.IO clients and disk files. Tests do not prove native playback, remote S3, Redis failover or SFU audio.

| Severity | Files / feature | Existing behavior / root cause | Implemented correction | Validation / status |
|---|---|---|---|---|
| P0 | `src/services/room.service.js`, membership | Concurrent requests each reserve a seat then upsert one membership. Duplicate approvals/leave/removal change counts twice; creation can orphan rooms. | MongoDB transactions serialize room decisions, reload documents on retry, atomically create room/host membership and publish only after commit. | Parallel duplicate joins, independent capacity, approvals and leave tests PASS. |
| P0 | `src/services/token.service.js`, authentication | Successor refresh token created before old-token revocation; concurrent rotations mint multiple active tokens. Access survives logout/password change. | Transactional rotation; session-family and token-version access claims; REST and every socket packet verify current session. Logout/password invalidates access and disconnects sockets. | Rotation/reuse/access/logout/password/socket tests PASS. |
| P1 | `src/services/playback.service.js`, playback | Concurrent saves reuse sequence numbers. Spreading Mongoose playback subdocument discards status/position and computes zero. | Transactional commands, distinct sequences, expectedSequence guard, stale heartbeat rejection, direct position calculation and scheduled server-time starts. | Concurrent commands, stale heartbeat, late position and scheduled anchors PASS. Hardware drift UNVERIFIED. |
| P0 | `src/services/room.service.js`, private media | Pending/nonmembers receive external currentMedia URL; historical private membership grants details. | Active members alone receive currentMedia/playback. Private details require active/pending membership; rejected/left/removed states denied. | Pending private access/media tests PASS. |
| P1 | `src/models/Room.js`, `src/models/Message.js`, identity | Populated documents stringify into document text for hostId/senderId. | Explicit identifier extraction; minimal public host identity without email. | Identity assertions PASS. |
| P1 | `src/services/chat.service.js`, chat | Socket timeout/REST fallback duplicates stored messages. Timestamp pagination skips ties. Former members can delete. | Scoped clientMessageId unique partial index, content mismatch rejection, before/beforeId composite ordering and active-member delete authorization. | Concurrent socket/REST retry and timestamp tie tests PASS. |
| P1 | `src/realtime/handlers.js`, room subscription | Kick racing initial join can leave unauthorized subscription; Set in socket.data is unsuitable for Redis serialization. | Recheck membership after subscription, serializable room arrays and structured errors. | Existing kick/socket tests PASS. Multi-instance race stress UNVERIFIED. |
| P1 | `src/services/presence.service.js`, presence | User-wide Redis Set TTL can keep a crashed socket alive indefinitely while another socket renews it. No local mirror survives Redis failure. | Individual socket expiry in Redis sorted sets, local mirror and per-socket heartbeat/cleanup. | Local multi-socket/crash expiry tests PASS. Live Redis/failover UNVERIFIED. |
| P1 | `src/config/redis.js`, availability | Publisher/subscriber have no error listeners; readiness checks only primary Redis connection. | Observe all connections, bounded initial retries and readiness requiring primary/publisher/subscriber. | Lint/source checked; external Redis outage integration UNVERIFIED. |
| P1 | `src/config/db.js`, networking | Module overrides system DNS twice and logs debug configuration. | Respect OS DNS unless DNS_SERVERS supplied; validate transaction-capable deployment. | Replica-set tests PASS; Atlas deployment UNVERIFIED. |
| P1 | `src/services/mediaProviders.js`, providers | Every HTTP URL accepted as native media, including web pages/private addresses and unsupported iOS DASH. | Modular direct-HLS/DASH/audio/video registry; metadata/capabilities, public host validation, optional allowed-host policy, explicit unsupported provider/DRM errors. DASH Android-only; Widevine Android; FairPlay HLS iOS with certificate/content ID. | Provider/FairPlay contract tests PASS. Actual decoders/licenses/streams UNVERIFIED. |
| P0 | `src/services/media.service.js`, uploads | Declared MIME accepted without checking content. Failed post-upload validation leaves files. | Media signature validation, authorized transactional asset creation, failure cleanup and commit-time deletion. | Spoof rejection plus real HTTP HEAD/Range fixtures PASS. Signature checks are not full decoder/antivirus validation. |
| P1 | `src/services/mediaStorage.js`, storage | Local disk cannot support independent API disks. | Optional official AWS S3-compatible private bucket driver with streamed upload/GetObject Range/HEAD/deletion, bounded sockets, client abort cleanup; retain working local disk driver. | Local file/Range path PASS. Remote S3/MinIO operations UNVERIFIED. |
| P1 | `src/services/rtc.service.js`, voice mode | LiveKit advertised when no mobile integration; incorrect grants and host roomAdmin escalation. | Coordinated actual mobile SFU selection; explicit mesh fallback; microphone-only grants/no roomAdmin; 60-second join tokens and cutoff-aware fresh permissions. | Source checked; remote SDK audio UNVERIFIED. See SFU.md. |
| P0 | `src/services/sfu.service.js`, moderation | Existing tokens/connections retain permission after database change; backend only removes some mic cases. | Server updateParticipant, timestamped removeParticipant, room deletion, signed webhook authorization and 5-second reconciliation; failures return observable503 and degrade readiness. | Official webhook signature/body hash tests PASS. SFU server revokeTokenTs semantics and audio behavior UNVERIFIED. |
| P1 | `src/services/speak.service.js`, mic | Requests/decisions/permissions can race; mute-all duplicates logic across HTTP/socket. | Transactional requests/decisions/revocation, commit-only notifications and common muteAll service with SFU enforcement. | Baseline mic/moderation tests PASS. |
| P1 | `src/models/Room.js`, retention | Active-room TTL deletion leaves members/media orphaned. | Remove implicit TTL, explicit migration drops old lastActivityAt TTL and reconciles counters. | Migration lint checked; migration against user's deployed DB UNVERIFIED. |
| P1 | `src/services/password.service.js`, passwords | bcrypt silently truncates inputs beyond72UTF8 bytes; global sanitizer trims passwords. | Versioned SHA256 prehash before bcrypt12, original-string preservation, legacy verification and successful-login rehash. | Long Unicode suffix discrimination PASS. Existing legacy long-password accounts should reset passwords. |
| P1 | `src/config/env.js`, production defaults | Short/example secrets, wildcard CORS and insecure public URLs accepted. | Production refuses placeholder/short/equal secrets, wildcard/empty CORS, nonHTTPS URLs and insecure S3 endpoint. | Config/lint checked. Real production boot/TLS deployment UNVERIFIED. |
| P1 | `src/routes/health.routes.js`, `src/server.js`, operations | Health returns200 when unavailable; shutdown does not close Socket.IO timers/listeners. | Live/ready routes, DB ping and Redis/SFU readiness;503whiledraining; close Socket.IO and reconciliation before DB/Redis. | Ready/drain/liveness tests PASS. Real process/container shutdown UNVERIFIED. |
| P2 | `src/app.js`, `src/realtime/rateLimit.js`, abuse | Arbitrary request IDs enter logs; connection rate counter resets for every socket. | Bounded request ID and account/IP connection window across reconnects. | Lint/source checked. Load/abuse stress UNVERIFIED. |

## Exact remaining limitations

- No remote LiveKit audio, coturn ICE, Redis multi-instance outage, S3 bucket or physical-device test was run by this agent. Do not equate configuration/SDK source with a tested external service.
- LiveKit token expiry limits reuse for new connections; it does not disconnect an existing session. Immediate enforcement calls the server. The installed SDK supports revokeTokenTs, but the deployed SFU must implement that option. Without confirmed server revocation support, an old token may rejoin until its60-second expiry; configured signed webhook and5-second reconciliation correct unauthorized participants after delivery/polling. During SFU outage those bounds are not guaranteed. This remains a release gate.
- SFU room deletion does not cryptographically erase previously signed roomJoin tokens on every server version. Ended/unknown rooms are denied by API, webhook and reconciliation; remote stale-token recreation behavior requires testing.
- Uploaded signatures validate a format prefix, not the entire file's decode safety or media rights. Codec/platform decoding and DRM license acquisition remain device/provider tests.
- Public media domains can resolve differently on client devices; backend never fetches external media URLs, avoiding a server SSRF fetch. A configured MEDIA_ALLOWED_HOSTS policy is recommended for controlled deployments. Signed third-party URL expiry/renewal is provider-owned and not automatically refreshed by VibeSync.
- S3 object and MongoDB transactions cannot form a cross-service transaction. Failed uploads attempt object removal, and failed deletion remains a retryable tombstone. A process crash between upload and asset commit can orphan an object: configure bucket lifecycle/audited orphan cleanup.
- REST/auth and connection rate limits are per API instance. Chat limits use Redis when available. A reverse proxy/shared edge limiter is required for aggregate multi-instance limits.
- Redis recovery does not replay arbitrary missed events. Clients must resubscribe and refresh MongoDB state/history. Local presence is a fallback for one process, not globally complete presence during Redis outage.
- Legacy access tokens need a new sign-in because session-family/version claims are mandatory. Existing bcrypt passwords verify and upgrade, but older passwords already truncated to72bytes require a reset to remove legacy ambiguity.

## Modified API files

`src/app.js`, `src/server.js`; `src/config/{db,env,redis}.js`; `src/models/{User,Room,RoomMember,Message,MediaAsset}.js`; `src/middleware/{authenticate,error,sanitize}.js`; `src/realtime/{handlers,index,schemas,rateLimit}.js`; `src/routes/{auth,room,media,health}.routes.js`; `src/services/{room,token,password,playback,chat,media,rtc,speak,notification,presence}.service.js`; new `src/services/{mediaProviders,mediaStorage}.js`, `src/services/sfu.service.js`, `src/utils/transaction.js`; `tests/{integration.test,testServer}.js`; new `tests/{reliability,transport}.test.js`. Root owns package/lock changes and scripts/migrate.js; agent corrected migration's obsolete TTL key.

## Checks

Original root baseline:10/10 API tests. Updated run:40/40 tests,3suites,18.587s,zero failures. Backend ESLint:passed. Dependency advisory audit is owned by root; this agent's network audit request was interrupted and produced no advisory result. The final independent regression includes the final SFU grant reread and connection limiter changes; root also runs aggregate verification.



## Mobile core findings

# Mobile core engineering report

Audit date: 2026-11-18. Baseline mobile synchronization suite reproduced by root: 8/8 passed. Native builds, radio, decoder, audio routing, drift and physical-device performance are not verified by JavaScript tests.

## Findings and corrections

| Severity | Files / feature | Existing behavior and root cause | Expected behavior / implemented correction | Validation |
| --- | --- | --- | --- | --- |
| P0 | `apps/mobile/src/api/session.js`, `client.js`, `AuthContext.js` session lifecycle | Parallel initialization and refresh can overwrite newer credentials or restore logout; unordered writes and API-origin switching can disclose tokens. | Deduplicate reads/refresh; session epochs; ordered secure writes; bind tokens to API origin; reject server switches during requests; invalidate cached-user recovery without a valid session. | 8 session lifecycle tests passed; full lint passed. |
| P1 | `src/context/RoomContext.js`, `RoomScreen.js` room entry | Serial preparation before subscription, stale snapshot overwrite, conflicting entry and automatic infinite re-entry after errors. | Concurrent bounded requests; early subscription; required playback/member fetch; sequence merge; entry deduplication/cancellation; one automatic attempt per route with explicit retry. | 5 provider lifecycle tests passed (entry deduplication, bounded failure, cancellation, stale snapshot, reconnect). |
| P1 | `src/context/SocketContext.js` recovery | NetInfo changes recreate socket/listeners; overlapping sampling and delayed callbacks target obsolete clients. | Stable socket; network reconnect effect; sampling guards; foreground clock reset; listener/timer cleanup. | Source tracing and full lint passed; physical network switching remains UNVERIFIED. |
| P1 | `src/context/RoomContext.js` reconnect | Rejoin failures are swallowed; missed chat/media changes remain lost; peers persist; revoked media can keep playing. | Backoff/jitter subscription retry; refresh paginated authoritative history/media; pause immediately on access revocation; voice recovery; buffer early voice signals. | Room lifecycle regression passed; backend independently tests Socket authorization/reconnect. |
| P1 | `src/context/roomState.js`, `RoomContext.js`, chat screens | Timeout fallback can duplicate writes; no delivery state; merge can resurrect moderation; nested keyboard avoidance. | Backend-scoped idempotency ID; optimistic sending/sent/failed + same-ID retry; timestamp/ID ordering; deletion protection; fresh reconnect history; one keyboard container; private message deletion. | Message merge regressions and room recovery test passed; keyboard/device layout remains UNVERIFIED. |
| P1 | `src/media/SyncedMediaPlayer.js`, `src/sync/*` playback | Seeks before load/during buffering; correction-rate effects oscillate; stale clock samples persist; no scheduled starts; load failures lack bounded recovery; API JWT forwarded to external DRM licenses. | Retain 120/850 ms thresholds; load/buffer gating; 5-second drift-seek cooldown; rate persistence; expiring clock samples; scheduled server-time starts; bounded load/stall retries; host pause/resume during buffering; supported platform/MIME checks; remove external-license JWT headers. | Original sync8 tests + expanded pure sync regressions + player callback lifecycle5 tests passed. Native decode/drift/DRM remains UNVERIFIED. |
| P1 | `src/voice/VoiceEngine.js`, `LiveKitVoiceEngine.js`, `index.js` voice | Permanent failed peers, departed-peer leaks, duplicate microphone acquisition, unbounded ICE; permission mistaken for a live mic prevents offers; backend-only SFU token. | Actual LiveKit Room SDK connects/subscribes/publishes/mutes/disconnects with backend grants; SDK event cleanup + recovery; single native WebRTC fork shared with mesh; bounded mesh6/ICE64; mic race cancellation; peer recovery; audio-output selection and iOS system route picker. | Voice SDK/mesh lifecycle11 tests passed. Actual SFU/TURN/mic/speaker routing UNVERIFIED. |
| P2 | `src/utils/deepLinks.js`, `JoinRoomScreen.js` invites | Stripping/truncation changes code; stale lookups overwrite edits; overlapping approval polling; Cancel does not cancel membership. | Exact 7-character online alphabet; trusted exact invite paths; pasted links; request-generation checks; non-overlapping approval polling; 90-second wait then Check approval/Cancel; actual membership leave. | Invite regression cases passed; backend independently tests code normalization/membership. |
| P3 | `src/navigation/index.js` logging | Navigation font object logged at startup in release. | Removed obsolete debug logging. | Source search/lint. |

## Complete mobile-core modified files

- `apps/mobile/src/api/session.js`, `client.js`, `endpoints.js`
- `apps/mobile/src/context/RoomContext.js`, `SocketContext.js`, new `roomState.js`
- `apps/mobile/src/sync/ClockSync.js`, `PlaybackSync.js`
- `apps/mobile/src/utils/deepLinks.js`, `navigation/index.js`
- `apps/mobile/src/context/AuthContext.js`
- `apps/mobile/src/media/SyncedMediaPlayer.js`
- `apps/mobile/src/voice/VoiceEngine.js`, new `LiveKitVoiceEngine.js`, `apps/mobile/index.js`
- `apps/mobile/src/screens/JoinRoomScreen.js`, `RoomScreen.js`, `RoomChatScreen.js`, `HostChatScreen.js`
- New `apps/mobile/__tests__/core-regression.test.js`, `session.test.js`, `voice.test.js`, `player.test.js`, `room-lifecycle.test.js`
- This report. Coordinated SDK package/lock installation and native setup were completed by root/native agent.

Final mobile command results: `npm.cmd test -- --runInBand` **102 passed, 0 failed**, 9 suites; `npm.cmd run lint` **passed, 0 errors/warnings**. Totals include root accessibility/config tests and native-agent nearby tests. Root owns the final bundle/native build reports. Player tests simulate callback contracts and do not decode actual HLS/DASH/MP4 or license DRM. Voice tests mock the official SDK boundary and do not establish actual ICE/media connectivity.

## Product changes and compatibility

- New unauthenticated `NearbyGuest` navigation route opens the existing actual local NearbyScreen. It creates no online account/token and grants no cloud API access. Local discovery/streaming uses native session authentication. Root adds the entry button; radio/local networking remains device-unverified.
- A session saved by the previous app without `apiOrigin` requires one fresh cloud sign-in after upgrade. This prevents credentials being sent to an unknown server. NearbyGuest provides local use without this sign-in.
- Motion preference and OS reduced-motion setting now control Room player and navigation transitions through root's reusable hook.
- FairPlay requires a licensed certificate URL/content ID; Widevine is Android-only and FairPlay iOS-only. DASH is Android-only. PlayReady/ClearKey are clearly unavailable in the selected player.
- Mesh stays the configured fallback for rooms up to six members. A larger room can still use chat/media; publishing voice requires configured LiveKit. No participant capacity or physical drift target is claimed measured.
- Chat reconnect reloads up to 25 pages (1000 rows) back to the earliest displayed confirmed message; older history remains paginated. Verified history is replaced to reconcile missed moderation while unsent/failed optimistic messages remain retryable.
- iOS audio selection includes default, forced speaker and the native system route picker; Android offers only outputs reported by the installed audio session.

## Evidence boundaries

JavaScript race/clock/sequence tests validate algorithm and lifecycle behavior, not native decoding or radio performance. iOS requires macOS/Xcode. Android requires JDK/SDK/Gradle. BLE, hotspot, cross-platform discovery, HLS/DASH/MP4 decoding, WebRTC/TURN, physical audio routing, battery use and real drift remain UNVERIFIED until device runs. SFU capability will be advertised only when both server configuration and the actual mobile SDK path exist.


## Nearby/native findings

# Nearby and native implementation audit

Status: source repairs complete at this checkpoint. Nearby JavaScript regression tests PASS 24/24, lint PASS with zero warnings/errors, and real Kotlin/JVM protocol tests PASS 4/4. Full Android application compilation, Swift/Xcode and physical-device paths remain UNVERIFIED. No participant capacity or physical playback drift is claimed.

## Scope inspected

Read the complete Kotlin and Swift nearby modules, bridge registration/MainActivity permission callbacks, Android/iOS app and build settings, manifests/plists/privacy declarations, native networking implementation, `src/services/nearby.js`, the complete Nearby screen and `docs/NEARBY.md`. Also inspected shared clock and playback correction helpers to preserve their existing thresholds.

## Findings and implemented corrections

| ID | Severity | Files / feature | Existing versus expected behavior / root cause | Correction | Validation |
|---|---|---|---|---|---|
| N01 | P0 | `apps/mobile/android/app/src/main/java/com/vibesync/nearby/VibeSyncNearbyModule.kt`, BLE advertising | A 128-bit service-data AD field with the 11-byte payload consumes 29 bytes; adding the automatic 3-byte flags field exceeds legacy advertising's 31-byte limit. Expected: advertise a discoverable UUID and usable metadata. | Moved UUID to primary packet (21 bytes with flags), metadata to scan response (29 bytes). Preserved GATT fallback. | Packet-length arithmetic; physical Android→Android/iOS discovery UNVERIFIED. |
| N02 | P0 | `apps/mobile/ios/VibeSync/VibeSyncNearby.swift`, local HTTP | `NearbyHTTPConnection` existed only as a local variable, while its callbacks captured weak self. No owner retained the handler. Expected: lifetime through response. | Server retains a bounded registry of 64 concurrent connections; removes completed handlers; cancels clients on stop; per-connection idle deadlines and file-handle cleanup. | Source trace; Xcode and real HTTP devices UNVERIFIED. |
| N03 | P1 | Both native modules, GATT discovery | 30-second retry exceeded 13-second peer TTL: iOS-origin GATT peers expired between refreshes. Scan-attempt maps survived scan restarts. | Five-second retry, reset attempts, reject late callbacks after cancellation. | Native device tests UNVERIFIED. |
| N04 | P1 | Kotlin host / Nearby UI | BLE permission denial prevented a local HTTP host despite documented manual fallback. Advertising was reported successful before callback. | LAN hosting continues with explicit discovery warning; advertising state tracks actual native callback; added required NativeEventEmitter listener methods. | Permission/device checks UNVERIFIED. |
| N05 | P1 | Both native modules, members | Abrupt guests occupied membership indefinitely; iOS applied eight joins per minute to the entire room, blocking legitimate 10/20-client joins. | 60-second guest idle expiry renewed by authenticated requests/media; per-source iOS join rate limit; bounded admission with request-ID deduplication; room code required; kicked sessions stop media at subsequent transfer chunks. | JS admission retries tested; native session runtime/device behavior UNVERIFIED. |
| N06 | P1 | Both native modules, host network | IP selected once; DHCP or network switch left stale advertised address. Swift static GATT value could not update. | Three-second local-interface refresh; dynamic GATT address; guest rescans while reconnecting and verifies separate random recovery-key HMAC challenge before moving bearer token. | JS proof gate and JVM RFC4231 HMAC vector tested; Wi-Fi/hotspot/BLE recovery UNVERIFIED. |
| N07 | P1 | `src/services/nearby.js`, request lifetime | Promise timeout abandoned an active fetch; response JSON had no deadline. Invalid JSON could be accepted as success. | AbortController deadline covers request and body; useful permission/network/client-isolation messages; invalid-response rejection. | Jest request timeout, abort cleanup and invalid JSON cases PASS. |
| N08 | P1 | NearbyScreen playback | Guest estimated UI position fed back into measured player position, masking actual drift; only playing seeks at 350 ms; paused seek commands not applied. | Native onProgress alone supplies measured position; shared 120/850 ms correction policy; rate correction, cooldown, buffer-aware decisions, paused seeks, health/error states, fresh low-RTT clock sampling, stale revision rejection. Native scheduled anchor + JS start deadline (700 ms lead); host heartbeats do not overwrite future start. | JS timeline/scheduled-start helper tests PASS; physical drift, buffers and player scheduling UNVERIFIED. |
| N09 | P1 | Both native media endpoints, ranges | Kotlin overflow range parsing fell back to zero/end; malformed Swift end ranges became full suffix; Kotlin HEAD ignored a valid range. | Strict overflow/suffix validation; consistent 206/416 Content-Range and HEAD length; testable Kotlin parser plus JUnit tests. | Real Kotlin2.1.20/JVM parser tests PASS; HTTP engine/Swift device Range tests UNVERIFIED. |
| N10 | P1 | Swift HTTP / local access | Unlimited idle handlers; malformed/negative Content-Length and unsupported transfer framing accepted. Android JSON parser could parse unbounded chunked body and spawn unbounded client threads. | Swift idle deadlines/cap; reject unsupported framing; Android requires bounded positive content length before parsing and uses a bounded 64-client executor with rejection/stop cleanup. | Native HTTP fuzz/device tests UNVERIFIED. |
| N11 | P1 | Local session security | Manual host could be an arbitrary public URL; Android listener accepted cellular/public peers; unauthed join knew only name. | JS accepts literal private/link-local addresses only and local media path only; Android accepts only local client IPs; Swift prohibits cellular listener interfaces; joins require four-character code; native CSPRNG bearer tokens remain required for media/state/chat. | Address/public media rejection PASS; LAN security limits below. |
| N12 | P2 | NearbyScreen discovery | No scan deadline; nearby cards could show only code/address; silent empty scan. | Focus-triggered discovery, 30-second deadline and actionable empty/error state; public minimal `/vibesync/info` metadata, host name and RSSI cards; manual code entry. | UI device sizes/permission tests UNVERIFIED. |
| N13 | P2 | iOS build/privacy | PrivacyInfo.xcprivacy referenced in project group but absent from Copy Resources; example bundle identifier retained; universal links lacked native handoff/entitlements. | Included privacy resource, default bundle `com.vibesync`, associated domain entitlement and continue-userActivity handoff. Production owner must replace/verify domain and publish AASA. | Xcode archive/privacy/signing/universal-link validation UNVERIFIED. |
| N14 | P2 | Nearby architecture | Local server copies imported media once to managed storage; session chat returns latest 200 messages by polling; no host migration or durable history. | Retained managed-file import for provider/permission stability. LAN remains shared cross-platform transport. Additional Wi-Fi Direct/Multipeer/Auracast not implemented. | Device benchmark required; no untested count claims. |
| N15 | P1 | Both native modules / Nearby chat | Lost send response could duplicate local messages on retry; no host kick or deletion routes. | Per-sender clientMessageId deduplication within retained log; same-key transient retry; optimistic Sending/Failed and retry; actual authenticated host-only moderation routes and UI. Unauthorized/expired guest pauses and requires rejoin. | JS retries/moderation request contract PASS; native moderation and device chat delivery UNVERIFIED. |
| N16 | P1 | Native voice initialization / signing | LiveKit mobile SDK needs platform audio setup; supplied custom debug key is a private signing key in the ZIP. | Added actual SDK Android/iOS setup before RN startup and official pod sources; AGP default generated local debug signing key replaces shipped custom key config. | Full native app/voice compilation UNVERIFIED; root owns dependency/mobile SDK integration. |

## Modified files

- `apps/mobile/android/app/src/main/java/com/vibesync/nearby/VibeSyncNearbyModule.kt`
- `apps/mobile/android/app/src/main/java/com/vibesync/nearby/NearbyProtocol.kt` (new)
- `apps/mobile/android/app/src/test/java/com/vibesync/nearby/NearbyProtocolTest.kt` (new)
- `apps/mobile/android/app/build.gradle`
- `apps/mobile/android/app/src/main/java/com/vibesync/MainApplication.kt`
- `apps/mobile/ios/VibeSync/VibeSyncNearby.swift`
- `apps/mobile/ios/VibeSync/VibeSyncNearby.m`
- `apps/mobile/ios/VibeSync/AppDelegate.swift`
- `apps/mobile/ios/Podfile`
- `apps/mobile/ios/VibeSync.xcodeproj/project.pbxproj`
- `apps/mobile/ios/VibeSync/VibeSync.entitlements` (new)
- `apps/mobile/src/services/nearby.js`
- `apps/mobile/src/screens/NearbyScreen.js`
- `apps/mobile/__tests__/nearby.test.js` (new)
- `docs/agent-nearby-report.md` (new)

## Remaining limits / acceptance gates

- Local session transport is plaintext HTTP. Tokens prevent unauthenticated file/state access but do not protect against an observer or malicious peer on the shared LAN. Use a trusted WPA2/WPA3 network. TLS pinning/pairing negotiation remains a production security acceptance gate.
- Room codes are discovery/pairing assistance, not strong passwords (four-character wire format preserved). No unlimited Bluetooth multi-phone audio claim; capability response explicitly reports Auracast unimplemented.
- iOS/Android foreground hosting only. Background suspension or termination ends or interrupts sessions; host migration is not feasible without transferring media ownership/content and must be separately engineered.
- Guest automatic re-address discovery requires BLE availability/permission and the host's original recovery key. Manual rejoin remains the fallback. HMAC discovery prevents accidental same-code collisions; it does not replace TLS or protect against a malicious LAN relay.
- Local chat is an ephemeral bounded log (200 entries). Retry deduplication is scoped to messages still retained in the log; durable history/pagination is not implemented. Removed media can remain in a player's already-buffered audio/video even after further transfer stops.
- Scheduled starts use a 700 ms lead and buffer-aware drift correction; no multi-device readiness quorum or calibrated native audio-output latency is implemented.
- Android BLE callbacks have a scan epoch guard; Swift pending scan promises have cancellation/timeouts and current scan guards. OS callback race behavior remains device UNVERIFIED.
- Same-router, Android hotspot, Android↔iOS/iOS↔iOS, BLE permission denial, native decoder/media Range, audio routing, battery and 2/5/10/20 capacity remain physical-device UNVERIFIED.
- Windows has JDK17 and cached Gradle8.14.3; standard Android SDK paths and ANDROID_HOME were not configured. Xcode/macOS is unavailable.

## Executed checks and evidence

- Nearby Jest: **24 passed, 0 failed**. Tests execute real service/address/timeline functions with mocked HTTP and a JS bridge HMAC reference verifier. These are unit/contract tests, not native/network-device tests. Log: workspace `source/nearby-test.log`.
- Nearby ESLint: **exit 0, zero errors/warnings**, service, screen and test file. Log: workspace `source/nearby-lint.log`.
- Native protocol: actual `NearbyProtocol.kt` and `NearbyProtocolTest.kt` compiled with Kotlin2.1.20 and JDK17; JUnit4.13.2 reports **4 passed, 0 failed**. Range normal/open/suffix/malformed/overflow cases plus RFC4231 HMAC-SHA256 vector. Compiler/test logs: `.qa/native-protocol-compile.log` and `.qa/native-protocol-test.log` (classes are generated artifacts, exclude from ZIP).
- Actual Android Gradle compile/test command attempted. Worker wrapper download initially failed `java.net.SocketException: Permission denied: getsockopt`; approval request was interrupted. Root subsequently ran cached Gradle and reached plugin tasks, reporting missing SDK configuration. Full application Kotlin compilation and Gradle native test tasks remain **NOT COMPLETED / UNVERIFIED**. Root must retain failure stderr alongside stdout logs `android-build.log` and `android-cached-build.log`.
- iOS Xcode/CocoaPods build **UNVERIFIED**, no macOS/Xcode available.
- All physical-device networking/BLE/hotspot/audio-routing/voice/output-latency/capacity tests **UNVERIFIED**.

## Protocol compatibility notes

Both rebuilt native hosts require four-character room code and a join request ID; the rebuilt JS client supplies them. Older nearby clients without those fields must upgrade. BLE UUID/version/11-byte discovery layout is preserved. Existing online-room/API protocol is unaffected by these local changes. The legacy native sendHostMessage bridge is preserved; the rebuilt screen uses the authenticated local HTTP chat endpoint for common idempotency/delivery behavior.


## Release acceptance

Production readiness is not established by this audit. Native build/device, hostile-LAN transport, actual decoder/voice/radio and measured drift/capacity gates are explicitly tracked in TEST_REPORT.md, PERFORMANCE_REPORT.md and KNOWN_LIMITATIONS.md.
