# Hammy Companion

Hammy Companion is a local Node.js CLI for macOS, Windows, and Linux. It invokes the user's own installed Codex CLI; it never reads, exports, relays, or stores a ChatGPT/Codex credential.

## Install

Install Node.js 22+ and the Codex CLI first, then clone this repository and run:

```sh
cd Companion
npm install
npm run build
npm link
```

On Windows PowerShell, run the same commands in PowerShell. If script execution is restricted, use `npm.cmd` in place of `npm`.

## Local workflow

```sh
# Opens Codex's device-code browser sign-in. Credentials stay on this machine.
hammy-companion login

# Confirms the local Codex identity.
hammy-companion status

# Starts the local remote-control daemon, then creates a short-lived pairing code.
hammy-companion start
hammy-companion pair

# Starts a JSONL Codex app-server for a local Hammy adapter.
hammy-companion serve
```

`pair` uses Codex's experimental `remote-control pair` command. Its code is short-lived and is intended for a local, managed client. It is not a Codex credential and must not be used to make the companion reachable from the public internet.

The relay endpoint defaults to `https://backend.yzycoin.app`; override the display/configuration value with `HAMMY_RELAY_URL` if needed. The next adapter layer consumes local app-server events and sends E2EE envelopes to that relay. Keep Codex app-server on local stdio or an authenticated loopback socket.
