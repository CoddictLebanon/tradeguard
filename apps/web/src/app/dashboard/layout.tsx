'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/lib/store';
import { api } from '@/lib/api';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/dashboard/opportunities', label: 'Opportunities', icon: '🎯' },
  { href: '/dashboard/positions', label: 'Positions', icon: '📈' },
  { href: '/dashboard/pnl', label: 'P&L', icon: '💰' },
  { href: '/dashboard/watchlist', label: 'Watchlist', icon: '👁' },
  { href: '/dashboard/activity', label: 'Activity', icon: '📋' },
  { href: '/dashboard/docs', label: 'Docs', icon: '📖' },
];

const bottomNavItems = [
  { href: '/dashboard/settings', label: 'Settings', icon: '⚙️' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, logout, isAuthenticated } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [simulationMode, setSimulationMode] = useState<{ enabled: boolean; date: string | null } | null>(null);
  const [ibStatus, setIbStatus] = useState<{ connected: boolean; error: string | null; checked: boolean }>({ connected: false, error: null, checked: false });
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isAuthenticated()) {
      router.push('/login');
    }
  }, [mounted, isAuthenticated, router]);

  useEffect(() => {
    if (mounted && token) {
      api.getSimulationConfig(token).then(setSimulationMode).catch(() => {});
    }
  }, [mounted, token]);

  // Check IB connection status on mount and periodically
  useEffect(() => {
    if (!mounted) return;

    const checkIBStatus = () => {
      api.getIBStatus()
        .then((status) => {
          setIbStatus({ connected: status.connected, error: null, checked: true });
        })
        .catch((err) => {
          setIbStatus({ connected: false, error: err.message || 'Failed to check IB status', checked: true });
        });
    };

    // Check immediately
    checkIBStatus();

    // Poll every 10 seconds
    const interval = setInterval(checkIBStatus, 10000);
    return () => clearInterval(interval);
  }, [mounted]);

  const handleReconnectIB = async () => {
    setReconnecting(true);
    try {
      const result = await api.reconnectIB();
      if (result.success) {
        setIbStatus({ connected: true, error: null, checked: true });
      } else {
        setIbStatus({ connected: false, error: result.error || 'Connection failed', checked: true });
      }
    } catch (err) {
      setIbStatus({ connected: false, error: (err as Error).message || 'Connection failed', checked: true });
    } finally {
      setReconnecting(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  // Show loading state until mounted to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated()) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-900 flex">
      {/* Sidebar */}
      <nav className={`${collapsed ? 'w-16' : 'w-56'} bg-gray-800 min-h-screen border-r border-gray-700 flex flex-col transition-all duration-200 flex-shrink-0`}>
        {/* Logo */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-gray-700">
          {!collapsed && <h1 className="text-lg font-bold text-white">TradeGuard</h1>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-400 hover:text-white p-1"
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>

        {/* Main Nav */}
        <ul className="flex-1 py-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                    isActive
                      ? 'bg-gray-700 text-white border-r-2 border-blue-500'
                      : 'text-gray-400 hover:bg-gray-700/50 hover:text-white'
                  }`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="text-lg">{item.icon}</span>
                  {!collapsed && item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Bottom Nav (Settings) */}
        <ul className="border-t border-gray-700 py-2">
          {bottomNavItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                    isActive
                      ? 'bg-gray-700 text-white border-r-2 border-blue-500'
                      : 'text-gray-400 hover:bg-gray-700/50 hover:text-white'
                  }`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="text-lg">{item.icon}</span>
                  {!collapsed && item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Main Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-6">
          {simulationMode?.enabled ? (
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs font-medium rounded">
                SIMULATION
              </span>
              <span className="text-orange-400 text-xs">
                {simulationMode.date ? new Date(simulationMode.date).toLocaleDateString() : 'No date set'}
              </span>
            </div>
          ) : (
            <span className="px-2 py-1 bg-yellow-500/20 text-yellow-500 text-xs font-medium rounded">
              PAPER
            </span>
          )}
          <div className="flex items-center gap-4">
            {/* IB Status */}
            {ibStatus.checked && (
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium cursor-pointer ${
                  ibStatus.connected
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}
                onClick={!ibStatus.connected ? handleReconnectIB : undefined}
                title={ibStatus.connected ? 'IB Gateway Connected' : 'Click to reconnect'}
              >
                <span className={`w-2 h-2 rounded-full ${ibStatus.connected ? 'bg-green-400' : 'bg-red-400'}`} />
                {reconnecting ? 'Connecting...' : ibStatus.connected ? 'IB Connected' : 'IB Disconnected'}
              </div>
            )}
            <span className="text-gray-400 text-sm">{user?.email}</span>
            <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs font-medium rounded uppercase">
              {user?.role}
            </span>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-white text-sm"
            >
              Logout
            </button>
          </div>
        </header>

        {/* IB Connection Warning */}
        {ibStatus.checked && !ibStatus.connected && (
          <div className="bg-red-500/10 border-b border-red-500/50 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-500 text-lg">⚠</span>
              <div>
                <span className="text-red-400 font-medium">IB Gateway Disconnected</span>
                {ibStatus.error && (
                  <span className="text-red-400/70 text-sm ml-2">({ibStatus.error})</span>
                )}
              </div>
            </div>
            <button
              onClick={handleReconnectIB}
              disabled={reconnecting}
              className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 disabled:bg-red-500/10 text-red-400 text-sm rounded border border-red-500/50 transition-colors"
            >
              {reconnecting ? 'Connecting...' : 'Reconnect'}
            </button>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
