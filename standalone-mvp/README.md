# Local Workbench, standalone MVP

Run `python3 serve.py` (Windows: `py serve.py`), then open http://127.0.0.1:8765. Python 3 is the only launcher dependency. You can also open index.html directly, but localhost gives browser storage a stable address.

Create a task, write its draft, save a revision, then accept that saved revision locally. Editing again does not change what you accepted. Export accepted downloads only the exact accepted snapshot. Backup downloads the full local history; Restore replaces the current browser's workbench with a validated backup.

This is a small standalone replacement, not the previously tested OpenCode fork. It has no agent execution, Jira, GitHub, SharePoint, PowerPoint comparison, microphone, or external publication integration. Export is a file download, not publication. The earlier source checkout was lost during workspace cleanup; its test results do not apply to this app.

Data stays in this browser's local storage. Use Backup before moving machines or clearing browser data. Keep the same localhost port to keep the same storage location. Avoid editing from multiple tabs at once.

Source is included in index.html. Tests and their output are included. No installation, account, network service, or API token is required after download.

Developer tests: `npm install` then `npm test` (Node.js supporting jsdom 30.1.1). App execution does not require Node.js.
