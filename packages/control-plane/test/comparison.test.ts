import { expect,test } from "bun:test"
import { compareText,compareValue } from "../src/comparison"
test("text diff preserves common context and exposes changed block",()=>{
 expect(compareText("Heading\nOld\nFooter","Heading\nNew\nFooter")).toEqual([{type:"equal",text:"Heading"},{type:"removed",text:"Old"},{type:"added",text:"New"},{type:"equal",text:"Footer"}])
 expect(compareText("a","a\nb")).toEqual([{type:"equal",text:"a"},{type:"added",text:"b"}])
})
test("JSON diff ignores key order and emits escaped field pointers",()=>{
 expect(compareValue({b:2,a:1},{a:1,b:2})).toEqual([])
 expect(compareValue({"a/b":{value:1},old:true},{"a/b":{value:2},added:3})).toEqual([{path:"/a~1b/value",type:"changed",before:1,after:2},{path:"/added",type:"added",after:3},{path:"/old",type:"removed",before:true}])
})
