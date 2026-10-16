// Ported from Pi Voice's test/languages.test.ts, plus the pure language
// detection policy from test/language-detection.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoLanguagePolicy,
  canonicalLanguage,
  detectorLanguageCode,
  getModel,
  languageIdentity,
  requiresLanguageDetector,
  resolveModelLanguage,
  undetectablePreferences,
} from "../src/index.ts";

test("language identities normalize case, regions, and aliases", () => {
  assert.equal(canonicalLanguage(" TL-ph "), "tl");
  assert.equal(languageIdentity(" TL-ph "), "fil");
  assert.equal(languageIdentity("fil"), "fil");
  assert.equal(languageIdentity("no"), "nb");
  assert.equal(languageIdentity("nb"), "nb");
  assert.equal(languageIdentity("en-GB"), "en");
});

test("model resolution returns exact backend codes, preferring explicit regions", () => {
  const model = { languages: ["en-US", "en-GB", "no", "tl", "zh"] };
  assert.equal(resolveModelLanguage(model, "fil"), "tl");
  assert.equal(resolveModelLanguage(model, "nb"), "no");
  assert.equal(resolveModelLanguage(model, " EN-gb "), "en-GB");
  assert.equal(resolveModelLanguage(model, "en"), "en-US");
  assert.equal(resolveModelLanguage(model, "zh"), "zh");
  assert.equal(resolveModelLanguage(model, "unknown"), undefined);
});

test("Auto uses the shared detector only when every preferred language is detectable", () => {
  const canary = getModel("canary-180m-flash")!;
  assert.equal(requiresLanguageDetector(canary), true);
  assert.deepEqual(autoLanguagePolicy(canary, ["en", "de"]), {
    kind: "detect",
    languages: ["en", "de"],
    allowed: ["en", "de"],
  });
  assert.deepEqual(autoLanguagePolicy(canary, ["en"]), { kind: "unsupported" });

  // Fun-ASR supports Irish, but the detector can't identify it.
  const fun = getModel("Fun-ASR-MLT-Nano-2512")!;
  assert.equal(fun.capabilities.languageDetection, false);
  assert.equal(autoLanguagePolicy(fun, ["zh", "en"]).kind, "detect");
  assert.deepEqual(undetectablePreferences(fun, ["zh", "en", "ga"]), ["ga"]);
  assert.deepEqual(autoLanguagePolicy(fun, ["zh", "en", "ga"]), { kind: "unsupported" });

  const whisper = getModel("whisper-medium")!;
  assert.deepEqual(autoLanguagePolicy(whisper, ["en", "ga"]), { kind: "native" });
  assert.equal(detectorLanguageCode("he"), "iw");
});
