/**
 * App
 *
 * Root application component. Sets up React Router v6 routes:
 *   '/'          → TransactionsPage
 *   '/edit/:id'  → EditTransactionPage
 */
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import TransactionsPage from "./pages/TransactionsPage";
import EditTransactionPage from "./pages/EditTransactionPage";

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TransactionsPage />} />
        <Route path="/edit/:id" element={<EditTransactionPage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
