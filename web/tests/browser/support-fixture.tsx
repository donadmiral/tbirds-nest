import { createRoot } from 'react-dom/client';
import SupportPage from '../../app/settings/support/page';
import TicketPage from '../../app/settings/support/[id]/page';
import { usePathname } from './ui-router-adapter';
function Audit() {
  const path = usePathname();
  return <main><p data-audit-label>Actual member support pages · synthetic transport</p>{path === '/settings/support' ? <SupportPage /> : <TicketPage />}</main>;
}
createRoot(document.getElementById('root')!).render(<Audit />);
