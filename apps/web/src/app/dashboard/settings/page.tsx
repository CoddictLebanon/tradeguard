'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface SafetyLimits {
  dailyLossLimitPercent: number;
  weeklyLossLimitPercent: number;
  monthlyLossLimitPercent: number;
  maxCapitalDeployedPercent: number;
  maxOpenPositions: number;
}

interface TradingState {
  mode: 'paper' | 'live';
  isPaused: boolean;
  pauseReason: string | null;
}

interface IBStatus {
  connected: boolean;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  tradingMode: 'paper' | 'live';
}

interface IBAccount {
  accountId: string;
  netLiquidation: number;
  availableFunds: number;
  buyingPower: number;
  totalCashValue: number;
}

interface AccountConfig {
  totalCapital: number;
  riskPerTradePercent: number;
  maxCapitalDeployedPercent: number;
  stopBuffer: number;
}

export default function SettingsPage() {
  const token = useAuthStore((state) => state.token);
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const [limits, setLimits] = useState<SafetyLimits | null>(null);
  const [tradingState, setTradingState] = useState<TradingState | null>(null);
  const [accountConfig, setAccountConfig] = useState<AccountConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [simulationConfig, setSimulationConfig] = useState<{ enabled: boolean; date: string | null; maxDays: number } | null>(null);
  const [savingSimulation, setSavingSimulation] = useState(false);
  const [ibStatus, setIBStatus] = useState<IBStatus | null>(null);
  const [ibAccount, setIBAccount] = useState<IBAccount | null>(null);
  const [ibConnecting, setIBConnecting] = useState(false);

  const fetchSettings = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const [dashboardData, configData, simConfig, ibStatusData] = await Promise.all([
        api.getDashboard(token),
        api.getAccountConfig(token),
        api.getSimulationConfig(token),
        api.getIBStatus().catch(() => null),
      ]);
      setLimits(dashboardData.limits);
      setTradingState(dashboardData.state);
      setAccountConfig(configData.account);
      setSimulationConfig(simConfig);
      if (ibStatusData) setIBStatus(ibStatusData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }

    // Fetch IB account info separately (don't block page load)
    api.getIBAccount().then(setIBAccount).catch(() => {});
  };

  useEffect(() => {
    fetchSettings();
  }, [token]);

  const handleSaveLimits = async () => {
    if (!token || !limits) return;
    setSaving(true);
    try {
      await api.updateLimits(token, {
        dailyLossLimit: limits.dailyLossLimitPercent,
        weeklyLossLimit: limits.weeklyLossLimitPercent,
        maxOpenPositions: limits.maxOpenPositions,
      });
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save limits');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccountConfig = async () => {
    if (!token || !accountConfig) return;
    setSavingConfig(true);
    try {
      await api.updateAccountConfig(token, accountConfig);
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save position sizing config');
    } finally {
      setSavingConfig(false);
    }
  };

  const handlePause = async () => {
    if (!token || !pauseReason.trim()) return;
    try {
      await api.pauseTrading(token, pauseReason);
      setPauseReason('');
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause trading');
    }
  };

  const handleResume = async () => {
    if (!token) return;
    try {
      await api.resumeTrading(token);
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume trading');
    }
  };

  const handleSwitchMode = async () => {
    if (!token || !tradingState) return;
    try {
      if (tradingState.mode === 'paper') {
        const result = await api.switchToLive(token);
        if (!result.success) {
          setError(result.reason || 'Cannot switch to live mode');
          return;
        }
      } else {
        await api.switchToPaper(token);
      }
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch mode');
    }
  };

  const handleSaveSimulation = async () => {
    if (!token || !simulationConfig) return;
    setSavingSimulation(true);
    try {
      await api.updateSimulationConfig(token, {
        enabled: simulationConfig.enabled,
        date: simulationConfig.date || undefined,
        maxDays: simulationConfig.maxDays,
      });
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save simulation config');
    } finally {
      setSavingSimulation(false);
    }
  };

  const handleIBConnect = async () => {
    setIBConnecting(true);
    setError(null);
    try {
      const result = await api.reconnectIB();
      if (!result.success) {
        throw new Error(result.error || 'Connection failed');
      }
      // Wait a moment for connection to establish
      await new Promise(r => setTimeout(r, 1000));
      await fetchSettings();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to connect to Interactive Brokers';
      setError('Could not connect to IB. Make sure TWS is running and the IB Proxy (port 6680) is started.');
    } finally {
      setIBConnecting(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400">Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="bg-yellow-500/10 border border-yellow-500 text-yellow-500 p-4 rounded">
        Admin access required to modify settings.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded">
          {error}
        </div>
      )}

      {/* Trading Mode */}
      <section className="bg-gray-800 p-6 rounded-lg space-y-4">
        <h2 className="text-lg font-semibold text-white">Trading Mode</h2>
        <div className="flex items-center gap-4">
          <span className={`text-xl font-bold uppercase ${
            tradingState?.mode === 'paper' ? 'text-yellow-500' : 'text-green-500'
          }`}>
            {tradingState?.mode}
          </span>
          <button
            onClick={handleSwitchMode}
            className={`px-4 py-2 rounded-lg ${
              tradingState?.mode === 'paper'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-yellow-600 hover:bg-yellow-700'
            } text-white`}
          >
            {tradingState?.mode === 'paper' ? 'Switch to Live' : 'Switch to Paper'}
          </button>
        </div>
        {tradingState?.mode === 'paper' && (
          <p className="text-gray-400 text-sm">
            Must complete minimum paper trading period with positive P/L to switch to live.
          </p>
        )}
      </section>

      {/* Interactive Brokers Connection */}
      <section className="bg-gray-800 p-6 rounded-lg space-y-4">
        <h2 className="text-lg font-semibold text-white">Interactive Brokers Connection</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              ibStatus?.connected ? 'bg-green-500' :
              ibStatus?.status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              'bg-red-500'
            }`} />
            <span className={`font-medium ${
              ibStatus?.connected ? 'text-green-500' :
              ibStatus?.status === 'connecting' ? 'text-yellow-500' :
              'text-red-500'
            }`}>
              {ibStatus?.connected ? 'Connected' :
               ibStatus?.status === 'connecting' ? 'Connecting...' :
               'Disconnected'}
            </span>
          </div>
          {ibStatus?.connected && (
            <span className="text-gray-400 text-sm">
              ({ibStatus.tradingMode === 'paper' ? 'Paper Trading' : 'Live Trading'})
            </span>
          )}
        </div>

        {ibStatus?.connected && ibAccount && (
          <div className="bg-gray-700/50 p-4 rounded-lg grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-400">Account</div>
              <div className="text-white font-mono">{ibAccount.accountId}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Net Liquidation</div>
              <div className="text-green-400 font-mono">${ibAccount.netLiquidation?.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Available Funds</div>
              <div className="text-blue-400 font-mono">${ibAccount.availableFunds?.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Buying Power</div>
              <div className="text-purple-400 font-mono">${ibAccount.buyingPower?.toLocaleString()}</div>
            </div>
          </div>
        )}

        {!ibStatus?.connected && (
          <div className="space-y-3">
            <p className="text-gray-400 text-sm">
              To connect, make sure TWS or IB Gateway is running with API connections enabled on port 7497 (paper) or 7496 (live).
            </p>
            <button
              onClick={handleIBConnect}
              disabled={ibConnecting}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg flex items-center gap-2"
            >
              {ibConnecting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Connecting...
                </>
              ) : (
                'Connect to IB'
              )}
            </button>
          </div>
        )}

        {ibStatus?.connected && (
          <p className="text-green-400 text-sm">
            ✓ Orders will be sent to Interactive Brokers when you approve trades.
          </p>
        )}
      </section>

      {/* Trading Controls */}
      <section className="bg-gray-800 p-6 rounded-lg space-y-4">
        <h2 className="text-lg font-semibold text-white">Trading Controls</h2>
        {tradingState?.isPaused ? (
          <div className="space-y-4">
            <div className="bg-red-500/20 border border-red-500 p-4 rounded">
              <span className="text-red-500 font-bold">Trading is paused:</span>
              <span className="text-red-400 ml-2">{tradingState.pauseReason}</span>
            </div>
            <button
              onClick={handleResume}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
            >
              Resume Trading
            </button>
          </div>
        ) : (
          <div className="flex gap-4">
            <input
              type="text"
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              placeholder="Reason for pausing..."
              className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500"
            />
            <button
              onClick={handlePause}
              disabled={!pauseReason.trim()}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white rounded-lg"
            >
              Pause Trading
            </button>
          </div>
        )}
      </section>

      {/* Safety Limits */}
      {limits && (
        <section className="bg-gray-800 p-6 rounded-lg space-y-4">
          <h2 className="text-lg font-semibold text-white">Safety Limits</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400">Daily Loss Limit (%)</label>
              <input
                type="number"
                step="0.1"
                value={limits.dailyLossLimitPercent}
                onChange={(e) => setLimits({ ...limits, dailyLossLimitPercent: Number(e.target.value) })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400">Weekly Loss Limit (%)</label>
              <input
                type="number"
                step="0.1"
                value={limits.weeklyLossLimitPercent}
                onChange={(e) => setLimits({ ...limits, weeklyLossLimitPercent: Number(e.target.value) })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400">Monthly Loss Limit (%)</label>
              <input
                type="number"
                step="0.1"
                value={limits.monthlyLossLimitPercent}
                onChange={(e) => setLimits({ ...limits, monthlyLossLimitPercent: Number(e.target.value) })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400">Max Capital Deployed (%)</label>
              <input
                type="number"
                value={limits.maxCapitalDeployedPercent}
                onChange={(e) => setLimits({ ...limits, maxCapitalDeployedPercent: Number(e.target.value) })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400">Max Open Positions</label>
              <input
                type="number"
                value={limits.maxOpenPositions}
                onChange={(e) => setLimits({ ...limits, maxOpenPositions: Number(e.target.value) })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
            </div>
          </div>
          <button
            onClick={handleSaveLimits}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg"
          >
            {saving ? 'Saving...' : 'Save Limits'}
          </button>
        </section>
      )}

      {/* Position Sizing */}
      {accountConfig && (
        <section className="bg-gray-800 p-6 rounded-lg space-y-4">
          <h2 className="text-lg font-semibold text-white">Position Sizing</h2>
          <p className="text-sm text-gray-400">
            Configure how position sizes are calculated for each trade.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400">Total Capital ($)</label>
              <input
                type="number"
                step="1000"
                value={accountConfig.totalCapital}
                onChange={(e) => setAccountConfig({ ...accountConfig, totalCapital: Number(e.target.value) })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400">Risk Per Trade (%)</label>
              <input
                type="number"
                step="0.01"
                value={accountConfig.riskPerTradePercent}
                onChange={(e) => setAccountConfig({ ...accountConfig, riskPerTradePercent: Number(e.target.value) })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
              <p className="mt-1 text-xs text-gray-500">
                Risk amount: ${((accountConfig.totalCapital * accountConfig.riskPerTradePercent) / 100).toLocaleString()}
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-400">Stop Buffer (%)</label>
              <input
                type="number"
                step="0.1"
                value={accountConfig.stopBuffer * 100}
                onChange={(e) => setAccountConfig({ ...accountConfig, stopBuffer: Number(e.target.value) / 100 })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
              <p className="mt-1 text-xs text-gray-500">
                Buffer below pullback low for stop placement
              </p>
            </div>
          </div>
          <button
            onClick={handleSaveAccountConfig}
            disabled={savingConfig}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg"
          >
            {savingConfig ? 'Saving...' : 'Save Position Sizing'}
          </button>
        </section>
      )}

      {/* Simulation Mode */}
      <section className="bg-gray-800 p-6 rounded-lg space-y-4">
        <h2 className="text-lg font-semibold text-white">Simulation Mode</h2>
        <p className="text-sm text-gray-400">
          Enable to backtest trades using historical data. The app will behave as if today is the simulation date.
        </p>

        {simulationConfig && (
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={simulationConfig.enabled}
                onChange={(e) => setSimulationConfig({ ...simulationConfig, enabled: e.target.checked })}
                className="w-5 h-5 rounded bg-gray-700 border-gray-600"
              />
              <span className="text-white">Enable Simulation Mode</span>
            </label>

            {simulationConfig.enabled && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Simulation Date</label>
                  <input
                    type="date"
                    value={simulationConfig.date || ''}
                    onChange={(e) => setSimulationConfig({ ...simulationConfig, date: e.target.value })}
                    max={new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Must be at least 60 days in the past for simulation to complete
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Max Days to Hold</label>
                  <input
                    type="number"
                    min="1"
                    value={simulationConfig.maxDays}
                    onChange={(e) => setSimulationConfig({ ...simulationConfig, maxDays: Number(e.target.value) })}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Maximum trading days before force-closing a simulated position (default: 300)
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={handleSaveSimulation}
              disabled={savingSimulation}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white rounded"
            >
              {savingSimulation ? 'Saving...' : 'Save Simulation Settings'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
