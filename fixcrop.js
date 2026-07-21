const fs = require("fs");
const path = require("path");

const ctrlPath = path.join(process.cwd(), "src/controllers/stories/useEnhancementController.ts");
let ctrl = fs.readFileSync(ctrlPath, "utf8");

// Add manipulateAsync import
if (!ctrl.includes("manipulateAsync")) {
  ctrl = ctrl.replace(
    "import * as FileSystem from 'expo-file-system/legacy';",
    "import * as FileSystem from 'expo-file-system/legacy';\nimport { manipulateAsync, SaveFormat } from 'expo-image-manipulator';"
  );
  console.log("Added manipulateAsync import");
}

// Replace the cacheVariation block to resize after download
const oldCache = "        const cachedUri = await cacheVariation(v.url, draftId, i);\n        return { localUri: cachedUri, tone: v.tone, promptUsed: v.promptUsed };";

const newCache = "        let cachedUri = await cacheVariation(v.url, draftId, i);\n        // Resize to original dimensions (fixes cropping)\n        try {\n          const resized = await manipulateAsync(\n            cachedUri,\n            [{ resize: { width: dimensions.width, height: dimensions.height } }],\n            { compress: 0.95, format: SaveFormat.JPEG }\n          );\n          cachedUri = resized.uri;\n          console.log('[Enhancement] Resized to', dimensions.width + 'x' + dimensions.height);\n        } catch (resizeErr) {\n          console.warn('[Enhancement] Resize failed, using cached:', resizeErr);\n        }\n        return { localUri: cachedUri, tone: v.tone, promptUsed: v.promptUsed };";

if (ctrl.includes(oldCache)) {
  ctrl = ctrl.replace(oldCache, newCache);
  console.log("Added resize after cache (fixes cropping)");
} else {
  console.log("WARNING: cache pattern not found");
}

fs.writeFileSync(ctrlPath, ctrl, "utf8");
console.log("Done");
