import ActivityKit
import Foundation

enum HammyWorkState: String, Codable, Hashable, CaseIterable, Identifiable {
    case idle
    case thinking
    case typing
    case compacting
    case delegating
    case waitingApproval
    case complete

    var id: String { rawValue }

    var title: String {
        switch self {
        case .idle: "Ready"
        case .thinking: "Thinking"
        case .typing: "Typing"
        case .compacting: "Compacting context"
        case .delegating: "Coordinating agents"
        case .waitingApproval: "Waiting for you"
        case .complete: "Complete"
        }
    }

    var symbolName: String {
        switch self {
        case .idle: "sparkles"
        case .thinking: "cloud.fill"
        case .typing: "keyboard.fill"
        case .compacting: "scroll.fill"
        case .delegating: "person.3.fill"
        case .waitingApproval: "chair.lounge.fill"
        case .complete: "checkmark.circle.fill"
        }
    }
}

struct HammyActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var progress: Double
        var latestUpdate: String
        var state: HammyWorkState
        var agentCount: Int
        var updatedAt: Date

        var clampedProgress: Double {
            min(max(progress, 0), 1)
        }
    }

    var sessionID: String
    var title: String
    var projectName: String
}

