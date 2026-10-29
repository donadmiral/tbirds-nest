import { themedSheet } from "../../theme/useTheme";
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../services/supabase";
import {
  LISTING_REASONS,
  REVIEW_REASONS,
  reportMarketContent,
  reviewError,
} from "../../../shared/marketReviews";
type Props = {
  visible: boolean;
  onClose: () => void;
  listingId?: string;
  reviewId?: string;
  reporterId?: string | null;
};
export default function ReportListingSheet({
  visible,
  onClose,
  listingId,
  reviewId,
  reporterId,
}: Props) {
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    generation.current++;
    pending.current = false;
    setReason("");
    setDetail("");
    setBusy(false);
    setError("");
    setSent(false);
    return () => {
      generation.current++;
    };
  }, [visible, listingId, reviewId, reporterId]);
  const close = () => {
    if (!pending.current) onClose();
  };
  const submit = async () => {
    const id = reviewId || listingId;
    if (pending.current || !id || !reporterId || !reason) return;
    const version = generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await reportMarketContent(
        supabase,
        reporterId,
        reviewId ? "review" : "listing",
        id,
        reason,
        detail,
      );
      if (version === generation.current) setSent(true);
    } catch (e) {
      if (version === generation.current) setError(reviewError(e));
    } finally {
      if (version === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={s.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ maxHeight: "90%" }}
        >
          <View style={s.sheet}>
            <View style={s.handle} />
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.title}>
                Report {reviewId ? "review" : "listing"}
              </Text>
              <Text style={s.sub}>
                Your identity is hidden from the reported person. Staff can
                review your report.
              </Text>
              {sent ? (
                <Text accessibilityLiveRegion="polite" style={s.rowTitle}>
                  Report received. Our team will review it.
                </Text>
              ) : (
                <>
                  {(reviewId ? REVIEW_REASONS : LISTING_REASONS).map((r) => (
                    <TouchableOpacity
                      key={r.key}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: reason === r.key }}
                      style={s.row}
                      disabled={busy}
                      onPress={() => setReason(r.key)}
                    >
                      <Text style={[s.rowTitle, { flex: 1 }]}>{r.label}</Text>
                      <View style={[s.radio, reason === r.key && s.radioOn]}>
                        {reason === r.key && (
                          <Feather name="check" size={13} color="#FFF" />
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                  {!!reason && (
                    <TextInput
                      style={s.input}
                      value={detail}
                      onChangeText={setDetail}
                      editable={!busy}
                      accessibilityLabel="Report details, optional"
                      placeholder="Add detail (optional)"
                      placeholderTextColor="#8E8E93"
                      multiline
                      maxLength={1000}
                    />
                  )}
                  {!!error && (
                    <Text accessibilityRole="alert" style={s.sub}>
                      {error}
                    </Text>
                  )}
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[s.cta, (!reason || busy) && { opacity: 0.4 }]}
                    onPress={() => void submit()}
                    disabled={!reason || busy}
                  >
                    {busy ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={s.ctaTxt}>Submit report</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity
                accessibilityRole="button"
                disabled={busy}
                onPress={close}
                style={{
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={s.rowTitle}>{sent ? "Done" : "Cancel"}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
const s = themedSheet((t) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    backgroundColor: t.surface.canvas,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 32,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D8D8DC",
    alignSelf: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0A0A0A",
    letterSpacing: -0.4,
  },
  sub: { fontSize: 13.5, color: "#8E8E93", marginTop: 3, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#EFEFF4",
  },
  rowTitle: { fontSize: 15.5, fontWeight: "600", color: "#0A0A0A" },
  rowSub: { fontSize: 12.5, color: "#8E8E93", marginTop: 1 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#C7C7CC",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { backgroundColor: "#DC2626", borderColor: "#DC2626" },
  input: {
    marginTop: 12,
    backgroundColor: "#F2F2F7",
    borderRadius: 12,
    padding: 12,
    minHeight: 60,
    fontSize: 14.5,
    color: "#0A0A0A",
    textAlignVertical: "top",
  },
  cta: {
    marginTop: 16,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaTxt: { color: t.ink.inverse, fontSize: 16, fontWeight: "700" },
}));
