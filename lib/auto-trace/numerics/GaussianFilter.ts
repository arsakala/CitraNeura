import { Matrix2D, makeMatrix } from "../model/Matrix";

export function gaussianFilter1dRows(matrix: Matrix2D, sigma: number): Matrix2D {
  const out = makeMatrix(matrix.rows, matrix.cols);
  if (sigma <= 0 || matrix.cols <= 1) {
    out.data.set(matrix.data);
    return out;
  }

  const radius = Math.ceil(sigma * 3);
  const kernelSize = 2 * radius + 1;
  const kernel = new Float64Array(kernelSize);
  let kernelSum = 0;
  for (let i = -radius; i <= radius; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = val;
    kernelSum += val;
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= kernelSum;

  const { rows, cols, data } = matrix;
  for (let r = 0; r < rows; r++) {
    const rowOffset = r * cols;
    for (let c = 0; c < cols; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const nc = Math.min(Math.max(c + k, 0), cols - 1);
        acc += data[rowOffset + nc]! * kernel[k + radius]!;
      }
      out.data[rowOffset + c] = acc;
    }
  }
  return out;
}
