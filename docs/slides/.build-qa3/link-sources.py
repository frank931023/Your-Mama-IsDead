import sys,json,zipfile
from lxml import etree as E
src,dst,m=sys.argv[1:];mapping=json.load(open(m,encoding='utf-8'))
A='http://schemas.openxmlformats.org/drawingml/2006/main';P='http://schemas.openxmlformats.org/presentationml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';REL='http://schemas.openxmlformats.org/package/2006/relationships';ns={'a':A,'p':P}
with zipfile.ZipFile(src) as z:data={n:z.read(n) for n in z.namelist()}
count=0
for sn,items in mapping.items():
    part=f'ppt/slides/slide{sn}.xml';rp=f'ppt/slides/_rels/slide{sn}.xml.rels';root=E.fromstring(data[part]);rels=E.fromstring(data[rp])
    for shape in root.findall('.//p:sp',ns):
        nv=shape.find('p:nvSpPr/p:cNvPr',ns)
        if nv is None or nv.get('name') not in items:continue
        count+=1;rid=f'rIdQARef{count}';url=items[nv.get('name')]
        E.SubElement(rels,'{'+REL+'}Relationship',Id=rid,Type=R+'/hyperlink',Target=url,TargetMode='External')
        for run in shape.findall('.//a:r',ns):
            r=run.find('a:rPr',ns)
            if r is None:r=E.Element('{'+A+'}rPr');run.insert(0,r)
            r.set('u','sng');E.SubElement(r,'{'+A+'}hlinkClick',{'{'+R+'}id':rid})
    data[part]=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True);data[rp]=E.tostring(rels,xml_declaration=True,encoding='UTF-8',standalone=True)
with zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED) as z:
    for name,content in data.items():z.writestr(name,content)
print(f'{count} source links added')
