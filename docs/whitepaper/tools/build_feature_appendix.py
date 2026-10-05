"""Build the reproducible Typst feature appendix from captured evidence; no network calls."""
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[3]
WP=ROOT/'docs/whitepaper'
EV=WP/'evidence'
m=json.loads((EV/'view-manifest.json').read_text())
extras=json.loads((EV/'supplementary-views.json').read_text()) if (EV/'supplementary-views.json').exists() else []
src=json.loads((EV/'source-controls.json').read_text())
q=lambda x:json.dumps(str(x),ensure_ascii=False)
t=lambda x:'#text('+q(x)+')'
para=lambda x:t(x)+'\n\n'
heading=lambda level,x:'#heading(level: '+str(level)+')['+t(x)+']\n\n'
labels={'overview':'Overview','research':'Research','live':'Execution','portfolio':'Portfolio','risk':'Risk','data':'Data','reliability':'Reliability','developer':'Developer','markets':'Markets','coherence':'Proofs','diffusion':'Diffusion','global':'Shared controls','auth':'Authentication'}
sections={}
text=(ROOT/'Part2_Infrastructure/web/lib/sections.ts').read_text()
mapkeys={'EXECUTION':'live','COHERENCE':'coherence','MARKETS':'markets','DIFFUSION':'diffusion'}
for key,body in re.findall(r'export const (\w+)_SECTIONS = \[(.*?)\] as const',text,re.S):
 desk=mapkeys.get(key,key.lower())
 for id,label,desc in re.findall(r'\{ id: "([^"]+)", label: "([^"]+)", description: "([^"]+)" \}',body):sections[(desk,id)]=(label,desc)
