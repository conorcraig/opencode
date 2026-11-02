import { z } from "zod"

export const Stage = z.enum(["queued", "researching", "implementing", "validating", "reviewing", "completed", "cancelled"])
export const Attention = z.enum(["normal", "human", "dependency", "resource", "failed", "paused", "disconnected"])
export const Brief = z.object({
  ask: z.string().min(1).max(240), changed: z.string().min(1).max(600), rationale: z.string().min(1).max(600),
  scrutiny: z.string().max(600), checks: z.array(z.object({label:z.string(),result:z.enum(["passed","failed","unverified"]),evidence:z.string()})).default([]),
  uncertainty:z.string().max(400).default(""), next:z.string().min(1).max(400),
})
export const Task = z.object({
  id:z.string(),revision:z.number().int().positive(),briefRevision:z.number().int().positive(),
  title:z.string().min(1),project:z.string().min(1),objective:z.string().min(1),criteria:z.array(z.string()),constraints:z.array(z.string()),
  owner:z.string(),priority:z.enum(["low","normal","high","urgent"]),stage:Stage,attention:Attention,blocker:z.string(),
  parentID:z.string().nullable(),dependencies:z.array(z.string()),budget:z.number().nonnegative().nullable(),reviewRequired:z.boolean(),autoPublish:z.boolean(),
  created:z.number(),updated:z.number(),
})
export const TaskCreate = Task.pick({title:true,project:true,objective:true}).extend({
  criteria:z.array(z.string()).default([]),constraints:z.array(z.string()).default([]),owner:z.string().default(""),priority:Task.shape.priority.default("normal"),
  parentID:z.string().nullable().default(null),dependencies:z.array(z.string()).default([]),budget:z.number().nonnegative().nullable().default(null),
  reviewRequired:z.boolean().default(true),autoPublish:z.boolean().default(false),
})
export const TaskPatch = Task.omit({id:true,revision:true,briefRevision:true,created:true,updated:true}).partial()
export const Tokens = z.object({input:z.number().nonnegative(),output:z.number().nonnegative(),reasoning:z.number().nonnegative(),cacheRead:z.number().nonnegative(),cacheWrite:z.number().nonnegative()})
export const Run = z.object({
  id:z.string(),taskID:z.string(),parentID:z.string().nullable().default(null),server:z.string(),sessionID:z.string(),agent:z.string(),
  state:z.enum(["running","idle","waiting","failed","finished","disconnected"]),step:z.string().default(""),
  todos:z.array(z.object({content:z.string(),status:z.enum(["pending","in_progress","completed","cancelled"])})).default([]),
  started:z.number(),updated:z.number(),lastOutput:z.number().nullable().default(null),cost:z.number().nonnegative(),model:z.string().default(""),tokens:Tokens,
})
export const Artifact = z.object({
  id:z.string(),taskID:z.string(),title:z.string().min(1),kind:z.enum(["pr","document","slides","image","confluence","jira","other"]),
  url:z.url().refine(value=>["http:","https:"].includes(new URL(value).protocol)),version:z.string().min(1),versionVerified:z.boolean().default(false),
  provider:z.enum(["github","confluence","jira","microsoft","link"]),externalID:z.string(),updated:z.number(),
})
export const Comment = z.object({id:z.string(),artifactID:z.string(),externalID:z.string(),threadID:z.string().optional(),url:z.string(),version:z.string(),anchor:z.string(),author:z.string(),body:z.string(),resolved:z.boolean(),updated:z.number()})
export const Review = z.object({
  id:z.string(),taskID:z.string(),revision:z.number().int().positive(),taskRevision:z.number().int().positive(),brief:Brief,
  versions:z.record(z.string(),z.string()),deliveryIDs:z.array(z.string()),status:z.enum(["pending","accepted","authorized","changes","stale","withdrawn"]),
  created:z.number(),decided:z.number().nullable(),feedback:z.string(),
})
export const Request = z.object({id:z.string(),taskID:z.string(),kind:z.enum(["question","decision","failure"]),brief:Brief,options:z.array(z.string()).default([]),status:z.enum(["pending","resolved","withdrawn"]),answer:z.string(),created:z.number(),resolved:z.number().nullable()})
export const Delivery = z.object({
  id:z.string(),taskID:z.string(),key:z.string(),kind:z.enum(["jira-comment","confluence-update","github-push","review-upload","publish"]),artifactID:z.string(),
  destination:z.string().default(""),payload:z.record(z.string(),z.unknown()),status:z.enum(["ready","sending","sent","unknown","failed"]),result:z.string(),updated:z.number(),
})
export const ServerConfig=z.object({key:z.string(),url:z.url(),password:z.string().optional()})
export const Event=z.object({seq:z.number(),taskID:z.string(),kind:z.string(),actor:z.string(),data:z.unknown(),created:z.number()})
export const ArtifactSync=z.object({id:z.string(),checkedAt:z.number(),lastSuccess:z.number().nullable(),error:z.string(),nextAttempt:z.number()})
export const Snapshot=z.object({scheduler:z.object({concurrency:z.number(),servers:z.array(z.object({key:z.string(),url:z.string()})),queue:z.array(z.object({id:z.string(),taskID:z.string(),server:z.string(),directory:z.string(),execute:z.boolean(),status:z.string(),sessionID:z.string(),error:z.string(),created:z.number()}))}).optional(),tasks:z.array(Task),runs:z.array(Run),artifacts:z.array(Artifact),comments:z.array(Comment),reviews:z.array(Review),requests:z.array(Request),deliveries:z.array(Delivery),syncs:z.array(ArtifactSync),events:z.array(Event),cursor:z.number()})
export type Task=z.infer<typeof Task>
export type Brief=z.infer<typeof Brief>
export type Run=z.infer<typeof Run>
export type Artifact=z.infer<typeof Artifact>
export type Comment=z.infer<typeof Comment>
export type Review=z.infer<typeof Review>
export type Request=z.infer<typeof Request>
export type Delivery=z.infer<typeof Delivery>
export type Event=z.infer<typeof Event>
export type Snapshot=z.infer<typeof Snapshot>
export const QueueItem=z.object({id:z.string(),taskID:z.string(),server:z.string(),directory:z.string().min(1),execute:z.boolean().default(true),status:z.enum(["queued","starting","admitted","failed"]),sessionID:z.string(),error:z.string(),created:z.number()})
export type QueueItem=z.infer<typeof QueueItem>
