import ActivityKit
import SwiftUI
import UIKit

struct OnboardingView: View {
    private enum Stage: Equatable {
        case welcome
        case permissions
    }

    @EnvironmentObject private var store: AppStore
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var stage: Stage = .welcome
    @State private var introFinished = false
    @State private var authInProgress = false

    private let introText = """
    Heya! It’s Hammy! Your virtual assistant here to assist and remind you about your ongoing ChatGPT sessions!

    But without further ado, let’s first get your information so we know it’s you!
    """

    var body: some View {
        ZStack {
            HammyBackground()
            ScrollView {
                Group {
                    switch stage {
                    case .welcome: welcome
                    case .permissions: permissions
                    }
                }
                .frame(maxWidth: 620)
                .padding(.horizontal, 22)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
        .sensoryFeedback(.success, trigger: stage)
    }

    private var welcome: some View {
        VStack(spacing: 18) {
            VStack(spacing: 4) {
                Text("HAMMY")
                    .font(.caption.weight(.black))
                    .tracking(4)
                    .foregroundStyle(Color.hammyCyan)
                Text("Your tiny session sidekick")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 6)

            VStack(alignment: .leading, spacing: 0) {
                TypewriterText(text: introText) {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                        introFinished = true
                    }
                }
                .font(.system(.body, design: .rounded, weight: .medium))
                .lineSpacing(4)
                .frame(maxWidth: .infinity, minHeight: 146, alignment: .topLeading)
                .padding(18)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(Color.hammyCyan.opacity(0.24), lineWidth: 1)
                }

                BubbleTail()
                    .fill(.regularMaterial)
                    .frame(width: 30, height: 21)
                    .rotationEffect(.degrees(9))
                    .offset(x: 62, y: -3)
            }

            HammyCharacterView(
                state: .idle,
                size: 214,
                colorChoice: store.hammyColor,
                isWaving: true
            )
            .padding(.vertical, -12)

            Button {
                signIn()
            } label: {
                HStack(spacing: 12) {
                    if authInProgress {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: "sparkles")
                            .font(.headline)
                    }
                    Text(authInProgress ? "Opening secure sign-in…" : "Sign in with ChatGPT")
                        .font(.headline)
                    Spacer()
                    Image(systemName: "arrow.right")
                        .font(.subheadline.bold())
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .frame(height: 58)
                .background(
                    LinearGradient(
                        colors: [.hammyBlue, .hammyPurple],
                        startPoint: .leading,
                        endPoint: .trailing
                    ),
                    in: RoundedRectangle(cornerRadius: 19, style: .continuous)
                )
                .shadow(color: Color.hammyPurple.opacity(0.28), radius: 18, y: 9)
            }
            .buttonStyle(.plain)
            .disabled(authInProgress || !introFinished)
            .opacity(introFinished ? 1 : 0.55)

            Label("Preview sign-in uses sample sessions until a Codex bridge is paired.", systemImage: "lock.shield.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
    }

    private var permissions: some View {
        VStack(spacing: 22) {
            HammyCharacterView(
                state: .thinking,
                size: 142,
                colorChoice: store.hammyColor,
                showsThought: true
            )

            VStack(spacing: 8) {
                Text("Let Hammy keep you posted")
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)
                Text("Notifications cover approvals and completed turns. Live Activities keep active work visible on the Lock Screen and Dynamic Island.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 12) {
                permissionRow(
                    icon: "bell.badge.fill",
                    color: .hammyPurple,
                    title: "Notifications",
                    subtitle: store.notificationsGranted ? "Enabled for approval and result alerts" : "Tap to allow timely approval alerts",
                    status: store.notificationsGranted ? "Enabled" : "Allow"
                ) {
                    Task { await store.requestNotificationPermission() }
                }

                permissionRow(
                    icon: "wave.3.right.circle.fill",
                    color: .hammyCyan,
                    title: "Live Activities",
                    subtitle: liveActivitiesEnabled ? "Available on this device" : "Disabled in iOS Settings",
                    status: liveActivitiesEnabled ? "Ready" : "Settings"
                ) {
                    guard !liveActivitiesEnabled else { return }
                    openSystemSettings()
                }
            }

            Button {
                finish()
            } label: {
                HStack {
                    Text("Start tracking sessions")
                        .font(.headline)
                    Spacer()
                    Image(systemName: "arrow.right")
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .frame(height: 58)
                .background(Color.hammyCyan.gradient, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
            }
            .buttonStyle(.plain)

            Text("Live Activities don’t show a separate permission prompt. iOS exposes the system switch in Settings and Hammy checks it before starting one.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
    }

    private var liveActivitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    private func permissionRow(
        icon: String,
        color: Color,
        title: String,
        subtitle: String,
        status: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundStyle(color)
                    .frame(width: 44, height: 44)
                    .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Text(status)
                    .font(.caption.bold())
                    .foregroundStyle(color)
            }
            .glassCard(cornerRadius: 20, padding: 14)
        }
        .buttonStyle(.plain)
    }

    private func signIn() {
        authInProgress = true
        Task {
            await store.previewSignIn()
            authInProgress = false
            withAnimation(.spring(response: 0.55, dampingFraction: 0.84)) {
                stage = .permissions
            }
            await store.requestNotificationPermission()
        }
    }

    private func finish() {
        Task {
            await store.completeOnboarding()
            hasCompletedOnboarding = true
        }
    }

    private func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}
