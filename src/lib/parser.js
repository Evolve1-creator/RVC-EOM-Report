import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const moneyRegex = /\$?\-?\d{1,3}(?:,\d{3})*\.\d{2}/g

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function normalizeWhitespace(value) {
  return (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizePatientName(value) {
  return normalizeWhitespace(value)
    .replace(/\s+,/g, ',')
    .replace(/,\s+/g, ', ')
    .replace(/\s+/g, ' ')
}

function parseMoney(value) {
  if (!value) return null
  const parsed = Number(String(value).replace(/[$,]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function lineText(line) {
  return normalizeWhitespace(line.items.map((item) => item.str).join(' '))
}

function groupItemsToLines(items) {
  const usable = items
    .filter((item) => normalizeWhitespace(item.str))
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height,
    }))
    .sort((a, b) => {
      if (Math.abs(b.y - a.y) > 2) return b.y - a.y
      return a.x - b.x
    })

  const lines = []

  usable.forEach((item) => {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= 2.5)
    if (existing) {
      existing.items.push(item)
    } else {
      lines.push({ y: item.y, items: [item] })
    }
  })

  lines.forEach((line) => {
    line.items.sort((a, b) => a.x - b.x)
  })

  return lines.sort((a, b) => b.y - a.y)
}

function getPageText(lines) {
  return lines.map((line) => lineText(line)).join('\n')
}

function extractReportMonth(fullText) {
  const match = fullText.match(/End-of-Day Report - Summary\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i)
  if (!match) return ''
  const monthIndex = Number(match[1]) - 1
  const year = match[6].length === 2 ? `20${match[6]}` : match[6]
  return `${MONTHS[monthIndex]} ${year}`
}

function extractReportPayerTotal(fullText) {
  const tailIndex = fullText.lastIndexOf('Payment Summary')
  const segment = tailIndex >= 0 ? fullText.slice(tailIndex) : fullText
  const lines = segment.split(/\r?\n/).map(normalizeWhitespace).filter(Boolean)

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === 'Payer') {
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j += 1) {
        const m = lines[j].match(moneyRegex)
        if (m && m.length) {
          const candidate = parseMoney(m[m.length - 1])
          if (candidate && candidate > 0) return candidate
        }
      }
    }

    if (/^Total:/i.test(line)) {
      const m = line.match(moneyRegex)
      if (m && m.length >= 2) {
        const candidate = parseMoney(m[1])
        if (candidate && candidate > 0) return candidate
      }
    }
  }

  const matches = [...segment.matchAll(/\$\d{1,3}(?:,\d{3})*\.\d{2}/g)].map((m) => parseMoney(m[0]))
  return matches.length ? Math.max(...matches) : null
}

function isPaymentsPage(lines) {
  const top = lines.slice(0, 20).map((line) => lineText(line)).join(' ')
  return /Patient\s+Patient Payments\s+Payer Payments\s+Total Payments/i.test(top)
}

function parsePaymentsPage(lines, pageNumber) {
  const parsedRows = []
  const details = []
  let started = false
  let pendingName = ''

  for (const line of lines) {
    const text = lineText(line)
    if (!text) continue

    if (/Patient\s+Patient Payments\s+Payer Payments\s+Total Payments/i.test(text)) {
      started = true
      continue
    }

    if (!started) continue

    if (/^(End-of-Day Report|Rogue Valley Chiropractic Clinic|Print Date|By Service Provider|\*This report)/i.test(text)) continue
    if (/^(Payments for|Charges for|Payment Summary|Patient Totals:|Payer Totals:|Total:|Discount:|Deposits)/i.test(text)) break

    const moneyMatches = [...text.matchAll(moneyRegex)].map((m) => m[0])

    if (moneyMatches.length >= 3) {
      const [patientPaymentsRaw, payerPaymentsRaw] = moneyMatches
      const patientPayments = parseMoney(patientPaymentsRaw) ?? 0
      const payerPayments = parseMoney(payerPaymentsRaw) ?? 0

      let patient = text.replace(moneyRegex, '').trim()
      patient = normalizePatientName(patient)
      if (!patient && pendingName) patient = pendingName
      if (!patient) continue

      pendingName = ''
      parsedRows.push({ patient, patientPayments, payerPayments, pageNumber, raw: text })
      details.push({ patient, patientPayments, payerPayments, pageNumber, raw: text })
      continue
    }

    if (!moneyMatches.length && /,/.test(text) && !/^(Patient|Payer|Total)/i.test(text)) {
      pendingName = pendingName ? normalizePatientName(`${pendingName} ${text}`) : normalizePatientName(text)
    }
  }

  return { parsedRows, details }
}

export async function parseEodPaymentReport(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pageDetails = []
  let fullText = ''

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const lines = groupItemsToLines(textContent.items)
    const text = getPageText(lines)
    fullText += `\n${text}\n`

    if (isPaymentsPage(lines)) {
      pageDetails.push({ pageNumber, ...parsePaymentsPage(lines, pageNumber) })
    }
  }

  const patients = new Map()

  pageDetails.forEach((page) => {
    page.parsedRows.forEach((row) => {
      const key = normalizePatientName(row.patient)
      if (!patients.has(key)) {
        patients.set(key, {
          patient: key,
          insurancePayments: 0,
          patientPayments: 0,
          insuranceLines: [],
          patientLines: [],
        })
      }
      const bucket = patients.get(key)

      if (row.payerPayments > 0) {
        bucket.insurancePayments += row.payerPayments
        bucket.insuranceLines.push({
          pageNumber: row.pageNumber,
          amount: row.payerPayments,
          raw: row.raw,
        })
      }

      if (row.patientPayments > 0) {
        bucket.patientPayments += row.patientPayments
        bucket.patientLines.push({
          pageNumber: row.pageNumber,
          amount: row.patientPayments,
          raw: row.raw,
        })
      }
    })
  })

  const rows = [...patients.values()]
    .map((row) => ({
      ...row,
      insurancePayments: round2(row.insurancePayments),
      patientPayments: round2(row.patientPayments),
    }))
    .filter((row) => row.insurancePayments > 0 || row.patientPayments > 0)
    .sort((a, b) => a.patient.localeCompare(b.patient))

  const totalInsurancePayments = round2(rows.reduce((sum, row) => sum + row.insurancePayments, 0))
  const totalPatientPayments = round2(rows.reduce((sum, row) => sum + row.patientPayments, 0))
  const reportPayerTotal = extractReportPayerTotal(fullText)
  const reportMonth = extractReportMonth(fullText)

  return {
    rows,
    totals: {
      insurance: totalInsurancePayments,
      patient: totalPatientPayments,
      patients: rows.length,
      patientPayers: rows.filter((row) => row.insurancePayments > 0).length,
      patientPaid: rows.filter((row) => row.patientPayments > 0).length,
    },
    reportMonth,
    reportPayerTotal,
    difference: reportPayerTotal != null ? round2(reportPayerTotal - totalInsurancePayments) : null,
  }
}
