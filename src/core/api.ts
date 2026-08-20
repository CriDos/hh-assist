import { PROTO } from './proto.ts';
import { ApiClient } from '../types/proto.ts';

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, message: string, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Solution-code encoding: UTF-8 → base64, like the live client does
// (bundle module 16677: TextEncoder → codepoints → btoa).
export function utf8ToBase64(text: string): string {
  const str = String(text ?? '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64');
  }
  const bytes = new TextEncoder().encode(str);
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK_SIZE) as unknown as number[]
    );
  }
  return btoa(binary);
}

export function base64ToUtf8(value: string): string {
  const str = String(value ?? '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64').toString('utf8');
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export interface ApiClientOptions {
  base?: string;
  fetchImpl?: any;
  xsrf?: string | (() => string);
}

export function createApiClient({
  base = PROTO.assessment.base,
  fetchImpl = globalThis.fetch,
  xsrf = () => ''
}: ApiClientOptions = {}): ApiClient {
  const token = () => (typeof xsrf === 'function' ? xsrf() : xsrf);

  async function request(
    path: string,
    {
      method = 'GET',
      body,
      headers = {},
      expectJson = true
    }: { method?: string; body?: any; headers?: Record<string, string>; expectJson?: boolean } = {}
  ): Promise<any> {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        ...PROTO.assessment.headers,
        'X-XSRFToken': token(),
        ...headers
      },
      body
    });

    if (response.status === 204) return null;
    // The tab bridge returns {status, ok, text} as a bare string; native fetch
    // returns a Response with a text() method. Normalize both variants.
    const text =
      typeof response.text === 'function' ? await response.text() : String(response.text ?? '');
    if (!response.ok) {
      throw new ApiError(response.status, `HTTP ${response.status} ${text.slice(0, 300)}`, text);
    }
    if (!expectJson) return text || null;
    if (!text.trim()) {
      throw new ApiError(response.status, 'Пустое тело ответа сервера', text);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError(response.status, 'Некорректный JSON ответа', text);
    }
  }

  return {
    // Currently unanswered question; null on 204 (test completed).
    getCurrentTask() {
      return request(PROTO.assessment.paths.getCurrentTask);
    },
    getContestTasks() {
      return request(PROTO.assessment.paths.getContestTasks);
    },
    getTimeLeft() {
      return request(PROTO.assessment.paths.getTimeLeft);
    },
    submitAnswer(taskId: number, userAnswerUuids: string[]) {
      return request(PROTO.assessment.paths.submitAnswer, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ userAnswerUuids, taskId })
      });
    },
    // Empty multipart — as the live client sends (Content-Length 44).
    postFinish() {
      return request(PROTO.assessment.paths.postFinish, {
        method: 'POST',
        body: new FormData()
      });
    },

    // ---- Code tests (practice), cert_code contour (docs/hh.md §4.1) ----
    // Contour headers override the base ones (X-Hhtmsource: CertCode).
    updateCode(taskId: number, code: string, lang: string, isBeta = false) {
      return request(PROTO.code.paths.updateCode, {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...PROTO.code.headers },
        body: JSON.stringify({ taskId, code, lang, isBeta })
      });
    },
    // submissionType: 'check' (test run) | 'full' (solution submission)
    submitTask(taskId: number, code: string, lang: string, submissionType: string, isBeta = false) {
      return request(PROTO.code.paths.submitTask, {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...PROTO.code.headers },
        body: JSON.stringify({ taskId, code, lang, submissionType, isBeta })
      });
    },
    // isSolution=false: result of a test run; true: result of the final submission.
    getSubmitTaskResult(submissionId: string | number, taskId: number, isSolution = false) {
      const query = `submissionId=${encodeURIComponent(submissionId)}&taskId=${encodeURIComponent(taskId)}&isBeta=false&isSolution=${isSolution ? 'true' : 'false'}`;
      return request(`${PROTO.code.paths.getSubmitTaskResult}?${query}`, {
        headers: PROTO.code.headers
      });
    }
  };
}
