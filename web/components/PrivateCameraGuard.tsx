"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadPrivateCameraModel } from "@/lib/privateCameraGuard";
import { PRIVATE_CAMERA_SCORE } from "../../shared/privateCameraModel";
export function PrivateCameraGuard({
  onStatus,
}: {
  onStatus: (status: "ready" | "phone" | "error") => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    callback = useRef(onStatus);
  useLayoutEffect(() => { callback.current = onStatus; }, [onStatus]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element=video.current;
    let live = true,
      stream: MediaStream | null = null,
      timer: ReturnType<typeof setTimeout> | undefined,
      deadline: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      stream?.getTracks().forEach((track) => track.stop());
    };
    const fail = () => {
      if (live) {
        live = false;
        stop();
        callback.current("error");
      }
    };
    deadline = setTimeout(fail, 90000);
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });
        if (!live) {
          stop();
          return;
        }
        stream
          .getVideoTracks()
          .forEach((t) => t.addEventListener("ended", fail));
        if (!video.current) throw Error("Camera unavailable");
        video.current.srcObject = stream;
        await video.current.play();
        const model = await loadPrivateCameraModel();
        if (!live) return;
        const tick = async () => {
          if (!live || !video.current) return;
          clearTimeout(deadline);
          deadline = setTimeout(fail, 15000);
          try {
            const found = await model.detect(video.current);
            if (!live) return;
            clearTimeout(deadline);
            if (
              found.some(
                (p) =>
                  p.class === "cell phone" && p.score >= PRIVATE_CAMERA_SCORE,
              )
            ) {
              live = false;
              stop();
              callback.current("phone");
              return;
            }
            setReady(true);
            callback.current("ready");
            timer = setTimeout(tick, 1000);
          } catch {
            fail();
          }
        };
        void tick();
      } catch {
        fail();
      }
    })();
    return () => {
      live = false;
      stop();
      if (element) element.srcObject = null;
    };
  }, []);
  return (
    <aside className="flex items-center justify-center gap-3 border-t p-3 text-xs">
      <video
        ref={video}
        muted
        playsInline
        className="h-14 w-20 rounded-lg bg-black object-cover"
        aria-label="Private camera guard preview"
      />
      <span>
        {ready
          ? "Camera guard active. Images stay on this device."
          : "Preparing on-device camera guard…"}
      </span>
    </aside>
  );
}
