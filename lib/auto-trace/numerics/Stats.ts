export function mean(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i]!;
  return sum / arr.length;
}

export function median(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0;
  const copy = Array.from(arr).sort((a, b) => a - b);
  const mid = Math.floor(copy.length / 2);
  if (copy.length % 2 === 0) {
    return (copy[mid - 1]! + copy[mid]!) / 2;
  }
  return copy[mid]!;
}

export function argmin(arr: ArrayLike<number>): number {
  if (arr.length === 0) return -1;
  let minIdx = 0;
  let minVal = arr[0]!;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! < minVal) {
      minVal = arr[i]!;
      minIdx = i;
    }
  }
  return minIdx;
}

export function argsortAscending(arr: ArrayLike<number>): number[] {
  const indices = Array.from({ length: arr.length }, (_, i) => i);
  return indices.sort((a, b) => arr[a]! - arr[b]!);
}

export function argsortDescending(arr: ArrayLike<number>): number[] {
  const indices = Array.from({ length: arr.length }, (_, i) => i);
  return indices.sort((a, b) => arr[b]! - arr[a]!);
}
