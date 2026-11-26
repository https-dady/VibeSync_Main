# Backend setup

Use Node 20.19+ (22 LTS recommended), install `npm ci --prefix services/api`, and copy `services/api/.env.example` to `services/api/.env`. Configure a Mongo replica-set URI and separate random JWT access/refresh secrets. Start with `npm --prefix services/api run dev`; production uses `npm --prefix services/api start` behind HTTPS/WSS ingress.

The repository Compose stack starts API, initialized Mongo rs0 and Redis with `docker compose up -d --build`. Its API listens on loopback port 4000. For a USB Android development phone use `adb reverse tcp:4000 tcp:4000`; private LAN development needs an explicit interface/port override. Run `npm --prefix apps/mobile run configure` after changing mobile environment.

Run `npm --prefix services/api test` and `npm --prefix services/api run lint`. Tests use isolated ephemeral MongoDB, not your production database. `/api/health/live` checks liveness; `/api/health/ready` returns 503 when required infrastructure or shutdown prevents service.

See [deployment](../DEPLOYMENT.md) for authenticated staging/production, migration, TLS, media storage, backup and scaling; [MongoDB](MONGODB_SETUP.md), [Redis](REDIS_SETUP.md), [TURN](TURN_SETUP.md) and [SFU](SFU.md) for infrastructure. Deployment execution is UNVERIFIED until run in your environment.
