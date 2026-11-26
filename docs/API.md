# API and realtime reference

Base URL: `http://localhost:4000` in development. All JSON routes are under `/api`.

## Authentication

Send the access token as:

```http
Authorization: Bearer <accessToken>
```

Socket.IO accepts either `auth.token` or the same `Authorization` header.

### Token pair

```json
{
  "accessToken": "...",
  "accessExpiresAt": "2026-01-01T00:15:00.000Z",
  "refreshToken": "...",
  "refreshExpiresAt": "2026-01-31T00:15:00.000Z",
  "tokenType": "Bearer"
}
```

Access tokens default to 15 minutes. Refresh tokens default to 30 days and rotate on every use. Reusing a rotated refresh token revokes its whole token family.

## Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": [{ "path": "body.email", "message": "Invalid email" }],
    "requestId": "..."
  }
}
```

Common codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `TOKEN_INVALID`, `FORBIDDEN`, `HOST_ONLY`, `ROOM_NOT_FOUND`, `ROOM_ENDED`, `PRIVATE_ROOM`, `NOT_A_MEMBER`, `RATE_LIMITED`, `FILE_TOO_LARGE`, `UNSUPPORTED_MEDIA`, `INVALID_DRM_LICENSE_URL`.

Rate limits (production): auth 30 requests/15 min per IP, general API 240/min per IP, writes 90/min per IP, uploads 30/hour per IP, chat writes 40/min per user.

## REST endpoints

### Health

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Backward-compatible health summary. Public. |
| GET | `/api/health/live` | Liveness. |
| GET | `/api/health/ready` | Readiness; 503 for required service failure/shutdown. |
| GET | `/` | API identity JSON. Public. |

### Auth

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/auth/register` | `{name,email,password,device?}`. Returns user + token pair. |
| POST | `/api/auth/login` | `{email,password,device?}`. Returns user + token pair. |
| POST | `/api/auth/refresh` | `{refreshToken}`. Returns a rotated token pair. |
| POST | `/api/auth/logout` | `{refreshToken?}`. Revokes the session family and its access tokens/sockets. |
| POST | `/api/auth/logout-all` | Revokes all access/refresh sessions and connected sockets for the current user. |
| GET | `/api/auth/me` | Current user. |
| PATCH | `/api/auth/me` | `{name?,bio?,avatarColor?,settings?}`. |
| POST | `/api/auth/change-password` | `{currentPassword,newPassword}`; revokes all sessions. |
| GET | `/api/auth/sessions` | Active refresh-token sessions for the current user, newest first: id, timestamps, IP, user agent. |

### Rooms

