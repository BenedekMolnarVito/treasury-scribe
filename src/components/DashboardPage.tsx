/**
 * DashboardPage.tsx
 *
 * Full-featured spending insights dashboard.  Mobile-first card-stack layout
 * with hero summary, horizontal bar chart (spending by tag), vertical bar
 * chart (monthly trend), top-vendors list, and untagged-transaction badge.
 *
 * All charts are lightweight inline SVG - no external charting library.
 */

import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Database } from "sql.js";
import type { SpendingByTag, SpendingByMonth, SpendingByVendor } from "../data/DashboardRepository";
import { useDashboard } from "../hooks/useDashboard";
import type { DashboardPeriod } from "../hooks/useDashboard";

// ---------------------------------------------------------------------------
// Style constants (dark theme)
// ---------------------------------------------------------------------------

const STYLE = {
  page: {
    background: "#121212",
    color: "#E0E0E0",
    minHeight: "100vh",
    padding: "16px",
    fontFamily: "sans-serif",
  } as React.CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
  } as React.CSSProperties,

  backButton: {
    background: "none",
    border: "none",
    color: "#1565C0",
    fontSize: "1em",
    cursor: "pointer",
    padding: "4px 0",
  } as React.CSSProperties,

  heading: {
    color: "#FFFFFF",
    margin: 0,
    fontSize: "1.3em",
  } as React.CSSProperties,

  card: {
    background: "#1E1E1E",
    border: "1px solid #333",
    borderRadius: "8px",
    padding: "16px",
    marginBottom: "12px",
  } as React.CSSProperties,

  heroTotal: {
    fontSize: "2em",
    fontWeight: "bold" as const,
    color: "#FFFFFF",
  } as React.CSSProperties,

  heroSub: {
    color: "#B0B0B0",
    fontSize: "0.9em",
    marginTop: "4px",
  } as React.CSSProperties,

  cardTitle: {
    color: "#FFFFFF",
    fontSize: "1em",
    fontWeight: "bold" as const,
    marginBottom: "12px",
  } as React.CSSProperties,

  pillRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
  } as React.CSSProperties,

  pillActive: {
    background: "#1565C0",
    color: "#FFFFFF",
    border: "none",
    borderRadius: "16px",
    padding: "6px 14px",
    fontSize: "0.85em",
    cursor: "pointer",
  } as React.CSSProperties,

  pillInactive: {
    background: "#2A2A2A",
    color: "#E0E0E0",
    border: "none",
    borderRadius: "16px",
    padding: "6px 14px",
    fontSize: "0.85em",
    cursor: "pointer",
  } as React.CSSProperties,

  vendorRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
    borderBottom: "1px solid #333",
  } as React.CSSProperties,

  badge: {
    background: "#FF6B6B",
    color: "#FFFFFF",
    borderRadius: "16px",
    padding: "8px 16px",
    textAlign: "center" as const,
    fontWeight: "bold" as const,
    marginBottom: "12px",
  } as React.CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Chart colour palette
// ---------------------------------------------------------------------------

const TAG_COLORS = ["#1565C0", "#2E7D32", "#FF6B6B", "#FFB300", "#7B1FA2"];
const CURRENT_MONTH_COLOR = "#1565C0";
const OTHER_MONTH_COLOR = "#555555";

