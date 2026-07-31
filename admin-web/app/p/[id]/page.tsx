import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';

// Public face of a post: what WhatsApp, iMessage and the open web see
// when someone shares out of the app. Server-rendered, service-backed,
// read-only.

const svc = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function loadPost(id: string) {
  const s = svc();
  const { data: post } = await s.from('posts').select('id, content, user_id, created_at, likes_count, comments_count, shares_count').eq('id', id).maybeSingle();
  if (!post) return null;
  const { data: author } = await s.from('profiles').select('full_name, username, avatar_url, is_verified').eq('id', post.user_id).maybeSingle();
  const { data: media } = await s.from('post_media').select('url, media_type').eq('post_id', id).order('sort_order').limit(1);
  return { post, author, media: media && media.length ? media[0] : null };
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const d = await loadPost(params.id);
  if (!d) return { title: 'Platinum Circles' };
  const name = d.author?.full_name || ('@' + (d.author?.username || 'member'));
  const desc = (d.post.content || 'A post on Platinum Circles').slice(0, 160);
  return {
    title: name + ' on Platinum Circles',
    description: desc,
    openGraph: {
      title: name + ' on Platinum Circles',
      description: desc,
      images: d.media && d.media.media_type === 'image' ? [{ url: d.media.url }] : [{ url: 'https://platinum-admin.vercel.app/brand/pc-icon.png' }],
    },
  };
}

export default async function PublicPost({ params }: { params: { id: string } }) {
  const d = await loadPost(params.id);
  if (!d) notFound();
  const name = d!.author?.full_name || ('@' + (d!.author?.username || 'member'));
  return (
    <main style={{ minHeight: '100vh', background: '#0B1E3D', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '-apple-system, Segoe UI, Helvetica, Arial, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <img src="/brand/pc-icon.png" width={56} height={56} alt="Platinum Circles" style={{ borderRadius: 14 }} />
        </div>
        <div style={{ background: '#FFFFFF', borderRadius: 16, padding: 24 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#B08D3F', textTransform: 'uppercase' }}>Platinum Circles</p>
          <h1 style={{ margin: '6px 0 2px', fontSize: 18, color: '#0B1E3D' }}>{name}</h1>
          {d!.post.content ? <p style={{ margin: '10px 0 0', fontSize: 14.5, lineHeight: 1.6, color: '#26282E', whiteSpace: 'pre-wrap' }}>{d!.post.content}</p> : null}
          {d!.media && d!.media.media_type === 'image' ? (
            <img src={d!.media.url} alt="" style={{ width: '100%', borderRadius: 12, marginTop: 14 }} />
          ) : null}
          <p style={{ margin: '14px 0 0', fontSize: 12, color: '#9A9DA4' }}>{(d!.post.likes_count || 0)} likes &middot; {(d!.post.comments_count || 0)} comments &middot; {(d!.post.shares_count || 0)} shares</p>
          <a href={'platinum-circles://post/' + d!.post.id} style={{ display: 'block', textAlign: 'center', marginTop: 18, background: '#0B1E3D', color: '#FFFFFF', textDecoration: 'none', fontSize: 14, fontWeight: 700, padding: '13px 0', borderRadius: 12 }}>Open in the app</a>
          <p style={{ margin: '10px 0 0', textAlign: 'center', fontSize: 11.5, color: '#9A9DA4' }}>Zimbabwe&apos;s professional network</p>
        </div>
      </div>
    </main>
  );
}