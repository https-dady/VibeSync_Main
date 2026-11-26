# Media provider contract

`services/api/src/services/mediaProviders.js` validates and resolves source descriptors; `media.service.js` persists metadata and `SyncedMediaPlayer.js` checks platform capabilities before native playback. Providers resolve authorized direct URLs without scraping or contacting a media host on the backend.

| Provider | Formats | Platforms | Authentication / metadata | DRM and capabilities |
| --- | --- | --- | --- | --- |
| direct-video | MP4/M4V/MOV | Android/iOS, codec dependent | Public/provider-signed URL; user title/type/duration | Licensed platform-compatible DRM only; seekability needs actual seekable stream |
| direct-audio | MP3/M4A/AAC/WAV/FLAC | Android/iOS, codec dependent | Public/signed audio or podcast enclosure URL; user metadata | Native audio decode; duration may be unknown |
| direct-hls | M3U8 / HLS MIME | Android/iOS | Public/signed manifest and authorized segment access | Widevine Android/FairPlay iOS where content/player supports it |
| direct-dash | MPD / DASH MIME | Android | Public/signed manifest and authorized segments | Widevine where supported; iOS offers HLS/MP4 alternative |
| direct-android | WEBM/MKV/OGG/OGV | Android, codec dependent | Public/signed URL; user metadata | Native container/codec capability required |

Descriptors include provider ID, supportedPlatforms, authentication, drmRequired, synchronizedPlayback, seeking, metadataSource and urlResolution. Capability descriptors are eligibility checks, not a guarantee that a remote URL is reachable or a device supports the codec. Invalid URL/type/platform/DRM combinations fail with a provider error; native load failures remain visible with retry/recovery.

Authentication requiring arbitrary cookies, account credentials or provider-specific SDKs is not emulated. Provider-signed URLs can expire and need an operator/provider-authorized replacement. Podcast RSS/website pages are not audio URLs; supply an authorized enclosure stream. Metadata is user supplied; no remote scraping/probing, server proxy or protected content extraction is implemented.

YouTube, Netflix, Spotify, Apple Music, Prime Video and Disney+ pages require official authorized/licensed integration that permits the proposed external synchronized playback. They are rejected here with supported-file/direct-stream alternatives. No licensed provider account/credentials were supplied, so no unsupported integration is claimed. Never bypass paywalls, DRM or output protection.

For FairPlay supply `drmScheme=fairplay`, `drmLicenseUrl`, `drmCertificateUrl`, and `drmContentId` through an authorized provider. Widevine is Android-only; PlayReady/ClearKey are unsupported by the selected player. Cloud JWTs are not forwarded to third-party license URLs. The provider determines license authentication and rights; validate actual licensed media before enabling it.

Production requires HTTPS and may restrict hosts with `MEDIA_ALLOWED_HOSTS`. Literal private hosts and embedded URL credentials are rejected. Because native players perform DNS/redirects/segment loads, an allowlist and controlled provider origin are recommended for strict deployments. No backend URL-fetch SSRF surface is introduced by metadata validation.

Actual MP4/HLS/DASH/audio decode, segment buffering and DRM licenses remain UNVERIFIED without native devices and authorized media. See TEST_REPORT.md and DEVICE_VALIDATION.md.
