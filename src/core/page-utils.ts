export const isAssessmentUrl = (url?: string | null): boolean => {
  try {
    const parsed = new URL(String(url || ''));
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'assessment.hh.ru' &&
      (parsed.pathname.startsWith('/tests/') || parsed.pathname.startsWith('/code/'))
    );
  } catch {
    return false;
  }
};
