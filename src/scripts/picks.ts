/* DOM versions of PickTags.astro and AutoDetectBadge.astro for the set island. */

import type { Derived, Picks } from '../lib/derive';
import { pickTagsFor } from '../lib/derive';
import { el } from './dom';
import { attachTip, tipShow } from './tooltip';

export function autoDetectBadge(d: Derived, model: string, multi: boolean): HTMLElement | null {
  const note = d.autoDetectNote(model, multi);
  if (!note) return null;
  const b = el('span', { class: 'warn-icon', role: 'img', tabindex: '0', 'aria-label': note, title: note, text: '!' });
  attachTip(b, () => tipShow('no auto language detection', [[note, '']]));
  return b;
}

export function pickTags(picks: Picks, model: string): HTMLElement[] {
  return pickTagsFor(picks, model).map(t => {
    const tag = el('span', { class: `pick-tag pick-tag--${t.key}`, text: t.label });
    const tip = t.tip;
    if (tip) {
      tag.setAttribute('tabindex', '0');
      tag.setAttribute('title', tip);
      attachTip(tag, () => tipShow(t.label, [[tip, '']]));
    }
    return tag;
  });
}

export const isPick = (picks: Picks, model: string): boolean =>
  [picks.overall, picks.accurate, picks.fast].some(p => p?.model === model);
