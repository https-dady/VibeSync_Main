# Required physical-device validation

Status: UNVERIFIED. No device measurements can be substituted with API or clock-algorithm tests.

## Evidence to record

Build revision, OS/version, device/codec, network topology, participant count, media bitrate/container, output route, timestamped logs, screen recordings and acoustic capture. Record p50/p95 and failures over at least 30 attempts for join/discovery/recovery. Store no credentials in test logs.

## Nearby matrix

For Android→Android, Android→iPhone, iPhone→Android and iPhone→iPhone on supported OS versions:

1. Host/join on one router, then an existing Android hotspot with cellular internet disabled.
2. Test Bluetooth off, permission denial, permission grant, scan cancellation, repeated refresh and GATT fallback.
3. Verify discovered rooms display correct code/name, remain present during announcements and expire after host termination.
4. Join manually using private host IP:port, wrong code, lost join response and retry.
5. Exercise 2, 5, 10 and 20 devices in ascending order. Stop advertising a higher capacity when failure rate or drift exceeds agreed tolerance.
6. Stream MP4/MP3 with seeking, multiple clients and disconnect mid-Range transfer. Monitor native memory and file cleanup.
7. Change host IP/DHCP, switch network, stop hotspot, lock/background host, terminate host, enable VPN and router isolation. Verify actionable error/cleanup.
8. Capture simultaneous scheduled audio starts using one recorder positioned equidistant from speakers. Compare impulses/waveforms; clock estimate is not acoustic latency.
9. Repeat using device speakers, wired headphones and Bluetooth headphones. Bluetooth output delay varies by device and is not controlled by BLE discovery.

## Online media and voice

Test direct MP4/MP3/HLS on Android/iOS and DASH on Android. Verify supported licensed DRM using actual license/certificate credentials; reject unsupported platform/provider paths. Run Wi-Fi, mobile network, added 100/300ms RTT, 20/100ms jitter, 1/5% packet loss and 5/30s disconnections.

Verify play/pause/seek/media switch, late joining, reconnect replay, stale commands, buffering health, clock adaptation and repeated player unmounts. Record decoder startup, buffer time and acoustic drift.

Exercise voice publication after host grant, mute/revoke/kick/end, receiver-only tokens, microphone denial, wired/Bluetooth/speaker routing, echo/noise and forced TURN relay. For SFU test actual connect/publish/subscribe and revocation through the deployed room service. Verify mute enforcement after client tampering and network failure.

## UI and release

Use every screen at font scale 1/1.3/2, 320–430px phones and 768px tablets, portrait/landscape, notches, keyboard, TalkBack and VoiceOver. Maestro smoke flows are included; full radio/audio tests need physical phones. Test signed release builds with deployed HTTPS/app-link association files, not only debug/emulator builds.
