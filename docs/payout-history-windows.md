# Bounded payout history ranges

Migration 0067 and version 3 synchronization receipts support up to twelve
contiguous DOKU history requests of at most 31 days each. Scope selection and the
durable scheduler include grants in that range. The original target is never
truncated: a range beyond the window/page budget stops before collection.

The saved `window.json` contains the full immutable window plan, ending after the
saved status boundary. Each wallet keeps one balance bracket and at most forty
pages **per pocket across all windows**, with twenty rows per page. The configured
page budget reserves at least one page for each remaining window. Every window
of all original seller/platform cash/pending histories must be exhausted before
accounting. Partial windows stay partial even if later windows are empty.

Adjacent requests share their closed endpoint. Both responses must contain the
same complete multiset of endpoint rows; financial projections count the earlier
copy, preserving genuine duplicate legs. Gaps, overlaps, missing endpoint copies,
changed rows and different pocket plans are rejected by Worker and SQL guards.
Later independent evidence is checked against each window, including evidence
arriving while a run is interrupted. Original observations and collection links
remain immutable. Reconciliation retains its original account, credential,
reference, grant-to-status coverage and single-use payment authority checks.

Recovery replays saved responses and only collect mode fills missing reads within
the per-pass budget. Version 1 and 2 single-window receipts retain their original
layout and recovery behavior. This change does not activate provider access,
change funding policy, or establish live acceptance. Migration/deployment remains
for the coordinating worker; validation here uses isolated local fixtures.
