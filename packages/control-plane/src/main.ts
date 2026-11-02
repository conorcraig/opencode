import { mkdir,chmod } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { createApi } from "./api"
import { WorkflowStore } from "./store"
import { observeOpenCode, ServerConfig } from "./opencode"
import { Connectors } from "./connectors"
import { observeArtifacts } from "./artifact-observer"
import { LocalHistory } from "./history"

const directory=process.env.CONTROL_PLANE_DATA??join(process.env.XDG_DATA_HOME??join(homedir(),".local","share"),"opencode-control-plane")
await mkdir(directory,{recursive:true,mode:0o700})
const credentialPath=join(directory,"credentials.json")
if(!(await Bun.file(credentialPath).exists()))await Bun.write(credentialPath,JSON.stringify({user:crypto.randomUUID()+crypto.randomUUID(),worker:crypto.randomUUID()+crypto.randomUUID()},null,2),{mode:0o600})
await chmod(credentialPath,0o600)
const credentials=z.object({user:z.string().min(32),worker:z.string().min(32)}).parse(await Bun.file(credentialPath).json())
const store=new WorkflowStore(join(directory,"workflow.sqlite"))
const history=await new LocalHistory(join(directory,"history.git")).initialize()
const exportsDirectory=join(directory,"exports")
await mkdir(exportsDirectory,{recursive:true,mode:0o700})
const integration=new Connectors(store,{githubToken:process.env.GITHUB_TOKEN,atlassianOrigin:process.env.ATLASSIAN_ORIGIN,atlassianEmail:process.env.ATLASSIAN_EMAIL,atlassianToken:process.env.ATLASSIAN_TOKEN,microsoftToken:process.env.MICROSOFT_GRAPH_TOKEN})
const artifacts=observeArtifacts(store,integration)
void artifacts.tick()
const harness=observeOpenCode(store,process.env.CONTROL_PLANE_SERVERS_FILE?z.array(ServerConfig).parse(await Bun.file(process.env.CONTROL_PLANE_SERVERS_FILE).json()):[])
void harness.tick().catch(()=>undefined)
const server=Bun.serve({hostname:"127.0.0.1",port:Number(process.env.CONTROL_PLANE_PORT??4100),maxRequestBodySize:2_000_000,fetch:createApi(store,credentials,integration,process.env.CONTROL_PLANE_ORIGINS?.split(",")??[],history,exportsDirectory)})
console.info(`Control plane: ${server.url.origin}. User/worker credentials: ${credentialPath}`)
const stop=()=>{harness.close()
  artifacts.close();server.stop();store.close();process.exit(0)}
process.on("SIGINT",stop);process.on("SIGTERM",stop)