explanations={
'overview':('Read the whole desk at a glance.','Decision loop shows the research candidate, order intent, provider supply, book exposure and risk boundary. Desk roles opens the workspace for each role. Audit trail reads recorded paper-order decisions. Pipeline stages, role cards, Review verdict and Next step move to the relevant workspace while preserving shared context.'),
'research':('Build and assess a reproducible strategy experiment.','Select the instrument, timeframe and one of 46 strategy models, then adjust fast/slow periods and execution assumptions. Auto recomputes when inputs change; Run now or Command/Ctrl+Enter records an explicit experiment. Results includes the data identity, search-adjusted verdict and performance. Heatmap clicks and arrow keys inspect a parameter pair; Walk-forward and Attribution inspect robustness. Lineage connects the dataset to its providers and research memory. Decision evaluates promotion vetoes and sizing; Promote is gated. Runs supports history inspection, comparison, export and clearing browser history. Fitted models submits a supervised training job when the gateway is available. Strategies selects a model and returns to Summary. Setup has Core parameters and Adjustments panes.'),
'live':('Stage a paper order and inspect its cost and risk decision.','Trade contains symbol, side, order type, notional, limit and execution controls, plus demonstration presets for a valid order, oversized order and rate-limit burst. Sending a paper order requires the gateway and operator permission; it produces a named gate vector and decision. Liquidity exposes the consolidated book; selecting a ladder price stages a limit ticket. Routing & TCA compares cost and venue allocation. Fill quality compares realised and modelled cost. Blotter shows orders, tape and alerts. Three paper BUY orders (BTCUSDT 1,000 USD, ETHUSDT 1,500 USD and SOLUSDT 500 USD) were accepted through the deployed interface to verify submission and populate the paper portfolio. These are verification positions, not real venue orders. Cancellation and burst actions remain source-documented.'),
'portfolio':('Inspect holdings, equity, attribution and allocation.','The Live/Sandbox selector chooses the real gateway book or explicitly generated browser data. Overview switches between Standing and Book. Equity & P&L presents the session curve and attribution. Positions includes Holdings, Shape and Exit; symbol handoffs preserve context into Research and Execution. Allocation includes Mix, Targets and Composition; target edits drive a proposed rebalance, with execution dependent on the gateway. Performance attributes return and costs. The source panel identifies whether data is live, generated, pending or unavailable.'),
'risk':('Inspect loss estimates, constraints and controls over the same book.','Limits identifies binding constraints and concentration. Risk engine estimates loss and shows validation; Risk diagram compares forecasts with realised losses; Risk drivers decomposes contribution and correlation. Monte Carlo exposes path count, seed and forward horizon with a bootstrap distribution. Oracle VaR uses a separate in-database GBM check and shares the horizon. Stress tests accepts forward shock inputs and recalculates book damage. Controls presents operator-gated halt, reduce-only and flatten handoffs. Oracle API calls were enabled for this recapture and the live database calculation returned observations. Supplemental Sandbox screenshots use explicitly generated book inputs with the real Oracle computation. A zero floored GBM loss on the small live paper exposure is a valid model result, not missing data.'),
'data':('Determine whether upstream evidence is fresh, valid and traceable.','Trust Summary switches Verdict, Response and Composition. Feeds & Contracts exposes freshness, validation and action context. Quality covers reconciliation, contract results and escalation. Incidents exposes outages and quarantined responses. Lineage & Payloads follows provider, cache and coercion evidence; replay and backfill select a capability, symbol, interval or date range and require the relevant gateway path. Providers & Capacity inspects failover and quota headroom. Work Queue creates and edits versioned requests, tickets and bugs, marking locally held edits when persistence is unreachable. Server mutations were not executed.'),
'reliability':('Trace an incident through platform dependencies and operator controls.','Attention & SLIs distinguishes decision latency, compiled-core latency and network latency. Dependencies shows the component tree and scope of unknown state behind an unavailable gateway. Services & Circuits drills into providers, venues, failover and breaker state. Logs & Traces filters and inspects events and request paths. Remediation switches Mutations, Scope, Session, Recovery and History. Server controls purge responses, close circuits, clear simulated outages, reload providers, reset quota ledgers and clear telemetry as exposed by the current component. Scope diagrams explain affected stores. Session controls change local sockets and polling. Confirmation and token fields guard writes; capture opened presentation controls only.'),
'developer':('Review architecture, readiness, contracts and code custody.','Topology maps the runtimes and shared context. Readiness lists launch gates, schema status and artifacts. CI / CD presents pipeline and test evidence; displayed counts retain their original measurement date. API & Schema switches Contracts, Routes and Numerics: inspect contract digest steps, select routes and copy curl examples, or recompute numerical reference parity. Code & Diffs supports searching repository paths and inspecting change evidence. Task Queue tracks engineering work. Local source and deployed revision differ in this capture; the appendix records both rather than claiming parity.'),
'markets':('Read prediction-market prices, structure, depth and costs.','Universe switches Basket pricing, Positions and Families; select a family to share it with related instruments. Settlement separates Index, Formation and Pending observations. Books offers Ladder, Identity and History with exact snapshot selection. Makers separates quote Dispersion and REST-poll evidence, including private-channel refusal. Lattice shows Survival, Mass, Moment shape and Moment support. Stake exposes Plan, Capital, Method and All outcomes; bankroll and probability inputs change a sizing illustration. Fees offers Worked example, Cost shape, Ablation and Replay table; fee inputs and cost-model selection recalculate the illustration. Shell exposes Namespace, Routing and Browse. These tabs contain no order executor. Multi-outcome and threshold families are selected where the estimator requires them; missing historical or private-channel observations remain disclosed.'),
'coherence':('Test whether quoted prices admit a consistent probability model.','Coherence test switches Verdict, Proof, Checks, Prices and Sizes. Basket exposes the statewise cover, portfolio legs and executable size. Parlays separates probability ranges, a test quote, leg prices, test legs and bound checks. Coherence index compares polls and families. Scorecard exposes the score, decomposition, component scale, measures, reliability and calibration bands. Corpus shows composition and score trend. Lessons provides a selectable curriculum with code and test provenance. Selectable diagram marks, constraints, bins, rows and sliders preserve exact values alongside visual highlights. Live gateway evidence is included. Account-private and conditional controls remain documented from source when unavailable to the guest session.'),
'diffusion':('Inspect how information enters prices and test the estimator locally.','Announcement arm switches Absorption, Control and Clocks, with line, stage and admissibility filters. Meetings switches a meeting ledger, calendar and mechanism. Kalshi episodes presents survival and episodes with an adjustable lifetime probe. Measurement and Instrument explain the estimator, refusal conditions and mathematical construction. Sandbox switches Half-life, Simulator and Spectrum, recalculating in the browser when sliders move. Findings switches Effect plot, Findings table and Instrument, with stage, absolute-t and shuffled-p filters. Disclosure panels explain run selection and thresholds. Live study rows come from the restored gateway and its retained analytics history; the separate Sandbox is a browser simulation.'),
}
head='''#import "../template.typ": note, accent, muted

'''
parts=[head,heading(1,'Illustrated feature guide and interaction inventory'),para('Capture edition: 5 October 2026. This chapter extends the original architecture whitepaper with a current website feature guide, screenshots, visible-control inventory and source-level interaction register.'),
'#note("Evidence boundary", ['+t('The initial outage captures have been replaced with actual deployed Vercel UI captures after the user requested reconnection of the OCI gateway and Caddy. Oracle calculations, providers and saved analytical history were read live. Three paper verification orders populated the live paper book; supplemental Sandbox book values are explicitly generated. No real venue trade, flatten, purge, outage, account creation or credential change was submitted. Private RFQ access requires an authenticated desk account. This is a documentation inventory, not proof that every production interaction succeeds.')+'])\n\n',
para('Coverage: 11 workspace tabs, 70 registered sections, 120 registered URL views; '+str(len(extras))+' supplementary states; '+str(sum(len(x.get('screenshots',[])) for x in m+extras)+1)+' screenshot placements including login; '+str(len(src['controls']))+' JSX control definitions and '+str(len(src['listeners']))+' event-listener registrations scanned across '+str(src['files'])+' source files.'),
para('The baseline screenshots displayed build 726bbe7. Oracle search and Oracle chart recaptures display production build 3b9918f6. Each capture retains its date and mode. The original source-control inventory is revision 5225f3e2. These are different revisions. Runtime screenshots describe the deployed version; source entries describe the local repository and include conditional or reusable components. Dynamic rows, options and chart points are families of interactions, not a finite list of all future data values. A source definition is not proof of reachability from the current guest session.'),
heading(2,'Operating state and capture provenance'),
para('Earlier captures followed a verified gateway reconnection. At the latest Revision F check, the gateway VM is unreachable over SSH and HTTPS; its current container state and final shutdown are unverified. Oracle ADB and the Supabase embedding service answer independently. Oracle vector search has been repaired and captured from production build 3b9918f6. No volumes, databases or audit history were deleted. See the latest verification chapter and operating-state attachment for the unresolved console-access requirement.'),
para('Other GitHub workflows can contact Oracle: CI includes a live database check; End-to-end smoke probes Oracle; Deploy gateway to OCI can restart containers; Apply database schema can modify Oracle. All seven repository workflows were verified disabled_manually after explicit approval, including OpenBB keep-alive and public-market observation. No running or queued GitHub Actions runs were returned at verification. Their final verified states are recorded in the operational evidence file. Stopping GitHub calls or Docker processes does not itself stop an OCI virtual machine or a paid Autonomous Database resource. Oracle states that stopping an Autonomous Database halts its CPU billing; storage is billed separately. No Oracle resource termination was performed.'),
para('Oracle reference: https://docs.oracle.com/en/cloud/paas/autonomous-database/serverless/adbsb/autonomous-stop.html ; billing: https://docs.oracle.com/en-us/iaas/autonomous-database-serverless/doc/autonomous-database-billing.html'),
heading(2,'Shared navigation, access and interactions')]
for title,body in [
('Tabs, rails and deep links','The eleven top-level tabs select a role or analytical workspace. Section rails change the active section; nested segmented controls select a view. The address grammar is #tab/section/view, with a two-segment default. ArrowLeft/ArrowRight and Home/End move along accessible rails; Tab and Shift+Tab move focus; Enter or Space activates a focused button. Narrow layouts expose a section picker and compact workspace navigation. Browser Back returns through navigation history.'),
('Command palette and keyboard tour','Command/Ctrl+K opens search across tabs, sections, views, models and instruments. Type to filter, use arrow keys to select and Enter to navigate; Escape dismisses. Alt+1 through Alt+9 and Alt+0 select the first ten tabs. Diffusion is reachable from the tablist or palette. ? opens shortcuts and the eleven-stop reviewer tour. Each tour stop opens its target and dismisses the overlay.'),
('Header diagnostics and presentation','The brand returns to Overview. Data source opens provenance; the latency chip opens reliability evidence; provider status opens Reliability. Settings exposes theme, detail level, text size, formatting and status. Menus dismiss on Escape or click-away. The kill-switch chip opens a guarded operator panel; opening it is distinct from issuing a halt. Connect opens the Telegram companion when available; it was not used to send messages or link an account.'),
('Sign-in and account','The login form contains email, password, password visibility, Remember me, Sign in, Forgot password, Create account, GitHub sign-in and Continue as guest. Authentication and account-private actions require a real session. Profile components cover display name, avatar, linked methods, sessions, password and sign-out. These authenticated operations are documented from source because the capture uses guest access.'),
('Charts, selectors and forms','Native selects enumerate choices; radio/segmented controls expose a selected state; checkboxes toggle options; range and number fields change bounded parameters. Chart marks, heatmap cells and table rows support hover, focus or selection where implemented, with an exact-value readout. Disclosure summaries expand or collapse explanations. Search fields filter local lists or request evidence according to their handler. Download/copy controls export or copy the named result. Disabled controls retain their prerequisite or failure explanation.'),
('Operational actions and evidence','Retry and Refresh request current evidence; responses retain their actual freshness and error state. Operator token/confirmation controls guard writes. Run, Fit, Replay, Backfill, Promote, Submit, Cancel, Flatten, Clear, Purge and Reset are documented individually in the source register; their scope depends on the specific component and handler. An enabled button alone is not evidence that its backend can complete the action.')]:parts.extend([heading(3,title),para(body)])
for desk,(purpose,body) in explanations.items():
 parts.extend([heading(2,labels[desk]),para(purpose),para(body)])
 rows=[(id,*v) for (d,id),v in sections.items() if d==desk]
 if rows:
  parts.append('#table(columns: (25%, 30%, 45%), table.header([Section], [Address], [Feature]),\n')
  for id,label,desc in rows:parts.append(f'[{t(label)}], [{t("#"+desk+"/"+id)}], [{t(desc)}],\n')
  parts.append(')\n\n')
