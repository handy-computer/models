export const fmtErr = (x: number | null | undefined): string => x == null ? '—' : x.toFixed(2);
export const fmtX = (x: number | null | undefined): string => x == null ? '—' : x.toFixed(1) + '×';
export const fmtGB = (x: number | null | undefined): string => x == null ? '—' : x.toFixed(2) + ' GB';
/** "+0.66" / "−0.12"; a value that rounds to zero is "+0.00" */
export function fmtSigned(x: number | null | undefined, digits = 2): string {
  if (x == null) return '—';
  const s = Math.abs(x).toFixed(digits);
  return (x < 0 && Number(s) !== 0 ? '−' : '+') + s;
}
/** "+6.5%" */
export const fmtPct = (x: number | null | undefined): string => x == null ? '—' : fmtSigned(x, 1) + '%';
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}
