import { expect, test } from "bun:test"
import { summarizeCosts } from "../src/costs"
import { Run, Task } from "../src/schema"

const tokens = { input: 10, output: 4, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
function task(id: string, stage: Task["stage"]): Task {
  return Task.parse({ id, revision: 1, briefRevision: 1, title: id, project: "Docs", objective: "Ship", criteria: [], constraints: [], owner: "", priority: "normal", stage, attention: "normal", blocker: "", parentID: null, dependencies: [], budget: null, reviewRequired: true, autoPublish: false, created: 1, updated: 1 })
}
function run(id: string, taskID: string, cost: number, model: string): Run {
  return Run.parse({ id, taskID, parentID: null, server: "local", sessionID: id, agent: "Writer", state: "idle", step: "", todos: [], started: 1, updated: 1, lastOutput: null, cost, model, tokens })
}

test("model totals reconcile and accepted averages exclude unfinished work", () => {
  const summary = summarizeCosts(
    [task("done", "completed"), task("open", "implementing")],
    [run("a", "done", 2, "openai/gpt"), run("b", "done", 4, "openai/gpt"), run("c", "open", 9, "anthropic/claude")],
  )
  expect(summary.total).toBe(15)
  expect(summary.byModel.reduce((sum, item) => sum + item.cost, 0)).toBe(summary.total)
  expect(summary.acceptedAverage).toBe(6)
  expect(summary.byModel.find((item) => item.model === "openai/gpt")?.sessions).toBe(2)
})
