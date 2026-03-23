/**
 * DashboardPage
 *
 * Spending insights dashboard view. Rendered at route '/dashboard'.
 *
 * This module re-exports the canonical implementation from
 * `src/components/DashboardPage.tsx` so that the React Router setup in
 * `App.tsx` continues to import from the `pages/` directory without change.
 */
export { default } from "../components/DashboardPage";
export type { DashboardPageProps } from "../components/DashboardPage";
