import CryptoKit
import Foundation
import Security

enum HammyNotificationHint: String, Codable, Hashable {
    case none
    case generic
    case attention
}

struct HammyDevicePublicBundle: Codable, Equatable {
    var agreementPublicKey: String
    var signingPublicKey: String
}

struct HammyDeviceKeys: Codable, Equatable {
    var agreementPrivateKey: String
    var signingPrivateKey: String

    static func generate() -> HammyDeviceKeys {
        HammyDeviceKeys(
            agreementPrivateKey: Data(Curve25519.KeyAgreement.PrivateKey().rawRepresentation).base64URLEncodedString(),
            signingPrivateKey: Data(Curve25519.Signing.PrivateKey().rawRepresentation).base64URLEncodedString()
        )
    }

    var publicBundle: HammyDevicePublicBundle {
        get throws {
            let agreement = try Curve25519.KeyAgreement.PrivateKey(
                rawRepresentation: Data(base64URLEncoded: agreementPrivateKey)
            )
            let signing = try Curve25519.Signing.PrivateKey(
                rawRepresentation: Data(base64URLEncoded: signingPrivateKey)
            )
            return HammyDevicePublicBundle(
                agreementPublicKey: Data(agreement.publicKey.rawRepresentation).base64URLEncodedString(),
                signingPublicKey: Data(signing.publicKey.rawRepresentation).base64URLEncodedString()
            )
        }
    }
}

struct HammySignedCiphertext: Codable, Equatable {
    var version = 1
    var algorithm = "chacha20-poly1305"
    var keyId: String
    var nonce: String
    var ciphertext: String
    var clientCreatedAt: String
    var signature: String
}

struct HammyKeyPackageEnvelope: Codable, Equatable {
    var version = 1
    var algorithm = "x25519-hkdf-sha256+chacha20-poly1305"
    var keyId: String
    var ephemeralPublicKey: String
    var salt: String
    var nonce: String
    var ciphertext: String
    var createdAt: String
    var signature: String
}

enum HammyE2EEError: LocalizedError {
    case invalidEncoding
    case invalidKeyLength
    case invalidSignature
    case invalidCiphertext
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidEncoding: "An encrypted value is not valid canonical base64url."
        case .invalidKeyLength: "An encryption key has an invalid length."
        case .invalidSignature: "The sender signature could not be verified."
        case .invalidCiphertext: "The encrypted message could not be authenticated."
        case .keychain(let status): "Keychain operation failed (\(status))."
        }
    }
}

enum HammyE2EE {
    static func createSessionKey() -> Data {
        SymmetricKey(size: .bits256).dataRepresentation
    }

    static func encryptSessionMetadata(
        _ plaintext: Data,
        sessionKey: Data,
        keyId: String,
        userId: String,
        sessionId: String,
        senderDeviceId: String,
        keys: HammyDeviceKeys,
        createdAt: String = isoTimestamp()
    ) throws -> HammySignedCiphertext {
        let context = SessionMetadataContext(userId: userId, sessionId: sessionId, senderDeviceId: senderDeviceId)
        var envelope = HammySignedCiphertext(
            keyId: keyId,
            nonce: "",
            ciphertext: "",
            clientCreatedAt: createdAt,
            signature: ""
        )
        let nonce = ChaChaPoly.Nonce()
        envelope.nonce = nonce.dataRepresentation.base64URLEncodedString()
        let sealed = try seal(
            plaintext,
            key: sessionKey,
            nonce: nonce.dataRepresentation,
            associatedData: sessionMetadataAAD(context: context, envelope: envelope)
        )
        envelope.ciphertext = sealed.ciphertext.base64URLEncodedString()
        envelope.signature = try sign(
            sessionMetadataSignature(context: context, envelope: envelope),
            keys: keys
        ).base64URLEncodedString()
        return envelope
    }

