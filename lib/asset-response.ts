const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DOWNLOAD_TYPES = new Set([
  "application/pdf", "text/plain", "text/markdown", "application/json", "text/csv", "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** A file name is display metadata, never a path or an executable response header. */
export function safeAssetFilename(originalName: string): string {
  const cleaned = [...originalName.toWellFormed().normalize("NFC")]
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code >= 32 && !(code >= 127 && code <= 159)
        && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069);
    })
    .join("")
    .replace(/[/\\:"<>|?*]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return [...cleaned].slice(0, 180).join("") || "portal-file.bin";
}

export function assetResponseHeaders(file: {
  original_name: string;
  mime_type: string;
  size_bytes: number;
}, download: boolean): Headers {
  const declaredType = file.mime_type.trim().toLowerCase();
  const inlineImage = INLINE_IMAGE_TYPES.has(declaredType);
  const contentType = inlineImage || DOWNLOAD_TYPES.has(declaredType) ? declaredType : "application/octet-stream";
  const filename = safeAssetFilename(file.original_name);
  const asciiName = [...filename].map((character) => /^[\x20-\x7E]$/.test(character) ? character : "_").join("");
  const encodedName = encodeURIComponent(filename).replace(/['()!*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const disposition = download || !inlineImage ? "attachment" : "inline";
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "vary": "Cookie",
  });
  // Invalid metadata must never become a malformed or negative framing header.
  const size = Number(file.size_bytes);
  if (Number.isSafeInteger(size) && size >= 0) headers.set("content-length", String(size));
  return headers;
}
