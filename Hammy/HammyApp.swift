import SwiftUI
import UIKit

final class HammyAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        NotificationService.shared.configure()
        return true
    }
}

@main
struct HammyApp: App {
    @UIApplicationDelegateAdaptor(HammyAppDelegate.self) private var appDelegate
    @StateObject private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(store.preferredColorScheme)
        }
    }
}
