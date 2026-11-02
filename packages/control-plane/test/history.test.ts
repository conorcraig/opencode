import { test, expect } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalHistory } from "../src/history"

test("accepted export retains the exact declared revision and excludes later working drafts", async () => {
 const temp=await mkdtemp(join(tmpdir(),"history-test-"))
 try {
  const history=await new LocalHistory(join(temp,"history.git")).initialize()
  const source=join(temp,"guide.md")
  const outputs=[{path:"guide.md",source,destination:"https://example.com/team/guide"}]
  await writeFile(source,"Accepted guide\n")
  const first=await history.snapshot("work1",outputs,"Write guide")
  await history.accept("work1",first.commit)
  await writeFile(source,"Unreviewed next draft\n")
  const second=await history.snapshot("work1",outputs,"Revise guide")
  expect(second.commit).not.toBe(first.commit)
  expect(await history.head("work1","accepted")).toBe(first.commit)
  const exported=await history.exportAccepted("work1",join(temp,"export"))
  expect(exported.commit).toBe(first.commit)
  expect(exported.published).toBe(false)
  expect(await readFile(join(temp,"export/guide.md"),"utf8")).toBe("Accepted guide\n")
  expect(exported.outputs.map(output=>output.path)).toEqual(["guide.md"])
  expect(await history.compare("work1",second.commit,"accepted")).toContain("+Unreviewed next draft")
  await expect(history.recordPublication("work1",second.commit,[])).rejects.toThrow("exact accepted")
  await expect(history.snapshot("work1",[{path:"scratch/private.md",source,destination:"x"}],"Scratch")).rejects.toThrow("scratch")
  await expect(history.recordPublication("work1",first.commit,[])).rejects.toThrow("every destination")
  await history.recordPublication("work1",first.commit,[{destination:"https://example.com/team/guide",version:"etag-2",evidence:"Provider GET verified"}])
  expect(await history.head("work1","published")).toBe(first.commit)
  expect(await new LocalHistory(join(temp,"history.git")).head("work1","accepted")).toBe(first.commit)
 }finally{await rm(temp,{recursive:true,force:true})}
})
