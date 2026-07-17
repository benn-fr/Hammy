import ActivityKit
import Foundation

@MainActor
final class LiveActivityManager: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var statusMessage = "Live Activity ready"

    private var activity: Activity<HammyActivityAttributes>?

    var activitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    func start(for session: ChatSession) async {
        guard activitiesEnabled else {
            statusMessage = "Live Activities are disabled in Settings"
            return
        }

        if activity != nil {
            await update(with: session)
            return
        }

        let attributes = HammyActivityAttributes(
            sessionID: session.id.uuidString,
            title: session.title,
            projectName: session.projectName
        )
        let content = ActivityContent(
            state: contentState(for: session),
            staleDate: Date().addingTimeInterval(15 * 60)
        )

        do {
            activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
            isRunning = true
            statusMessage = "Showing \(session.title)"
        } catch {
            statusMessage = "Couldn’t start: \(error.localizedDescription)"
        }
    }

    func update(with session: ChatSession) async {
        guard let activity else { return }
        let content = ActivityContent(
            state: contentState(for: session),
            staleDate: Date().addingTimeInterval(15 * 60)
        )
        await activity.update(content)
        statusMessage = session.latestUpdate
    }

    func end(with session: ChatSession? = nil) async {
        guard let activity else { return }
        let finalContent = session.map {
            ActivityContent(state: contentState(for: $0), staleDate: nil)
        }
        await activity.end(finalContent, dismissalPolicy: .default)
        self.activity = nil
        isRunning = false
        statusMessage = "Live Activity ended"
    }

    private func contentState(for session: ChatSession) -> HammyActivityAttributes.ContentState {
        HammyActivityAttributes.ContentState(
            progress: session.clampedProgress,
            latestUpdate: session.latestUpdate,
            state: session.state,
            agentCount: session.agentCount,
            updatedAt: session.updatedAt
        )
    }
}

