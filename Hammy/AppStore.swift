import ActivityKit
import SwiftUI

@MainActor
final class AppStore: ObservableObject {
    static let productionRelayURL = "https://backend.yzycoin.app"

    @Published var sessions: [ChatSession] = DemoData.sessions
    @Published var updates: [SessionUpdate] = []
    @Published var appearance: AppearanceMode
    @Published var personality: HammyPersonality
    @Published var hammyColor: HammyColorChoice
    @Published var notificationsGranted = false
    @Published var commandsAllowed: Bool
    @Published var pluginsAllowed: Bool
    @Published var bridgeURL: String
    @Published var isPreviewSignedIn = false
    @Published var usage = UsageSnapshot.demo

    let liveActivity = LiveActivityManager()
    let bridge = CodexBridgeClient()

    private var demoTask: Task<Void, Never>?
    private let defaults = UserDefaults.standard

    init() {
        appearance = AppearanceMode(rawValue: defaults.string(forKey: "appearance") ?? "") ?? .system
        personality = HammyPersonality(rawValue: defaults.string(forKey: "personality") ?? "") ?? .cheerful
        hammyColor = HammyColorChoice(rawValue: defaults.string(forKey: "hammyColor") ?? "") ?? .cyan
        commandsAllowed = defaults.object(forKey: "commandsAllowed") as? Bool ?? true
        pluginsAllowed = defaults.object(forKey: "pluginsAllowed") as? Bool ?? true
        bridgeURL = defaults.string(forKey: "bridgeURL") ?? Self.productionRelayURL
        updates = sessions.flatMap { session in
            session.messages
                .filter { $0.role == .update || $0.role == .assistant }
                .map {
                    SessionUpdate(
                        sessionID: session.id,
                        sessionTitle: session.title,
                        text: $0.text,
                        state: session.state,
                        timestamp: $0.timestamp
                    )
                }
        }.sorted { $0.timestamp > $1.timestamp }
    }

    deinit {
        demoTask?.cancel()
    }

