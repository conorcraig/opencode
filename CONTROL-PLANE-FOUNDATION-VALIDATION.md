# Reconstruction foundation checks

Validated in the reconstruction environment on 2026-11-01 (America/Los_Angeles).

- Official upstream fetch succeeded for exact commit `8bca5329293a34f4bdd7fdc4f4020be80c1eb477`; checkout is detached. No customization branch was created.
- Bun `1.4.4` installed through npm's reputable `bun` package.
- Unmodified upstream `bun install --frozen-lockfile` completed: 1,798 packages, 21.58 seconds.
- Subsequent reconstruction dependency install completed: 9 additional packages, 7.70 seconds, lockfile refreshed for the new control-plane workspace and native-comment dependencies.
- `python3 -m py_compile script/bootstrap-control-plane.py` passed.
- Real `bootstrap-control-plane.py --no-install` smoke run fetched the exact pinned upstream into a new directory and overlaid eight available source paths. The prepared tree contained both real upstream app source and the reconstructed control-plane package.
- Reusing that existing destination was rejected before any checkout modification.

These are foundation checks only. They do not claim app builds, workflow tests, native desktop operation, model execution, external account access or publication. Each feature's checks must be reported separately on the newly reconstructed sources.
