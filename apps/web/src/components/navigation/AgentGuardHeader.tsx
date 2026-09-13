import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useWeb3Wallet } from '../../hooks/useWeb3Wallet';
import { useDashboard } from '../../context/DashboardContext';
import { usePrivy } from '@privy-io/react-auth';
import {
  Bell,
  LogOut,
  ChevronDown,
  Copy,
  Check,
  ShieldCheck,
  Wallet,
  ExternalLink,
  Shield,
  Layers,
  Sliders,
  Play,
  FileText,
  Search,
  Activity,
  User,
  Plus,
  LayoutGrid,
  Users,
  Bot,
  Building2,
  MessageSquare,
} from 'lucide-react';
import { ThemeToggle } from '../common/ThemeToggle';
import { NotificationDrawer } from '../common/NotificationDrawer';
import { CommandPalette } from '../common/CommandPalette';
import { MONAD_EXPLORER_URL } from '../../config/contracts';
import { useRbac } from '../../context/RbacContext';

export const NAV_SECTIONS = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid },
  { to: '/fleet', label: 'Fleet Command', icon: Shield },
  { to: '/finance', label: 'Treasury & Finance', icon: Layers },
  { to: '/studio', label: 'Guardrail Studio', icon: Sliders },
  { to: '/simulator', label: 'Risk Simulator', icon: Play },
  { to: '/playground', label: 'Agent in Action', icon: Bot },
  { to: '/audit', label: 'Audit Trail', icon: FileText },
  { to: '/compliance', label: 'Policy Invariants', icon: ShieldCheck },
  { to: '/access', label: 'Team & IAM', icon: Users },
] as const;

