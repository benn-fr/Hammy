import PhotosUI
import SwiftUI

struct ChatDetailView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    var sessionID: UUID

    @State private var mainText = ""
    @State private var asideText = ""
    @State private var showHammyThought = false
    @State private var isAskingHammy = false
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var sendError: String?

    var body: some View {
        Group {
            if let session = store.session(id: sessionID) {
                sessionContent(session)
            } else {
                ContentUnavailableView(
                    "Session unavailable",
                    systemImage: "bubble.left.and.exclamationmark.bubble.right",
                    description: Text("Hammy couldn’t find this conversation.")
                )
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let session = store.session(id: sessionID) {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(session.title)
                            .font(.subheadline.bold())
                            .lineLimit(1)
                        Text(session.projectName)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    controlsMenu(session)
                }
            }
        }
        .sensoryFeedback(.impact(flexibility: .soft), trigger: showHammyThought)
    }

    private func sessionContent(_ session: ChatSession) -> some View {
        ZStack {
            HammyBackground()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 13) {
                        sessionHeader(session)
                        permissionChips(session)

                        if session.state == .waitingApproval {
                            approvalCard(session)
                        }

                        ForEach(session.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                        if let sendError {
                            Text(sendError)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                .scrollIndicators(.hidden)
                .onChange(of: session.messages.count) { _, _ in
                    if let last = session.messages.last {
                        withAnimation(.easeOut(duration: 0.24)) {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer(session)
        }
    }

    private func sessionHeader(_ session: ChatSession) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    StatusPill(state: session.state)
                    Spacer()
                    Text("\(Int(session.clampedProgress * 100))%")
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(session.state.tint)
                }
                Text(session.latestUpdate)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                HammyProgressBar(progress: session.clampedProgress, tint: session.state.tint, height: 7)
                Text("Tap Hammy for his quick read. Ask him an aside below without interrupting the main run.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button {
                withAnimation(.spring(response: 0.38, dampingFraction: 0.76)) {
                    showHammyThought.toggle()
                }
            } label: {
                HammyCharacterView(
                    state: session.state,
                    size: 102,
                    colorChoice: store.hammyColor,
                    agentCount: session.agentCount,
                    showsThought: showHammyThought
                )
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows Hammy’s current thought")
        }
        .glassCard(cornerRadius: 24, padding: 16)
    }

    private func permissionChips(_ session: ChatSession) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                PermissionChip(title: "Commands", systemImage: "terminal.fill", isEnabled: session.commandsAllowed)
                PermissionChip(title: "Plugins", systemImage: "puzzlepiece.extension.fill", isEnabled: session.pluginsAllowed)
                PermissionChip(title: "Photos", systemImage: "photo.fill", isEnabled: true)
                PermissionChip(title: session.model.rawValue, systemImage: "cpu.fill", isEnabled: true)
                PermissionChip(title: session.intelligence.rawValue, systemImage: "brain.head.profile.fill", isEnabled: true)
            }
            .padding(.horizontal, 2)
        }
        .scrollIndicators(.hidden)
    }

    private func approvalCard(_ session: ChatSession) -> some View {
        HStack(spacing: 13) {
            Image(systemName: "hand.raised.fill")
                .font(.title2)
                .foregroundStyle(.orange)
                .frame(width: 46, height: 46)
                .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("Command approval needed")
                    .font(.headline)
                Text("Hammy is waiting safely before continuing.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("Approve in Companion")
                .font(.caption.bold())
                .foregroundStyle(.orange)
        }
        .glassCard(cornerRadius: 20, padding: 13)
    }

    private func composer(_ session: ChatSession) -> some View {
        VStack(spacing: 9) {
            HStack(spacing: 9) {
                Image("HammyCharacter")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 28, height: 30)
                TextField("Quick aside to Hammy…", text: $asideText, axis: .vertical)
                    .lineLimit(1...3)
                    .font(.subheadline)
                    .submitLabel(.send)
                    .onSubmit { sendAside() }
                if isAskingHammy {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Button(action: sendAside) {
                        Image(systemName: "bolt.fill")
                            .font(.subheadline.bold())
                            .foregroundStyle(Color.hammyPurple)
                            .frame(width: 34, height: 34)
                            .background(Color.hammyPurple.opacity(0.12), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(asideText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Color.hammyPurple.opacity(0.08), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
            .overlay(alignment: .topLeading) {
                Text("/btw · won’t interrupt the main prompt")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.hammyPurple)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.regularMaterial, in: Capsule())
                    .offset(x: 12, y: -9)
            }

            HStack(alignment: .bottom, spacing: 9) {
                PhotosPicker(selection: $selectedPhotos, maxSelectionCount: 4, matching: .images) {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.title3)
                            .frame(width: 37, height: 37)
                        if !selectedPhotos.isEmpty {
                            Text("\(selectedPhotos.count)")
                                .font(.system(size: 9, weight: .black))
                                .foregroundStyle(.white)
                                .frame(width: 16, height: 16)
                                .background(Color.hammyBlue, in: Circle())
                        }
                    }
                }
                .foregroundStyle(.secondary)

                TextField("Continue the main session…", text: $mainText, axis: .vertical)
                    .lineLimit(1...5)
                    .submitLabel(.send)
                    .onSubmit { sendMainPrompt() }

                Button(action: sendMainPrompt) {
                    Image(systemName: "arrow.up")
                        .font(.headline.bold())
                        .foregroundStyle(.white)
                        .frame(width: 38, height: 38)
                        .background(Color.hammyBlue.gradient, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(mainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(mainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .padding(.horizontal, 12)
        .padding(.top, 14)
        .padding(.bottom, 8)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Divider().opacity(0.45)
        }
    }

    private func controlsMenu(_ session: ChatSession) -> some View {
        Menu {
            Section("Model") {
                ForEach(ModelChoice.allCases) { model in
                    Button {
                        store.setModel(model, sessionID: session.id)
                    } label: {
                        if model == session.model {
                            Label(model.rawValue, systemImage: "checkmark")
                        } else {
                            Text(model.rawValue)
                        }
                    }
                }
            }
            Section("Intelligence") {
                ForEach(IntelligenceLevel.allCases) { level in
                    Button {
                        store.setIntelligence(level, sessionID: session.id)
                    } label: {
                        if level == session.intelligence {
                            Label(level.rawValue, systemImage: "checkmark")
                        } else {
                            Text(level.rawValue)
                        }
                    }
                }
            }
            Section("Permissions") {
                Button {
                    store.toggleCommands(sessionID: session.id)
                } label: {
                    Label(
                        session.commandsAllowed ? "Disable commands" : "Allow commands",
                        systemImage: "terminal"
                    )
                }
                Button {
                    store.togglePlugins(sessionID: session.id)
                } label: {
                    Label(
                        session.pluginsAllowed ? "Disable plugins" : "Allow plugins",
                        systemImage: "puzzlepiece.extension"
                    )
                }
            }
            Button {
                Task { await store.startLiveActivity(sessionID: session.id) }
            } label: {
                Label("Show Live Activity", systemImage: "wave.3.right.circle")
            }
        } label: {
            Image(systemName: "slider.horizontal.3")
        }
        .accessibilityLabel("Session controls")
    }

    private func sendMainPrompt() {
        let text = mainText
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        mainText = ""
        sendError = nil
        Task {
            do { try await store.sendMainPrompt(text, to: sessionID) }
            catch { sendError = error.localizedDescription }
        }
        selectedPhotos.removeAll()
    }

    private func sendAside() {
        let text = asideText
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        asideText = ""
        isAskingHammy = true
        sendError = nil
        Task {
            do { try await store.sendAside(text, to: sessionID) }
            catch { sendError = error.localizedDescription }
            isAskingHammy = false
        }
    }
}
