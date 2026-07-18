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
        let signInButton = app.buttons["Pair with Hammy Companion"]
        XCTAssertTrue(signInButton.waitForExistence(timeout: 20))
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

        XCTAssertTrue(app.staticTexts["No Codex sessions yet"].waitForExistence(timeout: 10))

        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Make Hammy yours"].waitForExistence(timeout: 10))

        let settingsAttachment = XCTAttachment(screenshot: app.screenshot())
        settingsAttachment.name = "Hammy Settings"
        settingsAttachment.lifetime = .keepAlways
        add(settingsAttachment)
    }
}
