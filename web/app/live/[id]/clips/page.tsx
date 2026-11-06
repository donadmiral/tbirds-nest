import { LiveClipEditor } from '@/components/LiveClipEditor';
export const metadata={title:'Create a live clip'};
export default async function LiveClipPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <LiveClipEditor sessionId={id}/>;}
