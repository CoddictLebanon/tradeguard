'use client';

import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import SimulationResultModal, { SimulationResult } from '@/components/SimulationResultModal';

interface PositionSizeResult {
  status: 'OK' | 'REJECT';
  symbol: string;
  entry: number;
  stop: number | null;
  stop_pct: number | null;
  risk_usd?: number;
  risk_per_share?: number;
  shares?: number;
  position_usd?: number;
  max_loss_usd?: number;
  reason?: string;
}

interface OpportunityFactors {
  adv45: number;
  sma200: number;
  sma200_20daysAgo: number;
  slope: number;
  trendState: 'Uptrend' | 'Flat' | 'Declining';
  extPct: number;
  recentHigh: number;
  recentHighDate: string;
  pullback: number;
  pullbackInRange: boolean;
  pullbackLow: number;
  bounceOk: boolean;
  aboveSma200: boolean;
  notExtended: boolean;
  noSharpDrop: boolean;
  sharpDropCount: number;
  worstDrop: number;
}

interface Opportunity {
  id: string;
  symbol: string;
  companyName: string | null;
  logoUrl: string | null;
  score: number;
  factors: Record<string, number | string | boolean>;
  currentPrice: number;
  suggestedEntry: number;
  suggestedTrailPercent: number;
  status: string;
  createdAt: string;
}

// Helper function to check if an opportunity is qualified
function isQualified(opp: Opportunity): boolean {
  // ADV must be at least 2M
  if (Number(opp.factors?.adv45 || 0) < 2_000_000) return false;
  // All metrics must be green
  if (opp.factors?.trendState !== 'Uptrend') return false;
  if (!opp.factors?.pullbackInRange) return false;
  if (!opp.factors?.bounceOk) return false;
  if (!opp.factors?.aboveSma200) return false;
  if (!opp.factors?.notExtended) return false;
  if (!opp.factors?.noSharpDrop) return false;
  return true;
}

