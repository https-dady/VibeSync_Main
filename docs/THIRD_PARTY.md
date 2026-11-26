# Third-party services and dependencies

VibeSync does not include accounts, credentials, API keys, or paid services. Everything below is either an open-source package or an operator-supplied service.

## Runtime services

| Service | Required | Used for | Configuration | Notes |
| --- | --- | --- | --- | --- |
| MongoDB replica set (8.0 tested) | Yes | Users, rooms, memberships, messages, media metadata, playback state, notifications, refresh sessions | `MONGODB_URI` | MongoDB Community Server uses the SSPL; verify the current license for your distribution and hosting model. Atlas has separate terms. |
| Redis 7 | Optional for one instance; required for multiple | Socket.IO adapter, presence, rate-limit state, playback cache | `REDIS_URL` | Redis licensing has changed across versions/distributions. Verify the license of the exact image or managed service you deploy. |
| STUN | Yes | NAT discovery for WebRTC | `STUN_URLS` | The default uses Google's public STUN servers. They are free but have no SLA; use your own or a provider for production. |
| TURN / coturn | Strongly recommended | Relay audio for symmetric NAT and mobile carriers | `TURN_URL`, `TURN_SECRET`, `TURN_USERNAME`, `TURN_CREDENTIAL`, `TURN_TTL_SECONDS` | Self-host coturn with `deploy/turnserver.conf.example`, or use a managed TURN provider. You pay for relay bandwidth. |
| LiveKit | Optional | Optional mobile/server SFU voice | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Actual mobile LiveKit SDK transport and server enforcement are implemented; real server/audio verification remains pending. Mesh is the configured fallback. Review LiveKit Cloud or self-hosted terms. |
| DRM license provider | Optional, content-specific | Authorized Widevine/FairPlay license issuance | Media `drmScheme` + `drmLicenseUrl` | The provider must authorize your content and domains. VibeSync never bypasses DRM/HDCP or supplies licenses itself. |

`PUBLIC_WEB_URL` should point at the origin that serves invite landing pages and app-link verification files. `API_PUBLIC_URL` should point at the TLS API.

## Backend packages

Direct dependencies from `services/api/package.json`:

| Package | Purpose |
| --- | --- |
| `express` | HTTP API and landing page |
| `mongoose` | MongoDB models and validation |
| `socket.io`, `@socket.io/redis-adapter` | Realtime transport and multi-instance fan-out |
| `redis` | Redis client |
| `jsonwebtoken`, `bcryptjs` | JWT auth and password hashing |
| `zod` | Request/environment validation |
| `multer`, `mime-types` | Upload handling and media MIME detection |
| `helmet`, `cors`, `compression`, `express-rate-limit` | HTTP hardening, CORS, compression, rate limits |
| `pino`, `pino-http` | Structured logs |
| `dotenv` | Local environment loading |
| `livekit-server-sdk` | Optional SFU token/grants/revocation and signed webhook validation |
| `@aws-sdk/client-s3` | Optional private S3-compatible streamed media storage |

Development-only: `jest`, `supertest`, `socket.io-client`, `mongodb-memory-server`, `eslint`, `globals`, `@eslint/js`. `mongodb-memory-server` downloads a MongoDB binary on first test run.

## Mobile packages

Direct dependencies from `apps/mobile/package.json`:

| Package | Purpose |
| --- | --- |
| `react`, `react-native` | Application runtime |
| `@react-navigation/native`, `native-stack`, `bottom-tabs` | Navigation |
| `react-native-screens`, `react-native-safe-area-context`, `react-native-gesture-handler` | Navigation/native UI support |
| `axios` | REST client and refresh handling |
| `socket.io-client` | Realtime client |
| `react-native-keychain` | OS keychain/keystore token storage |
| `@react-native-async-storage/async-storage` | Non-sensitive local preferences/history |
| `@react-native-community/netinfo` | Connectivity state |
| `react-native-video` | Synchronized audio/video playback, HLS/DASH, DRM metadata, fullscreen |
| `@livekit/react-native-webrtc` | Single native WebRTC fork for mesh and SFU |
| `@livekit/react-native`, `livekit-client` | Actual optional SFU client and native audio-session routing |
| `@react-native-documents/picker` | Local media selection for upload and nearby hosting |
| `@react-native-community/slider` | Playback seeking |
| `react-native-svg`, `react-native-qrcode-svg` | Icons and invite QR codes |

Android-specific native library: NanoHTTPD 2.3.1 (`org.nanohttpd:nanohttpd`), used by the nearby local HTTP server. iOS uses Apple's `Network` and `CoreBluetooth` frameworks, so no extra runtime dependency is needed.

Review each package's license and advisories before distribution. The repository does not vendor a `LICENSES` bundle.

## Development and deployment tools

| Tool | Purpose |
| --- | --- |
| Node.js / npm | Runtime and package management |
| Docker / Docker Compose | API, MongoDB, Redis deployment |
| Caddy or Nginx | TLS termination and reverse proxy |
| coturn | TURN relay |
| Android Studio / Gradle | Android build and signing |
| Xcode / CocoaPods | iOS build and signing |
| MongoDB Memory Server | Isolated integration tests |
| GitHub or another git host | Source hosting, if used |

## Data leaving the device

- **Online rooms:** account/profile data, room and chat content, media metadata/files, playback state, device metadata, and signaling/voice through STUN/TURN. Data goes to the operator's API, MongoDB, Redis, and TURN service.
- **Nearby rooms:** room state and media stay on the local network; no VibeSync API or cloud service is contacted for the local session. OS-level Bluetooth/Wi-Fi behavior is controlled by Apple/Google.
- **Third-party media URLs:** the native player contacts the configured media host or DRM license server directly. Those providers receive normal HTTP metadata such as IP address and user agent.
- **No analytics, ads, crash reporting, or push provider** are integrated. If you add one, update the privacy disclosures and this document.

## Legal and compliance reminders

- Obtain the rights to every song, video, stream, and artwork you add.
- Do not use VibeSync to circumvent DRM, HDCP, paywalls, or access controls. Only connect legitimate license servers and authorized media.
- App store distribution requires your own developer accounts, signing keys, privacy policy, and store metadata.
- If you operate the service for others, determine whether you need DMCA/notice-and-takedown, privacy, consumer, or data-protection compliance in your jurisdiction.
- Public STUN/TURN, MongoDB, Redis, LiveKit, and DRM providers have their own acceptable-use and billing terms. This document is not legal advice.
