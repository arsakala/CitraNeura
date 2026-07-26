export function uniformFilter1dNearestOdd(seg: Float64Array, size: number): Float64Array {
  const len = seg.length;
  const out = new Float64Array(len);
  if (len === 0) return out;

  let winSize = Math.max(1, Math.floor(size));
  if (winSize % 2 === 0) winSize += 1;
  const radius = Math.floor(winSize / 2);

  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = Math.min(Math.max(i + k, 0), len - 1);
      sum += seg[idx]!;
    }
    out[i] = sum / winSize;
  }

  return out;
}
