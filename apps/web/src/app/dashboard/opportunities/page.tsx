'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import SimulationResultModal from '@/components/SimulationResultModal';

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
  aiAnalysis: string | null;
  bullCase: string | null;
  bearCase: string | null;
  aiConfidence: number | null;
  aiRecommendation: string | null;
  suggestedEntry: number;
  suggestedTrailPercent: number;
  status: string;
  createdAt: string;
}

interface Filters {
  qualifiedOnly: boolean;
  trend: 'all' | 'Uptrend' | 'Flat' | 'Declining';
  pullbackInRange: boolean;
  bounceOk: boolean;
  aboveSma200: boolean;
  notExtended: boolean;
  minScore: number;
}

export default function OpportunitiesPage() {
  const token = useAuthStore((state) => state.token);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [positionCalc, setPositionCalc] = useState<PositionSizeResult | null>(null);
  const [calculatingPosition, setCalculatingPosition] = useState(false);
  const [simulationConfig, setSimulationConfig] = useState<{ enabled: boolean; date: string | null } | null>(null);
  const [simulationResult, setSimulationResult] = useState<any>(null);
  const [showSimulationResult, setShowSimulationResult] = useState(false);
  const [runningSimulation, setRunningSimulation] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    qualifiedOnly: true,
    trend: 'all',
    pullbackInRange: false,
    bounceOk: false,
    aboveSma200: false,
    notExtended: false,
    minScore: 0,
  });

  const filteredOpportunities = opportunities.filter((opp) => {
    // ADV must be at least 2M (always enforced)
    if (Number(opp.factors?.adv45 || 0) < 2_000_000) return false;

    // Qualified Only = all metrics must be green
    if (filters.qualifiedOnly) {
      if (opp.factors?.trendState !== 'Uptrend') return false;
      if (!opp.factors?.pullbackInRange) return false;
      if (!opp.factors?.bounceOk) return false;
      if (!opp.factors?.aboveSma200) return false;
      if (!opp.factors?.notExtended) return false;
      if (!opp.factors?.noSharpDrop) return false;
    } else {
      // Individual filters
      if (filters.trend !== 'all' && opp.factors?.trendState !== filters.trend) return false;
      if (filters.pullbackInRange && !opp.factors?.pullbackInRange) return false;
      if (filters.bounceOk && !opp.factors?.bounceOk) return false;
      if (filters.aboveSma200 && !opp.factors?.aboveSma200) return false;
      if (filters.notExtended && !opp.factors?.notExtended) return false;
    }
    if (filters.minScore > 0 && opp.score < filters.minScore) return false;
    return true;
  });

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

  useEffect(() => {
    // Clean up duplicates on initial load
    if (token) {
      api.dedupOpportunities(token).catch(() => {});
    }
    fetchOpportunities();
    const interval = setInterval(fetchOpportunities, 30000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (token) {
      api.getSimulationConfig(token).then(setSimulationConfig).catch(() => {});
    }
  }, [token]);

  const handleScan = async () => {
    if (!token) return;
    setScanning(true);
    setScanMessage(null);
    try {
      // Clean up duplicates first
      await api.dedupOpportunities(token);
      const asOfDate = simulationConfig?.enabled ? simulationConfig.date || undefined : undefined;
      const result = await api.triggerScan(token, undefined, asOfDate);
      await fetchOpportunities();
      const count = result.opportunities?.length || 0;
      const dateMsg = asOfDate ? ` for ${asOfDate}` : '';
      setScanMessage(count === 0 ? `Scan complete${dateMsg}. No stocks found.` : `Found ${count} opportunities${dateMsg}`);
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
          maxDays: 60,
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

    // Normal approval flow
    try {
      await api.approveOpportunity(token, selected.id);
      await fetchOpportunities();
      setShowConfirmModal(false);
      setPositionCalc(null);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    }
  };

  const handleCancelApprove = () => {
    setShowConfirmModal(false);
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
        <h1 className="text-xl font-bold text-white">Opportunities</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${
              showFilters ? 'bg-gray-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Filters {filteredOpportunities.length !== opportunities.length && `(${filteredOpportunities.length})`}
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm rounded transition-colors"
          >
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-gray-800 p-3 rounded border border-gray-700">
          <div className="flex flex-wrap gap-4 items-center text-sm">
            {/* Qualified Only Toggle */}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.qualifiedOnly}
                onChange={(e) => setFilters({ ...filters, qualifiedOnly: e.target.checked })}
                className="w-3.5 h-3.5 rounded bg-gray-700 border-gray-600"
              />
              <span className={filters.qualifiedOnly ? 'text-green-400 font-medium' : 'text-gray-300'}>Qualified Only</span>
            </label>

            {!filters.qualifiedOnly && (
              <>
                {/* Trend Filter */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">Trend:</span>
                  <select
                    value={filters.trend}
                    onChange={(e) => setFilters({ ...filters, trend: e.target.value as Filters['trend'] })}
                    className="bg-gray-700 text-white px-2 py-1 rounded border border-gray-600 text-xs"
                  >
                    <option value="all">All</option>
                    <option value="Uptrend">Uptrend</option>
                    <option value="Flat">Flat</option>
                    <option value="Declining">Declining</option>
                  </select>
                </div>

                {/* Boolean Filters */}
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.pullbackInRange}
                    onChange={(e) => setFilters({ ...filters, pullbackInRange: e.target.checked })}
                    className="w-3.5 h-3.5 rounded bg-gray-700 border-gray-600"
                  />
                  <span className="text-gray-300">Pullback 5-8%</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.bounceOk}
                    onChange={(e) => setFilters({ ...filters, bounceOk: e.target.checked })}
                    className="w-3.5 h-3.5 rounded bg-gray-700 border-gray-600"
                  />
                  <span className="text-gray-300">Bounce OK</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.aboveSma200}
                    onChange={(e) => setFilters({ ...filters, aboveSma200: e.target.checked })}
                    className="w-3.5 h-3.5 rounded bg-gray-700 border-gray-600"
                  />
                  <span className="text-gray-300">Above SMA200</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.notExtended}
                    onChange={(e) => setFilters({ ...filters, notExtended: e.target.checked })}
                    className="w-3.5 h-3.5 rounded bg-gray-700 border-gray-600"
                  />
                  <span className="text-gray-300">Not Extended</span>
                </label>
              </>
            )}

            {/* Min Score */}
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Min Score:</span>
              <input
                type="number"
                min="0"
                max="100"
                value={filters.minScore}
                onChange={(e) => setFilters({ ...filters, minScore: Number(e.target.value) || 0 })}
                className="bg-gray-700 text-white px-2 py-1 rounded border border-gray-600 text-xs w-16"
              />
            </div>

            {/* Reset */}
            <button
              onClick={() => setFilters({ qualifiedOnly: true, trend: 'all', pullbackInRange: false, bounceOk: false, aboveSma200: false, notExtended: false, minScore: 0 })}
              className="text-gray-400 hover:text-white text-xs underline"
            >
              Reset
            </button>
          </div>
        </div>
      )}

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
          {filteredOpportunities.length === 0 ? (
            <div className="bg-gray-800 p-6 rounded text-center text-gray-400 text-sm">
              {opportunities.length === 0 ? 'No opportunities. Click Scan.' : 'No matches. Adjust filters.'}
            </div>
          ) : (
            filteredOpportunities.map((opp) => (
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
                        <span className="text-gray-400 text-sm">${fmt(opp.currentPrice)}</span>
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
                  <div className="text-lg font-mono text-white mt-1">${fmt(selected.currentPrice)}</div>
                </div>
              </div>
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

            {/* AI Analysis */}
            {selected.aiAnalysis && (
              <div className="bg-gray-700/50 p-2 rounded">
                <div className="text-xs text-gray-500 mb-1">AI Analysis</div>
                <div className="text-xs text-white">{selected.aiAnalysis}</div>
              </div>
            )}

            {/* Bull/Bear Cases */}
            {(selected.bullCase || selected.bearCase) && (
              <div className="grid grid-cols-2 gap-2">
                {selected.bullCase && (
                  <div className="bg-green-500/10 border border-green-500/30 p-2 rounded">
                    <div className="text-xs text-green-500 mb-1">Bull</div>
                    <div className="text-xs text-gray-300">{selected.bullCase}</div>
                  </div>
                )}
                {selected.bearCase && (
                  <div className="bg-red-500/10 border border-red-500/30 p-2 rounded">
                    <div className="text-xs text-red-500 mb-1">Bear</div>
                    <div className="text-xs text-gray-300">{selected.bearCase}</div>
                  </div>
                )}
              </div>
            )}

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
                    <div className="text-gray-500 text-xs">Entry Price</div>
                    <div className="text-white font-mono">${positionCalc.entry.toFixed(2)}</div>
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
                  <div className="bg-gray-700/50 p-2 rounded">
                    <div className="text-gray-500 text-xs">Entry Price</div>
                    <div className="text-white font-mono">${positionCalc.entry.toFixed(2)}</div>
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

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleCancelApprove}
                    className="flex-1 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmApprove}
                    disabled={runningSimulation}
                    className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white rounded font-medium"
                  >
                    {runningSimulation ? 'Simulating...' : simulationConfig?.enabled ? 'Run Simulation' : 'Confirm Trade'}
                  </button>
                </div>
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