export default function OpportunitiesPage() {
  const token = useAuthStore((state) => state.token);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [positionCalc, setPositionCalc] = useState<PositionSizeResult | null>(null);
  const [calculatingPosition, setCalculatingPosition] = useState(false);
  const [simulationConfig, setSimulationConfig] = useState<{ enabled: boolean; date: string | null; maxDays: number } | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [showSimulationResult, setShowSimulationResult] = useState(false);
  const [runningSimulation, setRunningSimulation] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [executingTrade, setExecutingTrade] = useState(false);
  const [openPositionSymbols, setOpenPositionSymbols] = useState<Set<string>>(new Set());
  const [totalQualifiedCount, setTotalQualifiedCount] = useState<number | null>(null);

  // Only show qualified opportunities (stricter frontend filter)
  const qualifiedOpportunities = opportunities.filter(isQualified);

  const fetchOpportunities = async () => {
    if (!token) return;
    try {
      const data = await api.getOpportunities(token);
      setOpportunities(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  };

  // Store live prices separately to avoid re-rendering full opportunity data
  const [livePrices, setLivePrices] = useState<Record<string, { price: number; change?: number; changePercent?: number }>>({});

  // Track previous prices to detect changes
  const prevPricesRef = useRef<Record<string, number>>({});
  // Track which symbols just had price changes (with direction: 'up' | 'down')
  const [priceFlash, setPriceFlash] = useState<Record<string, 'up' | 'down'>>({});

  useEffect(() => {
    // Clean up duplicates on initial load
    if (token) {
      api.dedupOpportunities(token).catch(() => {});
    }
    fetchOpportunities();
    const interval = setInterval(fetchOpportunities, 30000);
    return () => clearInterval(interval);
  }, [token]);

  // Live price updates every 10 seconds - only for qualified opportunities
  useEffect(() => {
    if (!token || qualifiedOpportunities.length === 0) return;

    const fetchLivePrices = async () => {
      try {
        // Only fetch prices for qualified opportunities
        const symbols = qualifiedOpportunities.map((o) => o.symbol);
        const quotes = await api.getLiveQuotes(token, symbols);

        // Detect price changes and trigger flash
        const changedSymbols: Record<string, 'up' | 'down'> = {};
        for (const symbol of symbols) {
          const newPrice = quotes[symbol]?.price;
          const oldPrice = prevPricesRef.current[symbol];
          if (newPrice !== undefined && oldPrice !== undefined && newPrice !== oldPrice) {
            changedSymbols[symbol] = newPrice > oldPrice ? 'up' : 'down';
          }
          if (newPrice !== undefined) {
            prevPricesRef.current[symbol] = newPrice;
          }
        }

        // Trigger flash for changed symbols
        if (Object.keys(changedSymbols).length > 0) {
          setPriceFlash(changedSymbols);
          // Clear flash after animation duration
          setTimeout(() => setPriceFlash({}), 600);
        }

        setLivePrices(quotes);
      } catch {
        // Silently fail - non-critical
      }
    };

    // Fetch immediately
    fetchLivePrices();

    // Then every 10 seconds
    const interval = setInterval(fetchLivePrices, 10000);
    return () => clearInterval(interval);
  }, [token, qualifiedOpportunities.length]);

  useEffect(() => {
    if (token) {
      api.getSimulationConfig(token).then(setSimulationConfig).catch(() => {});
    }
  }, [token]);

  // Fetch open positions to show flag on opportunities
  useEffect(() => {
    const fetchOpenPositions = async () => {
      if (!token) return;
      try {
        const positions = await api.getPositions(token);
        const symbols = new Set(positions.map((p) => p.symbol));
        setOpenPositionSymbols(symbols);
      } catch {
        // Ignore errors - non-critical feature
      }
    };
    fetchOpenPositions();
  }, [token]);

  const handleScan = async () => {
    if (!token) return;
    setScanning(true);
    setScanMessage(null);
    setOpportunities([]); // Clear existing opportunities immediately
    setSelected(null); // Clear selection
    try {
      const asOfDate = simulationConfig?.enabled ? simulationConfig.date || undefined : undefined;
      // triggerScan returns scan results with status
      const result = await api.triggerScan(token, undefined, asOfDate);
      // Fetch all opportunities (includes approved ones)
      const data = await api.getOpportunities(token);
      setOpportunities(data);
      const dateMsg = asOfDate ? ` for ${asOfDate}` : '';
      // Show appropriate message based on scan result
      const foundCount = result.opportunities?.length || 0;
      setTotalQualifiedCount(foundCount);
      if (result.skipped) {
        setScanMessage('Scan already in progress. Please wait and try again.');
      } else if (result.message) {
        setScanMessage(result.message);
      } else {
        const totalScanned = result.scannedCount || 0;
        setScanMessage(foundCount === 0
          ? `Scanned ${totalScanned} stocks${dateMsg}. No qualified opportunities found.`
          : `Scanned ${totalScanned} stocks${dateMsg}. Found ${foundCount} qualified opportunities.`);
      }
      setTimeout(() => setScanMessage(null), 10000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (!token) return;
    setCalculatingPosition(true);
    try {
      const result = await api.calculatePositionSize(token, id);
      setPositionCalc(result);
      setShowConfirmModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate position');
    } finally {
      setCalculatingPosition(false);
    }
  };

  const handleConfirmApprove = async () => {
    if (!token || !selected || !positionCalc) return;

    // If simulation mode, run simulation instead of approving
    if (simulationConfig?.enabled && simulationConfig.date && positionCalc.status === 'OK') {
      setRunningSimulation(true);
      try {
        const result = await api.runSimulation(token, {
          symbol: selected.symbol,
          entryDate: simulationConfig.date,
          entryPrice: positionCalc.entry,
          shares: positionCalc.shares!,
          stopPrice: positionCalc.stop!,
          trailPercent: positionCalc.stop_pct!,
          maxDays: simulationConfig.maxDays,
        });
        setSimulationResult(result);
        setShowSimulationResult(true);
        setShowConfirmModal(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Simulation failed');
      } finally {
        setRunningSimulation(false);
      }
      return;
    }

    // Normal approval flow - execute the trade
    setExecutingTrade(true);
    try {
      const result = await api.approveOpportunity(token, selected.id);
      if (result.success) {
        // Show success message
        setScanMessage(`Trade executed: ${result.shares} shares of ${selected.symbol} @ $${result.entryPrice?.toFixed(2)}`);
        setTimeout(() => setScanMessage(null), 8000);
      } else {
        // Show error from trade execution
        setError(result.error || 'Trade execution failed');
      }
      await fetchOpportunities();
      setShowConfirmModal(false);
      setShowFinalConfirm(false);
      setPositionCalc(null);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setExecutingTrade(false);
    }
  };

  const handleCancelApprove = () => {
    setShowConfirmModal(false);
    setShowFinalConfirm(false);
    setPositionCalc(null);
  };

  const handleReject = async (id: string) => {
    if (!token) return;
    try {
      await api.rejectOpportunity(token, id);
      await fetchOpportunities();
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    }
  };

  const fmt = (val: unknown, dec: number = 2): string => {
    const num = Number(val);
    return isNaN(num) ? 'N/A' : num.toFixed(dec);
  };

  const fmtPct = (val: unknown): string => {
    const num = Number(val);
    return isNaN(num) ? 'N/A' : (num * 100).toFixed(2) + '%';
  };

  const fmtVol = (val: unknown): string => {
    const num = Number(val);
    if (isNaN(num)) return 'N/A';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(0) + 'K';
    return num.toFixed(0);
  };

  const bool = (val: unknown): JSX.Element => (
    <span className={val === true ? 'text-green-400' : 'text-red-400'}>
      {val === true ? 'TRUE' : 'FALSE'}
    </span>
  );

  if (loading) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Opportunities</h1>
          <span className="text-sm text-gray-400">
            {totalQualifiedCount !== null ? (
              <>{totalQualifiedCount} qualified, {qualifiedOpportunities.length} shown</>
            ) : (
              <>{qualifiedOpportunities.length} shown</>
            )}
          </span>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm rounded transition-colors"
        >
          {scanning ? 'Scanning...' : 'Scan'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 p-2 rounded text-sm">{error}</div>
      )}

      {scanMessage && (
        <div className={`p-2 rounded text-sm ${scanMessage.includes('Found') ? 'bg-green-500/10 border border-green-500 text-green-500' : 'bg-blue-500/10 border border-blue-500 text-blue-400'}`}>
          {scanMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2 max-h-[80vh] overflow-y-auto">
          {qualifiedOpportunities.length === 0 ? (
            <div className="bg-gray-800 p-6 rounded text-center text-gray-400 text-sm">
              {opportunities.length === 0 ? 'No opportunities. Click Scan.' : 'No matches. Adjust filters.'}
            </div>
          ) : (
            qualifiedOpportunities.map((opp) => (
              <div
                key={opp.id}
                onClick={() => setSelected(opp)}
                className={`bg-gray-800 p-3 rounded cursor-pointer transition-colors ${
                  selected?.id === opp.id ? 'border-2 border-blue-500' :
                  opp.status === 'APPROVED' ? 'border border-green-500/50' : 'border border-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Small Logo */}
                  <div className="w-8 h-8 flex-shrink-0 bg-gray-700 rounded overflow-hidden flex items-center justify-center">
                    {opp.logoUrl ? (
                      <img
                        src={opp.logoUrl}
                        alt=""
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-sm font-bold text-gray-500">{opp.symbol.charAt(0)}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-white">{opp.symbol}</span>
                        <span
                          className={`text-sm font-mono px-1 rounded transition-all duration-500 ${
                            priceFlash[opp.symbol] === 'up'
                              ? 'bg-green-500/30 text-green-300'
                              : priceFlash[opp.symbol] === 'down'
                              ? 'bg-red-500/30 text-red-300'
                              : 'text-white'
                          }`}
                        >
                          ${fmt(livePrices[opp.symbol]?.price ?? opp.currentPrice)}
                        </span>
                        {livePrices[opp.symbol]?.changePercent !== undefined && (
                          <span className={`text-xs font-mono ${
                            (livePrices[opp.symbol]?.changePercent ?? 0) >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                          }`}>
                            {(livePrices[opp.symbol]?.changePercent ?? 0) >= 0 ? '+' : ''}
                            {(livePrices[opp.symbol]?.changePercent ?? 0).toFixed(2)}%
                          </span>
                        )}
                        {openPositionSymbols.has(opp.symbol) && (
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/30">OPEN</span>
                        )}
                        {opp.status === 'APPROVED' && (
                          <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">APPROVED</span>
                        )}
                      </div>
                      <span className="text-blue-400 font-bold">{opp.score}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500 truncate">
                      {opp.companyName || `${fmtPct(opp.factors?.pullback)} pullback | ${opp.factors?.trendState || 'N/A'}`}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {selected && (
          <div className="bg-gray-800 p-4 rounded space-y-3 overflow-y-auto max-h-[80vh] lg:sticky lg:top-4">
            <div className="border-b border-gray-700 pb-3">
              <div className="flex items-start gap-3">
                {/* Logo */}
                <div className="w-12 h-12 flex-shrink-0 bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center">
                  {selected.logoUrl ? (
                    <img
                      src={selected.logoUrl}
                      alt={`${selected.symbol} logo`}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <span className={`text-xl font-bold text-gray-400 ${selected.logoUrl ? 'hidden' : ''}`}>
                    {selected.symbol.charAt(0)}
                  </span>
                </div>
                {/* Symbol & Company */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">{selected.symbol}</h2>
                    <span className="text-blue-400 font-bold">Score: {selected.score}</span>
                  </div>
                  {selected.companyName && (
                    <div className="text-sm text-gray-400 mt-0.5 truncate" title={selected.companyName}>
                      {selected.companyName}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-lg font-mono px-1 rounded transition-all duration-500 ${
                        priceFlash[selected.symbol] === 'up'
                          ? 'bg-green-500/30 text-green-300'
                          : priceFlash[selected.symbol] === 'down'
                          ? 'bg-red-500/30 text-red-300'
                          : 'text-white'
                      }`}
                    >
                      ${fmt(livePrices[selected.symbol]?.price ?? selected.currentPrice)}
                    </span>
                    {livePrices[selected.symbol]?.changePercent !== undefined && (
                      <span className={`text-sm font-mono ${
                        (livePrices[selected.symbol]?.changePercent ?? 0) >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                      }`}>
                        {(livePrices[selected.symbol]?.changePercent ?? 0) >= 0 ? '+' : ''}
                        {(livePrices[selected.symbol]?.changePercent ?? 0).toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {openPositionSymbols.has(selected.symbol) && (
                <div className="mt-2 bg-yellow-500/10 border border-yellow-500/30 rounded px-3 py-2 flex items-center gap-2">
                  <span className="text-yellow-400 text-sm font-medium">Already an open position</span>
                </div>
              )}
            </div>

            {/* Compact Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {/* Row 1: Liquidity */}
              <div className="bg-gray-700/50 p-2 rounded col-span-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">ADV (45d)</span>
                  <span className="text-white font-mono">{fmtVol(selected.factors?.adv45)}</span>
                </div>
              </div>

              {/* Row 2: SMA200 */}
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">SMA200</div>
                <div className="text-white font-mono">${fmt(selected.factors?.sma200)}</div>
              </div>
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">SMA200 (20d ago)</div>
                <div className="text-white font-mono">${fmt(selected.factors?.sma200_20daysAgo)}</div>
              </div>

              {/* Row 3: Trend */}
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Slope</div>
                <div className="text-white font-mono">{fmt(selected.factors?.slope, 4)}</div>
              </div>
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Trend</div>
                <div className={`font-mono font-bold ${
                  selected.factors?.trendState === 'Uptrend' ? 'text-green-400' :
                  selected.factors?.trendState === 'Declining' ? 'text-red-400' : 'text-yellow-400'
                }`}>{selected.factors?.trendState || 'N/A'}</div>
              </div>

              {/* Row 4: Extension */}
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Ext %</div>
                <div className="text-white font-mono">{fmtPct(selected.factors?.extPct)}</div>
              </div>
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Not Extended</div>
                <div className="font-mono">{bool(selected.factors?.notExtended)}</div>
              </div>

              {/* Row 5: Recent High */}
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Recent High</div>
                <div className="text-white font-mono">${fmt(selected.factors?.recentHigh)}</div>
              </div>
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">High Date</div>
                <div className="text-white font-mono">{selected.factors?.recentHighDate || 'N/A'}</div>
              </div>

              {/* Row 6: Pullback */}
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Pullback</div>
                <div className="text-white font-mono">{fmtPct(selected.factors?.pullback)}</div>
              </div>
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">In Range (5-8%)</div>
                <div className="font-mono">{bool(selected.factors?.pullbackInRange)}</div>
              </div>

              {/* Row 7: Support & Bounce */}
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Support Low</div>
                <div className="text-white font-mono">${fmt(selected.factors?.pullbackLow)}</div>
              </div>
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Bounce OK</div>
                <div className="font-mono">{bool(selected.factors?.bounceOk)}</div>
              </div>

              {/* Row 8: Above SMA */}
              <div className="bg-gray-700/50 p-2 rounded col-span-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Above SMA200</span>
                  <span className="font-mono">{bool(selected.factors?.aboveSma200)}</span>
                </div>
              </div>

              {/* Row 9: Sharp Drop */}
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Drops &gt;3% ({selected.factors?.sharpDropCount || 0})</div>
                <div className="font-mono">{bool(selected.factors?.noSharpDrop)}</div>
              </div>
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-gray-500">Worst Drop</div>
                <div className={`font-mono ${Number(selected.factors?.worstDrop || 0) < -0.03 ? 'text-red-400' : 'text-white'}`}>
                  {fmtPct(selected.factors?.worstDrop)}
                </div>
              </div>
            </div>

            {/* Actions */}
            {selected.status === 'APPROVED' ? (
              <div className="bg-green-500/20 border border-green-500 rounded p-3 text-center">
                <span className="text-green-400 font-medium">Trade Approved</span>
              </div>
            ) : (
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleApprove(selected.id)}
                  disabled={calculatingPosition}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white text-sm rounded font-medium"
                >
                  {calculatingPosition ? 'Calculating...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleReject(selected.id)}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded font-medium"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Position Confirmation Modal */}
      {showConfirmModal && positionCalc && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-600">
            <h3 className="text-lg font-bold text-white mb-4">
              {positionCalc.status === 'OK' ? 'Confirm Trade' : 'Trade Rejected'}
            </h3>

            {positionCalc.status === 'REJECT' ? (
              <div className="space-y-4">
                <div className="bg-red-500/20 border border-red-500 rounded p-3">
                  <div className="text-red-400 font-medium">Cannot Execute Trade</div>
                  <div className="text-sm text-gray-300 mt-1">{positionCalc.reason}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-700/50 p-3 rounded">
                    <div className="text-gray-500 text-xs">Symbol</div>
                    <div className="text-white font-mono text-lg font-bold">{positionCalc.symbol}</div>
                  </div>
                  <div className="bg-gray-700/50 p-3 rounded">
                    <div className="text-gray-500 text-xs">Shares</div>
                    <div className="text-white font-mono text-lg font-bold">{positionCalc.shares || 0}</div>
                  </div>
                  <div className="bg-gray-700/50 p-2 rounded">
                    <div className="text-gray-500 text-xs">Live Price</div>
                    <div className="text-green-400 font-mono">
                      ${(livePrices[positionCalc.symbol]?.price ?? positionCalc.entry)?.toFixed(2) || '0.00'}
                    </div>
                  </div>
                  <div className="bg-gray-700/50 p-2 rounded">
                    <div className="text-gray-500 text-xs">Stop Price</div>
                    <div className="text-red-400 font-mono">${positionCalc.stop?.toFixed(2)}</div>
                  </div>
                  <div className="bg-gray-700/50 p-2 rounded">
                    <div className="text-gray-500 text-xs">Stop Distance</div>
                    <div className="text-red-400 font-mono">{((positionCalc.stop_pct || 0) * 100).toFixed(2)}%</div>
                  </div>
                  <div className="bg-gray-700/50 p-2 rounded">
                    <div className="text-gray-500 text-xs">Risk/Share</div>
                    <div className="text-white font-mono">${positionCalc.risk_per_share?.toFixed(2) || '0.00'}</div>
                  </div>
                  <div className="bg-blue-500/20 border border-blue-500/50 p-2 rounded">
                    <div className="text-blue-400 text-xs">Position Size</div>
                    <div className="text-white font-mono font-bold">${positionCalc.position_usd?.toLocaleString() || '0'}</div>
                  </div>
                  <div className="bg-red-500/20 border border-red-500/50 p-2 rounded">
                    <div className="text-red-400 text-xs">Max Loss</div>
                    <div className="text-white font-mono font-bold">${positionCalc.max_loss_usd?.toLocaleString() || '0'}</div>
                  </div>
                </div>
                <button
                  onClick={handleCancelApprove}
                  className="w-full py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-700/50 p-3 rounded">
                    <div className="text-gray-500 text-xs">Symbol</div>
                    <div className="text-white font-mono text-lg font-bold">{positionCalc.symbol}</div>
                  </div>
                  <div className="bg-gray-700/50 p-3 rounded">
                    <div className="text-gray-500 text-xs">Shares</div>
                    <div className="text-white font-mono text-lg font-bold">{positionCalc.shares}</div>
                  </div>
                  <div className="bg-green-500/20 border border-green-500/50 p-2 rounded">
                    <div className="text-green-400 text-xs">Live Price</div>
                    <div className="text-green-400 font-mono font-bold">
                      ${(livePrices[positionCalc.symbol]?.price ?? positionCalc.entry)?.toFixed(2) || '0.00'}
                      {livePrices[positionCalc.symbol]?.changePercent !== undefined && (
                        <span className={`text-xs ml-1 ${
                          (livePrices[positionCalc.symbol]?.changePercent ?? 0) >= 0 ? 'text-green-300' : 'text-red-400'
                        }`}>
                          {(livePrices[positionCalc.symbol]?.changePercent ?? 0) >= 0 ? '+' : ''}
                          {(livePrices[positionCalc.symbol]?.changePercent ?? 0).toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="bg-gray-700/50 p-2 rounded">
                    <div className="text-gray-500 text-xs">Stop Price</div>
                    <div className="text-red-400 font-mono">${positionCalc.stop?.toFixed(2)}</div>
                  </div>
                  <div className="bg-gray-700/50 p-2 rounded">
                    <div className="text-gray-500 text-xs">Stop Distance</div>
                    <div className="text-yellow-400 font-mono">{((positionCalc.stop_pct || 0) * 100).toFixed(2)}%</div>
                  </div>
                  <div className="bg-gray-700/50 p-2 rounded">
                    <div className="text-gray-500 text-xs">Risk/Share</div>
                    <div className="text-white font-mono">${positionCalc.risk_per_share?.toFixed(2)}</div>
                  </div>
                  <div className="bg-blue-500/20 border border-blue-500/50 p-2 rounded">
                    <div className="text-blue-400 text-xs">Position Size</div>
                    <div className="text-white font-mono font-bold">${positionCalc.position_usd?.toLocaleString()}</div>
                  </div>
                  <div className="bg-red-500/20 border border-red-500/50 p-2 rounded">
                    <div className="text-red-400 text-xs">Max Loss</div>
                    <div className="text-white font-mono font-bold">${positionCalc.max_loss_usd?.toLocaleString()}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-400 text-center">
                  Trade will execute at live market price
                </div>

                {/* Two-step confirmation */}
                {!showFinalConfirm ? (
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleCancelApprove}
                      className="flex-1 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => setShowFinalConfirm(true)}
                      disabled={runningSimulation}
                      className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white rounded font-medium"
                    >
                      {simulationConfig?.enabled ? 'Run Simulation' : 'Confirm Trade'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3 pt-2">
                    {/* Final confirmation prompt */}
                    <div className="bg-yellow-500/10 border border-yellow-500/50 rounded p-3 text-center">
                      <div className="text-yellow-400 font-medium">
                        {executingTrade ? (
                          <div className="flex items-center justify-center gap-2">
                            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span>Executing trade on IB Gateway...</span>
                          </div>
                        ) : (
                          'Are you sure you want to open this position?'
                        )}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowFinalConfirm(false)}
                        disabled={executingTrade}
                        className="flex-1 py-2 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded font-medium"
                      >
                        No
                      </button>
                      <button
                        onClick={handleConfirmApprove}
                        disabled={executingTrade || runningSimulation}
                        className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed text-white rounded font-medium flex items-center justify-center gap-2"
                      >
                        {executingTrade ? (
                          <>
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span>Executing...</span>
                          </>
                        ) : runningSimulation ? (
                          'Simulating...'
                        ) : (
                          'Yes, Execute Trade'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Simulation Result Modal */}
      {showSimulationResult && simulationResult && (
        <SimulationResultModal
          result={simulationResult}
          onClose={() => {
            setShowSimulationResult(false);
            setSimulationResult(null);
          }}
        />
      )}
    </div>
  );
}
