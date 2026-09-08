import assert from "node:assert/strict";
import test from "node:test";
import { authError, jsonError, parseJsonBody, parseJsonResponse, readResponseBytes, requestError } from "../lib/http";
import { assertSafeMutation, clientIpFromHeaders, isAdminIpOnlyAllowed, safeEqualHex } from "../lib/security";
import { parseSessionCookie } from "../lib/session";
import { detectImage, validateGeneratedImageUrl, validMagic } from "../lib/storage";
import { POST as createImage } from "../app/api/images/route";
import { POST as createChat } from "../app/api/chat/route";
import { PATCH as changeUsername } from "../app/api/account/profile/route";
import { POST as login } from "../app/api/auth/password/login/route";

Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_URL: "postgres://test:test@localhost:5432/test", REDIS_URL: "redis://localhost:6379",
  PUBLIC_APP_URL: "http://localhost:3000", SESSION_PEPPER: "s".repeat(64), OTP_PEPPER: "o".repeat(64),
});

test("malformed forwarding slots never shift attacker input into the trusted IP", () => {
  const ip = (chain: string, hops = 1) => clientIpFromHeaders(new Headers({ "x-forwarded-for": chain, "x-real-ip": "198.51.100.8" }), hops);
  assert.equal(ip("198.51.100.7, unknown"), "unknown");
  assert.equal(ip("198.51.100.7, "), "unknown");
  assert.equal(ip("198.51.100.7, invalid, 203.0.113.5", 2), "unknown");
  assert.equal(ip("198.51.100.7, 203.0.113.5"), "203.0.113.5");
  assert.equal(ip("untrusted, 198.51.100.7, 203.0.113.5", 2), "198.51.100.7");
  assert.equal(ip("198.51.100.7", 2), "unknown");
  assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.8" }), 2), "unknown");
  assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.8" }), 1), "198.51.100.8");
  assert.equal(ip("fe80::1%eth0"), "unknown");
  assert.equal(ip("198.51.100.7", 0), "unknown");
});

test("equivalent IPv6 spellings and mapped IPv4 do not lock out allowed administrators", () => {
  assert.equal(isAdminIpOnlyAllowed("2001:db8::7", "2001:0db8:0000:0000:0000:0000:0000:0007"), true);
  assert.equal(isAdminIpOnlyAllowed("::ffff:c633:6407", "198.51.100.7"), true);
  assert.equal(isAdminIpOnlyAllowed("unknown", "invalid"), false);
});

test("malformed hex hashes cannot compare equal or crash timing-safe comparison", () => {
  for (const [left, right] of [["", ""], ["zz", "zz"], ["abxz", "abyy"], ["abc", "abc"], ["abcd", "zzzz"]]) assert.equal(safeEqualHex(left, right), false);
  assert.equal(safeEqualHex("ABCD", "abcd"), true);
});

test("session cookies accept only the issued token lengths and encoding", () => {
  const valid = `${"a".repeat(43)}.${"b".repeat(32)}`;
  assert.deepEqual(parseSessionCookie(valid), { token: "a".repeat(43), csrf: "b".repeat(32) });
  for (const value of [undefined, "", "a.b", `${valid}.extra`, ` ${valid}`, valid.replace(".", "=")]) assert.equal(parseSessionCookie(value), null);
});

