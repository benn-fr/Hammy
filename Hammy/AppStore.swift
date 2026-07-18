import ActivityKit
import SwiftUI
import UIKit

@MainActor
final class AppStore: ObservableObject {
    static let productionRelayURL = "https://backend.yzycoin.app"

    @Published var sessions: [ChatSession] = []
    @Published var updates: [SessionUpdate] = []
    @Published var appearance: AppearanceMode
    @Published var personality: HammyPersonality
    @Published var hammyColor: HammyColorChoice
    @Published var notificationsGranted = false
    @Published var bridgeURL: String
    @Published private(set) var connectionMessage = "Pair Hammy Companion to begin."

    let liveActivity = LiveActivityManager()
    let relay = HammyRelayService()

    private var syncTask: Task<Void, Never>?
    private let defaults = UserDefaults.standard

    init() {
        appearance = AppearanceMode(rawValue: defaults.string(forKey: "appearance") ?? "") ?? .system
        personality = HammyPersonality(rawValue: defaults.string(forKey: "personality") ?? "") ?? .cheerful
        hammyColor = HammyColorChoice(rawValue: defaults.string(forKey: "hammyColor") ?? "") ?? .cyan
        bridgeURL = defaults.string(forKey: "bridgeURL") ?? Self.productionRelayURL
    }

    deinit { syncTask?.cancel() }

    var preferredColorScheme: ColorScheme? {
        switch appearance { case .system: nil; case .light: .light; case .dark: .dark }
    }

    var activeSessions: [ChatSession] { sessions.filter(\.isActive) }
    var featuredSession: ChatSession? { activeSessions.first ?? sessions.first }

    func session(id: UUID) -> ChatSession? { sessions.first(where: { $0.id == id }) }

    func startRemotePairing() async throws -> String {
        connectionMessage = "Creating a secure pairing request…"
        let lobby = try await relay.openPairingLobby(deviceName: UIDevice.current.name)
        connectionMessage = "Enter the matching code in Hammy Companion."
        return lobby.code
    }

    func finishRemotePairingIfReady() async throws -> Bool {
        guard try await relay.finishPairingIfReady() else { return false }
        connectionMessage = "Paired — syncing encrypted sessions."
        await syncFromRelay()
        startSyncLoop()
        return true
    }

    func startSyncLoop() {
        guard relay.isPaired, syncTask == nil else { return }
        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.syncFromRelay()
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
    }

    func syncFromRelay() async {
        guard relay.isPaired else { return }
        do {
            let previousByID = Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) })
            let fresh = try await relay.sync()
            sessions = fresh
            updates = fresh.flatMap { session in
                session.messages.filter { $0.role == .update || $0.role == .assistant }.map {
                    SessionUpdate(sessionID: session.id, sessionTitle: session.title, text: $0.text, state: session.state, timestamp: $0.timestamp)
                }
            }.sorted { $0.timestamp > $1.timestamp }
            connectionMessage = fresh.isEmpty ? "Connected. Start a Codex session in Hammy Companion to see it here." : "Encrypted relay connected."
            if let featuredSession, previousByID[featuredSession.id]?.state != featuredSession.state {
                if featuredSession.state == .waitingApproval {
                    await NotificationService.shared.scheduleApprovalNeeded(for: featuredSession)
                }
                if liveActivity.isRunning {
                    await liveActivity.update(with: featuredSession)
                } else {
                    await liveActivity.start(for: featuredSession)
                }
            }
        } catch {
            connectionMessage = error.localizedDescription
        }
    }

    func requestNotificationPermission() async { notificationsGranted = await NotificationService.shared.requestAuthorization() }
    func refreshPermissionState() async { notificationsGranted = await NotificationService.shared.currentAuthorizationGranted() }

    func completeOnboarding() async {
        defaults.set(true, forKey: "hasCompletedOnboarding")
        await syncFromRelay()
        startSyncLoop()
        if let featuredSession { await liveActivity.start(for: featuredSession) }
    }

    func startLiveActivity(sessionID: UUID) async {
        guard let session = session(id: sessionID) else { return }
        await liveActivity.start(for: session)
    }

    func sendMainPrompt(_ text: String, to sessionID: UUID) async throws {
        try await relay.sendMainPrompt(text, to: sessionID)
        await syncFromRelay()
    }

    func sendAside(_ text: String, to sessionID: UUID) async throws {
        try await relay.sendAside(text, to: sessionID)
        await syncFromRelay()
    }

    func approve(sessionID: UUID) async throws {
        try await relay.approveCommand(in: sessionID)
        await syncFromRelay()
    }

    func persistPreferences() {
        defaults.set(appearance.rawValue, forKey: "appearance")
        defaults.set(personality.rawValue, forKey: "personality")
        defaults.set(hammyColor.rawValue, forKey: "hammyColor")
        defaults.set(bridgeURL, forKey: "bridgeURL")
    }

    func resetOnboarding() { defaults.set(false, forKey: "hasCompletedOnboarding") }
}
