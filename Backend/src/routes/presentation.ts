import type { DeviceRecord, UserRecord } from "../types.js";

export function presentUser(user: UserRecord) {
  return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt };
}

export function presentDevice(device: DeviceRecord) {
  const { userId: _userId, ...publicDevice } = device;
  return publicDevice;
}

