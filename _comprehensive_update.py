"""Comprehensive update script for TransactionsPage.tsx.
Applies dark theme colors AND adds the import UI (ImportModal, ImportResultModal).
"""
import pathlib

SRC = pathlib.Path(r"C:\Users\molna\VSCodeRepos\treasury-scribe\src\components\TransactionsPage.tsx")

content = SRC.read_text(encoding="utf-8")
lines = content.split("\n")
output = []
i = 0

while i < len(lines):
    line = lines[i]

    # ---- Fix color constants ----
    if line.strip() == 'const BG_UNTAGGED = "#FFFACD";':
        output.append('const BG_UNTAGGED = "#2A2A1A";')
        i += 1
        continue
    if line.strip() == 'const BG_TAGGED = "#90EE90";':
        output.append('const BG_TAGGED = "#1A2A1A";')
        i += 1
        continue
    if line.strip() == 'const COLOR_EXPENSE = "red";':
        output.append('const COLOR_EXPENSE = "#FF6B6B";')
        i += 1
        continue
    if line.strip() == '/** Dark green for income amounts. */':
        # Skip this comment line
        i += 1
        continue
    if line.strip() == 'const COLOR_INCOME = "#006400";':
        output.append('const COLOR_INCOME = "#4CAF50";')
        output.append('const COLOR_IMPORTED = "#4CAF50";')
        output.append('const COLOR_SKIPPED = "#888";')
        output.append('const COLOR_ERRORS = "#FFB300";')
        i += 1
        continue

    # ---- Fix doc comment about card backgrounds ----
    if " * - Card backgrounds: #FFFACD (untagged) / #90EE90 (tagged)." in line:
        output.append(line.replace("#FFFACD (untagged) / #90EE90 (tagged)", "#2A2A1A (untagged) / #1A2A1A (tagged)"))
        i += 1
        continue

    # ---- Fix doc comment about dark-green income ----
    if "dark-green income" in line:
        output.append(line.replace("dark-green income", "green income"))
        i += 1
        continue

    # ---- Add ImportService import after useTransactions ----
    if line.strip() == 'import { useTransactions } from "../hooks/useTransactions";':
        output.append(line)
        output.append('import { importTransactions } from "../services/ImportService";')
        output.append('import type { ImportResult } from "../services/ImportService";')
        i += 1
        continue

    # ---- Add feature note about Import in docstring ----
    if " * - Header buttons: Add Transaction, Refresh, Export, Clear All." in line:
        output.append(line.replace("Export, Clear All", "Export, Import, Clear All"))
        i += 1
        continue

    # ---- Insert ImportModal and ImportResultModal before TransactionsPageContent ----
    if line.strip() == "// TransactionsPageContent  (requires db; always calls the hook)":
        # Insert component definitions
        output.append("// ImportModal")
        output.append("// ---------------------------------------------------------------------------")
        output.append("")
        output.append("interface ImportModalProps {")
        output.append("  db: Database;")
        output.append("  onImported: (result: ImportResult) => void;")
        output.append("  onClose: () => void;")
        output.append("}")
        output.append("")
        output.append("const ImportModal: React.FC<ImportModalProps> = ({ db, onImported, onClose }) => {")
        output.append("  const [selectedFile, setSelectedFile] = useState<File | null>(null);")
        output.append("  const fileInputRef = useRef<HTMLInputElement>(null);")
        output.append("")
        output.append("  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {")
        output.append("    if (e.target === e.currentTarget) onClose();")
        output.append("  };")
        output.append("")
        output.append("  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {")
        output.append("    const file = e.target.files?.[0] ?? null;")
        output.append("    setSelectedFile(file);")
        output.append("  };")
        output.append("")
        output.append("  const handleImport = (): void => {")
        output.append("    if (!selectedFile) return;")
        output.append("")
        output.append("    const reader = new FileReader();")
        output.append("    reader.onload = () => {")
        output.append("      try {")
        output.append("        const fileContent = reader.result as string;")
        output.append("        const result = importTransactions(db, fileContent);")
        output.append("        onImported(result);")
        output.append("      } catch (err: unknown) {")
        output.append('        const message = err instanceof Error ? err.message : String(err);')
        output.append('        window.alert("Import failed: " + message);')
        output.append("      }")
        output.append("    };")
        output.append("    reader.onerror = () => {")
        output.append('      window.alert("Failed to read file.");')
        output.append("    };")
        output.append("    reader.readAsText(selectedFile);")
        output.append("  };")
        output.append("")
        output.append("  return (")
        output.append("    <div")
        output.append('      role="dialog"')
        output.append('      aria-modal="true"')
        output.append('      aria-label="Import transactions"')
        output.append("      style={{")
        output.append('        position: "fixed",')
        output.append("        inset: 0,")
        output.append('        background: "rgba(0,0,0,0.7)",')
        output.append('        display: "flex",')
        output.append('        alignItems: "center",')
        output.append('        justifyContent: "center",')
        output.append("        zIndex: 1000,")
        output.append("      }}")
        output.append("      onClick={handleBackdropClick}")
        output.append("    >")
        output.append("      <div")
        output.append("        style={{")
        output.append('          background: "#1E1E1E",')
        output.append('          color: "#E0E0E0",')
        output.append("          padding: 24,")
        output.append("          borderRadius: 12,")
        output.append("          minWidth: 280,")
        output.append('          display: "flex",')
        output.append('          flexDirection: "column",')
        output.append("          gap: 12,")
        output.append("        }}")
        output.append("      >")
        output.append('        <h2 style={{ margin: 0, color: "#FFFFFF" }}>Import Transactions</h2>')
        output.append('        <p style={{ margin: 0, color: "#B0B0B0" }}>')
        output.append("          Import from a previously exported JSON or CSV file.")
        output.append("        </p>")
        output.append('        <div style={{ background: "#2A2A2A", border: "1px solid #444", borderRadius: "6px", padding: 12 }}>')
        output.append("          <input")
        output.append("            ref={fileInputRef}")
        output.append('            type="file"')
        output.append('            accept=".json,.csv"')
        output.append("            onChange={handleFileChange}")
        output.append('            style={{ display: "none" }}')
        output.append('            data-testid="import-file-input"')
        output.append("          />")
        output.append("          <button")
        output.append('            type="button"')
        output.append('            style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}')
        output.append("            onClick={() => fileInputRef.current?.click()}")
        output.append("          >")
        output.append("            Choose File")
        output.append("          </button>")
        output.append("          {selectedFile && (")
        output.append('            <span style={{ marginLeft: 8, color: "#E0E0E0" }}>')
        output.append("              {selectedFile.name}")
        output.append("            </span>")
        output.append("          )}")
        output.append("        </div>")
        output.append('        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>')
        output.append("          <button")
        output.append('            type="button"')
        output.append('            style={{ background: "#333", color: "#E0E0E0", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}')
        output.append("            onClick={onClose}")
        output.append("          >")
        output.append("            Cancel")
        output.append("          </button>")
        output.append("          <button")
        output.append('            type="button"')
        output.append('            style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}')
        output.append("            onClick={handleImport}")
        output.append("            disabled={!selectedFile}")
        output.append('            aria-label="Import"')
        output.append("          >")
        output.append("            Import")
        output.append("          </button>")
        output.append("        </div>")
        output.append("      </div>")
        output.append("    </div>")
        output.append("  );")
        output.append("};")
        output.append("")
        output.append("// ---------------------------------------------------------------------------")
        output.append("// ImportResultModal")
        output.append("// ---------------------------------------------------------------------------")
        output.append("")
        output.append("interface ImportResultModalProps {")
        output.append("  result: ImportResult;")
        output.append("  onClose: () => void;")
        output.append("}")
        output.append("")
        output.append("const ImportResultModal: React.FC<ImportResultModalProps> = ({")
        output.append("  result,")
        output.append("  onClose,")
        output.append("}) => {")
        output.append("  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {")
        output.append("    if (e.target === e.currentTarget) onClose();")
        output.append("  };")
        output.append("")
        output.append("  return (")
        output.append("    <div")
        output.append('      role="dialog"')
        output.append('      aria-modal="true"')
        output.append('      aria-label="Import complete"')
        output.append("      style={{")
        output.append('        position: "fixed",')
        output.append("        inset: 0,")
        output.append('        background: "rgba(0,0,0,0.7)",')
        output.append('        display: "flex",')
        output.append('        alignItems: "center",')
        output.append('        justifyContent: "center",')
        output.append("        zIndex: 1000,")
        output.append("      }}")
        output.append("      onClick={handleBackdropClick}")
        output.append("    >")
        output.append("      <div")
        output.append("        style={{")
        output.append('          background: "#1E1E1E",')
        output.append('          color: "#E0E0E0",')
        output.append("          padding: 24,")
        output.append("          borderRadius: 12,")
        output.append("          minWidth: 280,")
        output.append('          display: "flex",')
        output.append('          flexDirection: "column",')
        output.append("          gap: 12,")
        output.append("        }}")
        output.append("      >")
        output.append('        <h2 style={{ margin: 0, color: "#FFFFFF" }}>Import Complete \u2713</h2>')
        output.append('        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>')
        output.append("          <span style={{ color: COLOR_IMPORTED }}>")
        output.append("            \u2705 {result.imported} transactions imported")
        output.append("          </span>")
        output.append("          <span style={{ color: COLOR_SKIPPED }}>")
        output.append("            \u23ed\ufe0f {result.skipped} duplicates skipped")
        output.append("          </span>")
        output.append("          {result.errors.length > 0 && (")
        output.append("            <span style={{ color: COLOR_ERRORS }}>")
        output.append("              \u26a0\ufe0f {result.errors.length} errors")
        output.append("            </span>")
        output.append("          )}")
        output.append("        </div>")
        output.append('        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>')
        output.append("          <button")
        output.append('            type="button"')
        output.append('            style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}')
        output.append("            onClick={onClose}")
        output.append("          >")
        output.append("            OK")
        output.append("          </button>")
        output.append("        </div>")
        output.append("      </div>")
        output.append("    </div>")
        output.append("  );")
        output.append("};")
        output.append("")
        output.append("// ---------------------------------------------------------------------------")
        # Now output the original line
        output.append(line)
        i += 1
        continue

    # ---- Add import state after showExportModal ----
    if line.strip() == "const [showExportModal, setShowExportModal] = useState(false);":
        output.append(line)
        output.append("  const [showImportModal, setShowImportModal] = useState(false);")
        output.append("  const [importResult, setImportResult] = useState<ImportResult | null>(null);")
        i += 1
        continue

    # ---- Add handleImported before handleClearAll ----
    if line.strip() == "const handleClearAll = useCallback((): void => {":
        output.append("  const handleImported = useCallback(")
        output.append("    (result: ImportResult): void => {")
        output.append("      setShowImportModal(false);")
        output.append("      setImportResult(result);")
        output.append("      if (onDatabaseChanged) onDatabaseChanged(db);")
        output.append("      void loadTransactions();")
        output.append("    },")
        output.append("    [db, loadTransactions, onDatabaseChanged]")
        output.append("  );")
        output.append("")
        output.append(line)
        i += 1
        continue

    # ---- Add Import button after Export button ----
    if line.strip() == '<button onClick={handleExport} aria-label="Export">':
        output.append(line)
        # Output the next two lines (Export text and close tag)
        i += 1
        output.append(lines[i])  # "          Export"
        i += 1
        output.append(lines[i])  # "        </button>"
        # Now add Import button
        output.append("        <button")
        output.append("          onClick={() => setShowImportModal(true)}")
        output.append('          aria-label="Import"')
        output.append('          style={{ background: "#1565C0", color: "#FFFFFF", border: "none", borderRadius: "6px", padding: "8px 14px", fontSize: "0.9em", cursor: "pointer" }}')
        output.append("        >")
        output.append("          Import")
        output.append("        </button>")
        i += 1
        continue

    # ---- Add import modals before closing </> of TransactionsPageContent ----
    # Look for the pattern: showExportModal && ( ... </> which ends the content
    if line.strip() == "</>" and i > 0:
        # Check if this is inside TransactionsPageContent (after ExportModal)
        # Look back a few lines for the ExportModal closing
        lookback = "\n".join(lines[max(0, i-8):i])
        if "showExportModal" in lookback:
            output.append("")
            output.append("      {showImportModal && (")
            output.append("        <ImportModal")
            output.append("          db={db}")
            output.append("          onImported={handleImported}")
            output.append("          onClose={() => setShowImportModal(false)}")
            output.append("        />")
            output.append("      )}")
            output.append("")
            output.append("      {importResult && (")
            output.append("        <ImportResultModal")
            output.append("          result={importResult}")
            output.append("          onClose={() => setImportResult(null)}")
            output.append("        />")
            output.append("      )}")
            output.append(line)
            i += 1
            continue

    # ---- Remove NODE_TEST_MARKER ----
    if line.strip() == "// NODE_TEST_MARKER":
        i += 1
        continue

    # Default: keep line as-is
    output.append(line)
    i += 1

