export function rfftfreq(n: number): Float64Array {
  const nFreqs = Math.floor(n / 2) + 1;
  const freqs = new Float64Array(nFreqs);
  for (let i = 0; i < nFreqs; i++) {
    freqs[i] = i / n;
  }
  return freqs;
}

export function rfft(data: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = data.length;
  const nFreqs = Math.floor(n / 2) + 1;
  const re = new Float64Array(nFreqs);
  const im = new Float64Array(nFreqs);

  for (let k = 0; k < nFreqs; k++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      sumRe += data[t]! * Math.cos(angle);
      sumIm -= data[t]! * Math.sin(angle);
    }
    re[k] = sumRe;
    im[k] = sumIm;
  }

  return { re, im };
}

export function irfft(spec: { re: Float64Array; im: Float64Array }, n: number): Float64Array {
  const out = new Float64Array(n);
  const nFreqs = spec.re.length;

  for (let t = 0; t < n; t++) {
    let val = spec.re[0]!;
    for (let k = 1; k < nFreqs; k++) {
      const angle = (2 * Math.PI * k * t) / n;
      const isNyquist = (n % 2 === 0) && (k === n / 2);
      const factor = isNyquist ? 1.0 : 2.0;
      val += factor * (spec.re[k]! * Math.cos(angle) - spec.im[k]! * Math.sin(angle));
    }
    out[t] = val / n;
  }

  return out;
}
