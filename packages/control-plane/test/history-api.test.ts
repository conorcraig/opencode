import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApi } from "../src/api"
import { LocalHistory } from "../src/history"
import { TaskCreate } from "../src/schema"
import { WorkflowStore } from "../src/store"

const paths: string[] = []
const stores: WorkflowStore[] = []
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test("workers can snapshot a local revision but cannot accept or record publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "history-api-"))
  paths.push(root)
  const store = new WorkflowStore(":memory:")
  stores.push(store)
  const history = await new LocalHistory(join(root, "history.git")).initialize()
  const task = store.create(TaskCreate.parse({ title: "Guide", project: "Docs", objective: "Exact local revision" }), "user")
  const source = join(root, "guide.md")
  await writeFile(source, "Accepted guide\n")
  const api = createApi(store, { user: "user-test", worker: "worker-test" }, undefined, [], history, join(root, "exports"))
  const act = (op: string, input: object, token = "worker-test") => api(new Request("http://127.0.0.1/api/action", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ op, input }) }))
  const saved = await act("history.snapshot", { taskID: task.id, message: "Write guide", outputs: [{ path: "guide.md", source, destination: "https://example.com/guide" }] })
  expect(saved.status).toBe(200)
  const body = await saved.json() as { commit: string }
  expect((await act("history.accept", { taskID: task.id, commit: body.commit })).status).toBe(409)
  expect((await act("history.accept", { taskID: task.id, commit: body.commit }, "user-test")).status).toBe(200)
  const heads = await (await act("history.heads", { taskID: task.id }, "user-test")).json() as { accepted: string }
  expect(heads.accepted).toBe(body.commit)
  expect((await act("history.recordPublication", { taskID: task.id, commit: body.commit, receipts: [] }, "user-test")).status).toBe(502)
  expect((await act("history.recordPublication", { taskID: task.id, commit: body.commit, receipts: [{ destination: "https://example.com/guide", version: "etag-2", evidence: "Provider GET verified" }] }, "user-test")).status).toBe(200)
})
