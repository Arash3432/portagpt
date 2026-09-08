export type SseEvent = { event: string; data: string; id?: string };

type SseParserOptions = {
  onEvent: (event: SseEvent) => void;
  /** Bounds an unfinished frame, including a line that never terminates. */
  maxBufferedChars?: number;
};

/** Incremental SSE framing. Transport chunks are neither UTF-8 nor event boundaries. */
export function createSseParser({ onEvent, maxBufferedChars = 1_048_576 }: SseParserOptions) {
  if (!Number.isSafeInteger(maxBufferedChars) || maxBufferedChars < 1) {
    throw new RangeError("Invalid SSE buffer limit");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let lineParts: string[] = [];
  let lineChars = 0;
  let dataParts: string[] = [];
  let dataChars = 0;
  let eventType = "";
  let lastEventId: string | undefined;
  let skipLf = false;
  let closed = false;

  const checkLimit = () => {
    if (lineChars + dataChars + eventType.length + (lastEventId?.length ?? 0) > maxBufferedChars) {
      closed = true;
      throw new RangeError("SSE frame exceeds buffer limit");
    }
  };
  const appendLine = (part: string) => {
    if (!part) return;
    lineChars += part.length;
    checkLimit();
    lineParts.push(part);
  };
  const dispatch = () => {
    const event: SseEvent | null = dataParts.length
      ? { event: eventType || "message", data: dataParts.join("\n"), ...(lastEventId === undefined ? {} : { id: lastEventId }) }
      : null;
    dataParts = [];
    dataChars = 0;
    eventType = "";
    if (event) onEvent(event);
  };
  const consumeLine = () => {
    const line = lineParts.join("");
    lineParts = [];
    lineChars = 0;
    if (!line) {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") {
      dataParts.push(value);
      dataChars += value.length + 1;
    } else if (field === "event") {
      eventType = value;
    } else if (field === "id" && !value.includes("\0")) {
      lastEventId = value;
    }
    checkLimit();
  };
  const consume = (value: string) => {
    if (!value) return;
    let start = skipLf && value[0] === "\n" ? 1 : 0;
    skipLf = false;
    for (let index = start; index < value.length; index += 1) {
      const char = value[index];
      if (char !== "\r" && char !== "\n") continue;
      appendLine(value.slice(start, index));
      consumeLine();
      if (char === "\r") {
        if (value[index + 1] === "\n") index += 1;
        else if (index === value.length - 1) skipLf = true;
      }
      start = index + 1;
    }
    appendLine(value.slice(start));
  };

  return {
    push(chunk: Uint8Array) {
      if (closed) throw new Error("SSE parser is closed");
      try {
        // Decode bounded slices even when the transport hands us one huge chunk.
        for (let offset = 0; offset < chunk.length; offset += 16_384) {
          consume(decoder.decode(chunk.subarray(offset, offset + 16_384), { stream: true }));
        }
      } catch (error) {
        closed = true;
        throw error;
      }
    },
    finish() {
      if (closed) return;
      closed = true;
      consume(decoder.decode());
      if (lineParts.length) consumeLine();
      // Our fetch protocol also accepts a complete final frame at EOF. JSON
      // validation belongs to the caller; incomplete payloads never become success.
      dispatch();
    },
  };
}

/** Clears both the timer and abort listener on every completion path. */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

let graphemeSegmenter: Intl.Segmenter | undefined;

/** Reveals only received text, with bounded catch-up and intact grapheme clusters. */
export function advanceStreamText(
  current: string,
  received: string,
  options: { elapsedMs?: number; reducedMotion?: boolean; maxLagChars?: number } = {},
): string {
  if (options.reducedMotion || !received.startsWith(current) || current === received) return received;
  if (typeof Intl.Segmenter !== "function") return received;
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const elapsed = Number.isFinite(options.elapsedMs) ? Math.max(0, options.elapsedMs!) : 16;
  const maxLag = Number.isFinite(options.maxLagChars) ? Math.max(0, options.maxLagChars!) : 72;
  const step = Math.max(3, Math.ceil(elapsed * 0.75));
  const target = Math.min(received.length, Math.max(current.length + step, received.length - maxLag));
  if (target >= received.length) return received;
  const grapheme = graphemeSegmenter.segment(received).containing(target - 1);
  return received.slice(0, grapheme ? grapheme.index + grapheme.segment.length : target);
}
