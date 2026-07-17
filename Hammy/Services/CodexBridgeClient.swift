import Foundation

enum BridgeConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case failed(String)

    var label: String {
        switch self {
        case .disconnected: "Demo data"
        case .connecting: "Connecting…"
        case .connected: "Encrypted relay connected"
        case .failed(let message): "Connection failed: \(message)"
        }
    }
}

struct HammyRelayEvent: Codable, Identifiable, Equatable {
    var cursor: Int
    var messageId: String
    var userId: String
    var sessionId: String
    var senderDeviceId: String
    var notificationHint: HammyNotificationHint
    var envelope: HammySignedCiphertext
    var receivedAt: String

    var id: String { messageId }
}

private struct RelaySocketFrame: Codable {
    var type: String
    var event: HammyRelayEvent?
    var events: [HammyRelayEvent]?
    var nextCursor: Int?
    var hasMore: Bool?
}

@MainActor
final class CodexBridgeClient: ObservableObject {
    @Published private(set) var state: BridgeConnectionState = .disconnected
    @Published private(set) var latestMethod: String?
    @Published private(set) var lastCursor = 0

    var onEncryptedEvent: ((HammyRelayEvent) -> Void)?

    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?

    func connect(to rawURL: String, bearerToken: String? = nil) {
        disconnect()
        guard let url = relayWebSocketURL(from: rawURL) else {
            state = .failed("Enter an http(s):// or ws(s):// relay URL")
            return
        }
        guard let bearerToken, !bearerToken.isEmpty else {
            state = .failed("An access token is required")
            return
        }

        state = .connecting
        var request = URLRequest(url: url)
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20
        let socket = URLSession.shared.webSocketTask(with: request)
        self.socket = socket
        socket.resume()

        receiveTask = Task { [weak self] in
            guard let self else { return }
            do {
                while !Task.isCancelled {
                    let message = try await socket.receive()
                    let data: Data
                    switch message {
                    case .string(let text): data = Data(text.utf8)
                    case .data(let payload): data = payload
                    @unknown default: continue
                    }
                    let frame = try JSONDecoder().decode(RelaySocketFrame.self, from: data)
                    self.latestMethod = frame.type
                    switch frame.type {
                    case "ready":
                        self.state = .connected
                        for event in frame.events ?? [] {
                            self.accept(event)
                        }
                        self.lastCursor = max(self.lastCursor, frame.nextCursor ?? 0)
                    case "event":
                        if let event = frame.event { self.accept(event) }
                    default:
                        continue
                    }
                }
            } catch {
                if !Task.isCancelled {
                    self.state = .failed(error.localizedDescription)
                }
            }
        }
    }

    func disconnect() {
        receiveTask?.cancel()
        receiveTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        state = .disconnected
    }

    private func accept(_ event: HammyRelayEvent) {
        lastCursor = max(lastCursor, event.cursor)
        onEncryptedEvent?(event)
    }

    private func relayWebSocketURL(from rawURL: String) -> URL? {
        guard var components = URLComponents(string: rawURL), let scheme = components.scheme?.lowercased() else {
            return nil
        }
        switch scheme {
        case "https": components.scheme = "wss"
        case "http": components.scheme = "ws"
        case "wss", "ws": break
        default: return nil
        }
        if components.path.isEmpty || components.path == "/" {
            components.path = "/v1/events/live"
        }
        var queryItems = components.queryItems ?? []
        queryItems.removeAll { $0.name == "after" }
        queryItems.append(URLQueryItem(name: "after", value: String(lastCursor)))
        components.queryItems = queryItems
        return components.url
    }
}
