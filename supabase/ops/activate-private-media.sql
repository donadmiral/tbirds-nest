-- REVIEWED ACTIVATION, not part of the compatibility migration.
-- Run in the same transaction after setting these two review-artifact SHA-256
-- values with set_config(...,true). They record explicit release acceptance;
-- they are not a substitute for the external HTTP and installed-client tests.
-- platinum.private_media_qa_evidence: successful synthetic warm-cache HTTP run
-- platinum.private_media_client_evidence: native/web/admin compatibility review
begin;
set local lock_timeout='3s';
do $$
declare r jsonb;
begin
 if coalesce(current_setting('platinum.private_media_qa_evidence',true),'') !~ '^[0-9a-f]{64}$'
  or coalesce(current_setting('platinum.private_media_client_evidence',true),'') !~ '^[0-9a-f]{64}$'
 then raise exception 'Private media activation requires reviewed QA and client evidence'; end if;
 r:=public.private_media_cutover_readiness();
 if jsonb_array_length(r->'buckets')<>5 or (r->>'missingObjects')::int<>0
  or (r->>'unboundReferences')::int<>0 or (r->>'missingChatObjects')::int<>0
  or (r->>'limitedObjectsWithOrdinaryReferences')::int<>0 or (r->>'legacyRequiresPublicBucket')::boolean
  or (r->>'restrictedPolicyCount')::int<>10
 then raise exception 'Private media preflight has unresolved blockers: %',r; end if;
 update storage.buckets set public=false where id in ('post-media','story-media','media','chat-media','chat-files');
end $$;
commit;
-- Immediately purge every affected bucket's CDN cache through the official
-- Storage API and run the warmed known-URL test. Purge may take up to 60 seconds;
-- browser/device copies already downloaded cannot be remotely recalled.
