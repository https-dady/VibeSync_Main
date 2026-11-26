# VibeSync mobile

React Native0.81.6/React19, JavaScript, Android Kotlin and iOS Swift. See repository [README](../../README.md), [Android build](../../docs/ANDROID_BUILD.md), [iOS build](../../docs/IOS_BUILD.md) and [TEST_REPORT](../../TEST_REPORT.md).

```sh
npm ci --legacy-peer-deps
npm run configure
npm start
npm test -- --runInBand
npm run lint
```

Copy .env.example to .env and configure HTTPS release origins. Run npm run configure:release before release compilation. All21 screens use the shared VibeSync visual system; native screenshots/audio/radio verification remains separate. Device sign-in/account credentials and release signing keys are not included.