parts.extend([heading(1,'Screenshot atlas'),para('Each route includes its actual captured screen and a control list. Continuation screenshots cover the internal scroll area with overlap. A control list records rendered controls including offscreen elements within the active section; options and disabled states are retained. Shared header controls are listed once above and omitted from repeated view tables. Source-level definitions later in the appendix cover conditional controls that data availability or guest access prevents from rendering.')])
# Screenshots use a large landscape sheet so dense analytical labels survive print.
def page_landscape():return '#pagebreak()\n#set page(paper: "a3", flipped: true, margin: (top: 18mm, bottom: 16mm, left: 20mm, right: 20mm))\n'
def page_portrait():return '#pagebreak()\n#set page(paper: "a4", flipped: false, margin: (top: 26mm, bottom: 24mm, left: 22mm, right: 22mm))\n'
parts.append(page_landscape()+heading(2,'Sign in and guest entry')+'#image("../screenshots/login.png", width: 100%, height: 233mm, fit: "contain")\n')
def useful(c):
 l=c.get('label','');return c.get('role') not in ['tabpanel','region','radiogroup','tablist'] and (c.get('tag') in ['BUTTON','A','INPUT','SELECT','TEXTAREA','SUMMARY','svg','SVG'] or c.get('role') in ['button','tab','img','slider']) and not (c.get('role')=='tab' and l in ['Overview','Research','Execution','Portfolio','Risk','Data operations','Reliability','Developer','Prediction market quotes','Prediction market coherence','Information diffusion into prices']) and not any(l.startswith(x) for x in ['Skip to workspace','Open AlphaEngine','Open the command palette','Open reliability latency','Data source:','Open the kill switch','Open reliability.','Open quick settings']) and l not in ['Sign in','All Roles','Quant','PM','SRE','Dev']
