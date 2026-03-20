const fs = require('fs');

// Read the committed version to extract TransactionCard, AddTransactionModal, ExportModal
const committed = fs.readFileSync('src/components/TransactionsPage.tsx', 'utf8');

// Read the parts we generated
const part1 = fs.readFileSync('_page_part1.txt', 'utf8');
const part2 = fs.readFileSync('_page_part2.txt', 'utf8');

// Extract TransactionCard from committed version (between markers)
function extractBetween(text, startMarker, endMarker) {
  const si = text.indexOf(startMarker);
  const ei = text.indexOf(endMarker, si + startMarker.length);
  if (si === -1 || ei === -1) return null;
  return text.substring(si, ei);
}

// Get TransactionCard component
const tcStart = '// ---------------------------------------------------------------------------\n// TransactionCard';
const tcEnd = '\n// ---------------------------------------------------------------------------\n// AddTransactionModal';
let transactionCard = extractBetween(committed, tcStart, tcEnd);

// Need to update colors in TransactionCard  
// The committed version uses different color constants
// Actually, the TransactionCard refs BG_UNTAGGED, BG_TAGGED etc which we redefine above

// Get AddTransactionModal
const amStart = '// ---------------------------------------------------------------------------\n// AddTransactionModal';
const amEnd = '\n// ---------------------------------------------------------------------------\n// ExportModal';
let addModal = extractBetween(committed, amStart, amEnd);

// Get ExportModal  
const emStart = '// ---------------------------------------------------------------------------\n// ExportModal';
const emEnd = '\n// ---------------------------------------------------------------------------\n// TransactionsPageContent';
let exportModal = extractBetween(committed, emStart, emEnd);

console.log('TransactionCard found:', !!transactionCard);
console.log('AddModal found:', !!addModal);
console.log('ExportModal found:', !!exportModal);

if (!transactionCard || !addModal || !exportModal) {
  // Try with \r\n
  const tcStartCR = tcStart.replace(/\n/g, '\r\n');
  const tcEndCR = tcEnd.replace(/\n/g, '\r\n');
  transactionCard = extractBetween(committed, tcStartCR, tcEndCR);
  
  const amStartCR = amStart.replace(/\n/g, '\r\n');
  const amEndCR = amEnd.replace(/\n/g, '\r\n');
  addModal = extractBetween(committed, amStartCR, amEndCR);
  
  const emStartCR = emStart.replace(/\n/g, '\r\n');
  const emEndCR = emEnd.replace(/\n/g, '\r\n');
  exportModal = extractBetween(committed, emStartCR, emEndCR);
  
  console.log('With CRLF:');
  console.log('TransactionCard found:', !!transactionCard);
  console.log('AddModal found:', !!addModal);
  console.log('ExportModal found:', !!exportModal);
}
