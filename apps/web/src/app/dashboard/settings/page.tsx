'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface CronLogDetail {
  positionId: string;
  symbol: string;
  action: 'raised' | 'unchanged' | 'failed';
  oldStopPrice?: number;
  newStopPrice?: number;
  error?: string;
}

interface CronLog {
  id: string;
  jobName: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string | null;
  positionsChecked: number;
  stopsRaised: number;
  failures: number;
  details: CronLogDetail[];
  errorMessage: string | null;
}

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

type SettingsTab = 'account' | 'trading' | 'risk' | 'simulation' | 'notifications';

const tabs: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'trading', label: 'Trading', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
  { id: 'risk', label: 'Risk Management', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { id: 'simulation', label: 'Simulation', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { id: 'notifications', label: 'Notifications', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
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

  // Telegram settings state
  const [telegramConfig, setTelegramConfig] = useState<{
    enabled: boolean;
    botToken: string | null;
    chatId: string | null;
    notifyOpened: boolean;
    notifyStopRaised: boolean;
    notifyClosed: boolean;
  } | null>(null);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [showBotToken, setShowBotToken] = useState(false);

  // Cron logs state
  const [cronLogs, setCronLogs] = useState<CronLog[]>([]);
  const [cronLogsLoading, setCronLogsLoading] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

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
    api.getTelegramConfig(token).then((config) => {
      setTelegramConfig(config);
      setTelegramChatId(config.chatId || '');
    }).catch(() => {});
  };

  const fetchCronLogs = useCallback(async () => {
    if (!token) return;
    setCronLogsLoading(true);
    try {
      const result = await api.getCronLogs(token);
      setCronLogs(result.logs);
    } catch (err) {
      console.error('Failed to load cron logs:', err);
    } finally {
      setCronLogsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSettings();
  }, [token]);

  // Fetch cron logs when Notifications tab is active
  useEffect(() => {
    if (activeTab === 'notifications') {
      fetchCronLogs();
    }
  }, [activeTab, fetchCronLogs]);

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

  // Cron log helper functions
  const toggleLogExpanded = (logId: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  const formatLogTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }) + ', ' + date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-400';
      case 'partial': return 'text-yellow-400';
      case 'failed': return 'text-red-400';
      case 'running': return 'text-blue-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return '✓';
      case 'partial': return '⚠';
      case 'failed': return '✗';
      case 'running': return '⟳';
      default: return '?';
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

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Notification Settings</h2>
              <p className="text-gray-400 text-sm">Configure Telegram notifications for trading events.</p>
            </div>

            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-medium text-white mb-4">Telegram Integration</h3>
              <p className="text-gray-400 text-sm mb-4">
                Receive real-time notifications about your trades via Telegram. Create a bot with @BotFather and get your chat ID to get started.
              </p>

              {telegramConfig && (
                <div className="space-y-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={telegramConfig.enabled}
                      onChange={(e) => setTelegramConfig({ ...telegramConfig, enabled: e.target.checked })}
                      className="w-5 h-5 rounded bg-gray-700 border-gray-600"
                    />
                    <span className="text-white font-medium">Enable Telegram Notifications</span>
                  </label>

                  {telegramConfig.enabled && (
                    <div className="pl-8 space-y-4 border-l-2 border-gray-700">
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Bot Token</label>
                        <div className="flex gap-2">
                          <input
                            type={showBotToken ? 'text' : 'password'}
                            value={telegramBotToken}
                            onChange={(e) => setTelegramBotToken(e.target.value)}
                            placeholder={telegramConfig.botToken ? '********' : 'Enter bot token from @BotFather'}
                            className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowBotToken(!showBotToken)}
                            className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-400 hover:text-white"
                          >
                            {showBotToken ? (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            )}
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Create a bot with @BotFather on Telegram to get your token
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Chat ID</label>
                        <input
                          type="text"
                          value={telegramChatId}
                          onChange={(e) => setTelegramChatId(e.target.value)}
                          placeholder="Enter your Telegram chat ID"
                          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Send a message to @userinfobot on Telegram to get your chat ID
                        </p>
                      </div>

                      <div>
                        <button
                          onClick={async () => {
                            if (!token) return;
                            setTelegramTesting(true);
                            setError(null);
                            try {
                              const result = await api.sendTelegramTest(token);
                              if (result.success) {
                                setSuccess('Test message sent! Check your Telegram.');
                              } else {
                                setError(result.error || 'Failed to send test message');
                              }
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Failed to send test message');
                            } finally {
                              setTelegramTesting(false);
                            }
                          }}
                          disabled={telegramTesting || !telegramConfig.botToken}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg flex items-center gap-2"
                        >
                          {telegramTesting ? (
                            <>
                              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Sending...
                            </>
                          ) : (
                            'Send Test Message'
                          )}
                        </button>
                      </div>

                      <hr className="border-gray-700" />

                      <div>
                        <h4 className="text-sm font-medium text-white mb-3">Notification Events</h4>
                        <div className="space-y-3">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={telegramConfig.notifyOpened}
                              onChange={(e) => setTelegramConfig({ ...telegramConfig, notifyOpened: e.target.checked })}
                              className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                            />
                            <span className="text-gray-300">Position opened</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={telegramConfig.notifyStopRaised}
                              onChange={(e) => setTelegramConfig({ ...telegramConfig, notifyStopRaised: e.target.checked })}
                              className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                            />
                            <span className="text-gray-300">Stop raised (trailing stop update)</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={telegramConfig.notifyClosed}
                              onChange={(e) => setTelegramConfig({ ...telegramConfig, notifyClosed: e.target.checked })}
                              className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                            />
                            <span className="text-gray-300">Position closed</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      if (!token || !telegramConfig) return;
                      setSaving(true);
                      try {
                        await api.updateTelegramConfig(token, {
                          enabled: telegramConfig.enabled,
                          botToken: telegramBotToken || undefined,
                          chatId: telegramChatId || undefined,
                          notifyOpened: telegramConfig.notifyOpened,
                          notifyStopRaised: telegramConfig.notifyStopRaised,
                          notifyClosed: telegramConfig.notifyClosed,
                        });
                        await fetchSettings();
                        setTelegramBotToken('');
                        setSuccess('Telegram settings saved successfully');
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to save Telegram settings');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg"
                  >
                    {saving ? 'Saving...' : 'Save Notification Settings'}
                  </button>
                </div>
              )}
            </div>

            {/* Cron Job Logs */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-medium text-white mb-4">
                Trailing Stop Reassessment Logs
              </h3>

              {cronLogsLoading ? (
                <div className="flex items-center gap-3 text-gray-400 py-8 justify-center">
                  <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                  Loading logs...
                </div>
              ) : cronLogs.length === 0 ? (
                <div className="text-gray-400 text-center py-8">
                  No reassessment logs yet. Logs are created daily at 5 PM ET.
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {cronLogs.map((log) => (
                    <div
                      key={log.id}
                      className="bg-gray-700/50 rounded-lg border border-gray-600/50 overflow-hidden"
                    >
                      {/* Header - always visible */}
                      <button
                        onClick={() => toggleLogExpanded(log.id)}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/70 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-lg ${getStatusColor(log.status)}`}>
                            {getStatusIcon(log.status)}
                          </span>
                          <div className="text-left">
                            <div className="text-white font-medium">
                              {formatLogTime(log.startedAt)}
                            </div>
                            <div className="text-gray-400 text-sm">
                              {log.positionsChecked} positions • {log.stopsRaised} raised • {log.failures} failures
                            </div>
                          </div>
                        </div>
                        <span className="text-gray-400">
                          {expandedLogs.has(log.id) ? '▼' : '▶'}
                        </span>
                      </button>

                      {/* Details - expandable */}
                      {expandedLogs.has(log.id) && (
                        <div className="px-4 pb-3 border-t border-gray-600/50">
                          {log.errorMessage && (
                            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                              {log.errorMessage}
                            </div>
                          )}

                          {log.details.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {log.details.map((detail, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between text-sm py-1"
                                >
                                  <span className="text-white font-medium">{detail.symbol}</span>
                                  {detail.action === 'raised' ? (
                                    <span className="text-green-400">
                                      ${detail.oldStopPrice?.toFixed(2)} → ${detail.newStopPrice?.toFixed(2)}
                                    </span>
                                  ) : detail.action === 'failed' ? (
                                    <span className="text-red-400">{detail.error || 'Failed'}</span>
                                  ) : (
                                    <span className="text-gray-500">unchanged</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-3 text-gray-500 text-sm">
                              No positions to reassess
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
