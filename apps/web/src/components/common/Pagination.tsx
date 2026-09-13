import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className = '',
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startItem = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endItem = Math.min(safeCurrentPage * pageSize, totalItems);

  // Generate visible page numbers with ellipsis
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safeCurrentPage > 3) pages.push('ellipsis');

      const start = Math.max(2, safeCurrentPage - 1);
      const end = Math.min(totalPages - 1, safeCurrentPage + 1);

      for (let i = start; i <= end; i++) pages.push(i);

      if (safeCurrentPage < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  if (totalItems === 0) return null;

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-card-border bg-card/50 text-xs text-fg-muted font-sans select-none ${className}`}
    >
      {/* Range and count summary */}
      <div className="flex items-center gap-2">
        <span>
          Showing <strong className="text-fg font-mono">{startItem}</strong> to{' '}
          <strong className="text-fg font-mono">{endItem}</strong> of{' '}
          <strong className="text-fg font-mono">{totalItems}</strong> entries
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-card-border">
            <label htmlFor="pageSizeSelect" className="text-fg-subtle text-[11px]">
              Per page:
            </label>
            <select
              id="pageSizeSelect"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-lg border border-card-border bg-card-muted px-2 py-1 text-xs text-fg font-mono outline-none focus:border-primary cursor-pointer"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Pagination controls */}
      <div className="flex items-center gap-1">
        {/* First Page */}
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={safeCurrentPage === 1}
          title="First Page"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-card-border bg-card text-fg-muted hover:text-fg hover:bg-card-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>

        {/* Previous Page */}
        <button
          type="button"
          onClick={() => onPageChange(safeCurrentPage - 1)}
          disabled={safeCurrentPage === 1}
          title="Previous Page"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-card-border bg-card text-fg-muted hover:text-fg hover:bg-card-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {/* Numeric Page Buttons */}
        <div className="flex items-center gap-1 px-1">
          {getPageNumbers().map((p, idx) => {
            if (p === 'ellipsis') {
              return (
                <span key={`ellipsis-${idx}`} className="px-1 text-fg-subtle font-mono">
                  …
                </span>
              );
            }
            const isCurrent = p === safeCurrentPage;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                className={`flex h-7 min-w-[28px] items-center justify-center rounded-lg px-2 text-xs font-mono font-bold transition cursor-pointer ${
                  isCurrent
                    ? 'bg-primary text-white shadow-xs'
                    : 'border border-card-border bg-card text-fg hover:bg-card-muted'
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/* Next Page */}
        <button
          type="button"
          onClick={() => onPageChange(safeCurrentPage + 1)}
          disabled={safeCurrentPage === totalPages}
          title="Next Page"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-card-border bg-card text-fg-muted hover:text-fg hover:bg-card-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        {/* Last Page */}
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={safeCurrentPage === totalPages}
          title="Last Page"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-card-border bg-card text-fg-muted hover:text-fg hover:bg-card-muted disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
