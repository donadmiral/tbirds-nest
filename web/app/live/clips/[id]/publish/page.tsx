import {LiveSocialPublisher} from '@/components/LiveSocialPublisher';
export const metadata={title:'Publish a Live clip',robots:{index:false,follow:false}};
export default async function LiveSocialPublishPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <LiveSocialPublisher clipId={id}/>;}
