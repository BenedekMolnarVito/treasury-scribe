# UI Overhaul for Treasury Scribe

- Hide tags on Transactions page and add modern Filter Icon button that rolls down (show) the tag cloud, where users can select tags to filter the transaction list. The tag cloud should show all tags, but the selected ones should be highlighted (e.g. with a different background color). The transaction list should update in real-time as tags are selected/deselected.
- Refresh on swipe down from top. Real-time circular arrow animation during swiping gesture. Refresh should update the transaction list and the dashboard charts, and show a toast message "Data refreshed" after completion. It should also keep the original functionality of existing Refresh button. 
- Reorganize pages: Add a *Bottom Icon row* with stylish Icons that navigate to the following (already existing) pages:
  1. Dashboard (default page). Icon should be a simple chart icon. Also remove the existing Dashboard button and Dashboard title from the top.
  2. Transactions. Icon should be a simple list icon. Also remove the existing Transactions title from the top.
- Replace 'Add transaction' button with a '+' Icon. This should open the Add Transaction page as a modal (slide up from bottom). The modal should have a close 'X' Icon on the top right corner. The rest of the Add Transaction page can stay the same, but with a more modern design (e.g. card layout, modern input fields, better spacing and fonts).
- DateTime should be optionally added/edited on Add/Edit Transaction page. Use modern datetime picker. Default is NOW.
- 'Export', 'Import', 'Revolut import', 'Clear All' and 'Show Deleted' buttons -> move to Transaction list page (only show there on top). Add modern style for each button. Do NOT change the existing functionality of these buttons, just move them and add a modern design.
- Add 9 and 12 months filter buttons to Dashboard to the existing 'This month', 3, 6 months buttons.
- Exported data filename should be as: treasury-scribe-transactions_{timestamp} + the appropriate file extension (.csv or .json). Timestamp format should be YYYYMMDD_HHMMSS (e.g. treasury-scribe-transactions_20240615_143500.csv).

## Bugs to fix
### DashBoard

- IMPORTANT: Timeline filters are select worng periods of time -> This month's expenses is almost equal to 3 months' expenses. Check the logic of timeline filters, it seems like they are not calculating the correct time frames. This is a critical bug that needs to be fixed ASAP, as it affects the accuracy of the dashboard data.
- Filtering by tags adds more categories to the doughnut chart than the number of tags selected. For example, if I select 2 tags, I get 4 categories in the doughnut chart. This is incorrect and should be fixed so that only the selected tags are shown as categories in the doughnut chart.
- Line chart needs sums at every data point. Sums should be displayed above the dots between the lines. For example, if the line chart shows expenses over 3 months, each dot on the line should have a sum of expenses each month displayed above it. This will make it easier for users to understand the data at a glance.

### Edit Transactions

- Amount split: cannot split in two because if the last part EQUALS remainder, I get error message saying difference must be greater than 0, which is wrong. It can be >= 0. For example, if the last part equals the remainder, it should be allowed. Also auto-calculate last part (insert remainder) dynamically.

## UI testing Guidelines

- Include testing of all the new features and bug fixes mentioned above in the when planning implementation.  
- Use AVD and adb logcat for UI testing. AVD should be installed globally. The AVD name is: *poco_f5_test*. Call *mobile-worker* agent to execute tasks and verify results with UI tests.
- Write tests that cover all the new features and bug fixes. 
- Skip Appium tests, do NOT use appium-mcp for testing, as it is not installed.
- You MUST use *./tests/mock data/transactions.json* for testing, do NOT use real data for testing. Import the transactions JSON data into the app using the Import button in the Transactions page. Verify that the data is imported correctly and that all the new features and bug fixes work as expected with this mock data.
- Iterate until all UI behavior is verified to be consistent with the new design and features.

## Update repo instructions
- Update the *README.md* file with instructions on how to run the app and how to test the new features and bug fixes.
- Update the *copilot-instructions.md* file with instructions on how to run the app and how to test the new features and bug fixes.