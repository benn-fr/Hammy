import SwiftUI
import UIKit

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ZStack {
            HammyBackground()
            ScrollView {
                LazyVStack(spacing: 22) {
                    profileHeader
                    appearanceCard
                    personalityCard
                    usageCard
                    permissionsCard
                    BridgeConnectionCard(bridge: store.bridge)
                    aboutCard
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 16)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: store.appearance) { _, _ in store.persistPreferences() }
        .onChange(of: store.hammyColor) { _, _ in store.persistPreferences() }
        .onChange(of: store.personality) { _, _ in store.persistPreferences() }
        .onChange(of: store.commandsAllowed) { _, _ in store.persistPreferences() }
        .onChange(of: store.pluginsAllowed) { _, _ in store.persistPreferences() }
        .onChange(of: store.bridgeURL) { _, _ in store.persistPreferences() }
    }

    private var profileHeader: some View {
        HStack(spacing: 16) {
            HammyCharacterView(
                state: .idle,
                size: 98,
                colorChoice: store.hammyColor,
                isWaving: true
            )
            VStack(alignment: .leading, spacing: 5) {
                Text("Make Hammy yours")
                    .font(.title2.bold())
                Text(store.personality.greeting)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Label("Preview account", systemImage: "checkmark.seal.fill")
                    .font(.caption.bold())
                    .foregroundStyle(Color.hammyCyan)
            }
            Spacer()
        }
        .glassCard(cornerRadius: 25, padding: 16)
    }

    private var appearanceCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionTitle(title: "Appearance", subtitle: "System follows your device automatically")
            Picker("Appearance", selection: $store.appearance) {
                ForEach(AppearanceMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            Divider()

            Text("Hammy color")
                .font(.subheadline.bold())
            HStack {
                ForEach(HammyColorChoice.allCases) { choice in
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
                            store.hammyColor = choice
                        }
                    } label: {
                        ZStack {
                            Circle()
                                .fill(choice.color.gradient)
                                .frame(width: 42, height: 42)
                            if store.hammyColor == choice {
                                Image(systemName: "checkmark")
                                    .font(.caption.bold())
                                    .foregroundStyle(.white)
                            }
                        }
                        .overlay {
                            Circle()
                                .stroke(choice.color.opacity(store.hammyColor == choice ? 0.8 : 0), lineWidth: 4)
                                .padding(-4)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(choice.rawValue)
                    .accessibilityAddTraits(store.hammyColor == choice ? .isSelected : [])
                    if choice != HammyColorChoice.allCases.last { Spacer() }
                }
            }
        }
        .glassCard()
    }

    private var personalityCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Personality", subtitle: "This shapes Hammy’s quick asides and status notes")
            ForEach(HammyPersonality.allCases) { personality in
                Button {
                    store.personality = personality
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(personality.rawValue)
                                .font(.subheadline.bold())
                                .foregroundStyle(.primary)
                            Text(personality.greeting)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: store.personality == personality ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(store.personality == personality ? Color.hammyCyan : Color.secondary.opacity(0.4))
                    }
                    .padding(12)
                    .background(
                        store.personality == personality ? Color.hammyCyan.opacity(0.09) : Color.secondary.opacity(0.05),
                        in: RoundedRectangle(cornerRadius: 15, style: .continuous)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .glassCard()
    }

    private var usageCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionTitle(title: "Usage", subtitle: "Main prompts and quick Hammy asides stay separate")

            usageRow(
                title: "Main prompts",
                value: store.usage.mainPromptTokens,
                count: store.usage.mainPromptCount,
                color: .hammyBlue,
                ratio: 1
            )
            usageRow(
                title: "Hammy asides",
                value: store.usage.hammyTokens,
                count: store.usage.hammyAsideCount,
                color: .hammyPurple,
                ratio: Double(store.usage.hammyTokens) / Double(max(store.usage.mainPromptTokens, 1))
            )

            HStack {
                Image(systemName: "info.circle.fill")
                Text("Preview estimates. A paired bridge can replace these with account-reported usage.")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .glassCard()
    }

    private func usageRow(title: String, value: Int, count: Int, color: Color, ratio: Double) -> some View {
        VStack(spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.subheadline.bold())
                Spacer()
                Text(value.formatted(.number.notation(.compactName)))
                    .font(.headline.monospacedDigit())
                Text("tokens")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HammyProgressBar(progress: max(ratio, 0.025), tint: color, height: 7)
            Text("\(count) requests")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private var permissionsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Permissions", subtitle: "Global defaults for new sessions")
            Toggle(isOn: $store.commandsAllowed) {
                Label("Allow command use", systemImage: "terminal.fill")
            }
            Toggle(isOn: $store.pluginsAllowed) {
                Label("Allow plugin use", systemImage: "puzzlepiece.extension.fill")
            }

            Divider()

            HStack {
                Label("Notifications", systemImage: "bell.badge.fill")
                Spacer()
                Button(store.notificationsGranted ? "Enabled" : "Request") {
                    Task { await store.requestNotificationPermission() }
                }
                .font(.caption.bold())
            }

            HStack {
                Label("Live Activity", systemImage: "wave.3.right.circle.fill")
                Spacer()
                Text(store.liveActivity.activitiesEnabled ? "Available" : "Off in Settings")
                    .font(.caption.bold())
                    .foregroundStyle(store.liveActivity.activitiesEnabled ? Color.hammyMint : Color.orange)
            }

            Button {
                openSystemSettings()
            } label: {
                Label("Open iOS Settings", systemImage: "arrow.up.right.square")
                    .font(.subheadline.bold())
            }
        }
        .glassCard()
    }

    private var aboutCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            SectionTitle(title: "About", subtitle: "Hammy 1.0 prototype")
            Button(role: .destructive) {
                store.resetOnboarding()
            } label: {
                Label("Replay welcome", systemImage: "arrow.counterclockwise")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("The character is derived from the supplied Hammy artwork and animated in SwiftUI.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .glassCard()
    }

    private func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}

private struct BridgeConnectionCard: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject var bridge: CodexBridgeClient
    @State private var token = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Encrypted relay", subtitle: "Connect to the multi-user Hammy backend")

            TextField("https://hammy.example/", text: $store.bridgeURL)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)

            SecureField("Access token (kept in memory)", text: $token)
                .textInputAutocapitalization(.never)
                .textFieldStyle(.roundedBorder)

            HStack {
                Circle()
                    .fill(connectionColor)
                    .frame(width: 9, height: 9)
                Text(bridge.state.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if bridge.state == .connected {
                    Button("Disconnect") { bridge.disconnect() }
                        .buttonStyle(.bordered)
                } else {
                    Button("Connect") {
                        bridge.connect(to: store.bridgeURL, bearerToken: token)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.hammyCyan)
                    .disabled(store.bridgeURL.isEmpty || token.isEmpty)
                }
            }

            Text("The relay stores only signed ciphertext. Hammy decrypts events locally with session keys protected by Keychain.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .glassCard()
    }

    private var connectionColor: Color {
        switch bridge.state {
        case .disconnected: .secondary
        case .connecting: .orange
        case .connected: .hammyMint
        case .failed: .red
        }
    }
}