def action(c):
 tag=c.get('tag','');a=[]
 if c.get('title') and c['title']!=c.get('label'):a.append(c['title'])
 if tag=='A':a.append('Navigate to '+str(c.get('href') or 'the linked destination'))
 elif tag=='SUMMARY':a.append('Expand/collapse explanatory content.')
 elif tag=='SELECT':a.append('Choose: '+ '; '.join(o['text'] for o in c.get('options') or []))
 elif tag=='INPUT':a.append({'range':'Adjust a bounded numeric parameter.','checkbox':'Toggle this option.','radio':'Select this option.','number':'Enter a numeric parameter.','text':'Enter text to set or filter the named field.'}.get(c.get('type'),'Edit the named field.'))
 elif c.get('role')=='tab':a.append('Select this section/view.')
 elif c.get('label','').startswith('Open '):a.append('Navigate to or open '+c['label'][5:].rstrip(' →')+'.')
 elif c.get('label','').startswith('Review verdict'):a.append('Open Research to inspect the current strategy verdict.')
 elif c.get('label','').startswith('Next step'):a.append('Navigate to the next workspace in the decision loop.')
 elif c.get('role')=='img':a.append('Inspect the chart and its exact-value readout where interactive.')
 if c.get('value') not in [None,'']:a.append('Captured value: '+str(c['value']))
 if not a:a.append('Activate the named action; exact event binding is indexed in the source register.')
 return ' '.join(a)
