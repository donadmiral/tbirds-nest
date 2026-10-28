import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import * as Capture from "expo-screen-capture";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "../SafeArea";
import { supabase } from "../../services/supabase";
import { useAuthStore } from "../../stores/authStore";
import { useTheme } from "../../theme/useTheme";
import { protectPrivateScreen } from "../../services/privateScreenCapture";
import {
  createPrivateViewSession,
  type PrivateGrant,
  type PrivateCloseReason,
} from "../../../shared/privateMedia";
import { PrivateCameraGuard } from "./PrivateCameraGuard";
type Props = {
  messageId: string;
  userId: string;
  onClose: () => void;
  onConsumed?: (remaining: number) => void;
};
function ProtectedVideo({
  uri,
  headers,
  onError,
}: {
  uri: string;
  headers: Record<string, string>;
  onError: () => void;
}) {
  const [playing, setPlaying] = useState(true);
  const player = useVideoPlayer({ uri, headers, useCaching: false }, (p) => {
    p.loop = false;
    p.play();
  });
  useEffect(() => {
    const status = player.addListener("statusChange", (s) => {
      if (s.status === "error") onError();
    });
    const playback = player.addListener("playingChange", (s) =>
      setPlaying(s.isPlaying),
    );
    return () => {
      status.remove();
      playback.remove();
    };
  }, [player, onError]);
  return (
    <>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
        surfaceType="textureView"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          playing ? "Pause private video" : "Play private video"
        }
        onPress={() => {
          if (playing) player.pause();
          else {
            if (player.currentTime >= player.duration) player.currentTime = 0;
            player.play();
          }
        }}
        style={{
          position: "absolute",
          bottom: 24,
          alignSelf: "center",
          padding: 14,
          borderRadius: 24,
          backgroundColor: "rgba(0,0,0,0.7)",
        }}
      >
        <Text style={{ color: "#fff" }}>{playing ? "Pause" : "Play"}</Text>
      </Pressable>
    </>
  );
}
export function PrivateMediaViewer(props: Props) {
  return (
    <PrivateMediaSession
      key={props.userId + ":" + props.messageId}
      {...props}
    />
  );
}
function PrivateMediaSession({
  messageId,
  userId,
  onClose,
  onConsumed,
}: Props) {
  const { t } = useTheme();
  const [phase, setPhase] = useState<
    "notice" | "opening" | "viewing" | "closed"
  >("notice");
  const [error, setError] = useState<string | null>(null);
  const [guard, setGuard] = useState(false);
  const [guardReady, setGuardReady] = useState(false);
  const [grant, setGrant] = useState<PrivateGrant | null>(null);
  const [ready, setReady] = useState(false);
  const content = useRef<View>(null);
  const live = useRef(true),
    terminal = useRef(false),
    session = useRef<ReturnType<typeof createPrivateViewSession> | null>(null),
    release = useRef<(() => void) | null>(null),
    busy = useRef(false);
  const callbacks = useRef({ onClose, onConsumed });
  callbacks.current = { onClose, onConsumed };
  const hide = useCallback(() => {
    content.current?.setNativeProps({ style: { opacity: 0 } });
    if (live.current) {
      setGrant(null);
      setPhase("closed");
    }
  }, []);
  const close = useCallback(
    (reason: PrivateCloseReason = "closed") => {
      terminal.current = true;
      setReady(false);
      void session.current?.close(reason);
      hide();
    },
    [hide],
  );
  useEffect(() => {
    live.current = true;
    terminal.current = false;
    const app = AppState.addEventListener("change", (state) => {
      if (state !== "active" && (session.current || busy.current))
        close("background");
    });
    const shot = Capture.addScreenshotListener(() => close("screenshot"));
    const auth = supabase.auth.onAuthStateChange((_event, s) => {
      if (s?.user?.id !== userId) close("account_changed");
    });
    return () => {
      live.current = false;
      terminal.current = true;
      void session.current?.close("closed");
      release.current?.();
      release.current = null;
      app.remove();
      shot.remove();
      auth.data.subscription.unsubscribe();
    };
  }, [userId, close]);
  useEffect(() => {
    if (!grant) return;
    const timer = setTimeout(
      () => close("expired"),
      Math.max(0, Date.parse(grant.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [grant, close]);
  const open = async () => {
    if (busy.current || terminal.current || (guard && !guardReady)) return;
    busy.current = true;
    setError(null);
    setPhase("opening");
    try {
      const unprotect = await protectPrivateScreen();
      if (terminal.current || !live.current) {
        unprotect();
        return;
      }
      release.current = unprotect;
      const { data, error: authError } = await supabase.auth.getSession();
      if (
        authError ||
        data.session?.user.id !== userId ||
        terminal.current ||
        AppState.currentState !== "active"
      )
        throw new Error("Sign in again to open this attachment.");
      const current = () =>
        live.current &&
        !terminal.current &&
        useAuthStore.getState().session?.user.id === userId &&
        AppState.currentState === "active";
      const transport = createPrivateViewSession({
        endpoint:
          process.env.EXPO_PUBLIC_SUPABASE_URL +
          "/functions/v1/private-media-session",
        token: data.session.access_token,
        apiKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "",
        messageId,
        requestId: Crypto.randomUUID(),
        fetch,
        current,
        hide,
      });
      session.current = transport;
      const value = await transport.open();
      if (!value || !current()) return;
      setGrant(value);
      setPhase("viewing");
      callbacks.current.onConsumed?.(value.remaining);
    } catch (e) {
      if (live.current && !terminal.current) {
        setError(e instanceof Error ? e.message : "Could not open attachment.");
        close("error");
      }
    } finally {
      busy.current = false;
    }
  };
  const guardEvent = useCallback(
    (kind: "ready" | "phone" | "error") => {
      if (kind === "ready") {
        if (live.current && !terminal.current) setGuardReady(true);
      } else {
        setGuardReady(false);
        setError(
          kind === "phone"
            ? "A phone was detected. This view has closed."
            : "Camera protection stopped. This view has closed.",
        );
        close(kind === "phone" ? "camera_detected" : "guard_failed");
      }
    },
    [close],
  );
  const mediaError = useCallback(() => {
    setError("This attachment could not be displayed.");
    close("error");
  }, [close]);
  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={() => {
        close();
        callbacks.current.onClose();
      }}
    >
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: phase === "viewing" ? "#000" : t.surface.canvas,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            padding: 18,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              color: phase === "viewing" ? "#fff" : t.ink.primary,
            }}
          >
            Private view
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close private view"
            onPress={() => {
              close();
              callbacks.current.onClose();
            }}
          >
            <Text
              style={{ color: phase === "viewing" ? "#fff" : t.ink.primary }}
            >
              Close
            </Text>
          </Pressable>
        </View>
        {(phase === "notice" || phase === "opening") && (
          <ScrollView contentContainerStyle={{ padding: 24, gap: 18 }}>
            <Text
              style={{ fontSize: 24, fontWeight: "700", color: t.ink.primary }}
            >
              Keep this moment private.
            </Text>
            <Text
              style={{ fontSize: 16, lineHeight: 24, color: t.ink.secondary }}
            >
              Opening uses one permitted view. Closing ends that view. Saving
              and forwarding are unavailable. Screen-capture protection depends
              on your device. Another camera can still photograph this screen.
            </Text>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Switch
                accessibilityLabel="Optional camera guard"
                value={guard}
                disabled={phase !== "notice"}
                onValueChange={(value) => {
                  setGuard(value);
                  setGuardReady(false);
                }}
              />
              <Text style={{ flex: 1, color: t.ink.primary }}>
                Optional camera guard
              </Text>
            </View>
            <Text style={{ color: t.ink.secondary }}>
              Processes camera images on your phone. A detected phone or
              interrupted analysis closes the attachment. Detection can miss
              cameras. First use downloads about 20 MB.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={phase === "opening" || (guard && !guardReady)}
              onPress={() => void open()}
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: t.brand.base,
                opacity:
                  phase === "opening" || (guard && !guardReady) ? 0.5 : 1,
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  textAlign: "center",
                  fontWeight: "700",
                }}
              >
                {phase === "opening"
                  ? "Opening…"
                  : guard && !guardReady
                    ? "Preparing camera guard…"
                    : "Open attachment"}
              </Text>
            </Pressable>
          </ScrollView>
        )}
        {phase === "viewing" && grant && session.current && (
          <View
            ref={content}
            collapsable={false}
            style={{ flex: 1, backgroundColor: "#000" }}
          >
            {grant.mediaType === "video" ? (
              <ProtectedVideo
                uri={session.current.mediaUrl}
                headers={session.current.headers}
                onError={mediaError}
              />
            ) : (
              <>
                <Image
                  source={{
                    uri: session.current.mediaUrl,
                    headers: session.current.headers,
                    cache: "reload",
                  }}
                  resizeMode="contain"
                  style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]}
                  onLoad={() => {
                    if (Date.parse(grant.expiresAt) <= Date.now())
                      close("expired");
                    else setReady(true);
                  }}
                  onError={mediaError}
                />
                {!ready && (
                  <ActivityIndicator
                    style={StyleSheet.absoluteFill}
                    color="#fff"
                  />
                )}
              </>
            )}
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { justifyContent: "space-around", padding: 12 },
              ]}
            >
              {[0, 1, 2].map((i) => (
                <Text
                  key={i}
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontSize: 12,
                    textAlign: "center",
                    textShadowColor: "#000",
                    textShadowRadius: 2,
                    transform: [{ rotate: "-18deg" }],
                  }}
                >
                  {grant.watermark}
                </Text>
              ))}
            </View>
          </View>
        )}
        {guard && phase !== "closed" && (
          <PrivateCameraGuard onStatus={guardEvent} />
        )}
        {phase === "closed" && (
          <View style={{ padding: 24, gap: 16 }}>
            <Text
              style={{ fontSize: 22, fontWeight: "700", color: t.ink.primary }}
            >
              View closed
            </Text>
            <Text style={{ color: t.ink.secondary }}>
              {error || "This private viewing session has ended."}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => callbacks.current.onClose()}
            >
              <Text style={{ color: t.status.link }}>Return to chat</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}
