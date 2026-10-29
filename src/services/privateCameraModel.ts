import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import {
  PRIVATE_CAMERA_MODEL,
  PRIVATE_CAMERA_SCORE,
} from "../../shared/privateCameraModel";
let pending: Promise<string> | null = null;
const base64Bytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
async function asset(name: string) {
  const item = PRIVATE_CAMERA_MODEL.find((x) => x.name === name);
  if (!item) throw Error("Unknown model asset");
  const folder = FileSystem.cacheDirectory + "private-camera-model/";
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  const uri = folder + item.sha256;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) await FileSystem.downloadAsync(item.url, uri);
  const data = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64Bytes(data);
  const hash = Array.from(
    new Uint8Array(
      await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (bytes.byteLength !== item.bytes || hash !== item.sha256) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw Error("Model integrity check failed");
  }
  return { uri, data };
}
/** The generated runtime holds only public model files. Camera frames are never written here. */
export function preparePrivateCameraRuntime() {
  if (!pending)
    pending = (async () => {
      const entries = new Map<
        string,
        {
          uri: string;
          data: string;
        }
      >();
      for (const item of PRIVATE_CAMERA_MODEL)
        entries.set(item.name, await asset(item.name));
      const tf = await FileSystem.readAsStringAsync(
          entries.get("tf.min.js")!.uri,
        ),
        coco = await FileSystem.readAsStringAsync(
          entries.get("coco-ssd.min.js")!.uri,
        ),
        model = JSON.parse(
          await FileSystem.readAsStringAsync(entries.get("model.json")!.uri),
        );
      const shards = model.weightsManifest
        .flatMap((g: { paths: string[] }) => g.paths)
        .map((name: string) => entries.get(name)!.data);
      const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src data:; style-src 'unsafe-inline'; connect-src 'none'"><script>${tf.replace(/<\/script/gi, "<\\/script")}</script><script>${coco.replace(/<\/script/gi, "<\\/script")}</script><script>
 const report=value=>window.ReactNativeWebView.postMessage(JSON.stringify(value));let detector,busy=false;
 const definition=${JSON.stringify(model)},shards=${JSON.stringify(shards)};const chunks=shards.map(s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)));const bytes=new Uint8Array(chunks.reduce((n,p)=>n+p.length,0));let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 tf.io.registerLoadRouter(url=>url==='platinum-private-camera'?{load:async()=>({...definition,weightSpecs:definition.weightsManifest.flatMap(g=>g.weights),weightData:bytes.buffer})}:null);
 cocoSsd.load({base:'lite_mobilenet_v2',modelUrl:'platinum-private-camera'}).then(value=>{detector=value;report({type:'loaded'});}).catch(()=>report({type:'error'}));
 window.privateFrame=async function(data){if(busy||!detector)return;busy=true;try{const image=new Image();image.src='data:image/jpeg;base64,'+data;await new Promise((ok,no)=>{image.onload=ok;image.onerror=no;});const found=await detector.detect(image);image.src='';report({type:'frame',phone:found.some(p=>p.class==='cell phone'&&p.score>=${PRIVATE_CAMERA_SCORE})});}catch{report({type:'error'});}finally{busy=false;}};
 </script>`;
      const uri =
        FileSystem.cacheDirectory + "private-camera-model/runtime.html";
      await FileSystem.writeAsStringAsync(uri, html);
      return uri;
    })().catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}
