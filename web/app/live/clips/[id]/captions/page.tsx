import {LiveCaptionReview} from '@/components/LiveCaptionReview';
export const metadata={title:'Review Live clip captions',robots:{index:false,follow:false}};
export default async function LiveCaptionPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <LiveCaptionReview clipId={id}/>;}
