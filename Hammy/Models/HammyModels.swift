import Foundation

enum ChatRole: String, Codable, Hashable {
    case user
    case assistant
    case hammy
    case update
}

struct ChatMessage: Identifiable, Codable, Hashable {
    var id = UUID()
    var role: ChatRole
    var text: String
    var timestamp: Date
    var isAside: Bool = false
}

enum ModelChoice: String, CaseIterable, Identifiable, Codable {
    case automatic = "Auto"
    case frontier = "Frontier"
    case balanced = "Balanced"
    case fast = "Fast"

    var id: String { rawValue }

    var detail: String {
        switch self {
        case .automatic: "Let the connected host choose"
        case .frontier: "Best for complex work"
        case .balanced: "Quality and speed"
        case .fast: "Quick iterations"
        }
    }
}

enum IntelligenceLevel: String, CaseIterable, Identifiable, Codable {
    case standard = "Standard"
    case high = "High"
    case max = "Max"

    var id: String { rawValue }
}

enum AppearanceMode: String, CaseIterable, Identifiable, Codable {
    case system = "System"
    case light = "Light"
    case dark = "Dark"

    var id: String { rawValue }
}

enum HammyPersonality: String, CaseIterable, Identifiable, Codable {
    case cheerful = "Cheerful"
    case focused = "Focused"
    case playful = "Playful"
    case calm = "Calm"

    var id: String { rawValue }

    var greeting: String {
        switch self {
        case .cheerful: "Bright, encouraging, and concise"
        case .focused: "Direct, practical, and precise"
        case .playful: "Curious, witty, and upbeat"
        case .calm: "Gentle, patient, and reassuring"
        }
    }
}

enum HammyColorChoice: String, CaseIterable, Identifiable, Codable {
    case cyan = "Cyan"
    case violet = "Violet"
    case mint = "Mint"
    case coral = "Coral"
    case gold = "Gold"

    var id: String { rawValue }
}

struct ChatSession: Identifiable, Codable, Hashable {
    var id: UUID
    var title: String
    var projectName: String
    var promptPreview: String
    var progress: Double
    var latestUpdate: String
    var state: HammyWorkState
    var agentCount: Int
    var model: ModelChoice
    var intelligence: IntelligenceLevel
    var commandsAllowed: Bool
    var pluginsAllowed: Bool
    var updatedAt: Date
    var messages: [ChatMessage]

    var isActive: Bool {
        state != .complete && state != .idle
    }

    var clampedProgress: Double {
        min(max(progress, 0), 1)
    }
}

struct SessionUpdate: Identifiable, Hashable {
    var id = UUID()
    var sessionID: UUID
    var sessionTitle: String
    var text: String
    var state: HammyWorkState
    var timestamp: Date
}

struct UsageSnapshot: Hashable {
    var mainPromptTokens: Int
    var hammyTokens: Int
    var mainPromptCount: Int
    var hammyAsideCount: Int

    static let demo = UsageSnapshot(
        mainPromptTokens: 128_420,
        hammyTokens: 3_840,
        mainPromptCount: 24,
        hammyAsideCount: 17
    )
}

enum DemoData {
    static let primarySessionID = UUID(uuidString: "4AC0EC7D-04FD-4FB3-B17A-E775931A21FA")!

    static var sessions: [ChatSession] {
        let now = Date()
        return [
            ChatSession(
                id: primarySessionID,
                title: "Ship Hammy Live Activity",
                projectName: "Hammy iOS",
                promptPreview: "Build a polished Dynamic Island experience for every agent state.",
                progress: 0.64,
                latestUpdate: "Three helper agents are polishing the compact layout.",
                state: .delegating,
                agentCount: 3,
                model: .automatic,
                intelligence: .high,
                commandsAllowed: true,
                pluginsAllowed: true,
                updatedAt: now.addingTimeInterval(-46),
                messages: [
                    ChatMessage(role: .user, text: "Build a polished Dynamic Island experience for every agent state.", timestamp: now.addingTimeInterval(-620)),
                    ChatMessage(role: .update, text: "I mapped thinking, typing, compacting, delegation, approval, and completion states.", timestamp: now.addingTimeInterval(-430)),
                    ChatMessage(role: .assistant, text: "The Live Activity shell is in place. I’m refining the compact regions and progress transitions now.", timestamp: now.addingTimeInterval(-180))
                ]
            ),
            ChatSession(
                id: UUID(uuidString: "E3498C6D-0BD0-40C5-8B3E-D0F4A5163B05")!,
                title: "Refactor sync engine",
                projectName: "Orbit Notes",
                promptPreview: "Reduce duplicate network work and keep offline edits safe.",
                progress: 0.38,
                latestUpdate: "Context is being compacted before the next implementation pass.",
                state: .compacting,
                agentCount: 0,
                model: .balanced,
                intelligence: .high,
                commandsAllowed: true,
                pluginsAllowed: false,
                updatedAt: now.addingTimeInterval(-210),
                messages: [
                    ChatMessage(role: .user, text: "Reduce duplicate network work and keep offline edits safe.", timestamp: now.addingTimeInterval(-1200)),
                    ChatMessage(role: .update, text: "Read the sync pipeline and identified two redundant fetch paths.", timestamp: now.addingTimeInterval(-540))
                ]
            ),
            ChatSession(
                id: UUID(uuidString: "65DADAFB-8B9C-464B-9DDB-BB6E108421F9")!,
                title: "Review command permissions",
                projectName: "Studio Tools",
                promptPreview: "Audit the release script and fix the signing issue.",
                progress: 0.82,
                latestUpdate: "A release command needs your approval before Hammy can continue.",
                state: .waitingApproval,
                agentCount: 0,
                model: .frontier,
                intelligence: .max,
                commandsAllowed: false,
                pluginsAllowed: true,
                updatedAt: now.addingTimeInterval(-390),
                messages: [
                    ChatMessage(role: .user, text: "Audit the release script and fix the signing issue.", timestamp: now.addingTimeInterval(-1700)),
                    ChatMessage(role: .assistant, text: "I found the mismatch. I’m waiting to run the signing verification command.", timestamp: now.addingTimeInterval(-400))
                ]
            ),
            ChatSession(
                id: UUID(uuidString: "10346D5E-C83A-42D8-A5DF-4819FA7D2ADE")!,
                title: "Landing page accessibility",
                projectName: "Northstar Web",
                promptPreview: "Fix the accessibility findings and summarize the changes.",
                progress: 1,
                latestUpdate: "Finished with all accessibility checks passing.",
                state: .complete,
                agentCount: 0,
                model: .fast,
                intelligence: .standard,
                commandsAllowed: true,
                pluginsAllowed: false,
                updatedAt: now.addingTimeInterval(-7_800),
                messages: [
                    ChatMessage(role: .user, text: "Fix the accessibility findings and summarize the changes.", timestamp: now.addingTimeInterval(-10_000)),
                    ChatMessage(role: .assistant, text: "Done — labels, focus order, contrast, and reduced-motion behavior are all updated.", timestamp: now.addingTimeInterval(-7_800))
                ]
            )
        ]
    }
}

