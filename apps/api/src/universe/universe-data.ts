// apps/api/src/universe/universe-data.ts

// S&P 500 components (top liquid names - update periodically)
export const SP500_SYMBOLS: string[] = [
  'AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'GOOG', 'META', 'BRK.B', 'UNH', 'XOM',
  'JNJ', 'JPM', 'V', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'LLY',
  'PEP', 'KO', 'COST', 'AVGO', 'MCD', 'WMT', 'CSCO', 'TMO', 'ACN', 'ABT',
  'CRM', 'DHR', 'NKE', 'TXN', 'NEE', 'UPS', 'PM', 'MS', 'RTX', 'HON',
  'QCOM', 'LOW', 'UNP', 'IBM', 'CAT', 'BA', 'AMGN', 'GE', 'SPGI', 'INTU',
  'DE', 'AMAT', 'AXP', 'BKNG', 'MDLZ', 'ISRG', 'GS', 'BLK', 'ADI', 'GILD',
  'SYK', 'VRTX', 'ADP', 'TJX', 'MMC', 'REGN', 'LMT', 'CVS', 'ETN', 'PGR',
  'SCHW', 'CB', 'ZTS', 'CI', 'MO', 'SLB', 'LRCX', 'SO', 'BSX', 'FI',
  'DUK', 'BDX', 'CME', 'EQIX', 'CL', 'MU', 'ITW', 'AON', 'NOC', 'ICE',
  'SHW', 'PNC', 'MCK', 'WM', 'CSX', 'ATVI', 'APD', 'SNPS', 'FCX', 'CCI',
  // Add more as needed - this is a representative sample
];

// Nasdaq 100 components
export const NASDAQ100_SYMBOLS: string[] = [
  'AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'GOOG', 'META', 'AVGO', 'COST', 'TSLA',
  'ASML', 'PEP', 'CSCO', 'AZN', 'ADBE', 'NFLX', 'AMD', 'TXN', 'CMCSA', 'TMUS',
  'HON', 'QCOM', 'INTC', 'INTU', 'AMGN', 'AMAT', 'ISRG', 'BKNG', 'SBUX', 'LRCX',
  'ADI', 'GILD', 'MDLZ', 'VRTX', 'ADP', 'REGN', 'MU', 'SNPS', 'PYPL', 'PANW',
  'KLAC', 'CDNS', 'MAR', 'CSX', 'MELI', 'ORLY', 'MNST', 'FTNT', 'CTAS', 'KDP',
  'NXPI', 'MCHP', 'ADSK', 'PCAR', 'AEP', 'KHC', 'PAYX', 'CHTR', 'ODFL', 'CPRT',
  'LULU', 'DXCM', 'EXC', 'MRNA', 'ROST', 'IDXX', 'MRVL', 'EA', 'CTSH', 'XEL',
  'FAST', 'VRSK', 'GEHC', 'BKR', 'CSGP', 'FANG', 'DLTR', 'WBD', 'ANSS', 'TEAM',
  'ZS', 'ILMN', 'ALGN', 'EBAY', 'DDOG', 'CRWD', 'WDAY', 'BIIB', 'WBA', 'ENPH',
  'SIRI', 'ZM', 'JD', 'PDD', 'LCID', 'RIVN',
];

// Highly liquid sector ETFs
export const LIQUID_ETFS: string[] = [
  'SPY',  // S&P 500
  'QQQ',  // Nasdaq 100
  'IWM',  // Russell 2000
  'DIA',  // Dow Jones
  'XLK',  // Technology
  'XLF',  // Financials
  'XLE',  // Energy
  'XLV',  // Healthcare
  'XLI',  // Industrials
  'XLY',  // Consumer Discretionary
  'XLP',  // Consumer Staples
  'XLB',  // Materials
  'XLU',  // Utilities
  'XLRE', // Real Estate
  'XLC',  // Communication Services
  'VTI',  // Total Stock Market
  'VOO',  // Vanguard S&P 500
  'VGT',  // Vanguard Tech
];

// Meme stocks and illiquid names to always exclude
export const EXCLUDED_SYMBOLS: string[] = [
  'GME', 'AMC', 'BBBY', 'BB', 'NOK', 'KOSS', 'EXPR', 'NAKD',
  'SNDL', 'CLOV', 'WISH', 'WKHS', 'RIDE', 'NKLA', 'SPCE',
];

export const MIN_AVG_DAILY_VOLUME = 2_000_000;
