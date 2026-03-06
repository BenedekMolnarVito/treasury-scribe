/**
 * EditTransactionPage
 *
 * View for editing a single transaction. Rendered at route '/edit/:id'.
 *
 * This module re-exports the canonical implementation from
 * `src/components/EditTransactionPage.tsx` so that the React Router setup in
 * `App.tsx` continues to import from the `pages/` directory without change.
 */
export { default } from "../components/EditTransactionPage";
export type { EditTransactionPageProps } from "../components/EditTransactionPage";