for idx,x in enumerate(m+extras,1):
 desk=x.get('desk','global');sec=x.get('section','');sl,desc=sections.get((desk,sec),(sec.replace('-',' ').title(),''))
 title=f'{idx:03d}  {labels.get(desk,desk)} / {sl}'+(' / '+x['view'] if x.get('view') else '')+(' - '+x['state'] if x.get('state') else '')
 for si,im in enumerate(x.get('screenshots',[])):
  parts.append(page_landscape())
  if si==0:parts.append(heading(2,title))
  else:parts.append('#text(size: 13pt, weight: "bold", '+q(title+' - continued')+')\n\n')
  parts.append('#text(size: 8pt, '+q('#'+x['hash']+' | '+desc+' | '+x.get('capture_mode', 'Deployed Vercel UI; live gateway'))+')\n\n')
  if x['hash']=='risk/oraclevar':parts.append(para('Production build 3b9918f6: corrected currency-axis labels; explicitly generated Sandbox inputs with real Oracle computation.'))
  parts.append('#image('+q('../screenshots/'+im)+', width: 100%, height: 230mm, fit: "contain")\n')
 cs=[c for c in x.get('controls',[]) if useful(c)]
 # One instance per identical rendered definition; repeated rows stay identified by label.
 unique=[];seen=set()
 for c in cs:
  key=(c.get('label'),c.get('tag'),c.get('role'),c.get('title'),str(c.get('options')))
  if key not in seen:unique.append(c);seen.add(key)
 if unique:
  parts.append(page_portrait()+'#text(size: 13pt, weight: "bold", '+q(title+' - controls')+')\n\n')
  parts.append('#set text(size: 8pt)\n#table(columns: (30%, 15%, 55%), inset: 4pt, table.header([Control], [Captured state], [Interaction / choices]),\n')
  for c in unique:
   state='disabled' if c.get('disabled') else ('selected' if c.get('selected')=='true' else c.get('type') or c.get('role') or c.get('tag','').lower())
   label=c.get('label','')
   if len(label)>500:label=label[:500]+' [long accessible label; full value in evidence attachment]'
   detail=action(c)
   parts.append(f'[{t(label)}], [{t(state)}], [{t(detail)}],\n')
  parts.append(')\n#set text(size: 9.8pt)\n')
