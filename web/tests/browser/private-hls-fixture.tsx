import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivateMediaViewer } from '../../components/PrivateMediaViewer';
import { ChatVideo } from '../../components/ChatVideo';
import { changeAccount, userId } from './private-hls-adapter';
const ordinaryId = '10000000-0000-4000-8000-000000000001';
const limitedId = '10000000-0000-4000-8000-000000000002';
function App() {
  const [limited, setLimited] = useState(false), [remaining, setRemaining] = useState<number | null>(null);
  (window as any).__privateHlsFixture = {
    account: changeAccount,
    hidden() { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); },
  };
  return <main className="p-6">
    <h1>Private media playback verification</h1>
    <section data-ordinary className="h-64 w-80">
      <ChatVideo messageId={ordinaryId} userId={userId} source="https://private-hls.synthetic.invalid/original.mp4" onError={() => { throw Error('Ordinary playback failed'); }} />
    </section>
    <button onClick={() => setLimited(true)}>Open limited viewer</button>
    <output data-remaining>{remaining === null ? 'Unused' : remaining}</output>
    {limited ? <PrivateMediaViewer messageId={limitedId} userId={userId} onClose={() => setLimited(false)} onConsumed={setRemaining} /> : null}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
