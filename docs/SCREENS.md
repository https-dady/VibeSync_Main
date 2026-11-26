# Screen map

VibeSync has 21 implemented screens. `SplashScreen` is rendered while auth/onboarding state loads; the other screens are registered in the root stack or the bottom tabs. All use the shared four-color design system.

## The 21 screens

| # | Screen | Route | What it does |
| --- | --- | --- | --- |
| 1 | `SplashScreen` | boot state | Branded launch state while the saved session and onboarding flag are read. |
| 2 | `OnboardingScreen` | `Onboarding` | Introduces online and nearby rooms; completing it routes to Login. |
| 3 | `LoginScreen` | `Login` | Email/password sign-in, validation, secure token storage, pending invite handoff. |
| 4 | `RegisterScreen` | `Register` | Account creation with name/email/password and device registration. |
| 5 | `HomeScreen` | `Home` tab | Greeting, quick create/join actions, live room highlights, recent rooms, nearby entry. |
| 6 | `DiscoverRoomsScreen` | `Rooms` tab | Search and filter public rooms, refresh, join by code. |
| 7 | `CreateRoomScreen` | `CreateRoom` | Room name, description, visibility, capacity, media type, password, approvals, and creation. |
| 8 | `JoinRoomScreen` | `JoinRoom` | Enter a code/deep link, fetch the room, request approval, submit a password, or join. |
| 9 | `RoomScreen` | `Room` | Live room: waiting/idle state, host dashboard, synchronized audio/video player, queue, mic requests, chat preview, participants, host actions, fullscreen video. |
| 10 | `RoomChatScreen` | `RoomChat` | Full room chat with realtime messages, pagination, send, and host moderation. |
| 11 | `HostChatScreen` | `HostChat` | Private host inbox; participants message the host, only the host sees all threads. |
| 12 | `ParticipantsScreen` | `Participants` | Member list, online presence, mic state, permissions, remove/ban, mute-all. |
| 13 | `HostControlsScreen` | `HostControls` | Host dashboard: pending mic/join counts, chat/approval toggles, mute-all, room settings, end room. |
| 14 | `MicRequestsScreen` | `MicRequests` | Approve/decline speak requests, revoke active speakers, mute all. |
| 15 | `JoinRequestsScreen` | `JoinRequests` | Approve/decline private join requests with capacity context. |
| 16 | `RoomSettingsScreen` | `RoomSettings` | Edit name, description, chat, microphone requests, approvals, password, and capacity. |
| 17 | `NearbyScreen` | `Nearby` tab | Offline host/join flow: pick media, start local room, BLE discovery, manual address join, local chat and synced playback. |
| 18 | `NotificationsScreen` | `Notifications` | In-app notification list, unread state, mark one/all read. |
| 19 | `ProfileScreen` | `Profile` tab | Profile, edit name/bio/color, recent rooms, notification link, sign-out. |
| 20 | `SettingsScreen` | `Settings` | Notification/motion preferences, custom API server, clear recent rooms, security notes, sign-out everywhere. |
| 21 | `ShareRoomScreen` | `ShareRoom` | Room code, QR code, native share sheet, web invite link, copy link. |

`MainTabs` is navigation infrastructure, not one of the 21 screens. It hosts Home, Discover Rooms, Nearby, and Profile.

## Required feature mapping

The original requirements name several capabilities rather than separate screens. They are implemented inside this screen set:

| Requirement | Implementation |
| --- | --- |
| Waiting Room | `RoomScreen` idle/waiting state when no media is playing, plus the pending state in `JoinRoomScreen` and the host approval queue. |
| Host Dashboard | `RoomScreen` host header/metrics and quick actions, plus the dedicated `HostControlsScreen`. |
| Request to Speak | `RoomScreen` "request mic" action and `MicRequestsScreen` for the host decision queue. |
| Permission Management | `ParticipantsScreen` per-member mic/chat controls, `HostControlsScreen` global toggles, `MicRequestsScreen` speaker revocation, `RoomSettingsScreen` room-wide policy. |
| Private Join Requests | `JoinRequestsScreen` for approval/decline; pending users see their state in `JoinRoomScreen`/`RoomScreen`. |
| Audio Player | `RoomScreen` + `SyncedMediaPlayer` audio layout with waveform, play/pause, seek, rate, queue. |
| Video Player | `RoomScreen` + `SyncedMediaPlayer` video layout with native fullscreen (`presentFullscreenPlayer()`). |

## Navigation flow

```text
Splash
  ├─ first launch → Onboarding → Login → Register
  └─ returning, signed out → Login

Signed in → Main tabs
  ├─ Home → CreateRoom / JoinRoom / Room / Nearby / Notifications / Settings / Profile
  ├─ Rooms → Room
  ├─ Nearby → local nearby session
  └─ Profile → Settings / Notifications / Edit profile

Room
  ├─ RoomChat
  ├─ HostChat          (private host inbox)
  ├─ Participants      (host and participants)
  ├─ HostControls      (host only)
  ├─ MicRequests       (host only)
  ├─ JoinRequests      (host only)
  ├─ RoomSettings      (host only)
  └─ ShareRoom         (modal)
```

Deep links (`vibesync://room/CODE`, `https://vibesync.app/r/CODE`) open `JoinRoom`. If the user is signed out, the code is stored and opened after authentication.

## Screen behavior notes

- **RoomScreen** is deliberately comprehensive: it switches between waiting, audio, and video layouts without leaving the room, and shows host quick actions instead of forcing a separate dashboard. Host-only destinations still exist as dedicated screens for larger management tasks.
- **Chat preview** on RoomScreen shows recent messages and routes to `RoomChatScreen`. Private host messages live in `HostChatScreen` and are never broadcast to the room channel.
- **NearbyScreen** is fully local. It does not show or use the online room UI, and its members/chat/playback come from the native local session. It is still registered inside the authenticated app shell, so one online sign-in is required before it can be opened.
- **ShareRoomScreen** builds the public invite URL from `VIBESYNC_WEB_URL`; the API serves the branded landing page at `/r/:roomId`.
- **SettingsScreen** can point the app at a self-hosted API at runtime. Restart the app after changing the server so the socket reconnects to the new origin.
