# OpenCode agent control plane

This repository holds the control-plane customization for a pinned OpenCode checkout. The goal remains a dark desktop workspace for overseeing agent work: durable tasks, an actionable review inbox, native artifact feedback, exact-revision local acceptance, separately authorized external publication, dependencies, scheduling and costs.

The earlier temporary implementation was deleted by workspace cleanup. Retained source excerpts and reconstructed modules are being committed here directly to main in atomic checkpoints. Earlier test results do not establish the reconstructed version's correctness.

## Prepare the OpenCode checkout

```sh
git clone https://github.com/conorcraig/opencode.git opencode-control-source
cd opencode-control-source
python3 script/bootstrap-control-plane.py ../opencode-control-working
```

Bootstrap fetches the exact MIT-licensed official upstream revision, then applies this repository's source overlay. See [setup](CONTROL-PLANE-SETUP.md) for service, GUI and validation commands. Current implementation and checks are recorded in [recovery status](recovery/STATUS.md).

`standalone-mvp/` preserves the small offline fallback previously shipped. It is not the control plane.
