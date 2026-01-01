export interface ScoringWeights {
  volumeSurge: number;
  technicalBreakout: number;
  sectorMomentum: number;
  volatilityFit: number;
}

export interface ScoringFactors {
  volumeSurge: number;
  technicalBreakout: number;
  sectorMomentum: number;
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
  volumeSurge: 30,
  technicalBreakout: 30,
  sectorMomentum: 20,
  volatilityFit: 20,
};
