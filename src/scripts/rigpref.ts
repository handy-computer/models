/* The visitor's rig, remembered across pages. Each page with a rig picker
   reads it as the default and writes it on change; a page whose options
   don't include the stored rig falls back to its own default. */

import { RIG_PREF_KEY } from '../lib/config';

export function getRigPref(allowed: string[], fallback: string): string {
  try {
    const v = localStorage.getItem(RIG_PREF_KEY);
    if (v && allowed.includes(v)) return v;
  } catch { /* storage unavailable */ }
  return fallback;
}

export function setRigPref(id: string): void {
  try { localStorage.setItem(RIG_PREF_KEY, id); } catch { /* storage unavailable */ }
}
