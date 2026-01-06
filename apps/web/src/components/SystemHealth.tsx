'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'critical';
  responseTime?: number;
  message?: string;
  details?: Record<string, unknown>;
}

interface SystemHealthData {
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: string;
  components: {
    ibGateway: ComponentHealth;
    ibProxy: ComponentHealth;
    database: ComponentHealth;
    positionSync: ComponentHealth;
    cronJobs: ComponentHealth;
  };
  lastReconciliation: string | null;
}

interface ReconciliationResult {
  synced: string[];
  closed: string[];
  updated: string[];
  errors: string[];
  dryRun: boolean;
}

const statusColors: Record<string, string> = {
  healthy: 'text-green-500',
  degraded: 'text-yellow-500',
  critical: 'text-red-500',
};

const statusDots: Record<string, string> = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  critical: 'bg-red-500',
};

const componentLabels: Record<string, string> = {
  ibGateway: 'IB Gateway',
  ibProxy: 'IB Proxy',
  database: 'Database',
  positionSync: 'Position Sync',
  cronJobs: 'Trailing Stops',
};

export function SystemHealth() {
  const token = useAuthStore((state) => state.token);
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [timeSinceCheck, setTimeSinceCheck] = useState<number | null>(null);

  const fetchHealth = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.getHealthDetailed(token);
      setHealth(data);
      setLastCheck(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // Update time since check every second
  useEffect(() => {
    const updateTimeSince = () => {
      if (lastCheck) {
        setTimeSinceCheck(Math.round((Date.now() - lastCheck.getTime()) / 1000));
      }
    };
    updateTimeSince();
    const interval = setInterval(updateTimeSince, 1000);
    return () => clearInterval(interval);
  }, [lastCheck]);

  const handleReconcile = async () => {
    if (!token || reconciling) return;
    setReconciling(true);
    try {
      const result: ReconciliationResult = await api.triggerReconciliation(token, false);
      if (result.synced.length > 0 || result.closed.length > 0 || result.updated.length > 0) {
        alert(`Reconciliation complete!\nSynced: ${result.synced.join(', ') || 'none'}\nClosed: ${result.closed.join(', ') || 'none'}\nUpdated: ${result.updated.join(', ') || 'none'}`);
      } else if (result.errors.length > 0) {
        alert(`Reconciliation had errors:\n${result.errors.join('\n')}`);
      } else {
        alert('All positions already in sync.');
      }
      await fetchHealth();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
        <div className="flex items-center gap-2 text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
          Loading health status...
        </div>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-red-500/50">
        <div className="text-red-400">Failed to load health status: {error}</div>
      </div>
    );
  }

  const formatResponseTime = (component: ComponentHealth): string => {
    if (component.responseTime !== undefined) {
      return `${component.responseTime}ms`;
    }
    // For positionSync, show count from details
    if (component.details?.ibCount !== undefined && component.details?.dbCount !== undefined) {
      return `${component.details.dbCount}/${component.details.ibCount}`;
    }
    // For cronJobs, show time since last run
    if (component.details?.lastRun) {
      const lastRun = new Date(component.details.lastRun as string);
      const minAgo = Math.round((Date.now() - lastRun.getTime()) / 60000);
      return `${minAgo} min ago`;
    }
    return '';
  };

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700/50 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
        <h3 className="text-white font-medium flex items-center gap-2">
          System Health
        </h3>
        <div className={`w-3 h-3 rounded-full ${statusDots[health.status]}`} />
      </div>

      <div className="divide-y divide-gray-700/50">
        {Object.entries(health.components).map(([key, component]) => (
          <div key={key} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${statusDots[component.status]}`} />
              <span className="text-gray-300">{componentLabels[key] || key}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-sm ${statusColors[component.status]}`}>
                {component.message || component.status}
              </span>
              <span className="text-gray-500 text-xs min-w-[60px] text-right">
                {formatResponseTime(component)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-3 bg-gray-900/50">
        <span className="text-gray-500 text-sm">
          {timeSinceCheck !== null ? `Last check: ${timeSinceCheck}s ago` : 'Checking...'}
        </span>
        <button
          onClick={handleReconcile}
          disabled={reconciling}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {reconciling ? 'Reconciling...' : 'Reconcile Now'}
        </button>
      </div>
    </div>
  );
}
