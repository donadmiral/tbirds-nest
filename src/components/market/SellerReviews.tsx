import VerifiedBadge from "../VerifiedBadge";
import TierName from "../TierName";
import { themedSheet, useTheme } from "../../theme/useTheme";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { supabase } from "../../services/supabase";
import {
  getSellerReviewPage,
  submitSellerReview,
  reviewError,
  type ReviewPage,
  type ReviewCursor,
} from "../../../shared/marketReviews";
import ReportListingSheet from "./ReportListingSheet";
const GOLD = "#F5A623";
function Stars({
  value,
  size = 14,
  onPick,
}: {
  value: number;
  size?: number;
  onPick?: (n: number) => void;
}) {
  const { t } = useTheme();
  const gap = Math.max(2, Math.round(size * 0.12));
  const rowW = size * 5 + gap * 4;
  const pct = Math.max(0, Math.min(1, value / 5));

  if (onPick) {
    return (
      <View style={{ flexDirection: "row", gap }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${n} stars`}
            accessibilityState={{ selected: value === n }}
            style={{
              minWidth: 44,
              minHeight: 44,
              justifyContent: "center",
              alignItems: "center",
            }}
            onPress={() => onPick(n)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={n <= value ? "star" : "star-outline"}
              size={size}
              color={n <= value ? GOLD : t.ink.muted}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <View style={{ width: rowW, height: size }}>
      <View style={{ flexDirection: "row", gap }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Ionicons key={"b" + i} name="star" size={size} color={t.ink.faint} />
        ))}
      </View>
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: rowW * pct,
          height: size,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", gap, width: rowW }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Ionicons key={"f" + i} name="star" size={size} color={GOLD} />
          ))}
        </View>
      </View>
    </View>
  );
}

export default function SellerReviews({
  sellerId,
  listingId,
  currentUserId,
}: {
  sellerId: string;
  listingId?: string;
  currentUserId?: string | null;
}) {
  const { t, isDark } = useTheme();
  const [storedPage, setPage] = useState<ReviewPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const [order, setOrder] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const saving = useRef(false);
  const scope = `${sellerId}:${listingId || ""}:${currentUserId || ""}`;
  const loadedScope = useRef("");
  const page = loadedScope.current === scope ? storedPage : null;
  const load = useCallback(
    async (cursor?: ReviewCursor) => {
      if (inFlight.current) return;
      const version = generation.current;
      inFlight.current = true;
      setLoading(true);
      setError("");
      try {
        const data = await getSellerReviewPage(
          supabase,
          sellerId,
          listingId,
          cursor,
        );
        if (version === generation.current) {
          loadedScope.current = scope;
          setPage((old) =>
            cursor && old
              ? {
                  ...data,
                  rows: [
                    ...old.rows,
                    ...data.rows.filter(
                      (r) => !old.rows.some((x) => x.id === r.id),
                    ),
                  ],
                }
              : data,
          );
        }
      } catch (e) {
        if (version === generation.current) setError(reviewError(e));
      } finally {
        if (version === generation.current) {
          setLoading(false);
          inFlight.current = false;
        }
      }
    },
    [sellerId, listingId, scope],
  );
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    saving.current = false;
    setPage(null);
    setWriting(false);
    setOrder("");
    setRating(0);
    setComment("");
    setBusy(false);
    setReport(null);
    setSaved(false);
    setError("");
    setLoading(false);
    if (currentUserId) void load();
    return () => {
      generation.current++;
    };
  }, [load, currentUserId]);
  const submit = async () => {
    if (
      saving.current ||
      inFlight.current ||
      !currentUserId ||
      !order ||
      !rating
    )
      return;
    const version = generation.current;
    saving.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await submitSellerReview(supabase, currentUserId, order, rating, comment);
      if (version === generation.current) {
        setSaved(true);
        setWriting(false);
        await load();
      }
    } catch (e) {
      if (version === generation.current) setError(reviewError(e));
    } finally {
      if (version === generation.current) {
        saving.current = false;
        setBusy(false);
      }
    }
  };
  if (!currentUserId)
    return (
      <View style={s.wrap}>
        <Text style={s.none}>Sign in to see verified purchase reviews.</Text>
      </View>
    );
  const summary = page?.summary;
  const count = Number(summary?.review_count || 0);
  const avg = Number(summary?.avg_rating || 0);
  const bars = [
    { n: 5, v: summary?.five || 0 },
    { n: 4, v: summary?.four || 0 },
    { n: 3, v: summary?.three || 0 },
    { n: 2, v: summary?.two || 0 },
    { n: 1, v: summary?.one || 0 },
  ];
  const selected = page?.eligible_orders.find((o) => o.id === order);
  return (
    <View style={s.wrap}>
      <Text style={s.heading}>Seller reviews</Text>
      {loading && <ActivityIndicator accessibilityLabel="Loading reviews" />}
      {!!error && (
        <View accessibilityRole="alert">
          <Text style={s.comment}>{error}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={s.writeBtn}
            onPress={() => void load()}
            disabled={loading}
          >
            <Text style={s.writeTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {page &&
        (count === 0 ? (
          <Text style={s.none}>No verified purchase reviews yet.</Text>
        ) : (
          <View style={s.summary}>
            <View style={s.scoreCol}>
              <Text style={s.score}>{avg.toFixed(1)}</Text>
              <Stars value={avg} size={13} />
              <Text style={s.countTxt}>{count} verified reviews</Text>
            </View>
            <View style={s.barsCol}>
              {bars.map((b) => (
                <View key={b.n} style={s.barRow}>
                  <Text style={s.barNum}>{b.n}</Text>
                  <View style={s.barTrack}>
                    <View
                      style={[
                        s.barFill,
                        { width: `${count ? (b.v / count) * 100 : 0}%` },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      {!!page?.eligible_orders.length && !writing && (
        <TouchableOpacity
          accessibilityRole="button"
          style={s.writeBtn}
          onPress={() => setWriting(true)}
        >
          <Feather name="edit-2" size={14} color={t.ink.primary} />
          <Text style={s.writeTxt}>Write or edit a review</Text>
        </TouchableOpacity>
      )}
      {page && !page.eligible_orders.length && currentUserId !== sellerId && (
        <Text style={s.none}>
          You can review after completing a purchase from this seller.
        </Text>
      )}
      {writing && (
        <View style={s.composer}>
          <Text style={s.writeTxt}>Choose a completed purchase</Text>
          {page?.eligible_orders.map((o) => (
            <TouchableOpacity
              key={o.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: order === o.id }}
              disabled={busy}
              style={[
                s.writeBtn,
                {
                  borderWidth: 1,
                  borderColor: order === o.id ? t.ink.primary : "transparent",
                },
              ]}
              onPress={() => {
                setOrder(o.id);
                setRating(o.rating || 0);
                setComment(o.comment || "");
                setSaved(false);
              }}
            >
              <Text style={s.comment}>
                {o.title} · {new Date(o.completed_at).toLocaleDateString()} ·{" "}
                {o.id.slice(0, 8)}
              </Text>
            </TouchableOpacity>
          ))}
          {selected?.moderation_status === "hidden" ? (
            <Text style={s.comment}>
              This review was removed. Contact support to appeal.
            </Text>
          ) : (
            <>
              <Stars
                value={rating}
                size={26}
                onPick={busy ? undefined : setRating}
              />
              <TextInput
                style={s.input}
                value={comment}
                onChangeText={setComment}
                editable={!busy}
                accessibilityLabel="Your review"
                placeholder="Share how the deal went"
                placeholderTextColor={t.ink.muted}
                keyboardAppearance={isDark ? "dark" : "light"}
                multiline
                maxLength={2000}
              />
              <View style={s.composerActions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setWriting(false)}
                  disabled={busy}
                >
                  <Text style={s.cancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    s.post,
                    (!order || !rating || busy) && { opacity: 0.5 },
                  ]}
                  onPress={() => void submit()}
                  disabled={!order || !rating || busy || loading}
                >
                  {busy ? (
                    <ActivityIndicator color={t.ink.inverse} />
                  ) : (
                    <Text style={s.postTxt}>Save review</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
      {saved && (
        <Text accessibilityLiveRegion="polite" style={s.none}>
          Review saved.
        </Text>
      )}
      {page?.rows.map((r) => (
        <View key={r.id} style={s.review}>
          <View style={s.reviewHead}>
            <Text style={s.reviewer}>
              <TierName
                userId={r.reviewer?.id}
                baseStyle={s.reviewer}
                text={r.reviewer?.full_name || "Member"}
              />{" "}
              <VerifiedBadge userId={r.reviewer?.id} size={12} />
            </Text>
            <Stars value={r.rating} size={12} />
          </View>
          <Text style={s.date}>Verified purchase</Text>
          {!!r.comment && <Text style={s.comment}>{r.comment}</Text>}
          <Text style={s.date}>
            {new Date(r.created_at).toLocaleDateString()}
          </Text>
          {r.reviewer_id !== currentUserId && (
            <TouchableOpacity
              accessibilityRole="button"
              style={{ minHeight: 44, justifyContent: "center" }}
              onPress={() => setReport(r.id)}
            >
              <Text style={s.cancel}>Report review</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      {page?.has_more && page.next_cursor && (
        <TouchableOpacity
          accessibilityRole="button"
          style={s.writeBtn}
          disabled={loading}
          onPress={() => void load(page.next_cursor!)}
        >
          <Text style={s.writeTxt}>Load older reviews</Text>
        </TouchableOpacity>
      )}
      <ReportListingSheet
        visible={!!report}
        onClose={() => setReport(null)}
        reviewId={report || undefined}
        reporterId={currentUserId}
      />
    </View>
  );
}
const s = themedSheet((t) => ({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.surface.hairline,
    marginTop: 18,
  },
  center: { paddingVertical: 24, alignItems: "center" },
  heading: {
    fontSize: 17,
    fontWeight: "800",
    color: t.ink.primary,
    letterSpacing: -0.4,
    marginBottom: 12,
  },
  none: { fontSize: 14, color: t.ink.muted, paddingBottom: 8 },
  summary: {
    flexDirection: "row",
    gap: 20,
    alignItems: "center",
    marginBottom: 14,
  },
  scoreCol: { alignItems: "center", gap: 4 },
  score: {
    fontSize: 38,
    fontWeight: "800",
    color: t.ink.primary,
    letterSpacing: -1.5,
  },
  countTxt: { fontSize: 12, color: t.ink.muted },
  barsCol: { flex: 1, gap: 4 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barNum: { fontSize: 11, color: t.ink.muted, width: 8 },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.surface.hairline,
    overflow: "hidden",
  },
  barFill: { height: "100%", backgroundColor: GOLD, borderRadius: 3 },
  writeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    alignSelf: "flex-start",
    backgroundColor: t.surface.sunken,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 9,
    marginBottom: 14,
  },
  writeTxt: { fontSize: 14, fontWeight: "700", color: t.ink.primary },
  composer: {
    backgroundColor: t.surface.sunken,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    marginBottom: 14,
  },
  input: {
    minHeight: 60,
    fontSize: 14.5,
    color: t.ink.primary,
    textAlignVertical: "top",
  },
  composerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 16,
  },
  cancel: { fontSize: 14.5, color: t.ink.muted, fontWeight: "600" },
  post: {
    backgroundColor: t.brand.base,
    borderRadius: 12,
    paddingHorizontal: 20,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 9,
  },
  postTxt: { color: t.ink.inverse, fontSize: 14.5, fontWeight: "700" },
  review: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.surface.hairline,
  },
  reviewHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  reviewer: { fontSize: 14.5, fontWeight: "700", color: t.ink.primary },
  comment: { fontSize: 14, color: t.ink.secondary, lineHeight: 19 },
  date: { fontSize: 11.5, color: t.ink.muted, marginTop: 5 },
}));
