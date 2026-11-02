import {createRoot} from 'react-dom/client';
import {MemoryAlbumView} from '../../components/MemoryAlbum';
import {MemoryAlbumBook} from '../../components/MemoryAlbumBook';
import {BOOK,OWNER,pagingFixture} from './memory-paging-adapter';
Object.assign(window,{pagingFixture});
const shelf=new URLSearchParams(location.search).get('mode')==='shelf';
createRoot(document.getElementById('root')!).render(<main style={{padding:24,maxWidth:900,margin:'auto'}}>
 <h1>Local synthetic paged memory verification</h1>{shelf?<MemoryAlbumBook profileId={OWNER}/>:<MemoryAlbumView ownerId={BOOK}/>}</main>);
