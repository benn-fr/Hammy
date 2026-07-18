# Hammy Companion

Hammy Companion is a local desktop app and CLI for macOS, Windows, and Linux. It starts the documented local Codex app-server and uses its device-code ChatGPT sign-in. ChatGPT credentials remain inside local Codex; the companion stores a separate encrypted relay-device identity using the operating system's credential protection.

## Desktop builds

The repository’s GitHub Actions workflow produces native desktop artifacts: a macOS `.app` inside a `.zip`, Windows NSIS `.exe`, and Linux `.AppImage`. They are not code-signed yet; signing needs your Apple Developer and Windows certificate credentials before public distribution.

For local packaging, run `npm run dist:mac`, `npm run dist:win`, or `npm run dist:linux` on the corresponding operating system. Output is written to `Companion/release/`.

## Install

Install Node.js 22+ first, then clone this repository and run:

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

### macOS release install and repair

Download and unzip `Hammy-Companion-macos.zip`, then move **Hammy Companion.app** to Applications. Because release builds are not notarized yet, macOS may block the first launch. In Terminal, run:

```sh
xattr -dr com.apple.quarantine "/Applications/Hammy Companion.app"
chmod +x "/Applications/Hammy Companion.app/Contents/MacOS/Hammy Companion"
open "/Applications/Hammy Companion.app"
```

The `chmod` command repairs an archive whose executable bit was removed during download or extraction. Current releases are zipped on macOS specifically to preserve that permission, but the command is safe to run if the app does not open.

## Local workflow

```sh
# Opens Codex's local device-code browser sign-in. Credentials stay inside Codex on this machine.
hammy-companion login

# Confirms the local Codex identity.
hammy-companion status

# Starts a JSONL Codex app-server for a local Hammy adapter.
hammy-companion serve
```

The desktop app installs the official Codex CLI on the explicit **Sign in with ChatGPT** action when it is missing and npm is available. It then opens Codex’s local device-code browser sign-in. If Node/npm is missing, it explains how to install Node.js LTS; it never transfers a ChatGPT credential to Hammy.

To pair, open Hammy on the iPhone and choose **Pair with Hammy Companion**. The phone creates a short-lived remote pairing request and shows a 12-character code. On the signed-in computer, choose **Find iPhone pairing request**, select the waiting opaque request, and enter that matching code. The companion verifies it, signs the iPhone device approval, and shares recipient-bound keys for its current tracked sessions. The phone then receives a scoped relay authorization over HTTPS. The code is not a ChatGPT credential.

This flow works remotely through `https://backend.yzycoin.app`, including when the devices are no longer on the same Wi-Fi or Tailnet. If Tailscale is installed, the desktop app lists online Tailnet peers as a diagnostic only; it does not open a Codex port or make direct peer connections.

The relay endpoint defaults to `https://backend.yzycoin.app`; override it with `HAMMY_RELAY_URL` if needed. The companion mirrors its local Codex threads to encrypted relay sessions and translates app-server thread events into signed, end-to-end encrypted envelopes. An iPhone main prompt continues the real thread; a `/btw` aside starts an isolated, read-only, ephemeral Codex thread. Command and file-change approvals wait for the paired iPhone and are never auto-approved. Keep Codex app-server on local stdio or an authenticated loopback socket.
