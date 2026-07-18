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

    static let empty = UsageSnapshot(mainPromptTokens: 0, hammyTokens: 0, mainPromptCount: 0, hammyAsideCount: 0)

}