parts.append(page_portrait()+heading(1,'Source-level control and interaction register'))
parts.append(para('This register enumerates native buttons, links, inputs, selects, textareas and disclosures, common interactive primitives, and JSX elements with event props. Entries are source definitions, not runtime counts: one mapped definition may generate many buttons, and a reusable component may have several consumers. Inline handler excerpts and referenced function names state exactly where the behavior is implemented. Disabled/hidden predicates describe conditional reachability. The complete untruncated attributes, event bindings and global listener calls are included in the attached source-controls.json evidence file. Source root: Part2_Infrastructure/web; revision 5225f3e2.'))
parts.append('#set text(size: 8pt)\n')
last=None
for i,c in enumerate(src['controls'],1):
 if c['file']!=last:
  parts.append(heading(3,c['file']));last=c['file']
 label=c['label'];label=label[1:-1] if label.startswith('"') and label.endswith('"') else label
 if len(label)>250:label=label[:250]+' ... [full expression attached]'
 parts.append('#block(breakable: true, above: 5pt, below: 5pt)[\n'+t(f'C{i:04d} | line {c["line"]} | {c["tag"]} | {label}')+'\n\n')
 attrs=c['attributes'];info=[]
 for k in ['type','href','role','min','max','step','disabled','readOnly','aria-expanded','aria-pressed','aria-selected','tabIndex']:
  if k in attrs:info.append(k+': '+attrs[k])
 if info:parts.append(t('State / constraints: '+'; '.join(info))+'\n\n')
 if c['events']:
  for k,v in c['events'].items():parts.append(t(k+': '+(v if len(v)<340 else v[:340]+' ... [full binding attached]'))+'\n\n')
 else:parts.append(t('Native control behavior or behavior supplied by the parent form/component; no inline event prop on this element.')+'\n')
 parts.append(']\n')
parts.append('#set text(size: 9.8pt)\n'+heading(2,'Keyboard, pointer, focus and lifecycle listeners'))
parts.append(para('These registrations include user-facing keyboard and pointer behavior as well as visibility, worker and lifecycle events that affect interaction state. They are included to avoid treating button clicks as the entire interaction surface.'))
for i,c in enumerate(src['listeners'],1):
 parts.append(para(f'L{i:03d} | {c["file"]}:{c["line"]} | '+c['call'].replace('\n',' ')[:650]))
parts.append(heading(2,'Evidence and limitations')+para('The PDF embeds the route manifest, supplementary-state manifest, source-control inventory and verified operational status as attachments. The screenshot files and Typst source are retained beside the original whitepaper in the repository. No screenshots represent a fabricated healthy service. Guest access cannot expose authenticated profile or private-channel success states. Source-only behavior is catalogued, not represented as an executed test. Menu expansion, navigation and sandbox changes were performed in an isolated documentation browser. Every possible data-dependent chart point, validation input, account role and server response is an unbounded state space; this edition inventories the registered views and source controls rather than claiming exhaustive state-space testing.'))
(WP/'sections/07-feature-atlas.typ').write_text(''.join(parts).rstrip()+'\n')
print('Generated appendix:',len(m),'routes,',len(extras),'supplementary states,',len(src['controls']),'source controls')
