import Foundation

struct HammyRelayCredentials: Codable, Equatable {
    var userId: String
    var deviceId: String
    var accessToken: String
    var refreshToken: String
}

enum HammyRelayError: LocalizedError {
    case response(String)
    case pairingPending
    case missingKeys

    var errorDescription: String? {
        switch self {
        case .response(let message): message
        case .pairingPending: "Waiting for Hammy Companion to approve this iPhone. Keep it open and try again in a moment."
        case .missingKeys: "Hammy is still waiting for the encrypted session key from your companion."
        }
    }
}

struct HammyRelayDevice: Codable {
    var id: String
    var name: String
    var platform: String
    var agreementPublicKey: String
    var signingPublicKey: String
    var trustState: String
}

private struct HammyRelayDevicesResponse: Codable { var devices: [HammyRelayDevice] }
private struct HammyRelaySessionsResponse: Codable { var sessions: [HammyRelaySessionRecord] }
private struct HammyRelayKeyPackagesResponse: Codable { var keyPackages: [HammyRelayKeyPackageRecord] }
private struct HammyRelayEventsResponse: Codable { var events: [HammyRelayEvent] }

private struct HammyRelaySessionRecord: Codable {
    var id: String
    var senderDeviceId: String
    var encryptedMetadata: HammySignedCiphertext
    var archivedAt: String?
    var updatedAt: String
}

private struct HammyRelayKeyPackageRecord: Codable {
    var sessionId: String
    var senderDeviceId: String
    var envelope: HammyKeyPackageEnvelope
}

private struct HammyPairClaimResponse: Codable { var pairingId: String }
struct HammyPairLobbyResponse: Codable {
    var lobbyId: String
    var code: String
    var expiresAt: String
}
private struct HammyPairCompleteResponse: Codable {
    var userId: String
    var device: HammyRelayDevice
    var tokens: HammyRelayTokens
}
private struct HammyRelayTokens: Codable { var accessToken: String; var refreshToken: String }

/// This is the only plaintext schema carried inside Hammy's encrypted relay envelopes.
/// The relay itself sees neither these fields nor their contents.
struct HammyRelayMetadata: Codable {
    var title: String
    var projectName: String
    var promptPreview: String
    var model: ModelChoice
    var intelligence: IntelligenceLevel
    var commandsAllowed: Bool
    var pluginsAllowed: Bool
}

struct HammyRelayPayload: Codable {
    var kind: String
    var state: HammyWorkState?
    var progress: Double?
    var latestUpdate: String?
    var agentCount: Int?
    var message: ChatMessage?
}

@MainActor
final class HammyRelayService: ObservableObject {
    @Published private(set) var isPaired = false
    @Published private(set) var isSyncing = false
    @Published private(set) var lastError: String?

    private let vault = HammyKeyVault()
    private let defaults = UserDefaults.standard
    private let baseURL = URL(string: "https://backend.yzycoin.app")!

    init() {
        isPaired = (try? vault.relayCredentials()) != nil
    }

    func pair(with code: String, deviceName: String) async throws {
        let normalizedCode = code.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedCode.range(of: "^[A-HJ-NP-Z2-9]{12}$", options: .regularExpression) != nil else {
            throw HammyRelayError.response("Enter the 12-character pairing code shown in Hammy Companion.")
        }
        let keys = try vault.loadOrCreateDeviceKeys()
        let publicKeys = try keys.publicBundle
        let claim: HammyPairClaimResponse = try await request(
            path: "/v1/pairings/claim",
            method: "POST",
            body: ["code": normalizedCode, "device": [
                "name": deviceName,
                "platform": "ios",
                "agreementPublicKey": publicKeys.agreementPublicKey,
                "signingPublicKey": publicKeys.signingPublicKey,
            ]]
        )
        defaults.set(claim.pairingId, forKey: "pendingPairingID")
        defaults.set(normalizedCode, forKey: "pendingPairingCode")
        defaults.set("legacy", forKey: "pendingPairingKind")
    }

    /// Starts the phone side of a remote rendezvous. The relay exposes only an
    /// opaque lobby ID to signed-in companions; the 12-character code shown here
    /// is still required before it can attach this phone to an account.
    func openPairingLobby(deviceName: String) async throws -> HammyPairLobbyResponse {
        let keys = try vault.loadOrCreateDeviceKeys()
        let publicKeys = try keys.publicBundle
        let lobby: HammyPairLobbyResponse = try await request(
            path: "/v1/pairing-lobbies",
            method: "POST",
            body: ["device": [
                "name": deviceName,
                "platform": "ios",
                "agreementPublicKey": publicKeys.agreementPublicKey,
                "signingPublicKey": publicKeys.signingPublicKey,
            ]]
        )
        defaults.set(lobby.lobbyId, forKey: "pendingPairingID")
        defaults.set(lobby.code, forKey: "pendingPairingCode")
        defaults.set("lobby", forKey: "pendingPairingKind")
        return lobby
    }

