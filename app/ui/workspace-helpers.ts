export type HistoryBucket = "today" | "yesterday" | "week" | "older";

/** Compare local calendar dates, so a daylight-saving change is still one day. */
export function groupHistory<T extends { updated_at: string }>(items: T[], now = new Date()) {
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = day(now);
  const groups = new Map<HistoryBucket, T[]>();
  for (const item of items) {
    const difference = Math.floor((today - day(new Date(item.updated_at))) / 86_400_000);
    const bucket: HistoryBucket = !Number.isFinite(difference) ? "older"
      : difference <= 0 ? "today" : difference === 1 ? "yesterday" : difference < 7 ? "week" : "older";
    groups.set(bucket, [...(groups.get(bucket) || []), item]);
  }
  return (["today", "yesterday", "week", "older"] as const)
    .filter((bucket) => groups.has(bucket))
    .map((bucket) => ({ bucket, items: groups.get(bucket)! }));
}

/** Style controls insert ordinary editable text; they never add unsupported API options. */
export function appendPromptStyle(prompt: string, style: string, limit = 5000) {
  if (prompt.includes(style)) return prompt;
  const next = prompt.trim() ? `${prompt.trimEnd()}\n${style}` : style;
  return next.length <= limit ? next : prompt;
}

export function draftFromQuery(value: string | null, mode: "text" | "image") {
  return value === null ? null : value.slice(0, mode === "image" ? 5000 : 16000);
}
