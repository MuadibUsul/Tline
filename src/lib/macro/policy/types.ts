export type PolicyDecision = "HIKE" | "CUT" | "HOLD" | "OTHER";
export type PolicyStance = "HAWKISH" | "DOVISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
export type PolicyDocumentType = "STATEMENT" | "IMPLEMENTATION_NOTE" | "MINUTES";

export interface PolicySourceQuote {
  field: string;
  quote: string;
}

export interface ParsedPolicyDocument {
  decision: PolicyDecision;
  targetRateLower: number | null;
  targetRateUpper: number | null;
  changeBps: number | null;
  stance: PolicyStance;
  inflationAssessment: string;
  growthAssessment: string;
  laborAssessment: string;
  forwardGuidance: string;
  balanceSheetAction: string;
  votesFor: number | null;
  votesAgainst: number | null;
  sourceQuotes: PolicySourceQuote[];
  confidence: number;
}

export interface DiscoveredPolicyDocument {
  docType: PolicyDocumentType;
  meetingDate: Date;
  publishedAt: Date;
  sourceUrl: string;
}

export interface PolicyParseResult {
  parsed: ParsedPolicyDocument;
  provider: string;
  model: string | null;
  promptVersion: string;
  reviewStatus: "deterministic" | "parsed" | "needs_review";
}