    func finishPairingIfReady() async throws -> Bool {
        guard let pairingId = defaults.string(forKey: "pendingPairingID"),
              let code = defaults.string(forKey: "pendingPairingCode") else { return isPaired }
        let kind = defaults.string(forKey: "pendingPairingKind") ?? "legacy"
        let completionPath = kind == "lobby" ? "/v1/pairing-lobbies" : "/v1/pairings"
        do {
            let result: HammyPairCompleteResponse = try await request(
                path: "\(completionPath)/\(pairingId)/complete?code=\(code)",
                method: "GET"
            )
            try vault.storeRelayCredentials(HammyRelayCredentials(
                userId: result.userId,
                deviceId: result.device.id,
                accessToken: result.tokens.accessToken,
                refreshToken: result.tokens.refreshToken
            ))
            defaults.removeObject(forKey: "pendingPairingID")
            defaults.removeObject(forKey: "pendingPairingCode")
            defaults.removeObject(forKey: "pendingPairingKind")
            isPaired = true
            return true
        } catch let error as HammyRelayError where error.errorDescription?.contains("awaiting") == true {
            return false
        }
    }

    func sync() async throws -> [ChatSession] {
        guard let credentials = try vault.relayCredentials() else { throw HammyRelayError.response("Pair Hammy Companion first.") }
        isSyncing = true
        defer { isSyncing = false }
        do {
            let devices: HammyRelayDevicesResponse = try await authorizedRequest(path: "/v1/devices", credentials: credentials)
            let deviceByID = Dictionary(uniqueKeysWithValues: devices.devices.map { ($0.id, $0) })
            let packages: HammyRelayKeyPackagesResponse = try await authorizedRequest(path: "/v1/key-packages", credentials: credentials)
            let keys = try vault.loadOrCreateDeviceKeys()
            for package in packages.keyPackages {
                guard let sender = deviceByID[package.senderDeviceId] else { continue }
                let key = try HammyE2EE.unwrapSessionKey(
                    package.envelope,
                    userId: credentials.userId,
                    sessionId: package.sessionId,
                    senderDeviceId: package.senderDeviceId,
                    recipientDeviceId: credentials.deviceId,
                    senderSigningPublicKey: sender.signingPublicKey,
                    recipientKeys: keys
                )
                try vault.storeSessionKey(key, keyId: package.envelope.keyId)
            }

            let response: HammyRelaySessionsResponse = try await authorizedRequest(path: "/v1/sessions?includeArchived=true", credentials: credentials)
            var result: [ChatSession] = []
            for record in response.sessions {
                guard let sessionID = UUID(uuidString: record.id),
                      let sender = deviceByID[record.senderDeviceId],
                      let key = try vault.sessionKey(keyId: record.encryptedMetadata.keyId) else { continue }
                let metadataData = try HammyE2EE.decryptSessionMetadata(
                    record.encryptedMetadata,
                    sessionKey: key,
                    senderSigningPublicKey: sender.signingPublicKey,
                    userId: credentials.userId,
                    sessionId: record.id,
                    senderDeviceId: record.senderDeviceId
                )
                defaults.set(record.encryptedMetadata.keyId, forKey: "sessionKeyID.\(record.id)")
                let metadata = try JSONDecoder().decode(HammyRelayMetadata.self, from: metadataData)
                var session = ChatSession(
                    id: sessionID,
                    title: metadata.title,
                    projectName: metadata.projectName,
                    promptPreview: metadata.promptPreview,
                    progress: record.archivedAt == nil ? 0 : 1,
                    latestUpdate: record.archivedAt == nil ? "Waiting for the next encrypted update." : "Archived",
                    state: record.archivedAt == nil ? .idle : .complete,
                    agentCount: 0,
                    model: metadata.model,
                    intelligence: metadata.intelligence,
                    commandsAllowed: metadata.commandsAllowed,
                    pluginsAllowed: metadata.pluginsAllowed,
                    updatedAt: ISO8601DateFormatter().date(from: record.updatedAt) ?? Date(),
                    messages: []
                )
                let events: HammyRelayEventsResponse = try await authorizedRequest(path: "/v1/sessions/\(record.id)/events?limit=500", credentials: credentials)
                for event in events.events {
                    guard let eventSender = deviceByID[event.senderDeviceId] else { continue }
                    let plaintext = try HammyE2EE.decryptEvent(
                        event.envelope,
                        sessionKey: key,
                        senderSigningPublicKey: eventSender.signingPublicKey,
                        userId: credentials.userId,
                        sessionId: record.id,
                        messageId: event.messageId,
                        senderDeviceId: event.senderDeviceId,
                        notificationHint: event.notificationHint
                    )
                    let decoder = JSONDecoder()
                    decoder.dateDecodingStrategy = .iso8601
                    let payload = try decoder.decode(HammyRelayPayload.self, from: plaintext)
                    apply(payload, to: &session)
                }
                result.append(session)
            }
            lastError = nil
            return result.sorted { $0.updatedAt > $1.updatedAt }
        } catch {
            lastError = error.localizedDescription
            throw error
        }
    }

