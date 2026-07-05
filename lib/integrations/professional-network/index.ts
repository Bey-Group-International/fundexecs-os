// Professional Network data-input layer — public surface.
//
// Pipeline: source adapter → permission check → normalize → dedupe → score →
// network_contacts insert → relationship edge → copilot context.
// See types.ts for the strategic contract; FundExecs owns the intelligence
// layer, sources are inputs.

export * from "./types";
export { normalizeProfile, normalizeLinkedInUrl, nameFromLinkedInSlug, inferCapitalRole, SOURCE_BASE_CONFIDENCE } from "./normalize-profile";
export { findDuplicates, blockingDuplicates } from "./dedupe-contacts";
export { scoreStrength, scoreRelevance, strengthLabel, initialScores, type StrengthInputs, type RelevanceInputs } from "./score-relationship";
export { fromLinkedInUrl, fromManualEntry, fromCsvRow, type AdapterResult } from "./adapters";
export { PROFESSIONAL_NETWORK_CONNECTORS, googleContactsConnector, linkedinApiConnector } from "./connectors";
