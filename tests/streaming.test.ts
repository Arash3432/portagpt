import assert from "node:assert/strict";
import test from "node:test";
import { abortableDelay, advanceStreamText, createSseParser, type SseEvent } from "../app/ui/streaming-text";

const encoder = new TextEncoder();

function parseChunks(bytes: Uint8Array, boundaries: number[]) {
  const events: SseEvent[] = [];
  const parser = createSseParser({ onEvent: (event) => events.push(event) });
  let offset = 0;
  for (const boundary of boundaries) {
    parser.push(bytes.subarray(offset, boundary));
    offset = boundary;
  }
  parser.push(bytes.subarray(offset));
  parser.finish();
  return events;
}

test("SSE survives every two-chunk boundary, including UTF-8, CRLF and final non-delimited event", () => {
  const bytes = encoder.encode('\uFEFF: heartbeat\r\nevent: answer\r\nid: turn-1\r\ndata: {"t":"delta",\r\ndata: "v":"سلام 👩🏽‍💻 中文"}\r\n\r\ndata: {"t":"done"}');
  const expected = [
    { event: "answer", id: "turn-1", data: '{"t":"delta",\n"v":"سلام 👩🏽‍💻 中文"}' },
    { event: "message", id: "turn-1", data: '{"t":"done"}' },
  ];
  for (let boundary = 0; boundary <= bytes.length; boundary += 1) {
    assert.deepEqual(parseChunks(bytes, [boundary]), expected, `byte boundary ${boundary}`);
  }
  assert.deepEqual(parseChunks(bytes, Array.from({ length: bytes.length }, (_, index) => index + 1)), expected);
});

test("SSE accepts LF, CRLF and bare CR without duplicate events or lost data whitespace", () => {
  for (const separator of ["\n", "\r\n", "\r"]) {
    const bytes = encoder.encode([
      ": keepalive", "event: ignored", "", "id: good", "id: bad\0id", "data:  leading", "data: trailing ", "data", "", "id:", "data: final", "", "",
    ].join(separator));
    assert.deepEqual(parseChunks(bytes, Array.from({ length: bytes.length }, (_, index) => index + 1)), [
      { event: "message", id: "good", data: " leading\ntrailing \n" },
      { event: "message", id: "", data: "final" },
    ]);
  }
});

test("EOF flushes the final data line once, but does not manufacture a missing done event", () => {
  const events: SseEvent[] = [];
  const parser = createSseParser({ onEvent: (event) => events.push(event) });
  parser.push(encoder.encode('data: {"t":"delta","v":"partial answer"}\n\ndata: {"t":"do'));
  parser.finish();
  parser.finish();
  assert.equal(events.length, 2);
  assert.equal(JSON.parse(events[0].data).v, "partial answer");
  assert.throws(() => JSON.parse(events[1].data), SyntaxError);
  assert.throws(() => parser.push(encoder.encode("ne")), /closed/);
});

test("SSE rejects malformed and terminally truncated UTF-8 instead of corrupting text", () => {
  const invalid = createSseParser({ onEvent: () => assert.fail("Invalid bytes must not dispatch") });
  assert.throws(() => invalid.push(new Uint8Array([0xc0, 0x80])), TypeError);
  const truncated = createSseParser({ onEvent: () => assert.fail("Incomplete code points must not dispatch") });
  const bytes = encoder.encode("data: 👩");
  truncated.push(bytes.subarray(0, bytes.length - 1));
  assert.throws(() => truncated.finish(), TypeError);
});

test("SSE buffer cap covers unterminated lines and accumulated multiline events", () => {
  const line = createSseParser({ onEvent: () => assert.fail(), maxBufferedChars: 32 });
  for (let index = 0; index < 32; index += 1) line.push(encoder.encode("x"));
  assert.throws(() => line.push(encoder.encode("x")), /buffer limit/);
  assert.throws(() => line.push(encoder.encode("\n")), /closed/);
  const multiline = createSseParser({ onEvent: () => assert.fail(), maxBufferedChars: 24 });
  assert.throws(() => multiline.push(encoder.encode("data: 1234567890\ndata: 1234567890\ndata: 1234567890\n")), /buffer limit/);
  const large = createSseParser({ onEvent: () => assert.fail(), maxBufferedChars: 64 });
  assert.throws(() => large.push(encoder.encode("x".repeat(100_000))), /buffer limit/);
});

test("SSE cap resets after each complete event and comments do not accumulate", () => {
  const events: SseEvent[] = [];
  const parser = createSseParser({ onEvent: (event) => events.push(event), maxBufferedChars: 32 });
  parser.push(encoder.encode(": heartbeat\ndata: ok\n\n".repeat(5_000)));
  parser.finish();
  assert.equal(events.length, 5_000);
  assert.ok(events.every((event) => event.data === "ok"));
});

test("abortable delay removes its abort listener after resolution and does not reject later", async (context) => {
  const controller = new AbortController();
  const add = context.mock.method(controller.signal, "addEventListener");
  const remove = context.mock.method(controller.signal, "removeEventListener");
  await abortableDelay(1, controller.signal);
  assert.equal(add.mock.callCount(), 1);
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(add.mock.calls[0].arguments[1], remove.mock.calls[0].arguments[1]);
  controller.abort();
});

test("abortable delay handles pre-aborted and mid-delay cancellation without retaining listeners", async (context) => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const add = context.mock.method(alreadyAborted.signal, "addEventListener");
  await assert.rejects(abortableDelay(10_000, alreadyAborted.signal), { name: "AbortError" });
  assert.equal(add.mock.callCount(), 0);
  const controller = new AbortController();
  const remove = context.mock.method(controller.signal, "removeEventListener");
  const reason = new Error("request stopped");
  const pending = abortableDelay(60_000, controller.signal);
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(remove.mock.callCount(), 1);
});

test("stream reveal keeps Persian, combining marks, emoji families and flags on grapheme boundaries", () => {
  const received = "سلام 👩🏽‍💻 e\u0301 🇮🇷 👨‍👩‍👧‍👦 متن پایان";
  const boundaries = new Set([0, ...Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(received), (part) => part.index + part.segment.length)]);
  let current = "";
  for (let index = 0; current !== received && index < 100; index += 1) {
    const next = advanceStreamText(current, received, { elapsedMs: 1, maxLagChars: 1_000 });
    assert.ok(next.length > current.length);
    assert.ok(received.startsWith(next));
    assert.ok(boundaries.has(next.length), `not a grapheme boundary: ${next.length}`);
    current = next;
  }
  assert.equal(current, received);
});

test("stream reveal catches up large bursts, respects reduced motion, and recovers replacement content", () => {
  const received = "a".repeat(10_000);
  assert.ok(received.length - advanceStreamText("", received).length <= 72);
  assert.equal(advanceStreamText("", received, { reducedMotion: true }), received);
  assert.equal(advanceStreamText("old answer", "new answer"), "new answer");
  assert.equal(advanceStreamText("a", received, { elapsedMs: 60_000 }), received);
  assert.equal(advanceStreamText("", received, { maxLagChars: 0 }), received);
});
