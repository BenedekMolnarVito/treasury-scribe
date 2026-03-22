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
} from "../data/DashboardRepository";
import {
  getSpendingSummary,
  getIncomeSummary,
  getSpendingByTag,
  getSpendingByMonth,
  getIncomeByMonth,
  getSpendingByVendor,
  getUntaggedTransactionCount,
} from "../data/DashboardRepository";
import type { TagWithCount } from "../data/TransactionRepository";
import { getActiveTagsWithCounts } from "../data/TransactionRepository";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DashboardPeriod = "month" | "3months" | "6months";

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
  month: 1,
  "3months": 3,
  "6months": 6,
};

const TOP_VENDORS_LIMIT = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodStartDate(monthsBack: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  const [byVendor, setByVendor] = useState<SpendingByVendor[]>([]);
  const [untaggedCount, setUntaggedCount] = useState<number>(0);
  const [period, setPeriodState] = useState<DashboardPeriod>("month");
  const [loading, setLoading] = useState<boolean>(true);
  const [availableTags, setAvailableTags] = useState<TagWithCount[]>([]);
  const [selectedTagIds, setSelectedTagIdsState] = useState<number[]>([]);

  const loadData = useCallback(
    (activePeriod: DashboardPeriod, tagIds: number[]): void => {
      setLoading(true);

      const months = MONTHS_FOR_PERIOD[activePeriod];
      const startDate = periodStartDate(months);
      const activeTagIds = tagIds.length > 0 ? tagIds : undefined;

      setSummary(getSpendingSummary(db, startDate, undefined, activeTagIds));
      setIncomeSummary(getIncomeSummary(db, startDate, undefined, activeTagIds));
      setByTag(getSpendingByTag(db, startDate, undefined, activeTagIds));
      setByMonth(getSpendingByMonth(db, months, activeTagIds));
      setIncomeByMonth(getIncomeByMonth(db, months, activeTagIds));
      setByVendor(getSpendingByVendor(db, TOP_VENDORS_LIMIT, startDate, undefined, activeTagIds));
      setUntaggedCount(getUntaggedTransactionCount(db));
      setAvailableTags(getActiveTagsWithCounts(db));

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
