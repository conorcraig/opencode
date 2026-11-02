#!/usr/bin/env python3
"""Structural PPTX comparison by slide identity. No visual rendering is performed."""
import argparse, hashlib, json, posixpath, sys, zipfile
import xml.etree.ElementTree as ET
P='http://schemas.openxmlformats.org/presentationml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS={'p':P,'a':A,'r':R}
def digest(data): return hashlib.sha256(data).hexdigest()
def canonical(el): return [el.tag,sorted(el.attrib.items()),el.text or '',[canonical(child) for child in el]]
def xmlhash(data): return digest(json.dumps(canonical(ET.fromstring(data)),separators=(',',':')).encode())
class Deck:
 def __init__(self,path):
  with zipfile.ZipFile(path) as archive:
   infos=archive.infolist()
   if sum(i.file_size for i in infos)>64*1024*1024: raise ValueError('Expanded PPTX exceeds 64 MiB')
   if len({i.filename for i in infos})!=len(infos): raise ValueError('Duplicate package entries')
   self.parts={i.filename:archive.read(i) for i in infos if not i.is_dir()}
  if 'ppt/presentation.xml' not in self.parts: raise ValueError('Expected unencrypted PPTX')
  self.slides={}; rels=self.relationships('ppt/presentation.xml')
  for position,item in enumerate(ET.fromstring(self.parts['ppt/presentation.xml']).findall('p:sldIdLst/p:sldId',NS),1):
   sid=item.get('id'); rel=rels.get(item.get('{'+R+'}id'))
   if not sid or sid in self.slides or not rel or rel['external']: raise ValueError('Invalid slide identity')
   self.slides[sid]=self.slide(rel['target'],position)
 def relationships(self,part):
  name=posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')
  if name not in self.parts:return {}
  result={}
  for rel in ET.fromstring(self.parts[name]):
   target=rel.get('Target',''); external=rel.get('TargetMode')=='External'
   normalized=target if external else posixpath.normpath(posixpath.join(posixpath.dirname(part),target)).lstrip('/')
   if not external and (normalized.startswith('../') or normalized not in self.parts): raise ValueError('Missing relationship target: '+normalized)
   result[rel.get('Id')]={'type':rel.get('Type','').rsplit('/',1)[-1],'target':normalized,'external':external}
  return result
 def linked(self,part,templates=False):
  result={};seen=set();pending=[part]
  while pending:
   current=pending.pop()
   if current in seen:continue
   seen.add(current)
   for rel in self.relationships(current).values():
    template=rel['type'] in ('slideLayout','slideMaster','theme')
    if templates!=template or rel['type'] in ('slide','notesSlide','comments','commentAuthors'):continue
    target=rel['target']
    if rel['external']:result[rel['type']+':'+target]='external';continue
    result[target]=xmlhash(self.parts[target]) if target.endswith('.xml') else digest(self.parts[target]);pending.append(target)
  return result
 def slide(self,part,position):
  slide=ET.fromstring(self.parts[part]);shapes={}
  for el in slide.findall('.//p:spTree//*',NS):
   if el.tag.rsplit('}',1)[-1] not in ('sp','pic','graphicFrame','cxnSp','grpSp'):continue
   identity=el.find('.//p:cNvPr',NS)
   if identity is None or not identity.get('id'):continue
   sid=identity.get('id')
   if sid in shapes:raise ValueError('Duplicate shape identity')
   shapes[sid]={'name':identity.get('name',''),'kind':el.tag.rsplit('}',1)[-1],'text':'\n'.join(''.join(t.itertext()) for t in el.findall('.//a:t',NS)),
    'transform':[canonical(t) for t in el.findall('.//a:xfrm',NS)+el.findall('./p:xfrm',NS)],'structure':digest(json.dumps(canonical(el),separators=(',',':')).encode())}
  notes={rel['target']:xmlhash(self.parts[rel['target']]) for rel in self.relationships(part).values() if rel['type']=='notesSlide' and not rel['external']}
  return {'position':position,'shapes':shapes,'slideXML':xmlhash(self.parts[part]),'assets':self.linked(part),'template':self.linked(part,True),'notes':notes}
def compare(before,after):
 output=[]
 for sid in dict.fromkeys([*before.slides,*after.slides]):
  a=before.slides.get(sid);b=after.slides.get(sid);changes={}
  if a and b:
   shapes=[]
   for identity in dict.fromkeys([*a['shapes'],*b['shapes']]):
    old=a['shapes'].get(identity);new=b['shapes'].get(identity)
    if old==new:continue
    fields=[key for key in ('text','transform','structure','name','kind') if old and new and old[key]!=new[key]]
    shapes.append({'id':identity,'change':'added' if old is None else 'removed' if new is None else 'changed','fields':fields,'before':old,'after':new})
   if shapes:changes['shapes']=shapes
   for field in ('assets','template','notes'):
    if a[field]!=b[field]:changes[field]={'before':a[field],'after':b[field]}
   if a['slideXML']!=b['slideXML'] and not shapes:changes['slideProperties']=True
   if a['position']!=b['position']:changes['order']={'before':a['position'],'after':b['position']}
  output.append({'id':sid,'change':'added' if a is None else 'removed' if b is None else 'changed' if changes else 'unchanged','beforePosition':a['position'] if a else None,'afterPosition':b['position'] if b else None,'changes':changes})
 return {'version':1,'identity':'presentation-scoped slide ID; compare same-lineage revisions','renderAvailable':False,'slides':output}
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('before');parser.add_argument('after');args=parser.parse_args()
 try:print(json.dumps(compare(Deck(args.before),Deck(args.after)),ensure_ascii=False))
 except (ValueError,OSError,ET.ParseError,zipfile.BadZipFile) as exc:print(str(exc),file=sys.stderr);sys.exit(1)
