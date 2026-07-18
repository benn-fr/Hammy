# Production integration notes

This document separates the runnable UI prototype from the external services required for a production Hammy release.

## Recommended architecture

```text
iPhone / Hammy
  SwiftUI + ActivityKit + CryptoKit
          │  E2EE ciphertext over authenticated HTTPS/WebSocket
          ▼
Hammy relay backend
  multi-user auth, device trust, RLS, ciphertext storage
          ▲
          │  E2EE ciphertext
Trusted Hammy bridge on the user's Mac
          │  local stdio or protected control socket
          ▼
Codex app server
  Codex authentication, threads, turns, approvals, streamed items
```

The bridge belongs on the user's trusted Mac, Windows, or Linux machine. It owns Codex authentication, plaintext session data, workspace access, and policy enforcement. The relay in `Backend/` never receives content keys, plaintext session fields, or Codex credentials. `Companion/` provides the local cross-platform CLI wrapper for Codex device login, local remote-control pairing, and local app-server startup.

The [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server) describes `thread/start`, `thread/resume`, `thread/fork`, `turn/start`, `turn/steer`, streamed item notifications, and `turn/completed`. Prefer its default stdio transport or protected local control socket behind the bridge. Do not expose the experimental raw WebSocket listener directly to the public internet.

## Account pairing

1. The first iPhone creates a Hammy account and generates its device keys in Keychain.
2. The user's local Companion completes Codex device login, then the bridge signs into the Hammy account and registers its public keys as a pending device.
3. The iPhone verifies and Ed25519-signs the exact pending-device keys.
4. The bridge separately completes the supported Codex/ChatGPT authentication flow locally.
5. The bridge creates session content keys and packages them independently to every trusted Hammy device.
6. Revoking a device invalidates its relay logins and freezes future session writes until a fresh key is packaged to all remaining devices.

