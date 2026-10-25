export type NotificationDestination = {
  type: string;
  data: Record<string, unknown> | null;
  post_id?: string | null;
  actor_username?: string | null;
};

export function notificationValue(notification: NotificationDestination, key: string): string | null {
  const value = notification.data?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function conversationHref(id: string, context: string | null) {
  const base = context === "market" ? "/market/messages" : context === "jobs" ? "/jobs/messages" : "/messages";
  return base + "?c=" + encodeURIComponent(id);
}

export function notificationHref(notification: NotificationDestination): string {
  const value = (key: string) => notificationValue(notification, key);
  if (notification.type === "market_order") {
    const listing = value("listing_id");
    return listing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listing) ? "/market/" + listing : "/notifications";
  }
  const conversation = value("conversation_id");
  if (conversation) return conversationHref(conversation, value("context"));
  const post = notification.post_id || value("post_id");
  if (post) return "/post/" + encodeURIComponent(post);
  const job = value("job_id");
  if (notification.type === "job_interview" || (notification.type === "job_status" && value("status") !== "withdrawn")) return "/jobs/applications";
  if (job && notification.type === "job_status" && value("status") === "withdrawn") return "/jobs/" + encodeURIComponent(job) + "/applicants";
  if (job) return "/jobs/" + encodeURIComponent(job) + (notification.type === "job_application" ? "/applicants" : "");
  const listing = value("listing_id");
  if (listing) return "/market/" + encodeURIComponent(listing);
  const community = value("community_id");
  if (community) return "/communities/" + encodeURIComponent(community);
  const channel = value("channel_id");
  if (channel && notification.type.startsWith("channel_")) return "/channels/" + encodeURIComponent(channel);
  if (notification.type === "business_member" || notification.type.startsWith("org_")) return "/businesses";
  if (notification.actor_username) return "/" + encodeURIComponent(notification.actor_username);
  return "/notifications";
}
