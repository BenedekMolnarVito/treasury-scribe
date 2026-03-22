const fs = require('fs');

const committed = fs.readFileSync('src/components/TransactionsPage.tsx', 'utf8');
const part1 = fs.readFileSync('_page_part1.txt', 'utf8');
const part2 = fs.readFileSync('_page_part2.txt', 'utf8');

function extractBetween(text, startMarker, endMarker) {
  const s = startMarker.replace(/\n/g, '\r\n');
  const e = endMarker.replace(/\n/g, '\r\n');
  const si = text.indexOf(s);
  const ei = text.indexOf(e, si + s.length);
  if (si === -1 || ei === -1) return null;
  return text.substring(si, ei);
}

const NL = '\r\n';
const tcMarker = '// ---------------------------------------------------------------------------' + NL + '// TransactionCard';
const amMarker = NL + '// ---------------------------------------------------------------------------' + NL + '// AddTransactionModal';
const emMarker = NL + '// ---------------------------------------------------------------------------' + NL + '// ExportModal';
const pcMarker = NL + '// ---------------------------------------------------------------------------' + NL + '// TransactionsPageContent';

let transactionCard = extractBetween(committed, tcMarker, amMarker);
let addModal = extractBetween(committed, amMarker.substring(NL.length), emMarker);
let exportModal = extractBetween(committed, emMarker.substring(NL.length), pcMarker);

// Fix TransactionCard to use dark theme colors
// The committed version might reference old color constants, but since we redefine them above it should be fine
// However, the committed card uses inline styles that might differ from the dark theme
// Let me check if it has the dark theme card style
const hasDarkCard = transactionCard.includes('#E0E0E0');
console.log('Card has dark theme:', hasDarkCard);

// The committed TransactionCard uses inline styles with background variable referencing BG_UNTAGGED/BG_TAGGED
// which we've redefined, so the card component should work with new colors.
// But the committed version might not have the "color: #E0E0E0" for text.
// Let me update the card to use dark theme colors:

// Update the card face style to add dark text color
if (!hasDarkCard) {
  transactionCard = transactionCard
    .replace('cursor: "pointer",', 'cursor: "pointer",' + NL + '          color: "#E0E0E0",');
}

// Now write the file, but I need the remaining parts:
// 1. TagFilterSection (new)
// 2. TransactionsPageContent (modified)  
// 3. TransactionsPage wrapper (same structure)

// Extract TransactionsPageContent and wrapper from committed
const pcEnd = NL + '// ---------------------------------------------------------------------------' + NL + '// TransactionsPage  (public export';
let pageContent = extractBetween(committed, pcMarker.substring(NL.length), pcEnd);
const wpMarker = pcEnd.substring(NL.length);
const wpEndStr = 'export default TransactionsPage;';
const wpStart = committed.indexOf(wpMarker.replace(/\n/g, '\r\n'));
const wpEnd = committed.indexOf(wpEndStr.replace(/\n/g, '\r\n'));
let pageWrapper = committed.substring(wpStart, wpEnd + wpEndStr.length);

console.log('PageContent found:', !!pageContent);
console.log('PageWrapper found:', !!pageWrapper);
console.log('PageWrapper length:', pageWrapper ? pageWrapper.length : 0);

// Write intermediate state for verification
fs.writeFileSync('_extracted.json', JSON.stringify({
  tc: transactionCard ? transactionCard.length : 0,
  am: addModal ? addModal.length : 0,
  em: exportModal ? exportModal.length : 0,
  pc: pageContent ? pageContent.length : 0,
  pw: pageWrapper ? pageWrapper.length : 0,
}));

console.log('Extraction complete');
