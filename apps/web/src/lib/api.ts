// Dynamically determine API base URL based on current browser host
function getApiBase(): string {
  if (typeof window !== 'undefined') {
    // In browser: use same host as the page, different port
    const host = window.location.hostname;
    return `http://${host}:3667`;
  }
  // Server-side or fallback
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3667';
}

function getIBProxyBase(): string {
  if (typeof window !== 'undefined') {
    // In browser: use same host as the page, IB proxy port
    const host = window.location.hostname;
    return `http://${host}:6680`;
  }
  return 'http://localhost:6680';
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;
  const apiBase = getApiBase();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${apiBase}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  // Handle 401 Unauthorized - clear auth and redirect to login
  if (response.status === 401) {
    // Clear stored auth (works in browser only)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Redirect to login page
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please login again.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    apiRequest<{ accessToken: string; user: { email: string; role: string } }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  updateProfile: (token: string, data: { newEmail: string; password: string }) =>
    apiRequest<{ accessToken: string; user: { id: string; email: string; name: string; role: 'admin' | 'trader' | 'viewer' } }>(
      '/auth/profile',
      { method: 'PATCH', token, body: data }
    ),

  changePassword: (token: string, data: { currentPassword: string; newPassword: string }) =>
    apiRequest<{ message: string }>('/auth/change-password', {
      method: 'POST',
      token,
      body: data,
    }),

  // Dashboard
  getDashboard: (token: string) =>
    apiRequest<{
      state: {
        mode: 'paper' | 'live';
        isPaused: boolean;
        pauseReason: string | null;
        dailyPnL: number;
        weeklyPnL: number;
        monthlyPnL: number;
        consecutiveLosses: number;
        openPositionsCount: number;
        capitalDeployed: number;
      };
      limits: {
        dailyLossLimitPercent: number;
        weeklyLossLimitPercent: number;
        monthlyLossLimitPercent: number;
        maxOpenPositions: number;
        maxCapitalDeployedPercent: number;
      };
      tradingMode: 'paper' | 'live';
      canTrade: boolean;
    }>('/safety/status', { token }),

  // Opportunities
  getOpportunities: (token: string) =>
    apiRequest<Array<{
      id: string;
      symbol: string;
      companyName: string | null;
      logoUrl: string | null;
      score: number;
      factors: Record<string, number | string | boolean>;
      currentPrice: number;
      suggestedEntry: number;
      suggestedTrailPercent: number;
      status: string;
      createdAt: string;
    }>>('/scanner/opportunities', { token }),

  approveOpportunity: (token: string, id: string) =>
    apiRequest<{
      success: boolean;
      error?: string;
      positionId?: string;
      shares?: number;
      entryPrice?: number;
    }>(`/scanner/opportunities/${id}/approve`, {
      method: 'POST',
      token,
    }),

  rejectOpportunity: (token: string, id: string) =>
    apiRequest<{ success: boolean }>(`/scanner/opportunities/${id}/reject`, {
      method: 'POST',
      token,
    }),

  getLiveQuotes: (token: string, symbols: string[]) =>
    apiRequest<Record<string, { price: number; change?: number; changePercent?: number }>>(
      '/scanner/quotes',
      {
        method: 'POST',
        token,
        body: { symbols },
      }
    ),

  calculatePositionSize: (token: string, id: string) =>
    apiRequest<{
      status: 'OK' | 'REJECT';
      symbol: string;
      entry: number;
      stop: number | null;
      stop_pct: number | null;
      risk_usd?: number;
      risk_per_share?: number;
      shares?: number;
      position_usd?: number;
      max_loss_usd?: number;
      reason?: string;
    }>(`/scanner/opportunities/${id}/calculate`, {
      method: 'POST',
      token,
    }),

  triggerScan: (token: string, symbols?: string[], asOfDate?: string) =>
    apiRequest<{
      opportunities: unknown[];
      skipped: boolean;
      scannedCount?: number;
      message?: string;
    }>('/scanner/scan', {
      method: 'POST',
      token,
      body: { symbols, asOfDate },
    }),

  dedupOpportunities: (token: string) =>
    apiRequest<{ removed: number }>('/scanner/opportunities/dedup', {
      method: 'POST',
      token,
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
    apiRequest<{
      success: boolean;
      error?: string;
      pnl?: number;
      pnlPercent?: number;
    }>(`/positions/${id}/close`, {
      method: 'POST',
      token,
    }),

  getPositionActivity: (token: string, id: string) =>
    apiRequest<Array<{
      id: string;
      type: string;
      message: string;
      details: Record<string, unknown>;
      symbol: string;
      positionId: string;
      createdAt: string;
    }>>(`/positions/${id}/activity`, { token }),

  getPositionChart: (token: string, id: string) =>
    apiRequest<Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
    }>>(`/positions/${id}/chart`, { token }),

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
      method: 'POST',
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

  // Account Config (Position Sizing)
  getAccountConfig: (token: string) =>
    apiRequest<{
      account: {
        totalCapital: number;
        riskPerTradePercent: number;
        maxCapitalDeployedPercent: number;
        stopBuffer: number;
      };
      risk: {
        minStopDistancePercent: number;
        maxStopDistancePercent: number;
      };
    }>('/scanner/config', { token }),

  updateAccountConfig: (
    token: string,
    config: {
      totalCapital?: number;
      riskPerTradePercent?: number;
      stopBuffer?: number;
      maxCapitalDeployedPercent?: number;
    },
  ) =>
    apiRequest<{ success: boolean }>('/scanner/config', {
      method: 'POST',
      token,
      body: config,
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

  // Activity Feed (centralized)
  getActivityFeed: (
    token: string,
    params?: {
      startDate?: string;
      endDate?: string;
      type?: string;
      symbol?: string;
      outcome?: 'win' | 'loss';
      limit?: number;
      offset?: number;
    }
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    if (params?.type) searchParams.set('type', params.type);
    if (params?.symbol) searchParams.set('symbol', params.symbol);
    if (params?.outcome) searchParams.set('outcome', params.outcome);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return apiRequest<{
      items: Array<{
        id: string;
        timestamp: string;
        type: string;
        symbol: string | null;
        message: string;
        details: {
          entryPrice?: number;
          exitPrice?: number;
          stopPrice?: number;
          oldStopPrice?: number;
          newStopPrice?: number;
          pnl?: number;
          outcome?: 'win' | 'loss';
          shares?: number;
        };
        positionId: string | null;
      }>;
      total: number;
      hasMore: boolean;
    }>(`/activity/feed${query ? `?${query}` : ''}`, { token });
  },

  // Simulation
  getSimulationConfig: (token: string) =>
    apiRequest<{ enabled: boolean; date: string | null; maxDays: number }>('/safety/simulation', { token }),

  updateSimulationConfig: (token: string, config: { enabled?: boolean; date?: string; maxDays?: number }) =>
    apiRequest<{ success: boolean; config: { enabled: boolean; date: string | null; maxDays: number } }>(
      '/safety/simulation',
      { method: 'POST', token, body: config }
    ),

  runSimulation: (token: string, input: {
    symbol: string;
    entryDate: string;
    entryPrice: number;
    shares: number;
    stopPrice: number;
    trailPercent: number;
    maxDays?: number;
  }) =>
    apiRequest<{
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
    }>('/simulation/run', { method: 'POST', token, body: input }),

  getSimulationStats: (token: string) =>
    apiRequest<{
      totalTrades: number;
      winningTrades: number;
      losingTrades: number;
      winRate: number;
      totalPnL: number;
      avgPnL: number;
      avgPnLPercent: number;
      avgDaysHeld: number;
      avgRMultiple: number;
      bestTrade: { symbol: string; pnl: number; pnlPercent: number } | null;
      worstTrade: { symbol: string; pnl: number; pnlPercent: number } | null;
      totalCapitalDeployed: number;
      profitFactor: number;
    }>('/simulation/stats', { token }),

  getSimulationHistory: (token: string, limit = 50) =>
    apiRequest<Array<{
      id: string;
      symbol: string;
      entryPrice: number;
      exitPrice: number;
      shares: number;
      pnl: number;
      pnlPercent: number;
      daysHeld: number;
      entryDate: string;
      exitDate: string;
      exitReason: string;
      capitalDeployed: number;
      rMultiple: number;
      createdAt: string;
      highestPrice: number;
      initialStopPrice: number;
      events: Array<{ day: number; date: string; type: string; price: number; stopPrice: number; note?: string }>;
      dailyData: Array<{ date: string; open: number; high: number; low: number; close: number; stopPrice: number }>;
    }>>(`/simulation/history?limit=${limit}`, { token }),

  clearSimulationHistory: (token: string) =>
    apiRequest<{ cleared: number }>('/simulation/history', { method: 'DELETE', token }),

  // Interactive Brokers (via Python proxy on port 6680)
  // Helper to add timeout to IB calls (proxy may hang if IB is disconnected)
  getIBStatus: async () => {
    const ibBase = getIBProxyBase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${ibBase}/status`, { signal: controller.signal });
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  },

  reconnectIB: async () => {
    const ibBase = getIBProxyBase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${ibBase}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 4002 }),
        signal: controller.signal,
      });
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  },

  getIBAccount: async () => {
    const ibBase = getIBProxyBase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${ibBase}/account`, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to get IB account');
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  },

  getIBPositions: async () => {
    const ibBase = getIBProxyBase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${ibBase}/positions`, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to get IB positions');
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  },

  // Telegram
  getTelegramConfig: (token: string) =>
    apiRequest<{
      enabled: boolean;
      botToken: string | null;
      chatId: string | null;
      notifyOpened: boolean;
      notifyStopRaised: boolean;
      notifyClosed: boolean;
    }>('/telegram/config', { token }),

  updateTelegramConfig: (
    token: string,
    config: {
      enabled?: boolean;
      botToken?: string;
      chatId?: string;
      notifyOpened?: boolean;
      notifyStopRaised?: boolean;
      notifyClosed?: boolean;
    },
  ) =>
    apiRequest<{ success: boolean }>('/telegram/config', {
      method: 'POST',
      token,
      body: config,
    }),

  sendTelegramTest: (token: string) =>
    apiRequest<{ success: boolean; error?: string }>('/telegram/test', {
      method: 'POST',
      token,
    }),

  // Cron Logs
  getCronLogs: (token: string, jobName = 'trailing_stop_reassessment', limit = 50) =>
    apiRequest<{
      logs: Array<{
        id: string;
        jobName: string;
        status: 'running' | 'success' | 'partial' | 'failed';
        startedAt: string;
        completedAt: string | null;
        positionsChecked: number;
        stopsRaised: number;
        failures: number;
        details: Array<{
          positionId: string;
          symbol: string;
          action: 'raised' | 'unchanged' | 'failed';
          oldStopPrice?: number;
          newStopPrice?: number;
          error?: string;
        }>;
        errorMessage: string | null;
      }>;
    }>(`/cron-logs?jobName=${jobName}&limit=${limit}`, { token }),

  // Health & Reconciliation
  getHealthDetailed: async (token: string) => {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/health/detailed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch health status');
    return res.json();
  },

  triggerReconciliation: async (token: string, dryRun: boolean = false) => {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/health/reconcile?dryRun=${dryRun}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to trigger reconciliation');
    return res.json();
  },

  // Portfolio Performance
  getPortfolioPerformance: async (token: string, period: string = '1m') => {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/portfolio/performance?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch portfolio performance');
    return res.json();
  },

  takePortfolioSnapshot: async (token: string) => {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/portfolio/snapshot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to take snapshot');
    return res.json();
  },
};
