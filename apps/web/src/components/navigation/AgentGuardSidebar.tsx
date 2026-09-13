import React, { useState, useRef, useEffect, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Shield,
  Layers,
  Sliders,
  Play,
  FileText,
  ShieldCheck,
  Users,
  Bell,
  User,
  Search,
  Copy,
  Check,
  ExternalLink,
  LogOut,
  Wallet,
} from 'lucide-react';
import { ThemeToggle } from '../common/ThemeToggle';
import { NotificationDrawer } from '../common/NotificationDrawer';
import { useWeb3Wallet } from '../../hooks/useWeb3Wallet';
import { useDashboard } from '../../context/DashboardContext';
import { usePrivy } from '@privy-io/react-auth';
import { MONAD_EXPLORER_URL } from '../../config/contracts';
import { useRbac } from '../../context/RbacContext';

export const SIDEBAR_NAV_ITEMS = [
  { to: '/fleet', label: 'Fleet Command', icon: Shield },
  { to: '/studio', label: 'Guardrail Studio', icon: Sliders },
  { to: '/pools', label: 'Budget Pools', icon: Layers },
  { to: '/simulator', label: 'Risk Simulator', icon: Play },
  { to: '/audit', label: 'Audit Trail', icon: FileText },
  { to: '/compliance', label: 'Policy Invariants', icon: ShieldCheck },
  { to: '/access', label: 'Team & IAM', icon: Users },
] as const;

interface AgentGuardSidebarProps {
  onOpenNotifications?: () => void;
  onOpenCommandPalette?: () => void;
}

