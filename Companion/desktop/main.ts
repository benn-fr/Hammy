import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

function codex(args: string[], onOutput?: (chunk: string) => void): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { shell: process.platform === "win32" });
    let output = "";
    const receive = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      onOutput?.(text);
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("error", () => reject(new Error("Codex CLI was not found. Install Codex, then reopen Hammy Companion.")));
    child.once("exit", (code) => resolve({ code: code ?? 1, output }));
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 860,
    height: 680,
    minWidth: 640,
    minHeight: 520,
    title: "Hammy Companion",
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: join(root, "preload.js") },
  });
  void window.loadFile(join(root, "../desktop/renderer/index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("codex:status", () => codex(["login", "status"]));
  ipcMain.handle("codex:start", () => codex(["remote-control", "start", "--json"]));
  ipcMain.handle("codex:pair", () => codex(["remote-control", "pair", "--json"]));
  ipcMain.handle("codex:login", (event) => codex(["login", "--device-auth"], (chunk) => event.sender.send("codex:output", chunk)));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
