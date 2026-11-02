import { OpenCode, type SessionMessageInfo, type SessionInfo } from "@opencode/client/promise"
import { z } from "zod"
import { Artifact, Comment, Request, Review, Run, ServerConfig, Task } from "./schema"
import { WorkflowStore } from "./store"
import { dispatchQueued } from "./scheduler"

export { ServerConfig }

function sessionRun(session: SessionInfo, server: string, taskID: string, id: string, parentID: string | null): Run {
  return Run.parse({ id, taskID, parentID, server, sessionID: session.id, agent: session.title ?? session.id, state: "idle", step: "", todos: [], started: session.time.created, updated: Date.now(), lastOutput: null, cost: session.cost, model: session.model ? `${session.model.providerID}/${session.model.id}` : "", tokens: { input: session.tokens.input, output: session.tokens.output, reasoning: session.tokens.reasoning, cacheRead: session.tokens.cache.read, cacheWrite: session.tokens.cache.write } })
}

/** Background observation, queue admission and durable decisions continue with the GUI closed. */
export function observeOpenCode(store: WorkflowStore, configs: z.infer<typeof ServerConfig>[] = [], transport: typeof fetch = fetch) {
  configs.forEach(config => store.registerServer(config))
  const state = { polling: false, stopped: false }
  const tick = async () => {
    if (state.polling || state.stopped) return
    state.polling = true
    try {
      await Promise.allSettled(store.servers().map(async config => {
        const api = OpenCode.make({ baseUrl: config.url, fetch: transport, headers: config.password ? { Authorization: `Basic ${btoa(`opencode:${config.password}`)}` } : undefined })
        const options = () => ({ signal: AbortSignal.timeout(20_000) })
        const runs = store.all("runs", Run).filter(run => run.server === config.key)
        const active = await api.session.active(options()).catch((cause: unknown) => {
          runs.forEach(run => store.run({ ...run, state: "disconnected", updated: Date.now() }, "observer"))
          throw cause
        })
        for (const run of runs) {
          if (state.stopped) return
          if (!active[run.sessionID] && ["idle", "finished"].includes(run.state) && Date.now() - run.updated < 25_000) continue
          await api.session.get({ sessionID: run.sessionID }, options()).then(async session => {
            const pagination: { cursor?: string } = {}
            const seen = new Set<string>()
            while (true) {
              const children = await api.session.list({ parentID: session.id, limit: 200, cursor: pagination.cursor }, options())
              children.data.forEach(child => {
                if (store.all("runs", Run).some(item => item.server === config.key && item.sessionID === child.id)) return
                store.run(sessionRun(child, config.key, run.taskID, `${run.id}:${child.id}`, run.id), "observer")
              })
              if (!children.cursor.next) break
              if (seen.has(children.cursor.next)) throw new Error("Session pagination repeated a page")
              seen.add(children.cursor.next)
              pagination.cursor = children.cursor.next
            }
            const messages = await api.message.list({ sessionID: session.id, limit: 100, order: "desc" }, options())
            const forms = await api.session.form.list({ sessionID: session.id }, options())
            const permissions = await api.permission.request.list({ location: { directory: session.location.directory } }, options())
            const todos = latestTodos(messages.data.toReversed())
            store.run({ ...sessionRun(session, config.key, run.taskID, run.id, run.parentID), state: forms.length || permissions.data.some(permission => permission.sessionID === session.id) ? "waiting" : active[session.id] ? "running" : session.outcome === "failed" ? "failed" : session.outcome === "succeeded" ? "finished" : "idle", todos, step: todos.find(todo => todo.status === "in_progress")?.content ?? todos.find(todo => todo.status === "pending")?.content ?? "", lastOutput: messages.data.find(message => message.type === "assistant")?.time.created ?? null }, "observer")
            const task = store.get("tasks", run.taskID, Task)
            const spend = store.all("runs", Run).filter(item => item.taskID === task.id).reduce((sum, item) => sum + item.cost, 0)
            if (task.attention === "paused" || task.stage === "cancelled" || (task.budget !== null && spend >= task.budget)) {
              if (active[session.id]) await api.session.interrupt({ sessionID: session.id }, options())
              if (task.budget !== null && spend >= task.budget && task.attention !== "resource") store.patch(task.id, task.revision, { attention: "resource", blocker: "Recorded task spend reached its budget" }, "observer")
            }
          }).catch(() => store.run({ ...store.get("runs", run.id, Run), state: "disconnected", updated: Date.now() }, "observer"))
        }
        const roots = store.all("runs", Run).filter(run => run.server === config.key && !run.parentID)
        for (const run of roots) {
          const cursorKey = `opencode:${config.key}:task:${run.taskID}`
          const progress = { cursor: store.cursor(cursorKey) || store.cursor(`opencode:${config.key}`), deferred: false }
          while (!progress.deferred) {
            const events = store.snapshot(progress.cursor).events
            if (!events.length) break
            for (const event of events) {
              if (state.stopped) return
              if (event.taskID === run.taskID && ["review.accepted", "review.authorized", "review.changes", "request.answered"].includes(event.kind)) {
                const task = store.get("tasks", run.taskID, Task)
                if (["paused", "resource", "failed", "disconnected"].includes(task.attention)) { progress.deferred = true; break }
                if (!["cancelled", "completed"].includes(task.stage)) {
                  const decision = event.kind === "request.answered" ? z.object({ id: z.string() }).parse(event.data) : Review.parse(event.data)
                  const latest = "revision" in decision ? store.all("reviews", Review).findLast(item => item.taskID === task.id) : undefined
                  const current = "revision" in decision ? latest?.id === decision.id && latest.revision === decision.revision && "status" in decision && latest.status === decision.status : store.get("requests", decision.id, Request).status === "resolved"
                  if (current) {
                    const artifactIDs = new Set(store.all("artifacts", Artifact).filter(item => item.taskID === task.id).map(item => item.id))
                    await api.session.prompt({ sessionID: run.sessionID, id: `msg_control_${"revision" in decision ? `review_${decision.id}_${decision.revision}` : `request_${decision.id}`}`, delivery: "steer", text: JSON.stringify({ instruction: "A persisted owner decision is ready. Read the latest workflow snapshot before acting. Accept locally is a private checkpoint, never permission to upload or publish. Use exact native comment anchors. Publication requires separate authorization of its exact prepared actions and the workflow gate.", task, decision, comments: store.all("comments", Comment).filter(comment => artifactIDs.has(comment.artifactID) && !comment.resolved), answers: store.all("requests", Request).filter(request => request.taskID === task.id && request.status === "resolved") }) }, options())
                  }
                }
              }
              progress.cursor = event.seq
              store.checkpoint(cursorKey, event.seq)
            }
            if (events.length < 500) break
          }
        }
      }))
      if (!state.stopped) await dispatchQueued(store, transport)
    } finally {
      state.polling = false
    }
  }
  const timer = setInterval(() => { void tick().catch(() => undefined) }, 3000)
  return { tick, close() { state.stopped = true; clearInterval(timer) } }
}

function latestTodos(messages: readonly SessionMessageInfo[]): Run["todos"] {
  const call = messages.flatMap(message => message.type === "assistant" ? message.content : []).findLast(item => item.type === "tool" && item.name === "todowrite" && item.state.status === "completed")
  if (call?.type !== "tool" || call.state.status !== "completed") return []
  const result = z.array(z.object({ content: z.string(), status: z.enum(["pending", "in_progress", "completed", "cancelled"]) })).safeParse(call.state.input.todos)
  return result.success ? result.data : []
}
