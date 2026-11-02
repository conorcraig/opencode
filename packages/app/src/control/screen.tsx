import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"

const stages = ["queued", "researching", "implementing", "validating", "reviewing", "completed", "cancelled"] as const
const attentions = ["normal", "human", "dependency", "resource", "failed", "paused", "disconnected"] as const
const storageKey = "opencode.control-plane"

type Task = {
  id: string
  revision: number
  title: string
  project: string
  objective: string
  criteria: string[]
  constraints: string[]
  priority: string
  stage: string
  attention: string
  blocker: string
  budget: number | null
  dependencies: string[]
  reviewRequired: boolean
}
type Review = { id: string; taskID: string; revision: number; status: string; feedback: string; brief: { ask: string; changed: string; next: string }; versions: Record<string, string> }
type Ask = { id: string; taskID: string; status: string; kind: string; answer: string; options: string[]; brief: { ask: string; uncertainty: string } }
type Run = { id: string; taskID: string; state: string; step: string; cost: number; agent: string; model: string; tokens: { input: number; output: number } }
type Artifact = { id: string; taskID: string; title: string; kind: string; provider: string; version: string; versionVerified: boolean; url: string; externalID: string }
type Comment = { id: string; artifactID: string; anchor: string; author: string; body: string; resolved: boolean; version: string }
type Delivery = { id: string; taskID: string; key: string; kind: string; status: string; destination: string; result: string; artifactID: string }
type Sync = { id: string; error: string; lastSuccess: number | null }
type QueueItem = { id: string; taskID: string; status: string; error: string; server: string; directory: string }
type Snapshot = {
  tasks: Task[]
  runs: Run[]
  artifacts: Artifact[]
  reviews: Review[]
  requests: Ask[]
  deliveries: Delivery[]
  comments: Comment[]
  syncs: Sync[]
  costs: { total: number; acceptedAverage: number | null; byModel: { model: string; cost: number; sessions: number; input: number; output: number }[] }
  scheduler?: { concurrency: number; servers: { key: string; url: string }[]; queue: QueueItem[] }
}
type Heads = { working?: string | null; accepted?: string | null; published?: string | null; manifest?: { outputs: { path: string; destination: string }[] } | null }

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export default function ControlScreen() {
  const [origin, setOrigin] = createSignal("http://127.0.0.1:4100")
  const [token, setToken] = createSignal("")
  const [connected, setConnected] = createSignal(false)
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const [selected, setSelected] = createSignal<string>()
  const [view, setView] = createSignal<"board" | "inbox" | "queue">("board")
  const [error, setError] = createSignal("")
  const [diff, setDiff] = createSignal("")
  const [slides, setSlides] = createSignal("")
  const [heads, setHeads] = createSignal<Heads>({})
  const [objective, setObjective] = createSignal("")
  const [criteria, setCriteria] = createSignal("")
  const [constraints, setConstraints] = createSignal("")
  const [budget, setBudget] = createSignal("")
  let title = ""
  let project = "Local"
  let newObjective = ""
  let newCriteria = ""
  let newConstraints = ""
  let feedback = ""
  let answer = ""
  let serverKey = "local"
  let serverUrl = "http://127.0.0.1:4096"
  let directory = ""
  let reviewAsk = ""
  let reviewChanged = ""
  let reviewNext = ""
  let deliveryKey = ""
  let deliveryDestination = ""
  let deliveryPayload = "{}"
  let artifactTitle = ""
  let artifactUrl = "https://example.com/output"
  let artifactExternal = ""
  let publicationVersion = ""
  let publicationEvidence = ""
  let exportName = "accepted"
  let slidePath = "deck.pptx"

  onMount(() => {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return
    const parsed = JSON.parse(saved) as { origin?: string; token?: string }
    if (parsed.origin) setOrigin(parsed.origin)
    if (parsed.token) {
      setToken(parsed.token)
      setConnected(true)
    }
  })

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(new URL(path, origin()), {
      ...init,
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...init?.headers },
    })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(body.error || `Control plane returned ${response.status}`)
    return body
  }

  async function refresh() {
    if (!connected()) return
    try {
      const next = await request("/api/snapshot") as Snapshot
      setSnapshot(next)
      setError("")
      const current = selected()
      if (current) setHeads(await request("/api/action", { method: "POST", body: JSON.stringify({ op: "history.heads", input: { taskID: current } }) }) as Heads)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function act(op: string, input: unknown) {
    try {
      const body = await request("/api/action", { method: "POST", body: JSON.stringify({ op, input }) })
      await refresh()
      return body
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  onMount(() => {
    const timer = setInterval(() => { void refresh() }, 3000)
    void refresh()
    onCleanup(() => clearInterval(timer))
  })

  const data = () => snapshot()
  const task = () => data()?.tasks.find((item) => item.id === selected())
  let loadedTask = ""
  createEffect(() => {
    const current = task()
    if (!current || current.id === loadedTask) return
    loadedTask = current.id
    setObjective(current.objective)
    setCriteria(current.criteria.join("\n"))
    setConstraints(current.constraints.join("\n"))
    setBudget(current.budget === null ? "" : String(current.budget))
  })
  const nameOf = (id: string) => data()?.tasks.find((item) => item.id === id)?.title ?? id
  const open = (id: string) => { setSelected(id); setDiff(""); setSlides(""); void refresh() }

  return (
    <main class="control-plane">
      <style>{`
        .control-plane{min-height:100vh;background:#14161b;color:#e8eaef;font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
        .control-plane header,.control-plane form,.control-plane .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .control-plane header,.control-plane section{padding:16px 20px}
        .control-plane h1,.control-plane h2{font-size:18px;margin:0}
        .control-plane h3{margin:12px 0 6px}
        .control-plane input,.control-plane textarea,.control-plane select,.control-plane button{background:#22262e;color:inherit;border:1px solid #3a404b;border-radius:6px;padding:6px 8px}
        .control-plane textarea{min-width:240px;min-height:64px}
        .control-plane button{cursor:pointer}
        .control-plane .tabs button[aria-current=true],.control-plane .card[aria-current=true]{border-color:#8eb6ff}
        .control-plane .board{display:grid;grid-template-columns:repeat(7,minmax(150px,1fr));gap:8px;align-items:start}
        .control-plane .column,.control-plane .panel{background:#1b1e25;border-radius:8px;padding:8px}
        .control-plane .card{display:block;width:100%;text-align:left;margin-top:6px}
        .control-plane pre{white-space:pre-wrap;background:#101217;padding:10px;border-radius:8px;overflow:auto}
        .control-plane .warn{color:#ffb4a8}
        .control-plane .muted{color:#a8b0bd}
        .control-plane .stack{display:grid;gap:8px}
      `}</style>
      <header>
        <h1>Control plane</h1>
        <input aria-label="Service origin" value={origin()} onInput={(event) => setOrigin(event.currentTarget.value)} />
        <input aria-label="User token" type="password" placeholder="User token" value={token()} onInput={(event) => setToken(event.currentTarget.value)} />
        <button onClick={() => { localStorage.setItem(storageKey, JSON.stringify({ origin: origin(), token: token() })); setConnected(true); void refresh() }}>Connect</button>
        <nav class="tabs row">
          <button aria-current={view() === "board"} onClick={() => setView("board")}>Board</button>
          <button aria-current={view() === "inbox"} onClick={() => setView("inbox")}>Inbox</button>
          <button aria-current={view() === "queue"} onClick={() => setView("queue")}>Queue and cost</button>
        </nav>
      </header>
      <Show when={error()}><p class="warn" style="padding:0 20px">{error()}</p></Show>

      <Show when={view() === "board"}>
        <section class="stack">
          <form onSubmit={(event) => { event.preventDefault(); void act("task.create", { title, project, objective: newObjective || title, criteria: lines(newCriteria), constraints: lines(newConstraints), dependencies: selected() ? [selected()] : [], reviewRequired: true }) }}>
            <input aria-label="Title" placeholder="Title" onInput={(event) => { title = event.currentTarget.value }} />
            <input aria-label="Project" placeholder="Project" value={project} onInput={(event) => { project = event.currentTarget.value }} />
            <input aria-label="Objective" placeholder="Shared objective" onInput={(event) => { newObjective = event.currentTarget.value }} />
            <input aria-label="Criteria" placeholder="Definition of done, one per line" onInput={(event) => { newCriteria = event.currentTarget.value }} />
            <input aria-label="Constraints" placeholder="Constraints, one per line" onInput={(event) => { newConstraints = event.currentTarget.value }} />
            <button>Create task</button>
          </form>
          <div class="board">
            <For each={stages}>{(stage) =>
              <div class="column">
                <strong>{stage}</strong>
                <For each={data()?.tasks.filter((item) => item.stage === stage) ?? []}>{(item) =>
                  <button class="card" aria-current={selected() === item.id} onClick={() => open(item.id)}>
                    {item.title}
                    <small class="muted" style="display:block">{item.project} · {item.attention}{item.blocker ? ` · ${item.blocker}` : ""}</small>
                  </button>
                }</For>
              </div>
            }</For>
          </div>
        </section>
      </Show>

      <Show when={view() === "inbox"}>
        <section class="stack">
          <h2>Needs a decision</h2>
          <For each={data()?.reviews.filter((review) => review.status === "pending" || review.status === "accepted") ?? []}>{(review) =>
            <article class="panel row">
              <button onClick={() => open(review.taskID)}>{nameOf(review.taskID)}</button>
              <span>{review.status}: {review.brief.ask}</span>
              <span class="muted">{review.brief.changed}</span>
            </article>
          }</For>
          <h3>Questions</h3>
          <For each={data()?.requests.filter((item) => item.status === "pending") ?? []}>{(item) =>
            <article class="panel row">
              <button onClick={() => open(item.taskID)}>{nameOf(item.taskID)}</button>
              <span>{item.kind}: {item.brief.ask}</span>
            </article>
          }</For>
          <h3>Unresolved native comments</h3>
          <For each={data()?.comments.filter((comment) => !comment.resolved) ?? []}>{(comment) => {
            const artifact = data()?.artifacts.find((item) => item.id === comment.artifactID)
            return <article class="panel"><button onClick={() => artifact && open(artifact.taskID)}>{comment.anchor || "unanchored"}</button> {comment.author}: {comment.body}</article>
          }}</For>
          <h3>Deliveries to reconcile</h3>
          <For each={data()?.deliveries.filter((item) => item.status === "unknown" || item.status === "failed") ?? []}>{(item) =>
            <article class="panel row">
              <button onClick={() => open(item.taskID)}>{nameOf(item.taskID)}</button>
              <span>{item.kind} · {item.status} · {item.result}</span>
            </article>
          }</For>
        </section>
      </Show>

      <Show when={view() === "queue"}>
        <section class="stack">
          <article class="panel">
            <h2>Cost</h2>
            <p>Total {data()?.costs.total.toFixed(4) ?? "0"} · completed-task average {data()?.costs.acceptedAverage === null || data()?.costs.acceptedAverage === undefined ? "n/a" : data()!.costs.acceptedAverage!.toFixed(4)}</p>
            <For each={data()?.costs.byModel ?? []}>{(item) => <p>{item.model}: {item.cost.toFixed(4)} across {item.sessions} sessions · {item.input} in / {item.output} out</p>}</For>
          </article>
          <form class="row" onSubmit={(event) => { event.preventDefault(); void act("server.register", { key: serverKey, url: serverUrl }) }}>
            <input aria-label="Server key" value={serverKey} onInput={(event) => { serverKey = event.currentTarget.value }} />
            <input aria-label="OpenCode URL" value={serverUrl} onInput={(event) => { serverUrl = event.currentTarget.value }} />
            <button>Register server</button>
            <Show when={data()?.scheduler}>
              <span>Capacity {data()!.scheduler!.concurrency}</span>
              <button type="button" onClick={() => void act("settings.update", { concurrency: Math.min(32, data()!.scheduler!.concurrency + 1) })}>Increase</button>
              <button type="button" onClick={() => void act("settings.update", { concurrency: Math.max(1, data()!.scheduler!.concurrency - 1) })}>Decrease</button>
            </Show>
          </form>
          <For each={data()?.scheduler?.queue ?? []}>{(item) =>
            <article class="panel row">
              <button onClick={() => open(item.taskID)}>{nameOf(item.taskID)}</button>
              <span>{item.server} · {item.directory} · {item.status} {item.error}</span>
              <Show when={item.status === "failed"}><button onClick={() => void act("queue.retry", { id: item.id })}>Retry same session</button></Show>
            </article>
          }</For>
        </section>
      </Show>

      <Show when={task()} keyed>{(current) =>
        <section class="stack">
          <article class="panel stack">
            <div class="row">
              <h2>{current.title}</h2>
              <select aria-label="Stage" value={current.stage} onChange={(event) => void act("task.patch", { id: current.id, revision: current.revision, patch: { stage: event.currentTarget.value } })}>
                <For each={stages}>{(stage) => <option value={stage}>{stage}</option>}</For>
              </select>
              <select aria-label="Attention" value={current.attention} onChange={(event) => void act("task.patch", { id: current.id, revision: current.revision, patch: { attention: event.currentTarget.value } })}>
                <For each={attentions}>{(attention) => <option value={attention}>{attention}</option>}</For>
              </select>
              <span class="muted">{current.blocker}</span>
            </div>
            <label>Objective <textarea value={objective()} onInput={(event) => setObjective(event.currentTarget.value)} /></label>
            <label>Definition of done <textarea value={criteria()} onInput={(event) => setCriteria(event.currentTarget.value)} /></label>
            <label>Local constraints <textarea value={constraints()} onInput={(event) => setConstraints(event.currentTarget.value)} /></label>
            <div class="row">
              <input aria-label="Budget" placeholder="Budget" value={budget()} onInput={(event) => setBudget(event.currentTarget.value)} />
              <button onClick={() => void act("task.patch", { id: current.id, revision: current.revision, patch: { objective: objective(), criteria: lines(criteria()), constraints: lines(constraints()), budget: budget().trim() ? Number(budget()) : null } })}>Save scope</button>
            </div>
            <p class="muted">Dependencies: {current.dependencies.map(nameOf).join(", ") || "none"} · review {current.reviewRequired ? "required" : "not required"}</p>
          </article>

          <article class="panel">
            <h3>Runs</h3>
            <For each={data()!.runs.filter((run) => run.taskID === current.id)}>{(run) => <p>{run.agent} · {run.model || "unattributed"} · {run.state} · {run.step} · {run.cost} · {run.tokens.input}/{run.tokens.output}</p>}</For>
            <form class="row" onSubmit={(event) => { event.preventDefault(); void act("task.enqueue", { taskID: current.id, server: serverKey, directory, execute: true }) }}>
              <input aria-label="Workspace directory" placeholder="Workspace directory" onInput={(event) => { directory = event.currentTarget.value }} />
              <button>Enqueue on {serverKey || "server"}</button>
            </form>
          </article>

          <article class="panel stack">
            <h3>Review</h3>
            <form class="row" onSubmit={(event) => { event.preventDefault(); void act("review.request", { taskID: current.id, brief: { ask: reviewAsk, changed: reviewChanged, rationale: reviewChanged, scrutiny: "", next: reviewNext } }) }}>
              <input aria-label="Decision needed" placeholder="Decision needed" onInput={(event) => { reviewAsk = event.currentTarget.value }} />
              <input aria-label="What changed" placeholder="What changed" onInput={(event) => { reviewChanged = event.currentTarget.value }} />
              <input aria-label="Next step" placeholder="Next step" onInput={(event) => { reviewNext = event.currentTarget.value }} />
              <button>Request review</button>
            </form>
            <For each={data()!.reviews.filter((review) => review.taskID === current.id)}>{(review) =>
              <div class="stack">
                <span>{review.status}: {review.brief.ask} → {review.brief.next}</span>
                <span class="muted">Exact versions {Object.entries(review.versions).map(([id, version]) => `${id} ${version}`).join(", ")}</span>
                <Show when={review.status === "pending" || review.status === "accepted"}>
                  <div class="row">
                    <input aria-label="Review feedback" placeholder="Feedback" onInput={(event) => { feedback = event.currentTarget.value }} />
                    <button onClick={() => void act("review.decide", { id: review.id, revision: review.revision, decision: "accepted", feedback })}>Accept locally</button>
                    <button onClick={() => void act("review.decide", { id: review.id, revision: review.revision, decision: "authorized", feedback })}>Authorize these actions</button>
                    <button onClick={() => void act("review.decide", { id: review.id, revision: review.revision, decision: "changes", feedback })}>Request changes</button>
                  </div>
                </Show>
              </div>
            }</For>
            <h3>Questions</h3>
            <For each={data()!.requests.filter((item) => item.taskID === current.id)}>{(item) =>
              <div class="row">
                <span>{item.status} · {item.brief.ask}{item.answer ? ` → ${item.answer}` : ""}</span>
                <Show when={item.status === "pending"}>
                  <input aria-label="Answer" placeholder={item.options.join(" / ")} onInput={(event) => { answer = event.currentTarget.value }} />
                  <button onClick={() => void act("request.answer", { id: item.id, answer })}>Answer</button>
                </Show>
              </div>
            }</For>
          </article>

          <article class="panel stack">
            <h3>Artifacts and native comments</h3>
            <form class="row" onSubmit={(event) => { event.preventDefault(); void act("artifact.upsert", { id: crypto.randomUUID(), taskID: current.id, title: artifactTitle, kind: "other", provider: "link", url: artifactUrl, externalID: artifactExternal || artifactTitle, version: "local", versionVerified: false, updated: Date.now() }) }}>
              <input aria-label="Artifact title" placeholder="Output title" onInput={(event) => { artifactTitle = event.currentTarget.value }} />
              <input aria-label="Artifact URL" placeholder="https:// destination" onInput={(event) => { artifactUrl = event.currentTarget.value }} />
              <button>Register output</button>
            </form>
            <For each={data()!.artifacts.filter((item) => item.taskID === current.id)}>{(item) =>
              <div class="stack">
                <div class="row">
                  <a href={item.url}>{item.title}</a>
                  <span>{item.provider} · {item.externalID} · {item.version}{item.versionVerified ? " verified" : " unverified"}</span>
                  <span class="warn">{data()!.syncs.find((sync) => sync.id === item.id)?.error}</span>
                  <Show when={item.provider !== "link"}><button onClick={() => void act("artifact.sync", { id: item.id })}>Sync native revision</button></Show>
                </div>
                <For each={data()!.comments.filter((comment) => comment.artifactID === item.id)}>{(comment) =>
                  <p class={comment.resolved ? "muted" : ""}>{comment.resolved ? "resolved" : "open"} · {comment.anchor} · {comment.author}: {comment.body}</p>
                }</For>
              </div>
            }</For>
            <h3>Prepared external actions</h3>
            <form class="row" onSubmit={(event) => {
              event.preventDefault()
              const artifactID = data()!.artifacts.find((item) => item.taskID === current.id)?.id
              if (!artifactID) return setError("Register an output before preparing an external action")
              let payload: Record<string, unknown>
              try { payload = JSON.parse(deliveryPayload) as Record<string, unknown> } catch { return setError("Action payload must be JSON") }
              void act("delivery.prepare", { id: crypto.randomUUID(), taskID: current.id, key: deliveryKey, kind: "publish", artifactID, destination: deliveryDestination, payload, status: "ready", result: "", updated: Date.now() })
            }}>
              <input aria-label="Action key" placeholder="Unique action key" onInput={(event) => { deliveryKey = event.currentTarget.value }} />
              <input aria-label="Destination" placeholder="Destination" onInput={(event) => { deliveryDestination = event.currentTarget.value }} />
              <input aria-label="Payload JSON" placeholder="Payload JSON" onInput={(event) => { deliveryPayload = event.currentTarget.value }} />
              <button>Prepare action</button>
            </form>
            <For each={data()!.deliveries.filter((item) => item.taskID === current.id)}>{(item) =>
              <div class="row">
                <span>{item.kind} · {item.key} · {item.status} · {item.destination} {item.result}</span>
                <Show when={item.status === "ready"}><button onClick={() => void act("delivery.publish", { id: item.id })}>Publish authorized action</button></Show>
                <Show when={item.status === "unknown" || item.status === "failed"}>
                  <button onClick={() => void act("delivery.reconcile", { id: item.id, delivered: true, evidence: publicationEvidence || "Verified at the destination" })}>Mark delivered</button>
                  <button onClick={() => void act("delivery.reconcile", { id: item.id, delivered: false, evidence: publicationEvidence || "Destination does not show this action" })}>Return to ready</button>
                </Show>
              </div>
            }</For>
          </article>

          <article class="panel stack">
            <h3>Local revisions</h3>
            <p>Working {heads().working ?? "none"} · Accepted {heads().accepted ?? "none"} · Published {heads().published ?? "none"}</p>
            <div class="row">
              <Show when={heads().working && heads().working !== heads().accepted}>
                <button onClick={() => void act("history.accept", { taskID: current.id, commit: heads().working })}>Accept working revision</button>
              </Show>
              <Show when={heads().working && heads().accepted}>
                <button onClick={() => void act("history.compare", { taskID: current.id, target: heads().working, baseline: "accepted" }).then((body) => setDiff((body as { diff?: string } | undefined)?.diff ?? ""))}>Compare with accepted</button>
              </Show>
              <input aria-label="PPTX output path" value={slidePath} onInput={(event) => { slidePath = event.currentTarget.value }} />
              <Show when={heads().working && heads().accepted}>
                <button onClick={() => void act("history.compareSlides", { taskID: current.id, from: heads().accepted, to: heads().working, path: slidePath }).then((body) => setSlides(body ? JSON.stringify(body, null, 2) : ""))}>Compare slides</button>
              </Show>
              <input aria-label="Export name" value={exportName} onInput={(event) => { exportName = event.currentTarget.value }} />
              <button onClick={() => void act("history.export", { taskID: current.id, name: exportName })}>Export accepted revision</button>
            </div>
            <Show when={heads().accepted && heads().manifest?.outputs.length}>
              <div class="row">
                <input aria-label="Published version" placeholder="Verified external version" onInput={(event) => { publicationVersion = event.currentTarget.value }} />
                <input aria-label="Publication evidence" placeholder="Evidence for every destination" onInput={(event) => { publicationEvidence = event.currentTarget.value }} />
                <button onClick={() => void act("history.recordPublication", { taskID: current.id, commit: heads().accepted, receipts: heads().manifest!.outputs.map((output) => ({ destination: output.destination, version: publicationVersion, evidence: publicationEvidence })) })}>Record publication</button>
              </div>
              <p class="muted">{heads().manifest!.outputs.map((output) => `${output.path} → ${output.destination}`).join("; ")}</p>
            </Show>
            <Show when={diff()}><pre>{diff()}</pre></Show>
            <Show when={slides()}><pre>{slides()}</pre></Show>
          </article>
        </section>
      }</Show>
    </main>
  )
}
