# VibeSync API

Express5/Mongoose8/Mongo replica set/Socket.IO with optional Redis and private S3-compatible media. See root [deployment guide](../../DEPLOYMENT.md) and [test report](../../TEST_REPORT.md).

```sh
cp .env.example .env
npm ci
npm run dev
npm test
npm run lint
npm run benchmark -- --output result.json
```

Mongo standalone is unsupported. Set a replica-set URI and random JWT secrets. Run npm run migrate with ingress closed after a backup. /api/health/live is liveness; /api/health/ready checks readiness. Tests start real HTTP/Socket.IO and ephemeral Mongo replica sets. Online source behavior is tested independently from native phone playback.
