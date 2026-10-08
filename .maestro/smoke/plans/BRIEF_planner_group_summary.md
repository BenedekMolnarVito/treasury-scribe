# Planner brief — edge-case smoke suite for "skip group summary notifications"

You are the TEST PLANNER (deep tier). Output = a test-suite spec file. You do NOT run the emulator and do NOT edit app code.

## Repo
C:/Users/molna/VSCodeRepos/treasury-scribe (Windows host, git-bash shell). Read AGENTS.md and .github/copilot-instructions.md first.
Treasury Scribe = Capacitor 8 Android app; React/TS in a WebView; sql.js DB. Kotlin NotificationListenerService forwards Revolut
notifications to TS (NotificationServiceCore parse -> IngestionService dedup/persist/auto-soft-delete/auto-tag).

## Fix under test (HEAD 12c2180)
android/app/src/main/kotlin/com/treasuryscribe/app/RevolutNotificationService.kt line ~100:
  if ((sbn.notification?.flags ?: 0) and Notification.FLAG_GROUP_SUMMARY != 0) return
Bug it fixes: when 4+ notifications from com.revolut.revolut are posted, Android's GroupHelper posts an AUTOGROUP summary
notification (FLAG_GROUP_SUMMARY|FLAG_AUTOGROUP_SUMMARY, same package, empty/odd body) and the app captured it as an EMPTY
transaction row. Previous fix HEAD~1 (8c62f35): HUF amount parsing anchored on "összeget" (see `git show HEAD~1`).
Also check: Kotlin operator precedence of `x and FLAG != 0` (in Kotlin `!=` binds tighter than infix `and`? verify!
If it is `x and (FLAG != 0)` that is a type error / or different semantics — determine what actually compiles and what it means).

## Existing harness (read all)
.maestro/smoke/{README.md,scenarios.yaml,harness.py,cdp.py,jev.py}, .hermes/skills/treasury-smoke-test/SKILL.md.
Code owns nav + hard asserts (CDP DOM, data-testid); Jev (TypeSafe) only batched yes/no nouls. No screenshots ever.
Notification ingestion IS emulator-drivable via a fake poster APK whose applicationId = com.revolut.revolut. Source:
C:/Users/molna/AppData/Local/hermes/cache/scratch/fake-revolut (app/src/main/java/com/revolut/revolut/Post.java — Activity,
extras t64/b64 = base64 UTF-8 title/body, posts BigTextStyle notification with unique id). Drive:
  adb -s emulator-5554 shell am start -n com.revolut.revolut/.Post --es t64 <b64> --es b64 <b64>
Grant listener: adb -s emulator-5554 shell cmd notification allow_listener com.treasuryscribe.app/com.treasuryscribe.app.RevolutNotificationService
Previous ad-hoc ingestion smoke: C:/Users/molna/AppData/Local/hermes/cache/scratch/smoke_parse.py.
A PHYSICAL PHONE (527f58ac) is also attached: everything must target emulator-5554 only.

## Deliverable
Write .maestro/smoke/plans/notif_group_summary_suite.md containing:
1. Risk analysis of the fix (what could still go wrong: precedence, explicit app-posted group summaries that carry real txn
   content, group children still captured, summary posted BEFORE children, notification UPDATE of same id, dismissed/re-posted,
   cancel+repost of autogroup summary as count changes, pending-queue path when plugin is null, non-Revolut package, empty-body
   non-summary notification, dedup of identical notifications, regression of HUF parsing cases from HEAD~1). Read the TS side
   (src/services/NotificationServiceCore.ts, IngestionService.ts, the TS plugin bridge) to decide EXPECTED outcomes from code,
   not guesses. Mark each expectation with the code line that justifies it. If the spec is silent/ambiguous, mark
   EXPECTED=UNSPECIFIED and say what to observe (flag, don't invent).
2. Ordered scenario list, each fully self-contained so a SMALL model can execute/judge it: id, purpose, preconditions/state reset,
   exact deterministic steps (poster calls with exact title/body strings incl. NBSP \u00a0 where Revolut uses them, waits),
   exact hard assertions on DOM (selectors/testids/text that really exist — verify in src/components), expected numbers,
   and a "if FAIL, likely cause + file:line to look at" hint. Include a `vitest` layer for anything not emulator-drivable.
3. Harness extension requirements (minimal) the worker must implement, e.g. new nav ops `post_notification:{title,body,
   group?,summary?}`, `reset_app` (pm clear + regrant listener + dismiss perm screens), `clear_notifications`,
   new code_assert ops like `row_count`, `amounts_include`, `no_empty_rows`; poster APK extras for setGroup/setGroupSummary/
   fixed id (for update tests); Windows support (git-bash path, ANDROID_SERIAL=emulator-5554 + -s everywhere,
   `python` not `python3`, android-env.sh Windows defaults, TYPESAFE_API_KEY already in env). Prefer code_assert over jev.
   State how to read rows deterministically (DOM testids such as transaction-card; check src/components for real ones).
4. Proposed concrete YAML for the new scenarios in the existing scenarios.yaml format (extended ops), as a fenced block.

Keep it precise and verifiable. Return to parent ONLY: path of the file + 8-line summary (scenario count, top 3 risks, any
finding that the fix itself looks wrong).
