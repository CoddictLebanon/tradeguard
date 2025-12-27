'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Opportunity {
  id: string;
  symbol: string;
  score: number;
  factors: Record<string, number>;
  currentPrice: number;
  aiAnalysis: string | null;
  bullCase: string | null;
  bearCase: string | null;
  aiConfidence: number | null;
  suggestedEntry: number;
  suggestedTrailPercent: number;
  status: string;
  createdAt: string;
}

export default function OpportunitiesPage() {
  const token = useAuthStore((state) => state.token);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Opportunity | null>(null);

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
    fetchOpportunities();
    const interval = setInterval(fetchOpportunities, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const handleScan = async () => {
    if (!token) return;
    setScanning(true);
    try {
      await api.triggerScan(token);
      await fetchOpportunities();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (!token) return;
    try {
      await api.approveOpportunity(token, id);
      await fetchOpportunities();
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    }
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

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (loading) {
    return <div className="text-gray-400">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Opportunities</h1>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg transition-colors"
        >
          {scanning ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Opportunities List */}
        <div className="space-y-4">
          {opportunities.length === 0 ? (
            <div className="bg-gray-800 p-8 rounded-lg text-center text-gray-400">
              No opportunities found. Try scanning your watchlist.
            </div>
          ) : (
            opportunities.map((opp) => (
              <div
                key={opp.id}
                onClick={() => setSelected(opp)}
                className={`bg-gray-800 p-4 rounded-lg cursor-pointer transition-colors ${
                  selected?.id === opp.id ? 'border-2 border-blue-500' : 'border border-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xl font-bold text-white">{opp.symbol}</span>
                    <span className="ml-2 text-gray-400">${opp.currentPrice.toFixed(2)}</span>
                  </div>
                  <div className={`text-2xl font-bold ${getScoreColor(opp.score)}`}>
                    {opp.score}
                  </div>
                </div>
                <div className="mt-2 text-sm text-gray-500">
                  Entry: ${opp.suggestedEntry.toFixed(2)} • Trail: {opp.suggestedTrailPercent}%
                </div>
              </div>
            ))
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="bg-gray-800 p-6 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">{selected.symbol}</h2>
              <div className={`text-3xl font-bold ${getScoreColor(selected.score)}`}>
                {selected.score}
              </div>
            </div>

            {selected.aiAnalysis && (
              <div className="bg-gray-700 p-4 rounded">
                <div className="text-sm text-gray-400 mb-2">AI Aanlysis</div>
                <div className="text-white">{selected.aiAnalysis}</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {selected.bullCase && (
                <div className="bg-green-500/10 border border-green-500/30 p-4 rounded">
                  <div className="text-sm text-green-500 mb-2">Bull Case</div>
                  <div className="text-gray-300 text-sm">{selected.bullCase}</div>
                </div>
              )}
              {selected.bearCase && (
                <div className="bg-red-500/10 border border-red-500/30 p-4 rounded">
                  <div className="text-sm text-red-500 mb-2">Bear Case</div>
                  <div className="text-gray-300 text-sm">{selected.bearCase}</div>
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => handleApprove(selected.id)}
                className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
              >
                Approve Trade
              </button>
              <button
                onClick={() => handleReject(selected.id)}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
