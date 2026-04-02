import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const styles = {
  page: { minHeight: "100vh", background: "#f8fafc", padding: 24, fontFamily: "Inter, Arial, sans-serif", color: "#0f172a" },
  wrap: { maxWidth: 1200, margin: "0 auto", display: "grid", gap: 20 },
  hero: { borderRadius: 24, padding: 28, background: "linear-gradient(135deg, #1d4ed8, #7c3aed)", color: "white", boxShadow: "0 12px 30px rgba(15,23,42,0.12)" },
  heroTitle: { fontSize: 30, fontWeight: 800, margin: 0 },
  heroText: { marginTop: 10, fontSize: 14, lineHeight: 1.5, maxWidth: 900, opacity: 0.95 },
  uploadButton: { display: "inline-flex", alignItems: "center", gap: 10, background: "white", color: "#0f172a", padding: "12px 16px", borderRadius: 16, fontWeight: 700, cursor: "pointer", border: "none", marginTop: 18 },
  cardGrid: { display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" },
  card: { background: "white", borderRadius: 22, padding: 20, boxShadow: "0 8px 24px rgba(15,23,42,0.08)" },
  cardTitle: { fontSize: 13, color: "#64748b", fontWeight: 600 },
  cardValue: { fontSize: 30, fontWeight: 800, marginTop: 8 },
  toolbar: { display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" },
  input: { minWidth: 260, padding: "12px 14px", borderRadius: 14, border: "1px solid #cbd5e1", fontSize: 14 },
  button: { padding: "12px 16px", borderRadius: 14, background: "#0f172a", color: "white", border: "none", fontWeight: 700, cursor: "pointer" },
  tableWrap: { background: "white", borderRadius: 22, boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: 13, color: "#475569", borderBottom: "1px solid #e2e8f0", padding: "14px 16px", background: "#f8fafc" },
  td: { padding: "14px 16px", borderBottom: "1px solid #e2e8f0", verticalAlign: "top" },
  right: { textAlign: "right" },
  small: { fontSize: 12, color: "#64748b" },
  note: { background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 16, padding: 14, fontSize: 13 },
  detailBox: { background: "#f8fafc", borderRadius: 14, padding: 12, marginTop: 8, fontSize: 12, color: "#334155" }
};

function normalizeWhitespace(value) { return (value || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim(); }
function normalizePatientName(value) { return normalizeWhitespace(value).replace(/\s+,/g, ",").replace(/,\s+/g, ", ").replace(/\s+/g, " ").trim(); }
function parseAmount(line) { const matches = [...line.matchAll(/-?\d{1,3}(?:,\d{3})*\.\d{2}/g)].map((m) => Number(m[0].replace(/,/g, ""))); return matches.length ? matches[matches.length - 1] : null; }
function parseDate(line) { const match = line.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/); return match ? match[0] : ""; }
function looksLikePatientName(line) {
  const text = normalizeWhitespace(line);
  if (!text) return false;
  if (/^(Payments for|Charges for|Payment Summary|Page \d+)/i.test(text)) return false;
  if (/\b(Payer Totals|Patient Totals|Office Totals|Transaction Totals|Total)\b/i.test(text)) return false;
  if (/\d{1,3}(?:,\d{3})*\.\d{2}/.test(text)) return false;
  return /^[A-Z][A-Za-z'\-]+,\s+[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+)*$/.test(text);
}
function isInsuranceLine(line) { return /\b(era|eft|payer|insurance|medicare|regence|aetna|allstate|farmers|state farm|usaa|samba|mutual of omaha|moda|aarp|aflac|bcbs|direct deposit|check)\b/i.test(line); }
function isPatientLine(line) { return /\b(patient|cash|visa|mastercard|discover|amex|credit card|debit card|copay|co-pay)\b/i.test(line); }
function round2(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function splitPages(text) { return text.split(/(?=Page\s+\d+)/i).map((x) => x.trim()).filter(Boolean); }
function extractReportPayerTotal(text) {
  const start = text.search(/Payment Summary/i);
  if (start === -1) return null;
  const chunk = text.slice(start, start + 4000);
  const lines = chunk.split(/\r?\n/).map(normalizeWhitespace).filter(Boolean);
  for (const line of lines) {
    if (/\bPayer\b/i.test(line) && /\d{1,3}(?:,\d{3})*\.\d{2}/.test(line)) {
      const nums = [...line.matchAll(/\d{1,3}(?:,\d{3})*\.\d{2}/g)].map((m) => Number(m[0].replace(/,/g, "")));
      if (nums.length) return nums[nums.length - 1];
    }
  }
  return null;
}
function parsePatientPayments(rawText) {
  const patients = new Map();
  const notes = [];
  let currentSection = "";
  let currentPatient = "";
  for (const page of splitPages(rawText)) {
    const lines = page.split(/\r?\n/).map(normalizeWhitespace).filter(Boolean);
    for (const line of lines) {
      if (/^Payments for\b/i.test(line)) { currentSection = "payments"; currentPatient = ""; continue; }
      if (/^Charges for\b/i.test(line)) { currentSection = "charges"; currentPatient = ""; continue; }
      if (currentSection !== "payments") continue;
      if (/\b(Payer Totals|Patient Totals|Office Totals|Transaction Totals)\b/i.test(line)) { currentPatient = ""; continue; }
      if (looksLikePatientName(line)) {
        currentPatient = normalizePatientName(line);
        if (!patients.has(currentPatient)) patients.set(currentPatient, { patient: currentPatient, insurancePayments: 0, patientPayments: 0, insuranceLines: [], patientLines: [] });
        continue;
      }
      if (!currentPatient) continue;
      const amount = parseAmount(line);
      if (amount == null) continue;
      const date = parseDate(line);
      const insurance = isInsuranceLine(line);
      const patient = isPatientLine(line);
      const row = patients.get(currentPatient);
      const detail = { date, amount, sourceLine: line };
      if (insurance && !patient) { row.insurancePayments += amount; row.insuranceLines.push(detail); }
      else if (patient && !insurance) { row.patientPayments += amount; row.patientLines.push(detail); }
    }
  }
  const rows = [...patients.values()].map((row) => ({ ...row, insurancePayments: round2(row.insurancePayments), patientPayments: round2(row.patientPayments) })).filter((row) => row.insurancePayments > 0 || row.patientPayments > 0).sort((a, b) => a.patient.localeCompare(b.patient));
  if (!rows.length) notes.push("No payment rows were detected. The parser expects the same EOD payment-report layout used in this chat.");
  return { rows, notes };
}
function exportRows(rows, fileBase) {
  const payload = rows.map((row) => ({ Patient: row.patient, "Insurance Payments Made in Month": row.insurancePayments, "Patient Payments Made in Month": row.patientPayments }));
  const ws = XLSX.utils.json_to_sheet(payload);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Payments");
  XLSX.writeFile(wb, `${fileBase || "rvc-eom-report"}.xlsx`);
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [reportPayerTotal, setReportPayerTotal] = useState(null);
  const filteredRows = useMemo(() => { const q = search.trim().toLowerCase(); return q ? rows.filter((row) => row.patient.toLowerCase().includes(q)) : rows; }, [rows, search]);
  const totals = useMemo(() => ({ insurance: round2(rows.reduce((sum, row) => sum + row.insurancePayments, 0)), patient: round2(rows.reduce((sum, row) => sum + row.patientPayments, 0)), count: rows.length }), [rows]);

  async function readPdfText(file) {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += `\nPage ${i}\n`;
      text += content.items.map((item) => item.str || "").join("\n");
      text += "\n";
    }
    return text;
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true); setError(""); setExpanded({}); setFileName(file.name.replace(/\.pdf$/i, ""));
    try {
      const text = await readPdfText(file);
      const parsed = parsePatientPayments(text);
      setRows(parsed.rows);
      setNotes(parsed.notes);
      setReportPayerTotal(extractReportPayerTotal(text));
    } catch (err) {
      console.error(err);
      setError("This PDF could not be parsed. This rebuild expects the same EOD payment-report format used in this chat.");
      setRows([]); setNotes([]); setReportPayerTotal(null);
    } finally { setLoading(false); }
  }
  function toggle(name) { setExpanded((prev) => ({ ...prev, [name]: !prev[name] })); }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.hero}>
          <h1 style={styles.heroTitle}>RVC EOM Report Parser</h1>
          <div style={styles.heroText}>Upload the EOD payment PDF and the app totals insurance payments made in the month by patient, then totals patient payments made in that same month for those same patients.</div>
          <label style={styles.uploadButton}><span>{loading ? "Processing..." : "Upload PDF"}</span><input type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleUpload} /></label>
        </div>
        {error ? <div style={styles.note}>{error}</div> : null}
        {!!rows.length && <>
          <div style={styles.cardGrid}>
            <div style={styles.card}><div style={styles.cardTitle}>Patients Found</div><div style={styles.cardValue}>{totals.count}</div></div>
            <div style={styles.card}><div style={styles.cardTitle}>Insurance Payments Parsed</div><div style={styles.cardValue}>{money.format(totals.insurance)}</div></div>
            <div style={styles.card}><div style={styles.cardTitle}>Patient Payments Parsed</div><div style={styles.cardValue}>{money.format(totals.patient)}</div></div>
            <div style={styles.card}><div style={styles.cardTitle}>Report Payer Total</div><div style={styles.cardValue}>{reportPayerTotal == null ? "—" : money.format(reportPayerTotal)}</div></div>
          </div>
          {notes.map((note, idx) => <div key={idx} style={styles.note}>{note}</div>)}
          <div style={styles.tableWrap}>
            <div style={{ padding: 18, ...styles.toolbar }}>
              <div><div style={{ fontWeight: 800, fontSize: 20 }}>Results</div><div style={styles.small}>Patient | Insurance Payments Made in Month | Patient Payments Made in Month</div></div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <input style={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient" />
                <button style={styles.button} onClick={() => exportRows(filteredRows, fileName)}>Export XLSX</button>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}><thead><tr><th style={styles.th}></th><th style={styles.th}>Patient</th><th style={{ ...styles.th, ...styles.right }}>Insurance Payments Made in Month</th><th style={{ ...styles.th, ...styles.right }}>Patient Payments Made in Month</th></tr></thead><tbody>
                {filteredRows.map((row) => {
                  const open = !!expanded[row.patient];
                  return <React.Fragment key={row.patient}><tr><td style={styles.td}><button style={{ ...styles.button, padding: "6px 10px", borderRadius: 10 }} onClick={() => toggle(row.patient)}>{open ? "−" : "+"}</button></td><td style={{ ...styles.td, fontWeight: 700 }}>{row.patient}</td><td style={{ ...styles.td, ...styles.right, fontWeight: 700 }}>{money.format(row.insurancePayments)}</td><td style={{ ...styles.td, ...styles.right, fontWeight: 700 }}>{money.format(row.patientPayments)}</td></tr>{open ? <tr><td colSpan={4} style={styles.td}><div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}><div style={styles.detailBox}><div style={{ fontWeight: 800, marginBottom: 8 }}>Insurance lines</div>{row.insuranceLines.length ? row.insuranceLines.map((item, idx) => <div key={idx} style={{ marginBottom: 8 }}><div><strong>{item.date || "No date"}</strong> — {money.format(item.amount)}</div><div>{item.sourceLine}</div></div>) : <div>No lines found.</div>}</div><div style={styles.detailBox}><div style={{ fontWeight: 800, marginBottom: 8 }}>Patient lines</div>{row.patientLines.length ? row.patientLines.map((item, idx) => <div key={idx} style={{ marginBottom: 8 }}><div><strong>{item.date || "No date"}</strong> — {money.format(item.amount)}</div><div>{item.sourceLine}</div></div>) : <div>No lines found.</div>}</div></div></td></tr> : null}</React.Fragment>;
                })}
              </tbody></table>
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}
