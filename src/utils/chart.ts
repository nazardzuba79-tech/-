export function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value) => (value - min) / span);
}

export function linePath(values: number[], padding = 6): string {
  const scaled = normalize(values);
  const step = 100 / (values.length - 1);
  return scaled.map((value, index) => {
    const x = index * step;
    const y = 100 - padding - value * (100 - padding * 2);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

export function areaPath(values: number[], padding = 6): string {
  return `${linePath(values, padding)} L100,100 L0,100 Z`;
}
