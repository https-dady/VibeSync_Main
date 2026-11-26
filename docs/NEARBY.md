# Nearby local transport

Nearby uses native BLE/GATT discovery and HTTP over shared Wi-Fi or an existing hotspot. Choose **Use nearby offline** on Login, or the Nearby tab after sign-in. NearbyGuest creates no cloud account/JWT and needs no first online sign-in. The actual native application is required for hosting/discovery; manual joining still needs network permission and a reachable host.

## Discovery and connection

The host imports a local file into managed app storage once, starts a local HTTP listener on a random port and advertises room metadata. BLE carries connection data; media travels over LAN. Hosts show code/name/address; discovered cards show room/host information and RSSI where available. Keep both apps foreground and on the same router or Android hotspot. Hotspot creation is manual in OS settings.

UUID `5bc3b1f0-8b4d-4c47-9a1e-3d8f2c7a6e10`, read characteristic ending `6e11`, payload version 1 and 11-byte layout are preserved: version, four ASCII code bytes, IPv4 and big-endian port. Android primary advertising contains the service UUID and moves service data to the scan response to fit the legacy packet limit. iOS exposes metadata through a GATT read. Five-second refresh, scan epochs/cancellation and stale-peer removal replace the conflicting old lifetimes. Scan has a 30-second deadline with permission/network/manual-join guidance.

BLE denial no longer prevents a host from starting LAN HTTP; the host displays discovery warnings and manual IP:port/code. The JS client accepts private/link-local literal addresses with explicit port, rejects public/credential/path URLs and applies an abortable eight-second request/body deadline. Retry reuses the join/message idempotency key. Network errors offer reachable-host, shared-network, permission and client-isolation troubleshooting; the app cannot prove the router's isolation policy from a timeout alone.

## HTTP contract

Responses use `{ok:true,...,serverNow}`; failures use `{ok:false,error,code}`. Private endpoints require `X-VibeSync-Token`. Tokens/recovery keys are random native session values and are not cloud access tokens.

| Method | Path | Authorization / payload |
| --- | --- | --- |
| GET | `/vibesync/info` | Public minimal room/host metadata |
| POST | `/vibesync/proof` | Public challenge → HMAC proof; JS verifies with original recovery key before moving a bearer token |
| POST | `/vibesync/join` | `{name,code,requestId}` → token/member/session/recoveryKey; native admission deduplicates the attempt |
| GET | `/vibesync/session` | Guest/host token; state/members/media and latest bounded chat log |
| POST | `/vibesync/playback` | Host token; `{status,positionMs,rate,startAt?}`; scheduled anchor bounded to three seconds |
| POST | `/vibesync/messages` | Guest/host token; `{body,clientMessageId}`; returns confirmed message |
| POST | `/vibesync/moderation` | Host token; `{action:'kick'|'deleteMessage',targetId}` |
| POST | `/vibesync/leave` | Guest token; remove membership |
| GET / HEAD | `/vibesync/media` | Active token; strict single HTTP Range with 206/416/Content-Range and efficient file streaming |

Guest polling is guarded at 600ms, host inspection at 1500ms; host playback reporting is separately throttled. Clock estimation selects fresh low-RTT samples. Scheduled starts use a 700ms lead, measured native onProgress positions, 120ms rate/850ms seek thresholds, buffer/load gating and seek cooldown. These parameters are implemented policies, not measured acoustic performance. Guests recover by backoff/rediscovery; HMAC host proof prevents token transfer based solely on a colliding room code. A three-second host interface refresh updates advertised addresses. Permission-denied discovery uses manual joining/rejoining.

## Lifecycle and security

Guest inactivity expires after 60 seconds. Native hosts bound request sizes/admission/connection resources, retain Swift HTTP handlers through completion and close transfers/file handles on stop/disconnect. Range overflow and malformed suffixes are rejected. The local chat log retains 200 messages; same-ID retry is idempotent while the original message remains retained. UI exposes sending/sent/failed and host delete/kick; reconnect reads the current ephemeral state.

Traffic is plaintext HTTP on a trusted WPA2/WPA3 LAN. Private IP filtering, tokens and recovery HMAC do not encrypt traffic or stop a passive sniffer/malicious relay. Old buffered media may remain on a removed guest until the player stops; future authenticated transfers are revoked. Foreground suspension/termination can end the host session. No durable chat, host migration, buffer-readiness quorum, local voice, Wi-Fi Direct, MultipeerConnectivity or Auracast transport is claimed.

See [native evidence](agent-nearby-report.md), [test report](../TEST_REPORT.md), [limitations](../KNOWN_LIMITATIONS.md) and [device matrix](DEVICE_VALIDATION.md). Full Android/Swift compilation, BLE, all cross-platform router/hotspot transfers, decoder behavior and physical 2/5/10/20 capacity remain UNVERIFIED.
