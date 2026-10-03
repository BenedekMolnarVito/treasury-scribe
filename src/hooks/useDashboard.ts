/**
 * useDashboard.ts
 *
 * React hook that manages the dashboard screen state by wrapping
 * DashboardRepository functions.  Exposes spending summaries, breakdowns
 * by tag / month / vendor, an untagged-transaction count, and a
 * time-period selector.
 */

import { useState, useCallback } from "react";
import type { Database } from "sql.js";
import type {
  SpendingSummary,
  SpendingByTag,
  SpendingByMonth,
  SpendingByVendor,
  SpendingByWeek,
} from "../data/DashboardRepository";
import {
  getSpendingSummary,
  getIncomeSummary,
  getSpendingByTag,
  getSpendingByMonth,
  getIncomeByMonth,
  getSpendingByVendor,
  getUntaggedTransactionCount,
  getSpendingByWeek,
  getIncomeByWeek,
} from "../data/DashboardRepository";
import type { TagWithCount } from "../data/TransactionRepository";
import { getActiveTagsWithCounts } from "../data/TransactionRepository";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DashboardPeriod = "month" | "lastMonth" | "3months" | "6months" | "9months" | "12months";

export interface IncomeSummary {
  total: number;
  count: number;
}

export interface UseDashboardResult {
  summary: SpendingSummary;
  incomeSummary: IncomeSummary;
  byTag: SpendingByTag[];
  byMonth: SpendingByMonth[];
  incomeByMonth: SpendingByMonth[];
  byWeek: SpendingByWeek[];
  incomeByWeek: SpendingByWeek[];
  trendGranularity: "weekly" | "monthly";
  byVendor: SpendingByVendor[];
  untaggedCount: number;
  period: DashboardPeriod;
  setPeriod: (p: DashboardPeriod) => void;
  loading: boolean;
  refresh: () => void;
  availableTags: TagWithCount[];
  selectedTagIds: number[];
  setSelectedTagIds: (ids: number[]) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_SUMMARY: SpendingSummary = { total: 0, count: 0, avgPerTransaction: 0 };
const EMPTY_INCOME: IncomeSummary = { total: 0, count: 0 };

const MONTHS_FOR_PERIOD: Record<DashboardPeriod, number> = {
  month: 0,
  lastMonth: 1, // placeholder; handled specially in loadData
  "3months": 3,
  "6months": 6,
  "9months": 9,
  "12months": 12,
};

const TOP_VENDORS_LIMIT = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function periodStartDate(monthsBack: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Compute the {startDate, endDate} date range for a given period. */
export function periodDateRange(period: DashboardPeriod): { startDate: string; endDate?: string } {
  if (period === "lastMonth") {
    const now = new Date();
    // First day of the previous calendar month
    const firstOfPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // Last day of the previous calendar month (= day before first of current)
    const lastOfPrev = new Date(now.getFullYear(), now.getMonth(), 0);

    const pad = (n: number) => String(n).padStart(2, "0");

    const startDate = `${firstOfPrev.getFullYear()}-${pad(firstOfPrev.getMonth() + 1)}-${pad(firstOfPrev.getDate())}`;
    const endDate   = `${lastOfPrev.getFullYear()}-${pad(lastOfPrev.getMonth() + 1)}-${pad(lastOfPrev.getDate())}`;
    return { startDate, endDate };
  }

  const months = MONTHS_FOR_PERIOD[period];
  return { startDate: periodStartDate(months) };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboard(db: Database): UseDashboardResult {
  const [summary, setSummary] = useState<SpendingSummary>(EMPTY_SUMMARY);
  const [incomeSummary, setIncomeSummary] = useState<IncomeSummary>(EMPTY_INCOME);
  const [byTag, setByTag] = useState<SpendingByTag[]>([]);
  const [byMonth, setByMonth] = useState<SpendingByMonth[]>([]);
  const [incomeByMonth, setIncomeByMonth] = useState<SpendingByMonth[]>([]);
  const [byWeek, setByWeek] = useState<SpendingByWeek[]>([]);
  const [incomeByWeek, setIncomeByWeek] = useState<SpendingByWeek[]>([]);
  const [trendGranularity, setTrendGranularity] = useState<"weekly" | "monthly">("weekly");
  const [byVendor, setByVendor] = useState<SpendingByVendor[]>([]);
  const [untaggedCount, setUntaggedCount] = useState<number>(0);
  const [period, setPeriodState] = useState<DashboardPeriod>("month");
  const [loading, setLoading] = useState<boolean>(true);
  const [availableTags, setAvailableTags] = useState<TagWithCount[]>([]);
  const [selectedTagIds, setSelectedTagIdsState] = useState<number[]>([]);

  const loadData = useCallback(
    (activePeriod: DashboardPeriod, tagIds: number[]): void => {
      setLoading(true);

      const { startDate, endDate } = periodDateRange(activePeriod);
      const activeTagIds = tagIds.length > 0 ? tagIds : undefined;

      setSummary(getSpendingSummary(db, startDate, endDate, activeTagIds));
      setIncomeSummary(getIncomeSummary(db, startDate, endDate, activeTagIds));
      setByTag(getSpendingByTag(db, startDate, endDate, activeTagIds));
      setByMonth(getSpendingByMonth(db, startDate, endDate, activeTagIds));
      setIncomeByMonth(getIncomeByMonth(db, startDate, endDate, activeTagIds));
      setByVendor(getSpendingByVendor(db, TOP_VENDORS_LIMIT, startDate, endDate, activeTagIds));
      setUntaggedCount(getUntaggedTransactionCount(db));
      setAvailableTags(getActiveTagsWithCounts(db));

      // FR3: weekly trend for single-month periods
      const isSingleMonth = activePeriod === "month" || activePeriod === "lastMonth";
      if (isSingleMonth) {
        // endDate is defined for lastMonth; for current month use today
        const effectiveEnd = endDate ?? new Date().toISOString().slice(0, 10);
        setByWeek(getSpendingByWeek(db, startDate, effectiveEnd));
        setIncomeByWeek(getIncomeByWeek(db, startDate, effectiveEnd));
        setTrendGranularity("weekly");
      } else {
        setByWeek([]);
        setIncomeByWeek([]);
        setTrendGranularity("monthly");
      }

      setLoading(false);
    },
    [db],
  );

  const setPeriod = useCallback(
    (newPeriod: DashboardPeriod): void => {
      setPeriodState(newPeriod);
      loadData(newPeriod, selectedTagIds);
    },
    [loadData, selectedTagIds],
  );

  const setSelectedTagIds = useCallback(
    (ids: number[]): void => {
      setSelectedTagIdsState(ids);
      loadData(period, ids);
    },
    [loadData, period],
  );

  const refresh = useCallback((): void => {
    loadData(period, selectedTagIds);
  }, [loadData, period, selectedTagIds]);

  return {
    summary,
    incomeSummary,
    byTag,
    byMonth,
    incomeByMonth,
    byWeek,
    incomeByWeek,
    trendGranularity,
    byVendor,
    untaggedCount,
    period,
    setPeriod,
    loading,
    refresh,
    availableTags,
    selectedTagIds,
    setSelectedTagIds,
  };
}
