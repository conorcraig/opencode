/** Deterministic comparison data; rendering and review decisions are separate concerns. */
export type TextChange = { type: "equal" | "added" | "removed"; text: string }

export function compareText(before: string, after: string): TextChange[] {
  if (before === after) return [{ type: "equal", text: before }]
  const a = before.split("\n")
  const b = after.split("\n")
  const prefix = a.findIndex((line, index) => line !== b[index])
  const start = prefix < 0 ? Math.min(a.length, b.length) : prefix
  const end = { a: a.length, b: b.length }
  while (end.a > start && end.b > start && a[end.a - 1] === b[end.b - 1]) {
    end.a--
    end.b--
  }
  return [
    ...(start ? [{ type: "equal" as const, text: a.slice(0, start).join("\n") }] : []),
    ...(end.a > start ? [{ type: "removed" as const, text: a.slice(start, end.a).join("\n") }] : []),
    ...(end.b > start ? [{ type: "added" as const, text: b.slice(start, end.b).join("\n") }] : []),
    ...(end.a < a.length ? [{ type: "equal" as const, text: a.slice(end.a).join("\n") }] : []),
  ]
}

export type ValueChange = { path: string; type: "added" | "removed" | "changed"; before?: unknown; after?: unknown }
export function compareValue(before: unknown, after: unknown, path = ""): ValueChange[] {
  if (Object.is(before, after)) return []
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, index) =>
      index >= before.length
        ? [{ path: `${path}/${index}`, type: "added" as const, after: after[index] }]
        : index >= after.length
          ? [{ path: `${path}/${index}`, type: "removed" as const, before: before[index] }]
          : compareValue(before[index], after[index], `${path}/${index}`),
    ).flat()
  }
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>
    const b = after as Record<string, unknown>
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((key) => {
      const pointer = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`
      if (!Object.hasOwn(a, key)) return [{ path: pointer, type: "added" as const, after: b[key] }]
      if (!Object.hasOwn(b, key)) return [{ path: pointer, type: "removed" as const, before: a[key] }]
      return compareValue(a[key], b[key], pointer)
    })
  }
  return [{ path: path || "/", type: "changed", before, after }]
}

export type SlideComparison = { version: number; renderAvailable: false; slides: { id: string; change: string; beforePosition: number | null; afterPosition: number | null; changes: Record<string, unknown> }[] }

export async function comparePptx(before: string, after: string): Promise<SlideComparison> {
  const script = new URL("../script/compare-pptx.py", import.meta.url)
  let scriptPath = decodeURIComponent(script.pathname)
  if (process.platform === "win32" && /^\/[A-Za-z]:/.test(scriptPath)) scriptPath = scriptPath.slice(1)
  const program = process.env.PYTHON ?? (process.platform === "win32" ? "py" : "python3")
  const args = program === "py" ? ["-3", scriptPath, before, after] : [scriptPath, before, after]
  const child = Bun.spawn([program, ...args], { stdout: "pipe", stderr: "pipe" })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code) throw new Error(error.trim() || "PowerPoint comparison failed")
  return JSON.parse(output) as SlideComparison
}
