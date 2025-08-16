# FinTrack Frontend — Revolut CSV Transformer (v0.1)

A lightweight web app to upload a Revolut CSV export, normalize its data, (optionally) classify categories with an LLM, **edit fields inline**, and download a clean CSV ready for analysis.

> **Key behaviors**
>
> - **Amount** is exported as a **positive** number with 2 decimals. The sign is carried by the **Type** column (`Expense` for negative original amounts, `Income` for non-negative).
> - **No header row** in the downloaded CSV (data lines only).
> - You can click cells to edit **Date**, **Category**, and **Notes**. Changes auto-save on **Enter** or **blur**, and the table auto-sorts by **Date**.

---

## Features

- Upload & parse **Revolut** CSV (supports EU and US numeric formats).
- Normalize to columns: `Date`, `Type`, `Amount`, `Currency`, `Category`, `Name`, `Account`, `Notes`, `Source`.
- **Inline editing** of `Date`, `Category`, `Notes` with auto-save + auto-sort by Date.
- **Filter** export: Both / Expense only / Income only.
- **LLM classification** (optional OpenAI API key) with safe heuristic fallback.
- **Headerless CSV** download (data only).
- Settings persisted to **localStorage**.

---

## Tech Stack

- **React 18 + Vite + TypeScript**
- **Tailwind CSS v4** via `@tailwindcss/vite`
- **PapaParse** for CSV parsing (with a simple fallback)
- No backend (API key stored locally in browser for this prototype)

---

## Getting Started

### Prerequisites

- **Node.js ≥ 22** (or ≥ 20.19.0)
- npm

### Install & Run

```bash
npm install
npm run dev
```

Open the printed URL (usually [http://localhost:5173](http://localhost:5173)).

### Build

```bash
npm run build
npm run preview
```

---

## Usage

1. **Settings → General**

   - **Website name** (used in `Source` column).
   - **Source** (currently “Revolut”).
   - **Date field**: `Completed Date` or `Started Date`.
   - Toggle **Completed only**.

2. **Settings → LLM (optional)**

   - Paste your **OpenAI API key** (stored locally in your browser).
   - Choose a model (e.g., `gpt-4o-mini`).

3. **Transform**

   - Upload your Revolut CSV.
   - Optionally click **Classify with LLM** (or rely on heuristics).
   - Use **Type** filter (Both / Expense / Income).
   - **Click cells** to edit `Date`, `Category`, `Notes`.

     - Press **Enter** or click elsewhere to auto-save.
     - Table re-sorts by `Date` after `Date` edits.

   - Click **Download CSV** (no header row).

---

## Expected Input (Revolut CSV)

The app expects these headers (case-sensitive):

```
Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance
```

Example row:

```
CARD_PAYMENT,Card,2025-08-01 08:15,2025-08-01 08:15,CONAD SUPERMARKET,-47,30,,EUR,COMPLETED,1234,56
```

> Notes:
>
> - EU style amounts like `-47,30` and `1.234,56` are supported.
> - US style `-47.30` and `1,234.56` are supported too.

---

## Output Schema (Normalized)

Order of columns in the exported CSV (no header line):

1. `Date` — `YYYY-MM-DD`
2. `Type` — `Expense` or `Income`
3. `Amount` — **positive** number with 2 decimals (e.g., `47.30`)
4. `Currency` — e.g., `EUR`
5. `Category` — from LLM or heuristics; editable
6. `Name` — original `Description`
7. `Account` — `Revolut`
8. `Notes` — user-editable free text
9. `Source` — website name from Settings

---

## Category Classification

- If an **OpenAI API key** is set, transaction names are sent to OpenAI for categorization into your `categorySet`.
- If not, a **heuristic** assigns categories (includes rules for Groceries, Subscriptions, Fuel, etc.).
- **Privacy note**: for production, proxy LLM calls through your own backend—do not expose secrets client-side.

---

## Editing & Saving

- Click a `Date`, `Category`, or `Notes` cell to edit.
- **Enter** or losing focus **auto-saves** changes.
- Table **auto-sorts by Date** after Date edits.
- Downloads reflect **saved edits** (not drafts).

---

## Settings Persistence

All settings (and your API key) are stored in **localStorage**:

- `websiteName`, `source`, `dateField`, `onlyCompleted`, `model`, `typeFilter`, `apiKey`.

> Prototype intent: For production, move secrets off the client.

---

## Project Structure

```
fintrack-frontend/
├── public/
├── src/
│   ├── App.tsx          # main app (UI + logic)
│   ├── main.tsx         # React entry
│   └── index.css        # Tailwind v4: @import "tailwindcss";
├── vite.config.ts       # includes @tailwindcss/vite plugin
├── package.json
└── README.md
```

---

## Troubleshooting

- **Tailwind v4**: There is no `npx tailwindcss init -p`. Use the Vite plugin (`@tailwindcss/vite`) and `@import "tailwindcss";` in `src/index.css`.
- **Node version warnings**: Upgrade Node to ≥ 22 (or ≥ 20.19.0) to satisfy Vite/React plugin engine requirements.
- **CSV parse errors**: Ensure headers match exactly and the file is a real CSV (comma-separated). The app shows missing columns and parse issues.

---

## Roadmap (suggested)

- Persist row edits to localStorage keyed by file hash (restore on reload).
- Keyboard navigation (Tab/Shift+Tab between editable cells; Esc to cancel).
- Bulk edit: apply Category/Notes/Date to multiple selected rows.
- User rules: map merchant patterns to categories before LLM.
- Backend proxy for LLM calls + caching.
- Unit tests for `parseAmount`, CSV generation, and date sorting.
- Additional sources (N26/Monzo) via mappers.

---

## License

MIT (or your preferred license).
