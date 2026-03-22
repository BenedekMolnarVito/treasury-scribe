/**
 * DashboardPage.tsx
 *
 * Full-featured spending insights dashboard.  Mobile-first card-stack layout
 * with hero summary (income + expenses + net balance), doughnut chart
 * (spending by tag), line chart (monthly trend for expenses & income),
 * top-vendors list, tag filter chips, and untagged-transaction badge.
 *
 * All charts are lightweight inline SVG - no external charting library.
 */

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Database } from "sql.js";
import type { SpendingByTag, SpendingByMonth, SpendingByVendor } from "../data/DashboardRepository";
import { useDashboard } from "../hooks/useDashboard";
import type { DashboardPeriod } from "../hooks/useDashboard";
import type { TagWithCount } from "../data/TransactionRepository";

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

// ---------------------------------------------------------------------------
// Period labels
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: "month", label: "This Month" },
  { value: "3months", label: "3 Mo" },
  { value: "6months", label: "6 Mo" },
];

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  month: "This Month",
  "3months": "Last 3 Months",
  "6months": "Last 6 Months",
};

// ---------------------------------------------------------------------------
// Month name lookup
// ---------------------------------------------------------------------------

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(amount: number): string {
  return Math.round(amount).toLocaleString();
}

function computeAvgPerDay(expenseTotal: number, period: DashboardPeriod): number {
  const now = new Date();
  if (period === "month") {
    const dayOfMonth = now.getDate();
    return dayOfMonth > 0 ? expenseTotal / dayOfMonth : 0;
  }
  const monthsBack = period === "3months" ? 3 : 6;
  const periodStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const diffMs = now.getTime() - periodStart.getTime();
  const totalDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  return expenseTotal / totalDays;
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

// -- Hero Card ---------------------------------------------------------------

interface HeroCardProps {
  expenseTotal: number;
  incomeTotal: number;
  avgPerDay: number;
  periodLabel: string;
}

const HeroCard: React.FC<HeroCardProps> = ({ expenseTotal, incomeTotal, avgPerDay, periodLabel }) => {
  const netBalance = incomeTotal - expenseTotal;
  const netColor = netBalance >= 0 ? "#4CAF50" : "#FF6B6B";

  return (
    <div style={STYLE.card} data-testid="hero-card">
      <div style={{ color: "#B0B0B0", fontSize: "0.85em", marginBottom: "8px" }}>
        {periodLabel}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
        <div>
          <div style={{ color: "#FF6B6B", fontSize: "0.85em" }}>Expenses</div>
          <div style={{ color: "#FF6B6B", fontWeight: "bold", fontSize: "1.3em" }} data-testid="hero-expenses">
            {"\u25bc"} {formatAmount(expenseTotal)} HUF
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#4CAF50", fontSize: "0.85em" }}>Income</div>
          <div style={{ color: "#4CAF50", fontWeight: "bold", fontSize: "1.3em" }} data-testid="hero-income">
            {"\u25b2"} {formatAmount(incomeTotal)} HUF
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", borderTop: "1px solid #333", paddingTop: "8px" }}>
        <div style={{ color: netColor, fontWeight: "bold", fontSize: "1.5em" }} data-testid="hero-net">
          Net: {netBalance >= 0 ? "+" : ""}{formatAmount(netBalance)} HUF
        </div>
      </div>
      <div style={{ color: "#B0B0B0", fontSize: "0.85em", marginTop: "8px", textAlign: "center" }} data-testid="hero-avg-day">
        Avg spent/day: {formatAmount(avgPerDay)} HUF
      </div>
    </div>
  );
};

// -- Tag filter chips --------------------------------------------------------

interface TagFilterChipsProps {
  availableTags: TagWithCount[];
  selectedTagIds: number[];
  onChangeSelectedTagIds: (ids: number[]) => void;
}

const TagFilterChips: React.FC<TagFilterChipsProps> = ({
  availableTags,
  selectedTagIds,
  onChangeSelectedTagIds,
}) => {
  if (availableTags.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }} data-testid="tag-filter">
      {availableTags.map((tag) => {
        const selected = selectedTagIds.includes(tag.tagId);
        return (
          <button
            key={tag.tagId}
            type="button"
            onClick={() => {
              if (selected) {
                onChangeSelectedTagIds(selectedTagIds.filter(id => id !== tag.tagId));
              } else {
                onChangeSelectedTagIds([...selectedTagIds, tag.tagId]);
              }
            }}
            style={{
              background: selected ? "#1565C0" : "#2A2A2A",
              color: selected ? "#FFFFFF" : "#B0B0B0",
              border: "1px solid " + (selected ? "#1565C0" : "#444"),
              borderRadius: 16,
              padding: "4px 12px",
              fontSize: "0.85em",
              cursor: "pointer",
            }}
          >
            {tag.tagName} ({tag.count})
          </button>
        );
      })}
      {selectedTagIds.length > 0 && (
        <button
          type="button"
          onClick={() => onChangeSelectedTagIds([])}
          data-testid="tag-filter-clear"
          style={{ background: "transparent", color: "#FF6B6B", border: "none", fontSize: "0.85em", cursor: "pointer" }}
        >
          {"\u2715"} Clear
        </button>
      )}
    </div>
  );
};

