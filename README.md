# Local Workbench MVP

A standalone offline task and revision-review workbench. This is not an OpenCode fork and does not contain the earlier lost control-plane implementation.

The application source, launcher, tests and validation output are in `standalone-mvp/` on the `standalone-mvp` branch.

Run from that directory:

```sh
python3 serve.py
```

On Windows use `py serve.py`. Open http://127.0.0.1:8765.

Features: persistent local tasks, working revisions, exact-revision local acceptance, accepted-output export, full backup and restore. No agent execution or external service integration.
