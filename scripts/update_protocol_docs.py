"""Synchronize protocol/setup references with the implemented rebuild."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    nearby = """# Nearby local transport

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
"""
    (ROOT / "docs/NEARBY.md").write_text(nearby, encoding="utf-8")
    file = ROOT / "docs/API.md"
    source = file.read_text(encoding="utf-8")
    replacements = {
        "Revokes that refresh token.": "Revokes the session family and its access tokens/sockets.",
        "Revokes all refresh sessions for the current user.": "Revokes all access/refresh sessions and connected sockets for the current user.",
        "`{action,positionMs?,mediaId?,rate?}`": "`{action,positionMs?,mediaId?,rate?,expectedSequence?,startAtServerMs?}`",
        "Host: `{positionMs}`": "Host: `{positionMs,sequence?}`; stale-sequence heartbeat rejected",
        "messages?channel=room|host&before=&limit=": "messages?channel=room|host&before=&beforeId=&limit=",
        "`{channel,body,targetUserId?}`": "`{channel,body,targetUserId?,clientMessageId?}`",
        "Host or message owner.": "Active member host or message owner.",
        "| GET | `/api/health` | Service, database, Redis, and LiveKit status. Public. |": "| GET | `/api/health` | Backward-compatible health summary. Public. |\n| GET | `/api/health/live` | Liveness. |\n| GET | `/api/health/ready` | Readiness; 503 for required service failure/shutdown. |",
        "| POST | `/api/rtc/livekit-token` | `{roomId}`. Available only when LiveKit is configured. |": "| POST | `/api/rtc/livekit-token` | `{roomId}`; active member; 60-second audience/microphone-only grant when configured. |\n| POST | `/api/rtc/livekit-webhook` | Official SDK verifies signed original application/webhook+json body/hash; reconciles membership/grants. |",
    }
    for old, new in replacements.items():
        if old not in source:
            raise ValueError(f"API reference changed; review replacement: {old}")
        source = source.replace(old, new)
    source += """

## Rebuild protocol additions

Online room codes are exactly seven characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, case-insensitive after trim. Nearby codes remain four characters under the native local contract. Legacy cloud access tokens need fresh sign-in; online database operations require replica-set transactions.

Chat `clientMessageId` is 8–80 ASCII letters/numbers/underscore/hyphen and is scoped to sender/room/channel/target. A retry with changed content is rejected. Use the returned composite timestamp/ID cursor for stable pagination. Reconnect subscribes again and refreshes confirmed history/media/state; socket subscriptions do not create REST membership.

Playback `expectedSequence` rejects stale commands; heartbeat `sequence` rejects old reports. Optional `startAtServerMs` schedules within the next three seconds. Returned clock/server timestamps and sequence remain authoritative; clients do not seek while unloaded/buffering. See source tests for races and docs/DEVICE_VALIDATION.md for native drift validation.

External URL payloads use `{url,title,type,mimeType?,durationMs?,drmScheme?,drmLicenseUrl?,drmCertificateUrl?,drmContentId?}`. FairPlay requires licensed certificate/content ID/license; Widevine is Android-only, FairPlay iOS-only, DASH Android-only. Unsupported website pages/DRM/platform combinations return explicit errors. Provider validation does not fetch third-party URLs. See MEDIA_PROVIDERS.md.

RTC config now selects the actual mobile LiveKit implementation when configured; otherwise mesh is bounded to six members by client policy. SFU server revocation/cutoff must pass real audio tests before release. See SFU.md and KNOWN_LIMITATIONS.md.
"""
    file.write_text(source, encoding="utf-8")
    file = ROOT / "docs/THIRD_PARTY.md"
    source = file.read_text(encoding="utf-8")
    source = source.replace("MongoDB 7/8", "MongoDB replica set (8.0 tested)")
    source = source.replace("Backend-issued SFU tokens", "Optional mobile/server SFU voice")
    source = source.replace("The mobile client currently uses mesh WebRTC, not a LiveKit client SDK. The token endpoint is available for a future/other client.", "Actual mobile LiveKit SDK transport and server enforcement are implemented; real server/audio verification remains pending. Mesh is the configured fallback.")
    source = source.replace("Widevine/PlayReady/FairPlay/ClearKey license issuance", "Authorized Widevine/FairPlay license issuance")
    source = source.replace("| `react-native-webrtc` | Mesh voice calls |", "| `@livekit/react-native-webrtc` | Single native WebRTC fork for mesh and SFU |\n| `@livekit/react-native`, `livekit-client` | Actual optional SFU client and native audio-session routing |")
    source = source.replace("| `livekit-server-sdk` | Optional LiveKit token generation |", "| `livekit-server-sdk` | Optional SFU token/grants/revocation and signed webhook validation |\n| `@aws-sdk/client-s3` | Optional private S3-compatible streamed media storage |")
    file.write_text(source, encoding="utf-8")
    file = ROOT / "docs/DEVELOPMENT.md"
    source = file.read_text(encoding="utf-8")
    source = source.replace("WebRTC mesh VoiceEngine", "mesh/SFU VoiceEngine and LiveKitVoiceEngine")
    source = source.replace("Password changes and `logout-all` revoke all refresh sessions.", "Password changes and `logout-all` revoke all access/refresh sessions and active sockets.")
    source = source.replace("Navigation is auth-gated. Invite links are queued until sign-in; onboarding completion routes to Login.", "Online navigation is auth-gated. Invite links wait for sign-in; Login also offers local-only NearbyGuest without cloud credentials.")
    source = "# Current rebuild development notes\n\nSee [deployment](../DEPLOYMENT.md), [test evidence](../TEST_REPORT.md), [nearby](NEARBY.md), [media providers](MEDIA_PROVIDERS.md) and [SFU](SFU.md) for current behavior. The original design notes below remain useful; the linked protocol reports take precedence where behavior has been repaired.\n\n" + source
    file.write_text(source, encoding="utf-8")


if __name__ == "__main__":
    main()
