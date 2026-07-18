# Hammy Companion

Hammy Companion is a local desktop app and CLI for macOS, Windows, and Linux. It starts the documented local Codex app-server and uses its device-code ChatGPT sign-in. ChatGPT credentials remain inside local Codex; the companion stores a separate encrypted relay-device identity using the operating system's credential protection.

## Desktop builds

The repository’s GitHub Actions workflow produces native desktop artifacts: a macOS `.app`, Windows NSIS `.exe`, and Linux `.AppImage`. They are not code-signed yet; signing needs your Apple Developer and Windows certificate credentials before public distribution.

For local packaging, run `npm run dist:mac`, `npm run dist:win`, or `npm run dist:linux` on the corresponding operating system. Output is written to `Companion/release/`.

## Install

Install Node.js 22+ and the Codex CLI first, then clone this repository and run:

```sh
cd Companion
npm install
npm run build
npm link
```

To run the desktop app during development:

```sh
npm start
```

On Windows PowerShell, run the same commands in PowerShell. If script execution is restricted, use `npm.cmd` in place of `npm`.

## Local workflow

```sh
# Opens Codex's local device-code browser sign-in. Credentials stay inside Codex on this machine.
hammy-companion login

# Confirms the local Codex identity.
hammy-companion status

# Starts a JSONL Codex app-server for a local Hammy adapter.
hammy-companion serve
```

In the desktop app, choose **Pair an iPhone** after signing in. It creates a 12-character, one-time code valid for ten minutes. Hammy uses that code to create a new iOS relay device; the companion signs its approval locally, and only then does the iPhone receive its own relay token and recipient-bound session keys. The pairing code is not a ChatGPT credential.

The relay endpoint defaults to `https://backend.yzycoin.app`; override it with `HAMMY_RELAY_URL` if needed. The companion translates local app-server thread events into signed, end-to-end encrypted relay envelopes. An iPhone main prompt continues the real thread; a `/btw` aside starts an isolated, read-only, ephemeral Codex thread. Command and file-change approvals wait for the paired iPhone and are never auto-approved. Keep Codex app-server on local stdio or an authenticated loopback socket.