All room routes require authentication.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/rooms` | Public room discovery: `mode`, `mediaType`, `search`, `limit`, `offset`. |
| POST | `/api/rooms` | Create a room. Host is added automatically. |
| GET | `/api/rooms/:roomId` | Room snapshot plus members, media, playback, membership. |
| POST | `/api/rooms/:roomId/join` | Join or request approval; optional password. |
| POST | `/api/rooms/:roomId/leave` | Leave the room. |
| GET | `/api/rooms/:roomId/requests` | Host: pending join requests. |
| GET | `/api/rooms/:roomId/requests/mine` | Current user's pending membership. |
| POST | `/api/rooms/:roomId/requests/:memberId/decision` | Host: `{decision:'approve'|'reject',ban?}`. |
| GET | `/api/rooms/:roomId/members` | Members visible to the caller. |
| PATCH | `/api/rooms/:roomId/members/:memberId/permissions` | Host: `{canChat?,canSpeak?,mutedByHost?}`. |
| DELETE | `/api/rooms/:roomId/members/:memberId?ban=true` | Host: remove or ban. |
| PATCH | `/api/rooms/:roomId/settings` | Host: name, description, visibility, capacity, approvals, chat, password. |
| POST | `/api/rooms/:roomId/end` | Host: end room for everyone. |
| GET | `/api/rooms/:roomId/playback` | Authoritative playback snapshot. |
| POST | `/api/rooms/:roomId/playback/command` | Host: `{action,positionMs?,mediaId?,rate?,expectedSequence?,startAtServerMs?}`. |
| POST | `/api/rooms/:roomId/playback/heartbeat` | Host: `{positionMs,sequence?}`; stale-sequence heartbeat rejected. |
| GET | `/api/rooms/:roomId/media` | Room media queue. |
| POST | `/api/rooms/:roomId/media/upload` | Host: multipart `file` + metadata. |
| POST | `/api/rooms/:roomId/media/url` | Host: external URL and optional DRM metadata. |
| DELETE | `/api/rooms/:roomId/media/:mediaId` | Host: remove media. |
| GET | `/api/rooms/:roomId/messages?channel=room|host&before=&beforeId=&limit=` | Chat history. |
| POST | `/api/rooms/:roomId/messages` | `{channel,body,targetUserId?,clientMessageId?}`. |
| DELETE | `/api/rooms/:roomId/messages/:messageId` | Active member host or message owner. |
| POST | `/api/rooms/:roomId/messages/moderation` | Host: `{action:'clear'}`. |
| GET | `/api/rooms/:roomId/speak-requests` | Host: microphone requests. |
| POST | `/api/rooms/:roomId/speak-requests` | `{note?}`. Request to speak. |
| POST | `/api/rooms/:roomId/speak-requests/:requestId/decision` | Host: `{decision:'approve'|'reject'}`. |
| POST | `/api/rooms/:roomId/members/:userId/mic` | Host: `{granted:boolean}`. |
| POST | `/api/rooms/:roomId/mic/mute-all` | Host: mute every participant. |
| GET | `/api/rooms/:roomId/notifications` | Recent room-related notifications. |

Playback actions: `play`, `pause`, `seek`, `setMedia`, `setRate`, `ended`, plus the heartbeat route.

### Media streaming

| Method | Path | Description |
| --- | --- | --- |
| GET / HEAD | `/api/media/:mediaId/stream` | Authenticated audio/video stream with `Range` support. Requires active room membership. |

### Notifications and devices

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/notifications?unreadOnly=true|false&limit=` | Notification list with unread count. |
| POST | `/api/notifications/:notificationId/read` | Mark one as read. |
| POST | `/api/notifications/read-all` | Mark all as read. |
| POST | `/api/devices` | Register/update `{deviceId,platform,appVersion,capabilities}`. |
| GET | `/api/devices` | List the user's devices. |
| DELETE | `/api/devices/:deviceId` | Remove a device. |

Notifications are in-app and database-backed. There is no APNs/FCM push provider.

### WebRTC

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/rtc/config` | ICE servers, voice transport, LiveKit URL, recommended mesh size. |
| POST | `/api/rtc/livekit-token` | `{roomId}`; active member; 60-second audience/microphone-only grant when configured. |
| POST | `/api/rtc/livekit-webhook` | Official SDK verifies signed original application/webhook+json body/hash; reconciles membership/grants. |

### Invite landing page

| Method | Path | Description |
| --- | --- | --- |
| GET | `/r/:roomId` | Public HTML invite page with room metadata and `vibesync://room/:roomId` deep link. |

## Socket.IO

Connect to the API origin with path `/socket.io`:

```js
io(API_URL, {
  transports: ['websocket'],
  auth: { token: accessToken },
});
```

Every client event uses an acknowledgement callback. Success payloads contain `{ok:true,...}`; failures contain `{ok:false,error:{code,message,details?}}`. The server also emits `event:error` and may disconnect on `auth:expired`.

### Client to server

