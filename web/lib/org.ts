/**
 * Typed helpers over the organization RPCs in migration 152.
 * Every write goes through a security-definer function that checks the
 * caller's role and writes the audit log, so nothing here touches tables.
 */
import { createClient } from "@/lib/supabase/client";

export type OrgRole = "owner" | "admin" | "manager" | "editor" | "publisher" | "community_manager" | "support" | "recruiter" | "ads_manager" | "commerce_manager" | "analyst" | "finance_manager" | "verification_manager" | "viewer" | "member";
export type AccountClass = "personal" | "creator" | "organization" | "automated";
export type OrgSector = "business" | "government" | "nonprofit" | "media" | "school" | "employer" | "political" | "community";
export const ACCOUNT_CLASSES: AccountClass[] = ["personal", "creator", "organization", "automated"];
export const ORG_SECTORS: OrgSector[] = ["business", "government", "nonprofit", "media", "school", "employer", "political", "community"];
/** Permission keys from org_role_permissions; ask for a permission, never compare role strings. */
export type OrgPermission = "org.manage" | "team.manage" | "content.create" | "content.publish" | "content.moderate" | "community.manage" | "support.reply" | "jobs.manage" | "ads.manage" | "commerce.manage" | "analytics.view" | "finance.manage" | "verification.manage" | "settings.view";
export async function hasPermission(orgId: string, permission: OrgPermission): Promise<boolean> {
  const { data, error } = await sb().rpc("org_has_permission", { p_org: orgId, p_permission: permission });
  return !error && data === true;
}
export async function setOrgSector(orgId: string, sector: OrgSector): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb().from("organizations").update({ sector }).eq("id", orgId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
export type Surface = "content" | "insights" | "planner" | "inbox" | "recruiter" | "commerce" | "audience" | "ads" | "reviews" | "settings";
export type OrgNode = { id: string; parent_id: string | null; kind: string; name: string; slug: string | null; profile_id: string | null; depth: number };
export type Actor = { actor_id: string; full_name: string | null; username: string | null; avatar_url: string | null; kind: string; role: string };

export const ORG_ROLES: OrgRole[] = ["owner", "admin", "manager", "editor", "publisher", "community_manager", "support", "recruiter", "ads_manager", "commerce_manager", "analyst", "finance_manager", "verification_manager", "viewer", "member"];
export const SURFACES: Surface[] = ["content", "insights", "planner", "inbox", "recruiter", "commerce", "audience", "ads", "reviews", "settings"];

const sb = () => createClient();

export async function myActors(): Promise<Actor[]> {
  const { data } = await sb().rpc("get_my_actors");
  return (data ?? []) as Actor[];
}

export async function orgTree(rootId: string): Promise<OrgNode[]> {
  const { data } = await sb().rpc("org_tree", { p_root: rootId });
  return (data ?? []) as OrgNode[];
}

export async function studioSurfaces(): Promise<Surface[]> {
  const { data } = await sb().rpc("studio_surfaces");
  return (data ?? []) as Surface[];
}

export async function createChild(parentId: string, kind: "brand" | "location" | "business", name: string, slug?: string): Promise<string | null> {
  const { data, error } = await sb().rpc("org_create_child", { p_parent: parentId, p_kind: kind, p_name: name, p_slug: slug ?? null });
  return error ? null : (data as string);
}

export async function addMember(orgId: string, username: string, role: OrgRole, expiresAt?: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb().rpc("org_add_member", { p_org: orgId, p_username: username, p_role: role, p_expires_at: expiresAt ?? null });
  return { ok: !error, error: error?.message };
}

export async function removeMember(orgId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb().rpc("org_remove_member", { p_org: orgId, p_user: userId });
  return { ok: !error, error: error?.message };
}

export async function transferOwnership(orgId: string, toUserId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb().rpc("org_transfer_ownership", { p_org: orgId, p_to_user: toUserId });
  return { ok: !error, error: error?.message };
}

export async function setSurface(orgId: string, surface: Surface, enabled: boolean): Promise<boolean> {
  const { error } = await sb().rpc("org_set_surface", { p_org: orgId, p_surface: surface, p_enabled: enabled });
  return !error;
}

export async function grantDelegation(clientOrgId: string, principalSlug: string, scopes: Surface[], expiresAt?: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb().rpc("org_grant_delegation", { p_client: clientOrgId, p_principal_slug: principalSlug, p_scopes: scopes, p_expires_at: expiresAt ?? null });
  return { ok: !error, error: error?.message };
}

export async function revokeDelegation(clientOrgId: string, principalOrgId: string): Promise<boolean> {
  const { error } = await sb().rpc("org_revoke_delegation", { p_client: clientOrgId, p_principal: principalOrgId });
  return !error;
}