    var preferredColorScheme: ColorScheme? {
        switch appearance {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    var activeSessions: [ChatSession] {
        sessions.filter(\.isActive)
    }

    var featuredSession: ChatSession? {
        sessions.first(where: { $0.id == DemoData.primarySessionID }) ?? activeSessions.first
    }

    func session(id: UUID) -> ChatSession? {
        sessions.first(where: { $0.id == id })
    }

    func beginDemoLoop() {
        guard demoTask == nil else { return }
        demoTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_200_000_000)
                guard !Task.isCancelled else { return }
                await self?.advanceFeaturedSession()
            }
        }
    }

    func stopDemoLoop() {
        demoTask?.cancel()
        demoTask = nil
    }

    func previewSignIn() async {
        try? await Task.sleep(nanoseconds: 650_000_000)
        isPreviewSignedIn = true
    }

    func requestNotificationPermission() async {
        notificationsGranted = await NotificationService.shared.requestAuthorization()
    }

    func refreshPermissionState() async {
        notificationsGranted = await NotificationService.shared.currentAuthorizationGranted()
    }

    func completeOnboarding() async {
        defaults.set(true, forKey: "hasCompletedOnboarding")
        beginDemoLoop()
        if let featuredSession {
            await liveActivity.start(for: featuredSession)
        }
    }

    func startLiveActivity(sessionID: UUID) async {
        guard let session = session(id: sessionID) else { return }
        await liveActivity.start(for: session)
    }

    func testApprovalNotification() async {
        guard let session = sessions.first(where: { $0.state == .waitingApproval }) else { return }
        await NotificationService.shared.scheduleApprovalNeeded(for: session)
    }

    func approve(sessionID: UUID) {
        mutateSession(id: sessionID) { session in
            session.commandsAllowed = true
            session.state = .typing
            session.progress = max(session.progress, 0.84)
            session.latestUpdate = "Approved — Hammy is back at the keyboard."
            session.updatedAt = Date()
            session.messages.append(
                ChatMessage(role: .update, text: session.latestUpdate, timestamp: Date())
            )
        }
    }

    func sendMainPrompt(_ text: String, to sessionID: UUID) {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return }
        mutateSession(id: sessionID) { session in
            session.messages.append(ChatMessage(role: .user, text: cleaned, timestamp: Date()))
            session.promptPreview = cleaned
            session.progress = 0.04
            session.state = .thinking
            session.latestUpdate = "Hammy is mapping out the new request."
            session.updatedAt = Date()
        }
        usage.mainPromptCount += 1
        usage.mainPromptTokens += max(18, cleaned.count / 3)
    }

    func sendAside(_ text: String, to sessionID: UUID) async {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return }
        mutateSession(id: sessionID) { session in
            session.messages.append(
                ChatMessage(role: .user, text: cleaned, timestamp: Date(), isAside: true)
            )
        }
        try? await Task.sleep(nanoseconds: 420_000_000)

        let response: String
        if cleaned.lowercased().contains("status") {
            let progress = Int((session(id: sessionID)?.clampedProgress ?? 0) * 100)
            response = "Quick aside: the main run is about \(progress)% complete. I left it running exactly as-is."
        } else if cleaned.lowercased().contains("why") {
            response = "My quick read: that choice keeps the main thread simpler and lowers the chance of duplicated work."
        } else {
            response = "Got it — I checked that on the side without interrupting the main prompt."
        }

        mutateSession(id: sessionID) { session in
            session.messages.append(
                ChatMessage(role: .hammy, text: response, timestamp: Date(), isAside: true)
            )
        }
        usage.hammyAsideCount += 1
        usage.hammyTokens += max(12, (cleaned.count + response.count) / 3)
    }

    func setModel(_ model: ModelChoice, sessionID: UUID) {
        mutateSession(id: sessionID) { $0.model = model }
    }

    func setIntelligence(_ intelligence: IntelligenceLevel, sessionID: UUID) {
        mutateSession(id: sessionID) { $0.intelligence = intelligence }
    }

    func toggleCommands(sessionID: UUID) {
        mutateSession(id: sessionID) { session in
            session.commandsAllowed.toggle()
            session.latestUpdate = session.commandsAllowed
                ? "Command use is allowed for this session."
                : "Command use is paused for this session."
            session.updatedAt = Date()
        }
    }

    func togglePlugins(sessionID: UUID) {
        mutateSession(id: sessionID) { session in
            session.pluginsAllowed.toggle()
            session.latestUpdate = session.pluginsAllowed
                ? "Plugin use is allowed for this session."
                : "Plugin use is paused for this session."
            session.updatedAt = Date()
        }
    }

    func persistPreferences() {
        defaults.set(appearance.rawValue, forKey: "appearance")
        defaults.set(personality.rawValue, forKey: "personality")
        defaults.set(hammyColor.rawValue, forKey: "hammyColor")
        defaults.set(commandsAllowed, forKey: "commandsAllowed")
        defaults.set(pluginsAllowed, forKey: "pluginsAllowed")
        defaults.set(bridgeURL, forKey: "bridgeURL")
    }

    func resetOnboarding() {
        defaults.set(false, forKey: "hasCompletedOnboarding")
    }

    private func advanceFeaturedSession() async {
        guard let index = sessions.firstIndex(where: { $0.id == DemoData.primarySessionID }) else { return }
        guard sessions[index].state != .complete else { return }

        sessions[index].progress = min(sessions[index].progress + 0.025, 1)
        let progress = sessions[index].progress
        switch progress {
        case ..<0.18:
            sessions[index].state = .thinking
            sessions[index].agentCount = 0
            sessions[index].latestUpdate = "Thinking through the cleanest implementation path."
        case ..<0.45:
            sessions[index].state = .typing
            sessions[index].agentCount = 0
            sessions[index].latestUpdate = "Writing the next piece and checking it as I go."
        case ..<0.58:
            sessions[index].state = .compacting
            sessions[index].agentCount = 0
            sessions[index].latestUpdate = "Rolling older context into a compact working note."
        case ..<0.78:
            sessions[index].state = .delegating
            sessions[index].agentCount = 3
            sessions[index].latestUpdate = "Three helper agents are checking layout, behavior, and polish."
        case ..<1:
            sessions[index].state = .typing
            sessions[index].agentCount = 0
            sessions[index].latestUpdate = "Pulling the results together for the final pass."
        default:
            sessions[index].state = .complete
            sessions[index].agentCount = 0
            sessions[index].latestUpdate = "Finished — everything is ready to review."
            sessions[index].messages.append(
                ChatMessage(role: .assistant, text: sessions[index].latestUpdate, timestamp: Date())
            )
        }
        sessions[index].updatedAt = Date()
        await liveActivity.update(with: sessions[index])
    }

    private func mutateSession(id: UUID, mutation: (inout ChatSession) -> Void) {
        guard let index = sessions.firstIndex(where: { $0.id == id }) else { return }
        mutation(&sessions[index])
        let session = sessions[index]
        updates.insert(
            SessionUpdate(
                sessionID: session.id,
                sessionTitle: session.title,
                text: session.latestUpdate,
                state: session.state,
                timestamp: Date()
            ),
            at: 0
        )
        Task { await liveActivity.update(with: session) }
    }
}