    static func decryptSessionMetadata(
        _ envelope: HammySignedCiphertext,
        sessionKey: Data,
        senderSigningPublicKey: String,
        userId: String,
        sessionId: String,
        senderDeviceId: String
    ) throws -> Data {
        let context = SessionMetadataContext(userId: userId, sessionId: sessionId, senderDeviceId: senderDeviceId)
        try verify(
            signature: envelope.signature,
            publicKey: senderSigningPublicKey,
            payload: sessionMetadataSignature(context: context, envelope: envelope)
        )
        return try open(
            envelope,
            key: sessionKey,
            associatedData: sessionMetadataAAD(context: context, envelope: envelope)
        )
    }

    static func encryptEvent(
        _ plaintext: Data,
        sessionKey: Data,
        keyId: String,
        userId: String,
        sessionId: String,
        messageId: String,
        senderDeviceId: String,
        notificationHint: HammyNotificationHint = .none,
        keys: HammyDeviceKeys,
        createdAt: String = isoTimestamp()
    ) throws -> HammySignedCiphertext {
        let context = EventContext(
            userId: userId,
            sessionId: sessionId,
            messageId: messageId,
            senderDeviceId: senderDeviceId,
            notificationHint: notificationHint
        )
        var envelope = HammySignedCiphertext(
            keyId: keyId,
            nonce: "",
            ciphertext: "",
            clientCreatedAt: createdAt,
            signature: ""
        )
        let nonce = ChaChaPoly.Nonce()
        envelope.nonce = nonce.dataRepresentation.base64URLEncodedString()
        let sealed = try seal(
            plaintext,
            key: sessionKey,
            nonce: nonce.dataRepresentation,
            associatedData: eventAAD(context: context, envelope: envelope)
        )
        envelope.ciphertext = sealed.ciphertext.base64URLEncodedString()
        envelope.signature = try sign(eventSignature(context: context, envelope: envelope), keys: keys)
            .base64URLEncodedString()
        return envelope
    }

    static func decryptEvent(
        _ envelope: HammySignedCiphertext,
        sessionKey: Data,
        senderSigningPublicKey: String,
        userId: String,
        sessionId: String,
        messageId: String,
        senderDeviceId: String,
        notificationHint: HammyNotificationHint = .none
    ) throws -> Data {
        let context = EventContext(
            userId: userId,
            sessionId: sessionId,
            messageId: messageId,
            senderDeviceId: senderDeviceId,
            notificationHint: notificationHint
        )
        try verify(
            signature: envelope.signature,
            publicKey: senderSigningPublicKey,
            payload: eventSignature(context: context, envelope: envelope)
        )
        return try open(envelope, key: sessionKey, associatedData: eventAAD(context: context, envelope: envelope))
    }

