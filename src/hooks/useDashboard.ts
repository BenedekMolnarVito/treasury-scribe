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
  getSpendingByTag,
  getSpendingByMonth,
  getSpendingByVendor,
  getUntaggedTransactionCount,
} from "../data/DashboardRepository";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DashboardPeriod = "month" | "3months" | "6months";

export interface UseDashboardResult {
  summary: SpendingSummary;
  byTag: SpendingByTag[];
  byMonth: SpendingByMonth[];
  byVendor: SpendingByVendor[];
  untaggedCount: number;
  period: DashboardPeriod;
  setPeriod: (p: DashboardPeriod) => void;
  loading: boolean;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_SUMMARY: SpendingSummary = { total: 0, count: 0, avgPerTransaction: 0 };

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
  const [byTag, setByTag] = useState<SpendingByTag[]>([]);
  const [byMonth, setByMonth] = useState<SpendingByMonth[]>([]);
  const [byVendor, setByVendor] = useState<SpendingByVendor[]>([]);
  const [untaggedCount, setUntaggedCount] = useState<number>(0);
  const [period, setPeriodState] = useState<DashboardPeriod>("month");
  const [loading, setLoading] = useState<boolean>(true);

  const loadData = useCallback(
    (activePeriod: DashboardPeriod): void => {
      setLoading(true);

      const months = MONTHS_FOR_PERIOD[activePeriod];
      const startDate = periodStartDate(months);

      setSummary(getSpendingSummary(db, startDate));
      setByTag(getSpendingByTag(db, startDate));
      setByMonth(getSpendingByMonth(db, months));
      setByVendor(getSpendingByVendor(db, TOP_VENDORS_LIMIT, startDate));
      setUntaggedCount(getUntaggedTransactionCount(db));

      setLoading(false);
    },
    [db],
  );

  const setPeriod = useCallback(
    (newPeriod: DashboardPeriod): void => {
      setPeriodState(newPeriod);
      loadData(newPeriod);
    },
    [loadData],
  );

  const refresh = useCallback((): void => {
    loadData(period);
  }, [loadData, period]);

  return {
    summary,
    byTag,
    byMonth,
    byVendor,
    untaggedCount,
    period,
    setPeriod,
    loading,
    refresh,
  };
}
