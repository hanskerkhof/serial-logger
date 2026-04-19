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

export interface CmdrPassiveSeenFixture {
  fixture_name: string;
  target_wifi_mac?: string;
  universe?: number;
  channel?: number;
  fw_version?: string;
  build_date?: string;
  build_time?: string;
  uptime_ms?: number;
  next_passive_seen_in_ms?: number;
  rssi_dbm?: number;
  rssi_quality?: string;
  last_seen_ms?: number;
}

export interface CmdrFixturesDiscoveredResponse {
  ok: boolean;
  fixtures: CmdrPassiveSeenFixture[];
  count: number;
  source: string;
}

export type CmdrFixtureCapabilities = components['schemas']['FixtureCapabilities'];
export type CmdrPlanControls        = components['schemas']['PlanControls'];
export type CmdrPlayerCapabilities  = components['schemas']['PlayerCapabilities'];
export interface CmdrCustomCommandPostRunSync {
  mode?: 'from_live_once' | string | null;
  targets?: string[] | null;
}
export interface CmdrCustomCommandLiveDraftSync {
  mode?: 'if_pristine' | 'always' | string | null;
  args?: string[] | null;
}

export interface CmdrSequenceTimelineStep {
  index: number;
  title: string;
  start_ms: number;
  duration_ms: number;
}

export interface CmdrSequenceTimelineDefinition {
  sq: string;
  ts: number;
  td: number;
  steps?: CmdrSequenceTimelineStep[];
}

export type CmdrCustomCommandUiItem = components['schemas']['CustomCommandUiItem'] & {
  ui_mode?: 'control' | 'action' | 'status' | string | null;
  control?: string | null;
  live_group?: string | null;
  post_run_sync?: CmdrCustomCommandPostRunSync | null;
  live_draft_sync?: CmdrCustomCommandLiveDraftSync | null;
};
export type CmdrCustomCommandUiArg = components['schemas']['CustomCommandUiArg'] & {
  status_row?: string | null;
  bit_count?: number | null;
  suffix?: string | null;
  sequence_keys?: string[] | null;
  sequence_definitions?: Record<string, CmdrSequenceTimelineDefinition> | null;
};
export type CmdrFixtureRssiReport   = components['schemas']['FixtureRssiReport'];
export type CmdrRssiPeerEntry       = components['schemas']['RssiPeerEntry'];
export type CmdrFixtureDocsListResponse = components['schemas']['FixtureDocsListResponse'];
export type CmdrFixtureConfig           = components['schemas']['FixtureConfig'];
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
  /** Remaining ms until a scheduled relay activates (state === 'scheduled'). Absent when 0. */
  scheduledMs?: number;
  /** Remaining ms until a timed-on relay turns off (state === 'on', durationMs > 0). Absent when 0 or permanent on. */
  remainingOnMs?: number;
}

export type CmdrFixturePlanStatusSummary = components['schemas']['FixturePlanStatusSummary'];
export type CmdrFixturePlanStatusResponse = components['schemas']['FixturePlanStatusResponse'];

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
