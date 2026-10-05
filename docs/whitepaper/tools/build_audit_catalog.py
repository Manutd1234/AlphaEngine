"""Prepare a deduplicated publication plan and explicit interaction evidence ledger."""
from pathlib import Path
import json, hashlib, re, csv, collections
from PIL import Image

ROOT=Path(__file__).resolve().parents[3]
WP=ROOT/'docs/whitepaper'; EV=WP/'evidence'
read=lambda name:json.loads((EV/name).read_text())
write=lambda name,obj:(EV/name).write_text(json.dumps(obj,indent=2,ensure_ascii=False)+'\n')
primary=read('view-manifest.json'); extra=read('supplementary-views.json')
audit=read('ui-sweep.json') if (EV/'ui-sweep.json').exists() else {'routes':[],'interactions':[],'captures':[]}
fixes=read('capture-fixes.json') if (EV/'capture-fixes.json').exists() else {'captures':[],'interactions':[]}
source=read('source-controls.json')
review=read('capture-review.json') if (EV/'capture-review.json').exists() else {}
fresh=read('subtab-audit.json') if (EV/'subtab-audit.json').exists() else {}

records=[]; omitted=[]
for i,r in enumerate(primary+extra):
 r=dict(r);r['capture_id']=f'F{i+1:03d}';r['canonical']=i<len(primary)
 if r.get('state')=='expanded explanations':
  omitted.append({'capture_id':r['capture_id'],'hash':r['hash'],'state':r['state'],'screenshots':r['screenshots'],'reason':'Repeated disclosure-expanded view; original capture and controls retained in evidence, omitted from print.'});continue
 if r['hash']=='auth/login':
  omitted.append({'capture_id':r['capture_id'],'hash':r['hash'],'screenshots':r['screenshots'],'reason':'Same login screen is printed once at the start of Chapter 9.'});continue
 if not r['canonical'] and r['hash']=='research/lineage' and 'Oracle vector search' in r.get('state',''):
  omitted.append({'capture_id':r['capture_id'],'hash':r['hash'],'screenshots':r['screenshots'],'reason':'Oracle result is covered once by the canonical Lineage capture.'});continue
 records.append(r)

# Recaptures replace an incomplete state only when their declared target is exact.
for i,r in enumerate(fixes.get('captures',[])):
 r=dict(r);r['capture_id']=f'G{i+1:03d}';r['canonical']=False
 if r.get('rejected_capture'):continue
 if r.get('state')=='Attribution view - Explain':
  omitted.append({'capture_id':r['capture_id'],'hash':r['hash'],'screenshots':r['screenshots'],'reason':'No newly populated benchmark; existing Explain view retained without another near-duplicate.'});continue
 target=r.get('replaces_capture_id')
 if target:
  old=next(x for x in records if x['capture_id']==target)
  omitted.append({'capture_id':target,'hash':old['hash'],'screenshots':old['screenshots'],'reason':'Superseded by verified Revision G capture '+r['capture_id']})
  r['canonical']=old['canonical'];r['capture_id']=target;records[records.index(old)]=r
 else:records.append(r)

# Explicit visual-review decisions complement hashes: changed clocks and selected
# buttons do not make an otherwise repeated feature screenshot useful.
for replacement in review.get('replacements',[]):
 old=next(r for r in records if r['capture_id']==replacement['capture_id'])
 omitted.append({'capture_id':old['capture_id'],'screenshots':old['screenshots'],'reason':'Replaced by focused Revision H active-panel capture.'})
 old.update(replacement)
for decision in review.get('omissions',[]):
 r=next(r for r in records if r['capture_id']==decision['capture_id'])
 if decision['file'] in r['screenshots']:
  r['screenshots']=[f for f in r['screenshots'] if f!=decision['file']]
  omitted.append(decision)
for decision in review.get('shared_states',[]):
 r=next(r for r in records if r['capture_id']==decision['capture_id'])
 omitted.append({**decision,'screenshots':r['screenshots']})
 r['screenshots']=[];r['shared_state']=decision

pixel_owner={};image_owner={};unique_images=[]
def pixels(name):
 with Image.open(WP/'screenshots'/name) as im:return hashlib.sha256(im.convert('RGB').tobytes()).hexdigest()