// ---------------------------------------------------------------------------
// Period labels
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: "month", label: "This Month" },
  { value: "3months", label: "3 Mo" },
  { value: "6months", label: "6 Mo" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(amount: number): string {
  return Math.round(amount).toLocaleString();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PeriodPillsProps {
  current: DashboardPeriod;
  onChange: (p: DashboardPeriod) => void;
}

const PeriodPills: React.FC<PeriodPillsProps> = ({ current, onChange }) => (
  <div style={STYLE.pillRow} data-testid="period-pills">
    {PERIOD_OPTIONS.map(({ value, label }) => (
      <button
        key={value}
        data-testid={`pill-${value}`}
        style={value === current ? STYLE.pillActive : STYLE.pillInactive}
        onClick={() => onChange(value)}
      >
        {label}
      </button>
    ))}
  </div>
);

interface HeroCardProps {
  total: number;
  count: number;
  avgPerTransaction: number;
}

const HeroCard: React.FC<HeroCardProps> = ({ total, count, avgPerTransaction }) => (
  <div style={STYLE.card} data-testid="hero-card">
    <div style={{ color: "#B0B0B0", fontSize: "0.85em", marginBottom: "4px" }}>
      THIS MONTH
    </div>
    <div style={STYLE.heroTotal} data-testid="hero-total">
      {"\u25bc"} {formatAmount(total)} HUF
    </div>
    <div style={STYLE.heroSub}>
      Avg: {formatAmount(avgPerTransaction)}/txn
    </div>
    <div style={STYLE.heroSub}>
      {count} transactions
    </div>
  </div>
);

interface TagBarChartProps {
  data: SpendingByTag[];
}

const TagBarChart: React.FC<TagBarChartProps> = ({ data }) => {
  const maxTotal = data.length > 0 ? Math.max(...data.map((d) => d.total)) : 1;
  const barHeight = 28;
  const gap = 6;
  const chartHeight = data.length * (barHeight + gap);
  const chartWidth = 300;

  return (
    <div style={STYLE.card} data-testid="tag-chart">
      <div style={STYLE.cardTitle}>Spending by Tag</div>
      {data.length === 0 ? (
        <div style={{ color: "#888" }}>No data</div>
      ) : (
        <svg
          width="100%"
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="Spending by tag chart"
        >
          {data.map((entry, i) => {
            const barWidth = (entry.total / maxTotal) * (chartWidth - 120);
            const y = i * (barHeight + gap);
            const color = TAG_COLORS[i % TAG_COLORS.length];
            const grandTotal = data.reduce((s, d) => s + d.total, 0);
            const pct = grandTotal > 0 ? Math.round((entry.total / grandTotal) * 100) : 0;
            return (
              <g key={entry.tagName}>
                <rect x={0} y={y} width={Math.max(barWidth, 2)} height={barHeight} rx={4} fill={color} />
                <text x={Math.max(barWidth, 2) + 6} y={y + barHeight / 2 + 5} fill="#E0E0E0" fontSize="12">
                  {entry.tagName} {pct}%
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

interface MonthlyTrendChartProps {
  data: SpendingByMonth[];
}

const MonthlyTrendChart: React.FC<MonthlyTrendChartProps> = ({ data }) => {
  const maxTotal = data.length > 0 ? Math.max(...data.map((d) => d.total)) : 1;
  const chartWidth = 300;
  const chartHeight = 160;
  const barAreaHeight = chartHeight - 24;
  const barWidth = data.length > 0 ? Math.min(40, (chartWidth - 20) / data.length - 4) : 40;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div style={STYLE.card} data-testid="monthly-chart">
      <div style={STYLE.cardTitle}>Monthly Trend</div>
      {data.length === 0 ? (
        <div style={{ color: "#888" }}>No data</div>
      ) : (
        <svg
          width="100%"
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="Monthly trend chart"
        >
          {data.map((entry, i) => {
            const barH = maxTotal > 0 ? (entry.total / maxTotal) * barAreaHeight : 0;
            const x = 10 + i * ((chartWidth - 20) / data.length) + 2;
            const y = barAreaHeight - barH;
            const fill = entry.month === currentMonth ? CURRENT_MONTH_COLOR : OTHER_MONTH_COLOR;
            const shortLabel = entry.month.slice(5);
            return (
              <g key={entry.month}>
                <rect x={x} y={y} width={barWidth} height={Math.max(barH, 2)} rx={3} fill={fill} />
                <text
                  x={x + barWidth / 2}
                  y={chartHeight - 4}
                  fill="#B0B0B0"
                  fontSize="10"
                  textAnchor="middle"
                >
                  {shortLabel}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

interface TopVendorsCardProps {
  data: SpendingByVendor[];
}

const TopVendorsCard: React.FC<TopVendorsCardProps> = ({ data }) => (
  <div style={STYLE.card} data-testid="vendors-card">
    <div style={STYLE.cardTitle}>Top Vendors</div>
    {data.length === 0 ? (
      <div style={{ color: "#888" }}>No data</div>
    ) : (
      data.map((entry, i) => (
        <div key={entry.vendor} style={STYLE.vendorRow}>
          <span>{i + 1}. {entry.vendor}</span>
          <span>{formatAmount(entry.total)}</span>
        </div>
      ))
    )}
  </div>
);

interface UntaggedBadgeProps {
  count: number;
  onClassify?: () => void;
}

const UntaggedBadge: React.FC<UntaggedBadgeProps> = ({ count, onClassify }) =>
  count > 0 ? (
    <div
      style={{ ...STYLE.badge, cursor: "pointer" }}
      data-testid="untagged-badge"
      role="button"
      tabIndex={0}
      onClick={onClassify}
      onKeyDown={(e) => { if (e.key === "Enter" && onClassify) onClassify(); }}
    >
      {"\u26a0"} {count} untagged txns — tap to classify
    </div>
  ) : null;

// ---------------------------------------------------------------------------
// DashboardPageContent  (requires db; always calls the hook)
// ---------------------------------------------------------------------------

interface DashboardPageContentProps {
  db: Database;
}

const DashboardPageContent: React.FC<DashboardPageContentProps> = ({ db }) => {
  const navigate = useNavigate();
  const {
    summary,
    byTag,
    byMonth,
    byVendor,
    untaggedCount,
    period,
    setPeriod,
    loading,
    refresh,
  } = useDashboard(db);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div role="status" aria-label="Loading" style={{ textAlign: "center", padding: 32, color: "#B0B0B0" }}>
        {"Loading\u2026"}
      </div>
    );
  }

  return (
    <>
      <div style={STYLE.header}>
        <button
          style={STYLE.backButton}
          onClick={() => navigate("/")}
          data-testid="btn-back"
          aria-label="Back"
        >
          {"\u2190"} Back
        </button>
        <h1 style={STYLE.heading}>Dashboard</h1>
      </div>

      <HeroCard
        total={summary.total}
        count={summary.count}
        avgPerTransaction={summary.avgPerTransaction}
      />

      <PeriodPills current={period} onChange={setPeriod} />

      <TagBarChart data={byTag} />
      <MonthlyTrendChart data={byMonth} />
      <TopVendorsCard data={byVendor} />
      <UntaggedBadge count={untaggedCount} onClassify={() => navigate("/?filter=untagged")} />
    </>
  );
};

// ---------------------------------------------------------------------------
// DashboardPage  (public export - db is optional)
// ---------------------------------------------------------------------------

export interface DashboardPageProps {
  db?: Database;
}

const DashboardPage: React.FC<DashboardPageProps> = ({ db }) => {
  return (
    <main style={STYLE.page}>
      {db ? (
        <DashboardPageContent db={db} />
      ) : (
        <p data-testid="no-db-message" style={{ color: "#888" }}>
          Database not available.
        </p>
      )}
    </main>
  );
};

export default DashboardPage;
