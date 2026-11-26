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
