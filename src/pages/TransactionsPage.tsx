/**
 * TransactionsPage
 *
 * Root view that lists all transactions. Rendered at route '/'.
 *
 * This module re-exports the canonical implementation from
 * `src/components/TransactionsPage.tsx` so that the React Router setup in
 * `App.tsx` continues to import from the `pages/` directory without change.
 */
export { default } from "../components/TransactionsPage";
export type { TransactionsPageProps } from "../components/TransactionsPage";
