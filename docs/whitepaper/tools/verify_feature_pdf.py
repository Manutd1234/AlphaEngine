"""Check published images, page bounds, links and evidence coverage; emit page references."""
from pathlib import Path
import json,hashlib,csv,collections
import pymupdf as fitz
from PIL import Image
ROOT=Path(__file__).resolve().parents[3];WP=ROOT/'docs/whitepaper';EV=WP/'evidence'
pdf=ROOT/'output/pdf/AlphaEngine_Whitepaper_Features_and_Interactions.pdf'
plan=json.loads((EV/'publication-plan.json').read_text());doc=fitz.open(pdf)
expected={}
for name in plan['unique_images']:
 with Image.open(WP/'screenshots'/name) as im:expected[hashlib.sha256(im.convert('RGB').tobytes()).hexdigest()]=name
placements=[];cache={};overflow=[];bad_links=[];key_pages={}
for i,page in enumerate(doc):
 text=page.get_text()
 for title in ['Oracle page index','Interaction verification matrix','9 AlphaEngine Features','Internal subtabs without their own URL']:
  if i>80 and title in text:key_pages.setdefault(title,[]).append(i+1)
 for block in page.get_text('blocks'):
  if block[0]<-1 or block[1]<-1 or block[2]>page.rect.width+1 or block[3]>page.rect.height+1:overflow.append({'page':i+1,'kind':'text'})
 for link in page.get_links():
  if link['kind']==fitz.LINK_GOTO and not 0<=link['page']<len(doc):bad_links.append({'page':i+1,'target':link['page']})
 for info in page.get_image_info(xrefs=True):
  x=info['xref']
  if not x or info['width']<1000:continue
  if x not in cache:
   pix=fitz.Pixmap(doc,x)
   if pix.colorspace.n!=3:pix=fitz.Pixmap(fitz.csRGB,pix)
   if pix.alpha:pix=fitz.Pixmap(pix,0)
   cache[x]=expected.get(hashlib.sha256(pix.samples).hexdigest())
  bbox=info['bbox']
  if bbox[0]<0 or bbox[1]<0 or bbox[2]>page.rect.width+1 or bbox[3]>page.rect.height+1:overflow.append({'page':i+1,'kind':'image'})
  placements.append({'page':i+1,'file':cache[x]})
image_pages={p['file']:p['page'] for p in placements if p['file']}
capture_pages={r['capture_id']:[image_pages[f] for f in r['print_screenshots']] for r in plan['records']}
capture_pages['login']=[image_pages.get('login.png')]
for r in plan['records']:
 if not capture_pages[r['capture_id']]:capture_pages[r['capture_id']]=sorted({p for x in r['same_image_references'] for p in capture_pages[x['target']]})
qa={'pdf_pages':len(doc),'screenshot_placements':len(placements),'expected_unique_images':len(expected),'unmatched_images':[p for p in placements if not p['file']],'missing_images':sorted(set(plan['unique_images'])-set(image_pages)),'duplicate_images':[name for name,n in collections.Counter(p['file'] for p in placements).items() if n>1],'bounds_failures':overflow,'invalid_links':bad_links,'key_pages':key_pages,'capture_pages':capture_pages,'scope':'Pixel hashes verify originals and no exact duplicate image placements. Current edition images reviewed visually; link targets and page bounds checked. Screenshots do not certify every backend interaction.'}
(EV/'publication-qa.json').write_text(json.dumps(qa,indent=2)+'\n')
matrix=json.loads((EV/'interaction-matrix.json').read_text())
for row in matrix['interactions']:
 row['pdf_pages']=sorted({p for r in plan['records'] if r['hash']==row.get('hash') for p in capture_pages[r['capture_id']]})
(EV/'interaction-matrix.json').write_text(json.dumps(matrix,indent=2,ensure_ascii=False)+'\n')
with (EV/'interaction-matrix.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=['id','kind','hash','file','line','label','status','evidence','pdf_pages'],extrasaction='ignore');w.writeheader();w.writerows(matrix['interactions'])
assert len(placements)==len(expected),(len(placements),len(expected))
assert not any(qa[k] for k in ['unmatched_images','missing_images','duplicate_images','bounds_failures','invalid_links']),qa
print(json.dumps({k:v for k,v in qa.items() if k!='capture_pages'},indent=2),flush=True)
