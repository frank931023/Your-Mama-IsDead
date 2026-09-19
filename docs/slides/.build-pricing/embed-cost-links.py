import sys,json,zipfile,re,copy
from lxml import etree as E
src,dst,mapping=sys.argv[1:]
links=json.load(open(mapping,encoding='utf-8'))
A='http://schemas.openxmlformats.org/drawingml/2006/main'
P='http://schemas.openxmlformats.org/presentationml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
ns={'a':A,'p':P,'r':R}
with zipfile.ZipFile(src) as z: entries={n:z.read(n) for n in z.namelist()}
def add_relationship(rels,url):
    for item in rels:
        if item.get('Target')==url and item.get('Type','').endswith('/hyperlink'): return item.get('Id')
    used={r.get('Id') for r in rels};i=1
    while 'rIdCost'+str(i) in used:i+=1
    rid='rIdCost'+str(i)
    E.SubElement(rels,'{'+REL+'}Relationship',Id=rid,Type=R+'/hyperlink',Target=url,TargetMode='External')
    return rid
def attach(run,rid,underline=False):
    rp=run.find('a:rPr',ns)
    if rp is None: rp=E.Element('{'+A+'}rPr');run.insert(0,rp)
    for old in rp.findall('a:hlinkClick',ns):rp.remove(old)
    if underline:rp.set('u','sng')
    E.SubElement(rp,'{'+A+'}hlinkClick',{'{'+R+'}id':rid})
slide='ppt/slides/slide1.xml';sp='ppt/slides/_rels/slide1.xml.rels'
root=E.fromstring(entries[slide]);rels=E.fromstring(entries[sp])
count=0
for shape in root.findall('.//p:sp',ns):
    prop=shape.find('p:nvSpPr/p:cNvPr',ns)
    if prop is None or prop.get('name') not in links:continue
    name=prop.get('name');rid=add_relationship(rels,links[name])
    for run in shape.findall('.//a:r',ns):attach(run,rid,name.startswith('cost-source'))
    count+=1
assert count==8,count
entries[slide]=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
entries[sp]=E.tostring(rels,xml_declaration=True,encoding='UTF-8',standalone=True)
# Convert citations in speaker notes into native clickable PowerPoint text runs.
np='ppt/notesSlides/notesSlide1.xml';nr='ppt/notesSlides/_rels/notesSlide1.xml.rels'
root=E.fromstring(entries[np]);rels=E.fromstring(entries[nr])
pat=re.compile(r'\[([^\]]+)\]\(([^)]+)\)|(https?://[^\s<>）]+)')
nc=0
for run in list(root.findall('.//a:r',ns)):
    t=run.find('a:t',ns)
    if t is None or not t.text:continue
    matches=list(pat.finditer(t.text))
    if not matches:continue
    parent=run.getparent();idx=parent.index(run);pos=0;new=[]
    for m in matches:
        if m.start()>pos:
            r=copy.deepcopy(run);r.find('a:t',ns).text=t.text[pos:m.start()];new.append(r)
        label=m.group(1) or m.group(3);url=m.group(2) or m.group(3)
        # Remove sentence punctuation from bare URL targets.
        if not m.group(2):url=url.rstrip('。；，');label=url
        r=copy.deepcopy(run);r.find('a:t',ns).text=label;attach(r,add_relationship(rels,url),True);new.append(r);nc+=1;pos=m.end()
    if pos<len(t.text):
        r=copy.deepcopy(run);r.find('a:t',ns).text=t.text[pos:];new.append(r)
    parent.remove(run)
    for offset,r in enumerate(new):parent.insert(idx+offset,r)
entries[np]=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
entries[nr]=E.tostring(rels,xml_declaration=True,encoding='UTF-8',standalone=True)
with zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED) as z:
    for name,data in entries.items():z.writestr(name,data)
print(f'Added links to {count} slide objects and {nc} notes citations')
