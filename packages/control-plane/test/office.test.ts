import { expect, test } from "bun:test"
import { zipSync, strToU8 } from "fflate"
import { officeComments } from "../src/office"
import { type Artifact } from "../src/schema"
const artifact: Artifact = { id: "slides", taskID: "task", title: "Review", kind: "slides", provider: "microsoft", url: "https://tenant.sharepoint.com/slides", externalID: "drive/item", version: "etag-1", versionVerified: true, updated: 0 }
const pack = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])))

test("PowerPoint comments follow presentation slide order and native thread resolution", () => {
  const comments = officeComments(pack({
    "ppt/presentation.xml": `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="300" r:id="r2"/><p:sldId id="200" r:id="r1"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>`,
    "ppt/slides/_rels/slide2.xml.rels": `<Relationships><Relationship Id="comments" Target="../comments/comment2.xml" Type="http://schemas.microsoft.com/office/2018/10/relationships/comments"/></Relationships>`,
    "ppt/authors.xml": `<p188:authorLst xmlns:p188="p"><p188:author id="alice" name="Alice"/></p188:authorLst>`,
    "ppt/comments/comment2.xml": `<p188:cmLst xmlns:p188="p" xmlns:a="a"><p188:cm id="c1" authorId="alice" status="resolved"><p188:txBody><a:p><a:r><a:t>Change this chart</a:t></a:r></a:p></p188:txBody><p188:replyLst><p188:reply id="r1" authorId="alice"><p188:txBody><a:p><a:r><a:t>Fixed labels</a:t></a:r></a:p></p188:txBody></p188:reply></p188:replyLst></p188:cm></p188:cmLst>`,
  }), artifact)
  expect(comments).toHaveLength(2)
  expect(comments[0]?.anchor).toContain("Slide 1 (ID 300)")
  expect(comments[0]?.author).toBe("Alice")
  expect(comments[0]?.body).toBe("Change this chart")
  expect(comments[0]?.resolved).toBe(true)
  expect(comments[1]?.body).toBe("Fixed labels")
  expect(comments[1]?.resolved).toBe(true)
  expect(comments[1]?.threadID).toBe(comments[0]?.threadID)
})

test("Word comment anchors and extended done status survive import", () => {
  const comments = officeComments(pack({
    "word/document.xml": `<w:document xmlns:w="w" xmlns:w14="w14"><w:body><w:p w14:paraId="BODY1"><w:commentRangeStart w:id="7"/><w:r><w:t>Target sentence</w:t></w:r></w:p></w:body></w:document>`,
    "word/comments.xml": `<w:comments xmlns:w="w" xmlns:w14="w14"><w:comment w:id="7" w:author="Reviewer"><w:p w14:paraId="COMMENT1"><w:r><w:t>Clarify wording</w:t></w:r></w:p></w:comment></w:comments>`,
    "word/commentsExtended.xml": `<w15:commentsEx xmlns:w15="w15"><w15:commentEx w15:paraId="COMMENT1" w15:done="1"/></w15:commentsEx>`,
  }), { ...artifact, kind: "document" })
  expect(comments).toHaveLength(1)
  expect(comments[0]?.anchor).toBe("Paragraph BODY1: Target sentence")
  expect(comments[0]?.author).toBe("Reviewer")
  expect(comments[0]?.resolved).toBe(true)
})

test("unsupported packages and missing native comment parts fail instead of erasing comments", () => {
  expect(() => officeComments(pack({ "plain.xml": "<document/>" }), artifact)).toThrow("Only unencrypted")
  expect(() => officeComments(pack({
    "ppt/presentation.xml": `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="3" r:id="r1"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>`,
    "ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="comments" Target="../comments/missing.xml" Type="http://schemas.microsoft.com/office/2018/10/relationships/comments"/></Relationships>`,
  }), artifact)).toThrow("comment part is missing")
})