    static func wrapSessionKey(
        _ sessionKey: Data,
        keyId: String,
        userId: String,
        sessionId: String,
        senderDeviceId: String,
        recipientDeviceId: String,
        recipientAgreementPublicKey: String,
        keys: HammyDeviceKeys,
        createdAt: String = isoTimestamp()
    ) throws -> HammyKeyPackageEnvelope {
        guard sessionKey.count == 32 else { throw HammyE2EEError.invalidKeyLength }
        let context = KeyPackageContext(
            userId: userId,
            sessionId: sessionId,
            senderDeviceId: senderDeviceId,
            recipientDeviceId: recipientDeviceId
        )
        let recipient = try Curve25519.KeyAgreement.PublicKey(
            rawRepresentation: Data(base64URLEncoded: recipientAgreementPublicKey)
        )
        let ephemeral = Curve25519.KeyAgreement.PrivateKey()
        let sharedSecret = try ephemeral.sharedSecretFromKeyAgreement(with: recipient)
        let salt = SymmetricKey(size: .bits128).dataRepresentation
        let nonce = ChaChaPoly.Nonce()
        let wrappingKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: salt,
            sharedInfo: keyPackageKDFInfo(context: context, keyId: keyId),
            outputByteCount: 32
        )
        var envelope = HammyKeyPackageEnvelope(
            keyId: keyId,
            ephemeralPublicKey: Data(ephemeral.publicKey.rawRepresentation).base64URLEncodedString(),
            salt: salt.base64URLEncodedString(),
            nonce: nonce.dataRepresentation.base64URLEncodedString(),
            ciphertext: "",
            createdAt: createdAt,
            signature: ""
        )
        let sealed = try ChaChaPoly.seal(
            sessionKey,
            using: wrappingKey,
            nonce: nonce,
            authenticating: keyPackageAAD(context: context, envelope: envelope)
        )
        envelope.ciphertext = (sealed.ciphertext + sealed.tag).base64URLEncodedString()
        envelope.signature = try sign(keyPackageSignature(context: context, envelope: envelope), keys: keys)
            .base64URLEncodedString()
        return envelope
    }

    static func unwrapSessionKey(
        _ envelope: HammyKeyPackageEnvelope,
        userId: String,
        sessionId: String,
        senderDeviceId: String,
        recipientDeviceId: String,
        senderSigningPublicKey: String,
        recipientKeys: HammyDeviceKeys
    ) throws -> Data {
        let context = KeyPackageContext(
            userId: userId,
            sessionId: sessionId,
            senderDeviceId: senderDeviceId,
            recipientDeviceId: recipientDeviceId
        )
        try verify(
            signature: envelope.signature,
            publicKey: senderSigningPublicKey,
            payload: keyPackageSignature(context: context, envelope: envelope)
        )
        let recipientPrivate = try Curve25519.KeyAgreement.PrivateKey(
            rawRepresentation: Data(base64URLEncoded: recipientKeys.agreementPrivateKey)
        )
        let ephemeralPublic = try Curve25519.KeyAgreement.PublicKey(
            rawRepresentation: Data(base64URLEncoded: envelope.ephemeralPublicKey)
        )
        let sharedSecret = try recipientPrivate.sharedSecretFromKeyAgreement(with: ephemeralPublic)
        let wrappingKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: try Data(base64URLEncoded: envelope.salt),
            sharedInfo: keyPackageKDFInfo(context: context, keyId: envelope.keyId),
            outputByteCount: 32
        )
        let combined = try Data(base64URLEncoded: envelope.ciphertext)
        guard combined.count == 48 else { throw HammyE2EEError.invalidCiphertext }
        let box = try ChaChaPoly.SealedBox(
            nonce: ChaChaPoly.Nonce(data: Data(base64URLEncoded: envelope.nonce)),
            ciphertext: combined.prefix(32),
            tag: combined.suffix(16)
        )
        do {
            return try ChaChaPoly.open(
                box,
                using: wrappingKey,
                authenticating: keyPackageAAD(context: context, envelope: envelope)
            )
        } catch {
            throw HammyE2EEError.invalidCiphertext
        }
    }

    static func signDeviceApproval(
        userId: String,
        approverDeviceId: String,
        pendingDeviceId: String,
        pendingAgreementPublicKey: String,
        pendingSigningPublicKey: String,
        keys: HammyDeviceKeys
    ) throws -> String {
        try sign(canonicalFields([
            "hammy.device-approval.signature.v1",
            userId,
            approverDeviceId,
            pendingDeviceId,
            pendingAgreementPublicKey,
            pendingSigningPublicKey,
        ]), keys: keys).base64URLEncodedString()
    }

    static func signKeyActivation(
        userId: String,
        sessionId: String,
        senderDeviceId: String,
        keyId: String,
        keyEpoch: Int,
        keys: HammyDeviceKeys
    ) throws -> String {
        try sign(canonicalFields([
            "hammy.key-activation.signature.v1",
            userId,
            sessionId,
            senderDeviceId,
            keyId,
            String(keyEpoch),
        ]), keys: keys).base64URLEncodedString()
    }

    static func signLoginProof(
        userId: String,
        deviceId: String,
        challengeId: String,
        challenge: String,
        keys: HammyDeviceKeys
    ) throws -> String {
        try sign(canonicalFields([
            "hammy.login-proof.signature.v1",
            userId,
            deviceId,
            challengeId,
            challenge,
        ]), keys: keys).base64URLEncodedString()
    }

    static func signDeviceRevocation(
        userId: String,
        requestingDeviceId: String,
        targetDeviceId: String,
        keys: HammyDeviceKeys
    ) throws -> String {
        try sign(canonicalFields([
            "hammy.device-revocation.signature.v1",
            userId,
            requestingDeviceId,
            targetDeviceId,
        ]), keys: keys).base64URLEncodedString()
    }

    static func signSessionArchive(
        userId: String,
        sessionId: String,
        senderDeviceId: String,
        keys: HammyDeviceKeys
    ) throws -> String {
        try sign(canonicalFields([
            "hammy.session-archive.signature.v1",
            userId,
            sessionId,
            senderDeviceId,
        ]), keys: keys).base64URLEncodedString()
    }

    private struct EventContext {
        var userId: String
        var sessionId: String
        var messageId: String
        var senderDeviceId: String
        var notificationHint: HammyNotificationHint
    }

    private struct SessionMetadataContext {
        var userId: String
        var sessionId: String
        var senderDeviceId: String
    }

    private struct KeyPackageContext {
        var userId: String
        var sessionId: String
        var senderDeviceId: String
        var recipientDeviceId: String
    }

    private static func seal(
        _ plaintext: Data,
        key: Data,
        nonce: Data? = nil,
        associatedData: Data
    ) throws -> (nonce: Data, ciphertext: Data) {
        guard key.count == 32 else { throw HammyE2EEError.invalidKeyLength }
        let nonce = try nonce.map(ChaChaPoly.Nonce.init(data:)) ?? ChaChaPoly.Nonce()
        let sealed = try ChaChaPoly.seal(
            plaintext,
            using: SymmetricKey(data: key),
            nonce: nonce,
            authenticating: associatedData
        )
        return (nonce.dataRepresentation, sealed.ciphertext + sealed.tag)
    }

    private static func open(_ envelope: HammySignedCiphertext, key: Data, associatedData: Data) throws -> Data {
        guard key.count == 32 else { throw HammyE2EEError.invalidKeyLength }
        let combined = try Data(base64URLEncoded: envelope.ciphertext)
        guard combined.count >= 16 else { throw HammyE2EEError.invalidCiphertext }
        let box = try ChaChaPoly.SealedBox(
            nonce: ChaChaPoly.Nonce(data: Data(base64URLEncoded: envelope.nonce)),
            ciphertext: combined.dropLast(16),
            tag: combined.suffix(16)
        )
        do {
            return try ChaChaPoly.open(
                box,
                using: SymmetricKey(data: key),
                authenticating: associatedData
            )
        } catch {
            throw HammyE2EEError.invalidCiphertext
        }
    }

    private static func sign(_ payload: Data, keys: HammyDeviceKeys) throws -> Data {
        let privateKey = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(base64URLEncoded: keys.signingPrivateKey)
        )
        return try privateKey.signature(for: payload)
    }

    private static func verify(signature: String, publicKey: String, payload: Data) throws {
        let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: Data(base64URLEncoded: publicKey))
        guard publicKey.isValidSignature(try Data(base64URLEncoded: signature), for: payload) else {
            throw HammyE2EEError.invalidSignature
        }
    }

    private static func eventAAD(context: EventContext, envelope: HammySignedCiphertext) -> Data {
        canonicalFields([
            "hammy.event.aad.v1", context.userId, context.sessionId, context.messageId,
            context.senderDeviceId, context.notificationHint.rawValue, String(envelope.version),
            envelope.algorithm, envelope.keyId, envelope.nonce, envelope.clientCreatedAt,
        ])
    }

    private static func eventSignature(context: EventContext, envelope: HammySignedCiphertext) -> Data {
        canonicalFields([
            "hammy.event.signature.v1", context.userId, context.sessionId, context.messageId,
            context.senderDeviceId, context.notificationHint.rawValue, String(envelope.version),
            envelope.algorithm, envelope.keyId, envelope.nonce, envelope.ciphertext,
            envelope.clientCreatedAt,
        ])
    }

    private static func sessionMetadataAAD(context: SessionMetadataContext, envelope: HammySignedCiphertext) -> Data {
        canonicalFields([
            "hammy.session-metadata.aad.v1", context.userId, context.sessionId,
            context.senderDeviceId, String(envelope.version), envelope.algorithm, envelope.keyId,
            envelope.nonce, envelope.clientCreatedAt,
        ])
    }

    private static func sessionMetadataSignature(context: SessionMetadataContext, envelope: HammySignedCiphertext) -> Data {
        canonicalFields([
            "hammy.session-metadata.signature.v1", context.userId, context.sessionId,
            context.senderDeviceId, String(envelope.version), envelope.algorithm, envelope.keyId,
            envelope.nonce, envelope.ciphertext, envelope.clientCreatedAt,
        ])
    }

    private static func keyPackageAAD(context: KeyPackageContext, envelope: HammyKeyPackageEnvelope) -> Data {
        canonicalFields([
            "hammy.key-package.aad.v1", context.userId, context.sessionId,
            context.senderDeviceId, context.recipientDeviceId, String(envelope.version),
            envelope.algorithm, envelope.keyId, envelope.ephemeralPublicKey, envelope.salt,
            envelope.nonce, envelope.createdAt,
        ])
    }

    private static func keyPackageSignature(context: KeyPackageContext, envelope: HammyKeyPackageEnvelope) -> Data {
        canonicalFields([
            "hammy.key-package.signature.v1", context.userId, context.sessionId,
            context.senderDeviceId, context.recipientDeviceId, String(envelope.version),
            envelope.algorithm, envelope.keyId, envelope.ephemeralPublicKey, envelope.salt,
            envelope.nonce, envelope.ciphertext, envelope.createdAt,
        ])
    }

    private static func keyPackageKDFInfo(context: KeyPackageContext, keyId: String) -> Data {
        canonicalFields([
            "hammy.key-package.kdf.v1", context.userId, context.sessionId,
            context.senderDeviceId, context.recipientDeviceId, keyId,
        ])
    }

    private static func canonicalFields(_ fields: [String]) -> Data {
        var value = "hammy-canonical-v1\n"
        for field in fields {
            value += "\(field.lengthOfBytes(using: .utf8)):\(field)"
        }
        return Data(value.utf8)
    }

    private static func isoTimestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }
}

