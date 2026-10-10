/** On-device nudity pre-screen for outgoing photos.
 *
 * Pure pixel math with no dependencies, shared by the browser composer (which
 * decodes via canvas) and unit tests. It is a conservative first layer, not a
 * verdict: it only refuses blatant full-frame skin exposure. Grayscale images,
 * small thumbnails, and ordinary portraits always pass; user reports plus the
 * server image-hash denylist remain the backstop for everything else.
 */

export const NUDITY_SCREEN_MIN_SIDE = 48;
const NUDITY_BLOCK_SKIN_RATIO = 0.6;
const NUDITY_BLOCK_CENTER_RATIO = 0.55;
const NUDITY_BLOCK_BLOB_RATIO = 0.5;

export type NudityScreenResult = {
  allowed: boolean;
  /** 0–100 exposure score, for messaging and tests. */
  score: number;
  skinRatio: number;
  centerRatio: number;
  /** Largest connected skin region as a fraction of all skin. */
  blobRatio: number;
};

/** Classic RGB skin rule (Kovac/Chai style): needs real chroma, so grayscale
 * photos, documents, and most landscapes never qualify as skin.
 */
export function isSkinPixel(r: number, g: number, b: number): boolean {
  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    Math.max(r, g, b) - Math.min(r, g, b) > 15 &&
    Math.abs(r - g) > 15 &&
    r > g &&
    r > b
  );
}

const empty: NudityScreenResult = {
  allowed: true,
  score: 0,
  skinRatio: 0,
  centerRatio: 0,
  blobRatio: 0,
};

export function screenImagePixels(
  data: ArrayLike<number>,
  width: number,
  height: number,
): NudityScreenResult {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < NUDITY_SCREEN_MIN_SIDE ||
    height < NUDITY_SCREEN_MIN_SIDE ||
    data.length < width * height * 4
  )
    return { ...empty };
  const total = width * height;
  const mask = new Uint8Array(total);
  let skin = 0;
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    if ((data[offset + 3] ?? 255) < 128) continue;
    if (isSkinPixel(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0)) {
      mask[index] = 1;
      skin += 1;
    }
  }
  if (!skin) return { ...empty };
  const skinRatio = skin / total;

  const left = Math.floor(width / 4);
  const right = Math.ceil((width * 3) / 4);
  const top = Math.floor(height / 5);
  const bottom = Math.ceil((height * 4) / 5);
  let centerSkin = 0;
  let centerTotal = 0;
  for (let y = top; y < bottom; y += 1)
    for (let x = left; x < right; x += 1) {
      centerTotal += 1;
      if (mask[y * width + x]) centerSkin += 1;
    }
  const centerRatio = centerTotal ? centerSkin / centerTotal : 0;

  // Largest 4-connected skin blob: a single dominant region (a body) scores
  // far higher than scattered speckles (a crowd, a beach, confetti).
  const seen = new Uint8Array(total);
  let biggest = 0;
  const stack: number[] = [];
  for (let seed = 0; seed < total; seed += 1) {
    if (!mask[seed] || seen[seed]) continue;
    let size = 0;
    stack.push(seed);
    seen[seed] = 1;
    while (stack.length) {
      const current = stack.pop()!;
      size += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbors = [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ];
      for (const next of neighbors)
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
    }
    if (size > biggest) biggest = size;
  }
  const blobRatio = biggest / skin;
  const score = Math.round(100 * (skinRatio * 0.6 + centerRatio * 0.4));
  const allowed = !(
    skinRatio >= NUDITY_BLOCK_SKIN_RATIO &&
    centerRatio >= NUDITY_BLOCK_CENTER_RATIO &&
    blobRatio >= NUDITY_BLOCK_BLOB_RATIO
  );
  return { allowed, score, skinRatio, centerRatio, blobRatio };
}
