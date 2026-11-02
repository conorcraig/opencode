# Recovery and reconstruction status

The original working checkout and temporary source archive were removed by automated workspace pruning before being preserved remotely. Prior screenshots/test logs survived; they do not verify the reconstruction.

## Retained implementation knowledge

- Official upstream revision:8bca5329293a34f4bdd7fdc4f4020be80c1eb477, MIT, Bun1.4.4.
- Separate Bun SQLite workflow service on localhost4100, independent user/worker credentials, HTTP actions and stdio MCP.
- Feature GUI isolated in packages/app/src/control with narrow route/shell/layout/i18n integration.
- Task stage and attention are independent. Review of one artifact does not stop independent work.
- Immutable working revisions; accepting locally does not authorize upload, outside review, merge or publication.
- Review binds exact revisions. Native comment anchors retain location context.
- Published destination and locally accepted baselines are distinct comparison targets.
- Jira carries shared objective, definition of done, coarse plan, milestones and completion. Detailed checklists and scratch revisions stay local.
- Required outputs/destinations are defined before execution, with reusable defaults.
- PowerPoint comparison matches stable slide IDs across reorder and reports text/object/media/template changes. Rendered comparisons require a renderer; Markdown is auxiliary.
- Prepared publication payloads are immutable and approved before dispatch. Interrupted sending becomes unknown and requires reconciliation, not blind retry.
- Deterministic queue session/prompt IDs, prerequisites, budgets and capacity. Disconnected execution occupies capacity until reconciled.
- Paused decisions remain deliverable on resume; superseded decisions do not restart obsolete work.
- Costs count each session's own totals once. Model attribution must reconcile. Accepted-task averages exclude unfinished spend.

## Current checkpoint

The service observes native artifacts, keeps exact local Git revisions, compares PPTX outputs by stable slide ID, and reports cost with model totals that reconcile. Completed-task averages exclude unfinished spend.

`/control/overview` is the workspace: stage board, decision inbox, native comments, prepared publication, local acceptance versus publication, queue, and cost. The command palette entry "Control plane" opens it from the paired shell. The route itself does not require a paired coding server.

Native Windows/Electron, real-account publication, and model-driven runs still need fresh validation on a bootstrapped checkout. Translation files are untouched so the pinned upstream copy is not replaced by a partial catalog.
