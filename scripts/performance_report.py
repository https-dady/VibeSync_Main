"""Format measured benchmark evidence and clearly separate physical targets."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    args = parser.parse_args()
    before = json.loads(Path(args.before).read_text(encoding="utf-8-sig"))
    after = json.loads(Path(args.after).read_text(encoding="utf-8-sig"))
    text = """# VibeSync performance report

These are actual loopback API/Socket.IO measurements from the supplied source and rebuilt source. They are not phone playback/discovery benchmarks. Node, client and API run on one Windows host with ephemeral MongoDB; Redis and test-mode rate limits are disabled. Twenty independent authenticated socket clients were used. Small sample sizes and one-host timing are insufficient to establish production capacity or internet p95.

The original harness used standalone MongoDB; the rebuilt harness uses a replica set to exercise the required transactions. This is a comparison of the two actual application designs, not an isolated hardware benchmark. Increased join/chat latency is reported directly; no speedup is claimed for added authorization and transactional correctness.

## Before / after measured timings

| Metric | Samples before/after | Before p50 ms | After p50 ms | Before p95 ms | After p95 ms |
| --- | --- | --- | --- | --- | --- |
"""
    for name, metric in after["metrics"].items():
        old = before["metrics"].get(name, {})
        text += f'| {name} | {old.get("count", 0)}/{metric["count"]} | {old.get("p50_ms", "—")} | {metric["p50_ms"]} | {old.get("p95_ms", "—")} | {metric["p95_ms"]} |\n'
    text += "\nTransactions/session revocation can add measured overhead while preventing races; faster timings are not used to excuse inconsistent membership. Reconnect timing explicitly disconnects/reconnects a Socket.IO client and resubscribes; it does not include mobile NetInfo/backoff or lost-radio delay. Chat timing is sender request through listener event/ack on loopback, not human UI display latency.\n\n## Independent client counts\n\n| Clients | Before reported membership | After reported membership | After count consistent |\n| --- | --- | --- | --- |\n"
    for current in after["capacity"]:
        old = next((item for item in before["capacity"] if item["simulated_clients"] == current["simulated_clients"]), {})
        text += f'| {current["simulated_clients"]} | {old.get("reported_members", "—")} | {current["reported_members"]} | {current["membership_consistent"]} |\n'
    text += "\nThis validates server clients only. Tested physical nearby/voice participant capacity remains UNVERIFIED for 2, 5, 10 and 20 phones.\n\n## Process/resource evidence\n\n"
    for label, result in [("Before", before), ("After", after)]:
        process = result["node_process"]
        text += f'- {label}: Node {result["node"]}; run {result["duration_ms"]}ms; combined client/server Node CPU user {process["cpu_user_ms"]}ms/system {process["cpu_system_ms"]}ms; RSS {process["rss_bytes"]} bytes; heap {process["heap_used_bytes"]} bytes; sampled response JSON {result["sampled_response_json_bytes"]} bytes.\n'
    text += """
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
"""
    (ROOT / "PERFORMANCE_REPORT.md").write_text(text, encoding="utf-8")
    target = ROOT / "docs" / "performance"
    target.mkdir(parents=True, exist_ok=True)
    for name, result in [("before.json", before), ("after.json", after)]:
        (target / name).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
