# Current rebuild development notes

See [deployment](../DEPLOYMENT.md), [test evidence](../TEST_REPORT.md), [nearby](NEARBY.md), [media providers](MEDIA_PROVIDERS.md) and [SFU](SFU.md) for current behavior. The original design notes below remain useful; the linked protocol reports take precedence where behavior has been repaired.

# Development guide

## Design principles

- **Independent by construction.** The mobile app, API, database, auth, environment, and deployment files are self-contained in this repository.
- **Server-authoritative playback.** Clients never decide the shared playback position. The host reports state; the server timestamps it; every other client converges toward it.
- **Small modules, explicit boundaries.** API routes validate and authorize; services own domain rules; models own persistence; the realtime bridge emits domain events.
- **No hidden mock data.** Screens call real endpoints or the native nearby transport. Empty states remain empty until real data exists.
- **Four-color visual system.** Black, orange, yellow, and off-white only, with translucent variants of off-white for surfaces and borders.

## Repository conventions

```text
apps/mobile/src/
  api/            Axios client, token refresh, endpoint wrappers
  components/     reusable visual system
  config/         build-time environment and timing constants
  context/        AuthContext, SocketContext, RoomContext
  media/          SyncedMediaPlayer
  navigation/     root stack and bottom tabs
  screens/        21 screens
  services/       secure storage, nearby bridge, deep-link storage
  sync/           ClockSync and PlaybackSync
  utils/          formatting and invite parsing
  voice/          mesh/SFU VoiceEngine and LiveKitVoiceEngine

services/api/src/
  config/         env validation, Mongo, Redis, logger
  middleware/     auth, uploads, validation, rate limits, errors
  models/         User, Room, RoomMember, MediaAsset, Message, ...
  realtime/       Socket.IO handlers, schemas, event bridge
  routes/         REST routes
  services/       room, playback, media, chat, speak, rtc, tokens, notifications
  utils/          errors, ids, pagination, serialization
```

## Backend flow

1. `src/server.js` validates environment, connects Mongo and optional Redis, creates the Express app and HTTP server, then attaches Socket.IO.
2. `src/app.js` installs security middleware, request sanitization, rate limits, REST routes, the invite landing page, and error handling.
3. Routes call services. Services raise `ApiError` for expected failures and emit domain events through `src/realtime/bus.js`.
4. `src/realtime/handlers.js` listens to those events and emits to Socket.IO channels such as `room:<mongoId>` and `user:<userId>`.
5. Socket.IO authenticates with the access token in `auth.token` or the `Authorization: Bearer` header.

### Authentication

- Access tokens are HS256 JWTs with issuer `vibesync-api` and audience `vibesync-mobile`.
- Refresh tokens are 48-byte random values. Only a SHA-256 hash is stored in MongoDB.
- Every refresh rotates the token. Reuse of an already-rotated token revokes the entire token family.
- Password changes and `logout-all` revoke all access/refresh sessions and active sockets.
- In production the API refuses to start with the example JWT secrets.

### Playback authority

The authoritative record lives on the `Room` document:

```text
status: idle | playing | paused | ended
media, positionMs, rate, updatedAt, updatedBy, sequence
```

`GET /playback` returns both the anchor (`positionMs`, `updatedAt`) and `computedPositionMs` evaluated at server time. Host commands are accepted only from the room host:

- `play`, `pause`, `seek`, `setMedia`, `setRate`, `ended`, `heartbeat`
- Each command increments `sequence`, updates `updatedAt`, persists to Mongo, and emits `playback:state`.
- When Redis is configured, the latest payload is cached for 12 hours; Mongo remains authoritative.

The host sends a heartbeat roughly every 5 seconds while playing. The server treats the host's media clock as the source of truth and re-anchors playback to server time.

### Client clock and drift correction

`ClockSync` uses NTP-style samples:

```text
offset = serverTime - (t0 + t2) / 2
```

The lowest-RTT samples are retained and a median offset is used. `PlaybackSync` derives the expected position from `positionMs + (serverNow - updatedAt) * rate` and then:

| Drift | Action |
| --- | --- |
| under 120 ms | leave playback alone |
| 120–850 ms while playing | temporarily nudge playback rate by at most ±0.05 |
| 850 ms or more | hard seek to the expected position |

Pause/play transitions and explicit seeks are applied immediately. This keeps corrections inaudible during normal playback while guaranteeing convergence after a long stall.

### Media

- Uploads are stored on local disk under `MEDIA_STORAGE_DIR` with random names and MIME allow-listing.
- `GET /api/media/:mediaId/stream` requires authentication and an active room membership, then serves Range requests for resumable playback.
- External URLs support HLS, DASH, progressive video, and audio. The native player handles adaptive quality selection; there is no manual quality menu.
- DRM metadata (`widevine`, `fairplay`, `playready`, `clearkey` + license URL) is passed to `react-native-video`. FairPlay commonly needs an Apple certificate and content ID that the current model does not store; see [LIMITATIONS.md](LIMITATIONS.md).

