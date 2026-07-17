import Foundation
import UserNotifications

final class NotificationService: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationService()

    private let center = UNUserNotificationCenter.current()

    private override init() {
        super.init()
    }

    func configure() {
        center.delegate = self
    }

    func requestAuthorization() async -> Bool {
        do {
            return try await center.requestAuthorization(options: [.alert, .badge, .sound])
        } catch {
            return false
        }
    }

    func currentAuthorizationGranted() async -> Bool {
        let settings = await center.notificationSettings()
        return settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    func scheduleApprovalNeeded(for session: ChatSession, delay: TimeInterval = 1) async {
        guard await currentAuthorizationGranted() else { return }

        let content = UNMutableNotificationContent()
        content.title = "Hammy needs your approval"
        content.subtitle = session.title
        content.body = "I’m kicked back and waiting. Approve the pending command when you’re ready."
        content.sound = .default
        content.categoryIdentifier = "HAMMY_APPROVAL"
        content.userInfo = ["sessionID": session.id.uuidString]

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(delay, 1), repeats: false)
        let request = UNNotificationRequest(
            identifier: "approval-\(session.id.uuidString)",
            content: content,
            trigger: trigger
        )
        try? await center.add(request)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}