pixel_owner[pixels('login.png')]='login';image_owner['login.png']='login';unique_images.append('login.png')
for r in records:
 r['print_screenshots']=[];r['same_image_references']=[]
 if r.get('shared_state'):
  r['same_image_references'].append({'target':r['shared_state']['target'],'reason':r['shared_state']['reason'],'kind':'shared feature state'})
 for name in r['screenshots']:
  h=pixels(name)
  if h in pixel_owner:r['same_image_references'].append({'file':name,'target':pixel_owner[h]})
  else:r['print_screenshots'].append(name);pixel_owner[h]=r['capture_id'];image_owner[name]=r['capture_id'];unique_images.append(name)

# Arrange supplementary substates beside their owning section, not hundreds of pages later.
order=[];seen=set()
for r in primary+extra+fixes.get('captures',[]):
 key='/'.join(r['hash'].split('/')[:2])
 if key not in seen:seen.add(key);order.append(key)
records.sort(key=lambda r:(order.index('/'.join(r['hash'].split('/')[:2])),not r['canonical'],r['capture_id']))

def finding(r):
 text=r.get('panelText','');items=[]
 patterns=[('gateway unavailable',r'gateway.{0,100}(unreachable|did not answer|not configured|timed out)|GATEWAY UNREACHABLE|risk gateway\s+not measured\s+✕ down'),('sign-in required',r'account sign-in required|Sign in.{0,60}private RFQ'),('quote unavailable',r'live parlay quote is unavailable'),('provider failure',r'OpenBB/YFinance was unavailable|All 2 calls failed|HTTP 403|not licensed on this key'),('unmeasured health',r'4 OF 5 NOT OBSERVED'),('not run',r'Parity check in this browser\s+Not run|nothing has been hashed'),('no benchmark',r'none selected|No benchmark selected'),('empty queue',r'No engineering work yet')]
 for label,pat in patterns:
  if re.search(pat,text,re.I):items.append(label)
 return items
for r in records:r['limitations']=finding(r)

# Internal presentation tabs do not all have a third URL segment. List them explicitly.
pane_groups=[
 ('research/summary/setup','Setup',['Core parameters','Adjustments']),
 ('research/attribution','Attribution view',['Explain','Robustness']),
 ('research/parameters','Surface colouring',['Neighbourhood','Sharpe']),
 ('live/routing','Routing view',['Routing','TCA']),
 ('live/quality','Fill quality view',['Cost','Where']),
 ('live/activity','Activity view',['Blotter','Decision tape','Alerts & risk events']),
 ('live/activity','Blotter view',['Fills','Active','Cancelled & rejected']),
 ('portfolio/overview','Overview view',['Standing','Book']),
 ('portfolio/positions','Positions view',['Holdings','Shape','Exit']),
 ('portfolio/allocation','Allocation view',['Mix','Targets','Composition']),
 ('portfolio/performance','Performance view',['Flow, lifetime','Trend, this session']),
 ('data/overview','Trust evidence view',['Verdict','Response','Composition']),
 ('data/feeds','Feeds and contracts view',['Freshness','Contracts']),
 ('data/lineage','Inspector view',['REST pipeline','WebSocket frames']),
 ('data/providers','Providers and capacity view',['Routing','Budget']),
 ('reliability/planes','Dependency view',['Map','Live dependency DAG','Providers','Platform','Latency']),
 ('reliability/controls','Remediation view',['Mutations','Scope','Session','Recovery','History']),
 ('developer/quality','CI / CD view',['Pipeline','Verification']),
 ('developer/apis','API and schema view',['Contracts','Routes','Numerics']),
]
pane_rows=[]
for route,group,options in pane_groups:
 candidates=[r for r in records if r['hash']==route]
 for index,option in enumerate(options):
  def matches(r):
   state=r.get('state','')
   if state==option or state.endswith(' - '+option) or state.startswith(option+' - '):return True
   return any(g.get('label')==group and any(b['label']==option and b.get('selected')=='true' for b in g['buttons']) for g in r.get('groups',[]))
  match=next((r for r in candidates if matches(r)),None)
  if not match and index==0:match=next((r for r in candidates if r['canonical']),None)
  pane_rows.append({'hash':route,'group':group,'option':option,'capture_id':match['capture_id'] if match else None,'status':'captured' if match else 'missing','limitations':match['limitations'] if match else ['No correct capture identified'],'basis':'Named capture or source-default pane; image review required, no activation inferred.'})
write('subtab-coverage.json',{'scope':'Presentation panes outside the registered third-segment URL inventory; parameter choices are additionally tracked in the interaction matrix.','panes':pane_rows})

route_rows=[];live={r['hash']:r for r in audit['routes']}
for r in fresh.get('routes',[]):
 live[r['hash']]={**r,'panelText':r.get('text',''),'status':'blocked' if r['status']=='blocked' else 'selection verified' if r.get('view_selection_check')=='passed' else 'rendered'}
