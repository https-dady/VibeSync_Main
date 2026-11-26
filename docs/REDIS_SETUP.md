# Redis setup

Run `docker compose up -d redis` for private development Redis, with `REDIS_URL=redis://redis:6379` inside Compose. Single-instance development can omit Redis; multiple API instances require shared Redis for Socket.IO fan-out, presence and chat limits. REST/auth/connection limit windows remain per process; apply aggregate ingress/edge limits for multiple APIs.

Production overlay requires a generated `REDIS_PASSWORD` in the private Compose environment and a matching API URL. It enables AOF persistence and keeps ports inside the Compose network. Use a managed/private replicated deployment where availability requires it; authenticate and use TLS for remote Redis links. Never expose unauthenticated Redis publicly.

Required Redis failure is reflected in API readiness. Validate restart, disconnect, reconnect, per-socket presence expiry and two-instance Socket.IO fan-out in staging. Source logic and automated local boundaries are tested; real Redis failover/multi-instance behavior remains UNVERIFIED. MongoDB is the durable chat/media metadata store; Redis is coordination/cache. See root DEPLOYMENT.md for backup/monitoring/rollout.
