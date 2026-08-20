import { FingerprintProfile } from './fingerprint';

export type { FingerprintProfile };

export interface TimingRange {
  answerMinMs?: number;
  answerMaxMs?: number;
  betweenMinMs?: number;
  betweenMaxMs?: number;
  typingMinMs?: number;
  typingMaxMs?: number;
  retryTypingMinMs?: number;
  retryTypingMaxMs?: number;
}

export interface TheoryTimings {
  answerMinMs: number;
  answerMaxMs: number;
  betweenMinMs: number;
  betweenMaxMs: number;
}

export interface PracticeTimings {
  answerMinMs?: number;
  answerMaxMs?: number;
  betweenMinMs?: number;
  betweenMaxMs?: number;
  typingMinMs: number;
  typingMaxMs: number;
  retryTypingMinMs: number;
  retryTypingMaxMs: number;
}

export interface TimingsConfig {
  theory: TheoryTimings;
  practice: PracticeTimings;
  betweenTestsMinMs: number;
  betweenTestsMaxMs: number;
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoning?: string;
  systemPrompt?: string;
  codeSystemPrompt?: string;
  [key: string]: unknown;
}

export interface ConfigSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoning: string;
  systemPrompt?: string;
  codeSystemPrompt?: string;
  profileId: string | null;
  profiles: FingerprintProfile[];
  timings: TimingsConfig;
}
