import sys,zipfile
from lxml import etree as E
source,src,dst=sys.argv[1:]
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
ns={'a':A}
with zipfile.ZipFile(src) as z: data={n:z.read(n) for n in z.namelist()}
with zipfile.ZipFile(source) as z:
    for path in ['ppt/notesSlides/notesSlide1.xml','ppt/notesSlides/_rels/notesSlide1.xml.rels']:data[path]=z.read(path)
root=E.fromstring(data['ppt/slides/slide1.xml']);rels=E.fromstring(data['ppt/slides/_rels/slide1.xml.rels'])
urls=['https://www.sinya.com.tw/prod/214584','https://payment.ardrive.io/v1/rates','https://hc1.taipower.com.tw/2289/2558/49405/49408/67252/','Aeterlux-Billing-Model-Speaker-Notes-Sources.md#maintenance']
tables=root.findall('.//a:tbl',ns);assert len(tables)==1
rows=tables[0].findall('a:tr',ns);assert len(rows)==5
for i,url in enumerate(urls,1):
    rid=f'rIdCostTable{i}'
    E.SubElement(rels,'{'+REL+'}Relationship',Id=rid,Type=R+'/hyperlink',Target=url,TargetMode='External')
    cells=rows[i].findall('a:tc',ns)
    for c in [1,4]:
        for run in cells[c].findall('.//a:r',ns):
            rp=run.find('a:rPr',ns)
            if rp is None:rp=E.Element('{'+A+'}rPr');run.insert(0,rp)
            if c==4:rp.set('u','sng')
            E.SubElement(rp,'{'+A+'}hlinkClick',{'{'+R+'}id':rid})
data['ppt/slides/slide1.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
data['ppt/slides/_rels/slide1.xml.rels']=E.tostring(rels,xml_declaration=True,encoding='UTF-8',standalone=True)
with zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED) as z:
    for name,content in data.items():z.writestr(name,content)
print('Native table hyperlinks added; original speaker notes and links retained')
