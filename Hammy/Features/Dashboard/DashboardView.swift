import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ZStack {
            HammyBackground()
            ScrollView {
                LazyVStack(spacing: 22) {
                    header

                    if let featured = store.featuredSession {
                        featuredCard(featured)
                    }

                    quickStats

                    if !otherActiveSessions.isEmpty {
                        VStack(spacing: 12) {
                            SectionTitle(
                                title: "Still working",
                                subtitle: "Every active prompt in one place"
                            )
                            ForEach(otherActiveSessions) { session in
                                NavigationLink {
                                    ChatDetailView(sessionID: session.id)
                                } label: {
                                    SessionCard(session: session, hammyColor: store.hammyColor)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    history
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await store.testApprovalNotification() }
                } label: {
                    Image(systemName: "bell.badge.fill")
                }
                .accessibilityLabel("Send a test approval notification")
            }
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Welcome back")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                Text("Hammy’s on it.")
                    .font(.largeTitle.bold())
                Text("\(store.activeSessions.count) active sessions")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            HammyCharacterView(
                state: store.featuredSession?.state ?? .idle,
                size: 72,
                colorChoice: store.hammyColor,
                agentCount: store.featuredSession?.agentCount ?? 0
            )
            .padding(.trailing, 14)
        }
        .padding(.top, 8)
    }

    private func featuredCard(_ session: ChatSession) -> some View {
        VStack(alignment: .leading, spacing: 17) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Label("NOW RUNNING", systemImage: "waveform.path.ecg")
                        .font(.caption2.weight(.black))
                        .tracking(1.4)
                        .foregroundStyle(Color.hammyCyan)
                    Text(session.title)
                        .font(.title2.bold())
                    Text(session.projectName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusPill(state: session.state, compact: true)
            }

            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(session.latestUpdate)
                        .font(.body.weight(.medium))
                        .lineLimit(3)
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(Int(session.clampedProgress * 100))%")
                            .font(.system(size: 30, weight: .bold, design: .rounded).monospacedDigit())
                        Text("complete")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    HammyProgressBar(progress: session.clampedProgress, tint: session.state.tint, height: 9)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                HammyCharacterView(
                    state: session.state,
                    size: 108,
                    colorChoice: store.hammyColor,
                    agentCount: session.agentCount
                )
                .frame(width: 118)
            }

            HStack(spacing: 10) {
                NavigationLink {
                    ChatDetailView(sessionID: session.id)
                } label: {
                    Label("Open session", systemImage: "arrow.up.right")
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity)
                        .frame(height: 45)
                        .foregroundStyle(.white)
                        .background(Color.hammyBlue.gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)

                Button {
                    Task { await store.startLiveActivity(sessionID: session.id) }
                } label: {
                    Image(systemName: store.liveActivity.isRunning ? "wave.3.right.circle.fill" : "wave.3.right.circle")
                        .font(.title3)
                        .frame(width: 48, height: 45)
                        .foregroundStyle(Color.hammyCyan)
                        .background(Color.hammyCyan.opacity(0.11), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Start Live Activity")
            }
        }
        .glassCard(cornerRadius: 28, padding: 19)
    }

    private var quickStats: some View {
        HStack(spacing: 12) {
            statCard(
                value: "\(store.activeSessions.filter { $0.state == .waitingApproval }.count)",
                label: "Need you",
                icon: "hand.raised.fill",
                color: .orange
            )
            statCard(
                value: "\(store.activeSessions.reduce(0) { $0 + $1.agentCount })",
                label: "Mini Hammies",
                icon: "person.3.fill",
                color: .hammyPurple
            )
            statCard(
                value: "\(store.usage.hammyAsideCount)",
                label: "Quick asides",
                icon: "bolt.fill",
                color: .hammyCyan
            )
        }
    }

    private func statCard(value: String, label: String, icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Image(systemName: icon)
                .foregroundStyle(color)
            Text(value)
                .font(.title2.bold().monospacedDigit())
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 19, padding: 13)
    }

    private var history: some View {
        VStack(spacing: 12) {
            SectionTitle(title: "Recent", subtitle: "Completed and paused conversations")
            ForEach(store.sessions.filter { !$0.isActive }) { session in
                NavigationLink {
                    ChatDetailView(sessionID: session.id)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: session.state.symbolName)
                            .font(.headline)
                            .foregroundStyle(session.state.tint)
                            .frame(width: 38, height: 38)
                            .background(session.state.tint.opacity(0.11), in: Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text(session.title)
                                .font(.subheadline.bold())
                            Text(session.updatedAt.hammyRelativeDescription)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.bold())
                            .foregroundStyle(.tertiary)
                    }
                    .glassCard(cornerRadius: 18, padding: 13)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var otherActiveSessions: [ChatSession] {
        store.activeSessions.filter { $0.id != store.featuredSession?.id }
    }
}
