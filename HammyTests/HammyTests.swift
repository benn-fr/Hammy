import XCTest
@testable import Hammy

final class HammyTests: XCTestCase {
    func testActivityProgressIsClamped() {
        let tooHigh = HammyActivityAttributes.ContentState(
            progress: 1.7,
            latestUpdate: "Done",
            state: .complete,
            agentCount: 0,
            updatedAt: Date()
        )
        let tooLow = HammyActivityAttributes.ContentState(
            progress: -0.4,
            latestUpdate: "Starting",
            state: .thinking,
            agentCount: 0,
            updatedAt: Date()
        )

        XCTAssertEqual(tooHigh.clampedProgress, 1)
        XCTAssertEqual(tooLow.clampedProgress, 0)
    }

    func testDemoIncludesEveryImportantLiveState() {
        let states = Set(DemoData.sessions.map(\.state))
        XCTAssertTrue(states.contains(.delegating))
        XCTAssertTrue(states.contains(.compacting))
        XCTAssertTrue(states.contains(.waitingApproval))
        XCTAssertTrue(states.contains(.complete))
    }

    @MainActor
    func testAsideDoesNotChangeMainPromptProgress() async {
        let store = AppStore()
        let sessionID = DemoData.primarySessionID
        let before = store.session(id: sessionID)?.progress

        await store.sendAside("What’s the status?", to: sessionID)

        XCTAssertEqual(store.session(id: sessionID)?.progress, before)
        XCTAssertEqual(store.session(id: sessionID)?.messages.last?.role, .hammy)
        XCTAssertTrue(store.session(id: sessionID)?.messages.last?.isAside == true)
    }

    func testE2EEEventRoundTripAndTamperDetection() throws {
        let keys = HammyDeviceKeys.generate()
        let sessionKey = HammyE2EE.createSessionKey()
        let userId = UUID().uuidString.lowercased()
        let sessionId = UUID().uuidString.lowercased()
        let messageId = UUID().uuidString.lowercased()
        let deviceId = UUID().uuidString.lowercased()
        let plaintext = Data("Hammy secret update".utf8)
        let envelope = try HammyE2EE.encryptEvent(
            plaintext,
            sessionKey: sessionKey,
            keyId: "session-key-v1",
            userId: userId,
            sessionId: sessionId,
            messageId: messageId,
            senderDeviceId: deviceId,
            notificationHint: .attention,
            keys: keys
        )
        let opened = try HammyE2EE.decryptEvent(
            envelope,
            sessionKey: sessionKey,
            senderSigningPublicKey: keys.publicBundle.signingPublicKey,
            userId: userId,
            sessionId: sessionId,
            messageId: messageId,
            senderDeviceId: deviceId,
            notificationHint: .attention
        )
        XCTAssertEqual(opened, plaintext)

        var tampered = envelope
        tampered.ciphertext.replaceSubrange(tampered.ciphertext.startIndex...tampered.ciphertext.startIndex, with: "A")
        XCTAssertThrowsError(
            try HammyE2EE.decryptEvent(
                tampered,
                sessionKey: sessionKey,
                senderSigningPublicKey: keys.publicBundle.signingPublicKey,
                userId: userId,
                sessionId: sessionId,
                messageId: messageId,
                senderDeviceId: deviceId,
                notificationHint: .attention
            )
        )
    }

