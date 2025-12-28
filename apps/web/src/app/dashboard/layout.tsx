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

        {/* Main Content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
