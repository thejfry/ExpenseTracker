 
# Jeffrey & Lauren’s Money Review

A private, browser-based prototype for exploring category-level income and spending trends from a budgeting app's monthly category-summary CSV export.

## Run locally

Open `index.html` in a modern browser, then choose or drag in a CSV export. No server, account, build step, or dependency installation is required. The file is parsed locally in the browser; refreshing or closing the page clears the report.

Use **Export PDF** to open your browser's print dialog, where you can save the report as a PDF. The report uses CAD formatting and treats negative category amounts as expenses, displayed as positive spending.

## Report features

- Monthly net cash flow and latest-month income and spending summaries.
- Largest category changes between the latest three months and the previous three months.
- Monthly category charts, with parent categories and subcategories shown separately.
- Adjustable single-month spending flags, compared with each category's recent three-month average. Flags use a minimum increase of $50 as well as the selected percentage.
- Sustained-increase observations and current-month context.

The CSV should have a `Category` first column and month columns named like `Jan 2026`. Other aggregate columns such as `Total`, `Average`, or `Count` are ignored.
