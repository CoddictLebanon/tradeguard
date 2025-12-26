export interface ScoringWeights {
  volumeSurge: number;
  technicalBreakout: number;
  sectorMomentum: number;
  newsSentiment: number;
  volatilityFit: number;
}

export interface ScoringFactors {
  volumeSurge: number;
  technicalBreakout: number;
  sectorMomentum: number;
  newsSentiment: number;
  volatilityFit: number;
}

export interface OpportunityScore {
  symbol: string;
  totalScore: number;
  factors: ScoringFactors;
  currentPrice: number;
  suggestedEntry: number;
  suggestedTrailPercent: number;
  confidence: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  volumeSurge: 25,
  technicalBreakout: 25,
  sectorMomentum: 20,
  newsSentiment: 15,
  volatilityFit: 15,
};