    func testE2EESessionKeyPackageIsRecipientBound() throws {
        let sender = HammyDeviceKeys.generate()
        let recipient = HammyDeviceKeys.generate()
        let stranger = HammyDeviceKeys.generate()
        let sessionKey = HammyE2EE.createSessionKey()
        let userId = UUID().uuidString.lowercased()
        let sessionId = UUID().uuidString.lowercased()
        let senderId = UUID().uuidString.lowercased()
        let recipientId = UUID().uuidString.lowercased()
        let envelope = try HammyE2EE.wrapSessionKey(
            sessionKey,
            keyId: "session-key-v1",
            userId: userId,
            sessionId: sessionId,
            senderDeviceId: senderId,
            recipientDeviceId: recipientId,
            recipientAgreementPublicKey: recipient.publicBundle.agreementPublicKey,
            keys: sender
        )
        let opened = try HammyE2EE.unwrapSessionKey(
            envelope,
            userId: userId,
            sessionId: sessionId,
            senderDeviceId: senderId,
            recipientDeviceId: recipientId,
            senderSigningPublicKey: sender.publicBundle.signingPublicKey,
            recipientKeys: recipient
        )
        XCTAssertEqual(opened, sessionKey)
        XCTAssertThrowsError(
            try HammyE2EE.unwrapSessionKey(
                envelope,
                userId: userId,
                sessionId: sessionId,
                senderDeviceId: senderId,
                recipientDeviceId: recipientId,
                senderSigningPublicKey: sender.publicBundle.signingPublicKey,
                recipientKeys: stranger
            )
        )
    }

    func testNodeEncryptedFixtureDecryptsInSwift() throws {
        let senderSigningPublicKey = "sz3E8C0MuGdlnFOlvLSH-c6jTp_lNJHc41btU2L1fjA"
        let recipientKeys = HammyDeviceKeys(
            agreementPrivateKey: "6BeSa1wrlTAYwPlYP7ZabdJO8u0BRZP7jnkUREnaO24",
            signingPrivateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        )
        let keyPackage = HammyKeyPackageEnvelope(
            keyId: "interop-key-v1",
            ephemeralPublicKey: "bG6ancK-cTkfoucvxU1sW1PAdxlx92hUWAd48mvfogQ",
            salt: "5VnLDNti430UPvlGhoge8g",
            nonce: "07Qp9DNF2Jqx-T3A",
            ciphertext: "RGRfjYR31bl2kBY1mfTP3IBuasl8E0lRhDAhQBdYvlF4tN1JTBOe5lkfh90xcabv",
            createdAt: "2026-07-17T23:00:00.000Z",
            signature: "H5gxTjcx_Ov1Wt7Xeb3ZXltOg-cuLP8YulsHcl5Yxsctbf4FLR5AM60KYkJthQJEXp_TIdsNhgD5OIR3UInHAQ"
        )
        let sessionKey = try HammyE2EE.unwrapSessionKey(
            keyPackage,
            userId: "11111111-1111-4111-8111-111111111111",
            sessionId: "22222222-2222-4222-8222-222222222222",
            senderDeviceId: "33333333-3333-4333-8333-333333333333",
            recipientDeviceId: "44444444-4444-4444-8444-444444444444",
            senderSigningPublicKey: senderSigningPublicKey,
            recipientKeys: recipientKeys
        )
        let event = HammySignedCiphertext(
            keyId: "interop-key-v1",
            nonce: "Mple5VjgiSJ7LwSE",
            ciphertext: "SRNfSrvs7M5V8tXl75KCvCHaplqravMIBpSzwMPCRN271jWfoX5NidVE0fsb7k_O3hSsCT7KfWgA07UMDQ",
            clientCreatedAt: "2026-07-17T23:00:00.000Z",
            signature: "WsrbicE-CEQaOfFe13R-6nQMbeq6szR6fpfYtvkowwh7r-GsWbfGZmAQrp7L4OMZFerww4i92rgrO-ejnLToCA"
        )
        let plaintext = try HammyE2EE.decryptEvent(
            event,
            sessionKey: sessionKey,
            senderSigningPublicKey: senderSigningPublicKey,
            userId: "11111111-1111-4111-8111-111111111111",
            sessionId: "22222222-2222-4222-8222-222222222222",
            messageId: "55555555-5555-4555-8555-555555555555",
            senderDeviceId: "33333333-3333-4333-8333-333333333333",
            notificationHint: .attention
        )
        XCTAssertEqual(String(decoding: plaintext, as: UTF8.self), "Node to Swift: Hammy is encrypted end to end.")
    }
}
