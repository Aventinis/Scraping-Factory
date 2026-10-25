// API mode: the field name a candidate's "Use" falls back to when the user typed none.
import { t } from '../i18n/i18n';
import { lastPathSegmentName } from './api-config';
import type { ApiNodeDraft } from './api-config';

// The candidate's last key (`items[2].price` → `price`), made unique against `takenNames` with a counter (`price_2`, …).
// A path without any key segment (`[0]`) has nothing to take, so it falls back to the translated generic name.
export function deriveApiFieldName(path: string | null | undefined, takenNames: string[], fallback: string): string {
  const base = lastPathSegmentName(path) || fallback;
  const taken = new Set(takenNames);
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}_${counter}`)) counter++;
  return `${base}_${counter}`;
}

export function candidateFieldName(candidate: { valuePath?: string | null }, takenNames: string[]): string {
  return deriveApiFieldName(candidate.valuePath, takenNames, t('apiTree.defaultFieldName'));
}

export function collectApiTreeNames(nodes: ApiNodeDraft[]): string[] {
  return nodes.flatMap(node => [node.name, ...(node.kind === 'group' ? collectApiTreeNames(node.children) : [])]);
}
