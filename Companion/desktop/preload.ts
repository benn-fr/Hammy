import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hammy", {
  status: () => ipcRenderer.invoke("codex:status"),
  start: () => ipcRenderer.invoke("codex:start"),
  pair: () => ipcRenderer.invoke("codex:pair"),
  login: () => ipcRenderer.invoke("codex:login"),
  onOutput: (listener: (text: string) => void) => ipcRenderer.on("codex:output", (_event, text: string) => listener(text)),
});
