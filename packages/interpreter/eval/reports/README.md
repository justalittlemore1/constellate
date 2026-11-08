# Eval reports

One Markdown file per `pnpm eval` run, committed, so reviewers can see the interpreter improve (or not) across iterations. Never delete old reports.

## Rejected experiments (reports kept, code not merged)

- `20261108-094327` and `20261108-094721`: dropping `rolling_summary` from the decision output (node summaries in the outline instead). Latency improved (p50 about 1.0 s, p95 3.54 s / 2.71 s, against 1.54–1.58 s and 3.88–4.24 s in round 6), but the score fell to 8/10 and 6/10. 03 and 07 lost their return to an earlier topic in both samples: writing the running summary appears to help the model notice returns. Rejected under "commit only if the score does not drop". It cost 22 embedding requests.