// -- Doughnut chart for tags -------------------------------------------------

interface TagDoughnutChartProps {
  data: SpendingByTag[];
}

const TagDoughnutChart: React.FC<TagDoughnutChartProps> = ({ data }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const grandTotal = data.reduce((s, d) => s + d.total, 0);

  if (data.length === 0) {
    return (
      <div style={STYLE.card} data-testid="tag-chart">
        <div style={STYLE.cardTitle}>Spending by Tag</div>
        <div style={{ color: "#888" }}>No data</div>
      </div>
    );
  }

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 85;
  const innerR = 50;

  let startAngle = -Math.PI / 2;
  const segments = data.map((entry, i) => {
    const pct = grandTotal > 0 ? entry.total / grandTotal : 0;
    const angle = pct * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const largeArc = angle > Math.PI ? 1 : 0;

    const x1outer = cx + outerR * Math.cos(startAngle);
    const y1outer = cy + outerR * Math.sin(startAngle);
    const x2outer = cx + outerR * Math.cos(endAngle);
    const y2outer = cy + outerR * Math.sin(endAngle);
    const x1inner = cx + innerR * Math.cos(endAngle);
    const y1inner = cy + innerR * Math.sin(endAngle);
    const x2inner = cx + innerR * Math.cos(startAngle);
    const y2inner = cy + innerR * Math.sin(startAngle);

    const path = [
      `M ${x1outer} ${y1outer}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2outer} ${y2outer}`,
      `L ${x1inner} ${y1inner}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2inner} ${y2inner}`,
      "Z",
    ].join(" ");

    const seg = { path, pct, entry, index: i };
    startAngle = endAngle;
    return seg;
  });

  return (
    <div style={STYLE.card} data-testid="tag-chart">
      <div style={STYLE.cardTitle}>Spending by Tag</div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Spending by tag doughnut chart">
          {segments.map((seg, i) => (
            <path
              key={seg.entry.tagName}
              d={seg.path}
              fill={TAG_COLORS[i % TAG_COLORS.length]}
              stroke="#1E1E1E"
              strokeWidth="1"
              style={{ cursor: "pointer", opacity: activeIndex !== null && activeIndex !== i ? 0.5 : 1 }}
              onClick={() => setActiveIndex(activeIndex === i ? null : i)}
            />
          ))}
          {activeIndex !== null && (
            <>
              <text x={cx} y={cy - 6} textAnchor="middle" fill="#FFFFFF" fontSize="14" fontWeight="bold">
                {formatAmount(data[activeIndex].total)}
              </text>
              <text x={cx} y={cy + 12} textAnchor="middle" fill="#B0B0B0" fontSize="11">
                {Math.round(segments[activeIndex].pct * 100)}%
              </text>
            </>
          )}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.map((entry, i) => (
            <div key={entry.tagName} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8em" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: TAG_COLORS[i % TAG_COLORS.length], flexShrink: 0 }} />
              <span style={{ color: "#E0E0E0" }}>{entry.tagName}</span>
              <span style={{ color: "#888" }}>{Math.round((grandTotal > 0 ? entry.total / grandTotal : 0) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// -- Monthly trend line chart ------------------------------------------------

interface MonthlyTrendChartProps {
  expenseData: SpendingByMonth[];
  incomeData: SpendingByMonth[];
}

const MonthlyTrendChart: React.FC<MonthlyTrendChartProps> = ({ expenseData, incomeData }) => {
  const allMonths = [...new Set([...expenseData.map(d => d.month), ...incomeData.map(d => d.month)])].sort();

  if (allMonths.length === 0) {
    return (
      <div style={STYLE.card} data-testid="monthly-chart">
        <div style={STYLE.cardTitle}>Monthly Trend</div>
        <div style={{ color: "#888" }}>No data</div>
      </div>
    );
  }

  const expenseMap = new Map(expenseData.map(d => [d.month, d.total]));
  const incomeMap = new Map(incomeData.map(d => [d.month, d.total]));

  const expenseValues = allMonths.map(m => expenseMap.get(m) ?? 0);
  const incomeValues = allMonths.map(m => incomeMap.get(m) ?? 0);
  const maxVal = Math.max(...expenseValues, ...incomeValues, 1);

  const chartWidth = 300;
  const chartHeight = 180;
  const padLeft = 10;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 30;
  const plotWidth = chartWidth - padLeft - padRight;
  const plotHeight = chartHeight - padTop - padBottom;

  const getX = (i: number) => padLeft + (allMonths.length > 1 ? (i / (allMonths.length - 1)) * plotWidth : plotWidth / 2);
  const getY = (val: number) => padTop + plotHeight - (val / maxVal) * plotHeight;

  const buildLine = (values: number[]) => {
    if (values.length === 0) return "";
    return values.map((v, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(v)}`).join(" ");
  };

  const formatMonthLabel = (month: string) => {
    const monthNum = parseInt(month.slice(5), 10);
    return MONTH_NAMES[monthNum - 1] ?? month.slice(5);
  };

  return (
    <div style={STYLE.card} data-testid="monthly-chart">
      <div style={STYLE.cardTitle}>Monthly Trend</div>
      <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Monthly trend chart">
        <path d={buildLine(expenseValues)} fill="none" stroke="#FF6B6B" strokeWidth="2" />
        <path d={buildLine(incomeValues)} fill="none" stroke="#4CAF50" strokeWidth="2" />
        {expenseValues.map((v, i) => (
          <circle key={`exp-${i}`} cx={getX(i)} cy={getY(v)} r={3} fill="#FF6B6B" />
        ))}
        {incomeValues.map((v, i) => (
          <circle key={`inc-${i}`} cx={getX(i)} cy={getY(v)} r={3} fill="#4CAF50" />
        ))}
        {allMonths.map((month, i) => (
          <text key={month} x={getX(i)} y={chartHeight - 4} fill="#B0B0B0" fontSize="10" textAnchor="middle">
            {formatMonthLabel(month)}
          </text>
        ))}
      </svg>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.8em" }}>
          <span style={{ width: 12, height: 3, background: "#FF6B6B", borderRadius: 1 }} />
          <span style={{ color: "#B0B0B0" }}>Expenses</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.8em" }}>
          <span style={{ width: 12, height: 3, background: "#4CAF50", borderRadius: 1 }} />
          <span style={{ color: "#B0B0B0" }}>Income</span>
        </div>
      </div>
    </div>
  );
};

// -- Top vendors card --------------------------------------------------------

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

// -- Untagged badge ----------------------------------------------------------

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
    incomeSummary,
    byTag,
    byMonth,
    incomeByMonth,
    byVendor,
    untaggedCount,
    period,
    setPeriod,
    loading,
    refresh,
    availableTags,
    selectedTagIds,
    setSelectedTagIds,
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

  const avgPerDay = computeAvgPerDay(summary.total, period);

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
        expenseTotal={summary.total}
        incomeTotal={incomeSummary.total}
        avgPerDay={avgPerDay}
        periodLabel={PERIOD_LABELS[period]}
      />

      <PeriodPills current={period} onChange={setPeriod} />

      <TagFilterChips
        availableTags={availableTags}
        selectedTagIds={selectedTagIds}
        onChangeSelectedTagIds={setSelectedTagIds}
      />

      <TagDoughnutChart data={byTag} />
      <MonthlyTrendChart expenseData={byMonth} incomeData={incomeByMonth} />
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
