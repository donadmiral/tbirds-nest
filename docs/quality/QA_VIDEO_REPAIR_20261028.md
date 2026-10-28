# QA video fixture repair — 28 October 2026

Status: prepared, not applied. No files uploaded or database rows changed by the repair agent.

## Diagnosis and boundary

The two synthetic fixture files live behind Vercel deployment authentication. The root agent confirmed that an ordinary HTTPS request receives HTML sign-in content while its authenticated browser can play the 12-second fixture. This explains why the old QA videos fail in a phone session even though the user's own upload works.

The separate Supabase Storage dashboard tab redirected to sign-in. Its observed URL was `https://supabase.com/dashboard/sign-in?returnTo=%2Fproject%2Fuaulhuelcfkjwojtymmw%2Fstorage%2Ffiles`. No sign-in method was selected and no credential request was made. The root agent is checking whether its existing dashboard session can complete the authorized upload.

Scope is only project `uaulhuelcfkjwojtymmw`, synthetic post `5e19ecba-5ec9-4ad4-96fb-096f178789fd`, author `b946f2c6-ead9-4e1a-a10a-37e0b12aafa3`. Never modify the user's uploaded post `f9f2ac4d-fe23-4834-bab9-d741184d5a6c`.

The existing `post-media` bucket is **private**, allows `video/mp4`, and has a 104,857,600-byte size limit. Keep it private. The canonical `/object/public/` locator stored by current app publishing code is transformed to a signed capability by the content-media service; it does not change the bucket's access settings.

## Exact local assets and proposed object paths

| Asset | Bytes | SHA-256 | New object path inside `post-media` |
| --- | ---: | --- | --- |
| `web/public/qa/video-landscape.mp4` | 506091 | `ed599b38361d5e0bf0e37b4609fe8a0b8f3615064391b4f48e0480a3fa6e101b` | `b946f2c6-ead9-4e1a-a10a-37e0b12aafa3/qa-video-repair-20261028/video-landscape.mp4` |
| `web/public/qa/video-portrait.mp4` | 512671 | `8a3ad9b10f015052d5b562a8d0c9688eaa3a05618540d2c233ddab2efebc16f0` | `b946f2c6-ead9-4e1a-a10a-37e0b12aafa3/qa-video-repair-20261028/video-portrait.mp4` |

Main workspace prefix: `/workspace/scratch/a7242d38aa52/platinum-current/`.
Cloud file chooser prefix for the same files: `/home/oai/share/a7242d38aa52/platinum-current/`.

Upload through normal authenticated Storage UI/API, with MIME `video/mp4`, into these exact paths. Do not insert Storage object rows using SQL, retrieve service credentials, expose the bucket, or update the media references before the uploads succeed.

## Observed existing rows

- Landscape `post_media.id`: `a8ed59ab-048e-4f2d-ab07-3155d7d25eb6`; 640 × 360; sort order 0.
- Portrait `post_media.id`: `936bc310-df2b-44a4-b0a6-114d22587110`; 360 × 640; sort order 1.
- Existing source origin: `https://platinum-web-git-codex-platinum-quality-20261017-intobank.vercel.app`.
- Existing landscape path: `/qa/video-landscape.mp4`.
- Existing portrait path: `/qa/video-portrait.mp4`.
- The synthetic parent post's `media_url` also equals the landscape URL; `image_url` is null. Update this exact fallback alongside the two gallery rows.

## Preflight after successful uploads

```sql
select id, bucket_id, name, metadata->>'size' as bytes,
       metadata->>'mimetype' as content_type
from storage.objects
where bucket_id='post-media' and name in (
 'b946f2c6-ead9-4e1a-a10a-37e0b12aafa3/qa-video-repair-20261028/video-landscape.mp4',
 'b946f2c6-ead9-4e1a-a10a-37e0b12aafa3/qa-video-repair-20261028/video-portrait.mp4'
);
```

Both objects must exist. Verify reported sizes and `video/mp4` before applying the update.

## Exact scoped update — not yet executed

Run only after normal Storage uploads and their preflight succeed. This aborts if any original reference changed, so it cannot silently overwrite a newer edit.

```sql
begin;
do $repair$
declare
  v_post constant uuid := '5e19ecba-5ec9-4ad4-96fb-096f178789fd';
  v_author constant uuid := 'b946f2c6-ead9-4e1a-a10a-37e0b12aafa3';
  v_old constant text := 'https://platinum-web-git-codex-platinum-quality-20261017-intobank.vercel.app/qa/';
  v_new constant text := 'https://uaulhuelcfkjwojtymmw.supabase.co/storage/v1/object/public/post-media/b946f2c6-ead9-4e1a-a10a-37e0b12aafa3/qa-video-repair-20261028/';
  v_count integer;
begin
  select count(*) into v_count from storage.objects
   where bucket_id='post-media' and (
    (name='b946f2c6-ead9-4e1a-a10a-37e0b12aafa3/qa-video-repair-20261028/video-landscape.mp4' and metadata->>'size'='506091' and metadata->>'mimetype'='video/mp4') or
    (name='b946f2c6-ead9-4e1a-a10a-37e0b12aafa3/qa-video-repair-20261028/video-portrait.mp4' and metadata->>'size'='512671' and metadata->>'mimetype'='video/mp4')
   );
  if v_count<>2 then raise exception 'Both verified Storage uploads are required'; end if;

  update public.post_media m set url=v_new||'video-landscape.mp4'
   where m.id='a8ed59ab-048e-4f2d-ab07-3155d7d25eb6' and m.post_id=v_post
     and m.url=v_old||'video-landscape.mp4'
     and exists(select 1 from public.posts p where p.id=m.post_id and p.user_id=v_author);
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Landscape fixture changed; nothing committed'; end if;

  update public.post_media m set url=v_new||'video-portrait.mp4'
   where m.id='936bc310-df2b-44a4-b0a6-114d22587110' and m.post_id=v_post
     and m.url=v_old||'video-portrait.mp4'
     and exists(select 1 from public.posts p where p.id=m.post_id and p.user_id=v_author);
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Portrait fixture changed; nothing committed'; end if;

  update public.posts set media_url=v_new||'video-landscape.mp4'
   where id=v_post and user_id=v_author and media_url=v_old||'video-landscape.mp4';
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Parent fixture fallback changed; nothing committed'; end if;
end;
$repair$;
commit;
```

## Postflight

```sql
select m.id,m.post_id,m.url,m.media_type,m.width,m.height,m.sort_order
from public.post_media m join public.posts p on p.id=m.post_id
where p.id='5e19ecba-5ec9-4ad4-96fb-096f178789fd'
 and p.user_id='b946f2c6-ead9-4e1a-a10a-37e0b12aafa3'
order by m.sort_order;

select entity_kind,entity_id,bucket_id,object_path,uploader_id
from public.content_media_bindings
where entity_kind='post' and entity_id='5e19ecba-5ec9-4ad4-96fb-096f178789fd';
```

The existing media-binding triggers should register both owner paths. Then reload that synthetic post in the authenticated QA app, confirm a signed Storage source for each video, and verify both play/seek and complete their 12-second timeline. Do not print signed capability URLs into the repair note.
