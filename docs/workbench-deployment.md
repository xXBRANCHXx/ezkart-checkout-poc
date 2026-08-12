# Ezkart workbench deployment

The experimental builder is isolated on `agent/ezkart-workbench`. Production remains on `main`.

## Recommended topology

| Environment | Host | Git branch | Purpose |
| --- | --- | --- | --- |
| Production | `ezkart.id` | `main` | Stable customer and seller experience |
| Workbench | `workbench.ezkart.id` | `agent/ezkart-workbench` | Private acceptance testing before merge |
| Executive dashboard | `executive.ezkart.id` | separate private repository | Portfolio, project, workflow, and launch visibility |

The workbench is dependency-free PHP/HTML and should deploy from the repository root with no build command.

## Hostinger hPanel handoff

1. Add `workbench.ezkart.id` as an independent PHP/HTML website in hPanel.
2. Open that website's dashboard, then **Advanced → Git**.
3. Connect GitHub and select `Radish-Labs/Ezkart`.
4. Select the `agent/ezkart-workbench` branch and deploy to the workbench site's `public_html` root.
5. Enable auto-deployment only for that branch.
6. Add the same sandbox-only runtime configuration used by the current test environment. Do not copy production Midtrans server keys into a browser-visible file.
7. Password-protect the subdomain and add `X-Robots-Tag: noindex, nofollow` at the hosting layer before sharing it.

Hostinger's current Git integration records the deployed branch and commit in deployment history. This makes every acceptance-test report traceable to a commit.

## Promotion workflow

```text
main (production) ───────●──────────────●─────────────▶
                         ╲              ▲
workbench                 ●──●──●──QA───┘
                          build  test  approved merge
```

1. Work only on `agent/ezkart-workbench` or a short-lived branch created from it.
2. Push to refresh the private workbench deployment.
3. Record browser/device checks and payment-provider checks.
4. Merge the draft PR only after approval.
5. Tag the production merge and keep the previous tag available for rollback.

## Current split

- Production baseline commit: `8fd3680`
- Preserved experimental tag: `workbench-snapshot-2026-08-12`
- Workbench branch: `agent/ezkart-workbench`
- Workbench reapplication commit: `d3de57c`
