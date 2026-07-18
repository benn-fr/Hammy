import SwiftUI

struct HammyCharacterView: View {
    var state: HammyWorkState
    var size: CGFloat = 150
    var colorChoice: HammyColorChoice = .cyan
    var agentCount: Int = 0
    var isWaving = false
    var showsThought = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floating = false
    @State private var swaying = false
    @State private var waving = false
    @State private var typingPulse = false
    @State private var sparkle = false

    var body: some View {
        ZStack {
            if state == .waitingApproval {
                Image(systemName: "chair.lounge.fill")
                    .font(.system(size: size * 0.42, weight: .medium))
                    .foregroundStyle(Color.orange.opacity(0.46))
                    .offset(x: size * 0.16, y: size * 0.20)
            }

            Ellipse()
                .fill(colorChoice.color.opacity(0.20))
                .frame(width: size * 0.58, height: size * 0.13)
                .blur(radius: 7)
                .offset(y: size * 0.40)

            Image("HammyCharacter")
                .resizable()
                .scaledToFit()
                .hueRotation(colorChoice.hueRotation)
                .frame(width: size, height: size)
                .rotationEffect(characterRotation)
                .scaleEffect(state == .typing && typingPulse ? 1.025 : (floating ? 1.012 : 1))
                .offset(y: floating && !reduceMotion ? -7 : 3)
                .shadow(color: colorChoice.color.opacity(0.24), radius: 18, y: 8)

            if isWaving {
                HammyWaveHand(color: colorChoice.color, waving: waving)
                    .frame(width: size * 0.32, height: size * 0.34)
                    .offset(x: -size * 0.47, y: -size * 0.08)
                    .accessibilityHidden(true)
            }

            stateAccessory

            if state == .complete {
                Image(systemName: "sparkles")
                    .font(.system(size: size * 0.20, weight: .bold))
                    .foregroundStyle(Color.hammyMint)
                    .scaleEffect(sparkle ? 1.12 : 0.72)
                    .opacity(sparkle ? 1 : 0.32)
                    .offset(x: -size * 0.39, y: -size * 0.34)
            }

            if showsThought {
                thoughtBubble
                    .transition(.scale(scale: 0.75, anchor: .bottomTrailing).combined(with: .opacity))
            }
        }
        .frame(width: size * 1.32, height: size * 1.24)
        .contentShape(Rectangle())
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.45).repeatForever(autoreverses: true)) {
                floating = true
            }
            withAnimation(.easeInOut(duration: 0.72).repeatForever(autoreverses: true)) {
                swaying = true
            }
            withAnimation(.easeInOut(duration: 0.36).repeatForever(autoreverses: true)) { typingPulse = true }
            withAnimation(.easeInOut(duration: 0.38).repeatForever(autoreverses: true)) { sparkle = true }
            withAnimation(.easeInOut(duration: 0.42).repeatForever(autoreverses: true)) { waving = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Hammy is \(state.title.lowercased())")
    }

    private var characterRotation: Angle {
        if state == .waitingApproval { return .degrees(7) }
        guard isWaving && !reduceMotion else { return .zero }
        return .degrees(swaying ? 1.4 : -1.4)
    }

    @ViewBuilder
    private var stateAccessory: some View {
        let badgeSize = max(26, size * 0.23)
        switch state {
        case .thinking:
            Image(systemName: "cloud.fill")
                .font(.system(size: badgeSize * 0.72))
                .foregroundStyle(.white)
                .padding(badgeSize * 0.22)
                .background(Color.hammyPurple.gradient, in: Circle())
                .shadow(color: Color.hammyPurple.opacity(0.3), radius: 8, y: 4)
                .offset(x: size * 0.37, y: -size * 0.34)
                .symbolEffect(.pulse, options: .repeating)
        case .typing:
            Label("tap tap", systemImage: "keyboard.fill")
                .font(.system(size: max(8, size * 0.07), weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .padding(.horizontal, size * 0.08)
                .padding(.vertical, size * 0.045)
                .background(Color.hammyCyan.gradient, in: Capsule())
                .offset(x: size * 0.27, y: size * 0.37)
                .scaleEffect(typingPulse ? 1.04 : 0.92)
        case .compacting:
            Image(systemName: "scroll.fill")
                .font(.system(size: badgeSize * 0.72))
                .foregroundStyle(.white)
                .padding(badgeSize * 0.24)
                .background(Color.orange.gradient, in: Circle())
                .offset(x: size * 0.38, y: size * 0.25)
        case .delegating:
            HStack(spacing: -size * 0.06) {
                ForEach(0..<max(1, min(agentCount, 3)), id: \.self) { index in
                    Image("HammyCharacter")
                        .resizable()
                        .scaledToFit()
                        .hueRotation(.degrees(Double(index + 1) * 72))
                        .frame(width: badgeSize * 1.12, height: badgeSize * 1.12)
                        .padding(2)
                        .background(.thinMaterial, in: Circle())
                }
            }
            .offset(x: size * 0.39, y: size * 0.30)
        case .waitingApproval:
            Text("z z")
                .font(.system(size: max(10, size * 0.10), weight: .black, design: .rounded))
                .foregroundStyle(Color.orange)
                .offset(x: size * 0.36, y: -size * 0.26)
        case .complete:
            Image(systemName: "checkmark")
                .font(.system(size: badgeSize * 0.64, weight: .black))
                .foregroundStyle(.white)
                .padding(badgeSize * 0.26)
                .background(Color.hammyMint.gradient, in: Circle())
                .offset(x: size * 0.36, y: -size * 0.27)
        case .idle:
            EmptyView()
        }
    }

    private var thoughtBubble: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Quick thought")
                .font(.caption2.bold())
                .foregroundStyle(colorChoice.color)
            Text(thoughtText)
                .font(.caption)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(width: max(116, size * 0.92), alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(alignment: .bottomTrailing) {
            BubbleTail()
                .fill(.regularMaterial)
                .frame(width: 20, height: 13)
                .offset(x: -18, y: 10)
        }
        .shadow(color: Color.black.opacity(0.12), radius: 12, y: 6)
        .offset(x: -size * 0.38, y: -size * 0.52)
    }

    private var thoughtText: String {
        switch state {
        case .thinking: "I’m checking a couple of paths."
        case .typing: "This part is coming together nicely."
        case .compacting: "Rolling the long context into a tidy note."
        case .delegating: "My little crew is checking the details."
        case .waitingApproval: "Wake me when that command is approved!"
        case .complete: "All done — ready when you are."
        case .idle: "Send me a quick aside anytime."
        }
    }
}

private struct HammyWaveHand: View {
    var color: Color
    var waving: Bool

    var body: some View {
        ZStack(alignment: .bottom) {
            Capsule()
                .fill(LinearGradient(colors: [.white, color.opacity(0.35)], startPoint: .top, endPoint: .bottom))
                .overlay(Capsule().stroke(Color.hammyInk.opacity(0.35), lineWidth: 2))
                .frame(width: 20, height: 58)
                .rotationEffect(.degrees(waving ? -24 : 13), anchor: .bottom)
                .offset(y: 5)
            HStack(spacing: 2) {
                ForEach(0..<3, id: \.self) { index in
                    Capsule()
                        .fill(.white)
                        .overlay(Capsule().stroke(color.opacity(0.75), lineWidth: 1.2))
                        .frame(width: 7, height: 23)
                        .rotationEffect(.degrees(Double(index - 1) * 14))
                }
            }
            .padding(5)
            .background(.white, in: Circle())
            .overlay(Circle().stroke(Color.hammyInk.opacity(0.38), lineWidth: 2))
            .offset(y: -42)
        }
        .rotationEffect(.degrees(waving ? -8 : 5), anchor: .bottom)
    }
}
