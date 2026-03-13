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