for r in primary:
 published=[x for x in records if x['hash']==r['hash'] and x['canonical']]
 s=live.get(r['hash'],{})
 route_rows.append({'hash':r['hash'],'desk':r['desk'],'section':r['section'],'view':r.get('view'),'capture_id':published[0]['capture_id'] if published else None,'screenshot_status':('shared blocked state' if published[0].get('shared_state') else 'captured') if published else 'missing','current_navigation':s.get('status','not checked'),'current_limitations':finding(s),'capture_limitations':published[0]['limitations'] if published else [],'backend_success':'not implied by navigation or screenshots'})

ledger=[]
for i,c in enumerate(source['controls'],1):
 ledger.append({'id':f'C{i:04d}','kind':'source control','file':c['file'],'line':c['line'],'label':c['label'],'events':c['events'],'status':'source documented; not individually exercised','evidence':'source-controls.json','scope':'One source definition may produce multiple runtime instances.'})
for i,c in enumerate(source['listeners'],1):
 ledger.append({'id':f'L{i:03d}','kind':'event listener','file':c['file'],'line':c['line'],'label':c['call'],'status':'source documented; not individually exercised','evidence':'source-controls.json'})
for i,r in enumerate(route_rows,1):
 ledger.append({'id':f'N{i:03d}','kind':'route navigation','hash':r['hash'],'label':'Open registered view','status':'passed' if r['current_navigation'] in ['rendered','selection verified'] else r['current_navigation'],'evidence':'subtab-audit.json' if fresh.get('routes') else 'ui-sweep.json','scope':'Visible expected section and non-empty content only; no backend-success inference.'})
for i,x in enumerate(fixes.get('interactions',[])+audit.get('interactions',[]),1):ledger.append({'id':f'A{i:03d}','kind':'executed interaction',**x,'evidence':'capture-fixes.json / ui-sweep.json'})
for i,x in enumerate(fresh.get('panes',[])+fresh.get('sandbox_check',{}).get('panes',[]),1):
 ledger.append({'id':f'H{i:03d}','kind':'executed interaction','hash':x['hash'],'label':x['group']+' / '+x['option'],'status':'passed' if x['status']=='selected control and panel verified' else 'blocked','postcondition':'Selected presentation control asserted true; no backend-success inference.' if x['status']=='selected control and panel verified' else x.get('reason','Unavailable'),'scope':'Explicit generated Sandbox' if i>len(fresh.get('panes',[])) else 'Production guest session','evidence':'subtab-audit.json'})

# Runtime controls are identified per route and group, retaining disabled and selected states.
runtime=[];keys=set()
for r in audit['routes']+fixes.get('captures',[]):
 for c in r.get('controls',[]):
  key=(r['hash'],c.get('group'),c['tag'],c.get('type'),c['label'])
  if key in keys:continue
  keys.add(key);runtime.append({'id':f'R{len(runtime)+1:04d}','kind':'runtime control','hash':r['hash'],'label':c['label'],'group':c.get('group'),'status':'disabled at observation' if c.get('disabled') else 'observed; activation not individually verified','selected':c.get('selected'),'options':c.get('options'),'evidence':'ui-sweep.json / capture-fixes.json'})
ledger.extend(runtime)
write('interaction-matrix.json',{'definition':'Statuses are scoped. A source definition, rendered button, selected pane and verified backend mutation are different evidence units. No inferred passing status from presence alone.','source_revision':source.get('revision'),'counts':dict(collections.Counter(x['kind'] for x in ledger)),'status_counts':dict(collections.Counter(x['status'] for x in ledger)),'interactions':ledger})
with (EV/'interaction-matrix.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=['id','kind','hash','file','line','label','status','evidence'],extrasaction='ignore',lineterminator='\n');w.writeheader();w.writerows(ledger)
write('publication-plan.json',{'records':records,'omitted':omitted,'unique_images':unique_images,'image_owner':image_owner,'stats':{'canonical_views':len(primary),'published_states':len(records),'printed_screenshots':len(unique_images),'prior_placements':1+sum(len(x['screenshots']) for x in primary+extra),'omitted_disclosure_states':sum('disclosure' in x['reason'] for x in omitted),'exact_duplicate_placements':sum(sum(ref.get('kind')!='shared feature state' for ref in x['same_image_references']) for x in records)},'coverage':route_rows,'pane_coverage':pane_rows})
print(json.dumps({'publication':len(records),'images':len(unique_images),'matrix':len(ledger),'coverage':len(route_rows)},indent=2))
