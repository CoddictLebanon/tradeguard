const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  return response.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    apiRequest<{ access_token: string; user: { email: string; role: string } }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  // Dashboard
  getDashboard: (token: string) =>
    apiRequest<{
      tradingState: {
        mode: 'paper' | 'live';
        isPaused: boolean;
        pauseReason: string | null;
        dailyPnL: number;
        weeklyPnL: number;
        consecutiveLosses: number;
        openPositionsCount: number;
      };
      limits: {
        dailyLossLimit: number;
        weeklyLossLimit: number;
        maxPositionSize: number;
        maxOpenPositions: number;
      };
      ibConnected: boolean;
    }>('/safety/state', { token }),

  // Opportunities
  getOpportunities: (token: string) =>
    apiRequest<Array<{
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
    }>>('/scanner/opportunities', { token }),

  approveOpportunity: (token: string, id: string) =>
    apiRequest<{ success: boolean }>(`/scanner/opportunities/${id}/approve`, {
      method: 'POST',
      token,
    }),

  rejectOpportunity: (token: string, id: string) =>
    apiRequest<{ success: boolean }>(`/scanner/opportunities/${id}/reject`, {
      method: 'POST',
      token,
    }),

  triggerScan: (token: string, symbols?: string[]) =>
    apiRequest<{ opportunities: unknown[] }>('/scanner/scan', {
      method: 'POST',
      token,
      body: symbols ? { symbols } : undefined,
    }),

  // Positions
  getPositions: (token: string) =>
    apiRequest<Array<{
      id: string;
      symbol: string;
      shares: number;
      entryPrice: number;
      currentPrice: number;
      unrealizedPnl: number;
      unrealizedPnlPercent: number;
      trailPercent: number;
      highWaterMark: number;
      status: string;
      openedAt: string;
    }>>('/positions', { token }),

  closePosition: (token: string, id: string) =>
    apiRequest<{ success: boolean }>(`/positions/${id}/close`, {
      method: 'POST',
      token,
    }),

  updateTrailPercent: (token: string, id: string, trailPercent: number) =>
    apiRequest<{ success: boolean }>(`/positions/${id}/trail`, {
      method: 'PUT',
      token,
      body: { trailPercent },
    }),

  // Watchlist
  getWatchlist: (token: string) =>
    apiRequest<Array<{
      id: string;
      symbol: string;
      active: boolean;
      notes: string | null;
    }>>('/watchlist', { token }),

  addToWatchlist: (token: string, symbol: string, notes?: string) =>
    apiRequest<{ id: string }>('/watchlist', {
      method: 'POST',
      token,
      body: { symbol, notes },
    }),

  removeFromWatchlist: (token: string, id: string) =>
    apiRequest<{ success: boolean }>(`/watchlist/${id}`, {
      method: 'DELETE',
      token,
    }),

  // Safety Controls
  pauseTrading: (token: string, reason: string) =>
    apiRequest<{ success: boolean }>('/safety/pause', {
      method: 'POST',
      token,
      body: { reason },
    }),

  resumeTrading: (token: string) =>
    apiRequest<{ success: boolean }>('/safety/resume', {
      method: 'POST',
      token,
    }),

  updateLimits: (token: string, limits: {
    dailyLossLimit?: number;
    weeklyLossLimit?: number;
    maxPositionSize?: number;
    maxOpenPositions?: number;
    maxConsecutiveLosses?: number;
  }) =>
    apiRequest<{ success: boolean }>('/safety/limits', {
      method: 'PUT',
      token,
      body: limits,
    }),

  switchToLive: (token: string) =>
    apiRequest<{ success: boolean; reason?: string }>('/safety/switch-to-live', {
      method: 'POST',
      token,
    }),

  switchToPaper: (token: string) =>
    apiRequest<{ success: boolean }>('/safety/switch-to-paper', {
      method: 'POST',
      token,
    }),

  // Activity Log
  getActivityLog: (token: string, limit = 50) =>
    apiRequest<Array<{
      id: string;
      type: string;
      message: string;
      details: Record<string, unknown>;
      createdAt: string;
    }>>(`/activity?limit=${limit}`, { token }),
};
