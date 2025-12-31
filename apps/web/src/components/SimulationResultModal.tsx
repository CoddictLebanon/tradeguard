'use client';

export interface SimulationResult {
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

  // Calculate additional metrics
  const deployedCapital = result.entryPrice * result.shares;
  const finalValue = result.exitPrice * result.shares;
  const maxValue = result.highestPrice * result.shares;
  const drawdownFromPeak = ((result.highestPrice - result.exitPrice) / result.highestPrice) * 100;
  const initialStopPrice = result.events[0]?.stopPrice || result.entryPrice * 0.95;
  const initialRiskPercent = ((result.entryPrice - initialStopPrice) / result.entryPrice) * 100;
  const initialRiskDollars = (result.entryPrice - initialStopPrice) * result.shares;
  const rMultiple = initialRiskDollars > 0 ? result.pnl / initialRiskDollars : 0;
  const unrealizedFromPeak = maxValue - finalValue;

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
            {/* Main P&L display */}
            <div className="text-center mb-4">
              <div className={`text-3xl font-bold font-mono ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                {isProfitable ? '+' : ''}${result.pnl.toFixed(2)}
              </div>
              <div className={`text-lg ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                {isProfitable ? '+' : ''}{result.pnlPercent.toFixed(2)}% return
              </div>
            </div>

            {/* Trade details grid */}
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-gray-400 text-xs">Entry</div>
                <div className="text-white font-mono">${result.entryPrice.toFixed(2)}</div>
                <div className="text-gray-500 text-xs">{result.entryDate}</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-gray-400 text-xs">Exit</div>
                <div className="text-white font-mono">${result.exitPrice.toFixed(2)}</div>
                <div className="text-gray-500 text-xs">{result.exitDate}</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-gray-400 text-xs">Days Held</div>
                <div className="text-white font-mono">{result.daysHeld}</div>
                <div className="text-gray-500 text-xs">{result.exitReason.replace('_', ' ')}</div>
              </div>
            </div>

            {/* Capital & Value row */}
            <div className="grid grid-cols-3 gap-3 text-center text-sm mt-3">
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-gray-400 text-xs">Capital Deployed</div>
                <div className="text-white font-mono">${deployedCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="text-gray-500 text-xs">{result.shares} shares</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-gray-400 text-xs">Final Value</div>
                <div className="text-white font-mono">${finalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-gray-400 text-xs">Peak Value</div>
                <div className="text-white font-mono">${maxValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="text-gray-500 text-xs">@ ${result.highestPrice.toFixed(2)}</div>
              </div>
            </div>

            {/* Risk metrics row */}
            <div className="grid grid-cols-3 gap-3 text-center text-sm mt-3">
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-gray-400 text-xs">Initial Risk</div>
                <div className="text-yellow-400 font-mono">${initialRiskDollars.toFixed(2)}</div>
                <div className="text-gray-500 text-xs">{initialRiskPercent.toFixed(1)}% of entry</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-gray-400 text-xs">R-Multiple</div>
                <div className={`font-mono font-bold ${rMultiple >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {rMultiple >= 0 ? '+' : ''}{rMultiple.toFixed(2)}R
                </div>
                <div className="text-gray-500 text-xs">profit / risk</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-gray-400 text-xs">Drawdown from Peak</div>
                <div className="text-orange-400 font-mono">-{drawdownFromPeak.toFixed(2)}%</div>
                <div className="text-gray-500 text-xs">-${unrealizedFromPeak.toFixed(2)}</div>
              </div>
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
            {(() => {
              if (!result.dailyData || result.dailyData.length === 0) {
                return <div className="h-48 flex items-center justify-center text-gray-500">No chart data available</div>;
              }
              const minPrice = Math.min(...result.dailyData.map(d => d.low), ...result.dailyData.map(d => d.stopPrice));
              const maxPrice = Math.max(...result.dailyData.map(d => d.high));
              const padding = (maxPrice - minPrice) * 0.05;
              const chartMin = minPrice - padding;
              const chartMax = maxPrice + padding;
              const range = chartMax - chartMin || 1;

              return (
                <svg className="w-full h-48" viewBox={`0 0 ${result.dailyData.length * 10} 100`} preserveAspectRatio="none">
                  {/* Price bars */}
                  {result.dailyData.map((day, idx) => {
                    const x = idx * 10 + 2;
                    const highY = 100 - ((day.high - chartMin) / range) * 100;
                    const lowY = 100 - ((day.low - chartMin) / range) * 100;
                    const openY = 100 - ((day.open - chartMin) / range) * 100;
                    const closeY = 100 - ((day.close - chartMin) / range) * 100;
                    const isUp = day.close >= day.open;
                    const color = isUp ? '#22c55e' : '#ef4444';

                    return (
                      <g key={idx}>
                        {/* High-low wick */}
                        <line x1={x + 3} y1={highY} x2={x + 3} y2={lowY} stroke={color} strokeWidth="1" />
                        {/* Open-close body */}
                        <rect
                          x={x}
                          y={Math.min(openY, closeY)}
                          width="6"
                          height={Math.max(Math.abs(closeY - openY), 1)}
                          fill={color}
                        />
                      </g>
                    );
                  })}
                  {/* Stop loss line */}
                  <polyline
                    fill="none"
                    stroke="#f87171"
                    strokeWidth="1.5"
                    strokeDasharray="4,2"
                    points={result.dailyData.map((day, idx) => {
                      const x = idx * 10 + 5;
                      const y = 100 - ((day.stopPrice - chartMin) / range) * 100;
                      return `${x},${y}`;
                    }).join(' ')}
                  />
                </svg>
              );
            })()}
            {result.dailyData && result.dailyData.length > 0 && (
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>{result.dailyData[0]?.date}</span>
                <span className="text-red-400">— Stop line</span>
                <span>{result.dailyData[result.dailyData.length - 1]?.date}</span>
              </div>
            )}
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
