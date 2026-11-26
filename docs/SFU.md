# LiveKit voice deployment and verification

The mobile client now selects the implemented LiveKit SDK when `/api/rtc/config` reports `voiceTransport=livekit`; unset LiveKit configuration retains WebRTC mesh. Mesh should be limited to six room participants by the client; no six-device audio benchmark has been run here. SFU capacity is deployment-dependent and unbenchmarked.

Configure `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in the API environment. Use WSS/HTTPS and a current compatible LiveKit deployment. Configure the LiveKit server webhook URL to `https://YOUR_API/api/rtc/livekit-webhook`, with the same API key used for webhook signing. The endpoint verifies the original body against the official SDK signature and SHA256 hash. Reverse proxies must forward this endpoint unchanged. A self-hosted LiveKit service is possible; managed cloud is optional and may incur usage charges.

For self-hosting, copy `deploy/livekit.yaml.example` to a private server configuration, replace all keys/addresses, and run the official `livekit-server --config /path/to/livekit.yaml` distribution on a public host. Pin and record the exact server version you validate. Port 7880 requires an HTTPS/WSS reverse proxy; allow RTC TCP 7881 and UDP 50000–60000 only where configured. The Redis address in the template assumes shared private infrastructure; adjust it for your actual network. Use separate staging/production keys and webhook URLs. This template has not been deployed here and is not a claim that an arbitrary server version supports token revocation.

Membership and mic grants come from MongoDB. The API issues60-second microphone-only tokens to approved speakers and subscription-only tokens to listeners. It does not grant roomAdmin or video/data publication. Mic approval updates a connected participant through RoomServiceClient; mobile permission events trigger fresh-token connection/publish handling. Revocation/kick/leave uses timestamped removeParticipant and a persisted cutoff; room end deletes the SFU room. API operations report503if the SFU cannot confirm enforcement. A five-second reconciliation task corrects participants whose database access differs from the SFU.

The installed server SDK exposes `removeParticipant(...,{revokeTokenTs})`. The deployed LiveKit server must support this revocation option; SDK availability alone does not prove that the server applies it. Tokens from before a cutoff must fail to reconnect in acceptance tests. If the server ignores the cutoff, bearer reuse can persist until60-second token expiry for new joins. Webhook/poll reconciliation helps after arrival, but cannot promise no transient unauthorized audio or recovery during server/API outages. Existing SFU sessions are not ended simply by JWT expiry. These behaviors remain UNVERIFIED and block a production-ready claim.

Required real-service/device validation:

1. Two Android/iOS users join a configured SFU, subscribe to actual audio and exchange microphone tracks.
2. Test mute/unmute, approval, speaker/headphone/Bluetooth routes and interruptions.
3. Revoke/kick a speaker while audio is live; confirm tracks stop and captured pre-revocation tokens cannot rejoin/publish.
4. End the room; confirm old tokens cannot recreate access and signed participant_joined webhooks enforce MongoDB status.
5. Disconnect SFU/API/network, verify observable errors, readiness503and recovery without duplicate tracks.
6. Test TURN/UDP/TCP/TLS relay fallback on restrictive networks; benchmark2/5/10/20devices before documenting capacity.

Local automated evidence: official SDK webhook signature/body integrity checks pass. No real SFU audio, TURN relay, server token revocation or physical route test was executed in this environment.
