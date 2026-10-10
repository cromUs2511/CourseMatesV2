/** Fingerprint peer photos for a safety report.
 *
 * Only SHA-256 hashes leave the device — never image bytes — so moderators
 * can denylist a confirmed photo without storing anyone's pictures. Fetches
 * the already-cached room images (same-origin, cookie-authenticated) and is
 * fully best-effort: a report is just as valid with zero hashes attached.
 */
export async function collectPeerImageHashes(
  messages: Array<{ isMe?: boolean; images?: Array<{ url: string }> }>,
  limit = 8,
): Promise<string[]> {
  const urls: string[] = [];
  for (const message of messages) {
    if (message.isMe) continue;
    for (const image of message.images ?? []) {
      if (typeof image.url === 'string' && image.url.startsWith('/api/chat/')) urls.push(image.url);
    }
  }
  const hashes: string[] = [];
  for (const url of [...new Set(urls)].slice(0, Math.max(1, Math.min(20, limit)))) {
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      hashes.push(
        [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      );
    } catch {
      /* One unreachable photo never blocks a safety report. */
    }
  }
  return hashes;
}
