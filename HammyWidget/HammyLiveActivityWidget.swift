import ActivityKit
import SwiftUI
import WidgetKit

struct HammyLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: HammyActivityAttributes.self) { context in
            HammyLockScreenView(context: context)
                .activityBackgroundTint(Color.hammyInk.opacity(0.97))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "hammy://session/\(context.attributes.sessionID)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.clampedProgress, format: .percent.precision(.fractionLength(0)))
                            .font(.title2.bold().monospacedDigit())
                            .foregroundStyle(Color.hammyCyan)
                        Text("complete")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                DynamicIslandExpandedRegion(.trailing) {
                    HammyLiveAvatar(
                        state: context.state.state,
                        agentCount: context.state.agentCount,
                        size: 52
                    )
                }

                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(context.attributes.title)
                            .font(.subheadline.bold())
                            .lineLimit(1)
                        Label(context.state.state.title, systemImage: context.state.state.symbolName)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.hammyCyan)
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 7) {
                        LiveProgressBar(progress: context.state.clampedProgress)
                        Text(context.state.latestUpdate)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.top, 3)
                }
            } compactLeading: {
                Text(context.state.clampedProgress, format: .percent.precision(.fractionLength(0)))
                    .font(.caption2.bold().monospacedDigit())
                    .foregroundStyle(Color.hammyCyan)
            } compactTrailing: {
                HammyLiveAvatar(
                    state: context.state.state,
                    agentCount: context.state.agentCount,
                    size: 26
                )
            } minimal: {
                HammyLiveAvatar(
                    state: context.state.state,
                    agentCount: context.state.agentCount,
                    size: 25
                )
            }
            .widgetURL(URL(string: "hammy://session/\(context.attributes.sessionID)"))
            .keylineTint(Color.hammyCyan)
        }
    }
}

private struct HammyLockScreenView: View {
    var context: ActivityViewContext<HammyActivityAttributes>

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title)
                            .font(.headline)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Text(context.attributes.projectName)
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.62))
                    }
                    Spacer()
                    Text(context.state.clampedProgress, format: .percent.precision(.fractionLength(0)))
                        .font(.title3.bold().monospacedDigit())
                        .foregroundStyle(Color.hammyCyan)
                }

                LiveProgressBar(progress: context.state.clampedProgress)

                HStack(spacing: 6) {
                    Image(systemName: context.state.state.symbolName)
                        .foregroundStyle(Color.hammyCyan)
                    Text(context.state.latestUpdate)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.82))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(4)

            HammyLiveAvatar(
                state: context.state.state,
                agentCount: context.state.agentCount,
                size: 72
            )
            .frame(maxWidth: 76)
        }
        .padding(15)
    }
}

private struct LiveProgressBar: View {
    var progress: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.13))
                Capsule()
                    .fill(LinearGradient(colors: [Color.hammyCyan, Color.hammyPurple], startPoint: .leading, endPoint: .trailing))
                    .frame(width: proxy.size.width * min(max(progress, 0), 1))
            }
        }
        .frame(height: 6)
    }
}

private struct HammyLiveAvatar: View {
    var state: HammyWorkState
    var agentCount: Int
    var size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.hammyCyan.opacity(0.12))
            Image("HammyCharacter")
                .resizable()
                .scaledToFit()
                .padding(size * 0.04)
                .rotationEffect(state == .waitingApproval ? .degrees(8) : .zero)

            stateDecoration
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Hammy is \(state.title.lowercased())")
    }

    @ViewBuilder
    private var stateDecoration: some View {
        let badge = max(8, size * 0.28)
        switch state {
        case .thinking:
            Image(systemName: "cloud.fill")
                .font(.system(size: badge * 0.65))
                .foregroundStyle(.white)
                .frame(width: badge, height: badge)
                .background(Color.hammyPurple, in: Circle())
                .offset(x: size * 0.34, y: -size * 0.32)
        case .typing:
            Image(systemName: "keyboard.fill")
                .font(.system(size: badge * 0.54))
                .foregroundStyle(.white)
                .frame(width: badge, height: badge)
                .background(Color.hammyCyan, in: Circle())
                .offset(x: size * 0.34, y: size * 0.31)
        case .compacting:
            Image(systemName: "scroll.fill")
                .font(.system(size: badge * 0.60))
                .foregroundStyle(.white)
                .frame(width: badge, height: badge)
                .background(Color.orange, in: Circle())
                .offset(x: size * 0.34, y: size * 0.30)
        case .delegating:
            HStack(spacing: -size * 0.08) {
                ForEach(0..<max(1, min(agentCount, 3)), id: \.self) { index in
                    Image("HammyCharacter")
                        .resizable()
                        .scaledToFit()
                        .hueRotation(.degrees(Double(index + 1) * 72))
                        .frame(width: badge, height: badge)
                        .background(Color.hammyInk, in: Circle())
                }
            }
            .offset(x: size * 0.32, y: size * 0.31)
        case .waitingApproval:
            Image(systemName: "chair.lounge.fill")
                .font(.system(size: badge * 0.60))
                .foregroundStyle(.white)
                .frame(width: badge, height: badge)
                .background(Color.orange, in: Circle())
                .offset(x: size * 0.34, y: size * 0.31)
        case .complete:
            Image(systemName: "checkmark")
                .font(.system(size: badge * 0.62, weight: .black))
                .foregroundStyle(.white)
                .frame(width: badge, height: badge)
                .background(Color.hammyMint, in: Circle())
                .offset(x: size * 0.34, y: -size * 0.30)
        case .idle:
            EmptyView()
        }
    }
}
