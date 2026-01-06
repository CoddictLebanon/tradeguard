'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { PositionActivityDrawer } from '@/components/PositionActivityDrawer';

interface PositionRaw {
  id: string;
  symbol: string;
  shares: number;
  entryPrice: number;
  currentPrice: number | null;
  highestPrice?: number | null;
  highWaterMark?: number | null;
  trailPercent: number;
  stopPrice?: number;
  status: string;
  openedAt: string;
}

interface Position extends Omit<PositionRaw, 'currentPrice'> {
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

interface CloseModalState {
  isOpen: boolean;
  position: Position | null;
  isClosing: boolean;
  error: string | null;
}

export default function PositionsPage() {
  const token = useAuthStore((state) => state.token);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [closeModal, setCloseModal] = useState<CloseModalState>({
    isOpen: false,
    position: null,
    isClosing: false,
    error: null,
  });

  const fetchPositions = async () => {
    if (!token) return;
    try {
      const data: PositionRaw[] = await api.getPositions(token);
      const enrichedPositions: Position[] = data.map((pos) => {
        const current = Number(pos.currentPrice) || Number(pos.entryPrice);
        const entry = Number(pos.entryPrice);
        const shares = Number(pos.shares);
        const unrealizedPnl = (current - entry) * shares;
        const unrealizedPnlPercent = entry > 0 ? ((current - entry) / entry) * 100 : 0;
        return {
          ...pos,
          currentPrice: current,
          unrealizedPnl,
          unrealizedPnlPercent,
        };
      });
      setPositions(enrichedPositions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
    // Refresh positions every 30 seconds (real data only)
    const interval = setInterval(fetchPositions, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Open confirmation modal
  const handleCloseClick = (pos: Position, e: React.MouseEvent) => {
    e.stopPropagation();
    setCloseModal({
      isOpen: true,
      position: pos,
      isClosing: false,
      error: null,
    });
  };

  // Cancel and close the modal
  const handleCancelClose = () => {
    if (closeModal.isClosing) return; // Don't allow cancel while closing
    setCloseModal({
      isOpen: false,
      position: null,
      isClosing: false,
      error: null,
    });
  };

  // Execute the actual close operation
  const handleConfirmClose = async () => {
    const pos = closeModal.position;
    if (!token || !pos) return;

    setCloseModal(prev => ({ ...prev, isClosing: true, error: null }));

    try {
      const result = await api.closePosition(token, pos.id);
      if (result.success) {
        const pnlSign = (result.pnl ?? 0) >= 0 ? '+' : '';
        setSuccessMessage(
          `${pos.symbol} closed: ${pnlSign}$${(result.pnl ?? 0).toFixed(2)} (${pnlSign}${(result.pnlPercent ?? 0).toFixed(2)}%)`
        );
        setTimeout(() => setSuccessMessage(null), 8000);
        // Close modal on success
        setCloseModal({
          isOpen: false,
          position: null,
          isClosing: false,
          error: null,
        });
        await fetchPositions();
      } else {
        // Show error in modal
        setCloseModal(prev => ({
          ...prev,
          isClosing: false,
          error: result.error || 'Failed to close position with Interactive Brokers',
        }));
      }
    } catch (err) {
      // Show error in modal
      setCloseModal(prev => ({
        ...prev,
        isClosing: false,
        error: err instanceof Error ? err.message : 'Failed to close position',
      }));
    }
  };

  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

  if (loading) {
    return <div className="text-gray-400">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>
          <span className="text-2xl font-bold text-white">Positions</span>
          <span className="ml-2 text-gray-400">({positions.length})</span>
        </h1>
        <div className={`text-xl font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          Total: {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
        </div>
      </div>

      {successMessage && (
        <div className="bg-green-500/10 border border-green-500 text-green-500 p-4 rounded">
          {successMessage}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded">
          {error}
        </div>
      )}

      {positions.length === 0 ? (
        <div className="bg-gray-800 p-8 rounded-lg text-center text-gray-400">
          No open positions. Approve an opportunity to open a position.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-400 font-medium w-24">Symbol</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-20">Shares</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-28">Capital</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-24">Entry</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-24">Current</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-24">Stop</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-20">Stop %</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-36">P/L</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const capital = pos.shares * Number(pos.entryPrice);
                const hasStop = pos.stopPrice != null && !isNaN(Number(pos.stopPrice));
                const stopPct = hasStop ? ((Number(pos.entryPrice) - Number(pos.stopPrice)) / Number(pos.entryPrice)) * 100 : null;
                return (
                  <tr
                    key={pos.id}
                    onClick={() => setSelectedPosition(pos)}
                    className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer"
                  >
                    <td className="py-4 px-4 font-medium text-white">{pos.symbol}</td>
                    <td className="py-4 px-4 text-right text-gray-300 tabular-nums">{pos.shares}</td>
                    <td className="py-4 px-4 text-right text-blue-400 font-medium tabular-nums">${capital.toLocaleString()}</td>
                    <td className="py-4 px-4 text-right text-gray-300 tabular-nums">${Number(pos.entryPrice).toFixed(2)}</td>
                    <td className="py-4 px-4 text-right text-gray-300 tabular-nums">${pos.currentPrice.toFixed(2)}</td>
                    <td className="py-4 px-4 text-right text-red-400 tabular-nums">{hasStop ? `$${Number(pos.stopPrice).toFixed(2)}` : '-'}</td>
                    <td className="py-4 px-4 text-right text-yellow-400 tabular-nums">{stopPct !== null ? `${stopPct.toFixed(2)}%` : '-'}</td>
                    <td className={`py-4 px-4 text-right font-medium tabular-nums ${pos.unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                      <span className="text-xs ml-1">({pos.unrealizedPnlPercent.toFixed(1)}%)</span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <button
                        onClick={(e) => handleCloseClick(pos, e)}
                        className="px-3 py-1 text-white text-sm rounded bg-red-600 hover:bg-red-700"
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PositionActivityDrawer
        position={selectedPosition}
        onClose={() => setSelectedPosition(null)}
      />

      {/* Close Position Confirmation Modal */}
      {closeModal.isOpen && closeModal.position && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 max-w-md w-full mx-4 shadow-2xl">
            {closeModal.isClosing ? (
              // Loading state
              <div className="text-center py-4">
                <div className="inline-flex items-center justify-center w-16 h-16 mb-4">
                  <div className="w-12 h-12 border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">
                  Closing Position...
                </h3>
                <p className="text-gray-400">
                  Waiting for Interactive Brokers confirmation
                </p>
                <p className="text-gray-500 text-sm mt-2">
                  Selling {closeModal.position.shares} shares of {closeModal.position.symbol}
                </p>
              </div>
            ) : closeModal.error ? (
              // Error state
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl">✗</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white">
                      Failed to Close Position
                    </h3>
                    <p className="text-gray-400 text-sm">
                      {closeModal.position.symbol}
                    </p>
                  </div>
                </div>
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-6">
                  <p className="text-red-400 text-sm">{closeModal.error}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleCancelClose}
                    className="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmClose}
                    className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            ) : (
              // Confirmation state
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-yellow-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl">⚠</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white">
                      Close Position?
                    </h3>
                    <p className="text-gray-400 text-sm">
                      This action cannot be undone
                    </p>
                  </div>
                </div>

                <div className="bg-gray-900/50 rounded-lg p-4 mb-6 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Symbol</span>
                    <span className="text-white font-medium">{closeModal.position.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Shares</span>
                    <span className="text-white">{closeModal.position.shares}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Entry Price</span>
                    <span className="text-white">${Number(closeModal.position.entryPrice).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Current Price</span>
                    <span className="text-white">${closeModal.position.currentPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-700 pt-2 mt-2">
                    <span className="text-gray-400">Unrealized P/L</span>
                    <span className={`font-medium ${closeModal.position.unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {closeModal.position.unrealizedPnl >= 0 ? '+' : ''}${closeModal.position.unrealizedPnl.toFixed(2)}
                      <span className="text-xs ml-1">({closeModal.position.unrealizedPnlPercent.toFixed(1)}%)</span>
                    </span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleCancelClose}
                    className="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmClose}
                    className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                  >
                    Close Position
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