result = "\n".join(output)
SRC.write_text(result, encoding="utf-8")

# Verification
v = SRC.read_text(encoding="utf-8")
checks = {
    "BG_UNTAGGED #2A2A1A": '#2A2A1A' in v,
    "BG_TAGGED #1A2A1A": '#1A2A1A' in v,
    "COLOR_EXPENSE #FF6B6B": '#FF6B6B' in v,
    "COLOR_INCOME #4CAF50": '#4CAF50' in v,
    "importTransactions import": 'import { importTransactions }' in v,
    "ImportResult type import": 'import type { ImportResult }' in v,
    "ImportModal component": 'const ImportModal:' in v,
    "ImportResultModal component": 'const ImportResultModal:' in v,
    "showImportModal state": 'showImportModal' in v,
    "handleImported callback": 'handleImported' in v,
    "Import button aria-label": 'aria-label="Import"' in v,
    "ImportModal rendered": '<ImportModal' in v,
    "ImportResultModal rendered": '<ImportResultModal' in v,
    "No old FFFACD in constants": 'const BG_UNTAGGED = "#FFFACD"' not in v,
    "No old 90EE90 in constants": 'const BG_TAGGED = "#90EE90"' not in v,
}
all_ok = True
for desc, passed in checks.items():
    status = "OK" if passed else "FAIL"
    if not passed:
        all_ok = False
    print(f"  [{status}] {desc}")

print(f"\nTotal lines: {len(v.splitlines())}")
print(f"All checks passed: {all_ok}")