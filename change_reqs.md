# Treasury scribe change requests

## Fixed requirements:

### Dashboard:
- Crete Last month after tab this month. Overflowing month tabs should be horizontally scrollable (carousel-like). Button size otherwise good. This helps me look back on the first few days of a month.
- Tag cloud too big — make it smaller, and add a show more option at the bottom.
- Monthly trend is not applicable on one month screen. Should show weekly trend when only one month is selected, otherwise monthly is good. Make it dynamically refreshed when changing periods.

### Transactions:
- Make sure export retains all metadata such as which item was deleted before, and thus should be auto-hided after an import.
- Transaction's last category should not be auto-inferred by matching Title alone, but Title AND Description. IMPORTANT NOTE: the Description field contains numbers to parse, so the mathcing should be with Description WITHOUT the parsed numbers. Essentially, auto-classification matching based on previous tagging should be based on Title and Description WITHOUT numbers. This way, I can auto-classify more granularly for example 'Átutalás elküldve...'-type transactions.
- When adding new transactions manually, I want to add tags too (apart from automatic 'Added Manually' tag). Currently the tagging field is missing from that view.
- I want to be able to step back from Edit Transaction view with swipe gesture (use teh general step back functionality the OS supports.)
- Add a Default/Exception switch near the tags. Default is selected by default (happy path, feeds the merchant's auto-learned default tags). Switching to Exception makes the current tags a one-off: it clears the auto-assigned tags and excludes this transaction from auto-learning, so the next transaction at the same merchant still gets the default tags auto-assigned. The switch appears on both the Edit Transaction view and the manual-add modal.

## Brainstorm new ideas

### Exploration
- Spawn subagents to explore new ideas on how to make this app more intuitive to use, more UX-friendly, and more automated.
- Use a synthesis subagent, that consumes the explorers findings, and a judge subagent that consumes the synthesis subagents detailed summary and outputs feasibility, usefulness scores, and trade-off judgement. 
- Save these ideas as a design plan in a separate MD file for later implementation. Put it in a docs/updates.. folder, not the root.

### Planning
- Create an separate implementation plan for Fixed Requirements and another one for the new ideas based on the synthesized and judged design plan.
- All implementation plans should instruct the coding agent to spawn subagents on specific tasks, and the task-subagent routing should be auto-discovered. Use your best judgement on subagent routing based on agentic orchestration guidelines.
- Do NOT change or commit anything yet, wait for user trigger.
- Save these plans in docs/updates.. folder too.