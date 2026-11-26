# iOS build

iOS requires macOS, Xcode, CocoaPods and Node20.19+. Windows cannot compile or validate the actual Swift/UIKit/CoreBluetooth runtime.

```sh
npm ci --prefix apps/mobile --legacy-peer-deps
cp apps/mobile/.env.example apps/mobile/.env
node apps/mobile/scripts/apply-env.js --production
cd apps/mobile
bundle install
cd ios
bundle exec pod install
xcodebuild -workspace VibeSync.xcworkspace -scheme VibeSync -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

For release, open the workspace in Xcode, set your team/bundle ID and Archive. Supply legitimate App Store signing/capabilities. Add Associated Domains for your deployed website and serve the association file. Verify Bluetooth, local-network and microphone purpose strings and included privacy resources against the final linked SDKs.

Test physical iPhone foreground BLE advertising/GATT, router/Android hotspot joining, media/audio routes and any SFU SDK. iOS cannot programmatically create a hotspot, and background suspension can interrupt a nearby host. DASH is not supported by AVPlayer; use a supported HLS/MP4 alternative. Licensed FairPlay requires the complete certificate/content-ID/license setup. Current build/device evidence appears in TEST_REPORT.md; CI configuration alone is not verification.
