/**
 * EditTransactionPage
 *
 * View for editing a single transaction. Rendered at route '/edit/:id'.
 * Reads the transaction `id` from the URL params.
 */
import React from "react";
import { useParams } from "react-router-dom";

/**
 * Placeholder edit transaction page.
 * Full implementation will be added in the Edit Transaction UI task.
 */
const EditTransactionPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <main>
      <h1>Edit Transaction</h1>
      <p data-testid="transaction-id">{id}</p>
    </main>
  );
};

export default EditTransactionPage;
