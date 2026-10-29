-- Read-only gate before the first production rollout unit. All eight must match.
WITH expected(name, definition_md5) AS (VALUES
  ('get_feed','a5ba28b77f27dad8725fd6b0717106ec'),
  ('get_memory_albums','e8a351ece459652588539597b380d0bf'),
  ('get_memory_book','5a30eab09e21eb149309d9add37e0892'),
  ('guard_payment_receipt_message','e32bb3284b8c967ac7c4db2ae2938cf5'),
  ('post_payment_message','54f28d6cf740467c89ddb58709a6f042'),
  ('preserve_chat_payment_record','1b5d69dee5033327aaca401c6176c5fb'),
  ('start_group_call','875d741877cb5e5521788cb120396103'),
  ('sweep_dead_calls','e964a8734f3f924079b86529d39e8720')
)
SELECT e.name, e.definition_md5 AS expected_md5, md5(pg_get_functiondef(p.oid)) AS actual_md5,
  coalesce(e.definition_md5 = md5(pg_get_functiondef(p.oid)), false) AS matches
FROM expected e LEFT JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace AND p.proname = e.name
ORDER BY e.name;
