# VibeSync setup and deployment

This source build is production-oriented. Read `TEST_REPORT.md` and `KNOWN_LIMITATIONS.md` before deployment; unverified native/device acceptance gates prevent a production-ready claim.

## Development

Use Node 20.19+ (Node 22 LTS recommended), npm, Docker Compose, JDK17 and Android SDK36. iOS needs macOS/Xcode/CocoaPods. Install exactly the lockfiles:

```sh
npm ci --prefix services/api
npm ci --prefix apps/mobile --legacy-peer-deps
cp services/api/.env.example services/api/.env
cp apps/mobile/.env.example apps/mobile/.env
docker compose up -d mongo mongo-init redis
npm --prefix services/api run dev
```

PowerShell uses `Copy-Item` for copies. Mongo is a single-node `rs0` replica set; standalone Mongo is unsupported because membership, playback and refresh rotation require transactions. Docker's internal host is `mongo:27017`. For an API running directly on the host, use a local replica set accessible by the host or a managed Mongo replica-set URI; default Compose does not publish database ports. To run the API inside the development stack use `docker compose up -d --build` and connect through `127.0.0.1:4000`/`adb reverse tcp:4000 tcp:4000`.

For a native phone connected over LAN, expose development port 4000 on the intended private interface using an explicit Compose port override, or run the API locally and set `VIBESYNC_DEV_HOST` to that machine's private IP. Do not expose a production API without TLS. Run `npm --prefix apps/mobile run configure` before Metro/build.

## Staging and production

Use distinct databases, buckets, secrets and domains per environment. Staging uses the same production overlay with its own `.env.production` and API environment file. No paid vendor is mandatory: MongoDB, Redis, coturn and optional LiveKit can be self-hosted. VM/storage/bandwidth and app-store developer accounts incur provider-dependent costs.

```sh
cp PRODUCTION_ENV.example services/api/.env
cp deploy/compose.env.example .env.production
mkdir -p deploy/secrets
openssl rand -base64 756 > deploy/secrets/mongo-keyfile
chmod 600 deploy/secrets/mongo-keyfile services/api/.env .env.production
```

Replace every placeholder. Generate separate 32-byte random hex values for JWT access/refresh, Mongo root/app, Redis and coturn. Hex passwords avoid URI escaping errors. Keep the Mongo keyfile and signing/cloud keys outside version control. The overlay uses a readWrite-only app database account, authenticates Mongo/Redis, keeps the API bound to loopback and adds container restrictions. A single-node replica set supports transactions but does not provide production high availability; use at least three appropriately placed replicas or a managed replicated cluster for that requirement.

```sh
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.production.yml exec api node scripts/migrate.js
```

Run migration with ingress closed on upgrades. It reconciles membership counters, creates indexes and removes only the obsolete `Room.expiresAt` TTL that could delete active rooms. Existing legacy access tokens require a new sign-in. Take a backup before any upgrade. Existing development volumes need an explicit authenticated migration; enabling auth over populated unauthenticated data does not automatically create Mongo users.

## TLS and networking

Use `deploy/Caddyfile.example` or `deploy/nginx.conf.example` on the host with the API at `127.0.0.1:4000`. Set real DNS, HTTPS public origins and a precise CORS list. `TRUST_PROXY=true` is one trusted hop; never make the direct API port publicly reachable. Reverse proxy must support WebSocket upgrade, upload limits and long-lived playback connections. Check `/api/health/live` for liveness and `/api/health/ready` for readiness. Readiness is 503 during database/required Redis failure or shutdown.

Deploy `deploy/assetlinks.json.example` and `deploy/apple-app-site-association.example` under the HTTPS website's `.well-known` paths with your actual app identifiers and signing fingerprints. Custom `vibesync://room/CODE` invites work through the app; verified App/Universal Links need deployment association files and iOS entitlement configuration.

## Media storage

`MEDIA_STORAGE_DRIVER=local` stores uploads in a persistent private volume. For multiple API replicas, mount the same filesystem on every replica. `MEDIA_STORAGE_DRIVER=s3` uses an optional S3-compatible private bucket with `S3_BUCKET`, `S3_REGION`, optional HTTPS `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` and credentials/standard AWS chain. Temporary upload space is still required. Use least-privilege bucket credentials, provider encryption and lifecycle/backup policy. Membership-authorized API Range streaming remains the access boundary; never publish the upload directory/bucket. Real S3/cloud connectivity remains unverified until configured and tested.

External URL providers describe actual supported direct MP4/audio/HLS and Android DASH sources. Unsupported website pages return a provider error. VibeSync does not scrape or extract protected third-party content. Authorized DRM requires compatible native platform and complete provider licensing configuration; test with legitimate credentials before enabling it.

## Voice, TURN and optional SFU

Install coturn using `deploy/turnserver.conf.example`; set a public address, TLS certificate where used and the same secret as API `TURN_SECRET`. Open TCP/UDP3478, optional TCP/UDP5349 and the selected UDP relay range. Test relay-only ICE from a cellular network. STUN-only success on Wi-Fi does not establish TURN reliability.

Small-room mesh uses the native WebRTC engine. Optional LiveKit SFU configuration is described in `docs/SFU.md`; enable it only after mobile SDK/native, publication/subscription, host moderation and routing tests. Room participant capacity and actual audio behavior require device measurements, regardless of backend token issuance.

## Operations and scaling

Keep Mongo, Redis and object storage private. API replicas require shared Redis for Socket.IO/presence and shared durable media. Socket clients use WebSocket transport; load balancer timeouts and health checks must preserve long-lived connections. Any HTTP long-polling client requires sticky routing.

REST/auth/socket connection limits are per API process; Redis coordinates chat limits. Configure an aggregate ingress/edge policy across API replicas. The Nginx template supplies a single-ingress IP budget; multiple ingresses require a shared edge policy. S3 and Mongo do not share a transaction, so configure bucket lifecycle/audited orphan cleanup for crashes between object upload and metadata commit.

Ship Pino JSON logs to the operator's collector; redact credentials and do not log private message bodies/media URLs. Monitor readiness, API p95/error rates, Redis connectivity, Mongo pool/transaction failures, disk/bucket capacity and native crash reports. No managed monitoring account is silently provisioned.

Back up Mongo with authenticated `mongodump --archive --gzip` using a secret-provided URI, and snapshot the local volume or private bucket on the same retention schedule. Encrypt backups and test `mongorestore` in isolated staging. Redis AOF is configured; Redis is coordination, not primary media/chat storage. Before rollout keep the previous image and backup. On rollback restore a compatible image/schema; do not use an invented Compose service name as an image argument.

CI under `.github/workflows/verify.yml` installs locks, runs JS tests/lint, checks dependencies, bundles mobile and builds Android/iOS on their supported runners. The committed workflow is not evidence of a successful remote run. Store unsigned CI artifacts separately; release signing credentials belong in protected CI secrets or developer keychains.

## Build guides and release gates

- `docs/ANDROID_BUILD.md`, `docs/IOS_BUILD.md`
- `SECURITY_CHECKLIST.md`, `docs/DEVICE_VALIDATION.md`
- `AUDIT_REPORT.md`, `TEST_REPORT.md`, `PERFORMANCE_REPORT.md`, `KNOWN_LIMITATIONS.md`

Use trusted Wi-Fi/WPA2/WPA3 for nearby HTTP. BLE carries discovery metadata; Wi-Fi/hotspot carries media. Local tokens protect admission/access but do not encrypt the LAN. Wi-Fi Direct, MultipeerConnectivity and Auracast are not claimed as implemented transports.
