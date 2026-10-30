/** Synthetic adapter for browser verification only. Never imported by an app route. */
const BUSINESS = "10000000-0000-4000-8000-000000000001", CREATOR = "10000000-0000-4000-8000-000000000002";
const MEMBER = "10000000-0000-4000-8000-000000000003", EDITOR = "10000000-0000-4000-8000-000000000004";
const POST = "20000000-0000-4000-8000-000000000001", ASSIGNMENT = "30000000-0000-4000-8000-000000000001", PARTNERSHIP = "40000000-0000-4000-8000-000000000001";
const now = () => new Date().toISOString();
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const graphic = (title: string, color: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#0e203a"/><stop offset="1" stop-color="${color}"/></linearGradient></defs><path fill="url(#a)" d="M0 0h960v540H0z"/><circle cx="780" cy="100" r="260" fill="#ffffff0b"/><path fill="none" stroke="#d5b47b" stroke-width="3" d="M70 405h820M70 420h820M70 435h820"/><text x="70" y="90" fill="#d5b47b" font-size="22" font-family="Arial" letter-spacing="5">PLATINUM CIRCLES / QA CREATIVE</text><text x="70" y="265" fill="#fff" font-size="55" font-weight="700" font-family="Arial">${title}</text><text x="70" y="315" fill="#d1dce9" font-size="24" font-family="Arial">Synthetic content for interface verification</text></svg>`);
const makePost = (id: string, content: string, status: string) => ({ id, content, body: null, status, publish_at: status === "scheduled" ? future(3) : null, category: "sports", community_id: null, media: [{ url: graphic(content.slice(0, 24), "#344d6d"), media_type: "image" }], products: [], published_post_id: null, error: status === "failed" ? "Upload interrupted. Review the draft and retry." : null, created_at: now(), updated_at: now() });
const initial = () => ({
  actor: "business", role: "owner", requests: [] as { name: string; args: any }[], receipts: {} as Record<string, any>,
  posts: [makePost(POST, "Halftime highlights", "draft"), makePost("20000000-0000-4000-8000-000000000002", "Training day recap", "failed"), makePost("20000000-0000-4000-8000-000000000003", "Matchday announcement", "scheduled")],
  newsroom: [{ id: ASSIGNMENT, owner_id: BUSINESS, title: "Halftime highlights", brief: "A concise recap of the biggest moments. Check the opening caption and sponsor disclosure before scheduling.", assignee_id: EDITOR, scheduled_post_id: POST, rights_owner: "Atlas Football", territory: "United States", rights_verified: true, rights_expires_at: future(15), embargo_at: future(1), publish_at: future(2), sponsor: "", paid_partnership: false, state: "in_review", version: 1, created_at: now(), updated_at: now(), review_note: "", submitted_at: now(), approved_at: null, post_status: "draft", published_post_id: null, post_error: null, events: [{ id: "event-1", action: "submitted", note: "Caption and rights checked by the editor.", at: now() }] } as any],
  partnerships: [{ id: PARTNERSHIP, owner_id: BUSINESS, owner_name: "Atlas Football", creator_id: CREATOR, creator_name: "Maya Ndlovu", creator_username: "mayan", title: "Matchday stories with Maya", brief: "Document the people and atmosphere behind matchday, with a warm and personal perspective.", deliverables: "One short-form post and an accompanying caption. One review round before approval.", disclosure: "Clearly identify the paid partnership with Atlas Football in the opening caption.", due_at: future(7), fee_minor: 125000, currency: "USD", state: "submitted", version: 1, deliverable_version: 1, review_note: "", created_at: now(), updated_at: now(), publishing_granted: false, paid_promotion_granted: false, publishing_expires_at: null, paid_promotion_expires_at: null, versions: [{ version: 1, content: "Paid partnership with Atlas Football. The faces, the stories and the moments that make matchday matter.", post_id: POST, submitted_at: now() }], events: [{ id: "partnership-event-1", action: "deliverable_submitted", note: "Version one is ready for review.", at: now() }] } as any],
  campaigns: [{ id: "campaign-1", name: "Season passes", objective: "traffic", budget: 2000, currency: "USD", payment_method: "intobank", payment_ref: null, paid_amount: 1500, starts_at: null, ends_at: future(14), status: "live", review_note: null, created_at: now(), impressions: 12500, clicks: 210, ads: [{ id: "ad-1", post_id: POST, label: "Sponsored", status: "active", total_cap: 25000, impressions: 12500, clicks: 210, starts_at: null, ends_at: null, content: "A stronger tomorrow together.", thumb: graphic("Season passes", "#705c37"), products: 0 }] }, { id: "campaign-2", name: "Weekend highlights", objective: "reach", budget: 500, currency: "USD", payment_method: "", payment_ref: null, paid_amount: 0, starts_at: null, ends_at: null, status: "draft", review_note: null, created_at: now(), impressions: 0, clicks: 0, ads: [] }] as any[],
});
let state: ReturnType<typeof initial>;
try { state = JSON.parse(sessionStorage.getItem("pc-studio-fixture-state") || "null") || initial(); } catch { state = initial(); }
const persist = () => sessionStorage.setItem("pc-studio-fixture-state", JSON.stringify(state));
const failures = new Map<string, { code?: string; message: string }>();
const ambiguous = new Set<string>();
const listeners = new Set<(event: string, session: any) => void>();
const uid = () => state.actor === "creator" ? CREATOR : BUSINESS;
const session = () => ({ user: { id: uid() }, access_token: "synthetic-session" });
const reviewRole = () => ["owner", "admin"].includes(state.role);
const newsroomRow = (row: any, detail = false) => ({ ...row,
  can_edit: ["draft", "changes_requested"].includes(row.state), can_submit: ["draft", "changes_requested"].includes(row.state),
  can_review: reviewRole() && row.state === "in_review", can_schedule: row.state === "approved", can_cancel: row.state !== "cancelled", can_withdraw: state.role === "editor" && row.state === "in_review", can_change_post: !row.submitted_at,
  ...(detail ? { post: state.posts.find(post => post.id === row.scheduled_post_id) || null } : {}),
});
const partnershipRow = (row: any) => ({ ...row, source_unchanged: row.source_unchanged !== false, publishing_permission_recorded: Boolean(row.publishing_granted), paid_promotion_permission_recorded: Boolean(row.paid_promotion_granted), publishing_granted: Boolean(row.publishing_granted) && row.source_unchanged !== false, paid_promotion_granted: Boolean(row.paid_promotion_granted) && row.source_unchanged !== false, is_creator: state.actor === "creator", can_edit: state.actor !== "creator" && row.state === "draft", can_propose: state.actor !== "creator" && reviewRole() && row.state === "draft", can_review: state.actor !== "creator" && reviewRole() && row.state === "submitted", can_deliver: state.actor === "creator" && (["accepted", "changes_requested"].includes(row.state) || (row.source_unchanged === false && ["submitted", "approved"].includes(row.state))), can_accept: state.actor === "creator" && row.state === "proposed", can_cancel: state.actor !== "creator" && reviewRole() && !["closed", "cancelled", "declined"].includes(row.state), can_withdraw: state.actor === "creator" && ["accepted", "submitted", "changes_requested", "approved"].includes(row.state), can_close: state.actor !== "creator" && reviewRole() && row.state === "approved", can_grant_permission: state.actor === "creator" && row.state === "approved" && row.source_unchanged !== false });
const home = () => ({ todos: { unanswered: 3, offers: 0, applicants: 8, ads_ending: 1, reviews: 4, scheduled_today: 2, failed_posts: 1 }, now: { posts: 12, likes: 1420, comments: 240, reposts: 112, views: 31200, followers: 123, messages: 23, ad_impressions: 12500, ad_clicks: 210 }, prev: { posts: 8, likes: 1200, comments: 180, reposts: 89, views: 25200, followers: 96, messages: 18, ad_impressions: 10200, ad_clicks: 185 }, payments: [], recent: [], best_hours: [] });
const ok = (data: any) => ({ data: structuredClone(data), error: null });
const fail = (message: string) => ({ data: null, error: { message } });
async function rpc(name: string, args: any = {}): Promise<any> {
  state.requests.push({ name, args: structuredClone(args) }); persist();
  const failure = failures.get(name);
  if (failure) { failures.delete(name); return { data: null, error: failure }; }
  if (args.p_expected_user && args.p_expected_user !== uid()) return fail("WORKFLOW_ACTIVE_SESSION_REQUIRED");
  if (args.p_request_key && state.receipts[args.p_request_key]) {
    const receipt = state.receipts[args.p_request_key];
    return ok(name.startsWith("studio_newsroom_") ? newsroomRow(state.newsroom.find(row => row.id === receipt.id)) : name.startsWith("studio_partnership_") ? partnershipRow(state.partnerships.find(row => row.id === receipt.id)) : receipt);
  }
  if (name === "studio_me") return ok(state.actor === "creator" ? { is_business: false } : { is_business: true, bound: true, needs_code: false, member_id: state.role === "editor" ? EDITOR : MEMBER, role: state.role, display_name: state.role === "editor" ? "Riya Patel" : "Jordan Ellis", business_name: "Atlas Football", username: "atlasfootball", avatar_url: null });
  if (name === "studio_surfaces") return ok([]);
  if (name === "studio_home") return ok(home());
  if (name === "studio_insights") {
    const series = Array.from({ length: 7 }, (_, index) => ({ day: new Date(Date.now() - (7 - index) * 86400000).toISOString().slice(0, 10), impressions: 700 + index * 170, reach: 500 + index * 80, engagements: 40 + index * 10, followers: 1200 + index * 11, messages: 10 + index, posts: 2, market_chats: 2 + index, offers: 1, payments: 0, applications: 1, ad_impressions: 900 + index * 90, ad_clicks: 20 + index * 3 }));
    const current = Object.fromEntries(Object.keys(series[0]).filter(key => key !== "day").map(key => [key, series.reduce((sum, day) => sum + Number((day as any)[key]), 0)]));
    return ok({ days: args.p_days, series, current: { ...current, followers_end: 1266, followers_start: 1200 }, previous: current, top_posts: [{ post_id: POST, content: "Matchday highlights", created_at: now(), likes: 120, comments: 40, reposts: 20, views: 1200, score: 260, thumb: graphic("Matchday highlights", "#375b5c"), products: 0 }], funnel: { commerce: { chats: 12, offers: 5, payments: 0 }, recruiting: { applications: 8, interviews: 3, hired: 1 } } });
  }
  if (name === "studio_list_posts") return ok(state.posts);
  if (name === "get_seller_listings" || name === "get_communities") return ok([]);
  if (name === "studio_campaigns") return ok(state.campaigns);
  if (name === "studio_reviews") return ok({ average: 4.8, count: 12, distribution: { 5: 10, 4: 2 }, reviews: [] });
  if (name === "studio_my_posts_for_ads") return ok([{ id: POST, content: "The weekend starts here.", created_at: now(), thumb: graphic("Weekend highlights", "#375b5c"), products: 0, likes: 42 }]);
  if (name === "studio_newsroom_list") return ok({ items: state.newsroom.map(row => newsroomRow(row)), has_more: false, next_cursor: null, members: [{ id: MEMBER, display_name: "Jordan Ellis", role: "owner" }, { id: EDITOR, display_name: "Riya Patel", role: "editor" }], role: state.role, member_id: MEMBER });
  if (name === "studio_newsroom_get") return ok(newsroomRow(state.newsroom.find(row => row.id === args.p_id), true));
  if (name === "studio_partnerships_list") return ok({ items: state.partnerships.filter(row => state.actor !== "creator" || row.state !== "draft").map(partnershipRow), has_more: false, next_cursor: null, role: state.actor === "creator" ? null : state.role, member_id: state.actor === "creator" ? null : MEMBER });
  if (name === "studio_partnership_get") return ok(partnershipRow(state.partnerships.find(row => row.id === args.p_id)));
  if (name === "creator_monetization_snapshot") return ok({ environment: "test", user_id: uid(), as_of: now(), program: { enrollment_open: false, terms_url: null, terms_version: null }, provider: { id: "intobank", name: "IntoBank", payouts_enabled: false, currencies: ["USD"] }, enrollment: { status: "interested", reason: null }, payout_account: { status: "not_configured", verified_at: null }, balances: [{ currency: "USD", bucket: "available", amount_minor: "12000" }, { currency: "USD", bucket: "pending", amount_minor: "3200" }, { currency: "USD", bucket: "paid", amount_minor: "68000" }], recent_earnings: [{ id: "earning-1", created_at: now(), currency: "USD", amount_minor: "12000", from: "pending", to: "available" }], recent_payouts: [] });
  if (name === "org_tree") return ok([{ id: "org-1", parent_id: null, kind: "business", name: "Atlas Football", slug: "atlasfootball", profile_id: BUSINESS, depth: 0 }]);
  if (name === "studio_get_business") return ok({ profile: { full_name: "Atlas Football", username: "atlasfootball", bio: "The plays. The people. The game.", avatar_url: null, is_verified: true }, business: { category: "Media", hours: { mon: [["09:00", "17:00"]] }, location: "Denver", website: "https://example.test" }, members: state.role === "unconfigured" ? [] : [{ id: MEMBER, display_name: "Jordan Ellis", role: "owner", active: true, last_sign_in_at: now(), created_at: now() }], devices: [], signins: [], role: "owner" });
  if (name === "studio_create_member") return ok("SYNTHETIC-CODE");
  if (name === "studio_save_post_once" || name === "studio_save_post") {
    const id = args.p_id || crypto.randomUUID();
    const row = { ...makePost(id, args.p_content, args.p_publish_at ? "scheduled" : "draft"), body: args.p_body, media: args.p_media, products: args.p_products, publish_at: args.p_publish_at, category: args.p_category, community_id: args.p_community };
    state.posts = [row, ...state.posts.filter(post => post.id !== id)];
    if (args.p_request_key) state.receipts[args.p_request_key] = id;
    persist(); return ok(id);
  }
  if (name === "studio_save_campaign") { const id = args.p_id || crypto.randomUUID(); const old = state.campaigns.find(row => row.id === id); const row = { ...state.campaigns[1], ...old, id, name: args.p_name, objective: args.p_objective, currency: args.p_currency, budget: args.p_budget, payment_method: args.p_payment_method, starts_at: args.p_starts_at, ends_at: args.p_ends_at, status: old?.status || "draft", ads: old?.ads || [] }; state.campaigns = [row, ...state.campaigns.filter(item => item.id !== id)]; persist(); return ok(id); }
  if (name === "studio_set_campaign_status") { state.campaigns.find(row => row.id === args.p_id).status = args.p_status; persist(); return ok(null); }
  if (name === "studio_add_ad") { state.campaigns.find(row => row.id === args.p_campaign).ads.push({ ...state.campaigns[0].ads[0], id: crypto.randomUUID(), post_id: args.p_post_id, impressions: 0, clicks: 0, label: args.p_label, total_cap: args.p_total_cap }); persist(); return ok(null); }
  if (name === "studio_submit_campaign") { const campaign = state.campaigns.find(row => row.id === args.p_id); if (!campaign?.ads.length) return fail("Add creative before submission."); campaign.status = "submitted"; persist(); return ok(null); }
  if (name.startsWith("studio_newsroom_") || name.startsWith("studio_partnership_")) {
    const newsroom = name.startsWith("studio_newsroom_"); const collection = newsroom ? state.newsroom : state.partnerships;
    let row = collection.find(item => item.id === args.p_id);
    if (row && row.version !== args.p_version) return fail("WORKFLOW_VERSION_CHANGED");
    if (name.endsWith("_save")) {
      row = { ...(row || (newsroom ? state.newsroom[0] : state.partnerships[0])), ...args.p_input, id: args.p_id || crypto.randomUUID(), state: "draft", version: (row?.version || 0) + 1, updated_at: now(), events: row?.events || [], ...(newsroom ? {} : { versions: [], deliverable_version: 0, creator_username: args.p_input.creator_username }) };
      if (newsroom) state.newsroom = [row, ...state.newsroom.filter(item => item.id !== row.id)]; else state.partnerships = [row, ...state.partnerships.filter(item => item.id !== row.id)];
    } else if (name.endsWith("_transition")) {
      const mapping: Record<string, string> = { submit: "in_review", withdraw: newsroom ? "draft" : "cancelled", approve: "approved", request_changes: "changes_requested", schedule: "scheduled", cancel: "cancelled", propose: "proposed", accept: "accepted", decline: "declined", close: "closed" };
      row.state = mapping[args.p_action]; row.version++; row.review_note = args.p_note; row.updated_at = now();
      if (newsroom && args.p_action === "schedule") { const post = state.posts.find(post => post.id === row.scheduled_post_id); if (post) { post.status = "scheduled"; post.publish_at = row.publish_at; } row.post_status = "scheduled"; }
      row.publishing_granted = false; row.paid_promotion_granted = false;
      row.events.unshift({ id: crypto.randomUUID(), action: args.p_action, note: args.p_note, at: now() });
    } else if (name.endsWith("_permission")) { row[args.p_permission + "_granted"] = args.p_granted; row[args.p_permission + "_expires_at"] = args.p_expires_at; row.version++; }
    else if (name.endsWith("_deliver")) { row.deliverable_version++; row.version++; row.state = "submitted"; row.publishing_granted = false; row.paid_promotion_granted = false; row.versions.unshift({ version: row.deliverable_version, content: args.p_content, post_id: args.p_post_id, submitted_at: now() }); }
    if (!row) return fail("WORKFLOW_NOT_FOUND");
    state.receipts[args.p_request_key] = { id: row.id }; persist();
    if (ambiguous.has(name)) { ambiguous.delete(name); return fail("Network response interrupted after submission."); }
    return ok(newsroom ? newsroomRow(row) : partnershipRow(row));
  }
  return fail(`Unconfigured synthetic contract: ${name}`);
}

function from(table: string): any {
  let ids: string[] | null = null;
  const value = () => table === "profiles" ? { id: uid(), full_name: state.actor === "creator" ? "Maya Ndlovu" : "Atlas Football", username: state.actor === "creator" ? "mayan" : "atlasfootball", avatar_url: null, is_verified: true, verified_tier: state.actor === "creator" ? "public_figure" : "business" } : table === "organizations" ? { id: "org-1", kind: "business", name: "Atlas Football", slug: "atlasfootball", profile_id: BUSINESS, parent_id: null } : table === "org_memberships" ? [{ id: MEMBER, user_id: BUSINESS, role: "owner", expires_at: null, created_at: now(), profile: { full_name: "Jordan Ellis", username: "jordan", avatar_url: null } }, { id: EDITOR, user_id: CREATOR, role: "editor", expires_at: null, created_at: now(), profile: { full_name: "Riya Patel", username: "riya", avatar_url: null } }] : [];
  const chain: any = { then: (resolve: any) => Promise.resolve(ok(ids && table === "profiles" ? ids.map(id => ({ ...value(), id })) : value())).then(resolve) };
  for (const method of ["select", "eq", "order", "limit", "or", "update"]) chain[method] = () => chain;
  chain.in = (_key: string, values: string[]) => { ids = values; return chain; };
  chain.maybeSingle = chain.single = async () => ok(value());
  return chain;
}
const client = {
  rpc, from,
  auth: { getSession: async () => ({ data: { session: session() }, error: null }), onAuthStateChange: (callback: any) => { listeners.add(callback); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }; } },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
};
export const createClient = () => client;
export const fixture = {
  requests: () => structuredClone(state.requests),
  failNext: (name: string, message = "Synthetic network unavailable", code?: string) => failures.set(name, { message, code }),
  ambiguousNext: (name: string) => ambiguous.add(name),
  changePartnershipSource: () => { state.partnerships[0].source_unchanged = false; persist(); },
  actor: () => state.actor,
  setActor: (actor: string, role = "owner") => { state.actor = actor; state.role = role; persist(); for (const callback of listeners) callback("SIGNED_IN", session()); },
  reset: () => { state = initial(); persist(); location.reload(); },
  records: () => structuredClone({ newsroom: state.newsroom, partnerships: state.partnerships }),
};
declare global { interface Window { __studioFixture: typeof fixture } }
window.__studioFixture = fixture;
