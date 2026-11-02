import { mkdir,chmod } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { createApi } from "./api"
import { WorkflowStore } from "./store"

const directory=process.env.CONTROL_PLANE_DATA??join(process.env.XDG_DATA_HOME??join(homedir(),".local","share"),"opencode-control-plane")
await mkdir(directory,{recursive:true,mode:0o700})
const credentialPath=join(directory,"credentials.json")
if(!(await Bun.file(credentialPath).exists()))await Bun.write(credentialPath,JSON.stringify({user:crypto.randomUUID()+crypto.randomUUID(),worker:crypto.randomUUID()+crypto.randomUUID()},null,2),{mode:0o600})
await chmod(credentialPath,0o600)
const credentials=z.object({user:z.string().min(32),worker:z.string().min(32)}).parse(await Bun.file(credentialPath).json())
const store=new WorkflowStore(join(directory,"workflow.sqlite"))
const server=Bun.serve({hostname:"127.0.0.1",port:Number(process.env.CONTROL_PLANE_PORT??4100),maxRequestBodySize:2_000_000,fetch:createApi(store,credentials,undefined,process.env.CONTROL_PLANE_ORIGINS?.split(",")??[])})
console.info(`Control plane: ${server.url.origin}. User/worker credentials: ${credentialPath}`)
const stop=()=>{server.stop();store.close();process.exit(0)}
process.on("SIGINT",stop);process.on("SIGTERM",stop)
