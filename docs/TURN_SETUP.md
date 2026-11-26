# TURN setup

Install coturn on a public host and copy `deploy/turnserver.conf.example` to a private configuration. Set the actual public IP/realm, relay port range and strong shared secret. Set matching API `TURN_SECRET`, `TURN_URL` and `TURN_TTL_SECONDS`; the API generates short-lived authenticated TURN credentials. Static username/credential configuration is also supported when your provider requires it.

Open TCP/UDP 3478, optional TLS 5349 with a valid certificate, and only the configured relay range. Retain the template's denied private/internal peer ranges to avoid turning the relay into an internal-network proxy. Put secrets outside source and restrict the service/config owner. For Linux service installations restart the `coturn` service after validating its configuration.

Test real audio with relay-only ICE from cellular and restrictive NAT networks, then UDP, TCP and TLS where configured. Record selected candidate type, relay bandwidth and reconnect failures. STUN success does not verify TURN. No physical/remote TURN test ran here; it remains UNVERIFIED. Self-hosting requires server/bandwidth; a paid managed TURN provider is optional. See SFU.md for LiveKit deployment and DEVICE_VALIDATION.md for the voice matrix.