export const AgentGuardHeader: React.FC = () => {
  const wallet = useWeb3Wallet();
  const location = useLocation();
  const { refreshRoster, balanceMon, openOnboarding } = useDashboard();
  const { logout: privyLogout, user } = usePrivy();
  const { roleConfig, can, isImpersonating, exitImpersonation, setIsAssumeModalOpen } = useRbac();

  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const accountMenuRef = useRef<HTMLDivElement>(null);

  // Dynamic RBAC filtering for header navigation tabs
  const visibleNavSections = React.useMemo(() => {
    return NAV_SECTIONS.filter((section) => {
      switch (section.to) {
        case '/access':
          return can('canManageAccess');
        case '/simulator':
          return can('canRunSimulations');
        case '/finance':
          return can('canManageBudgetPools') || roleConfig.id === 'auditor';
        case '/studio':
          return can('canEditPolicy') || roleConfig.id === 'auditor';
        default:
          return true;
      }
    });
  }, [can, roleConfig.id]);

  const currentSection =
    visibleNavSections.find((s) =>
      s.to === '/'
        ? location.pathname === '/' || location.pathname === '/dashboard'
        : location.pathname.startsWith(s.to)
    ) || visibleNavSections[0] || NAV_SECTIONS[0];

  // Global Cmd+K Keyboard Shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close account dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    <header className="fixed top-0 left-0 lg:left-16 right-0 h-16 z-30 bg-card/95 border-b border-card-border backdrop-blur-xl font-sans select-none transition-all">
      <div className="flex h-16 w-full items-center justify-between px-4 sm:px-6">
        {/* Left: Brand Identity, Active Role Badge & Section Tabs */}
        <div className="flex items-center space-x-4 min-w-0">
          <div className="flex items-center space-x-2.5 shrink-0">
            <NavLink
              to="/"
              className="text-xs font-black tracking-tight text-white hover:text-primary transition-colors flex items-center gap-2"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-primary via-purple-600 to-indigo-700 text-white font-black text-[10px] shadow-xs">
                AG
              </div>
              <span className="hidden sm:inline">AgentGuard</span>
            </NavLink>

            <span className="text-zinc-700 hidden sm:inline">/</span>

            {/* Enterprise Organization Identity Badge (B2B SaaS Single-Tenant) */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-300 text-xs font-semibold shadow-xs">
              <Building2 className="h-3.5 w-3.5 text-purple-400" />
              <span>Acme AI Systems</span>
              <span className="text-[9px] font-mono uppercase tracking-wider bg-purple-500/20 text-purple-200 px-1.5 py-0.2 rounded border border-purple-500/30">
                Enterprise Tier
              </span>
            </div>

            <span className="text-zinc-700 hidden md:inline">/</span>

            {/* Active Role Badge & Switcher Button */}
            <button
              type="button"
              onClick={() => setIsAssumeModalOpen(true)}
              title="Click to test role permissions or switch active identity"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer transition ${roleConfig.color} hover:opacity-90 shadow-xs`}
            >
              <span>{roleConfig.icon}</span>
              <span className="font-medium">{roleConfig.label}</span>
              {isImpersonating && (
                <span className="text-[9px] bg-amber-500/20 text-amber-400 font-bold px-1.5 py-0.2 rounded border border-amber-500/30">
                  TESTING
                </span>
              )}
            </button>

            {isImpersonating && (
              <button
                type="button"
                onClick={exitImpersonation}
                title="Exit role testing and revert to authenticated identity"
                className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 underline cursor-pointer ml-0.5"
              >
                Reset
              </button>
            )}
          </div>

          {/* Sub-Navigation Horizontal Tabs - Dynamic RBAC */}
          <nav aria-label="Dashboard sub-navigation" className="hidden 2xl:flex items-center space-x-1 border-l border-zinc-800/80 pl-4">
            {visibleNavSections.map((section) => (
              <NavLink
                key={section.to}
                to={section.to}
                end={section.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'text-primary bg-primary/10 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]'
                  }`
                }
              >
                {section.label}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Right Actions: Register CTA, Treasury, Search, Live Sync, Notifications, Profile */}
        <div className="flex items-center space-x-2.5 shrink-0">
          {/* Primary Action Button (Get Started / Register Agent) - Dynamic RBAC */}
          {can('canRegisterAgents') && (
            <button
              type="button"
              onClick={openOnboarding}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white px-4 py-2 text-xs font-semibold shadow-sm shadow-primary/25 transition whitespace-nowrap cursor-pointer"
            >
              <span>Get Started</span>
            </button>
          )}

          {/* Real Treasury Monad Balance Pill */}
          <div className="hidden xl:flex items-center gap-1.5 rounded-lg border border-card-border bg-card-muted px-2.5 py-1 text-xs font-mono whitespace-nowrap">
            <span className="text-[10px] text-fg-subtle uppercase">Pool:</span>
            <span className="font-semibold text-fg whitespace-nowrap">{balanceMon} MON</span>
          </div>

          {/* Search Icon Trigger */}
          <button
            type="button"
            onClick={() => setIsCommandPaletteOpen(true)}
            title="Search (⌘K)"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:text-fg hover:bg-card-muted transition-colors"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Messages / Notifications Activity Trigger */}
          <button
            type="button"
            onClick={() => setIsNotificationOpen(true)}
            title="Activity Feed"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:text-fg hover:bg-card-muted transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
          </button>

          {/* Command Palette Trigger */}
          <button
            type="button"
            title="Command Modules"
            onClick={() => setIsCommandPaletteOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:text-fg hover:bg-card-muted transition-colors"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>

          {/* Bell Notifications */}
          <button
            type="button"
            onClick={() => setIsNotificationOpen(true)}
            aria-label="View activity logs and notifications"
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:text-fg hover:bg-card-muted transition-colors"
          >
            <Bell className="h-4 w-4" />
          </button>

          {/* Account Popover (Circular Avatar Trigger) */}
          <div className="relative shrink-0" ref={accountMenuRef}>
            <button
              type="button"
              onClick={() => setIsAccountOpen(!isAccountOpen)}
              aria-label="Operator Profile Menu"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary via-purple-600 to-indigo-700 text-white shadow-xs ring-2 ring-card-border hover:ring-primary transition-all cursor-pointer shrink-0 overflow-hidden"
            >
              <User className="h-4 w-4" />
            </button>

            {isAccountOpen && (
              <div className="absolute right-0 mt-2 w-72 origin-top-right rounded-2xl border border-card-border bg-card p-3 shadow-2xl backdrop-blur-xl font-sans animate-fade-in-up z-50">
                <div className="border-b border-card-border pb-3 mb-2 px-1">
                  <div className="text-[11px] font-medium text-fg-muted">
                    Operator Identity
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-xs font-bold text-fg">
                      {truncatedAddress}
                    </span>
                    {wallet.address && (
                      <button
                        type="button"
                        onClick={handleCopyAddress}
                        className="text-fg-muted hover:text-fg transition-colors"
                        title="Copy Address"
                      >
                        {copiedAddress ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Account Details & Balances */}
                <div className="space-y-2 py-1">
                  <div className="flex items-center justify-between px-2 py-1.5 rounded-xl bg-card-muted text-xs">
                    <span className="text-fg-muted">Personal Balance:</span>
                    <span className="font-mono font-bold text-fg">
                      {wallet.balanceMon} MON
                    </span>
                  </div>

                  {wallet.isLocalDevnet && (
                    <button
                      type="button"
                      onClick={async () => {
                        await wallet.fundDevnetWallet();
                        refreshRoster();
                      }}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 rounded-xl text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                    >
                      <span>Devnet Gas Faucet</span>
                      <span className="text-[10px] font-mono font-bold">+100 MON</span>
                    </button>
                  )}

                  {wallet.address && (
                    <a
                      href={`${MONAD_EXPLORER_URL}/address/${wallet.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:bg-zinc-800/60 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                        <span>View on Monad Explorer</span>
                      </div>
                      <ExternalLink className="h-3 w-3 text-zinc-500" />
                    </a>
                  )}
                </div>

                {/* Sign Out */}
                <div className="border-t border-zinc-800/80 pt-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAccountOpen(false);
                      privyLogout();
                    }}
                    className="flex w-full items-center space-x-2 rounded-xl px-2 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Disconnect Session</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <NotificationDrawer
        isOpen={isNotificationOpen}
        onClose={() => setIsNotificationOpen(false)}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
    </header>
  );
};
