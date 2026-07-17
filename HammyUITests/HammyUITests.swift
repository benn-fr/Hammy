import XCTest

final class HammyUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOnboardingLayout() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-hasCompletedOnboarding", "NO", "-AppleLanguages", "(en)"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Your tiny session sidekick"].waitForExistence(timeout: 20))
        let signInButton = app.buttons["Sign in with ChatGPT"]
        XCTAssertTrue(signInButton.exists)
        let enabledExpectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isEnabled == true"),
            object: signInButton
        )
        XCTAssertEqual(XCTWaiter.wait(for: [enabledExpectation], timeout: 12), .completed)

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Hammy Onboarding"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testDashboardLayout() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-hasCompletedOnboarding", "YES", "-AppleLanguages", "(en)"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Hammy’s on it."].waitForExistence(timeout: 20))
        XCTAssertTrue(app.tabBars.buttons["Settings"].exists)

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Hammy Dashboard"
        attachment.lifetime = .keepAlways
        add(attachment)

        let openSession = app.buttons["Open session"].firstMatch
        XCTAssertTrue(openSession.exists)
        openSession.tap()
        XCTAssertTrue(app.staticTexts["Tap Hammy for his quick read. Ask him an aside below without interrupting the main run."].waitForExistence(timeout: 10))

        let chatAttachment = XCTAttachment(screenshot: app.screenshot())
        chatAttachment.name = "Hammy Chat"
        chatAttachment.lifetime = .keepAlways
        add(chatAttachment)

        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Make Hammy yours"].waitForExistence(timeout: 10))

        let settingsAttachment = XCTAttachment(screenshot: app.screenshot())
        settingsAttachment.name = "Hammy Settings"
        settingsAttachment.lifetime = .keepAlways
        add(settingsAttachment)
    }
}
