import { ERR_SCALE_MAX } from './config';

/* sequential ramp: wine, light -> dark, on cream */
export const RAMP = ['#fbd3e0', '#f6aec7', '#e987ab', '#d5628d', '#c04a75', '#a93a63', '#8b2149', '#61052f'];

export function rampColor(err: number): string {
  const t = Math.max(0, Math.min(1, err / ERR_SCALE_MAX));
  const i = Math.min(RAMP.length - 1, Math.floor(t * (RAMP.length - 1) + 0.5));
  return RAMP[i]!;
}

/* categorical series for the model set view (dots per model); the hues
   live in global.css so the SVG follows the theme */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
export const seriesColor = (i: number): string => SERIES[i % SERIES.length]!;
