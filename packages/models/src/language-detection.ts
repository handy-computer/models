import { languageIdentity, resolveModelLanguage } from "./languages.ts";

/** The parts of a model the language policy reads. */
export type LanguageModel = {
  readonly languages: readonly string[];
  readonly capabilities: { readonly languageDetection: boolean };
};

export type DetectPolicy = { kind: "detect"; languages: string[]; allowed: string[] };
/** What a take does about language. Auto is never `fixed`; `unsupported` hides it. */
export type AutoLanguagePolicy =
  | { kind: "native" }
  | { kind: "fixed"; language: string }
  | DetectPolicy
  | { kind: "unsupported" };

/** The external detector's labels, keyed by language identity. */
export type DetectorCodes = ReadonlyMap<string, string>;

export function detectorCodes(detector: { readonly languages: readonly string[] }): DetectorCodes {
  return new Map(detector.languages.map((code) => [languageIdentity(code), code]));
}

/** Return the detector's own label (iw/jw/tl/no included). */
export function detectorLanguageCode(codes: DetectorCodes, language: string): string | undefined {
  return codes.get(languageIdentity(language));
}

/** Whether this ASR model needs the external detector for Auto, independent of preferences. */
export function requiresLanguageDetector(model: LanguageModel): boolean {
  return !model.capabilities.languageDetection &&
    new Set(model.languages.map(languageIdentity)).size > 1;
}

/** Preferred languages this model supports, in preference order, one per identity. */
function compatiblePreferences(model: LanguageModel, preferred: readonly string[]): string[] {
  const byIdentity = new Map<string, string>();
  for (const preference of preferred) {
    const language = resolveModelLanguage(model, preference);
    if (language !== undefined && !byIdentity.has(languageIdentity(language))) {
      byIdentity.set(languageIdentity(language), language);
    }
  }
  return [...byIdentity.values()];
}

/** Supported preferred languages the external detector cannot identify (e.g. Irish). */
export function undetectablePreferences(
  codes: DetectorCodes,
  model: LanguageModel,
  preferred: readonly string[],
): string[] {
  if (!requiresLanguageDetector(model)) return [];
  return compatiblePreferences(model, preferred).filter(
    (language) => detectorLanguageCode(codes, language) === undefined,
  );
}

/**
 * Resolve Auto. Without native detection, Auto exists only when at least two
 * preferred languages are supported and every one of them is detectable.
 */
export function autoLanguagePolicy(
  codes: DetectorCodes,
  model: LanguageModel,
  preferred: readonly string[],
): AutoLanguagePolicy {
  // Native detection retains its existing unrestricted semantics.
  if (model.capabilities.languageDetection) return { kind: "native" };

  const languages = compatiblePreferences(model, preferred);
  const allowed = languages.map((language) => detectorLanguageCode(codes, language));
  if (languages.length < 2 || allowed.includes(undefined)) return { kind: "unsupported" };
  return { kind: "detect", languages, allowed: allowed as string[] };
}
