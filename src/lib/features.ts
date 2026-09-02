/* Model-card capabilities as badge text. Shared by the server-rendered
   FeatureBadges component and the client-rendered model set table. */
import type { ModelInfo } from './types';

export interface Feature { full: string; short: string }

export function features(m: ModelInfo): Feature[] {
  const items: [unknown, string, string][] = [
    [m.streaming, 'streaming', 'stream'],
    [m.translate, 'translate', 'xlate'],
    [m.lang_detect, 'lang detect', 'detect'],
    [m.timestamps && m.timestamps !== 'none', `timestamps (${m.timestamps})`, 'ts'],
  ];
  return items.filter(([v]) => Boolean(v)).map(([, full, short]) => ({ full, short }));
}