### Voice

- `VoiceEngine` is an audio-only WebRTC mesh.
- Only members with `permissions.canSpeak` and without `mutedByHost` publish a microphone track.
- The API rejects signaling from unapproved speakers, so client UI state is not the security boundary.
- Offer glare is resolved by user ID ordering; TURN credentials are generated from `TURN_SECRET` when configured.
- `GET /api/rtc/config` returns ICE servers and the recommended mesh size. `POST /api/rtc/livekit-token` is available when LiveKit is configured, but the current mobile client uses the mesh path.

### Chat

- Channels: `room` (everyone with chat permission) and `host` (private host inbox).
- Private messages are emitted only to the sender and the host's user channel.
- Message delivery uses REST or `chat:send`; both enforce membership, mute/chat permissions, and rate limits.
- Hosts can delete messages, clear chat, and moderate participants.

### Join and microphone approvals

- Private or approval-required rooms create a `pending` membership. The host receives `join:request` and decides with `approve`/`reject` (optionally banning).
- A pending user receives `join:decision` / `room:approved` and can then enter the room.
- Microphone access is a separate flow: `speak:request` creates a speak request, the host decides, and approval updates member permissions and emits `speak:decision` / `permission:updated`.
- Mute-all updates every active participant and emits `speak:mute-all`, which makes publishing clients stop their tracks.

## Mobile flow

- `AuthContext` boots from secure storage, refreshes the access token when needed, and publishes auth events.
- `SocketContext` connects only when authenticated, performs clock samples, reconnects with a fresh access token, and exposes `emitAck`.
- `RoomContext` owns the active room snapshot, playback, members, messages, media queue, voice engine, and socket event subscriptions.
- `SyncedMediaPlayer` owns the video/audio element, applies corrections, reports progress, and exposes `seekTo` and `enterFullscreen`.
- Online navigation is auth-gated. Invite links wait for sign-in; Login also offers local-only NearbyGuest without cloud credentials.

### Build-time mobile configuration

React Native has no runtime `process.env`. `apps/mobile/scripts/apply-env.js` parses `apps/mobile/.env` and writes `src/config/build.env.js`. The generated file is committed with defaults so a fresh clone still builds. `src/config/index.js` consumes it and keeps safe fallbacks.

### Secure storage

- Access and refresh tokens live in the OS keychain/keystore through `react-native-keychain`.
- There is deliberately no AsyncStorage credential fallback.
- Device IDs and non-sensitive preferences may use AsyncStorage.

## Nearby transport

Nearby hosting runs a native HTTP server on the host device and advertises a small BLE payload. Guests fetch session state and stream media over the LAN. The full protocol, BLE payload, permission behavior, and platform constraints are in [NEARBY.md](NEARBY.md).

## Tests

### API

```bash
cd services/api
npx jest --runInBand --detectOpenHandles tests/integration.test.js
```

The suite starts MongoDB Memory Server 8.0.14, boots the real Express app and Socket.IO server, registers users, creates rooms, exercises uploads and Range streaming, joins, permissions, chat, playback, and private-room approval, then shuts everything down.

Notes:

- Do not upgrade Mongoose to 9 without retesting; Mongoose 9 / MongoDB driver 7.8 failed the Jest handshake in this project.
- `tests/setup-env.js` selects the MongoDB Memory Server version and test secrets.

### Mobile

```bash
cd apps/mobile
npx jest --runInBand
```

The tests cover clock offset estimation, low-RTT sample selection, expected-position math, pause behavior, hard seek thresholds, soft rate nudges, and already-synced playback.

### Lint and syntax

```bash
cd services/api && npm run lint
cd apps/mobile && npx eslint src App.js index.js scripts --ext .js --quiet
```

## Adding an endpoint

1. Add a Zod schema in the route or the relevant realtime schema module.
2. Authorize with `authenticate`, room membership helpers, and host checks.
3. Put domain logic in a service; keep routes thin.
4. Emit a domain event if clients need realtime updates.
5. Add an integration test covering both success and denial.
6. Update [API.md](API.md).

## Adding a screen

1. Create the screen under `src/screens/` using existing `Screen`, `Header`, `AppText`, `Button`, and palette primitives.
2. Register it in `src/navigation/index.js`.
3. Use `RoomContext` or an API wrapper; do not inline fake data.
4. Add loading, empty, error, and offline states.
5. Update [SCREENS.md](SCREENS.md).

## Coding conventions

- JavaScript only in the React Native app. Native Kotlin/Swift only for functionality JavaScript cannot provide.
- CommonJS in the backend, ES modules in the mobile app.
- Prettier defaults: single quotes, trailing commas, 100-column width.
- No secrets in source, logs, analytics, or error responses.
- Keep the palette limited to the four defined colors and alpha variants.
