/** Only application-owned, authenticated asset routes can be previewed or downloaded. */
export function ownedAssetPath(value: string): string | null {
  return /^\/api\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}
