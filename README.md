# Hammy

Hammy is a SwiftUI iOS companion for long-running Codex/ChatGPT-style work. It turns live session events into a friendly robot status display across the app, notifications, the Lock Screen, and Dynamic Island.

The project is a polished, runnable prototype. The interface, ActivityKit integration, notification flow, state model, demo history, settings, and tests are implemented. Account sign-in and real session data intentionally remain behind a bridge boundary; the app never pretends that a public consumer ChatGPT-history API exists.

## Open the project

1. Open `Hammy.xcodeproj` in Xcode.
2. Select the `Hammy` scheme and an iOS 18 or newer device.
3. Choose your Apple Development team for both `Hammy` and `HammyWidget` when running on a physical device.
4. Build and run.

The checked-in `.xcodeproj` is ready to open. The source of truth for regenerating it is `project.yml`:

```sh
xcodegen generate
```

## What is implemented

- Animated, photo-derived Hammy character with waving, floating, thinking, typing, compacting, delegating, approval-waiting, and completion treatments.
- Fast typewriter onboarding using the requested copy and Core Haptics-style feedback through UIKit impact generators.
- System appearance by default, with explicit light and dark overrides in Settings.
- Notification authorization and an approval-needed local notification demo.
- A real ActivityKit Live Activity and WidgetKit extension.
- Lock Screen layout with progress/update content on the left and Hammy's current state on the right.
- Dynamic Island expanded, compact, and minimal regions.
- Active sessions, previous sessions, and a chronological update feed.
- Chat detail with model, reasoning, photo, plugin, and command controls.
- A separate `/btw`-style Hammy aside composer that does not mutate the main session's progress.
- Hammy appearance, color, personality, permission defaults, bridge, and split usage settings.
- Three unit tests and two end-to-end UI tests.
- A multi-user E2EE relay backend with device trust, PostgreSQL row-level security, and WebSocket event delivery.

## Hammy state mapping

| Session state | Hammy treatment |
| --- | --- |
| Thinking | Thought cloud |
| Typing | Keyboard and typing motion |
| Compacting | Scroll and writing motion |
| Delegating | Smaller color-coded Hammies |
| Waiting for approval | Chair and relaxed waiting pose |
| Complete | Completion badge |

## Preview versus production

The **Sign in with ChatGPT** button deliberately enters a clearly labeled preview account. A native third-party iOS app cannot silently import arbitrary consumer ChatGPT conversations, and ChatGPT credentials or an OpenAI API key should never be embedded in the app.

The repository now includes the authenticated multi-user relay under `Backend/`. A trusted desktop companion still owns Codex authentication and plaintext processing, then E2EE-encrypts updates before sending them through the relay. The companion can integrate with the [Codex app server](https://learn.chatgpt.com/docs/app-server), which supplies thread lifecycle, streamed item events, tool progress, and approvals. The documented ChatGPT sign-in flow applies to supported Codex surfaces; see [Codex authentication](https://learn.chatgpt.com/docs/auth).

The iOS app is preconfigured to use the production relay at `https://backend.yzycoin.app`. Its live connection is derived automatically as `wss://backend.yzycoin.app/v1/events/live`; an authenticated relay access token is still required before it connects.

The relay, threat model, and versioned cryptographic protocol are documented in `Backend/README.md`, `Backend/THREAT_MODEL.md`, and `Backend/PROTOCOL.md`. The official app-server WebSocket listener is currently experimental, so the trusted companion should prefer local stdio and must never expose a workstation listener directly to the internet.

## Build and test

The final verification used Xcode 27 beta and an iPhone 17 Pro simulator:

```sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer \
xcodebuild test \
  -project Hammy.xcodeproj \
  -scheme Hammy \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=36023BAA-3B8E-434D-A48A-5C129BDC06D1' \
  -derivedDataPath /tmp/HammyDerivedData
```

Generated result bundles and UI captures are stored locally under `QA/` and are intentionally excluded from Git.

## Project map

```text
Hammy/
├── Hammy/                    App entry point, views, model, and services
├── HammyWidget/              Live Activity and Dynamic Island extension
├── Shared/                   Activity attributes, style, and character asset
├── HammyTests/               State and behavior tests
├── HammyUITests/             End-to-end layout flows and screenshots
├── Backend/                  Multi-user E2EE API, database, relay, and tests
├── QA/                       Local verification artifacts (Git-ignored)
├── project.yml               XcodeGen project definition
└── INTEGRATION.md            Production bridge contract and rollout notes
```

## Character asset

The supplied Hammy illustration was isolated into a transparent sprite, preserving the recognizable white shell, cyan face, antennae, and waving pose. The app icon is composed from that sprite over a blue/cyan gradient. Source and processed assets are retained in `Hammy/Resources/` and `Shared/HammyAssets.xcassets/`.
