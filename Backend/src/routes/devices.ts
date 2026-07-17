import type { FastifyInstance } from "fastify";
import type { Authenticator } from "../auth/authenticator.js";
import { deviceApprovalPayload, deviceRevocationPayload } from "../crypto/canonical.js";
import { verifyEd25519 } from "../crypto/signatures.js";
import type { Store } from "../db/store.js";
import { AppError } from "../errors.js";
import { approvalSchema, uuidSchema } from "../schemas.js";
import { presentDevice } from "./presentation.js";

export async function registerDeviceRoutes(app: FastifyInstance, dependencies: { store: Store; authenticator: Authenticator }): Promise<void> {
  app.get("/v1/devices", { preHandler: dependencies.authenticator.requireTrusted }, async (request) => {
    const devices = await dependencies.store.listDevices(request.auth!.userId);
    return { devices: devices.map(presentDevice) };
  });

  app.post<{ Params: { deviceId: string } }>("/v1/devices/:deviceId/approve", {
    preHandler: dependencies.authenticator.requireTrusted,
  }, async (request) => {
    const pendingDeviceId = uuidSchema.parse(request.params.deviceId);
    const input = approvalSchema.parse(request.body);
    const [approver, pending] = await Promise.all([
      dependencies.store.getDevice(request.auth!.userId, request.auth!.deviceId),
      dependencies.store.getDevice(request.auth!.userId, pendingDeviceId),
    ]);
    if (!approver || approver.trustState !== "trusted" || !pending || pending.trustState !== "pending") {
      throw new AppError("Pending device was not found", 404, "not_found");
    }
    const payload = deviceApprovalPayload({
      userId: request.auth!.userId,
      approverDeviceId: approver.id,
      pendingDeviceId: pending.id,
      pendingAgreementPublicKey: pending.agreementPublicKey,
      pendingSigningPublicKey: pending.signingPublicKey,
    });
    if (!verifyEd25519(approver.signingPublicKey, payload, input.signature)) {
      throw new AppError("Device approval signature is invalid", 400, "invalid_signature");
    }
    const approved = await dependencies.store.approveDevice(request.auth!.userId, pending.id, approver.id);
    if (!approved) throw new AppError("Pending device could not be approved", 409, "approval_conflict");
    return { device: presentDevice(approved), needsKeyPackages: true };
  });

  app.post<{ Params: { deviceId: string } }>("/v1/devices/:deviceId/revoke", {
    preHandler: dependencies.authenticator.requireTrusted,
  }, async (request) => {
    const deviceId = uuidSchema.parse(request.params.deviceId);
    const input = approvalSchema.parse(request.body);
    const requestingDevice = await dependencies.store.getDevice(request.auth!.userId, request.auth!.deviceId);
    if (!requestingDevice || requestingDevice.trustState !== "trusted") {
      throw new AppError("Requesting device is not trusted", 403, "untrusted_device");
    }
    const payload = deviceRevocationPayload({
      userId: request.auth!.userId,
      requestingDeviceId: requestingDevice.id,
      targetDeviceId: deviceId,
    });
    if (!verifyEd25519(requestingDevice.signingPublicKey, payload, input.signature)) {
      throw new AppError("Device revocation signature is invalid", 400, "invalid_signature");
    }
    const revoked = await dependencies.store.revokeDevice(request.auth!.userId, deviceId);
    if (!revoked) throw new AppError("Device was not found", 404, "not_found");
    return { device: presentDevice(revoked) };
  });
}
