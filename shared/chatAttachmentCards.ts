export type ChatAttachmentCard =
  | { pcAttachment: 1; kind: 'contact'; name: string; phone?: string; email?: string }
  | { pcAttachment: 1; kind: 'location'; latitude: number; longitude: number; accuracy?: number; capturedAt: string };

export function parseChatAttachmentCard(raw: unknown): ChatAttachmentCard | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || v.pcAttachment !== 1) return null;
    if (v.kind === 'contact') {
      if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100) return null;
      if (v.phone !== undefined && (typeof v.phone !== 'string' || !/^\+?[0-9 ()-]{3,30}$/.test(v.phone) || v.phone.replace(/\D/g, '').length < 3)) return null;
      if (v.email !== undefined && (typeof v.email !== 'string' || v.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))) return null;
      if (!v.phone && !v.email) return null;
      return { pcAttachment: 1, kind: 'contact', name: v.name.trim(), ...(v.phone ? {phone:v.phone} : {}), ...(v.email ? {email:v.email} : {}) };
    }
    if (v.kind === 'location' && typeof v.latitude === 'number' && typeof v.longitude === 'number'
      && Number.isFinite(v.latitude) && Number.isFinite(v.longitude) && Math.abs(v.latitude) <= 90 && Math.abs(v.longitude) <= 180
      && typeof v.capturedAt === 'string' && Number.isFinite(Date.parse(v.capturedAt))) {
      return { pcAttachment: 1, kind: 'location', latitude: v.latitude, longitude: v.longitude, capturedAt: v.capturedAt,
        ...(typeof v.accuracy === 'number' && Number.isFinite(v.accuracy) && v.accuracy >= 0 ? { accuracy:v.accuracy } : {}) };
    }
  } catch { /* Ordinary links are not attachment cards. */ }
  return null;
}
export function attachmentCardText(card: ChatAttachmentCard): string {
  return card.kind === 'contact' ? `Contact: ${card.name}` : 'Shared location';
}
export function attachmentCardLinks(card: ChatAttachmentCard): { label: string; url: string }[] {
  return card.kind === 'location' ? [{ label:'Open map',url:`https://www.google.com/maps/search/?api=1&query=${card.latitude},${card.longitude}` }]
    : [...(card.phone ? [{label:card.phone,url:'tel:'+card.phone.replace(/[^+0-9]/g,'')}] : []),
       ...(card.email ? [{label:card.email,url:'mailto:'+encodeURIComponent(card.email)}] : [])];
}
