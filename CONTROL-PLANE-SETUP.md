# OpenCode control-plane reconstruction

This repository preserves the recovered and reconstructed control-plane source. It is not a byte-for-byte restoration of the deleted checkout. Every new commit must be pushed to the repository before treating that checkpoint as durable. Earlier screenshots and test logs establish the earlier implementation's behavior, not this reconstruction's test status.

## Prepare the actual OpenCode fork

The source repository is an overlay on MIT-licensed OpenCode. It pins the exact upstream revision in `control-plane-upstream.json`; bootstrap fetches that revision and applies the committed control-plane and host changes. It refuses an existing destination and never alters that checkout.

Requirements: Git, Python 3, and Bun 1.4.4 (the version pinned by upstream). Node.js is not a substitute for the Bun SQLite runtime.

```sh
git clone https://github.com/conorcraig/opencode.git opencode-control-source
cd opencode-control-source
python3 script/bootstrap-control-plane.py ../opencode-control-working
cd ../opencode-control-working
```

On Windows, use `py` instead of `python3`. `--no-install` prepares the checkout without installing dependencies.

## Run

From the prepared working checkout, start the separate workflow service:

```sh
bun run --cwd packages/control-plane start
```

Use the startup output's credential-file location. The user token belongs in the control-plane Connection form; the worker token is for MCP/agent reporting. Never provide the user token to an agent. External service credentials remain local environment variables and must not be committed.

Start the ordinary OpenCode backend and GUI in separate terminals:

```sh
bun run dev serve --hostname 127.0.0.1 --port 4096
bun run --cwd packages/app dev -- --port 4444
```

Open http://localhost:4444/control/overview, or choose Control plane from the command palette. That route is the control workspace and stays available when no coding server is paired. For native desktop development, use the upstream `bun run dev:desktop` command. Native Windows/Electron execution and account authentication require target-machine validation; a web build alone does not establish them.

## Validate

```sh
(cd packages/control-plane && bun test)
(cd packages/control-plane && bun run typecheck:tsc)
(cd packages/app && bun run typecheck:tsc)
bun run check
bun run --cwd packages/app build
```

Only claim checks that have actually passed on the reconstructed sources. The root test script intentionally refuses tests; run package tests in their directories. Full web/desktop checks depend on installing the entire upstream workspace.

## Upstream maintenance and rollback

Control-plane service code belongs in `packages/control-plane`; feature GUI code belongs in `packages/app/src/control`. Keep host modifications limited to the paths in the overlay manifest. To evaluate another upstream revision, prepare a separate checkout and run the checks there. Never silently move the pinned revision or overwrite an existing working directory. Keep the last tested commit available in GitHub for rollback.
