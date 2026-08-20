// Test completion page (contest_result) parsing. Pure module: runs in node
// (tests) and the extension (background + executeScript).

import { parseSsr } from './catalog.ts';
import { ParsedResultPage, SolverVerdict } from '../types/solver';

// Recursive search for the result node: an object with 2+ significant fields
// from the set (correct/total/passed/score/count/...). No need to match the
// completion-page layout — we search by signature.
const RESULT_KEYS = new Set([
  'correct',
  'correctCount',
  'rightCount',
  'actual',
  'total',
  'totalCount',
  'count',
  'answerCount',
  'maxCount',
  'max',
  'passed',
  'isPassed',
  'success',
  'result',
  'score',
  'contestResultStatus'
]);

export function findResultNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  if (!Array.isArray(node)) {
    const hits = Object.entries(node as Record<string, unknown>).filter(
      ([key, value]) =>
        RESULT_KEYS.has(key) &&
        (value === true ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          typeof value === 'string')
    );
    if (hits.length >= 2) return node as Record<string, unknown>;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findResultNode(value);
    if (found) return found;
  }
  return null;
}

// Completion-page status → verdict. FRAUD — the anti-fraud block: the skill
// is not confirmed; the reason is the status itself (a single word).
function passedFromStatus(status: string): boolean | null {
  if (/^pass|^succeed|^success|^true|^accepted|^ok/i.test(status)) return true;
  if (/^fail|^fraud/i.test(status)) return false;
  return null;
}

// Deep status-string search (SUCCESS/FAILURE/...) — fallback for structures
// that don't fit applicantContestResultPage (per-method statuses like
// practice: "FAILURE" unused on generic routes — layout is read first).
function scanStatus(root: unknown): string | null {
  let statusText: string | null = null;
  const scan = (value: unknown) => {
    if (statusText) return;
    if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) scan(item);
      return;
    }
    if (
      typeof value === 'string' &&
      /^(SUCCESS|FAILURE|PASSED|FAILED|FRAUD)$/i.test(value.trim())
    ) {
      statusText = value.trim().toLowerCase();
    }
  };
  scan(root);
  return statusText;
}

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function parseResultPage(html: string): ParsedResultPage | null {
  const state = parseSsr(html, 'Result');
  if (!state) return null;

  // Completion page: state in applicantContestResultPage, result in
  // desktopUiLayout/mobileUiLayout: score {max, actual} + contestResultStatus.
  // On a block (FRAUD) score is absent (null) — the status is the only source
  // of truth; it's also returned as the reason.
  const page = state.applicantContestResultPage;
  const layout =
    page && typeof page === 'object'
      ? (page as any).desktopUiLayout || (page as any).mobileUiLayout || null
      : null;
  if (layout && typeof layout === 'object') {
    const status = layout.contestResultStatus == null ? null : String(layout.contestResultStatus);
    const score = layout.score && typeof layout.score === 'object' ? layout.score : null;
    const correct = score ? num(score.actual ?? score.correct) : null;
    const total = score ? num(score.max ?? score.total ?? score.totalCount) : null;
    if (status || correct != null) {
      return {
        known: true,
        passed: status ? passedFromStatus(status) : null,
        correct,
        total,
        reason: status
      };
    }
  }

  const node = findResultNode(state);
  const correct = node
    ? num(node.actual ?? node.correct ?? node.correctCount ?? node.rightCount ?? node.score)
    : null;
  const total = node
    ? num(node.max ?? node.total ?? node.totalCount ?? node.answerCount ?? node.maxCount)
    : null;

  const passedRaw = node
    ? (node.passed ?? node.isPassed ?? node.success ?? node.result ?? node.contestResultStatus)
    : null;
  let passed: boolean | null = null;
  if (typeof passedRaw === 'boolean') passed = passedRaw;
  else if (typeof passedRaw === 'number') passed = passedRaw === 1 || passedRaw === 200;
  else if (typeof passedRaw === 'string') passed = passedFromStatus(passedRaw);
  if (passed == null) {
    const statusText = scanStatus(state);
    if (statusText) passed = passedFromStatus(statusText);
  }
  if (correct == null && total == null && passed == null) return null;
  return { known: true, passed, correct, total, reason: null };
}

// ---- Verdict: the single source of phrasing for a parsed result -------------

// Score part «N из M» — empty when either side is missing.
export function scoreText(result: { correct?: number | null; total?: number | null } = {}): string {
  const { correct, total } = result;
  return correct != null && total != null ? `${correct} из ${total}` : '';
}

// Verdict of a parsed completion result:
// - passed    — confirmed, label «Навык подтверждён: N из M»;
// - failed    — not confirmed with a score («Навык не подтверждён: N из M»);
// - blocked   — no score, reason is the block status («…: FRAUD»);
// - no-score  — passed unknown, score present («Результат: N из M»);
// - unknown   — nothing recognized («Результат не распознан»).
export function resultVerdict(
  result: {
    passed?: boolean | null;
    correct?: number | null;
    total?: number | null;
    reason?: string | null;
  } = {}
): SolverVerdict {
  const score = scoreText(result);
  if (result.passed == null && result.correct == null) {
    return { status: 'unknown', label: 'Результат не распознан', short: 'результат не распознан' };
  }
  if (result.passed === false && result.correct == null && result.reason) {
    return {
      status: 'blocked',
      label: `Навык не подтверждён: ${result.reason}`,
      short: `навык не подтверждён (${result.reason})`
    };
  }
  if (result.passed == null) {
    return {
      status: 'no-score',
      label: score ? `Результат: ${score}` : 'Результат',
      short: `результат${score ? `: ${score}` : ''}`
    };
  }
  const verdict = result.passed ? 'passed' : 'failed';
  const prefix = result.passed ? 'Навык подтверждён' : 'Навык не подтверждён';
  const short = result.passed ? 'навык подтверждён' : 'навык не подтверждён';
  return { status: verdict, label: score ? `${prefix}: ${score}` : prefix, short };
}

// Completion page (contest_result), executed in the tab itself: returns the
// SSR-template content of the current page. Self-contained for executeScript
// (no closures). If the template is missing, returns a page sample so we can
// see what actually opened.
export function readCompletionContent(): {
  content?: string;
  error?: string;
  sample?: string;
  text?: string;
  url?: string;
} {
  const templates = Array.from(document.querySelectorAll('template'));
  const stateTpl = templates.find(t => /SkillsFront-InitialState/.test(String(t.className || '')));
  if (stateTpl) return { content: stateTpl.innerHTML };
  const sample = templates[0]?.innerHTML?.slice(0, 300) || '';
  const text = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 150);
  return {
    error: `шаблон не найден (шаблонов: ${templates.length})`,
    sample,
    text,
    url: location.href
  };
}

// Universal SSR read of the tab for code contests: the current task
// (AssessmentFront-InitialState/pageCertCode) or the result page
// (SkillsFront-InitialState). Executed in the tab, self-contained.
export function readSsrContent(): {
  content?: string;
  templateClass?: string;
  url?: string;
  error?: string;
} {
  const templates = Array.from(document.querySelectorAll('template'));
  const tpl = templates.find(t =>
    /AssessmentFront-InitialState|SkillsFront-InitialState/.test(String(t.className || ''))
  );
  if (tpl) return { content: tpl.innerHTML, templateClass: tpl.className, url: location.href };
  return { error: `шаблон не найден (шаблонов: ${templates.length})`, url: location.href };
}
