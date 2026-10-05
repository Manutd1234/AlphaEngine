from pathlib import Path
import os,re
root=Path.cwd();web=root/'Part2_Infrastructure/web';env=os.environ.copy()
for folder in [root,root/'Part2_Infrastructure',web]:
 for p in folder.glob('.env*'):
  if p.is_file():
   for l in p.read_text(errors='ignore').splitlines():
    m=re.match(r'(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=',l)
    if m:env[m.group(1)]=''
env.update({'ALPHAENGINE_GATEWAY_URL':'','NEXT_PUBLIC_SUPABASE_URL':'','NEXT_PUBLIC_SUPABASE_ANON_KEY':'','ORACLE_CONN_STRING':'','ORACLE_PASSWORD':'','ORACLE_USER':'','ENABLE_MARKET_DATA':'0','ALPHAENGINE_OPERATOR_OPEN':'0','PORT':'3107','NEXT_TELEMETRY_DISABLED':'1'})
os.chdir(web)
os.execvpe('node',['node','node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','3107'],env)
