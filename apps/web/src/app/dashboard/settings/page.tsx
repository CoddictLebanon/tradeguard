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

type SettingsTab = 'account' | 'trading' | 'risk' | 'simulation';

const tabs: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'trading', label: 'Trading', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
  { id: 'risk', label: 'Risk Management', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { id: 'simulation', label: 'Simulation', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { id: 'account', label: 'Account', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
];

export default function SettingsPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const setAuth = useAuthStore((state) => state.setAuth);
  const isAdmin = user?.role === 'admin';

  const [activeTab, setActiveTab] = useState<SettingsTab>('trading');
  const [limits, setLimits] = useState<SafetyLimits | null>(null);
  const [tradingState, setTradingState] = useState<TradingState | null>(null);
  const [accountConfig, setAccountConfig] = useState<AccountConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [simulationConfig, setSimulationConfig] = useState<{ enabled: boolean; date: string | null; maxDays: number } | null>(null);
  const [ibStatus, setIBStatus] = useState<IBStatus | null>(null);
  const [ibAccount, setIBAccount] = useState<IBAccount | null>(null);
  const [ibConnecting, setIBConnecting] = useState(false);

  // Account settings state
  const [newEmail, setNewEmail] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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
    api.getIBAccount().then(setIBAccount).catch(() => {});
  };

  useEffect(() => {
    fetchSettings();
  }, [token]);

  // Clear messages when switching tabs
  useEffect(() => {
    setError(null);
    setSuccess(null);
  }, [activeTab]);

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
      setSuccess('Safety limits saved successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save limits');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccountConfig = async () => {
    if (!token || !accountConfig) return;
    setSaving(true);
    try {
      await api.updateAccountConfig(token, accountConfig);
      await fetchSettings();
      setSuccess('Position sizing saved successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save position sizing config');
    } finally {
      setSaving(false);
    }
  };

  const handlePause = async () => {
    if (!token || !pauseReason.trim()) return;
    try {
      await api.pauseTrading(token, pauseReason);
      setPauseReason('');
      await fetchSettings();
      setSuccess('Trading paused');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause trading');
    }
  };

  const handleResume = async () => {
    if (!token) return;
    try {
      await api.resumeTrading(token);
      await fetchSettings();
      setSuccess('Trading resumed');
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
      setSuccess(`Switched to ${tradingState.mode === 'paper' ? 'live' : 'paper'} mode`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch mode');
    }
  };

  const handleSaveSimulation = async () => {
    if (!token || !simulationConfig) return;
    setSaving(true);
    try {
      await api.updateSimulationConfig(token, {
        enabled: simulationConfig.enabled,
        date: simulationConfig.date || undefined,
        maxDays: simulationConfig.maxDays,
      });
      await fetchSettings();
      setSuccess('Simulation settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save simulation config');
    } finally {
      setSaving(false);
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
      await new Promise(r => setTimeout(r, 1000));
      await fetchSettings();
      setSuccess('Connected to Interactive Brokers');
    } catch (err) {
      setError('Could not connect to IB. Make sure TWS is running and the IB Proxy (port 6680) is started.');
    } finally {
      setIBConnecting(false);
    }
  };

  const handleSaveAccount = async () => {
    if (!token) return;
    setError(null);
    setSuccess(null);

    if (!currentPassword) {
      setError('Current password is required');
      return;
    }

    if (newPassword && newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword && newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    setSaving(true);
    try {
      const emailToSave = newEmail ?? user?.email;
      if (emailToSave && emailToSave !== user?.email) {
        const result = await api.updateProfile(token, { newEmail: emailToSave, password: currentPassword });
        setAuth(result.accessToken, result.user);
        setSuccess('Email updated successfully');
      }

      if (newPassword) {
        await api.changePassword(token, { currentPassword, newPassword });
        setSuccess((prev) => prev ? `${prev}. Password updated successfully` : 'Password updated successfully');
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNewEmail(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account');
    } finally {
      setSaving(false);
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
    <div className="space-y-6">
      {/* Tabs */}
      <div className="border-b border-gray-700">
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
              </svg>
              <span className="font-medium">{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="max-w-3xl">
        {/* Messages */}
        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-500/10 border border-green-500 text-green-500 p-4 rounded-lg mb-6">
            {success}
          </div>
        )}

        {/* Account Tab */}
        {activeTab === 'account' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Account Settings</h2>
              <p className="text-gray-400 text-sm">Manage your email address and password.</p>
            </div>

            <div className="bg-gray-800 rounded-lg p-6 space-y-6">
              <div>
                <h3 className="text-lg font-medium text-white mb-4">Profile</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Email Address</label>
                    <input
                      type="email"
                      value={newEmail ?? user?.email ?? ''}
                      onChange={(e) => setNewEmail(e.target.value)}
                      onFocus={() => newEmail === null && setNewEmail(user?.email ?? '')}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                    />
                  </div>
                </div>
              </div>

              <hr className="border-gray-700" />

              <div>
                <h3 className="text-lg font-medium text-white mb-4">Change Password</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Current Password *</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Leave blank to keep current"
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSaveAccount}
                  disabled={saving || !currentPassword}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Trading Tab */}
        {activeTab === 'trading' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Trading Settings</h2>
              <p className="text-gray-400 text-sm">Configure your trading mode and broker connection.</p>
            </div>

            {/* Trading Mode */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-medium text-white mb-4">Trading Mode</h3>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className={`text-2xl font-bold uppercase ${
                    tradingState?.mode === 'paper' ? 'text-yellow-500' : 'text-green-500'
                  }`}>
                    {tradingState?.mode}
                  </span>
                  {tradingState?.mode === 'paper' && (
                    <span className="text-gray-400 text-sm">
                      Complete paper trading with positive P/L to unlock live mode
                    </span>
                  )}
                </div>
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
            </div>

            {/* Trading Controls */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-medium text-white mb-4">Trading Controls</h3>
              {tradingState?.isPaused ? (
                <div className="space-y-4">
                  <div className="bg-red-500/20 border border-red-500 p-4 rounded-lg">
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
            </div>

            {/* Interactive Brokers */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-medium text-white mb-4">Interactive Brokers</h3>
              <div className="flex items-center gap-4 mb-4">
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
                <div className="bg-gray-700/50 p-4 rounded-lg grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
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
                    Make sure TWS or IB Gateway is running with API connections enabled on port 7497 (paper) or 7496 (live).
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
            </div>
          </div>
        )}

        {/* Risk Tab */}
        {activeTab === 'risk' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Risk Management</h2>
              <p className="text-gray-400 text-sm">Configure safety limits and position sizing rules.</p>
            </div>

            {/* Safety Limits */}
            {limits && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-medium text-white mb-4">Safety Limits</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Daily Loss Limit (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={limits.dailyLossLimitPercent}
                      onChange={(e) => setLimits({ ...limits, dailyLossLimitPercent: Number(e.target.value) })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Weekly Loss Limit (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={limits.weeklyLossLimitPercent}
                      onChange={(e) => setLimits({ ...limits, weeklyLossLimitPercent: Number(e.target.value) })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Monthly Loss Limit (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={limits.monthlyLossLimitPercent}
                      onChange={(e) => setLimits({ ...limits, monthlyLossLimitPercent: Number(e.target.value) })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Max Open Positions</label>
                    <input
                      type="number"
                      value={limits.maxOpenPositions}
                      onChange={(e) => setLimits({ ...limits, maxOpenPositions: Number(e.target.value) })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Max Capital Deployed (%)</label>
                    <input
                      type="number"
                      value={limits.maxCapitalDeployedPercent}
                      onChange={(e) => setLimits({ ...limits, maxCapitalDeployedPercent: Number(e.target.value) })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSaveLimits}
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg"
                >
                  {saving ? 'Saving...' : 'Save Safety Limits'}
                </button>
              </div>
            )}

            {/* Position Sizing */}
            {accountConfig && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-medium text-white mb-4">Position Sizing</h3>
                <p className="text-gray-400 text-sm mb-4">
                  Configure how position sizes are calculated for each trade.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Total Capital ($)</label>
                    <input
                      type="number"
                      step="1000"
                      value={accountConfig.totalCapital}
                      onChange={(e) => setAccountConfig({ ...accountConfig, totalCapital: Number(e.target.value) })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Risk Per Trade (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={accountConfig.riskPerTradePercent}
                      onChange={(e) => setAccountConfig({ ...accountConfig, riskPerTradePercent: Number(e.target.value) })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Risk amount: ${((accountConfig.totalCapital * accountConfig.riskPerTradePercent) / 100).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Stop Buffer (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={accountConfig.stopBuffer * 100}
                      onChange={(e) => setAccountConfig({ ...accountConfig, stopBuffer: Number(e.target.value) / 100 })}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Buffer below pullback low for stop placement
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleSaveAccountConfig}
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg"
                >
                  {saving ? 'Saving...' : 'Save Position Sizing'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Simulation Tab */}
        {activeTab === 'simulation' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Simulation Settings</h2>
              <p className="text-gray-400 text-sm">Configure backtesting and simulation mode.</p>
            </div>

            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-medium text-white mb-4">Simulation Mode</h3>
              <p className="text-gray-400 text-sm mb-4">
                Enable to backtest trades using historical data. The app will behave as if today is the simulation date.
              </p>

              {simulationConfig && (
                <div className="space-y-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={simulationConfig.enabled}
                      onChange={(e) => setSimulationConfig({ ...simulationConfig, enabled: e.target.checked })}
                      className="w-5 h-5 rounded bg-gray-700 border-gray-600"
                    />
                    <span className="text-white font-medium">Enable Simulation Mode</span>
                  </label>

                  {simulationConfig.enabled && (
                    <div className="pl-8 space-y-4 border-l-2 border-gray-700">
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Simulation Date</label>
                        <input
                          type="date"
                          value={simulationConfig.date || ''}
                          onChange={(e) => setSimulationConfig({ ...simulationConfig, date: e.target.value })}
                          max={new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                          className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600"
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
                          className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Maximum trading days before force-closing a simulated position (default: 300)
                        </p>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleSaveSimulation}
                    disabled={saving}
                    className="px-6 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white rounded-lg"
                  >
                    {saving ? 'Saving...' : 'Save Simulation Settings'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
