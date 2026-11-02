import { z } from "zod"
import { Artifact, Comment, Delivery } from "./schema"
import { Conflict, WorkflowStore } from "./store"
import { officeComments } from "./office"

export type ConnectorConfig = {
  githubToken?: string
  atlassianOrigin?: string
  atlassianEmail?: string
  atlassianToken?: string
  microsoftToken?: string
}
export type Transport = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
const Page = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
const GithubComment = z.object({ id: z.string(), body: z.string(), url: z.string(), author: z.object({ login: z.string() }).nullable(), updatedAt: z.string() })
const GithubComments = z.object({ pageInfo: Page, nodes: z.array(GithubComment) })
const GithubThread = z.object({ id: z.string(), isResolved: z.boolean(), path: z.string(), line: z.number().nullable(), comments: GithubComments })
const ConfluenceComment = z.object({
  id: z.string(), status: z.string().optional(), resolutionStatus: z.string().optional(),
  version: z.object({ authorId: z.string().optional(), createdAt: z.string().optional() }).optional(),
  body: z.object({ storage: z.object({ value: z.string() }).optional() }).optional(),
  properties: z.object({ inlineOriginalSelection: z.string().optional() }).optional(),
})
class ExternalError extends Error {
  constructor(readonly status: number) { super(`External service returned ${status}`) }
}

