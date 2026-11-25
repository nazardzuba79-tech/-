type Point = { label: string; capital: number };
export function scenarioCapital(
  initial: number,
  monthlyRate: number,
  months: number,
): Point[] {
  if (
    !Number.isFinite(initial) ||
    initial < 0.01 ||
    !Number.isFinite(monthlyRate) ||
    monthlyRate < -100 ||
    ![1, 3, 12, 24].includes(months)
  )
    return [];
  const points = Array.from({ length: months + 1 }, (_, i) => ({
    label: i ? "Мес. " + i : "Старт",
    capital: initial * (1 + monthlyRate / 100) ** i,
  }));
  return points.every(point => Number.isFinite(point.capital)) ? points : [];
}
