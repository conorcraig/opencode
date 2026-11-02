import { OpenCode, isSessionNotFoundError } from "@opencode/client/promise"
import { Run, Task, QueueItem } from "./schema"
import { WorkflowStore } from "./store"

export async function dispatchQueued(store: WorkflowStore, transport: typeof fetch = fetch) {
  const priority = { low: 0, normal: 1, high: 2, urgent: 3 }
  const queue = store.all("queue", QueueItem).filter(item => item.status === "queued").toSorted((a, b) => priority[store.get("tasks", b.taskID, Task).priority] - priority[store.get("tasks", a.taskID, Task).priority] || a.created - b.created)
  for (const candidate of queue) {
    const item = store.reserve(candidate.id)
    if (!item) continue
    const server = store.servers().find(entry => entry.key === item.server)
    if (!server) { store.settleQueue(item.id, "failed", "Background server unavailable"); continue }
    const api = OpenCode.make({ baseUrl: server.url, fetch: transport, headers: server.password ? { Authorization: `Basic ${btoa(`opencode:${server.password}`)}` } : undefined })
    const task = store.get("tasks", item.taskID, Task)
    await api.session.get({ sessionID: item.sessionID }, { signal: AbortSignal.timeout(20_000) }).catch((cause: unknown) => {
      // Only a definitive missing session permits creation. Authentication and network failures must not create another session.
      if (isSessionNotFoundError(cause)) return api.session.create({ id: item.sessionID, title: task.title, location: { directory: item.directory } }, { signal: AbortSignal.timeout(20_000) })
      throw cause
    }).then(async session => {
      store.releaseQueue(item.id)
      if (!store.reserve(item.id)) return
      const latest = store.get("tasks", item.taskID, Task)
      const existing = store.all("runs", Run).find(run => run.server === server.key && run.sessionID === session.id)
      if (!existing) store.run({ id: `queue:${item.id}`, taskID: task.id, parentID: null, server: server.key, sessionID: session.id, agent: session.title ?? task.title, state: item.execute ? "running" : "idle", step: "", todos: [], started: session.time.created, updated: Date.now(), lastOutput: null, cost: session.cost, model: session.model ? `${session.model.providerID}/${session.model.id}` : "", tokens: { input: session.tokens.input, output: session.tokens.output, reasoning: session.tokens.reasoning, cacheRead: session.tokens.cache.read, cacheWrite: session.tokens.cache.write } }, "scheduler")
      await api.session.prompt({ sessionID: session.id, id: `msg_control_start_${item.id}`, resume: item.execute, text: JSON.stringify({ task: latest, instruction: "Read and maintain this task through workflow MCP. Follow its criteria and constraints. Make atomic local commits. Work privately between meaningful checkpoints. Local acceptance never authorizes external upload, review request, push or publication. Register exact revisions and prepared external actions before requesting their separate authorization. Use native comment anchors. Publish only through the workflow gate." }) }, { signal: AbortSignal.timeout(20_000) })
      store.settleQueue(item.id, "admitted")
      const current = store.get("tasks", task.id, Task)
      if (current.stage === "queued" && item.execute) store.patch(task.id, current.revision, { stage: "implementing" }, "scheduler")
    }).catch((cause: unknown) => {
      if (store.get("queue", item.id, QueueItem).status === "admitted") return
      const run = store.all("runs", Run).find(run => run.server === server.key && run.sessionID === item.sessionID)
      if (run) store.run({ ...run, state: "disconnected", updated: Date.now() }, "scheduler")
      store.settleQueue(item.id, "failed", cause instanceof Error ? cause.message : String(cause))
    })
  }
}
