import SwiftUI

struct UpdatesView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ZStack {
            HammyBackground()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Everything Hammy noticed")
                            .font(.largeTitle.bold())
                        Text("A timeline of progress, handoffs, approvals, and results.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.bottom, 22)

                    ForEach(Array(store.updates.prefix(30).enumerated()), id: \.element.id) { index, update in
                        HStack(alignment: .top, spacing: 14) {
                            VStack(spacing: 0) {
                                ZStack {
                                    Circle()
                                        .fill(update.state.tint.opacity(0.13))
                                    Image(systemName: update.state.symbolName)
                                        .font(.caption.bold())
                                        .foregroundStyle(update.state.tint)
                                }
                                .frame(width: 38, height: 38)
                                if index < min(store.updates.count, 30) - 1 {
                                    Rectangle()
                                        .fill(Color.secondary.opacity(0.13))
                                        .frame(width: 2, height: 78)
                                }
                            }

                            NavigationLink {
                                ChatDetailView(sessionID: update.sessionID)
                            } label: {
                                VStack(alignment: .leading, spacing: 7) {
                                    HStack {
                                        Text(update.sessionTitle)
                                            .font(.subheadline.bold())
                                        Spacer()
                                        Text(update.timestamp.hammyRelativeDescription)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                    Text(update.text)
                                        .font(.subheadline)
                                        .foregroundStyle(.primary)
                                        .multilineTextAlignment(.leading)
                                        .lineLimit(3)
                                }
                                .padding(13)
                                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                                .padding(.bottom, 12)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 18)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle("Updates")
        .navigationBarTitleDisplayMode(.inline)
    }
}
