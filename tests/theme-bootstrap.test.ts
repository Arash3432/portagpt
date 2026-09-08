import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

// Execute the real before-paint script, including preferences left by older releases.
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const bootstrap = layout.match(/const bootstrapScript = `([^`]+)`;/)?.[1] || "";
assert.ok(bootstrap, "the layout must expose its before-paint bootstrap script");

function applyBootstrap(saved: Record<string, string>, prefersLight = false, storageBlocked = false) {
  const root = {
    dataset: {} as Record<string, string>,
    lang: "fa",
    dir: "rtl",
    classList: { add() {} },
  };
  runInNewContext(bootstrap, {
    document: { documentElement: root },
    window: { matchMedia: () => ({ matches: prefersLight }) },
    localStorage: {
      getItem(key: string) {
        if (storageBlocked) throw new Error("Storage access is denied");
        return saved[key] ?? null;
      },
    },
  }, { timeout: 500 });
  return root;
}

test("explicit theme choices beat stale resolved values from older releases before paint", () => {
  assert.equal(applyBootstrap({ "portal-theme-choice": "dark", "portal-theme": "light" }, true).dataset.theme, "dark");
  assert.equal(applyBootstrap({ "portal-theme-choice": "light", "portal-theme": "dark" }).dataset.theme, "light");
});

test("system choice resolves from the device while legacy preferences remain supported", () => {
  assert.equal(applyBootstrap({ "portal-theme-choice": "system", "portal-theme": "dark" }, true).dataset.theme, "light");
  assert.equal(applyBootstrap({ "portal-theme-choice": "system", "portal-theme": "light" }).dataset.theme, "dark");
  assert.equal(applyBootstrap({ "portal-theme": "light" }).dataset.theme, "light");
  assert.equal(applyBootstrap({}).dataset.theme, "dark");
});

test("blocked browser storage does not prevent the page from rendering", () => {
  assert.doesNotThrow(() => applyBootstrap({}, false, true));
});
