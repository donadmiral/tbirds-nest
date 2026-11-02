type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : 'Unavailable';
const label = (value: unknown) => typeof value === 'string' ? value.replaceAll('_', ' ').slice(0, 100) : 'Unavailable';

/** Server-rendered operational data. The surrounding desk authenticates staff. */
export default function CapacityStatus({ data }: { data: unknown }) {
  const status = record(data), latest = record(status.latest), connections = record(latest.connections);
  const components = record(latest.components);
  const alerts = Array.isArray(status.alerts) ? status.alerts.slice(0, 32).map(record) : [];
  const providers = Array.isArray(status.providers) ? status.providers.slice(0, 32).map(record) : [];
  const available = status.version === 1;
  const fresh = available && status.stale === false;
  const names: Record<string, string> = { feed: 'Feed delivery', feed_ranking: 'Feed ranking', post_counter: 'Post counters', notification_fanout: 'Notifications', notification_worker: 'Push processing', admin_reporting: 'Admin reporting', media_processing: 'Media processing', calls: 'Call cleanup' };
  return <section aria-labelledby="capacity-heading" className="mt-8">
    <h2 id="capacity-heading" className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Capacity monitoring</h2>
    <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5 text-[12.5px]">
      <p className="font-semibold">{!available ? 'Capacity sampling is unavailable on this deployment.' : fresh ? 'Current operational sample' : 'Operational sample is missing or stale.'}</p>
      {available && <>
        <p className="mt-1 text-[#7A7D84]">{status.sampling_enabled === true ? 'Sampling enabled.' : 'Sampling disabled.'} {typeof status.sampled_at === 'string' ? `Last sample: ${status.sampled_at}.` : 'No sample has been collected.'}</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div><dt className="text-[#7A7D84]">Database connections</dt><dd className="mt-1 font-semibold tabular-nums">{number(connections.clients)} / {number(connections.maximum)}</dd></div>
          <div><dt className="text-[#7A7D84]">Waiting for a lock</dt><dd className="mt-1 font-semibold tabular-nums">{number(connections.waiting_for_lock)}</dd></div>
          <div><dt className="text-[#7A7D84]">Current provider reservations</dt><dd className="mt-1 font-semibold tabular-nums">{providers.filter(item => item.reservation_current === true).length} / {providers.length}</dd></div>
        </dl>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left"><caption className="sr-only">Capacity component availability in the last sample</caption>
            <thead><tr className="border-b border-[#E5E4E0] text-[#7A7D84]"><th className="py-2 pr-4 font-medium">Component</th><th className="py-2 pr-4 font-medium">Recorded state</th><th className="py-2 font-medium">Pending</th></tr></thead>
            <tbody>{Object.entries(names).map(([key, name]) => {
              const item = record(components[key]);
              const state = typeof item.state === 'string' ? label(item.state) : item.enabled === true ? 'Enabled' : item.enabled === false ? 'Disabled' : Object.keys(item).length ? 'Installed' : 'Unavailable';
              return <tr key={key} className="border-b border-[#F0EFEC] last:border-0"><th className="py-2 pr-4 font-medium">{name}</th><td className="py-2 pr-4">{state}</td><td className="py-2 tabular-nums">{number(item.pending)}{item.pending_is_lower_bound === true ? '+' : ''}</td></tr>;
            })}</tbody>
          </table>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left"><caption className="mb-2 text-left font-semibold">Provider capacity and budget</caption>
            <thead><tr className="border-b border-[#E5E4E0] text-[#7A7D84]"><th className="py-2 pr-4 font-medium">Service</th><th className="py-2 pr-4 font-medium">Observed limit</th><th className="py-2 pr-4 font-medium">Reserved peak</th><th className="py-2 font-medium">Approved monthly budget</th></tr></thead>
            <tbody>{providers.map((item, index) => <tr key={typeof item.provider === 'string' ? item.provider : index} className="border-b border-[#F0EFEC] last:border-0">
              <th className="py-2 pr-4 font-medium capitalize">{label(item.provider)}<span className="block text-[10.5px] font-normal normal-case text-[#7A7D84]">{label(item.unit)}</span></th>
              <td className="py-2 pr-4 tabular-nums">{number(item.observed_limit)}</td>
              <td className="py-2 pr-4 tabular-nums">{item.reservation_current === true ? number(item.reserved_peak) : 'Unconfirmed or expired'}</td>
              <td className="py-2 tabular-nums">{item.budget_approved === true ? `$${number(item.monthly_budget_usd)}` : 'Unconfirmed'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {alerts.length > 0 && <ul className="mt-4 space-y-1 text-[#B03A3A]">{alerts.map((item, index) => <li key={typeof item.key === 'string' ? item.key : index}>{label(item.severity)}: {label(item.key)} ({number(item.value)})</li>)}</ul>}
        <p className="mt-4 text-[#7A7D84]">These observations describe the running system. Supported daily-user capacity requires a measured load result and current provider reservations.</p>
      </>}
    </div>
  </section>;
}
