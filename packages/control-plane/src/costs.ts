import type { Run, Task } from "./schema"

export type CostSummary = {
  total: number
  acceptedAverage: number | null
  byModel: { model: string; cost: number; sessions: number; input: number; output: number }[]
}

/** Each run is counted once. The accepted average includes only tasks that have reached completed. */
export function summarizeCosts(tasks: readonly Task[], runs: readonly Run[]): CostSummary {
  const byModel = new Map<string, CostSummary["byModel"][number]>()
  for (const run of runs) {
    const model = run.model || "unattributed"
    const current = byModel.get(model) ?? { model, cost: 0, sessions: 0, input: 0, output: 0 }
    current.cost += run.cost
    current.sessions += 1
    current.input += run.tokens.input
    current.output += run.tokens.output
    byModel.set(model, current)
  }
  const models = [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model))
  const total = models.reduce((sum, item) => sum + item.cost, 0)
  const completed = new Set(tasks.filter((task) => task.stage === "completed").map((task) => task.id))
  const finished = runs.filter((run) => completed.has(run.taskID))
  const finishedSpend = finished.reduce((sum, run) => sum + run.cost, 0)
  return {
    total,
    acceptedAverage: completed.size ? finishedSpend / completed.size : null,
    byModel: models,
  }
}
