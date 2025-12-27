'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface SafetyLimits {
  dailyLossLimit: number;
  weeklyLossLimit: number;
  maxPositionSize: number;
  maxOpenPositions: number;
  maxConsecutiveLosses: number;
}

interface TradingState {
  mode: 'paper' | 'live';
  isPaused: boolean;
  pauseReason: string | null;
}

export default function SettingsPage() {
  const token = useAuthStore((state) => state.token);
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const [limits, setLimits] = useState<SafetyLimits | null>(null);
  const [state, setState] = useState<TradingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pauseReason, setPauseReason] = useState('');

  const fetchSettings = async () => {
    if (!token) return;
    try {
      const data = await api.getDashboard(token);
      setLimits(data.limits as unknown as SafetyLimits);
      setState(data.tradingState);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [token]);

  const handleSaveLimits = async () => {
    if (!token || !limits) return;
    setSaving(true);
    try {
      await api.updateLimits(token, limits);
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save limits');
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
    if (!token || !state) return;
    try {
      if (state.mode === 'paper') {
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
            state?.mode === 'paper' ? 'text-yellow-500' : 'text-green-500'
          }`}>
            {state?.mode}
          </span>
          <button
            onClick={handleSwitchMode}
            className={`px-4 py-2 rounded-lg ${
              state?.mode === 'paper'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-yellow-600 hover:bg-yellow-700'
            } text-white`}
          >
            {state?.mode === 'paper' ? 'Switch to Live' : 'Switch to Paper'}
          </button>
        </div>
        {state?.mode === 'paper' && (
          <p className="text-gray-400 text-sm">
            Must complete minimum paper trading period with positive P/L to switch to live.
          </p>
        )}
      </section>

      {/* Trading Controls */}
      <section className="bg-gray-800 p-6 rounded-lg space-y-4">
        <h2 className="text-lg font-semibold text-white">Trading Controls</h2>
        {state?.isPaused ? (
          <div className="space-y-4">
            <div className="bg-red-500/20 border border-red-500 p-4 rounded">
              <span className="text-red-500 font-bold">Trading is paused:</span>
              <span className="text-red-400 ml-2">{state.pauseReason}</span>
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
                value={limits.dailyLossLimit}
                onChange={(e) => setLimits({ ...limits, dailyLossLimit: Number(e.target.value) })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400">Weekly Loss Limit (%)</label>
              <input
                type="number"
                value={limits.weeklyLossLimit}
                onChange={(e) => setLimits({ ...limits, weeklyLossLimit: Number(e.target.value) })}
                className="mt-1 w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400">Max Position Size (%)</label>
              <input
                type="number"
                value={limits.maxPositionSize}
                onChange={(e) => setLimits({ ...limits, maxPositionSize: Number(e.target.value) })}
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
    </div>
  );
}