    func sendMainPrompt(_ text: String, to sessionID: UUID) async throws {
        let message = ChatMessage(role: .user, text: text, timestamp: Date())
        try await send(
            HammyRelayPayload(
                kind: "mainPrompt", state: .thinking, progress: 0.01,
                latestUpdate: "Your prompt was securely delivered to Hammy Companion.", agentCount: 0, message: message
            ),
            to: sessionID
        )
    }

    func sendAside(_ text: String, to sessionID: UUID) async throws {
        let message = ChatMessage(role: .user, text: text, timestamp: Date(), isAside: true)
        try await send(HammyRelayPayload(kind: "aside", state: nil, progress: nil, latestUpdate: nil, agentCount: nil, message: message), to: sessionID)
    }

    func approveCommand(in sessionID: UUID) async throws {
        try await send(HammyRelayPayload(kind: "approval", state: nil, progress: nil, latestUpdate: nil, agentCount: nil, message: nil), to: sessionID)
    }

    private func send(_ payload: HammyRelayPayload, to sessionID: UUID) async throws {
        guard let credentials = try vault.relayCredentials(),
              let keyId = defaults.string(forKey: "sessionKeyID.\(sessionID.uuidString.lowercased())"),
              let sessionKey = try vault.sessionKey(keyId: keyId) else { throw HammyRelayError.missingKeys }
        let keys = try vault.loadOrCreateDeviceKeys()
        let messageID = UUID().uuidString.lowercased()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let plaintext = try encoder.encode(payload)
        let envelope = try HammyE2EE.encryptEvent(
            plaintext,
            sessionKey: sessionKey,
            keyId: keyId,
            userId: credentials.userId,
            sessionId: sessionID.uuidString.lowercased(),
            messageId: messageID,
            senderDeviceId: credentials.deviceId,
            notificationHint: .generic,
            keys: keys
        )
        let body = try encoder.encode(HammyEventWrite(messageId: messageID, notificationHint: "generic", envelope: envelope))
        try await rawRequest(
            path: "/v1/sessions/\(sessionID.uuidString.lowercased())/events",
            method: "POST",
            body: body,
            accessToken: credentials.accessToken
        )
    }

    private func apply(_ payload: HammyRelayPayload, to session: inout ChatSession) {
        if let state = payload.state { session.state = state }
        if let progress = payload.progress { session.progress = progress }
        if let latestUpdate = payload.latestUpdate { session.latestUpdate = latestUpdate }
        if let agentCount = payload.agentCount { session.agentCount = agentCount }
        if let message = payload.message, !session.messages.contains(where: { $0.id == message.id }) {
            session.messages.append(message)
        }
        session.updatedAt = Date()
    }

    private func authorizedRequest<Response: Decodable>(path: String, credentials: HammyRelayCredentials) async throws -> Response {
        try await request(path: path, method: "GET", accessToken: credentials.accessToken)
    }

    private func request<Response: Decodable>(path: String, method: String, body: [String: Any]? = nil, accessToken: String? = nil) async throws -> Response {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let split = path.split(separator: "?", maxSplits: 1).map(String.init)
        components.path = "/" + split[0].trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.percentEncodedQuery = split.count > 1 ? split[1] : nil
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let accessToken { request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw HammyRelayError.response("The relay did not return an HTTP response.") }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? [String: Any]
            throw HammyRelayError.response(message?["message"] as? String ?? "Relay request failed (\(http.statusCode)).")
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }

    private func rawRequest(path: String, method: String, body: Data, accessToken: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? [String: Any]
            throw HammyRelayError.response(message?["message"] as? String ?? "Hammy could not send your message.")
        }
    }
}

private struct HammyEventWrite: Codable {
    var messageId: String
    var notificationHint: String
    var envelope: HammySignedCiphertext
}
