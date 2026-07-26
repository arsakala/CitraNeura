/**
 * Minimal row-major Float64 matrix. This is the numerical substrate for the
 * region / matched-filter-response arrays throughout the port — deliberately
 * NOT a general-purpose ndarray: only the operations autotrace_v2 actually
 * needs (row access, per-row/per-column reduction, clamped copy) are here.
 */
export interface Matrix2D {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;
}

export function makeMatrix(rows: number, cols: number, fill = 0): Matrix2D {
  const data = new Float64Array(rows * cols);
  if (fill !== 0) data.fill(fill);
  return { rows, cols, data };
}

export function matrixFrom2DArray(values: readonly (readonly number[])[]): Matrix2D {
  const rows = values.length;
  const cols = rows > 0 ? values[0]!.length : 0;
  const data = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const row = values[r]!;
    if (row.length !== cols) {
      throw new Error("matrixFrom2DArray: ragged input (§N4 fail loud)");
    }
    for (let c = 0; c < cols; c++) data[r * cols + c] = row[c]!;
  }
  return { rows, cols, data };
}

export function getRow(m: Matrix2D, r: number): Float64Array {
  return m.data.subarray(r * m.cols, (r + 1) * m.cols);
}

export function setRow(m: Matrix2D, r: number, values: Float64Array): void {
  m.data.set(values, r * m.cols);
}

export function cloneMatrix(m: Matrix2D): Matrix2D {
  return { rows: m.rows, cols: m.cols, data: m.data.slice() };
}

/** Per-column values as a fresh Float64Array (copies, since columns are not
 * contiguous in row-major storage). */
export function getColumn(m: Matrix2D, c: number): Float64Array {
  const out = new Float64Array(m.rows);
  for (let r = 0; r < m.rows; r++) out[r] = m.data[r * m.cols + c]!;
  return out;
}
