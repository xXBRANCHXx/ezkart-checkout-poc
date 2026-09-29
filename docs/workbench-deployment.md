# Ezkart workbench deployment

The experimental builder is isolated on `agent/ezkart-workbench`. Production remains on `main`.

## Recommended topology

| Environment | Host | Git branch | Purpose |
| --- | --- | --- | --- |
| Production | `ezkart.id` | `main` | Stable customer and seller experience |
| Workbench | `test.ezkart.id` | `agent/ezkart-workbench` | Private acceptance testing before merge |
| Executive dashboard | `admin.ezkart.id` | `Radish-Labs/Ezkart-Executive-Dashboard` `main` | Portfolio, project, workflow, and launch visibility |

The workbench is dependency-free PHP/HTML and should deploy from the repository root with no build command.

## Hostinger hPanel handoff

1. Add `test.ezkart.id` as an independent PHP/HTML website in hPanel.
2. Open that website's dashboard, then **Advanced → Git**.
3. Connect GitHub and select `Radish-Labs/Ezkart`.
4. Select the `agent/ezkart-workbench` branch and deploy to the workbench site's `public_html` root.
5. Enable auto-deployment only for that branch.
6. Preserve the current sandbox runtime until the live beta cutover is ready. The owner-approved beta uses `deployment_environment=beta`, `commerce_environment=production` and separate beta Worker/D1/R2 bindings. Follow [beta readiness](beta-readiness.md); changing the Executive mode alone is insufficient. Existing sandbox setup is documented in [commerce setup](commerce-sandbox-setup.md).
7. Password-protect the subdomain and add `X-Robots-Tag: noindex, nofollow` at the hosting layer before sharing it.

Hostinger keeps following the branch selected for each website after a merge. You do not reconnect Git. Continue pushing test work to `agent/ezkart-workbench`; merge approved commits into `main`; `test.ezkart.id` and `ezkart.id` remain separate deployments.

Database credentials are also separate. See [Database environments and safe branch merges](database-environments.md).

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

- Production branch includes merged PR #1 at `3ddb71c`
- Preserved experimental tag: `workbench-snapshot-2026-08-12`
- Workbench branch: `agent/ezkart-workbench`
- Workbench continues from production on `agent/ezkart-workbench`

## Delivery verification (29 September 2026)

The local `deployment` remote points to `xXBRANCHXx/ezkart-checkout-poc`.
The current workbench host follows its `agent/ezkart-workbench` branch. Push
completed workbench changes to both `origin` and this deployment mirror, then
compare hosted assets with source. Pushing only to `origin` did not refresh the
hosted files during the bank-change-review delivery. Neither push targets main.
