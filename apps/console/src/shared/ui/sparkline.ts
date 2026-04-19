const SPARK_CHARS = "▁▂▃▄▅▆▇█";

export function confidenceBar(value: number, length = 8): string {
  const v = Math.max(0, Math.min(1, value));
  const max = SPARK_CHARS.length - 1;
  let out = "";
  for (let i = 0; i < length; i++) {
    const cellEnd = (i + 1) / length;
    if (cellEnd <= v) {
      out += SPARK_CHARS[max];
    } else {
      const frac = Math.max(0, v - i / length) * length;
      const idx = Math.max(0, Math.min(max, Math.floor(frac * SPARK_CHARS.length)));
      out += SPARK_CHARS[idx];
    }
  }
  return out;
}
