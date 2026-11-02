import { unzipSync, strFromU8 } from "fflate"
import { XMLParser } from "fast-xml-parser"
import { posix } from "node:path"
import { type Artifact, type Comment } from "./schema"

const xml = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, transformTagName: (name: string) => name.split(":").at(-1)! })
type Node = Record<string, unknown>
const node = (value: unknown): Node => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Node : {}
const list = (value: unknown): Node[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(node)
const attr = (value: Node, name: string) => String(value[`@_${name}`] ?? Object.entries(value).find(([key]) => key.startsWith("@_") && key.split(":").at(-1) === name)?.[1] ?? "")
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(text).join(" ")
  return Object.entries(node(value)).filter(([key]) => !key.startsWith("@_")).map(([, item]) => text(item)).join(" ").trim()
}
function descendants(value: unknown, key: string): Node[] {
  if (Array.isArray(value)) return value.flatMap(item => descendants(item, key))
  return Object.entries(node(value)).flatMap(([name, item]) => name === key ? list(item) : name.startsWith("@_") ? [] : descendants(item, key))
}

/** Native comments retain provider IDs and targets rather than relying on mutable slide numbers. */
export function officeComments(bytes: Uint8Array, artifact: Artifact): Comment[] {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("Office file exceeds 64 MiB limit")
  const files = unzipSync(bytes, { filter: file => {
    if (!file.name.endsWith(".xml") && !file.name.endsWith(".rels")) return false
    if (file.originalSize > 32 * 1024 * 1024) throw new Error("Office XML part exceeds 32 MiB limit")
    return true
  } })
  const read = (path: string): Node => files[path] ? node(xml.parse(strFromU8(files[path]!))) : {}
  const make = (id: string, body: string, anchor: string, author: string, resolved: boolean, threadID = id): Comment => ({
    id: `${artifact.id}:${id}`, artifactID: artifact.id, externalID: id, threadID,
    url: artifact.url, version: artifact.version, body, anchor, author, resolved, updated: Date.now(),
  })
  if (files["word/document.xml"]) {
    const extended = descendants(read("word/commentsExtended.xml"), "commentEx")
    const comments = descendants(read("word/comments.xml"), "comment")
    const document = read("word/document.xml")
    return comments.map(item => {
      const id = attr(item, "id")
      const para = descendants(item, "p").at(-1)
      const paraID = para ? attr(para, "paraId") : ""
      const extra = extended.find(entry => attr(entry, "paraId") === paraID)
      const parent = extra ? attr(extra, "paraIdParent") : ""
      const paragraph = descendants(document, "p").find(entry => descendants(entry, "commentRangeStart").some(start => attr(start, "id") === id))
      const anchor = paragraph ? `Paragraph ${attr(paragraph, "paraId") || ""}: ${text(paragraph).slice(0, 240)}` : `Comment ${id}`
      const done = extra ? attr(extra, "done") : ""
      return make(id, text(item), anchor, attr(item, "author"), done === "1" || done === "true" || done === "on", parent || paraID || id)
    })
  }
  if (!files["ppt/presentation.xml"]) throw new Error("Only unencrypted DOCX/PPTX packages are supported")
  const relationships = (path: string) => descendants(read(path), "Relationship")
  const presentation = relationships("ppt/_rels/presentation.xml.rels")
  const authors = new Map<string, string>()
  Object.keys(files).filter(path => /authors|commentAuthors/i.test(path)).forEach(path => {
    const content = read(path)
    ;[...descendants(content, "cmAuthor"), ...descendants(content, "author")].forEach(item => authors.set(attr(item, "id"), attr(item, "name")))
  })
  const comments: Comment[] = []
  descendants(read("ppt/presentation.xml"), "sldId").forEach((slide, index) => {
    const id = String(slide["@_r:id"] ?? "")
    const relation = presentation.find(item => attr(item, "Id") === id)
    if (!relation) throw new Error("Presentation slide relationship is missing")
    const path = posix.normalize(posix.join("ppt", attr(relation, "Target")))
    const slideID = attr(slide, "id")
    const rels = relationships(posix.join(posix.dirname(path), "_rels", posix.basename(path) + ".rels"))
    rels.filter(item => /comments?$/i.test(attr(item, "Type"))).forEach(relation => {
      const target = posix.normalize(posix.join(posix.dirname(path), attr(relation, "Target")))
      if (!files[target]) throw new Error("Slide comment part is missing")
      const content = read(target)
      const entries = [...descendants(content, "cm"), ...descendants(content, "comment")]
      entries.forEach(item => {
        const nativeID = attr(item, "id") || attr(item, "idx")
        const authorID = attr(item, "authorId")
        const commentID = `${slideID}:${authorID}:${nativeID}`
        const resolved = attr(item, "status") === "resolved"
        const anchor = `Slide ${index + 1} (ID ${slideID})${descendants(item, "spMk")[0] ? `, shape ${attr(descendants(item, "spMk")[0]!, "spId")}` : ""}`
        const body = text(item.text ?? item.txBody ?? item.t ?? "")
        comments.push(make(commentID, body, anchor, authors.get(authorID) ?? authorID, resolved))
        descendants(item, "reply").forEach(reply => {
          const replyAuthor = attr(reply, "authorId")
          comments.push(make(`${commentID}:${attr(reply, "id")}`, text(reply.txBody ?? reply.text ?? reply.t ?? ""), anchor, authors.get(replyAuthor) ?? replyAuthor, resolved, commentID))
        })
      })
    })
  })
  return comments
}
