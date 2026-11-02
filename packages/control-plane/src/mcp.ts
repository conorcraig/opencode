import { createInterface } from "node:readline"
import { z } from "zod"
import { Artifact, Brief, Delivery, Request, Run, TaskCreate, TaskPatch } from "./schema"

const definitions = [
  { name: "workflow_snapshot", description: "Read the task brief, criteria, constraints, exact output revisions, local acceptances, publication authorizations, native anchored comments and pending questions. Read before starting or resuming work.", schema: z.object({}) },
  { name: "workflow_task_create", description: "Create persistent work. Workers must retain review-required policy; only the owner can change that policy.", schema: TaskCreate },
  { name: "workflow_task_patch", description: "Update stage, assignment or dependencies using the current task revision. Changes to objectives, criteria, constraints or budget require the owner.", schema: z.object({ id: z.string(), revision: z.number().int(), patch: TaskPatch }) },
  { name: "workflow_task_enqueue", description: "Queue a task on an owner-registered OpenCode server. The queue waits for dependencies, configured capacity and budget. Failed starts require owner retry with the original session identity.", schema: z.object({ taskID: z.string(), server: z.string(), directory: z.string().min(1), execute: z.boolean().default(true) }) },
  { name: "workflow_run_upsert", description: "Report own-session cumulative usage, current step and checklist. Never include child-session costs in parent totals.", schema: Run },
  { name: "workflow_artifact_upsert", description: "Register an output URL and exact revision. The service independently verifies native versions; workers cannot certify their own versions.", schema: Artifact },
  { name: "workflow_artifact_sync", description: "Read the current native revision and anchored comment threads from a configured provider.", schema: z.object({ id: z.string() }) },
  { name: "workflow_review_request", description: "Request a meaningful checkpoint with a concise decision brief. Local acceptance does not authorize an external upload or publication. Register exact outputs and prepared external actions before review.", schema: z.object({ taskID: z.string(), brief: Brief }) },
  { name: "workflow_request_create", description: "Escalate a question, consequential decision or failure. Include concrete options, evidence, uncertainty and recommendation. Do not silently alter agreed scope.", schema: Request },
  { name: "workflow_delivery_prepare", description: "Prepare the exact proposed external action and destination for owner authorization. Preparation invalidates earlier publication approval. Keep scratch work private.", schema: Delivery },
  { name: "workflow_delivery_publish", description: "Execute a prepared externally authorized action through the service gate. Local acceptance is insufficient. Never blindly retry an ambiguous external result; require owner reconciliation.", schema: z.object({ id: z.string() }) },
  { name: "workflow_history_heads", description: "Read the task's working, accepted and published local revision commits. Acceptance and publication are separate.", schema: z.object({ taskID: z.string() }) },
  { name: "workflow_history_snapshot", description: "Save an exact local Git revision of the declared output files. This does not accept the revision or authorize publication. Scratch paths are rejected.", schema: z.object({ taskID: z.string(), message: z.string().default(""), outputs: z.array(z.object({ path: z.string(), source: z.string().min(1), destination: z.string() })).min(1) }) },
  { name: "workflow_history_compare", description: "Diff a local revision against the accepted or published baseline.", schema: z.object({ taskID: z.string(), target: z.string(), baseline: z.enum(["accepted", "published"]) }) },
]
const operations: Record<string, string> = {
  workflow_task_create: "task.create", workflow_task_patch: "task.patch", workflow_task_enqueue: "task.enqueue", workflow_run_upsert: "run.upsert", workflow_artifact_upsert: "artifact.upsert", workflow_artifact_sync: "artifact.sync", workflow_review_request: "review.request", workflow_request_create: "request.create",   workflow_delivery_prepare: "delivery.prepare", workflow_delivery_publish: "delivery.publish",
  workflow_history_heads: "history.heads", workflow_history_snapshot: "history.snapshot", workflow_history_compare: "history.compare",
}
const rpc = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.unknown().optional() })

export async function handleMcp(message: unknown, endpoint: string, token: string, transport: typeof fetch = fetch) {
  const input = rpc.parse(message)
  if (input.id === undefined) return
  const result = await Promise.resolve().then(async () => {
    if (input.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "opencode-control-plane", version: "0.2.0" } }
    if (input.method === "ping") return {}
    if (input.method === "tools/list") return { tools: definitions.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.schema, { io: "input" }) })) }
    if (input.method !== "tools/call") throw new Error("Unsupported MCP method")
    const call = z.object({ name: z.string(), arguments: z.unknown() }).parse(input.params)
    const tool = definitions.find(item => item.name === call.name)
    if (!tool) throw new Error("Unknown tool")
    const args = tool.schema.parse(call.arguments)
    const response = await transport(`${endpoint}/api/${call.name === "workflow_snapshot" ? "snapshot" : "action"}`, {
      method: call.name === "workflow_snapshot" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: call.name === "workflow_snapshot" ? undefined : JSON.stringify({ op: operations[call.name], input: args }),
      signal: AbortSignal.timeout(30_000),
    })
    return { content: [{ type: "text", text: JSON.stringify(await response.json()) }], isError: !response.ok }
  }).then(value => ({ jsonrpc: "2.0", id: input.id, result: value }), (cause: unknown) => ({ jsonrpc: "2.0", id: input.id, error: { code: -32603, message: cause instanceof Error ? cause.message : String(cause) } }))
  return result
}

if (import.meta.main) {
  const token = process.env.CONTROL_PLANE_WORKER_TOKEN
  if (!token) throw new Error("Set CONTROL_PLANE_WORKER_TOKEN to the worker credential, never the user credential")
  const endpoint = process.env.CONTROL_PLANE_URL ?? "http://127.0.0.1:4100"
  const lines = createInterface({ input: process.stdin })
  for await (const line of lines) {
    if (!line.trim()) continue
    const result = await Promise.resolve().then(() => handleMcp(JSON.parse(line), endpoint, token)).catch(() => ({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }))
    if (result) process.stdout.write(JSON.stringify(result) + "\n")
  }
}
