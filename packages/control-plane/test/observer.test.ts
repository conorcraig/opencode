import { afterEach, expect, test } from "bun:test"
import { Artifact, TaskCreate } from "../src/schema"
import { observeArtifacts } from "../src/artifact-observer"
import { WorkflowStore } from "../src/store"

const stores: WorkflowStore[] = []
afterEach(() => stores.splice(0).forEach((store) => store.close()))

test("artifact observation skips links, records success, and backs off after failure", async () => {
  const store = new WorkflowStore(":memory:")
  stores.push(store)
  const task = store.create(TaskCreate.parse({ title: "Guide", project: "Docs", objective: "Keep the native revision" }), "user")
  const link = store.artifact(Artifact.parse({ id: "link", taskID: task.id, title: "Note", kind: "other", provider: "link", url: "https://example.com/note", externalID: "note", version: "1", versionVerified: false, updated: 1 }), "user")
  store.artifact(Artifact.parse({ id: "pr", taskID: task.id, title: "PR", kind: "pr", provider: "github", url: "https://github.com/acme/app/pull/1", externalID: "1", version: "abc", versionVerified: false, updated: 1 }), "user")
  let calls = 0
  const observer = observeArtifacts(store, {
    sync: async (id) => {
      calls += 1
      if (calls === 1) throw new Error("GitHub unavailable")
      const current = store.get("artifacts", id, Artifact)
      return store.syncArtifact(current, "def", [])
    },
  }, 20_000)
  try {
    await observer.tick()
    expect(calls).toBe(1)
    expect(store.get("artifacts", link.id, Artifact).versionVerified).toBe(false)
    const failed = store.snapshot().syncs.find((item) => item.id === "pr")
    expect(failed?.error).toBe("GitHub unavailable")
    expect(failed!.nextAttempt - failed!.checkedAt).toBe(40_000)
    await observer.tick()
    expect(calls).toBe(1)
    store.setSync({ ...failed!, nextAttempt: 0 })
    await observer.tick()
    expect(calls).toBe(2)
    expect(store.get("artifacts", "pr", Artifact).version).toBe("def")
    expect(store.snapshot().syncs.find((item) => item.id === "pr")?.error).toBe("")
  } finally {
    observer.close()
  }
})
