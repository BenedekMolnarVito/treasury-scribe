const fs = require('fs');
const path = 'src/components/TransactionsPage.tsx';
let c = fs.readFileSync(path, 'utf8');

// 1. Add ActiveTagCount import
const oldImp = 'import { useTransactions } from "../hooks/useTransactions";';
const newImp = oldImp + '\nimport type { ActiveTagCount } from "../hooks/useTransactions";';
c = c.replace(oldImp, newImp);

// 2. Add filter styles
const styleClose = '  } as React.CSSProperties,\n} as const;';
const idx = c.lastIndexOf(styleClose);
if (idx === -1) { console.error('style close not found'); process.exit(1); }

const filterStyles = [
  '',
  '  filterToggleRow: {',
  '    display: "flex",',
  '    alignItems: "center",',
  '    gap: 8,',
  '    marginBottom: 8,',
  '    color: "#E0E0E0",',
  '    fontSize: "0.95em",',
  '  } as React.CSSProperties,',
  '',
  '  filterToggleButton: {',
  '    background: "#2A2A2A",',
  '    color: "#E0E0E0",',
  '    border: "1px solid #444",',
  '    borderRadius: "6px",',
  '    padding: "4px 10px",',
  '    fontSize: "0.85em",',
  '    cursor: "pointer",',
  '  } as React.CSSProperties,',
  '',
  '  filterSection: {',
  '    background: "#1A1A1A",',
  '    borderRadius: "8px",',
  '    padding: "12px",',
  '    marginBottom: "12px",',
  '  } as React.CSSProperties,',
  '',
  '  filterChipRow: {',
  '    display: "flex",',
  '    flexWrap: "wrap" as const,',
  '    gap: 8,',
  '    marginBottom: 8,',
  '  } as React.CSSProperties,',
  '',
  '  filterChip: {',
  '    background: "#2A2A2A",',
  '    border: "1px solid #444",',
  '    borderRadius: "16px",',
  '    padding: "6px 12px",',
  '    color: "#E0E0E0",',
  '    fontSize: "0.85em",',
  '    cursor: "pointer",',
  '  } as React.CSSProperties,',
  '',
  '  filterChipActive: {',
  '    background: "#1565C0",',
  '    border: "1px solid #1565C0",',
  '    borderRadius: "16px",',
  '    padding: "6px 12px",',
  '    color: "#FFFFFF",',
  '    fontSize: "0.85em",',
  '    cursor: "pointer",',
  '  } as React.CSSProperties,',
  '',
  '  filterStatusLine: {',
  '    fontSize: "0.85em",',
  '    color: "#888",',
  '    marginBottom: 8,',
  '  } as React.CSSProperties,',
  '',
  '  clearFiltersButton: {',
  '    background: "#333",',
  '    color: "#E0E0E0",',
  '    border: "1px solid #555",',
  '    borderRadius: "6px",',
  '    padding: "4px 10px",',
  '    fontSize: "0.85em",',
  '    cursor: "pointer",',
  '  } as React.CSSProperties,',
].join('\n');

c = c.substring(0, idx) + filterStyles + '\n' + styleClose + c.substring(idx + styleClose.length);

fs.writeFileSync(path, c, 'utf8');
console.log('Step 1-2 done. Size:', c.length);
console.log('ActiveTagCount:', c.includes('ActiveTagCount'));
console.log('filterChip:', c.includes('filterChip:'));
