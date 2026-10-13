# Brayness Pi fork

This is a maintained downstream fork. Upstream acceptance is not required.
The `brayness` branch carries local changes above an upstream base.

## Required local behavior

- Lossless HTML session rows and owner-addressed item IDs.
- Compressed HTML session creation, append, resume, discovery, branching, and export.
- Read-only `pi-session-read` decoding for sync and memory search.
- Incomplete-tail recovery without silent corruption or lost tail bytes.
- Closed-session compaction with a byte-exact backup and live-writer guard.
- Tests must not write agent state to the real home directory.

## Update procedure

1. Run `git status --short`. Review, test, and commit local changes explicitly.
2. Fetch `origin`. Select an upstream release tag and record its exact commit.
3. Create an update branch and separate worktree inside the Brayness root.
4. Compare the current upstream base with the target. Human review is required
   for upstream and dependency changes before merge.
5. Merge the target into the update branch. Keep local commits in history;
   do not reset to upstream, force push, or replace the active install in place.
6. Resolve conflicts against the required behavior above. Review changed APIs,
   packaging scripts, dependency locks, and session consumers.
7. Install dependencies with `npm ci --ignore-scripts`. Run `npm run check`
   and focused session tests in JSONL and compressed HTML modes.
8. Build and pack a separate install. Use the target's packaging helpers;
   upstream can change their names and interfaces.
9. Verify the installed command line and SDK: write, resume, branch, clone,
   export, decode, and public memory search. No paid model calls are needed.
10. Record source commit, upstream commit, commands, and results beside the
    staged install. Keep the previous verified install available.
11. After approval, select the verified install for new launches. Do not restart
    live sessions or convert history as part of an update.
12. Verify the launcher resolves to the new install. Roll back by restoring
    the previous verified install path; preserve history in either direction.

## Harness integration

The harness launcher is `../../bin/pi`. Its `fork-path` marker selects an
installed fork and enables compressed sessions. `../../bin/pi-fork.js` checks
installation proof before selection. Its `rollback` action removes the marker
and returns to the checkout's pinned runtime; this is not a previous-fork rollback.
Keep the prior marker path when switching between verified fork installs.

The harness's `npm run pi:update` reinstalls the reviewed checkout pin. It does
not advance upstream or update a separately selected fork.

Release verification helpers are in `../../artifacts/pi/review-v1.2.0/`.
Review them against the target's packaging APIs before reuse. They are not a
stable upstream interface. Hydrate model data before checking a fresh worktree;
build workspace dependencies before tests that spawn Node subprocesses.
