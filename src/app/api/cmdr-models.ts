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
