# Device end-to-end checks

Install Maestro separately on a supported host, build/install VibeSync, then run `maestro test .maestro/login-errors.yaml` from the repository root. The login smoke test checks actual native validation UI. It has not been executed here because no device/emulator is connected.

Use `docs/DEVICE_VALIDATION.md` for authenticated multi-client, BLE, hotspot, voice and media tests. Credentials and deployment endpoints must be supplied by the operator; these files do not contain accounts or mock login endpoints.
