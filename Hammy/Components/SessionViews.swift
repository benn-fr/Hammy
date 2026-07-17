import SwiftUI

struct SessionCard: View {
    var session: ChatSession
    var hammyColor: HammyColorChoice

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(session.state.tint.opacity(0.11))
                HammyCharacterView(
                    state: session.state,
                    size: 62,
                    colorChoice: hammyColor,
                    agentCount: session.agentCount
                )
            }
            .frame(width: 76, height: 76)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(session.title)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text("\(Int(session.clampedProgress * 100))%")
                        .font(.caption.monospacedDigit().bold())
                        .foregroundStyle(session.state.tint)
                }
                Text(session.latestUpdate)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                HammyProgressBar(progress: session.clampedProgress, tint: session.state.tint, height: 6)
            }
        }
        .glassCard(cornerRadius: 22, padding: 14)
    }
}

struct PermissionChip: View {
    var title: String
    var systemImage: String
    var isEnabled: Bool

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(isEnabled ? Color.hammyMint : Color.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background((isEnabled ? Color.hammyMint : Color.secondary).opacity(0.10), in: Capsule())
    }
}

struct MessageBubble: View {
    var message: ChatMessage

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if message.role == .user { Spacer(minLength: 44) }
            if message.role == .hammy {
                Image("HammyCharacter")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 28, height: 32)
                    .padding(4)
                    .background(Color.hammyPurple.opacity(0.11), in: Circle())
            }

            VStack(alignment: .leading, spacing: 4) {
                if message.isAside {
                    Label(message.role == .hammy ? "Hammy aside" : "Quick aside", systemImage: "bolt.fill")
                        .font(.caption2.bold())
                        .foregroundStyle(Color.hammyPurple)
                }
                Text(message.text)
                    .font(.body)
                Text(message.timestamp, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(bubbleColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .frame(maxWidth: 520, alignment: message.role == .user ? .trailing : .leading)

            if message.role != .user { Spacer(minLength: 44) }
        }
        .frame(maxWidth: .infinity)
    }

    private var bubbleColor: Color {
        switch message.role {
        case .user: Color.hammyBlue.opacity(0.16)
        case .assistant: Color.secondary.opacity(0.10)
        case .hammy: Color.hammyPurple.opacity(0.13)
        case .update: Color.hammyCyan.opacity(0.10)
        }
    }
}
