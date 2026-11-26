# Android build

Use JDK17, Node20.19+, Android SDK36/build-tools36.0.0, NDK27.1.12297006 and CMake3.22.1. Install SDK packages and set ANDROID_HOME/local.properties. The project uses the included Gradle wrapper.

```sh
npm ci --prefix apps/mobile --legacy-peer-deps
cp apps/mobile/.env.example apps/mobile/.env
npm --prefix apps/mobile run configure
cd apps/mobile/android
./gradlew testDebugUnitTest assembleDebug
```

Windows: `gradlew.bat testDebugUnitTest assembleDebug`. Physical-device development can use `adb reverse tcp:4000 tcp:4000`; BLE/hotspot must still use actual radio/network configuration.

Before release set HTTPS `VIBESYNC_API_URL` and `VIBESYNC_WEB_URL` in mobile `.env` and run `node apps/mobile/scripts/apply-env.js --production`. Supply your upload signing key only through protected Gradle properties `VIBESYNC_UPLOAD_STORE_FILE`, `VIBESYNC_UPLOAD_STORE_PASSWORD`, `VIBESYNC_UPLOAD_KEY_ALIAS`, `VIBESYNC_UPLOAD_KEY_PASSWORD`. The archive includes no signing key. Unsigned release compilation can run without those properties; store upload requires real signing.

```sh
cd apps/mobile/android
./gradlew assembleRelease bundleRelease
```

Outputs: `app/build/outputs/apk/` and `app/build/outputs/bundle/`. Confirm BLE scan/connect/advertise runtime permissions on Android12+, microphone permission, local-network behavior and app links using the actual release build. Compare current TEST_REPORT.md for this environment's executed build status. A JavaScript bundle or JVM parser test is not a full Android build.