/** Provider adapters only persist a complete, unchanged-revision read. */
export class Connectors {
  private readonly pending = new Map<string, Promise<Artifact>>()
  constructor(readonly store: WorkflowStore, readonly config: ConnectorConfig, readonly transport: Transport = fetch) {}
  private async response(url: string, init: RequestInit = {}) {
    const origin = new URL(url).origin
    const headers = new Headers(init.headers)
    headers.set("Accept", "application/json")
    if (init.body) headers.set("Content-Type", "application/json")
    if (origin === "https://api.github.com" && this.config.githubToken) headers.set("Authorization", `Bearer ${this.config.githubToken}`)
    if (origin === "https://graph.microsoft.com" && this.config.microsoftToken) headers.set("Authorization", `Bearer ${this.config.microsoftToken}`)
    if (origin === this.config.atlassianOrigin && this.config.atlassianToken)
      headers.set("Authorization", `Basic ${btoa(`${this.config.atlassianEmail}:${this.config.atlassianToken}`)}`)
    const result = await this.transport(url, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(20_000) })
    if (!result.ok) throw new ExternalError(result.status)
    return result
  }
  private async json(url: string, init: RequestInit = {}): Promise<unknown> { return (await this.response(url, init)).json() }
  private async graphql(query: string, variables: Record<string, unknown>) {
    const result = z.object({ data: z.record(z.string(), z.unknown()).optional(), errors: z.array(z.object({ message: z.string() })).optional() })
      .parse(await this.json("https://api.github.com/graphql", { method: "POST", body: JSON.stringify({ query, variables }) }))
    if (result.errors?.length) throw new Conflict(result.errors.map(item => item.message).join("; "))
    if (!result.data) throw new Conflict("Native review data unavailable")
    return result.data
  }
  private atlassian(artifact: Artifact) {
    if (!this.config.atlassianOrigin || new URL(artifact.url).origin !== this.config.atlassianOrigin)
      throw new Conflict("Configure matching Atlassian origin and credentials on the service")
    return this.config.atlassianOrigin
  }
  sync(id: string): Promise<Artifact> {
    const previous = this.pending.get(id)
    if (previous) return previous
    const result = this.read(id).finally(() => this.pending.delete(id))
    this.pending.set(id, result)
    return result
  }
  private async read(id: string): Promise<Artifact> {
    const artifact = this.store.get("artifacts", id, Artifact)
    if (artifact.provider === "github") return this.github(artifact)
    if (artifact.provider === "microsoft") return this.microsoft(artifact)
    if (artifact.provider === "link") throw new Conflict("This link has no verifiable revision adapter; open the native app")
    const origin = this.atlassian(artifact)
    if (artifact.provider === "jira") {
      const issue = z.object({ fields: z.object({ updated: z.string() }) }).parse(await this.json(`${origin}/rest/api/3/issue/${encodeURIComponent(artifact.externalID)}?fields=updated`))
      return this.store.syncArtifact(artifact, issue.fields.updated, [])
    }
    return this.confluence(artifact, origin)
  }
  private async github(artifact: Artifact) {
    if (!this.config.githubToken) throw new Conflict("Configure a GitHub token to read review conversations")
    const url = new URL(artifact.url)
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/)
    if (url.origin !== "https://github.com" || !match) throw new Conflict("Use a GitHub pull-request URL")
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(match[1]!)}/${encodeURIComponent(match[2]!)}/pulls/${match[3]}`
    const head = async () => z.object({ head: z.object({ sha: z.string() }) }).parse(await this.json(endpoint)).head.sha
    const version = await head()
    const comments: Comment[] = []
    const pagination: { cursor: string | null } = { cursor: null }
    const seen = new Set<string>()
    while (true) {
      const data = await this.graphql(`query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){headRefOid reviewThreads(first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id isResolved path line comments(first:100){pageInfo{hasNextPage endCursor} nodes{id body url author{login} updatedAt}}}}}}}`, { owner: match[1], repo: match[2], number: Number(match[3]), cursor: pagination.cursor })
      const result = z.object({ repository: z.object({ pullRequest: z.object({ headRefOid: z.string(), reviewThreads: z.object({ pageInfo: Page, nodes: z.array(GithubThread) }) }) }) }).parse(data)
      const pr = result.repository.pullRequest
      if (pr.headRefOid !== version) throw new Conflict("Pull request changed during comment sync")
      for (const thread of pr.reviewThreads.nodes) {
        const pages = { value: thread.comments }
        const cursors = new Set<string>()
        while (true) {
          pages.value.nodes.forEach(item => comments.push({
            id: `${artifact.id}:${item.id}`, artifactID: artifact.id, externalID: item.id, threadID: thread.id,
            url: item.url, version, anchor: `${thread.path}:${thread.line ?? ""}`, author: item.author?.login ?? "",
            body: item.body, resolved: thread.isResolved, updated: Date.parse(item.updatedAt),
          }))
          if (!pages.value.pageInfo.hasNextPage) break
          const cursor = pages.value.pageInfo.endCursor
          if (!cursor || cursors.has(cursor)) throw new Conflict("Review reply pagination is incomplete")
          cursors.add(cursor)
          const next = await this.graphql(`query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id body url author{login} updatedAt}}}}}`, { id: thread.id, cursor })
          pages.value = z.object({ node: z.object({ comments: GithubComments }) }).parse(next).node.comments
        }
      }
      if (!pr.reviewThreads.pageInfo.hasNextPage) break
      const cursor = pr.reviewThreads.pageInfo.endCursor
      if (!cursor || seen.has(cursor)) throw new Conflict("Review thread pagination is incomplete")
      seen.add(cursor)
      pagination.cursor = cursor
    }
    if (await head() !== version) throw new Conflict("Pull request changed during comment sync")
    return this.store.syncArtifact(artifact, version, comments)
  }
  private async confluence(artifact: Artifact, origin: string) {
    const pageURL = `${origin}/wiki/api/v2/pages/${encodeURIComponent(artifact.externalID)}`
    const revision = async () => String(z.object({ version: z.object({ number: z.number().int() }) }).parse(await this.json(pageURL)).version.number)
    const version = await revision()
    const comments: Comment[] = []
    const visited = new Set<string>()
    const collect = async (path: string, parent?: Comment) => {
      const pagination = { next: path }
      while (pagination.next) {
        const url = new URL(pagination.next, origin)
        if (url.origin !== origin || !url.pathname.startsWith("/wiki/api/v2/")) throw new Conflict("Comment pagination left the configured Confluence API")
        if (visited.has(url.href)) throw new Conflict("Comment pagination repeated a page")
        visited.add(url.href)
        const response = await this.response(url.href)
        const result = z.object({ results: z.array(ConfluenceComment), _links: z.object({ next: z.string().optional() }).optional() }).parse(await response.json())
        for (const item of result.results) {
          const comment: Comment = {
            id: `${artifact.id}:${item.id}`, artifactID: artifact.id, externalID: item.id, threadID: parent?.threadID ?? item.id,
            url: `${artifact.url.split("#")[0]}${new URL(artifact.url).search ? "&" : "?"}focusedCommentId=${encodeURIComponent(item.id)}`,
            version, anchor: parent?.anchor ?? item.properties?.inlineOriginalSelection ?? "", author: item.version?.authorId ?? "",
            body: item.body?.storage?.value ?? "", resolved: parent?.resolved ?? (item.resolutionStatus === "resolved" || item.status === "deleted"), updated: Date.now(),
          }
          if (comments.some(existing => existing.id === comment.id)) throw new Conflict("Duplicate native comment")
          comments.push(comment)
          await collect(`/wiki/api/v2/inline-comments/${encodeURIComponent(item.id)}/children?body-format=storage&limit=100`, comment)
        }
        pagination.next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="?next"?/)?.[1] ?? result._links?.next ?? ""
      }
    }
    await collect(`/wiki/api/v2/pages/${encodeURIComponent(artifact.externalID)}/inline-comments?body-format=storage&limit=100`)
    if (await revision() !== version) throw new Conflict("Confluence page changed during comment sync")
    return this.store.syncArtifact(artifact, version, comments)
  }
  private async microsoft(artifact: Artifact) {
    if (!this.config.microsoftToken) throw new Conflict("Configure a Microsoft Graph token on the service")
    const ids = artifact.externalID.split("/")
    if (ids.length !== 2 || !ids[0] || !ids[1]) throw new Conflict("Microsoft external ID must be driveID/itemID")
    const endpoint = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(ids[0])}/items/${encodeURIComponent(ids[1])}`
    const schema = z.object({ eTag: z.string(), name: z.string(), size: z.number(), webUrl: z.string(), "@microsoft.graph.downloadUrl": z.url().optional() })
    const before = schema.parse(await this.json(endpoint))
    if (new URL(before.webUrl).origin !== new URL(artifact.url).origin) throw new Conflict("Microsoft file belongs to another site")
    if (before.size > 64 * 1024 * 1024) throw new Conflict("Office file exceeds 64 MiB limit")
    const download = before["@microsoft.graph.downloadUrl"]
    if (!download || new URL(download).protocol !== "https:") throw new Conflict("Microsoft did not provide an HTTPS download")
    const response = await this.transport(download, { signal: AbortSignal.timeout(30_000), redirect: "error" })
    if (!response.ok) throw new ExternalError(response.status)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > 64 * 1024 * 1024) throw new Conflict("Office file exceeds 64 MiB limit")
    const comments = officeComments(bytes, { ...artifact, version: before.eTag })
    const after = schema.parse(await this.json(endpoint))
    if (after.eTag !== before.eTag) throw new Conflict("Office file changed during comment sync")
    return this.store.syncArtifact(artifact, before.eTag, comments)
  }
  async publish(id: string): Promise<Delivery> {
    const delivery = this.store.get("deliveries", id, Delivery)
    if (delivery.status === "sent") return delivery
    if (!["jira-comment", "confluence-update"].includes(delivery.kind)) throw new Conflict("This external action has no publishing adapter")
    await this.sync(delivery.artifactID)
    const artifact = this.store.get("artifacts", delivery.artifactID, Artifact)
    if ((delivery.kind === "jira-comment" && artifact.provider !== "jira") || (delivery.kind === "confluence-update" && artifact.provider !== "confluence")) throw new Conflict("Publication provider mismatch")
    const origin = this.atlassian(artifact)
    const payload = delivery.kind === "jira-comment"
      ? z.object({ body: z.object({ type: z.literal("doc"), version: z.literal(1), content: z.array(z.unknown()) }) }).strict().parse(delivery.payload)
      : z.object({ title: z.string().min(1), body: z.object({ representation: z.literal("storage"), value: z.string() }) }).strict().parse(delivery.payload)
    const ready = this.store.claimDelivery(id)
    return this.json(delivery.kind === "jira-comment" ? `${origin}/rest/api/3/issue/${encodeURIComponent(artifact.externalID)}/comment` : `${origin}/wiki/api/v2/pages/${encodeURIComponent(artifact.externalID)}`, {
      method: delivery.kind === "jira-comment" ? "POST" : "PUT",
      body: JSON.stringify(delivery.kind === "jira-comment" ? { ...payload, properties: [{ key: "opencode.control-plane.delivery", value: ready.key }] } : { ...payload, id: artifact.externalID, status: "current", version: { number: Number(artifact.version) + 1, message: `Control-plane ${ready.key}` } }),
    }).then(result => this.store.deliveryResult(id, "sent", JSON.stringify(result)), cause => {
      this.store.deliveryResult(id, cause instanceof ExternalError && cause.status < 500 ? "failed" : "unknown", cause instanceof Error ? cause.message : String(cause))
      throw cause
    })
  }
}
