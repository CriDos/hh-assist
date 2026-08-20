// Extension settings: defaults, migrations and derived configs. Pure module:
// runs in node (tests) and the extension; storage goes through bridge.js
// (chrome.storage.local in the extension, mock in tests).

import { loadSettings } from './bridge.ts';
import { DEFAULT_TIMING } from './timing.ts';
import { PROTO } from './proto.ts';
import {
  ConfigSettings,
  FingerprintProfile,
  LLMConfig,
  TheoryTimings,
  PracticeTimings
} from '../types/settings.ts';

export type { ConfigSettings, FingerprintProfile, LLMConfig, TheoryTimings, PracticeTimings };

// Defaults with migrations: old flat timings (1.55 and earlier) spread into
// both subsections; salted fingerprint profiles (pre-1.73) are dropped —
// profiles now carry their own hashes (synthetic fingerprint, 2026-08-13).
export function settingsDefaults(raw: any = {}): ConfigSettings {
  const settings = raw && typeof raw === 'object' ? raw : {};
  const t = settings.timings && typeof settings.timings === 'object' ? settings.timings : {};
  const numOr = (val: any, fallback: number) =>
    typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : fallback;
  const groupTheory = (source: any = {}): TheoryTimings => ({
    answerMinMs: numOr(source.answerMinMs, DEFAULT_TIMING.theory.answerMinMs),
    answerMaxMs: numOr(source.answerMaxMs, DEFAULT_TIMING.theory.answerMaxMs),
    betweenMinMs: numOr(source.betweenMinMs, DEFAULT_TIMING.theory.betweenMinMs),
    betweenMaxMs: numOr(source.betweenMaxMs, DEFAULT_TIMING.theory.betweenMaxMs)
  });
  const groupPractice = (source: any = {}): PracticeTimings => ({
    ...(source.answerMinMs != null ? { answerMinMs: numOr(source.answerMinMs, 0) } : {}),
    ...(source.answerMaxMs != null ? { answerMaxMs: numOr(source.answerMaxMs, 0) } : {}),
    ...(source.betweenMinMs != null ? { betweenMinMs: numOr(source.betweenMinMs, 0) } : {}),
    ...(source.betweenMaxMs != null ? { betweenMaxMs: numOr(source.betweenMaxMs, 0) } : {}),
    typingMinMs: numOr(source.typingMinMs, DEFAULT_TIMING.practice.typingMinMs),
    typingMaxMs: numOr(source.typingMaxMs, DEFAULT_TIMING.practice.typingMaxMs),
    retryTypingMinMs: numOr(source.retryTypingMinMs, DEFAULT_TIMING.practice.retryTypingMinMs),
    retryTypingMaxMs: numOr(source.retryTypingMaxMs, DEFAULT_TIMING.practice.retryTypingMaxMs)
  });
  const migrated = t.answerMinMs != null;
  // Profiles without own hashes are legacy salted ones (pre-1.73) — dropped.
  const profiles = Array.isArray(settings.profiles)
    ? settings.profiles.filter((p: any) => p && p.hashes)
    : [];
  const profileId =
    settings.profileId && profiles.some((p: any) => p.id === settings.profileId)
      ? settings.profileId
      : null;
  return {
    baseUrl: String(settings.baseUrl || ''),
    apiKey: String(settings.apiKey || ''),
    model: String(settings.model || ''),
    reasoning: String(settings.reasoning || ''),
    systemPrompt: String(settings.systemPrompt || ''),
    codeSystemPrompt: String(settings.codeSystemPrompt || ''),
    profileId,
    profiles,
    timings: {
      theory: groupTheory(migrated ? t : t.theory || {}),
      practice: groupPractice(migrated ? t : t.practice || {}),
      betweenTestsMinMs: numOr(t.betweenTestsMinMs, DEFAULT_TIMING.betweenTestsMinMs),
      betweenTestsMaxMs: numOr(t.betweenTestsMaxMs, DEFAULT_TIMING.betweenTestsMaxMs)
    }
  };
}

export async function getSettings(): Promise<ConfigSettings> {
  return settingsDefaults(await loadSettings());
}

export function llmConfig(settings: ConfigSettings) {
  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    reasoning: settings.reasoning || undefined,
    systemPrompt: settings.systemPrompt || undefined
  };
}

export function timingConfig(settings: ConfigSettings, kind: 'theory' | 'practice') {
  const t = settings.timings;
  if (kind === 'theory') {
    return {
      answer: { min: t.theory.answerMinMs, max: t.theory.answerMaxMs },
      between: { min: t.theory.betweenMinMs, max: t.theory.betweenMaxMs },
      typing: { min: 0, max: 0 },
      retryTyping: { min: 0, max: 0 },
      betweenTests: { min: t.betweenTestsMinMs, max: t.betweenTestsMaxMs },
      heartbeatMs: PROTO.telemetry.heartbeatMs
    };
  }
  return {
    answer: { min: t.practice.answerMinMs ?? 0, max: t.practice.answerMaxMs ?? 0 },
    between: { min: t.practice.betweenMinMs ?? 0, max: t.practice.betweenMaxMs ?? 0 },
    typing: { min: t.practice.typingMinMs, max: t.practice.typingMaxMs },
    retryTyping: { min: t.practice.retryTypingMinMs, max: t.practice.retryTypingMaxMs },
    betweenTests: { min: t.betweenTestsMinMs, max: t.betweenTestsMaxMs },
    heartbeatMs: PROTO.telemetry.heartbeatMs
  };
}

export function activeProfile(settings: ConfigSettings): FingerprintProfile | null {
  return (
    settings.profiles?.find((profile: FingerprintProfile) => profile.id === settings.profileId) ||
    null
  );
}
