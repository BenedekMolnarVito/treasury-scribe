import { readFileSync, writeFileSync } from "fs";

const SRC = "C:/Users/molna/VSCodeRepos/treasury-scribe/src/components/TransactionsPage.tsx";
const COMP = "C:/Users/molna/VSCodeRepos/treasury-scribe/_revolut_comps.txt";

let c = readFileSync(SRC, "utf-8");
const comps = readFileSync(COMP, "utf-8");
const EOL = c.includes("\r\n") ? "\r\n" : "\n";

// STEP 1: import
c = c.replace('import { useTransactions } from "../hooks/useTransactions";',
  'import { useTransactions } from "../hooks/useTransactions";' + EOL + 'import { importRevolutCsv } from "../services/RevolutImportService";');
console.log("1:", c.includes("importRevolutCsv"));

// STEP 2: state
c = c.replace(
  '  const [showExportModal, setShowExportModal] = useState(false);',
  '  const [showExportModal, setShowExportModal] = useState(false);' + EOL +
  '  const [showRevolutImport, setShowRevolutImport] = useState(false);' + EOL +
  '  const [revolutImportResult, setRevolutImportResult] = useState<{ imported: number; skipped: number } | null>(null);'
);
console.log("2:", c.includes("showRevolutImport"));

// STEP 3: button
const btnAnchor = '        <button onClick={handleExport} aria-label="Export">';
const newBtn = [
  '        <button',
  '          style={{',
  '            background: "#FF5722",',
  '            color: "#FFFFFF",',
  '            border: "none",',
  '            borderRadius: "6px",',
  '            padding: "8px 12px",',
  '            cursor: "pointer",',
  '            fontWeight: "bold",',
  '          }}',
  '          onClick={() => setShowRevolutImport(true)}',
  '          aria-label="Import Revolut"',
  '        >',
  '          📥 Import Revolut',
  '        </button>',
  btnAnchor,
].join(EOL);
c = c.replace(btnAnchor, newBtn);
console.log("3:", c.includes("Import Revolut"));

// STEP 4: modal rendering
const exportBlock = [
  '      {showExportModal && (',
  '        <ExportModal',
  '          onSelect={handleExportSelection}',
  '          onClose={() => setShowExportModal(false)}',
  '        />',
  '      )}',
  '    </>',
].join(EOL);

const withRevolutModals = [
  '      {showExportModal && (',
  '        <ExportModal',
  '          onSelect={handleExportSelection}',
  '          onClose={() => setShowExportModal(false)}',
  '        />',
  '      )}',
  '',
  '      {/* Revolut CSV import modal */}',
  '      {showRevolutImport && (',
  '        <RevolutImportModal',
  '          db={db}',
  '          onImported={(result) => {',
  '            setShowRevolutImport(false);',
  '            setRevolutImportResult(result);',
  '            if (onDatabaseChanged) onDatabaseChanged(db);',
  '            void loadTransactions();',
  '          }}',
  '          onClose={() => setShowRevolutImport(false)}',
  '        />',
  '      )}',
  '',
  '      {/* Import results modal */}',
  '      {revolutImportResult !== null && (',
  '        <ImportResultModal',
  '          result={revolutImportResult}',
  '          onClose={() => setRevolutImportResult(null)}',
  '        />',
  '      )}',
  '    </>',
].join(EOL);

c = c.replace(exportBlock, withRevolutModals);
console.log("4:", c.includes("RevolutImportModal"));

// STEP 5: component definitions
const marker5 = [
  '// ---------------------------------------------------------------------------',
  '// TransactionsPageContent  (requires db; always calls the hook)',
  '// ---------------------------------------------------------------------------',
].join(EOL);

let normalizedComps = comps.replace(/\\r\\n/g, '\\n').replace(/\\n/g, EOL);
c = c.replace(marker5, normalizedComps + EOL + marker5);
console.log("5:", c.includes("const RevolutImportModal"));

writeFileSync(SRC, c, 'utf-8');

// Verify
const v = readFileSync(SRC, 'utf-8');
console.log("Verified importRevolutCsv:", v.includes("importRevolutCsv"));
console.log("Verified RevolutImportModal:", v.includes("const RevolutImportModal"));
console.log("Verified ImportResultModal:", v.includes("const ImportResultModal"));
console.log("Verified Import Revolut btn:", v.includes("Import Revolut"));
console.log("Final size:", v.length);
