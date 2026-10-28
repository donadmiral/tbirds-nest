const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
function harness(failSwitch = false) {
  const calls = [],
    exports = {};
  let fail = failSwitch;
  const capture = {
    preventScreenCaptureAsync: async (key) => calls.push(["protect", key]),
    allowScreenCaptureAsync: async (key) => calls.push(["release", key]),
    enableAppSwitcherProtectionAsync: async () => {
      calls.push(["switcher-on"]);
      if (fail) {
        fail = false;
        throw Error("Native protection unavailable");
      }
    },
    disableAppSwitcherProtectionAsync: async () => calls.push(["switcher-off"]),
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, "../src/services/privateScreenCapture.ts"),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      require: (name) =>
        name === "expo-screen-capture" ? capture : { Platform: { OS: "ios" } },
    },
  );
  return { calls, protect: exports.protectPrivateScreen };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("overlapping viewers share a serialized OS capture lease and only the last close releases it", async () => {
  const h = harness();
  const [one, two] = await Promise.all([h.protect(), h.protect()]);
  assert.equal(h.calls.filter((x) => x[0] === "protect").length, 1);
  one();
  one();
  await flush();
  assert.equal(h.calls.filter((x) => x[0] === "release").length, 0);
  two();
  await flush();
  assert.equal(h.calls.filter((x) => x[0] === "release").length, 1);
  assert.equal(h.calls.filter((x) => x[0] === "switcher-off").length, 1);
});
test("native switcher protection failure rejects opening and unwinds the partial lease", async () => {
  const h = harness(true);
  await assert.rejects(h.protect(), /unavailable/);
  assert.equal(h.calls.filter((x) => x[0] === "release").length, 1);
  const release = await h.protect();
  release();
  await flush();
  assert.equal(h.calls.filter((x) => x[0] === "protect").length, 2);
  assert.equal(h.calls.filter((x) => x[0] === "release").length, 2);
});
