# March Payments Reconciliation App

This app is built for the EOD payment report format used in this workflow.

It extracts payment activity from the monthly EOD PDF and returns a table with:

- Patient
- Insurance Payments Made in Month
- Patient Payments Made in Month

## What it does

- uploads one EOD payment PDF
- parses the report payment pages
- groups payer payments by patient
- groups patient payments by the same patient
- shows the combined results table
- lets you expand each row to see the source lines
- exports the results to XLSX

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Notes

This build is intentionally tuned to the EOD monthly payment report layout used in this chat. If the clinic changes the report layout, parsing rules may need adjustment.
