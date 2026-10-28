import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import { WebView } from "react-native-webview";
import { preparePrivateCameraRuntime } from "../../services/privateCameraModel";
import { useTheme } from "../../theme/useTheme";
export function PrivateCameraGuard({
  onStatus,
}: {
  onStatus: (status: "ready" | "phone" | "error") => void;
}) {
  const { t } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null),
    web = useRef<WebView>(null),
    live = useRef(true),
    loaded = useRef(false),
    cameraReady = useRef(false),
    waiting = useRef(false),
    callback = useRef(onStatus);
  callback.current = onStatus;
  const [runtime, setRuntime] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [size, setSize] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fail = () => {
    if (live.current) {
      live.current = false;
      callback.current("error");
    }
  };
  const tick = async () => {
    if (
      !live.current ||
      !loaded.current ||
      !cameraReady.current ||
      waiting.current
    )
      return;
    waiting.current = true;
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = setTimeout(fail, 15000);
    let uri: string | undefined;
    try {
      const shot = await camera.current?.takePictureAsync({
        base64: true,
        quality: 0.15,
        skipProcessing: true,
      });
      uri = shot?.uri;
      if (!shot?.base64) throw Error("Camera unavailable");
      if (live.current)
        web.current?.injectJavaScript(
          "window.privateFrame(" + JSON.stringify(shot.base64) + ");true;",
        );
    } catch {
      fail();
    } finally {
      if (uri)
        void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  };
  useEffect(() => {
    let cancelled = false;
    live.current = true;
    watchdog.current = setTimeout(fail, 90000);
    void (async () => {
      try {
        const result = permission?.granted
          ? permission
          : await requestPermission();
        if (cancelled) return;
        if (!result.granted) {
          fail();
          return;
        }
        const uri = await preparePrivateCameraRuntime();
        if (!cancelled && live.current) setRuntime(uri);
      } catch {
        if (!cancelled) fail();
      }
    })();
    return () => {
      cancelled = true;
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (watchdog.current) clearTimeout(watchdog.current);
    };
  }, []);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 12,
        backgroundColor: t.surface.raised,
      }}
    >
      {permission?.granted && (
        <CameraView
          ref={camera}
          facing="front"
          mode="picture"
          pictureSize={size}
          style={{ height: 54, width: 76, borderRadius: 8, overflow: "hidden" }}
          onMountError={fail}
          onCameraReady={() => {
            cameraReady.current = true;
            void camera.current
              ?.getAvailablePictureSizesAsync()
              .then((sizes) => {
                const sorted = sizes
                  .filter((s) => /^\d+x\d+$/.test(s))
                  .sort((a, b) => {
                    const area = (s: string) =>
                      s.split("x").reduce((n, v) => n * Number(v), 1);
                    return area(a) - area(b);
                  });
                if (live.current && sorted[0]) setSize(sorted[0]);
              })
              .catch(() => {});
            void tick();
          }}
        />
      )}
      <Text style={{ fontSize: 11, color: t.ink.secondary, flexShrink: 1 }}>
        {ready
          ? "Camera guard active. Images stay on this device."
          : "Preparing camera guard…"}
      </Text>
      {runtime && (
        <WebView
          ref={web}
          source={{ uri: runtime }}
          originWhitelist={["file://*"]}
          javaScriptEnabled
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs={false}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          onShouldStartLoadWithRequest={(r) =>
            r.url === runtime || r.url === "about:blank"
          }
          onError={fail}
          onMessage={(event) => {
            try {
              const message = JSON.parse(event.nativeEvent.data);
              if (!live.current) return;
              if (message.type === "error") {
                fail();
                return;
              }
              if (message.type === "loaded") {
                loaded.current = true;
                void tick();
              }
              if (message.type === "frame") {
                waiting.current = false;
                if (watchdog.current) clearTimeout(watchdog.current);
                if (message.phone) {
                  live.current = false;
                  callback.current("phone");
                  return;
                }
                setReady(true);
                callback.current("ready");
                timer.current = setTimeout(() => void tick(), 1000);
              }
            } catch {
              fail();
            }
          }}
        />
      )}
    </View>
  );
}
