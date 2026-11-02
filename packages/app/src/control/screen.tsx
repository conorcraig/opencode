import { createSignal, For, onCleanup, onMount, Show } from "solid-js"

const stages = ["queued", "researching", "implementing", "validating", "reviewing", "completed", "cancelled"] as const
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
  reviewRequired: boolean
}
type Review = { id: string; taskID: string; revision: number; status: string; feedback: string; brief: { ask: string; next: string } }
type Ask = { id: string; taskID: string; status: string; answer: string; brief: { ask: string } }
type Run = { id: string; taskID: string; state: string; step: string; cost: number; agent: string }
type Artifact = { id: string; taskID: string; title: string; provider: string; version: string; versionVerified: boolean; url: string }
type Delivery = { id: string; taskID: string; status: string; kind: string; destination: string; result: string }
type Sync = { id: string; error: string }
type QueueItem = { id: string; taskID: string; status: string; error: string; server: string }
type Snapshot = {
  tasks: Task[]
  runs: Run[]
  artifacts: Artifact[]
  reviews: Review[]
  requests: Ask[]
  deliveries: Delivery[]
  syncs: Sync[]
  scheduler?: { concurrency: number; queue: QueueItem[] }
}

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export default function ControlScreen() {
  const [origin, setOrigin] = createSignal("http://127.0.0.1:4100")
  const [token, setToken] = createSignal("")
  const [connected, setConnected] = createSignal(false)
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const [selected, setSelected] = createSignal<string>()
  const [error, setError] = createSignal("")
  const [diff, setDiff] = createSignal("")
  const [heads, setHeads] = createSignal<{ working?: string | null; accepted?: string | null; published?: string | null; manifest?: { outputs: { destination: string }[] } | null }>({})
  let publicationVersion = ""
  let publicationEvidence = ""
  let title = ""
  let project = "Local"
  let objective = ""
  let criteria = ""
  let feedback = ""
  let answer = ""
  let serverKey = "local"
  let serverUrl = "http://127.0.0.1:4096"

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
      setSnapshot(await request("/api/snapshot") as Snapshot)
      setError("")
      const current = selected()
      if (current) setHeads(await request("/api/action", { method: "POST", body: JSON.stringify({ op: "history.heads", input: { taskID: current } }) }) as typeof heads extends () => infer T ? T : never)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function act(op: string, input: unknown) {
    try {
      await request("/api/action", { method: "POST", body: JSON.stringify({ op, input }) })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  onMount(() => {
    const timer = setInterval(() => { void refresh() }, 3000)
    void refresh()
    onCleanup(() => clearInterval(timer))
  })

  const task = () => snapshot()?.tasks.find((item) => item.id === selected())
  const cost = () => snapshot()?.runs.filter((run) => run.taskID === task()?.id).reduce((sum, run) => sum + run.cost, 0) ?? 0

  return (
    <main class="control-plane">
      <style>{`
        .control-plane{min-height:100vh;background:#14161b;color:#e8eaef;font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
        .control-plane header,.control-plane form,.control-plane article{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .control-plane header,.control-plane section{padding:16px 20px}
        .control-plane h1{font-size:18px;margin:0 12px 0 0}
        .control-plane input,.control-plane textarea,.control-plane select,.control-plane button{background:#22262e;color:inherit;border:1px solid #3a404b;border-radius:6px;padding:6px 8px}
        .control-plane button{cursor:pointer}
        .control-plane .board{display:grid;grid-template-columns:repeat(7,minmax(160px,1fr));gap:8px;align-items:start}
        .control-plane .column{background:#1b1e25;border-radius:8px;padding:8px;min-height:120px}
        .control-plane .card{display:block;width:100%;text-align:left;margin-top:6px}
        .control-plane .card[aria-current=true]{border-color:#8eb6ff}
        .control-plane .detail{display:grid;gap:10px;padding:0 20px 24px}
        .control-plane pre{white-space:pre-wrap;background:#101217;padding:10px;border-radius:8px}
        .control-plane .warn{color:#ffb4a8}
      `}</style>
      <header>
        <h1>Control plane</h1>
        <input aria-label="Service origin" value={origin()} onInput={(event) => setOrigin(event.currentTarget.value)} />
        <input aria-label="User token" type="password" placeholder="User token" value={token()} onInput={(event) => setToken(event.currentTarget.value)} />
        <button onClick={() => { localStorage.setItem(storageKey, JSON.stringify({ origin: origin(), token: token() })); setConnected(true); void refresh() }}>Connect</button>
        <Show when={snapshot()?.scheduler}>
          <span>Capacity {snapshot()!.scheduler!.concurrency}</span>
          <button onClick={() => void act("settings.update", { concurrency: Math.min(32, snapshot()!.scheduler!.concurrency + 1) })}>Increase</button>
        </Show>
      </header>
      <Show when={error()}><p class="warn" style="padding:0 20px">{error()}</p></Show>
      <section>
        <form onSubmit={(event) => { event.preventDefault(); void act("task.create", { title, project, objective, criteria: lines(criteria), reviewRequired: true }).then(() => { title = ""; objective = ""; criteria = "" }) }}>
          <input aria-label="Title" placeholder="Title" onInput={(event) => { title = event.currentTarget.value }} />
          <input aria-label="Project" placeholder="Project" value={project} onInput={(event) => { project = event.currentTarget.value }} />
          <input aria-label="Objective" placeholder="Objective" onInput={(event) => { objective = event.currentTarget.value }} />
          <input aria-label="Criteria" placeholder="Criteria, one per line" onInput={(event) => { criteria = event.currentTarget.value }} />
          <button>Create task</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); void act("server.register", { key: serverKey, url: serverUrl }) }}>
          <input aria-label="Server key" value={serverKey} onInput={(event) => { serverKey = event.currentTarget.value }} />
          <input aria-label="OpenCode URL" value={serverUrl} onInput={(event) => { serverUrl = event.currentTarget.value }} />
          <button>Register server</button>
        </form>
      </section>
      <section class="board">
        <For each={stages}>{(stage) =>
          <div class="column">
            <strong>{stage}</strong>
            <For each={snapshot()?.tasks.filter((item) => item.stage === stage) ?? []}>{(item) =>
              <button class="card" aria-current={selected() === item.id} onClick={() => { setSelected(item.id); setDiff(""); void refresh() }}>
                {item.title}
                <small style="display:block;color:#a8b0bd">{item.project} · {item.attention}</small>
              </button>
            }</For>
          </div>
        }</For>
      </section>
      <Show when={task()} keyed>{(current) =>
        <section class="detail">
          <article>
            <h2 style="margin:0">{current.title}</h2>
            <select aria-label="Stage" value={current.stage} onChange={(event) => void act("task.patch", { id: current.id, revision: current.revision, patch: { stage: event.currentTarget.value } })}>
              <For each={stages}>{(stage) => <option value={stage}>{stage}</option>}</For>
            </select>
            <span>{current.attention}{current.blocker ? ` · ${current.blocker}` : ""}</span>
            <span>Spend {cost().toFixed(4)}{current.budget === null ? "" : ` / ${current.budget}`}</span>
          </article>
          <p>{current.objective}</p>
          <p>Done when: {current.criteria.join("; ") || "no criteria yet"}</p>
          <p>Constraints: {current.constraints.join("; ") || "none"}</p>
          <h3>Runs</h3>
          <For each={snapshot()!.runs.filter((run) => run.taskID === current.id)}>{(run) => <p>{run.agent} · {run.state} · {run.step} · {run.cost}</p>}</For>
          <h3>Reviews</h3>
          <For each={snapshot()!.reviews.filter((review) => review.taskID === current.id)}>{(review) =>
            <article>
              <span>{review.status}: {review.brief.ask}</span>
              <Show when={review.status === "pending" || review.status === "accepted"}>
                <input aria-label="Review feedback" placeholder="Feedback" onInput={(event) => { feedback = event.currentTarget.value }} />
                <button onClick={() => void act("review.decide", { id: review.id, revision: review.revision, decision: "accepted", feedback })}>Accept locally</button>
                <button onClick={() => void act("review.decide", { id: review.id, revision: review.revision, decision: "authorized", feedback })}>Authorize publication</button>
                <button onClick={() => void act("review.decide", { id: review.id, revision: review.revision, decision: "changes", feedback })}>Request changes</button>
              </Show>
            </article>
          }</For>
          <h3>Questions</h3>
          <For each={snapshot()!.requests.filter((item) => item.taskID === current.id && item.status === "pending")}>{(item) =>
            <article>
              <span>{item.brief.ask}</span>
              <input aria-label="Answer" onInput={(event) => { answer = event.currentTarget.value }} />
              <button onClick={() => void act("request.answer", { id: item.id, answer })}>Answer</button>
            </article>
          }</For>
          <h3>Artifacts</h3>
          <For each={snapshot()!.artifacts.filter((item) => item.taskID === current.id)}>{(item) =>
            <p>{item.title} · {item.provider} · {item.version}{item.versionVerified ? " verified" : " unverified"} · {snapshot()!.syncs.find((sync) => sync.id === item.id)?.error}</p>
          }</For>
          <h3>External actions</h3>
          <For each={snapshot()!.deliveries.filter((item) => item.taskID === current.id)}>{(item) =>
            <article>
              <span>{item.kind} · {item.status} · {item.destination} {item.result}</span>
              <Show when={item.status === "ready"}><button onClick={() => void act("delivery.publish", { id: item.id })}>Publish</button></Show>
            </article>
          }</For>
          <h3>Local revisions</h3>
          <p>Working {heads().working ?? "none"} · Accepted {heads().accepted ?? "none"} · Published {heads().published ?? "none"}</p>
          <Show when={heads().working && heads().working !== heads().accepted}>
            <button onClick={() => void act("history.accept", { taskID: current.id, commit: heads().working })}>Accept working revision</button>
          </Show>
          <Show when={heads().working && heads().accepted}>
            <button onClick={() => void request("/api/action", { method: "POST", body: JSON.stringify({ op: "history.compare", input: { taskID: current.id, target: heads().working, baseline: "accepted" } }) }).then((body) => setDiff((body as { diff: string }).diff)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}>Compare with accepted</button>
          </Show>
          <Show when={heads().accepted && heads().manifest?.outputs.length}>
            <input aria-label="Published version" placeholder="Verified external version" onInput={(event) => { publicationVersion = event.currentTarget.value }} />
            <input aria-label="Publication evidence" placeholder="Evidence for every destination" onInput={(event) => { publicationEvidence = event.currentTarget.value }} />
            <button onClick={() => void act("history.recordPublication", { taskID: current.id, commit: heads().accepted, receipts: heads().manifest!.outputs.map((output) => ({ destination: output.destination, version: publicationVersion, evidence: publicationEvidence })) })}>Record publication</button>
          </Show>
          <Show when={diff()}><pre>{diff()}</pre></Show>
          <h3>Queue</h3>
          <For each={snapshot()!.scheduler?.queue.filter((item) => item.taskID === current.id) ?? []}>{(item) =>
            <article>
              <span>{item.server} · {item.status} {item.error}</span>
              <Show when={item.status === "failed"}><button onClick={() => void act("queue.retry", { id: item.id })}>Retry same session</button></Show>
            </article>
          }</For>
        </section>
      }</Show>
    </main>
  )
}
