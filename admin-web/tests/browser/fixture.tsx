/** Synthetic UI fixture, built outside Next routes. No backend, secrets or production mutations. */
import { createRoot } from 'react-dom/client';
import SideRail from '@/components/SideRail';
import CommandPalette from '@/components/CommandPalette';
import ThemeControls from '@/components/ThemeControls';
import RefreshDesk from '@/components/RefreshDesk';
import { Desk, StatStrip, type DeskRow } from '@/components/Desk';
import { SeriesChart } from '@/components/Viz';
import { GROUPS, ACTIONS } from '@/lib/navigation';
import { allowedDesks } from '@/lib/permissions';
import { usePathname } from './router-adapter';

const role = new URLSearchParams(window.location.search).get('role') || 'super_admin';
const allowed = allowedDesks(role);
const groups = GROUPS.map(group => ({ ...group, items: group.items.filter(item => allowed.has(item.href)) })).filter(group => group.items.length);
const items = groups.flatMap(group => group.items.map(item => ({ ...item, group: group.label })));
const actions = ACTIONS.filter(action => allowed.has(action.href));
const names = ['Avery Chen','Blake Williams','Casey Rivera','Drew Patel','Emery Johnson','Finley Brooks','Harper Scott','Jordan Lee','Kai Martin','Logan Taylor','Morgan James','Noah Kim','Oakley Adams','Parker Wilson','Quinn Davis','Riley Moore','Sage Clark','Taylor Hall','Winter Lewis','Zion Allen','Alex Carter','Charlie Evans','Dakota Green','Elliot Young','Frankie King','Hayden Wright'];
const rows: DeskRow[] = names.map((name,index) => ({
  id: 'fixture-' + index,
  tabs: [index % 4 === 0 ? 'review' : 'active'],
  search: `${name} @${name.split(' ')[0].toLowerCase()} ${index % 4 === 0 ? 'review' : 'active'}`,
  facets: { type: index % 3 === 0 ? 'Business' : 'Creator' },
  cells: [{ t:'user',v:name,sub:'@'+name.split(' ')[0].toLowerCase() }, {t:'pill',v:index%3===0?'Business':'Creator',tone:'neutral'},
    {t:'pill',v:index%4===0?'Needs review':'Active',tone:index%4===0?'warn':'ok'}, {t:'mono',v:String(12+index*17)}, {t:'dim',v:'Oct 29, 2026'}],
  detail: { title:name,subtitle:'@'+name.split(' ')[0].toLowerCase(),pills:[{v:index%4===0?'Needs review':'Active',tone:index%4===0?'warn':'ok'}],
    stats:[{label:'Followers',value:String(12+index*17)},{label:'Posts',value:String(4+index)}],
    fields:[{label:'Account type',value:index%3===0?'Business':'Creator'},{label:'Member since',value:'October 1, 2026'},{label:'Review ID',value:'fixture-'+index}],
    body:[{label:'Review context',text:'Synthetic account used to verify layout, filters, pagination and form identity. This is not live member data.'}],
    links:[{label:'Open profile',href:'/users/fixture-'+index}] },
  actions:['review'],
}));
const days = Array.from({length:30}, (_,i) => ({day:`2026-10-${String(i+1).padStart(2,'0')}`,members:40+i*3+Math.round(Math.sin(i/3)*12),posts:14+i+Math.round(Math.cos(i/2)*7)}));
async function recordAction(data: FormData) {
  const output = document.getElementById('fixture-receipt');
  if (output) output.textContent = JSON.stringify(Object.fromEntries(data));
  await new Promise(resolve => setTimeout(resolve,60));
}
function Fixture() {
  const path = usePathname();
  return <div style={{ display:'flex',minHeight:'100vh' }}>
    <SideRail groups={groups} counts={{'/reports':7,'/queue':null,'/support':12}} active={path} email="reviewer@example.test" roleLabel={role.replaceAll('_',' ')} />
    <main style={{flex:1,minWidth:0}}>
      <header className="pc-topbar" style={{background:'var(--topbar)',borderBottom:'1px solid var(--line)',position:'sticky',top:0,zIndex:30}}>
        <div className="pc-breadcrumb">Operations <span style={{color:'var(--txt-muted)'}}> / Overview</span></div>
        <CommandPalette items={items} actions={actions} />
        <div className="pc-topbar-actions"><ThemeControls /><span style={{fontSize:11,color:'var(--txt-muted)'}}>QA fixture</span></div>
      </header>
      <div id="workspace" tabIndex={-1} className="pc-workspace">
        <div className="pc-page-heading"><div><p className="pc-page-kicker">Overview</p><h1 className="pc-page-title">Workspace overview</h1><p className="pc-page-subtitle">Community activity and the work that needs your attention.</p></div><div className="pc-page-actions"><RefreshDesk /><button type="button" className="pc-button pc-button-primary" onClick={()=>document.getElementById('fixture-records')?.scrollIntoView({block:'start'})}>Review records ↗</button></div></div>
        <p className="pc-service-notice">Synthetic layout and interaction fixture · no live accounts or production data</p>
        <StatStrip cards={[{label:'Members',value:'1,284',delta:'+12.4%',deltaTone:'ok',note:'synthetic comparison',spark:[5,8,4,7,10,9,14]},{label:'Active today',value:'324',delta:'+8.2%',deltaTone:'ok',note:'synthetic activity',spark:[8,6,10,7,12,14,17]},{label:'Open reports',value:'7',note:'synthetic review queue'},{label:'Pending verification',value:'—',note:'count unavailable in this fixture'}]} />
        <div className="fixture-chart-grid"><section className="fixture-panel"><h2>Platform activity</h2><p>Daily activity in the synthetic dataset</p><SeriesChart rows={days} height={220} series={[{key:'members',label:'Active members',color:'var(--c1)'},{key:'posts',label:'Posts',color:'var(--c2)'}]} /></section><section className="fixture-panel"><h2>Needs attention</h2><p>Review the context before taking action</p>{[['Open reports','7'],['Support requests','12'],['Verification','Unavailable']].map(([label,value])=><div key={label} className="fixture-attention"><span>{label}</span><strong>{value}</strong></div>)}<p style={{marginTop:18}}>The fixture intentionally includes an unavailable count to check that an error is never presented as an empty queue.</p></section></div>
        <section id="fixture-records" style={{scrollMarginTop:100}}><h2 style={{fontSize:18,margin:'26px 0 14px'}}>Member review</h2>
          <Desk tabs={[{key:'all',label:'All accounts',count:rows.length},{key:'active',label:'Active',count:rows.filter(row=>row.tabs.includes('active')).length},{key:'review',label:'Needs review',count:rows.filter(row=>row.tabs.includes('review')).length}]}
            columns={[{label:'Member'},{label:'Type',sort:'text'},{label:'Status',sort:'text'},{label:'Followers',align:'right',sort:'number'},{label:'Updated'}]}
            grid="minmax(160px,2fr) 100px 120px 80px 110px" minWidth={630} rows={rows} searchHint="Search this review page" filters={[{key:'type',label:'Account type',options:['Business','Creator']}]} detailTitle="Account details"
            actions={[{key:'review',label:'Save review note',action:recordAction,idName:'id',tone:'info',inputs:[{name:'reason',label:'Review basis',type:'textarea',required:true,minLength:20,maxLength:2000,help:'Use 20–2,000 characters. This fixture records locally and never writes to a backend.'}]}]} />
        </section><output id="fixture-receipt" hidden />
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