The current preview button is intentionally not a fake OAuth implementation. The documented ChatGPT sign-in mechanisms are described in [Codex authentication](https://learn.chatgpt.com/docs/auth); arbitrary consumer ChatGPT history is not exposed as a general native-app API.

If the product instead owns its own conversations, a backend can use the OpenAI Responses API and select from the current [model catalog](https://developers.openai.com/api/docs/models). Keep API credentials on the backend, never in the iOS binary.

## Implemented relay contract

The relay stores only a routing record and signed ciphertext. Decrypted session updates retain the following product schema on trusted endpoints:

```json
{
  "type": "session.update",
  "session": {
    "id": "thr_123",
    "title": "Ship Hammy Live Activity",
    "project": "Hammy iOS",
    "state": "delegating",
    "progress": 0.66,
    "progressIsEstimate": true,
    "latestUpdate": "Three helper agents are checking layout.",
    "agentCount": 3,
    "updatedAt": "2026-07-17T22:30:00Z"
  }
}
```

Implemented endpoints/events:

| Mobile operation | Bridge behavior |
| --- | --- |
| `GET /v1/sessions` | List signed encrypted session metadata for the authenticated account |
| `POST /v1/sessions` | Create a signed encrypted session record |
| `POST /v1/sessions/{id}/events` | Append an idempotent signed ciphertext event |
| `GET /v1/sessions/{id}/events` | Replay ciphertext from a durable cursor |
| `GET /v1/events/live` | Receive backlog and live ciphertext over an authenticated WebSocket |
| `PUT /v1/sessions/{id}/keys/{deviceId}` | Store an X25519 recipient-bound session-key package |
| `POST /v1/sessions/{id}/keys/activate` | Activate a fresh key after revocation or planned rotation |
| `POST /v1/devices/{id}/approve` | Trust a pending device using an existing device signature |

Event writes use UUID message IDs for idempotency. Clients resume the event stream with a monotonic cursor and deduplicate at the backlog/live boundary. Cryptographic details and visible metadata are documented in `Backend/PROTOCOL.md` and `Backend/THREAT_MODEL.md`.

## Event-to-animation mapping

| Codex/bridge signal | App state | UI reaction |
| --- | --- | --- |
| Turn begins or reasoning item starts | `thinking` | Thought cloud |
| Agent message delta arrives | `typing` | Keyboard/typing motion |
| Context compaction begins | `compacting` | Scroll and writing motion |
| Child-agent work becomes active | `delegating` | Color-coded mini Hammies |
| Approval request arrives | `waitingApproval` | Chair pose, notification, deep link |
| Turn completes successfully | `complete` | Complete badge, final update |
| Connection is idle | `idle` | Gentle floating pose |

Codex does not promise a literal percentage for every turn. The bridge should mark progress as estimated and derive it from plan completion, active/completed items, and historical timing. Avoid showing `100%` until a completion event arrives.

## Main prompts and quick asides

The main composer maps to a normal Codex turn. While a turn is running, a user instruction that should alter that work can map to `turn/steer`.

The purple `/btw` composer is different: it should run a separate, low-context request using a snapshot of the latest visible status. Its response is displayed in Hammy's thought bubble and logged under Hammy usage, but it must not append to or steer the main thread. Rate-limit asides separately so they cannot starve the primary session.

## Models, reasoning, plugins, and commands

- Fetch available models and reasoning choices from the bridge rather than hard-coding transient model IDs.
- Treat the iOS controls as requested policy, not enforcement. The bridge must validate command, filesystem, network, and plugin permissions.
- Return the effective policy with each session so the interface can distinguish requested and applied settings.
- Require a fresh, scoped approval for dangerous commands. The approval screen should show the exact command, working directory, affected resources, and requesting session.
- Upload photos with short-lived signed URLs; remove metadata unless the user explicitly chooses to retain it.
- Allow only bridge-approved plugins/connectors and expose their names and requested scopes before enabling them.

## Notifications and Live Activities

The prototype starts and updates ActivityKit locally. Production background delivery requires:

1. Registering the app for remote notifications and sending the APNs device token to the bridge.
2. Starting a push-enabled Live Activity and sending its activity push token to the bridge.
3. Sending compact, throttled Live Activity updates through APNs when the app is suspended.
4. Sending a normal actionable notification for approvals, deep-linked to the correct session.
5. Expiring stale activities and ending them on completion, cancellation, logout, or revoked pairing.

Live Activities do not present a separate permission dialog. Hammy requests notification permission; ActivityKit separately reports whether Live Activities are enabled in system settings.

## Usage accounting

Store usage server-side with these dimensions:

- account and paired device;
- session and turn;
- main prompt versus Hammy aside;
- model and reasoning level;
- input, cached input, and output tokens;
- estimated cost when billing data is available.

The settings screen already separates main-prompt and Hammy-aside usage. The current values are sample data until the bridge sends signed usage records.

## Security checklist

- Use TLS and certificate validation for all non-local connections.
- Keep access tokens in Keychain and rotate refresh tokens.
- Scope tokens to the paired account, device, and allowed workspaces.
- Never send Codex auth files, API keys, shell environment secrets, or full filesystem paths to the phone unless necessary and user-visible.
- Redact secrets from update text and notification previews.
- Validate deep links and approval identifiers against the authenticated account.
- Add reconnect backoff, event replay, schema-version negotiation, and remote revocation.
- Provide account deletion, transcript retention, and diagnostic-log controls before distribution.

## Rollout order

1. Build the trusted local Mac adapter that maps Codex app-server events into the implemented encrypted relay protocol.
2. Replace preview sign-in with the implemented Hammy account/device-pairing API.
3. Add real approval responses and generic APNs notification deep links.
4. Add push Live Activity updates and reconnect/replay behavior.
5. Add encrypted usage records, plugin policy, and encrypted upload references.
6. Add a user-controlled offline recovery key and passkey/email-verification flows.
7. Complete independent security review, accessibility testing, localization, signing, and App Store provisioning.
