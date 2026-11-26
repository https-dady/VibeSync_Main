# Installation

Use the current [deployment/setup guide](../DEPLOYMENT.md), [Android guide](ANDROID_BUILD.md) and [iOS guide](IOS_BUILD.md). Run locked npm ci installs, configure environment templates and initialize Mongo rs0. Standalone Mongo is unsupported in this rebuild.

Default Compose API port4000 is loopback-only. adb reverse supports a USB Android development phone; a physical iPhone/LAN phone needs an explicit private LAN API address. BLE/local media still requires phones on a shared router or existing hotspot. See [device validation](DEVICE_VALIDATION.md) and [limitations](../KNOWN_LIMITATIONS.md).
