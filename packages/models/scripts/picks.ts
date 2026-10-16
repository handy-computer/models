// A compact, diffable record of every pick the method makes: each language
// alone, each language with English, and each pair of recommendable
// languages. The same enumerator runs against Pi Voice's original code (to
// prove the move) and against this package (to show what a change does).

type Model = { readonly id: string; readonly languages: readonly string[] };
type Pick = { model: { id: string }; roles: string[]; status: string };

export type PickApi<M extends Model> = {
  models: readonly M[];
  recommendModels: (models: readonly M[], languages: readonly string[]) => Pick[];
  getPreferredRecommendationLanguages: (models: readonly M[]) => string[];
  languageIdentity: (language: string) => string;
};

export type PickSnapshot = {
  preferredLanguages: string[];
  /** "en+de" -> "status best fast accurate" */
  picks: Record<string, string>;
};

const ROLES = ["Best", "Fast", "Accurate"] as const;

/** Every changed pick in words, e.g. "en+bg: Best canary-1b-v2 → parakeet-ultra". */
export function describeChanges(before: PickSnapshot, after: PickSnapshot): string[] {
  const lines: string[] = [];
  const keys = [...new Set([...Object.keys(before.picks), ...Object.keys(after.picks)])].sort();
  for (const key of keys) {
    const [oldPick, newPick] = [before.picks[key], after.picks[key]];
    if (oldPick === newPick) continue;
    if (!oldPick || !newPick) {
      lines.push(`${key}: ${oldPick ? "no longer offered" : `new (${newPick})`}`);
      continue;
    }
    const [oldStatus, ...oldRoles] = oldPick.split(" ");
    const [newStatus, ...newRoles] = newPick.split(" ");
    const parts = ROLES.flatMap((role, index) =>
      oldRoles[index] === newRoles[index] ? [] : [`${role} ${oldRoles[index]} → ${newRoles[index]}`],
    );
    if (oldStatus !== newStatus) parts.push(`status ${oldStatus} → ${newStatus}`);
    lines.push(`${key}: ${parts.join("; ")}`);
  }
  const added = after.preferredLanguages.filter((language) => !before.preferredLanguages.includes(language));
  const removed = before.preferredLanguages.filter((language) => !after.preferredLanguages.includes(language));
  if (added.length) lines.push(`now recommendable: ${added.join(", ")}`);
  if (removed.length) lines.push(`no longer recommendable: ${removed.join(", ")}`);
  return lines;
}

export function pickSnapshot<M extends Model>(api: PickApi<M>): PickSnapshot {
  const languages = [...new Set(api.models.flatMap((model) => model.languages.map(api.languageIdentity)))].sort();
  const preferred = api.getPreferredRecommendationLanguages(api.models);
  const sets = new Map<string, string[]>();
  const add = (set: string[]) => sets.set(set.join("+"), set);
  for (const language of languages) add([language]);
  for (const language of languages) if (language !== "en") add(["en", language]);
  const sorted = [...preferred].sort();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) add([sorted[i]!, sorted[j]!]);
  }
  const picks: Record<string, string> = {};
  for (const [key, set] of sets) {
    const recommendations = api.recommendModels(api.models, set);
    const role = (name: string) => recommendations.find((pick) => pick.roles.includes(name))?.model.id ?? "-";
    picks[key] = [recommendations[0]?.status ?? "none", role("best"), role("fast"), role("accurate")].join(" ");
  }
  return { preferredLanguages: preferred, picks };
}
