import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hammy", {
  status: () => ipcRenderer.invoke("hammy:status"),
  login: () => ipcRenderer.invoke("hammy:login"),
  pair: () => ipcRenderer.invoke("hammy:pair"),
  pairingStatus: (pairingId: string) => ipcRenderer.invoke("hammy:pair-status", pairingId),
  startSession: (prompt: string) => ipcRenderer.invoke("hammy:start-session", prompt),
});
