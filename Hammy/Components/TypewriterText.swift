import SwiftUI
import UIKit

struct TypewriterText: View {
    var text: String
    var characterDelay: UInt64 = 13_000_000
    var onComplete: (() -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var displayedText = ""

    var body: some View {
        Text(displayedText)
            .accessibilityLabel(text)
            .task(id: text) {
                if reduceMotion {
                    displayedText = text
                    onComplete?()
                    return
                }

                displayedText = ""
                let haptic = UIImpactFeedbackGenerator(style: .soft)
                haptic.prepare()
                for (index, character) in text.enumerated() {
                    guard !Task.isCancelled else { return }
                    displayedText.append(character)
                    if index.isMultiple(of: 3), !character.isWhitespace {
                        haptic.impactOccurred(intensity: 0.24)
                        haptic.prepare()
                    }
                    try? await Task.sleep(nanoseconds: characterDelay)
                }
                onComplete?()
            }
    }
}

