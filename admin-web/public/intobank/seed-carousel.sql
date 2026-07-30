do $$
declare
  v_biz  uuid;
  v_post uuid;
  v_handle text := 'intobank';   -- <= change this if IntoBank's @ is different
begin
  select id into v_biz from profiles
   where lower(username) = lower(v_handle) and account_type = 'business' limit 1;
  if v_biz is null then
    raise exception 'No business account with the handle %. Check the Businesses desk and edit v_handle above.', v_handle;
  end if;

  insert into posts (user_id, body)
  values (v_biz, 'Kit out your counter. POS terminals, ATMs, self service kiosks and branded gear, shipping across Zimbabwe. Swipe through the range.')
  returning id into v_post;

  insert into post_products (post_id, sort_order, title, subtitle, price, currency, image_url, link_url, cta_label)
  select v_post, x.ord, x.title, x.subtitle, x.price, 'USD',
         'https://platinum-admin.vercel.app/intobank/products/' || x.slug || '.png',
         'https://platinum-admin.vercel.app/intobank/?p=' || x.slug,
         'Shop'
  from (values
    ('polo-white', 'IntoBank Polo, White', 'Cotton pique, embroidered mark', 28, 1),
    ('polo-green', 'IntoBank Polo, Forest Green', 'Cotton pique, embroidered mark', 28, 2),
    ('tee-white', 'IntoBank Tee, White', 'Heavyweight cotton, screen print', 18, 3),
    ('tee-green', 'IntoBank Tee, Green', 'Heavyweight cotton, screen print', 18, 4),
    ('hoodie-white', 'IntoBank Hoodie, White', 'Brushed fleece, kangaroo pocket', 45, 5),
    ('hoodie-green', 'IntoBank Hoodie, Green', 'Brushed fleece, kangaroo pocket', 45, 6),
    ('cap-green', 'IntoBank Cap, Green', 'Six panel, adjustable strap', 15, 7),
    ('cap-white', 'IntoBank Cap, White', 'Six panel, adjustable strap', 15, 8),
    ('bucket-green', 'IntoBank Bucket Hat', 'Washed twill, all season', 20, 9),
    ('pos-c1', 'IntoBank Pay C1 Countertop POS', 'Card, tap and PIN at the till', 249, 10),
    ('pos-m2', 'IntoBank Pay M2 Handheld POS', 'Portable terminal, all day battery', 189, 11),
    ('pos-s3', 'IntoBank Pay S3 Smart POS', 'Touchscreen terminal with receipts', 329, 12),
    ('tap-mini', 'IntoBank Tap Mini Reader', 'Pocket reader, pairs to any phone', 59, 13),
    ('atm-lobby', 'IntoBank ATM, Lobby Unit', 'Free standing cash dispenser', 12500, 14),
    ('atm-wall', 'IntoBank ATM, Through the Wall', 'Weather sealed street fascia', 14900, 15),
    ('kiosk-pay', 'Self Service Payment Kiosk', 'Bills, airtime and transfers', 4800, 16),
    ('kiosk-open', 'Self Service Account Kiosk', 'Open an account in branch', 5400, 17),
    ('cdm-1', 'Cash Deposit Machine CDM 1', 'Note counting and instant credit', 9900, 18),
    ('queue-1', 'Queue Ticket Dispenser', 'Branch flow with live now serving', 1250, 19),
    ('printer-1', 'Thermal Receipt Printer', 'Fast, quiet, pairs with any POS', 95, 20)
  ) as x(slug, title, subtitle, price, ord);

  insert into promoted_posts (post_id, advertiser_id, label, status, starts_at, ends_at, total_cap)
  values (v_post, v_biz, 'Sponsored', 'active', now(), now() + interval '90 days', 1000000);

  raise notice 'Seeded carousel post %', v_post;
end $$;
