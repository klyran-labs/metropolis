import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  breadcrumb?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  badge,
  breadcrumbs = [],
  breadcrumb,
  actions,
  className = '',
}) => {
  const effectiveBreadcrumbs: BreadcrumbItem[] = React.useMemo(() => {
    if (breadcrumbs.length > 0) return breadcrumbs;
    if (breadcrumb) {
      return [
        { label: 'AgentGuard', href: '/' },
        { label: breadcrumb },
      ];
    }
    return [];
  }, [breadcrumbs, breadcrumb]);

  return (
    <header className={`mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden ${className}`}>
      <div className="space-y-1.5 min-w-0">
        {effectiveBreadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumbs" className="flex items-center gap-1.5 text-xs text-fg-muted">
            {effectiveBreadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.label}>
                {idx > 0 && <ChevronRight className="h-3 w-3 text-fg-subtle shrink-0" />}
                {crumb.href ? (
                  <Link
                    to={crumb.href}
                    className="hover:text-fg transition-colors hover:underline"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-fg font-medium">{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>

        {description && (
          <p className="text-sm text-fg-muted max-w-3xl leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-center">
          {actions}
        </div>
      )}
    </header>
  );
};
