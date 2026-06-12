# SalesLens

SalesLens is a native macOS SwiftUI app for importing POS files, storing sales records locally, and comparing monthly or yearly sales across multiple customers.

## Current Features

- Import one or more CSV files from POS exports.
- Import Excel monthly reports like `Sept 1 24.xls` and `Sept 1 24.xlsx`.
- Flexible header matching for common columns:
  - Customer: `Customer`, `Customer Name`, `Account`, `Retailer`, `Store`, `Location`
  - Date: `Date`, `Sales Date`, `Transaction Date`, `Month`, `Period`
  - Sales: `Sales`, `Net Sales`, `Gross Sales`, `Revenue`, `Amount`, `Total`
  - Units: `Units`, `Quantity`, `Qty`, `Items Sold`
- Local JSON persistence in Application Support.
- Customer sidebar filter.
- Monthly and yearly chart comparison.
- Monthly upload tracking with received date, sales month, row count, units, sales, and source file.
- Duplicate and blank-month import warnings.
- KPI cards for total sales, transactions, units, and average row value.
- Imported record table with source file tracking.

## Open and Run

1. Install Xcode or the Xcode Command Line Tools.
2. Open `SalesLens.xcodeproj`.
3. Select the `SalesLens` scheme.
4. Press `Command-R`.

You can use `SamplePOSData.csv` to test the import flow.

## Notes

The first version expects CSV data with one sales amount per row. Date values can be daily dates such as `2026-02-15` or month values such as `Feb 2026` or `2026-02`.

## Monthly Upload Workflow

Each month, import the POS file received on the first day of the month. SalesLens treats the file name as the received date and records the sales under the prior completed month.

Examples:

- `May 1 25.xls` imports as April 2025 sales.
- `Sept 1 24.xls` imports as August 2024 sales.

If the same monthly file or sales month has already been imported, SalesLens warns and does not add duplicate rows. If a monthly file has no product rows, SalesLens warns that the file was blank.

For the HanesBrands monthly Excel format, SalesLens maps the columns this way:

- Customer: derived from the sheet name, such as `MonthlyHanesBrandsSalesandInve` -> `HanesBrands`.
- Sales period: derived from the received file name by subtracting one month. Example: `Sept 1 24.xls` was received September 1, 2024, so it imports as August 2024 sales.
- Monthly sales amount: `MTD ($)`.
- Monthly units: `MTD (U)`.
- Product detail: `Class`, `Master Style`, `Color`, `Size`, and `Style Colour #`.
- `Style Colour #` is parsed as the real product identifier, not a description. Example: `C3002940APC03766474` -> style `C3002`, color code `940`, art code `APC03766474`.
- Color splitting uses known Champion and Gear color codes from the 2026 catalogs first, then falls back to a simple legacy split for older/discontinued styles.
- Optional context retained for later reporting: `Last Rc'vd`, `Current Retail`, `YTD (U)`, `YTD ($)`, `Inv (U)`, and `Inv $ @ Retail`.
