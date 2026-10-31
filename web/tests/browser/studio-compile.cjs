const path = require('node:path');
const { compile } = require('./ui-compile.cjs');
const backend = path.join(__dirname, 'studio-backend.ts');
const media = path.join(__dirname, 'studio-media.ts');
compile({
  entry: path.join(__dirname, 'studio-fixture.tsx'),
  output: process.env.PLATINUM_STUDIO_UI_OUTPUT || '/tmp/platinum-studio-browser',
  title: 'Platinum Circles Studio – synthetic verification',
  aliases: { '@/lib/supabase/client': backend, './supabase/client': backend, '@/lib/useUploadPreview': media, '@/lib/contentMedia': media, '@/lib/monetization': path.join(__dirname, 'studio-finance.ts') },
}).then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error); process.exitCode = 1; });
