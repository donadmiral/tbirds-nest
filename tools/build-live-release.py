"""Build the reviewable atomic release and immutable source hash manifest."""
from pathlib import Path
import hashlib,json,re
root=Path(__file__).resolve().parents[1]
names=['20261103000609_live_portable_control_plane','20261103002857_live_clips_and_distribution','20261103002858_live_interactivity','20261103002832_live_clip_content_delivery','20261103004609_live_foreign_key_indexes','20261103005625_live_retained_relationship_indexes']
target=root/'supabase/ops/live-release-20261103'
units=[];parts=['-- Atomic Live release. QA acceptance precedes production activation.\nbegin;\nset local lock_timeout=\'3s\';\nset local statement_timeout=\'120s\';\n']
for name in names:
 path=root/'supabase/migrations'/f'{name}.sql';data=path.read_text()
 if len(data)<200:raise ValueError(f'Incomplete migration: {name}')
 units.append({'path':str(path.relative_to(root)),'sha256':hashlib.sha256(data.encode()).hexdigest(),'bytes':len(data.encode())})
 body=re.sub(r'^begin;\n','',data,count=1,flags=re.M)
 body=re.sub(r'\ncommit;\s*$','\n',body)
 parts.append('\n-- '+name+'\n'+body)
parts.append('\nnotify pgrst,\'reload schema\';\ncommit;\n')
release=''.join(parts);(target/'release.sql').write_text(release)
(target/'source-manifest.json').write_text(json.dumps({'format':1,'units':units,'release_sha256':hashlib.sha256(release.encode()).hexdigest(),'activation':'off','measured_capacity':False},indent=2)+'\n')
print(f'Review bundle: {len(units)} migrations, {len(release.encode())} bytes')
