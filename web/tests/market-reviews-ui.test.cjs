const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const text = (n) =>
  typeof n === "string" || typeof n === "number"
    ? String(n)
    : Array.isArray(n)
      ? n.map(text).join("")
      : text(n?.props?.children ?? "");
const snapshot = (name) => ({
  rows: [
    {
      id: "review-" + name,
      reviewer_id: name,
      reviewer: { id: name, full_name: name },
      rating: 4,
      comment: "Arrived safely",
      created_at: "2026-10-01",
    },
  ],
  summary: { avg_rating: 4, review_count: 1 },
  eligible_orders: [
    {
      id: "order",
      title: "Camera",
      completed_at: "2026-10-01",
      rating: null,
      comment: null,
    },
  ],
  has_more: false,
  next_cursor: null,
});
function app(kind, api) {
  let cursor = 0,
    tree;
  const slots = [],
    effects = [];
  let props =
    kind === "SellerReviews"
      ? { sellerId: "seller-a", listingId: "listing", viewerId: "buyer" }
      : { kind: "listing", id: "listing", userId: "buyer", onClose() {} };
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const hooks = {
    useState(seed) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof seed === "function" ? seed() : seed;
      return [
        slots[i],
        (v) => {
          slots[i] = typeof v === "function" ? v(slots[i]) : v;
        },
      ];
    },
    useRef(seed) {
      return (slots[cursor++] ??= { current: seed });
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        slots[i]?.cleanup?.();
        slots[i] = { deps };
        effects.push(() => (slots[i].cleanup = fn()));
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, "../components/" + kind + ".tsx"),
        "utf8",
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      module,
      exports: module.exports,
      Date,
      Error,
      console,
      require(id) {
        if (id === "react") return hooks;
        if (id === "react/jsx-runtime")
          return {
            jsx: (type, props) => ({ type, props }),
            jsxs: (type, props) => ({ type, props }),
          };
        if (id === "@/lib/supabase/client") return { createClient: () => ({}) };
        if (id.endsWith("/marketReviews"))
          return { ...require("../../shared/marketReviews.ts"), ...api };
        if (id === "lucide-react") return { Star: "Star" };
        if (id === "@/components/VerifiedBadge")
          return { VerifiedBadge: "Badge" };
        if (id === "@/lib/feed") return { timeAgo: () => "" };
        if (id === "./MarketReportForm") return { MarketReportForm: "Report" };
        throw new Error(id);
      },
    },
  );
  const render = () => {
    cursor = 0;
    tree = module.exports[kind](props);
    effects.splice(0).forEach((fn) => fn());
  };
  const nodes = () => {
    const all = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      all.push(n);
      walk(n.props?.children);
    };
    walk(tree);
    return all;
  };
  return {
    render,
    async flush() {
      for (let i = 0; i < 5; i++) {
        await new Promise(setImmediate);
        render();
      }
    },
    setProps(p) {
      props = { ...props, ...p };
      render();
    },
    node(type) {
      return nodes().find((n) => n.type === type);
    },
    button(label) {
      return nodes().find(
        (n) =>
          n.type === "button" &&
          (text(n).includes(label) || n.props["aria-label"] === label),
      );
    },
    get text() {
      return text(tree);
    },
    unmount() {
      slots.forEach((s) => s?.cleanup?.());
    },
  };
}
test("review loading failure is visible and retry recovers real buyer names", async () => {
  let n = 0;
  const a = app("SellerReviews", {
    getSellerReviewPage: async () => {
      if (!n++) throw new Error("offline");
      return snapshot("Actual buyer");
    },
  });
  a.render();
  await a.flush();
  assert.match(a.text, /could not be confirmed/);
  assert.doesNotMatch(a.text, /No verified purchase reviews yet/);
  a.button("Retry").props.onClick();
  await a.flush();
  assert.match(a.text, /Actual buyer/);
  a.unmount();
});
test("a late response from the previous seller never replaces the new seller reviews", async () => {
  const old = defer();
  const a = app("SellerReviews", {
    getSellerReviewPage: async (_c, seller) =>
      seller === "seller-a" ? old.promise : snapshot("New seller buyer"),
  });
  a.render();
  a.setProps({ sellerId: "seller-b" });
  await a.flush();
  old.resolve(snapshot("Old seller buyer"));
  await a.flush();
  assert.match(a.text, /New seller buyer/);
  assert.doesNotMatch(a.text, /Old seller buyer/);
  a.unmount();
});
test("rapid repeat submissions only dispatch one completed-order review and retain recoverable errors", async () => {
  const write = defer();
  let n = 0;
  const a = app("SellerReviews", {
    getSellerReviewPage: async () => snapshot("Buyer"),
    submitSellerReview: () => {
      n++;
      return write.promise;
    },
  });
  a.render();
  await a.flush();
  a.node("select").props.onChange({ target: { value: "order" } });
  a.render();
  a.button("4 stars").props.onClick();
  a.render();
  const submit = a.node("form").props.onSubmit;
  submit({ preventDefault() {} });
  submit({ preventDefault() {} });
  assert.equal(n, 1);
  write.reject(new Error("offline"));
  await a.flush();
  assert.match(a.text, /could not be confirmed/);
  assert.equal(a.button("Save review").props.disabled, false);
  a.unmount();
});
test("report forms suppress duplicate submissions and cannot show old-account success", async () => {
  const write = defer();
  let n = 0;
  const a = app("MarketReportForm", {
    reportMarketContent: () => {
      n++;
      return write.promise;
    },
  });
  a.render();
  a.node("select").props.onChange({ target: { value: "scam" } });
  a.render();
  const submit = a.node("form").props.onSubmit;
  submit({ preventDefault() {} });
  submit({ preventDefault() {} });
  assert.equal(n, 1);
  a.setProps({ userId: "new-buyer" });
  await a.flush();
  write.resolve("report-id");
  await a.flush();
  assert.doesNotMatch(a.text, /Report received/);
  assert.equal(a.node("select").props.value, "");
  a.unmount();
});

test("changing accounts hides the previous completed purchases on the first render", async () => {
  const a = app("SellerReviews", {
    getSellerReviewPage: async () => snapshot("Private previous purchase"),
  });
  a.render();
  await a.flush();
  assert.match(a.text, /Private previous purchase/);
  a.setProps({ viewerId: "different-account" });
  assert.doesNotMatch(a.text, /Private previous purchase/);
  a.unmount();
});