final class HammyKeyVault {
    private let service = "com.ben.Hammy.e2ee.v1"

    func loadOrCreateDeviceKeys() throws -> HammyDeviceKeys {
        if let data = try read(account: "device-keys") {
            return try JSONDecoder().decode(HammyDeviceKeys.self, from: data)
        }
        let keys = HammyDeviceKeys.generate()
        try write(try JSONEncoder().encode(keys), account: "device-keys")
        return keys
    }

    func storeSessionKey(_ key: Data, keyId: String) throws {
        guard key.count == 32 else { throw HammyE2EEError.invalidKeyLength }
        try write(key, account: "session-key.\(keyId)")
    }

    func sessionKey(keyId: String) throws -> Data? {
        try read(account: "session-key.\(keyId)")
    }

    func deleteSessionKey(keyId: String) throws {
        let status = SecItemDelete(baseQuery(account: "session-key.\(keyId)") as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw HammyE2EEError.keychain(status)
        }
    }

    func storeRelayCredentials(_ credentials: HammyRelayCredentials) throws {
        try write(try JSONEncoder().encode(credentials), account: "relay-credentials")
    }

    func relayCredentials() throws -> HammyRelayCredentials? {
        guard let data = try read(account: "relay-credentials") else { return nil }
        return try JSONDecoder().decode(HammyRelayCredentials.self, from: data)
    }

    private func read(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw HammyE2EEError.keychain(status)
        }
        return data
    }

    private func write(_ data: Data, account: String) throws {
        let query = baseQuery(account: account)
        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else { throw HammyE2EEError.keychain(updateStatus) }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw HammyE2EEError.keychain(addStatus) }
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

private extension SymmetricKey {
    var dataRepresentation: Data {
        withUnsafeBytes { Data($0) }
    }
}

private extension ChaChaPoly.Nonce {
    var dataRepresentation: Data {
        withUnsafeBytes { Data($0) }
    }
}

private extension Data {
    init(base64URLEncoded value: String) throws {
        guard value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            throw HammyE2EEError.invalidEncoding
        }
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let decoded = Data(base64Encoded: base64), decoded.base64URLEncodedString() == value else {
            throw HammyE2EEError.invalidEncoding
        }
        self = decoded
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
