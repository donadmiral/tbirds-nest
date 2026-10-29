-- Read-only production preflight. Expected: ten exact reviewed pairs, five posts and five stories.
-- Any other result blocks promotion and requires re-review, never a broad fallback.
WITH published_references AS (
  SELECT 'post'::text AS kind, p.id, p.user_id AS author, p.created_at,
    p.audience::text AS audience, u.url
  FROM public.posts p
  CROSS JOIN LATERAL (VALUES (p.media_url), (p.image_url)) u(url)
  UNION ALL
  SELECT 'post', p.id, p.user_id, p.created_at, p.audience::text, m.url
  FROM public.posts p JOIN public.post_media m ON m.post_id = p.id
  UNION ALL
  SELECT 'story', s.id, s.user_id, s.created_at, s.audience::text, u.url
  FROM public.stories s
  CROSS JOIN LATERAL (VALUES (s.media_url), (s.thumbnail_url), (s.dual_front_url)) u(url)
), paths AS (
  SELECT DISTINCT *, regexp_match(url,
    '^https://prlkikhckbifseosbukl[.]supabase[.]co/storage/v1/object/public/(post-media|story-media|media)/([^?#]+)$') AS path
  FROM published_references WHERE url IS NOT NULL
), candidates AS (
  SELECT p.*, o.id AS object_id, o.version
  FROM paths p
  JOIN storage.objects o ON o.bucket_id = p.path[1] AND o.name = p.path[2]
  JOIN storage.buckets b ON b.id = o.bucket_id
  WHERE p.audience = 'everyone' AND b.public
    AND coalesce(o.owner_id, o.owner::text) IS NULL
    AND o.version IS NOT NULL
    AND split_part(p.path[2], '/', 1) = p.author::text
    AND p.path[2] !~ '(%|\\|(^|/)\.\.?(/|$)|//)'
)
SELECT count(*)::integer AS reviewed_pairs,
  count(*) FILTER (WHERE kind = 'post')::integer AS posts,
  count(*) FILTER (WHERE kind = 'story')::integer AS stories
FROM candidates
WHERE encode(extensions.digest(concat_ws(chr(31), kind, id::text, author::text,
  object_id::text, path[1], path[2], url, version), 'sha256'), 'hex') = ANY (ARRAY[
  '3a62fdb825d6679d1a0c4dbcc75d538a0da03391259a711fc4709dd3c07b048b',
  '53567b20bdb034ab0f2410c9e14c0b8d5b8233f7b229f41358aba567c9a7bac9',
  '55a98e4f44ede0a5575381ee23b05a5d4244cb40c537b8a4a36b06165b2a17f9',
  '5da8ef1758e4fd892b7a162138a14ecf5dbf35bb5e037daa6a8fc696244a1780',
  'bf6d85b03d4aaf602225ea2070d92b63d7a453d8fefcc8a8a1167b2e32392f5f',
  '0d5b106fb8b0e36361194776d71f3f0c80bb601bb7987ce12a01d38d784c538f',
  '3f41e6a4e03b5fcac2db2f7d614b66de9e97280360079884e7a5a646e8f2e41c',
  '60a512419f2138c4bf6e59c01252e46f12f9675e26a3737dd6d1f45b36f03f31',
  '6dea47a5f3c32ce4fd42e01e6a1e1f4d2ccdca0c4eb734ddc7d0b6523c3008b1',
  '779bd5ac48ff9c5b51bbc6fd7dfcf23200a82e306d6ec9c2a85a763448beae5f'
]);
