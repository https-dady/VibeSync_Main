# Security release checklist

Implemented controls and remaining release checks are distinguished below. See AUDIT_REPORT.md and TEST_REPORT.md for evidence.

## Implemented controls

- Validated REST/socket payloads, authenticated membership and host authorization.
- Atomic membership and refresh rotation, reuse detection, access-session revocation.
- OS Keychain/Keystore storage, release HTTPS API validation and server-origin switching clears credentials.
- Private media authorization for Range/HEAD; MIME/signature/size checks; provider and URL validation.
- Local cryptographic session tokens, bounded connections and session expiry.
- Scoped message idempotency and host-only moderation.
- Explicit production origins, random secret templates, structured logs, readiness/draining checks.
- Authenticated/private Mongo/Redis deployment overlay, API loopback binding, non-root container.

## Operator release gates

- [ ] Generate distinct JWT secrets, Mongo app/root passwords, Redis password and coturn secret.
- [ ] Restrict credentials/files to service users; no actual .env, signing key or cloud credentials in repository/archive.
- [ ] Deploy HTTPS/WSS, verify exact reverse-proxy trust and disable public API/database bypass ports.
- [ ] Use an authenticated Mongo replica set with backup/restore drills; run migration before accepting traffic.
- [ ] Keep S3 bucket private, configure encryption/lifecycle policy and test authenticated Range/deletion.
- [ ] Test TURN-only media traversal; deny TURN relay access to private/internal IP ranges.
- [ ] Validate SFU grants/revocation on real server and phones before enabling it for users.
- [ ] Audit deployment dependency report; resolve any remaining high severity dependencies before release.
- [ ] Validate native microphone/Bluetooth/local-network permissions and store privacy disclosures.
- [ ] Treat nearby HTTP as trusted-LAN transport. Bearer tokens do not encrypt LAN traffic or stop a passive sniffer.
- [ ] Measure BLE/local media/audio routing, device capacity and decoder drift; do not advertise untested limits.
- [ ] Review data retention, recovery/reporting requirements, user privacy policy and media licensing for the intended market.

Nearby room-code admission is pairing assistance, not encrypted authentication against a hostile LAN. Account recovery/email verification/MFA/push delivery require additional product/service integrations and remain documented limitations.
