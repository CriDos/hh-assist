// Parsing hh catalog SSR pages (docs/hh.md §1-2). Pure module.
//
// Data sits in <template class="SkillsFront-InitialState"> as double-escaped
// JSON: quotes as &#34;, backslashes doubled. Unescaping order:
// entities → single backslashes → JSON.parse.

import { PROTO } from './proto.ts';
import { CatalogItem } from '../types/proto';

// Extract template content by class name; null if no such template.
export function extractTemplate(html: string, templateClass: string): string | null {
  if (typeof html !== 'string') return null;
  const marker = `class="${templateClass}"`;
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const open = html.indexOf('>', start);
  const close = html.indexOf('</template>', open);
  if (open === -1 || close === -1) return null;
  return html.slice(open + 1, close);
}

// All candidates: the template with the required class (section page), then
// every <template> found in a row (the catalog page has no class).
function templateCandidates(html: string): string[] {
  const candidates: string[] = [];
  const byClass = extractTemplate(html, PROTO.catalog.ssrTemplateClass);
  if (byClass != null) candidates.push(byClass);
  let rest = html;
  for (let i = 0; i < 10; i++) {
    const start = rest.indexOf('<template');
    if (start === -1) break;
    const open = rest.indexOf('>', start);
    const close = rest.indexOf('</template>', open);
    if (open === -1 || close === -1) break;
    candidates.push(rest.slice(open + 1, close));
    rest = rest.slice(close + 11);
  }
  return candidates;
}

// Unescape and parse; null on any error. keyHint — a key name (e.g.
// skillsVerificationMethodsPage): a candidate containing it is preferred
// (a page may hold several templates).
export function parseSsr(html: string, keyHint = ''): Record<string, any> | null {
  if (typeof html !== 'string') return null;
  const candidates = templateCandidates(html);
  const ordered = keyHint
    ? [
        ...candidates.filter(raw => raw.includes(keyHint)),
        ...candidates.filter(raw => !raw.includes(keyHint))
      ]
    : candidates;
  for (const raw of ordered) {
    try {
      // The live HTML quotes as &quot; (rarely &#34;) — strip both.
      const unescaped = raw
        .replaceAll('&quot;', '"')
        .replaceAll('&#34;', '"')
        .replaceAll('\\\\', '\\');
      const value = JSON.parse(unescaped);
      if (value && typeof value === 'object') return value;
    } catch {}
  }
  return null;
}

function pick(object: any, path: string): any {
  return path.split('.').reduce((acc, segment) => (acc == null ? acc : acc[segment]), object);
}

// Catalog-section validation: required fields and level structure. A level is
// valid if it has AT LEAST one method (some practice sections have none —
// theory present, practice=null).
export function validateItem(item: any): item is CatalogItem {
  if (!item || typeof item !== 'object') return false;
  if (typeof item.id !== 'number' && typeof item.id !== 'string') return false;
  if (!item.name) return false;
  if (!Array.isArray(item.levels)) return false;
  return item.levels.every(
    (level: any) =>
      level &&
      typeof level === 'object' &&
      level.id != null &&
      typeof level.rank === 'number' &&
      ((level.theory && typeof level.theory === 'object') ||
        (level.practice && typeof level.practice === 'object'))
  );
}

// Catalog: { items, dropped } — valid sections and how many were discarded.
// items=null if the SSR didn't parse or the structure is unexpected.
export function parseCatalog(html: string): { items: CatalogItem[] | null; dropped: number } {
  const state = parseSsr(html, 'skillsVerificationMethodsPage');
  const raw = state ? pick(state, PROTO.catalog.ssrKey) : null;
  if (!Array.isArray(raw)) return { items: null, dropped: 0 };
  const items: CatalogItem[] = [];
  let dropped = 0;
  for (const item of raw) {
    if (validateItem(item)) items.push(item);
    else dropped++;
  }
  return { items, dropped };
}
