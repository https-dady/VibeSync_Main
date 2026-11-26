# MongoDB setup

Atomic joins, playback and token rotation require a replica set or sharded Mongo cluster. MongoDB 8.0.14 is used by the isolated integration tests. Standalone Mongo is unsupported.

For development, copy the API environment template and run `docker compose up -d mongo mongo-init`. `deploy/mongo-init.js` initiates `rs0`, waits for a primary and is repeatable. Containers use `mongodb://mongo:27017/vibesync?replicaSet=rs0`; the private hostname is not a direct host-machine URI. Run the API in Compose or configure a separately reachable local/managed replica-set URI. Database ports are not public by default.

For production follow the root deployment guide and authenticated Compose overlay. Generate a private Mongo replica keyfile and distinct root/app passwords. Initialization creates a `readWrite` app user in `vibesync`. Use that account in the API URI, with `replicaSet=rs0&authSource=vibesync`. Existing development volumes require an explicit authenticated migration; enabling auth does not retroactively create users.

Before upgrade, close ingress and take an encrypted backup. Run `npm --prefix services/api run migrate` with the target environment, or the documented Compose exec command. It reconciles membership counters, creates indexes and removes obsolete room TTL indexes. Test restore/migration in staging before production. One-node rs0 supports transactions but has no high availability; use a properly replicated service for production availability. Never publish Mongo ports or credentials in source.
