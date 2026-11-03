import { requireDesk } from '@/lib/adminAuth';
import Shell from '@/components/Shell';
import LiveWorkspace from '@/components/LiveWorkspace';
export const dynamic='force-dynamic';
export default async function LivePage(){
  const admin=await requireDesk('/live');
  return <Shell admin={admin} active="/live" title="Live operations" sub="Review broadcasts, clips, production access and moderation decisions."><LiveWorkspace/></Shell>;
}
