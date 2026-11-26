# Mobile screen and responsiveness audit

All 21 screens were traced through their imports, navigation actions, asynchronous state and shared layout components. This is source inspection and automated JavaScript validation. Native layout, keyboard, VoiceOver/TalkBack and screenshots on physical devices remain UNVERIFIED.

| Screen | Source findings and corrections | Required device validation |
| --- | --- | --- |
| Splash | Stop looping animation on unmount; shared text contrast | Cold launch and animation with reduced motion |
| Onboarding | Window width captured once; now recomputed on rotation, pages scroll vertically | 320px width, landscape, 200% text |
| Login | Prevent duplicate submit; validate API origin and HTTPS release; keyboard sheet scrolls | Keyboard, autofill, error retry |
| Registration | Duplicate submit guard; shared flexible input/button and scrolling | Long names and password autofill |
| Home | Stack narrow actions; full greeting wraps; use shared flexible room cards | Narrow phones, tablet, large text |
| Discover | Reject stale search responses and deduplicate pagination | Search while scrolling, keyboard |
| Create Room | Prevent double create; nearby starts entirely locally without creating orphan cloud room | Narrow steppers and keyboard |
| Join Room | Strict normalized codes/invites, bounded requests/approval state and retry | Deep-link entry and password keyboard |
| Room | Player state and recovery; host actions traced to authoritative commands | Native player, landscape, sheet, headset |
| Room Chat | Ordered optimistic deliveries and retry, stable merge on replay | Keyboard, pagination and auto-scroll |
| Host Chat | Scoped deliveries/recipient merge and replay | Recipient changes while sending |
| Participants | Wrapping metadata; accurate offline wording; moderation actions traced | Long names, permission sheet, scrolling |
| Host Controls | Metrics wrap into rows, section captions wrap | Tablet, 320px width, 200% text |
| Join Requests | Name and metadata rows wrap, shared adaptive buttons | Long request text, approve/decline races |
| Mic Requests | Wrapping name rows, 44px revoke target | Long names, real microphone permissions |
| Notifications | Await persisted read result; prevent false success on read failure | Long text, mark-all and navigation |
| Profile | Stack narrow action group, shared scrolling keyboard sheet | Profile editor keyboard, avatar/name |
| Settings | Sign out before changing server origin; no false success if logout-all fails | Server changes, large text, offline errors |
| Room Settings | Flexible inputs/steppers and keyboard scrolling | Capacity/password edits and keyboard |
| Nearby | Discovery/permission/error and reconnect states; real native lifecycle | BLE, hotspot, cross-platform, keyboard |
| Share Room | QR wraps beside text; accurate access rules and flexible links | QR camera scanning, share sheet |

## Shared changes

- `Screen`: bounded 960px content on tablets, full height flexible scrolling, safe areas retained.
- `Header`: minimum height and flexible side columns instead of fixed height/width clipping.
- `Button`, `Input`, `SegmentedControl`: multiline label and system text scaling space; no fixed text height.
- `Sheet`: scrollable content, keyboard avoidance, safe bottom padding and tablet width bound.
- `ResponsiveRow`: narrow screens or font scaling above 1.3 stack actions.
- `RoomCard`, `QRShareCard`, metadata groups: wrap rather than horizontal overflow.
- `Avatar`: safely normalize missing names; decorative initials fit their fixed circles.
- Theme muted text opacity increased for readable contrast on black surfaces.

## Acceptance matrix

Run each screen on a 320–360px Android phone, 390–430px Android/iPhone, 768px tablet, portrait and landscape where supported, font scale 1.0/1.3/2.0 and keyboard open. Inspect clipping, safe areas, touch targets and actual button behavior. Shared component unit tests validate layout decisions; they cannot prove the final native layout. Store screenshot evidence by device and build revision before release.
