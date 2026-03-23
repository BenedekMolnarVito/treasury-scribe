# Implement new features
## New features to implement
- **Dark mode**: Always on, no toggle. Overhaul the UI to be more modern and stylish, with a focus on usability and aesthetics.
- **Dashboard**: Implement a dashboard that provides insights into spending habits, trends, and financial health. Possible features include:
  1. distribution by most common tags
  2. custom classification: 
    2a. by custom added tag groups
    2b. manually dropping transactions into new one
 3. Call *brainstormer agent* for Brainstorming on dashboard visualization and features. What are the most useful insights to show? How to visualize them? What are the most common user needs for a personal finance dashboard?
- **Import from JSON and CSV**: Dashboard should handle imported data dynamically. For example, if a user imports a CSV with older transactions, the dashboard should automatically recognize this, and update visualized data accordingly.
- **Split transaction**: input fields: 
  1. fractions -> should automatically calculate remainder
  2. numeric fields -> should dynamically calculate remainder.
- **Stylish icon for home screen**: Design a stylish and modern icon for the home screen of the app that reflects its name: Treasury Scribe. Try to incorporate elements that evoke the idea of a scribe or a treasury, such as a quill, a ledger, or a vault. The icon should be simple, memorable, and visually appealing, with a color scheme that complements the overall design of the app. Consider using shades of green, gold, or blue to convey a sense of wealth and security. The icon should also be scalable and recognizable at different sizes, from the app store to the home screen. If possible, create in SVG format to ensure it looks crisp on all devices.
- **Backtesting & missed transactions filled by Revolut exerpt**: should be able to import Revolut data, and use it to backfill any missing transactions in the user's history. This feature should analyze the imported data, identify any gaps in the existing transaction history, and automatically fill in those gaps with the relevant transactions from the Revolut excerpt. 
  1. See template file: *revolut_import_template.csv* for expected format of Revolut data. 
  2. This import should be separate from existing CSV import, and should be designed to specifically handle the unique format of Revolut data. 
  3. Make a separate import button for Revolut data, and ensure that the backfilling process is seamless and efficient, providing users with a complete and accurate transaction history. 
  4. See *fix_hungarian_csv.py* file for reference on how to handle unique CSV formats.
  5. Do NOT delete existing transactions when backfilling. Only add missing ones.
  6. Do NOT import duplicate transactions. Implement a mechanism to identify and skip duplicates during the backfilling process.
  7. Do NOT implement the service in Python. Implement it in the same language as the rest of the app, to ensure consistency and maintainability. *fix_hungarian_csv.py* is only for reference on how to handle unique CSV formats, not for actual implementation.
- **Filter by tags / see all untagged**: Implement a feature that allows users to filter their transactions by tags, making it easier to analyze specific categories of spending. Should be able to handle multi-selection. Additionally, provide a view that shows all untagged transactions, so users can quickly identify and categorize them.
- **Remove Test Notification button**. Not working, not needed.

## Multi-agent workflow requirements
- Create a detailed implementation plan that breaks down the new features into smaller, manageable tasks. Use the Planner agent to create a Task Dependency Graph that outlines the order of tasks and their dependencies. This will help ensure a structured and efficient implementation process.
- You MUST use the *brainstormer agent* for brainstorming on dashboard visualization and features. What are the most useful insights to show? How to visualize them? What are the most common user needs for a personal finance dashboard?
- You MUST use the agents in AGENTS.md for implementation, testing, debugging, and quality assurance. Follow the guidance and self-reflective questions for each agent to ensure a high-quality implementation that meets the Definition of Done criteria.
- You MUST use mobile-mcp tools for UI BEHAVIOR testing and debugging on Android devices. UI Behavior is a critical aspect of the user experience, and it is essential to verify that the app behaves correctly on actual devices. Use the tools to simulate user interactions, verify UI responses, and identify any issues that may arise during real-world usage.

## AVOID
- Do NOT implement features beyond what is specified in the requirements. Focus on meeting the defined requirements and ensuring a high-quality implementation that satisfies the Definition of Done criteria.
- Do NOT make assumptions about requirements that are not explicitly stated. If you encounter any ambiguities or uncertainties, ask for clarification from the Planner agent or refer to the Definition of Done criteria.
- Do NOT skip writing tests for the implemented features. Tests are essential for verifying that the implementation
meets the acceptance criteria and for ensuring the maintainability of the codebase. Always write comprehensive tests that cover various scenarios and edge cases.
- Do NOT refactor unrelated code while implementing new features. Focus on the specific changes required for the new features, and avoid making unnecessary changes to other parts of the codebase that are not directly related to the implementation.
