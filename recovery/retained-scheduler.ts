// Historical source excerpt retained from visible tool output, reformatted.
// Not part of the executable service; imports reference its former neighboring files.
import { OpenCode } from "@opencode/client/promise"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { QueueItem, Run, Task } from "./schema"
import { WorkflowStore } from "./store"
export async function dispatchQueued(store: WorkflowStore) {
  const priority = { low: 0, normal: 1, high: 2, urgent: 3 }
  const queue = store.all("queue", QueueItem).filter((item) => item.status === "queued")
    .toSorted((a,b) => priority[store.get("tasks", b.taskID, Task).priority] - priority[store.get("tasks", a.taskID, Task).priority] || a.created-b.created)
  for (const candidate of queue) {
    const item = store.reserve(candidate.id)
    if (!item) continue
    const server = store.servers().find((entry) => entry.key === item.server)
    if (!server) {store.settleQueue(item.id,"failed","Background server is unavailable");continue}
    const api = OpenCode.make({baseUrl:server.url,headers:server.password?{Authorization:`Basic ${btoa(`opencode:${server.password}`)}`}:undefined})
    const task=store.get("tasks",item.taskID,Task)
    const id=SessionID.make(item.sessionID)
    await api.session.get({sessionID:id})
      .catch(()=>api.session.create({id,title:task.title,location:{directory:item.directory}}))
      .then(async(session)=>{
        const existing=store.all("runs",Run).find((run)=>run.server===server.key&&run.sessionID===session.id)
        if(!existing)store.run({id:`queue:${item.id}`,taskID:task.id,parentID:null,server:server.key,sessionID:session.id,agent:session.title??task.title,state:item.execute?"running":"idle",step:"",todos:[],started:session.time.created,updated:Date.now(),lastOutput:null,cost:session.cost,model:session.model?`${session.model.providerID}/${session.model.id}`:"",tokens:{input:session.tokens.input,output:session.tokens.output,reasoning:session.tokens.reasoning,cacheRead:session.tokens.cache.read,cacheWrite:session.tokens.cache.write}},"scheduler")
        await api.session.prompt({sessionID:session.id,id:SessionMessage.ID.make(`msg_control_start_${item.id}`),resume:item.execute,text:JSON.stringify({task,instruction:"Read and maintain this task through the workflow MCP tools. Follow its acceptance criteria and constraints. Register exact artifact versions and prepared publication actions before requesting review. Escalate consequential decisions. Wait for persisted review decisions; publish only through the workflow gate."})})
        if(task.stage==="queued"&&item.execute)store.patch(task.id,task.revision,{stage:"implementing"},"scheduler")
        store.settleQueue(item.id,"admitted")
      }).catch((cause:unknown)=>store.settleQueue(item.id,"failed",cause instanceof Error?cause.message:String(cause)))
  }
}