export const AgentGuardSidebar: React.FC<AgentGuardSidebarProps> = ({
  onOpenNotifications,
  onOpenCommandPalette,
}) => {
  const wallet = useWeb3Wallet();
  const { balanceMon, refreshRoster } = useDashboard();
  const { logout: privyLogout } = usePrivy();
  const { roleConfig, canImpersonate, isImpersonating, setIsAssumeModalOpen, exitImpersonation, can } = useRbac();

  const visibleNavItems = useMemo(() => {
    return SIDEBAR_NAV_ITEMS.filter((item) => {
      if (item.to === '/access') {
        return can('canManageAccess');
      }
      return true;
    });
  }, [can]);

  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  // Close account menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Heartbeat refresh
  useEffect(() => {
    const interval = setInterval(() => {
      refreshRoster();
    }, 4000);
    return () => clearInterval(interval);
  }, [refreshRoster]);

  const handleCopyAddress = () => {
    if (!wallet.address) return;
    navigator.clipboard.writeText(wallet.address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const truncatedAddress = wallet.address
    ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
    : 'Not Connected';

  return (
    <>
      <aside
        aria-label="AgentGuard Main Sidebar"
        className="fixed left-0 top-0 bottom-0 w-16 bg-app border-r border-card-border z-40 flex flex-col items-center py-3.5 justify-between font-sans select-none print:hidden"
      >
        {/* Top: Brand Logo Squircle */}
        <div className="flex flex-col items-center gap-4">
          <NavLink
            to="/fleet"
            title="AgentGuard Control Plane"
            className="group relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary via-purple-600 to-indigo-700 text-white font-black text-sm shadow-md shadow-primary/30 ring-1 ring-white/20 hover:scale-105 transition-all duration-200"
          >
            AG
            <span className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </NavLink>

          {/* Navigation Icons Stack */}
          <nav aria-label="Sidebar Navigation" className="flex flex-col items-center gap-1.5 mt-2">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.to}
                  className="relative flex items-center"
                  onMouseEnter={() => setHoveredItem(item.to)}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${
                        isActive
                          ? 'bg-primary text-white shadow-lg shadow-primary/30'
                          : 'text-fg-muted hover:text-fg hover:bg-card-muted'
                      }`
                    }
                  >
                    <Icon className="h-5 w-5" />
                  </NavLink>

                  {/* Floating Tooltip */}
                  {hoveredItem === item.to && (
                    <div className="absolute left-14 z-50 whitespace-nowrap rounded-lg bg-card px-3 py-1.5 text-xs font-semibold text-fg shadow-xl border border-card-border animate-fade-in-up">
                      {item.label}
                      <div className="absolute -left-1 top-1/2 -translate-y-1/2 border-4 border-transparent border-r-card" />
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Bottom Utility Cluster */}
        <div className="flex flex-col items-center gap-2 pb-1">
          {/* Global Search / Command Palette */}
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title="Search & Commands (⌘K)"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-fg-muted hover:text-fg hover:bg-card-muted transition cursor-pointer"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Activity / Notification Bell */}
          <button
            type="button"
            onClick={() => {
              setIsNotificationOpen(true);
              onOpenNotifications?.();
            }}
            title="Activity Feed & Live Risk Alerts"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl text-fg-muted hover:text-fg hover:bg-card-muted transition cursor-pointer"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
          </button>

          {/* Theme Toggle Button */}
          <ThemeToggle />

          {/* User Account / Identity Avatar Trigger */}
          <div className="relative mt-1" ref={accountMenuRef}>
            <button
              type="button"
              onClick={() => setIsAccountOpen((prev) => !prev)}
              title="Operator Identity & Authority"
              className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-purple-700 text-white shadow-xs hover:ring-2 hover:ring-primary/50 transition cursor-pointer"
            >
              <User className="h-4 w-4" />
            </button>

            {/* Floating Operator Popover */}
            {isAccountOpen && (
              <div
                role="menu"
                className="fixed left-18 bottom-3 z-50 w-64 rounded-2xl border border-card-border bg-card p-3.5 shadow-2xl animate-fade-in-up font-sans"
              >
                <div className="flex items-center space-x-2.5 border-b border-card-border pb-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-primary to-indigo-700 font-bold text-white text-base">
                    {roleConfig.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-fg truncate">{roleConfig.label}</p>
                      {isImpersonating && (
                        <span className="text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1 rounded">
                          Simulating
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-primary font-mono truncate">{roleConfig.badge}</p>
                  </div>
                </div>

                {/* RBAC Persona Section */}
                <div className="py-2 border-b border-card-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-fg-muted font-medium">RBAC Security Role</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${roleConfig.color}`}>
                      {roleConfig.badge}
                    </span>
                  </div>

                  {isImpersonating ? (
                    <button
                      type="button"
                      onClick={() => {
                        exitImpersonation();
                        setIsAccountOpen(false);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 py-1 text-[11px] font-medium transition cursor-pointer"
                    >
                      Exit Simulation (Return to Admin)
                    </button>
                  ) : canImpersonate ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsAccountOpen(false);
                        setIsAssumeModalOpen(true);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 py-1 text-[11px] font-medium transition cursor-pointer"
                    >
                      <Shield className="h-3 w-3" />
                      <span>Assume Role for Testing...</span>
                    </button>
                  ) : (
                    <p className="text-[10px] text-fg-subtle italic">
                      Assigned by enterprise governance
                    </p>
                  )}
                </div>

                <div className="space-y-1.5 py-2.5">
                  {/* Truncated Address + Copy */}
                  <div className="flex items-center justify-between rounded-lg bg-card-muted px-2.5 py-2 text-xs border border-card-border">
                    <span className="font-mono text-fg text-[11px]">{truncatedAddress}</span>
                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      className="text-fg-muted hover:text-fg transition cursor-pointer p-0.5"
                      title="Copy address"
                    >
                      {copiedAddress ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Real Monad Balance */}
                  <div className="flex items-center justify-between px-2.5 py-1.5 text-xs">
                    <span className="text-fg-muted text-[11px]">Treasury Balance</span>
                    <span className="font-mono font-bold text-fg text-[11px]">
                      {balanceMon} MON
                    </span>
                  </div>

                  {/* Monad Explorer Link */}
                  {wallet.address && (
                    <a
                      href={`${MONAD_EXPLORER_URL}/address/${wallet.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-fg-muted hover:bg-card-muted hover:text-fg transition"
                    >
                      <span className="text-[11px]">Monad Explorer</span>
                      <ExternalLink className="h-3 w-3 text-fg-subtle" />
                    </a>
                  )}
                </div>

                <div className="border-t border-card-border pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAccountOpen(false);
                      privyLogout();
                    }}
                    className="flex w-full items-center justify-center space-x-2 rounded-lg py-2 text-xs font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Disconnect Session</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Embedded notification drawer fallback */}
      {!onOpenNotifications && (
        <NotificationDrawer
          isOpen={isNotificationOpen}
          onClose={() => setIsNotificationOpen(false)}
        />
      )}
    </>
  );
};

export default AgentGuardSidebar;
