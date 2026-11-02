import { join } from "node:path"
import { z } from "zod"
import { Artifact,Brief,Delivery,Request,Run,ServerConfig,Task,TaskCreate,TaskPatch } from "./schema"
import { Conflict,WorkflowStore } from "./store"
import { LocalHistory, type OutputFile, type PublicationReceipt } from "./history"

export type Credentials={user:string,worker:string}
export type Integrations={sync:(id:string)=>Promise<Artifact>,publish:(id:string)=>Promise<Delivery>}
export function createApi(store:WorkflowStore,credentials:Credentials,integration?:Integrations,allowedOrigins:string[]=[],history?:LocalHistory,exportDirectory?:string){
  return async(request:globalThis.Request):Promise<Response>=>{
    const origin=request.headers.get("origin")
    const permitted=!origin||origin==="oc://renderer"||allowedOrigins.includes(origin)||/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
    const headers=new Headers({"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"})
    if(!permitted)return Response.json({error:"Origin is not allowed"},{status:403})
    if(origin)headers.set("Access-Control-Allow-Origin",origin)
    headers.set("Access-Control-Allow-Headers","Authorization,Content-Type");headers.set("Access-Control-Allow-Methods","GET,POST,OPTIONS")
    const respond=(body:unknown,status=200)=>Response.json(body,{status,headers})
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers})
    const token=request.headers.get("authorization")?.replace(/^Bearer /,"")
    const actor=token===credentials.user?"user":token===credentials.worker?"worker":null
    if(!actor)return respond({error:"Provide the user or worker token"},401)
    const url=new URL(request.url)
    if(request.method==="GET"&&url.pathname==="/api/health")return respond({ready:true,schema:1,actor})
    if(request.method==="GET"&&url.pathname==="/api/snapshot")return respond(store.snapshot(Math.max(0,Number(url.searchParams.get("after"))||0)))
    if(request.method!=="POST"||url.pathname!=="/api/action")return respond({error:"Not found"},404)
    if(Number(request.headers.get("content-length"))>2_000_000)return respond({error:"Request too large"},413)
    return request.text().then(async text=>{
      if(text.length>2_000_000)return respond({error:"Request too large"},413)
      const command=z.object({op:z.string(),input:z.unknown()}).parse(JSON.parse(text))
      const user=()=>{if(actor!=="user")throw new Conflict("Only the user may approve or change agreed scope/policy")}
      const ref=z.object({id:z.string()})
      switch(command.op){
        case "task.create":{const input=TaskCreate.parse(command.input);if(input.autoPublish||!input.reviewRequired)user();return respond(store.create(input,actor))}
        case "task.patch":{const input=z.object({id:z.string(),revision:z.number().int(),patch:TaskPatch}).parse(command.input);if(["objective","criteria","constraints","dependencies","budget","reviewRequired","autoPublish"].some(key=>key in input.patch))user();return respond(store.patch(input.id,input.revision,input.patch,actor))}
        case "run.upsert":return respond(store.run(Run.parse(command.input),actor))
        case "artifact.upsert":{const input=Artifact.parse(command.input);const current=store.snapshot().artifacts.find(item=>item.id===input.id);return respond(store.artifact({...input,versionVerified:!!current?.versionVerified&&["version","url","provider","externalID"].every(key=>current[key as keyof Artifact]===input[key as keyof Artifact])},actor))}
        case "artifact.sync":{if(!integration)throw new Conflict("Provider integration is not configured");return respond(await integration.sync(ref.parse(command.input).id))}
        case "review.request":{const input=z.object({taskID:z.string(),brief:Brief}).parse(command.input);return respond(store.requestReview(input.taskID,input.brief,actor))}
        case "review.decide":{
          user();const input=z.object({id:z.string(),revision:z.number().int(),decision:z.enum(["accepted","authorized","changes"]),feedback:z.string().default("")}).parse(command.input)
          const current=store.snapshot().reviews.find(item=>item.id===input.id);if(!current||current.revision!==input.revision)throw new Conflict("Review changed; refresh before deciding")
          if(integration)await Promise.all(store.snapshot().artifacts.filter(item=>current.versions[item.id]&&item.provider!=="link").map(item=>integration.sync(item.id)))
          const next=store.snapshot().reviews.find(item=>item.id===input.id)!
          return respond(store.decide(input.id,input.decision==="changes"?next.revision:input.revision,input.decision,input.feedback,actor))
        }
        case "request.create":{const input=Request.parse(command.input);return respond(store.request({...input,status:"pending",answer:"",resolved:null,created:Date.now()},actor))}
        case "request.answer":{user();const input=z.object({id:z.string(),answer:z.string().min(1)}).parse(command.input);return respond(store.answer(input.id,input.answer,actor))}
        case "delivery.prepare":{const input=Delivery.parse(command.input);return respond(store.delivery({...input,status:"ready",result:"",updated:Date.now()},actor))}
        case "delivery.publish":{if(!integration)throw new Conflict("Provider integration is not configured");return respond(await integration.publish(ref.parse(command.input).id))}
        case "delivery.reconcile":{user();const input=z.object({id:z.string(),delivered:z.boolean(),evidence:z.string().min(1)}).parse(command.input);return respond(store.reconcileDelivery(input.id,input.delivered,input.evidence))}
        case "server.register":user();return respond(store.registerServer(ServerConfig.parse(command.input)))
        case "settings.update":{user();const input=z.object({concurrency:z.number().int().min(1).max(32)}).parse(command.input);return respond(store.configure(input.concurrency))}
        case "task.enqueue":return respond(store.enqueue(z.object({taskID:z.string(),server:z.string(),directory:z.string().min(1),execute:z.boolean().default(true)}).parse(command.input)))
        case "queue.retry":user();return respond(store.retryQueue(ref.parse(command.input).id))
        case "history.heads":
        case "history.snapshot":
        case "history.accept":
        case "history.compare":
        case "history.export":
        case "history.compareSlides":
        case "history.recordPublication":{
          if(!history)throw new Conflict("Local history is not configured")
          const taskID=z.object({taskID:z.string()}).parse(command.input).taskID
          store.get("tasks",taskID,Task)
          if(command.op==="history.heads"){
            const lanes=["working","accepted","published"] as const
            const commits=Object.fromEntries(await Promise.all(lanes.map(async lane=>[lane,await history.head(taskID,lane)]))) as Record<typeof lanes[number],string|null>
            return respond({...commits,manifest:commits.accepted?await history.manifest(taskID,commits.accepted):null})
          }
          if(command.op==="history.snapshot"){
            const input=z.object({taskID:z.string(),message:z.string().default(""),outputs:z.array(z.object({path:z.string(),source:z.string().min(1),destination:z.string()})).min(1)}).parse(command.input)
            return respond(await history.snapshot(taskID,input.outputs as OutputFile[],input.message))
          }
          if(command.op==="history.accept"){user();const input=z.object({taskID:z.string(),commit:z.string()}).parse(command.input);return respond({commit:await history.accept(taskID,input.commit)})}
          if(command.op==="history.compare"){const input=z.object({taskID:z.string(),target:z.string(),baseline:z.enum(["accepted","published"])}).parse(command.input);return respond({diff:await history.compare(taskID,input.target,input.baseline)})}
          if(command.op==="history.compareSlides"){const input=z.object({taskID:z.string(),from:z.string(),to:z.string(),path:z.string()}).parse(command.input);return respond(await history.compareSlides(taskID,input.from,input.to,input.path))}
          if(command.op==="history.export"){
            user()
            if(!exportDirectory)throw new Conflict("Local export directory is not configured")
            const input=z.object({taskID:z.string(),name:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)}).parse(command.input)
            return respond(await history.exportAccepted(taskID,join(exportDirectory,input.name)))
          }
          user()
          const input=z.object({taskID:z.string(),commit:z.string(),receipts:z.array(z.object({destination:z.string(),version:z.string(),evidence:z.string()}))}).parse(command.input)
          return respond(await history.recordPublication(taskID,input.commit,input.receipts as PublicationReceipt[]))
        }
        default:return respond({error:"Unknown operation"},400)
      }
    }).catch((cause:unknown)=>respond({error:cause instanceof Error?cause.message:String(cause)},cause instanceof Conflict?409:cause instanceof z.ZodError||cause instanceof SyntaxError?400:502))
  }
}
