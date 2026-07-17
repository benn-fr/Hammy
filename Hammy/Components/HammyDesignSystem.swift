import SwiftUI

extension HammyColorChoice {
    var color: Color {
        switch self {
        case .cyan: .hammyCyan
        case .violet: .hammyPurple
        case .mint: .hammyMint
        case .coral: Color(red: 1.0, green: 0.43, blue: 0.42)
        case .gold: Color(red: 1.0, green: 0.72, blue: 0.20)
        }
    }

    var hueRotation: Angle {
        switch self {
        case .cyan: .zero
        case .violet: .degrees(68)
        case .mint: .degrees(-36)
        case .coral: .degrees(142)
        case .gold: .degrees(186)
        }
    }
}

extension HammyWorkState {
    var tint: Color {
        switch self {
        case .idle: .secondary
        case .thinking: .hammyPurple
        case .typing: .hammyCyan
        case .compacting: .orange
        case .delegating: .hammyBlue
        case .waitingApproval: .yellow
        case .complete: .hammyMint
        }
    }
}

struct HammyBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            Color(.systemBackground)
            LinearGradient(
                colors: colorScheme == .dark
                    ? [Color.hammyInk.opacity(0.95), Color.hammyPurple.opacity(0.17), Color.hammyCyan.opacity(0.08)]
                    : [Color.white, Color.hammyCyan.opacity(0.13), Color.hammyPurple.opacity(0.08)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(Color.hammyCyan.opacity(colorScheme == .dark ? 0.11 : 0.16))
                .frame(width: 320, height: 320)
                .blur(radius: 54)
                .offset(x: 170, y: -300)
            Circle()
                .fill(Color.hammyPurple.opacity(colorScheme == .dark ? 0.12 : 0.08))
                .frame(width: 280, height: 280)
                .blur(radius: 64)
                .offset(x: -180, y: 330)
        }
        .ignoresSafeArea()
    }
}

struct GlassCard: ViewModifier {
    var cornerRadius: CGFloat = 24
    var padding: CGFloat = 18

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.white.opacity(0.18), lineWidth: 1)
            }
            .shadow(color: Color.black.opacity(0.07), radius: 18, y: 8)
    }
}

extension View {
    func glassCard(cornerRadius: CGFloat = 24, padding: CGFloat = 18) -> some View {
        modifier(GlassCard(cornerRadius: cornerRadius, padding: padding))
    }
}

struct HammyProgressBar: View {
    var progress: Double
    var tint: Color = .hammyCyan
    var height: CGFloat = 8

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.secondary.opacity(0.14))
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [tint, tint.opacity(0.68)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: proxy.size.width * min(max(progress, 0), 1))
                    .animation(.spring(response: 0.55, dampingFraction: 0.82), value: progress)
            }
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Progress")
        .accessibilityValue("\(Int(min(max(progress, 0), 1) * 100)) percent")
    }
}

struct StatusPill: View {
    var state: HammyWorkState
    var compact = false

    var body: some View {
        Label(state.title, systemImage: state.symbolName)
            .font(compact ? .caption2.weight(.semibold) : .caption.weight(.semibold))
            .foregroundStyle(state.tint)
            .padding(.horizontal, compact ? 8 : 10)
            .padding(.vertical, compact ? 5 : 7)
            .background(state.tint.opacity(0.12), in: Capsule())
    }
}

struct BubbleTail: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.maxY),
            control: CGPoint(x: rect.maxX * 0.25, y: rect.maxY * 0.85)
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

struct SectionTitle: View {
    var title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.title3.bold())
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension Date {
    var hammyRelativeDescription: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: self, relativeTo: Date())
    }
}

