// _generate_page.js - Generates the complete TransactionsPage.tsx
const fs = require('fs');

const lines = [];
function w(l) { lines.push(l); }

// File header
w('/**');
w(' * TransactionsPage');
w(' *');
w(' * Root view that lists all transactions.');
w(' * Rendered at route \'/\'.');
w(' *');
w(' * Features:');
w(' * - Header buttons: Add Transaction, Refresh, Export, Clear All.');
w(' * - "Show deleted entries" toggle switch.');
w(' * - Collapsible tag filter section with tag chips and "Untagged" toggle.');
w(' * - Transaction cards with bold title, body, amount+currency (red expense /');
w(' *   green income), timestamp, and tags line.');
w(' * - Card backgrounds: #2A2A1A (untagged) / #1A2A1A (tagged).');
w(' * - Swipe-left on a card reveals a red Delete button \u2192 confirmation \u2192 soft-delete.');
w(' * - Tapping a card navigates to /edit/:id.');
w(' * - Loading spinner while data loads.');
w(' * - Empty-state message when no transactions exist.');
w(' * - Dark theme throughout, consistent with EditTransactionPage.');
w(' */');
w('');
w('import React, {');
w('  useState,');
w('  useEffect,');
w('  useRef,');
w('  useCallback,');
w('} from "react";');
w('import { useNavigate } from "react-router-dom";');
w('import type { Database } from "sql.js";');
w('import type { Transaction } from "../models/Transaction";');
w('import { useTransactions } from "../hooks/useTransactions";');
w('import type { ActiveTagCount } from "../hooks/useTransactions";');

fs.writeFileSync('_page_part1.txt', lines.join('\n'), 'utf8');
console.log('Part 1 written:', lines.length, 'lines');
