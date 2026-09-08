import assert from "node:assert/strict";
import test from "node:test";
import { assetResponseHeaders, safeAssetFilename } from "../lib/asset-response";
import { ownedAssetPath } from "../lib/asset-url";

const image = { original_name: "تصویر من.png", mime_type: "image/png", size_bytes: 1024 };

test("owned asset paths reject external origins, executable schemes and ambiguous routes", () => {
  const asset = "/api/assets/34f4c4d0-79cc-42e9-80f6-6c933ac2c2aa";
  assert.equal(ownedAssetPath(asset), asset);
  assert.equal(ownedAssetPath(asset.toUpperCase().replace("/API/ASSETS/", "/api/assets/")), asset.toUpperCase().replace("/API/ASSETS/", "/api/assets/"));
  for (const value of [
    `https://attacker.test${asset}`, `//attacker.test${asset}`, "javascript:alert(1)", "data:image/svg+xml,<svg />",
    `${asset}?download=1`, `${asset}#fragment`, `${asset}/../logout`, `${asset}\n`, " /api/assets/123", "/api/assets/%2e%2e",
  ]) assert.equal(ownedAssetPath(value), null, value);
});

test("raster images preview inline and the same asset can explicitly download as attachment", () => {
  const preview = assetResponseHeaders(image, false);
  const download = assetResponseHeaders(image, true);
  assert.match(preview.get("content-disposition")!, /^inline;/);
  assert.match(download.get("content-disposition")!, /^attachment;/);
  assert.ok(download.get("content-disposition")!.includes(`filename*=UTF-8''${encodeURIComponent(image.original_name)}`));
  assert.equal(download.get("content-type"), "image/png");
  assert.equal(download.get("content-length"), "1024");
  assert.equal(download.get("cross-origin-resource-policy"), "same-origin");
  assert.match(download.get("cache-control")!, /private.*no-store/);
  assert.equal(download.get("vary"), "Cookie");
  assert.equal(download.get("x-content-type-options"), "nosniff");
  assert.match(download.get("content-security-policy")!, /sandbox/);
});

test("active and unrecognized file content is always downloaded as inert binary", () => {
  for (const mime_type of ["text/html", "image/svg+xml", "text/javascript", "text/typescript", "text/html\r\nx-injected: yes"]) {
    const headers = assetResponseHeaders({ ...image, mime_type }, false);
    assert.equal(headers.get("content-type"), "application/octet-stream");
    assert.match(headers.get("content-disposition")!, /^attachment;/);
    assert.equal(headers.get("x-injected"), null);
  }
  const pdf = assetResponseHeaders({ ...image, mime_type: "application/pdf" }, false);
  assert.equal(pdf.get("content-type"), "application/pdf");
  assert.match(pdf.get("content-disposition")!, /^attachment;/);
});

test("download filenames preserve localized names while removing controls and path delimiters", () => {
  assert.equal(safeAssetFilename("تصویر من.png"), "تصویر من.png");
  assert.equal(safeAssetFilename(" ... "), "portal-file.bin");
  const name = safeAssetFilename('../../danger\\name"\r\n.svg\u202e.exe');
  assert.equal(name.includes("/"), false);
  assert.equal(name.includes("\\"), false);
  assert.equal(name.includes('"'), false);
  assert.equal(name.includes("\r"), false);
  assert.equal(name.includes("\n"), false);
  assert.equal(name.includes("\u202e"), false);
  const headers = assetResponseHeaders({ ...image, original_name: "a'()!*.png\ud800" }, true);
  assert.ok(headers.get("content-disposition")!.includes("a%27%28%29%21_.png%EF%BF%BD"));
  assert.equal([...safeAssetFilename("💡".repeat(300))].length, 180);
});

test("invalid asset length metadata never produces an unsafe content-length", () => {
  for (const size_bytes of [-1, Infinity, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(assetResponseHeaders({ ...image, size_bytes }, false).has("content-length"), false);
  }
  assert.equal(assetResponseHeaders({ ...image, size_bytes: 0 }, true).get("content-length"), "0");
});
