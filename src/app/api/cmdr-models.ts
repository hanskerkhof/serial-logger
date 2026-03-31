/**
 * Readable aliases over the auto-generated OpenAPI schema types.
 * Source of truth: src/app/api/generated/cmdr-api.types.ts (do not edit manually).
 * Regenerate with: npm run generate:cmdr-types
 */
import type { components } from './generated/cmdr-api.types';

export type CmdrHealthResponse         = components['schemas']['HealthResponse'];
export type CmdrExposedPlan            = components['schemas']['ExposedPlan'];
export type CmdrPlansResponse          = components['schemas']['PlansResponse'];
export type CmdrLanGroup               = components['schemas']['LanGroup'];
export type CmdrPlanGroupsResponse     = components['schemas']['PlanGroupsResponse'];
export type CmdrFixtureCommandResponse = components['schemas']['FixtureCommandResponse'];
export type CmdrRawResponse            = components['schemas']['CommanderRawResponse'];
export type CmdrVersionsResponse       = components['schemas']['VersionsResponse'];
export type CmdrDiscoveryResponse      = components['schemas']['DiscoveryResponse'];

/** Union of all version/discovery query response shapes — used by the component query-result signal. */
export type CmdrQueryResponse = CmdrVersionsResponse | CmdrDiscoveryResponse;

export type CmdrFixtureCapabilities = components['schemas']['FixtureCapabilities'];
export type CmdrPlanControls        = components['schemas']['PlanControls'];
export type CmdrPlayerCapabilities  = components['schemas']['PlayerCapabilities'];
export type CmdrCustomCommandUiItem = components['schemas']['CustomCommandUiItem'];
export type CmdrCustomCommandUiArg  = components['schemas']['CustomCommandUiArg'];
export type CmdrFixtureRssiReport   = components['schemas']['FixtureRssiReport'];
export type CmdrRssiPeerEntry       = components['schemas']['RssiPeerEntry'];
export type CmdrFixtureConfig       = components['schemas']['FixtureConfig'];
export type CmdrFixtureConfigPlayer = components['schemas']['FixtureConfigPlayer'];
export type CmdrFixtureConfigAux    = components['schemas']['FixtureConfigAux'];
export type CmdrFixtureConfigDmx    = components['schemas']['FixtureConfigDmx'];
export type CmdrFixtureConfigUi     = components['schemas']['FixtureConfigUi'];

// --- Plan state models (not in OpenAPI schema — firmware-specific, handwritten) ---

/** One relay's runtime state as emitted by NERO_BIANCO_RELAY BK_PLAN_STATE. */
export interface CmdrRelayStateItem {
  /** Relay number 1–N. */
  n: number;
  /** Current state of the relay. */
  state: 'off' | 'on' | 'scheduled';
  /** Remaining ms until a scheduled relay activates (state === 'scheduled'). 0 otherwise. */
  scheduledMs: number;
  /** Remaining ms until a timed-on relay turns off (state === 'on', durationMs > 0). 0 for permanent on or when off/scheduled. */
  remainingOnMs: number;
}

// --- Messages API (not in OpenAPI schema — handwritten) ---
export interface CmdrMessageSection {
  heading: string;
  bullets: string[];
}

export interface CmdrMessage {
  id: string;
  type: string;
  version: string | null;
  fe_version: string | null;
  date: string | null;
  title: string;
  sections: CmdrMessageSection[];
}

export interface CmdrMessagesResponse {
  ok: boolean;
  messages: CmdrMessage[];
  total: number;
}