test("cross-site requests and untrusted origins cannot mutate an IP-authorized account", () => {
  assert.doesNotThrow(() => assertSafeMutation(new Request("http://localhost:3000", { headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" } })));
  assert.throws(() => assertSafeMutation(new Request("http://localhost:3000", { headers: { origin: "https://evil.example" } })), /INVALID_ORIGIN/);
  assert.throws(() => assertSafeMutation(new Request("http://localhost:3000", { headers: { "sec-fetch-site": "cross-site" } })), /INVALID_ORIGIN/);
  assert.throws(() => assertSafeMutation(new Request("http://localhost:3000", { headers: { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" } })), /INVALID_ORIGIN/);
  const prior = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.throws(() => assertSafeMutation(new Request("http://localhost:3000")), /INVALID_ORIGIN/);
    assert.throws(() => assertSafeMutation(new Request("http://localhost:3000", { headers: { origin: "https://evil.example", "x-forwarded-host": "evil.example" } })), /INVALID_ORIGIN/);
  } finally { Object.assign(process.env, { NODE_ENV: prior }); }
});

test("JSON bodies enforce exact media types and reject malformed UTF-8", async () => {
  const request = (body: BodyInit, contentType = "application/json") => new Request("http://localhost", { method: "POST", headers: { "content-type": contentType }, body });
  assert.deepEqual(await parseJsonBody(request('{"نام":"سلام"}', "application/json; charset=utf-8"), 100), { نام: "سلام" });
  await assert.rejects(parseJsonBody(request("{}", "application/jsonp"), 100), /INVALID_CONTENT_TYPE/);
  await assert.rejects(parseJsonBody(request(new Uint8Array([123, 34, 97, 34, 58, 34, 0xff, 34, 125])), 100), /INVALID_JSON/);
  await assert.rejects(parseJsonBody(request('{"long":true}'), 3), /BODY_TOO_LARGE/);
  await assert.rejects(parseJsonResponse(new Response('{"broken"'), 100), /INVALID_UPSTREAM_JSON/);
});

test("chunked upstream downloads stop at the byte limit and cancel the source", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(4)); }, cancel() { cancelled = true; } });
  const response = new Response(body);
  await assert.rejects(readResponseBytes(response, 6, "IMAGE_TOO_LARGE"), /IMAGE_TOO_LARGE/);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
  assert.deepEqual(Array.from(await readResponseBytes(new Response(new Uint8Array([1, 2, 3])), 3)), [1, 2, 3]);
});

test("oversized declared upstream responses are cancelled before buffering", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await assert.rejects(readResponseBytes(new Response(body, { headers: { "content-length": "900" } }), 10), /UPSTREAM_BODY_TOO_LARGE/);
  assert.equal(cancelled, true);
});

test("image URLs need an allowlisted HTTPS public hostname without credentials or redirect ports", () => {
  assert.equal(validateGeneratedImageUrl("https://cdn.example/image.png?token=abc", "cdn.example"), "https://cdn.example/image.png?token=abc");
  for (const value of ["http://cdn.example/x", "https://user:pass@cdn.example/x", "https://cdn.example:444/x", "https://127.0.0.1/x", "https://[::1]/x", "https://localhost/x", "https://169.254.169.254/x"]) {
    assert.throws(() => validateGeneratedImageUrl(value, "cdn.example,127.0.0.1,::1,localhost,169.254.169.254"), /INVALID_IMAGE_SOURCE/);
  }
  assert.throws(() => validateGeneratedImageUrl("https://cdn.example.evil.example/x", "cdn.example"), /IMAGE_URL_NOT_ALLOWLISTED/);
});

test("image signature checks reject truncated PNG, fake RIFF and incomplete GIF headers", () => {
  assert.throws(() => detectImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), /UNSUPPORTED_IMAGE_FORMAT/);
  assert.equal(validMagic(new TextEncoder().encode("GIF8xx"), "image/gif"), false);
  assert.equal(validMagic(new TextEncoder().encode("GIF89a"), "image/gif"), true);
  assert.equal(validMagic(new TextEncoder().encode("RIFF1234WEBP"), "image/webp"), true);
  assert.equal(validMagic(new TextEncoder().encode("RIFX1234WEXX"), "image/webp"), false);
  assert.equal(validMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"), true);
});

test("API failures preserve Headers and never turn security errors into service outages", () => {
  const response = jsonError("limited", 429, new Headers({ "retry-after": "30", "cache-control": "public" }));
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(authError("LIMIT", "limited", 429, [["retry-after", "10"]]).headers.get("retry-after"), "10");
  for (const [code, status] of [["UNAUTHORIZED", 401], ["INVALID_CSRF", 403], ["INVALID_ORIGIN", 403], ["INVALID_JSON", 400], ["BODY_TOO_LARGE", 413], ["INVALID_CONTENT_TYPE", 415]] as const) assert.equal(requestError(new Error(code))?.status, status);
  assert.equal(requestError(new Error("DATABASE_DOWN")), null);
});

test("protected mutation routes reject hostile origins before session, quota or provider work", async () => {
  for (const [handler, method] of [[createImage, "POST"], [createChat, "POST"], [changeUsername, "PATCH"], [login, "POST"]] as const) {
    const response = await handler(new Request("http://localhost:3000/api", { method, headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "INVALID_ORIGIN");
  }
});
