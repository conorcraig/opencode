import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { createHash } from "node:crypto"
import { comparePptx, type SlideComparison } from "./comparison"

export type OutputFile = { path: string; source: string; destination: string }
export type RevisionManifest = {
  version: 1
  taskID: string
  outputs: { path: string; destination: string; sha256: string; bytes: number }[]
}
export type PublicationReceipt = { destination: string; version: string; evidence: string }

/** An isolated local Git object database. This class never configures a remote or pushes. */
export class LocalHistory {
  constructor(readonly directory: string) {}

  private async git(args: string[], input?: string | Uint8Array, env?: Record<string, string>) {
    const child = Bun.spawn(["git", "--git-dir", this.directory, ...args], {
      stdin: input === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "OpenCode local workflow",
        GIT_AUTHOR_EMAIL: "local-workflow@localhost",
        GIT_COMMITTER_NAME: "OpenCode local workflow",
        GIT_COMMITTER_EMAIL: "local-workflow@localhost",
        ...env,
      },
    })
    if (input !== undefined && child.stdin) {
      child.stdin.write(input)
      child.stdin.end()
    }
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (code) throw new Error(stderr.trim() || `Git ${args[0]} failed`)
    return stdout.trimEnd()
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.git(["init", "--bare", "--quiet", this.directory])
    return this
  }

  private key(taskID: string) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(taskID)) throw new Error("Invalid task ID")
    return `refs/control/${taskID}`
  }

  async head(taskID: string, lane: "working" | "accepted" | "published") {
    return this.git(["rev-parse", "--verify", `${this.key(taskID)}/${lane}`]).catch(() => null)
  }

  async snapshot(taskID: string, outputs: OutputFile[], message: string) {
    if (!outputs.length) throw new Error("Declare at least one required output")
    const root = this.key(taskID)
    const paths = new Set<string>()
    outputs.forEach((output) => {
      if (
        !output.path ||
        output.path.includes("\\") ||
        posix.isAbsolute(output.path) ||
        output.path.split("/").some((part) => !part || [".", "..", ".git", "node_modules", "scratch"].includes(part)) ||
        paths.has(output.path)
      )
        throw new Error("Output paths must be unique safe relative paths without scratch files")
      if (!output.destination.trim()) throw new Error("Every output needs an explicit destination")
      paths.add(output.path)
    })
    const previous = await this.head(taskID, "working")
    const temporary = await mkdtemp(join(tmpdir(), "control-history-"))
    const env = { GIT_INDEX_FILE: join(temporary, "index") }
    return Promise.resolve()
      .then(async () => {
        await this.git(["read-tree", "--empty"], undefined, env)
        const entries = await Promise.all(
          outputs.map(async (output) => {
            const bytes = await readFile(output.source)
            if (bytes.length > 64 * 1024 * 1024) throw new Error("Output exceeds 64 MiB snapshot limit")
            const blob = await this.git(["hash-object", "-w", "--stdin"], bytes)
            return {
              output,
              blob,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              bytes: bytes.length,
            }
          }),
        )
        const manifest: RevisionManifest = {
          version: 1,
          taskID,
          outputs: entries.map((entry) => ({
            path: entry.output.path,
            destination: entry.output.destination,
            sha256: entry.sha256,
            bytes: entry.bytes,
          })),
        }
        const manifestBlob = await this.git(["hash-object", "-w", "--stdin"], JSON.stringify(manifest))
        const index = entries
          .map((entry) => `100644 ${entry.blob}\toutputs/${entry.output.path}\0`)
          .join("") + `100644 ${manifestBlob}\tcontrol-plane-manifest.json\0`
        await this.git(["update-index", "-z", "--index-info"], index, env)
        const tree = await this.git(["write-tree"], undefined, env)
        const commit = await this.git(
          ["commit-tree", tree, ...(previous ? ["-p", previous] : [])],
          message.trim() || "Save working output revision",
        )
        await this.git(["update-ref", `${root}/working`, commit, previous ?? "0".repeat(40)])
        return { commit, manifest }
      })
      .finally(() => rm(temporary, { recursive: true, force: true }))
  }

  async manifest(taskID: string, commit: string): Promise<RevisionManifest> {
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Use an exact revision SHA")
    const manifest: RevisionManifest = JSON.parse(await this.git(["show", `${commit}:control-plane-manifest.json`]))
    if (manifest.version !== 1 || manifest.taskID !== taskID) throw new Error("Revision belongs to another task")
    return manifest
  }

  async accept(taskID: string, commit: string) {
    await this.manifest(taskID, commit)
    await this.git(["update-ref", `${this.key(taskID)}/accepted`, commit])
    return commit
  }

  async compare(taskID: string, target: string, baseline: "accepted" | "published") {
    await this.manifest(taskID, target)
    const base = await this.head(taskID, baseline)
    if (!base) throw new Error(`No ${baseline} baseline has been recorded`)
    return this.git(["diff", "--no-ext-diff", "--no-textconv", "--binary", base, target, "--", "outputs/"])
  }

  async exportAccepted(taskID: string, destination: string) {
    const commit = await this.head(taskID, "accepted")
    if (!commit) throw new Error("Accept a local revision before exporting")
    const manifest = await this.manifest(taskID, commit)
    await mkdir(destination, { mode: 0o700 })
    if ((await Bun.file(join(destination, "control-plane-manifest.json")).exists()))
      throw new Error("Export destination already contains a revision")
    await Promise.all(
      manifest.outputs.map(async (output) => {
        const path = join(destination, output.path)
        await mkdir(dirname(path), { recursive: true })
        const child = Bun.spawn(["git", "--git-dir", this.directory, "show", `${commit}:outputs/${output.path}`], {
          stdout: "pipe",
          stderr: "pipe",
        })
        const bytes = new Uint8Array(await new Response(child.stdout).arrayBuffer())
        if ((await child.exited) !== 0) throw new Error("Failed to read accepted output")
        if (createHash("sha256").update(bytes).digest("hex") !== output.sha256)
          throw new Error("Accepted output checksum mismatch")
        await writeFile(path, bytes, { flag: "wx", mode: 0o600 })
      }),
    )
    const result = { ...manifest, commit, acceptedLocally: true, published: false }
    await writeFile(join(destination, "control-plane-manifest.json"), JSON.stringify(result, null, 2), { flag: "wx" })
    return result
  }

  async compareSlides(taskID: string, from: string, to: string, path: string): Promise<SlideComparison> {
    if (path.includes("\\") || path.includes("..") || posix.isAbsolute(path) || !path.endsWith(".pptx") || path.split("/").some((part) => !part || part === "."))
      throw new Error("Slide comparison needs a safe relative PPTX path")
    const [before, after] = await Promise.all([this.manifest(taskID, from), this.manifest(taskID, to)])
    if (!before.outputs.some((output) => output.path === path) || !after.outputs.some((output) => output.path === path))
      throw new Error("Both revisions must contain that PPTX output")
    const temporary = await mkdtemp(join(tmpdir(), "control-slides-"))
    try {
      const older = join(temporary, "before.pptx")
      const newer = join(temporary, "after.pptx")
      await this.extract(from, path, older, before)
      await this.extract(to, path, newer, after)
      return await comparePptx(older, newer)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  private async extract(commit: string, path: string, destination: string, manifest: RevisionManifest) {
    const output = manifest.outputs.find((item) => item.path === path)
    if (!output) throw new Error("Revision is missing that output")
    const child = Bun.spawn(["git", "--git-dir", this.directory, "show", `${commit}:outputs/${path}`], { stdout: "pipe", stderr: "pipe" })
    const bytes = new Uint8Array(await new Response(child.stdout).arrayBuffer())
    if ((await child.exited) !== 0) throw new Error("Failed to read revision output")
    if (createHash("sha256").update(bytes).digest("hex") !== output.sha256) throw new Error("Revision output checksum mismatch")
    await writeFile(destination, bytes, { mode: 0o600 })
  }

  async recordPublication(taskID: string, commit: string, receipts: PublicationReceipt[]) {
    const accepted = await this.head(taskID, "accepted")
    if (accepted !== commit) throw new Error("Publication must name the exact accepted revision")
    const manifest = await this.manifest(taskID, commit)
    if (manifest.outputs.some((output) => !receipts.some((receipt) => receipt.destination === output.destination && receipt.version.trim() && receipt.evidence.trim())))
      throw new Error("Provide a verified external version and evidence for every destination")
    await this.git(["notes", "--ref=control-publication", "add", "-m", JSON.stringify(receipts), commit])
    await this.git(["update-ref", `${this.key(taskID)}/published`, commit])
    return { commit, receipts }
  }
}
