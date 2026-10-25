// Reopening an applied API configuration (Issue #506): the Edit button of the main screen's API panel. See api-config-reopen.ts and
// the `bridge` convention in api-config-ui.ts.
import type { PopupBridge } from '../types/popup';
import { createLogger } from '../shared/logger';
import { STATES } from './api-config';
import { reopenPatch } from './api-config-reopen';
import { byIdOrNull } from './dom';

const log = createLogger('SF:ApiConfigReopenUI');

// Cancel on the reopened screen is the ordinary cancelApiConfig: it drops only the draft, so the confirmed configuration and its
// snapshot are exactly as before.
export function openApiConfigEdit(bridge: PopupBridge): void {
  const patch = reopenPatch(bridge.getState());
  if (!patch) return;
  log('API_CONFIG reopen');
  bridge.stopPreviewIfActive();
  bridge.setState(STATES.API_CONFIG, patch);
}

export function wireApiConfigReopenEvents(bridge: PopupBridge): void {
  byIdOrNull('btn-api-config-edit')?.addEventListener('click', () => openApiConfigEdit(bridge));
}
