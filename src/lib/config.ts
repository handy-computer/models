/* Site-wide constants. Everything the old app.js hardcoded inline lives here. */

/* Site identity. The site lives at models.handy.computer; keep SITE_URL in
   step with `site` in astro.config.mjs and the route in wrangler.jsonc. */
export const SITE_NAME = 'Handy models';
/** header wordmark; lowercase like the handy.computer logo and nav */
export const WORDMARK = 'handy models';
export const SITE_URL = 'https://models.handy.computer';
export const HANDY_URL = 'https://handy.computer';
export const ENGINE_URL = 'https://github.com/handy-computer/transcribe.cpp';
export const SITE_TITLE = 'Handy models · speech-to-text benchmarks';
export const SITE_DESCRIPTION =
  'Accuracy and speed of every speech-to-text model Handy can run, measured per language on FLEURS, with a recommended pick.';

/** `<title>` for an inner page: "German · Handy models" */
export function pageTitle(part: string): string {
  return `${part} · ${SITE_NAME}`;
}

export const DEFAULT_LANG = 'en';
export const DEFAULT_MODEL = 'whisper-large-v3-turbo';

export interface Rig {
  id: string;
  rig: string;
  backend: string;
  label: string;
  short: string;
}

/* Handy target hardware represented in the DB's perf and rigs tables. The
   labels and backend choices remain UI policy, so they live here. */
export const RIGS: Rig[] = [
  { id: 'r-gpu', rig: 'ryzen-4750u', backend: 'vulkan', label: 'AMD Ryzen 4750U GPU (Vulkan)', short: 'AMD 4750U GPU' },
  { id: 'r-cpu', rig: 'ryzen-4750u', backend: 'cpu',    label: 'AMD Ryzen 4750U CPU',          short: 'AMD 4750U CPU' },
  { id: 'm-gpu', rig: 'm4-max',      backend: 'metal',  label: 'M4 Max GPU (Metal)', short: 'M4 GPU' },
  { id: 'm-cpu', rig: 'm4-max',      backend: 'cpu',    label: 'M4 Max CPU',         short: 'M4 CPU' },
];

export function rigById(id: string): Rig {
  const r = RIGS.find(x => x.id === id);
  if (!r) throw new Error(`unknown rig id: ${id}`);
  return r;
}

/** heatmap ramp clamps here ("30+") */
export const ERR_SCALE_MAX = 30;

/** scatter y-axis cap; points above are pinned as open triangles */
export const SCATTER_Y_CAP = 50;

/** rigs shown in tables and on the models tab: the Handy target machine
    only. M4 numbers are hidden for now; only the scatter's rig picker
    offers them. */
export const MODEL_RIGS: Rig[] = RIGS.filter(r => r.rig === 'ryzen-4750u');

/** localStorage key for the visitor's rig, shared by every page with a rig picker */
export const RIG_PREF_KEY = 'handy-models.rig';

/* Pick scoring (see README "Picks"). Score = error + k × seconds waited after a
   dictation of `dictationS` seconds. `fast` uses fastK. Streaming models are
   treated as waiting streamWaitS as long as they keep up with realtime. */
export const SCORE = {
  k: 2,
  fastK: 6,
  dictationS: 10,
  streamWaitS: 0.3,
  accurateMaxWaitS: 5,
};
/** rig the picks are scored on: a modest laptop GPU */
export const PICK_RIG = 'r-gpu';
