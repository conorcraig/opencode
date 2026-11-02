import { Artifact, ArtifactSync } from "./schema"
import { WorkflowStore } from "./store"

type Syncer = { sync: (id: string) => Promise<Artifact> }

/** Re-read native revisions while the GUI is closed. Link artifacts have no adapter. */
export function observeArtifacts(store: WorkflowStore, integration: Syncer, interval = 20_000) {
  const state = { polling: false, stopped: false }
  const tick = async () => {
    if (state.polling || state.stopped) return
    state.polling = true
    try {
      const now = Date.now()
      for (const artifact of store.snapshot().artifacts) {
        if (state.stopped || artifact.provider === "link") continue
        const previous = store.snapshot().syncs.find((item) => item.id === artifact.id)
        if (previous && previous.nextAttempt > now) continue
        await integration.sync(artifact.id).then(
          () => {
            const checked = Date.now()
            store.setSync(ArtifactSync.parse({ id: artifact.id, checkedAt: checked, lastSuccess: checked, error: "", nextAttempt: checked + interval }))
          },
          (cause: unknown) => {
            const checked = Date.now()
            const priorGap = previous ? Math.max(interval, previous.nextAttempt - previous.checkedAt) : interval
            const delay = Math.min(5 * 60_000, priorGap * 2)
            store.setSync(ArtifactSync.parse({
              id: artifact.id,
              checkedAt: checked,
              lastSuccess: previous?.lastSuccess ?? null,
              error: cause instanceof Error ? cause.message : String(cause),
              nextAttempt: checked + delay,
            }))
          },
        )
      }
    } finally {
      state.polling = false
    }
  }
  const timer = setInterval(() => { void tick().catch(() => undefined) }, interval)
  return { tick, close() { state.stopped = true; clearInterval(timer) } }
}
