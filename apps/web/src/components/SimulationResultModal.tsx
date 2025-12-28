'use client';

interface SimulationResult {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitReason: string;
  shares: number;
  daysHeld: number;
  pnl: number;
  pnlPercent: number;
  highestPrice: number;
  events: Array<{ day: number; date: string; type: string; price: number; stopPrice: number; note?: string }>;
  dailyData: Array<{ date: string; open: number; high: number; low: number; close: number; stopPrice: number }>;
}

interface Props {
  result: SimulationResult;
  onClose: () => void;
}

export default function SimulationResultModal({ result, onClose }: Props) {
  const isProfitable = result.pnl >= 0;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Simulation Result: {result.symbol}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* Summary Card */}
          <div className={`p-4 rounded-lg ${isProfitable ? 'bg-green-500/20 border border-green-500' : 'bg-red-500/20 border border-red-500'}`}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-gray-400 text-xs">Entry</div>
                <div className="text-white font-mono">${result.entryPrice.toFixed(2)}</div>
                <div className="text-gray-500 text-xs">{result.entryDate}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">Exit</div>
                <div className="text-white font-mono">${result.exitPrice.toFixed(2)}</div>
                <div className="text-gray-500 text-xs">{result.exitDate}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">Days Held</div>
                <div className="text-white font-mono">{result.daysHeld}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">P&L</div>
                <div className={`font-mono font-bold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                  {isProfitable ? '+' : ''}${result.pnl.toFixed(2)}
                </div>
                <div className={`text-sm ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                  {isProfitable ? '+' : ''}{result.pnlPercent.toFixed(2)}%
                </div>
              </div>
            </div>
            <div className="mt-3 text-center text-sm text-gray-400">
              Exit reason: <span className="text-white">{result.exitReason.replace('_', ' ')}</span>
              {' | '}Shares: <span className="text-white">{result.shares}</span>
              {' | '}Highest: <span className="text-white">${result.highestPrice.toFixed(2)}</span>
            </div>
          </div>

          {/* Event Log */}
          <div className="bg-gray-700/50 rounded-lg p-3">
            <h3 className="text-sm font-semibold text-white mb-2">Event Log</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-xs">
              {result.events.map((event, idx) => (
                <div key={idx} className="flex gap-2 text-gray-300">
                  <span className="text-gray-500 w-12">Day {event.day}</span>
                  <span className={`w-20 ${
                    event.type === 'ENTRY' ? 'text-blue-400' :
                    event.type === 'STOP_RAISED' ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>{event.type}</span>
                  <span className="flex-1">{event.note}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Simple Price Chart */}
          <div className="bg-gray-700/50 rounded-lg p-3">
            <h3 className="text-sm font-semibold text-white mb-2">Price Chart</h3>
            <div className="h-48 flex items-end gap-px">
              {result.dailyData.map((day, idx) => {
                const minPrice = Math.min(...result.dailyData.map(d => d.low));
                const maxPrice = Math.max(...result.dailyData.map(d => d.high));
                const range = maxPrice - minPrice || 1;
                const height = ((day.close - minPrice) / range) * 100;
                const stopHeight = ((day.stopPrice - minPrice) / range) * 100;
                const isUp = day.close >= day.open;

                return (
                  <div key={idx} className="flex-1 relative" title={`${day.date}: $${day.close.toFixed(2)}`}>
                    <div
                      className={`w-full ${isUp ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                    <div
                      className="absolute w-full border-t border-red-400"
                      style={{ bottom: `${stopHeight}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>{result.dailyData[0]?.date}</span>
              <span className="text-red-400">-- Stop line</span>
              <span>{result.dailyData[result.dailyData.length - 1]?.date}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
