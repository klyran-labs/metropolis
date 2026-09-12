import React, { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useWeb3Wallet } from '../../hooks/useWeb3Wallet';
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
} from 'lucide-react';
import { ThemeToggle } from '../common/ThemeToggle';
import { NotificationDrawer } from '../common/NotificationDrawer';
import { MONAD_EXPLORER_URL } from '../../config/contracts';

const NAV_SECTIONS = [
  { to: '/fleet', label: 'Fleet', icon: Shield },
  { to: '/lifecycle', label: 'Lifecycle', icon: Layers },
  { to: '/studio', label: 'Policy Studio', icon: Sliders },
  { to: '/simulator', label: 'Simulator', icon: Play },
  { to: '/audit', label: 'Audit', icon: FileText },
] as const;

export const AgentGuardHeader: React.FC = () => {
  const wallet = useWeb3Wallet();
  const { logout: privyLogout, user } = usePrivy();

  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setIsAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wallet.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const truncatedAddress = wallet.address
    ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
    : 'Not Connected';

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 font-sans transition-colors">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Header */}
        <div className="flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-700 font-sans font-black text-white text-base shadow-sm shadow-primary/20">
            AG
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-lg font-black tracking-tight text-slate-900 dark:text-white uppercase">
              Agent<span className="text-primary">Guard</span>
            </span>
            <span className="hidden rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold text-blue-600 border border-blue-200/60 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800/60 sm:inline-flex">
              CONTROL PLANE
            </span>
          </div>
        </div>

        {/* Primary section navigation — floating pill group, deep-linkable routes */}
        <nav aria-label="Dashboard sections" className="hidden lg:flex items-center gap-1 rounded-full border border-card-border bg-card-muted p-1">
          {NAV_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <NavLink
                key={section.to}
                to={section.to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    isActive ? 'bg-primary text-white shadow-xs' : 'text-fg-muted hover:text-fg hover:bg-card'
                  }`
                }
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{section.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Right Actions: Network, Notifications, Theme, Account */}
        <div className="flex items-center space-x-3">
          <span className="hidden xl:flex items-center space-x-1.5 rounded-full border border-card-border bg-card-muted px-3 py-1 text-xs font-semibold text-fg-muted">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span>Monad Testnet · 400ms finality</span>
          </span>

          <ThemeToggle />

          <button
            type="button"
            onClick={() => setIsNotificationOpen(true)}
            aria-label="View activity logs and notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          >
            <Bell className="h-4 w-4" />
          </button>

          {/* Account Popover */}
          <div className="relative" ref={accountMenuRef}>
            <button
              type="button"
              onClick={() => setIsAccountOpen(!isAccountOpen)}
              className="flex items-center space-x-2.5 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-1.5 pr-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800 transition-all cursor-pointer shadow-xs"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-white dark:bg-slate-700 shadow-xs border border-slate-200/60 dark:border-slate-700 text-primary">
                <Wallet className="h-3.5 w-3.5" />
              </div>
              <span className="hidden sm:inline font-mono">{truncatedAddress}</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>

            {isAccountOpen && (
              <div className="absolute right-0 mt-2 w-72 origin-top-right rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xl backdrop-blur-lg dark:border-slate-700 dark:bg-slate-800/95 font-sans animate-fade-in-up z-50">
                <div className="border-b border-slate-100 dark:border-slate-700 pb-3 mb-2 px-1">
                  <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    Operator Identity
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                      {truncatedAddress}
                    </span>
                    {wallet.address && (
                      <button
                        type="button"
                        onClick={handleCopyAddress}
                        className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                        title="Copy address"
                      >
                        {copiedAddress ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  {user?.email && (
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {user.email.address}
                    </div>
                  )}
                </div>

                {/* Balance & Explorer Link */}
                <div className="space-y-1 py-1">
                  <div className="flex items-center justify-between px-2 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-700/50 text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Available MON</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                      {wallet.balanceMon} MON
                    </span>
                  </div>

                  {wallet.address && (
                    <a
                      href={`${MONAD_EXPLORER_URL}/address/${wallet.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between px-2 py-2 rounded-xl text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                        <span>View on Monad Explorer</span>
                      </div>
                      <ExternalLink className="h-3 w-3 text-slate-400" />
                    </a>
                  )}
                </div>

                {/* Sign Out */}
                <div className="border-t border-slate-100 dark:border-slate-700 pt-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAccountOpen(false);
                      privyLogout();
                    }}
                    className="flex w-full items-center space-x-2 rounded-xl px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
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
    </header>
  );
};
