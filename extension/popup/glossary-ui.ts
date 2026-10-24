// Issue #407: renders the glossary list (glossary.ts) into the Settings screen.
// Plain DOM built with textContent — the texts are translations, but a
// translation must never be able to inject markup.
import { t } from '../i18n/i18n';
import { buildGlossary } from './glossary';
import { byIdOrNull } from './dom';

export function renderGlossary(): void {
  const list = byIdOrNull('settings-glossary-list');
  if (!list) return;
  list.innerHTML = '';
  for (const { term, text, example } of buildGlossary(t)) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = text;
    if (example) {
      const code = document.createElement('code');
      code.className = 'glossary-example';
      code.textContent = example;
      dd.append(' ', code);
    }
    list.append(dt, dd);
  }
}
