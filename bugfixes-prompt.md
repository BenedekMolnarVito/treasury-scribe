# Make a plan to fix the bugs
- Lay out a clear plan to fix the bugs listed in the "Bugs to fix" section.
- Use the Agents defined in .github/AGENTS.md to structure your plan. For example, you might use the *Planner* agent to break down the tasks, the *Worker* agent to implement the fixes, and the *QA Judge* agent to verify that the fixes work as intended.
- For each bug, specify the acceptance criteria that must be met for the bug to be considered fixed. These criteria should be specific, measurable, and verifiable.
- Ensure that your plan includes steps for testing and verification of UI behavior with *mobile-mcp*.

## Bugs to fix
- CORE ISSUE: I paid with Revolut, and it was not captured automatically. Although the permanent notification was on, saying the app was listening to notification. When I hit Refresh button, the Transaction was added successfully. I want this adding flow to be automatic right after a Revolut notification appears.
- The amount parser parses the wrong number. In the notification:
 '1 599 Ft összeget fizettél itt: OBI.
A(z) HUF Zseb egyenlege: 56 604,23 Ft' -> 604 HUF got parsed, while I paid 1599 HUF. This sentece syntax is common so make a logic that parses from the section 'XXX Ft összeget fizettél...'.
- Every time I open up the app, I get redirected to Auto Start enable settings. This is needed only once after install.
- I don't see the Amount field in Edit transaction view. I want to edit Amount too.
- The monitoring perma notification only appears again after about a minute, when it is cleared off and the app is swiped from RAM. Make it restart faster, about 5 seconds

## Verification
- Use SQLite DB queries to verify the presence and correctness of transactions after each test case.
- For UI scenario-driven tests, verify the entire user journey end-to-end, not just isolated steps.
- You MUST Use *mobile-mcp* to simulate real user interactions and verify the app's response to notifications and UI actions. 
- Use *adb* shell commands to verify that the NotificationListenerService is active and receiving notifications during tests.
- For the amount parsing bug, create specific test cases with various notification formats to ensure the parser correctly extracts the amount and currency.

## Definition of Done
- All acceptance criteria for each bug are met.
- All existing tests pass (`pytest -x -q` exits 0).
- UI behavior is verified and works as expected with *mobile-mcp*.