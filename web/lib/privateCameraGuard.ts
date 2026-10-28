import { PRIVATE_CAMERA_MODEL } from "../../shared/privateCameraModel";
let modelPromise: Promise<
  import("@tensorflow-models/coco-ssd").ObjectDetection
> | null = null;
async function verified(name: string) {
  const asset = PRIVATE_CAMERA_MODEL.find((a) => a.name === name);
  if (!asset) throw Error("Unknown model asset");
  const response = await fetch(asset.url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "force-cache",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error("Model download failed");
  const data = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hash = Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (data.byteLength !== asset.bytes || hash !== asset.sha256)
    throw Error("Model integrity check failed");
  return data;
}
export function loadPrivateCameraModel() {
  if (!modelPromise)
    modelPromise = (async () => {
      const [tf, coco, jsonBytes] = await Promise.all([
        import("@tensorflow/tfjs"),
        import("@tensorflow-models/coco-ssd"),
        verified("model.json"),
      ]);
      const model = JSON.parse(new TextDecoder().decode(jsonBytes));
      const parts = await Promise.all(
        model.weightsManifest
          .flatMap((g: { paths: string[] }) => g.paths)
          .map(verified),
      );
      const weights = new Uint8Array(
        parts.reduce((n: number, b: ArrayBuffer) => n + b.byteLength, 0),
      );
      let at = 0;
      for (const b of parts) {
        weights.set(new Uint8Array(b), at);
        at += b.byteLength;
      }
      const handler = tf.io.fromMemory({
        ...model,
        weightSpecs: model.weightsManifest.flatMap(
          (g: { weights: unknown[] }) => g.weights,
        ),
        weightData: weights.buffer,
      });
      tf.io.registerLoadRouter(((url: unknown) =>
        url === "platinum-private-camera" ? handler : null) as Parameters<
        typeof tf.io.registerLoadRouter
      >[0]);
      await tf.ready();
      return coco.load({
        base: "lite_mobilenet_v2",
        modelUrl: "platinum-private-camera",
      });
    })().catch((error) => {
      modelPromise = null;
      throw error;
    });
  return modelPromise;
}
