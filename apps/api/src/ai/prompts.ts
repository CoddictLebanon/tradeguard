export const NEWS_ANALYSIS_PROMPT = `You are a financial news analyst. Analyze the following news article about a stock and provide:

1. A brief summary (2-3 sentences)
2. Sentiment: positive, negative, or neutral
3. Key facts that could impact the stock price
4. Risk flags (if any): earnings, lawsuits, FDA decisions, leadership changes, etc.
5. Potential price impact: high, medium, low

Article about {symbol}:
{article}

Respond in JSON format:
{
  "summary": "...",
  "sentiment": "positive|negative|neutral",
  "keyFacts": ["...", "..."],
  "riskFlags": ["...", "..."],
  "priceImpact": "high|medium|low"
}`;

export const TRADE_REASONING_PROMPT = `You are a trading analyst assistant. Based on the following data, provide a trade recommendation:

Stock: {symbol}
Current Price: {currentPrice}
Score: {score}/100

Technical Factors:
- Volume Surge: {volumeSurge}/100
- Technical Breakout: {technicalBreakout}/100
- Sector Momentum: {sectorMomentum}/100
- News Sentiment: {newsSentiment}/100
- Volatility Fit: {volatilityFit}/100

Technical Indicators:
- SMA20: {sma20}
- SMA50: {sma50}
- RSI: {rsi}
- ATR: {atr}

Recent News:
{newsHeadlines}

Recommendations:
- BUY: Price expected to rise. Good for stocks above moving averages with positive momentum.
- HOLD: Wait for better entry or more confirmation.
- AVOID: Too risky or unclear direction.

Provide your analysis in JSON format:
{
  "recommendation": "BUY|HOLD|AVOID",
  "summary": "2-3 sentence explanation of why this is interesting or not",
  "bullCase": "What could go right",
  "bearCase": "What could go wrong",
  "confidence": 0-100,
  "suggestedTrailPercent": percentage,
  "warnings": ["any concerns..."]
}`;

export const RISK_ASSESSMENT_PROMPT = `You are a portfolio risk manager. Evaluate whether this trade should proceed:

Proposed Trade:
- Symbol: {symbol}
- Position Size: {positionSize} ({positionPercent}% of portfolio)
- Entry: {entry}
- Trail Stop: {trailPercent}%

Current Portfolio:
- Total Value: {portfolioValue}
- Cash Available: {cashAvailable}
- Current Positions: {currentPositions}
- Sector Exposure: {sectorExposure}

Market Context:
- VIX Level: {vix}
- Market Trend: {marketTrend}
- Upcoming Events: {upcomingEvents}

Evaluate and respond in JSON:
{
  "recommendation": "GO|CAUTION|STOP",
  "reason": "Brief explanation",
  "concerns": ["list of concerns if any"],
  "sectorWarning": true|false,
  "correlationWarning": true|false,
  "suggestedAdjustments": "any suggested changes to position size or stops"
}`;
