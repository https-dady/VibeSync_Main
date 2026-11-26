# VibeSync performance report

These are actual loopback API/Socket.IO measurements from the supplied source and rebuilt source. They are not phone playback/discovery benchmarks. Node, client and API run on one Windows host with ephemeral MongoDB; Redis and test-mode rate limits are disabled. Twenty independent authenticated socket clients were used. Small sample sizes and one-host timing are insufficient to establish production capacity or internet p95.

The original harness used standalone MongoDB; the rebuilt harness uses a replica set to exercise the required transactions. This is a comparison of the two actual application designs, not an isolated hardware benchmark. Increased join/chat latency is reported directly; no speedup is claimed for added authorization and transactional correctness.

## Before / after measured timings

| Metric | Samples before/after | Before p50 ms | After p50 ms | Before p95 ms | After p95 ms |
| --- | --- | --- | --- | --- | --- |
| registration | 20/20 | 192.73 | 203.31 | 218.89 | 210.09 |
| login | 8/8 | 191.12 | 201.87 | 195.89 | 207.53 |
| room_create | 4/4 | 9.24 | 13.14 | 19.96 | 27.33 |
| join_2_clients | 1/1 | 24.78 | 45.89 | 24.78 | 45.89 |
| chat_2_clients | 5/5 | 4.16 | 10.05 | 5.83 | 11.95 |
| socket_reconnect | 4/4 | 12.13 | 16.98 | 14.39 | 27.53 |
| join_5_clients | 4/4 | 46.66 | 70.4 | 46.72 | 85.38 |
| chat_5_clients | 5/5 | 3.88 | 7.8 | 4.46 | 10.06 |
| join_10_clients | 9/9 | 98.29 | 190.76 | 99.65 | 225.06 |
| chat_10_clients | 5/5 | 4.45 | 7.74 | 4.55 | 9.81 |
| join_20_clients | 19/19 | 175.59 | 471.26 | 185.78 | 600.28 |
| chat_20_clients | 5/5 | 3.58 | 6.76 | 4.32 | 9.53 |
| clock_roundtrip | 10/10 | 0.08 | 0.95 | 0.66 | 1.88 |

Transactions/session revocation can add measured overhead while preventing races; faster timings are not used to excuse inconsistent membership. Reconnect timing explicitly disconnects/reconnects a Socket.IO client and resubscribes; it does not include mobile NetInfo/backoff or lost-radio delay. Chat timing is sender request through listener event/ack on loopback, not human UI display latency.

## Independent client counts

| Clients | Before reported membership | After reported membership | After count consistent |
| --- | --- | --- | --- |
| 2 | 2 | 2 | True |
| 5 | 5 | 5 | True |
| 10 | 10 | 10 | True |
| 20 | 20 | 20 | True |

This validates server clients only. Tested physical nearby/voice participant capacity remains UNVERIFIED for 2, 5, 10 and 20 phones.

## Process/resource evidence

- Before: Node v24.18.1; run 6498ms; combined client/server Node CPU user 6172ms/system 141ms; RSS 187723776 bytes; heap 81815856 bytes; sampled response JSON 10470 bytes.
- After: Node v24.18.1; run 7770ms; combined client/server Node CPU user 6938ms/system 390ms; RSS 247705600 bytes; heap 103648904 bytes; sampled response JSON 10966 bytes.

The memory sample is one final process observation, not a leak/peak memory profile. JSON bytes exclude WebSocket protocol, retransmits, Mongo traffic and media. Mongo child-process CPU is not included. No native CPU, OS network usage or battery result is fabricated.

## Physical-device performance goals and unverified metrics

| Metric | Initial engineering target / measurement | Current evidence |
| --- | --- | --- |
| Cold app launch | p95 ≤3s on declared supported reference device, 30 cold starts | UNVERIFIED |
| Login | End-to-end UI p95 ≤3s on healthy 100ms RTT path | API loopback measured; UI/network UNVERIFIED |
| Online joining | p95 ≤3s after valid code; errors/loading bounded | API+subscription measured; phone/internet UNVERIFIED |
| Nearby discovery | p95 ≤10s foreground with permissions; explicit 30s scan deadline | Native source fixed; BLE timing UNVERIFIED |
| Nearby joining | p95 ≤3s stable LAN; 8s request timeout and visible retry | HTTP helper tests; real LAN UNVERIFIED |
| Media startup | p95 ≤5s compatible MP4/HLS on declared bandwidth/codec | Decoder/CDN UNVERIFIED |
| Buffering | Record startup and rebuffer counts/duration per bitrate/network; no arbitrary increased timeout claim | UNVERIFIED |
| Playback drift | Warm stable LAN p95 ≤150ms; healthy internet p95 ≤300ms as goals, measured acoustically | UNVERIFIED; current soft/hard corrections remain 120/850ms |
| Network recovery | UI p95 ≤10s after reachability returns, with bounded retry | Server reconnect measured; mobile/radio UNVERIFIED |
| Chat delivery | p95 ≤500ms healthy network; explicit failed/retry state | Server loopback measured; phone/internet UNVERIFIED |
| Device CPU/memory | Profile idle vs playback/voice over 30min; establish per-reference-device peak/steady-state budget | UNVERIFIED |
| OS network use | Measure bytes/sec for source bitrate and participant count, TURN/SFU separately | UNVERIFIED |
| Battery impact | Controlled 60min baseline vs playback/voice with fixed brightness/output | UNVERIFIED |

Goals are release criteria to test, not promises. Scheduled starts/clock estimates cannot compensate for unknown decoder or Bluetooth output latency by themselves. No zero latency or frame-accurate claim is made.

## Reproduce and extend

Run `npm --prefix services/api run benchmark -- --output result.json` with dev dependencies installed. Raw before/after JSON lives in `docs/performance/`. Follow `docs/DEVICE_VALIDATION.md` for strong/weak Wi-Fi, Android hotspot, 100/300ms latency, 20/100ms jitter, 1/5% loss and 5/30s interruption tests. Those radio/decoder conditions have not been physically exercised here.
