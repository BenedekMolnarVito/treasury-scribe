# Create or update tests and behavioral scenarios
## Goal
0. Read through the codebase and identify any untested or under-tested functions, especially those with complex logic or critical business rules.
1. Refactor any function with cyclomatic complexity > 10 — you can't meaningfully test a path explosion
2. Apply Modified Condition/Decision Coverage (MC/DC) for business logic with compound conditions
3. Use pairwise testing (*allpairspy* Python library) for API endpoints, form inputs, configuration combinations
4. Perform mutation testing (e.g. *mutmut* Python library) as a final check — it tells you whether your existing tests would catch subtle logic bugs
5. Create behavioral scenarios that reflect real-world usage patterns and potential failure modes. These scenarios should be off-limits to code-writing agents. The document should be placed in a dedicated folder within the repository. Scenarios should be written in a clear, narrative style that describes the user actions, system responses, and expected outcomes. Always prefer primitive tools like PowerShell scripts or Web Browser usage tools.

## Must haves
- Tests must be deterministic and isolated — no shared state or reliance on external services without mocks/stubs
- Tests should cover both happy paths and edge cases, including error handling and boundary conditions
- Behavioral scenarios should be comprehensive and reflect a variety of user interactions and system states

## AVOID
- Overly complex tests that are difficult to understand or maintain
- Overwriting scenarios with code-writing agents — these should be laid out at planning phase, and read-only for code-writing agents.