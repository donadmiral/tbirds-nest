"""Emit exact local dependency bundles for the reviewed Live Edge release.

The JSON on stdout is an input for deploy_edge_function, not a credential file.
All entrypoints authenticate within their handlers; gateway JWT is disabled
because webhooks, single-use ticks and scoped worker secrets are not user JWTs.
"""
from pathlib import Path
import hashlib,json,re

root=Path(__file__).resolve().parents[1]
names=['live-stage','live-control','live-playback','live-provider-webhook',
       'live-cover','live-maintenance','live-sign','live-clip-media','live-clip-worker',
       'content-media-sign','media-content']
bundles=[]
for name in names:
    entry=root/'supabase/functions'/name/'index.ts'
    pending=[entry];files={}
    while pending:
        path=pending.pop().resolve()
        relative=path.relative_to(root).as_posix()
        if relative in files:continue
        data=path.read_text()
        files[relative]=data
        for local in re.findall(r'(?:from\s*|import\s*)[\'\"](\.[^\'\"]+)[\'\"]',data):
            dependency=(path.parent/local).resolve()
            dependency.relative_to(root)
            if not dependency.is_file():raise ValueError(f'Missing dependency {relative}: {local}')
            pending.append(dependency)
    for config in ['deno.json','deno.jsonc']:
        path=entry.parent/config
        if path.exists():files[path.relative_to(root).as_posix()]=path.read_text()
    bundles.append({'name':name,'entrypoint_path':entry.relative_to(root).as_posix(),
      'verify_jwt':False,'files':[{'name':path,'content':text} for path,text in sorted(files.items())]})
print(json.dumps(bundles))
