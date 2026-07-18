import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hammy", {
  status: () => ipcRenderer.invoke("hammy:status"),
  login: () => ipcRenderer.invoke("hammy:login"),
  pair: () => ipcRenderer.invoke("hammy:pair"),
  pairingStatus: (pairingId: string) => ipcRenderer.invoke("hammy:pair-status", pairingId),
  pairingLobbies: () => ipcRenderer.invoke("hammy:pairing-lobbies"),
  claimPairingLobby: (lobbyId: string, code: string) => ipcRenderer.invoke("hammy:claim-pairing-lobby", lobbyId, code),
  tailscale: () => ipcRenderer.invoke("hammy:tailscale"),
  startSession: (prompt: string) => ipcRenderer.invoke("hammy:start-session", prompt),
});