| Event | Payload | Purpose |
| --- | --- | --- |
| `clock:sync` | `{t0}` | Server timestamp sample for clock estimation. |
| `room:join` | `{roomId}` | Join the realtime room channel; returns playback, members, membership, online users. |
| `room:leave` | `{roomId}` | Leave the channel. |
| `playback:command` | `{roomId,action,positionMs?,mediaId?,rate?}` | Host playback control. |
| `playback:heartbeat` | `{roomId,positionMs}` | Host position heartbeat while playing. |
| `playback:sync` | `{roomId}` | Request the current playback snapshot. |
| `chat:send` | `{roomId,channel?,body,targetUserId?}` | Send room or private host chat. |
| `chat:delete` | `{roomId,messageId}` | Delete a message. |
| `speak:request` | `{roomId,note?}` | Ask the host for microphone access. |
| `speak:decision` | `{roomId,requestId,decision}` | Host approves or rejects a speak request. |
| `mic:set` | `{roomId,userId,granted}` | Host grants/revokes mic; participants may revoke their own. |
| `mic:mute-all` | `{roomId}` | Host mutes everyone. |
| `webrtc:signal` | `{roomId,targetUserId,data}` | Offer, answer, ICE candidate, renegotiate, or bye. Offers from unapproved speakers are rejected. |

### Server to client

| Event | Meaning |
| --- | --- |
| `connected` | Socket authenticated; includes server time and recovery flag. |
| `presence:update` | A user came online/offline in a room. |
| `playback:state` | Authoritative playback changed. |
| `chat:message` | New room or private host message. |
| `chat:deleted`, `chat:cleared` | Moderation update. |
| `room:member-joined`, `room:member-left`, `member:updated` | Membership changes. |
| `room:settings`, `room:ended` | Host changed settings or ended the room. |
| `join:request`, `join:request:resolved`, `join:decision`, `room:approved` | Join approval flow. |
| `speak:request`, `speak:request:resolved`, `speak:decision`, `speak:mute-all` | Microphone approval and mute flow. |
| `permission:updated`, `mic:revoked` | Per-member permission change. |
| `room:removed`, `room:access-revoked` | Participant removed/banned or lost access. |
| `webrtc:signal` | Incoming offer/answer/ICE/bye. |
| `notification` | New in-app notification. |
| `event:error` | A client event failed with `{event,code,message}`. |
| `auth:expired` | Socket token expired; reconnect with a fresh token. |

## Environment

See `services/api/.env.example`. The API validates all variables at boot and exits on invalid values. Production additionally refuses to start with the example JWT secrets.


## Rebuild protocol additions

Online room codes are exactly seven characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, case-insensitive after trim. Nearby codes remain four characters under the native local contract. Legacy cloud access tokens need fresh sign-in; online database operations require replica-set transactions.

Chat `clientMessageId` is 8–80 ASCII letters/numbers/underscore/hyphen and is scoped to sender/room/channel/target. A retry with changed content is rejected. Use the returned composite timestamp/ID cursor for stable pagination. Reconnect subscribes again and refreshes confirmed history/media/state; socket subscriptions do not create REST membership.

Playback `expectedSequence` rejects stale commands; heartbeat `sequence` rejects old reports. Optional `startAtServerMs` schedules within the next three seconds. Returned clock/server timestamps and sequence remain authoritative; clients do not seek while unloaded/buffering. See source tests for races and docs/DEVICE_VALIDATION.md for native drift validation.

External URL payloads use `{url,title,type,mimeType?,durationMs?,drmScheme?,drmLicenseUrl?,drmCertificateUrl?,drmContentId?}`. FairPlay requires licensed certificate/content ID/license; Widevine is Android-only, FairPlay iOS-only, DASH Android-only. Unsupported website pages/DRM/platform combinations return explicit errors. Provider validation does not fetch third-party URLs. See MEDIA_PROVIDERS.md.

RTC config now selects the actual mobile LiveKit implementation when configured; otherwise mesh is bounded to six members by client policy. SFU server revocation/cutoff must pass real audio tests before release. See SFU.md and KNOWN_LIMITATIONS.md.
