export const fmtErr = (x: number | null | undefined): string => x == null ? '—' : x.toFixed(2);
export const fmtX = (x: number | null | undefined): string => x == null ? '—' : x.toFixed(1) + '×';
export const fmtGB = (x: number | null | undefined): string => x == null ? '—' : x.toFixed(2) + ' GB';
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}
