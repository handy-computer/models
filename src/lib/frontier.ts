/* Pareto frontier of (speed, error) points: a point is on the frontier when
   no other point is at least as fast AND at least as accurate, with one of
   the two strictly better. Shared by the scatter (per rig) and the language
   tables (fixed to the Handy GPU rig). Isomorphic. */

export interface FrontierPoint { id: string; x: number; y: number }

export function paretoFrontier(points: FrontierPoint[]): Set<string> {
  const out = new Set<string>();
  for (const p of points) {
    const dominated = points.some(q => q !== p &&
      q.x >= p.x && q.y <= p.y && (q.x > p.x || q.y < p.y));
    if (!dominated) out.add(p.id);
  }
  return out;
}
