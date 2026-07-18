#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const relayURL = process.env.HAMMY_RELAY_URL ?? "https://backend.yzycoin.app";
const command = process.argv[2] ?? "help";

function usage(exitCode = 0): never {
  console.log(`Hammy Companion — local Codex pairing for macOS, Windows, and Linux

Usage:
  hammy-companion login       Start Codex's device-code sign-in locally
  hammy-companion status      Show local Codex sign-in status
  hammy-companion serve       Start a local-only Codex app-server (JSONL over stdio)

Environment:
  HAMMY_RELAY_URL             Relay URL shown to the local companion (default: ${relayURL})

No ChatGPT/Codex credential is read, copied, uploaded, or sent to Hammy.`);
  process.exit(exitCode);
}

function requireCodex(): void {
  const result = spawnSync("codex", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  if (result.error || result.status !== 0) {
    console.error("Codex CLI was not found. Install it, sign in locally, then rerun this command.");
    process.exit(1);
  }
}

function runCodex(args: string[]): never {
  requireCodex();
  const child = spawn("codex", args, { stdio: "inherit", shell: process.platform === "win32" });
  child.once("error", (error) => {
    console.error(`Unable to start Codex: ${error.message}`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  // Keep Node alive while the local child owns the interaction.
  return undefined as never;
}

function printContext(): void {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  console.log(`\nHammy relay: ${relayURL}`);
  console.log(`Codex credentials remain local in: ${codexHome}`);
  if (existsSync(join(codexHome, "auth.json"))) console.log("Local Codex credentials detected.");
}

switch (command) {
case "login":
  printContext();
  console.log("\nOpen the URL and enter the device code shown by Codex. Hammy never receives these credentials.\n");
  runCodex(["login", "--device-auth"]);
  break;
case "status":
  printContext();
  runCodex(["login", "status"]);
  break;
case "serve":
  printContext();
  console.log("\nStarting Codex app-server on local stdio only. Do not expose it to a network.\n");
  runCodex(["app-server", "--listen", "stdio://"]);
  break;
case "help":
case "--help":
case "-h":
  usage();
  break;
default:
  console.error(`Unknown command: ${command}\n`);
  usage(1);
}
