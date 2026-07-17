import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            NavigationStack {
                DashboardView()
            }
            .tabItem {
                Label("Sessions", systemImage: "bubble.left.and.text.bubble.right.fill")
            }

            NavigationStack {
                UpdatesView()
            }
            .tabItem {
                Label("Updates", systemImage: "bolt.horizontal.circle.fill")
            }

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape.fill")
            }
        }
        .tint(Color.hammyCyan)
    }
}
