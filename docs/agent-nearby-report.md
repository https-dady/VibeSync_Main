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
