import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronRight, Download, FileUp, Search } from 'lucide-react'
import * as XLSX from 'xlsx'
import { parseEodPaymentReport } from './lib/parser'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

function exportXlsx(rows, reportMonth, reportPayerTotal, fileName) {
  const sheetRows = rows.map((row) => ({
    Patient: row.patient,
    'Insurance Payments Made in Month': row.insurancePayments,
    'Patient Payments Made in Month': row.patientPayments,
  }))

  const workbook = XLSX.utils.book_new()
  const mainSheet = XLSX.utils.json_to_sheet(sheetRows)
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['Report Month', reportMonth || ''],
    ['Report Payer Total', reportPayerTotal ?? ''],
    ['Patients Returned', rows.length],
  ])

  XLSX.utils.book_append_sheet(workbook, mainSheet, 'Results')
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')
  XLSX.writeFile(workbook, `${fileName || 'payments-results'}.xlsx`)
}

export default function App() {
  const [rows, setRows] = useState([])
  const [expanded, setExpanded] = useState({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reportMonth, setReportMonth] = useState('')
  const [reportPayerTotal, setReportPayerTotal] = useState(null)
  const [difference, setDifference] = useState(null)
  const [fileBaseName, setFileBaseName] = useState('march-payments-results')

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => row.patient.toLowerCase().includes(query))
  }, [rows, search])

  const totals = useMemo(() => {
    return {
      insurance: rows.reduce((sum, row) => sum + row.insurancePayments, 0),
      patient: rows.reduce((sum, row) => sum + row.patientPayments, 0),
      patients: rows.length,
      insurancePatients: rows.filter((row) => row.insurancePayments > 0).length,
      patientPaidPatients: rows.filter((row) => row.patientPayments > 0).length,
    }
  }, [rows])

  async function handleUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return

    setLoading(true)
    setError('')
    setRows([])
    setExpanded({})
    setFileBaseName(file.name.replace(/\.pdf$/i, ''))

    try {
      const result = await parseEodPaymentReport(file)
      setRows(result.rows)
      setReportMonth(result.reportMonth)
      setReportPayerTotal(result.reportPayerTotal)
      setDifference(result.difference)
    } catch (err) {
      console.error(err)
      setError('The PDF could not be parsed. This build is tuned for the EOD payment-report format used in this workflow.')
    } finally {
      setLoading(false)
    }
  }

  function toggleRow(patient) {
    setExpanded((current) => ({ ...current, [patient]: !current[patient] }))
  }

  return (
    <div className="app-shell">
      <div className="page-wrap">
        <motion.section className="hero-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <div>
            <div className="eyebrow">Ready for testing</div>
            <h1>March Payments Reconciliation</h1>
            <p>
              Upload the EOD payment PDF and the app will return the same style of results from this chat:
              <strong> Patient | Insurance Payments Made in Month | Patient Payments Made in Month</strong>.
            </p>
          </div>
          <label className="upload-button">
            <FileUp size={18} />
            <span>{loading ? 'Processing...' : 'Upload PDF'}</span>
            <input type="file" accept="application/pdf" onChange={handleUpload} hidden />
          </label>
        </motion.section>

        {error ? <div className="error-banner">{error}</div> : null}

        {rows.length > 0 ? (
          <>
            <section className="stats-grid">
              <StatCard label="Patients Returned" value={String(totals.patients)} sublabel={reportMonth || 'Report month'} />
              <StatCard label="Insurance Payments Parsed" value={currency.format(totals.insurance)} sublabel={`${totals.insurancePatients} patients with insurance payments`} />
              <StatCard label="Patient Payments Parsed" value={currency.format(totals.patient)} sublabel={`${totals.patientPaidPatients} patients with patient payments`} />
              <StatCard label="Report Payer Total" value={reportPayerTotal != null ? currency.format(reportPayerTotal) : 'Not found'} sublabel={difference != null ? `Difference: ${currency.format(difference)}` : 'From summary page'} />
            </section>

            <section className="table-card">
              <div className="table-toolbar">
                <div>
                  <h2>Results</h2>
                  <p>Insurance payments are sourced from the report’s payment pages only. Patient payments are grouped for those same patients.</p>
                </div>
                <div className="toolbar-actions">
                  <div className="search-box">
                    <Search size={16} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient" />
                  </div>
                  <button className="export-button" onClick={() => exportXlsx(filteredRows, reportMonth, reportPayerTotal, fileBaseName)}>
                    <Download size={16} />
                    Export XLSX
                  </button>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="expand-col"></th>
                      <th>Patient</th>
                      <th className="num">Insurance Payments Made in Month</th>
                      <th className="num">Patient Payments Made in Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const isOpen = !!expanded[row.patient]
                      return (
                        <FragmentRow
                          key={row.patient}
                          row={row}
                          isOpen={isOpen}
                          onToggle={() => toggleRow(row.patient)}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}

        {!loading && rows.length === 0 ? (
          <section className="empty-card">
            <h2>No extra input needed</h2>
            <p>Once you upload the finished PDF, the app will process it and return the combined results table automatically.</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function StatCard({ label, value, sublabel }) {
  return (
    <motion.div className="stat-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sublabel">{sublabel}</div>
    </motion.div>
  )
}

function FragmentRow({ row, isOpen, onToggle }) {
  return (
    <>
      <tr>
        <td className="expand-col">
          <button className="icon-button" onClick={onToggle}>
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="patient-name">{row.patient}</td>
        <td className="num strong">{currency.format(row.insurancePayments)}</td>
        <td className="num strong">{currency.format(row.patientPayments)}</td>
      </tr>
      {isOpen ? (
        <tr className="detail-row">
          <td colSpan={4}>
            <div className="detail-grid">
              <DetailPanel title="Insurance lines" items={row.insuranceLines} />
              <DetailPanel title="Patient lines" items={row.patientLines} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function DetailPanel({ title, items }) {
  return (
    <div className="detail-panel">
      <div className="detail-header">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      {items.length === 0 ? <p className="empty-detail">No lines found.</p> : null}
      {items.map((item, index) => (
        <div className="detail-item" key={`${title}-${index}`}>
          <div className="detail-topline">
            <span>Page {item.pageNumber}</span>
            <strong>{currency.format(item.amount)}</strong>
          </div>
          <div className="detail-raw">{item.raw}</div>
        </div>
      ))}
    </div>
  )
}
