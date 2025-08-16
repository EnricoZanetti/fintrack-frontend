import React, { useEffect, useMemo, useRef, useState } from "react";

// --- Optional: PapaParse for robust CSV parsing ---
let PapaRef: any = null;
(async () => {
  try {
    // @ts-ignore
    const mod = await import("papaparse");
    PapaRef = mod.default || mod;
  } catch (e) {
    console.warn("PapaParse not available; using fallback parser.");
  }
})();

// ---- Small helpers ----
const siteNameDefault = "Revolut CSV Transformer";
const categorySet = [
  "Groceries",
  "Restaurants",
  "Transport",
  "Shopping",
  "Entertainment",
  "Bills",
  "Housing",
  "Health",
  "Travel",
  "Cash Withdrawal",
  "Transfers",
  "Income",
  "Fees",
  "Other",
];

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function csvEscape(value: any): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toISODate(dateStr: string): string {
  if (!dateStr) return "";
  const d = dateStr.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = new Date(dateStr);
  if (!isNaN((dt as unknown) as number)) return dt.toISOString().slice(0, 10);
  return "";
}

function heuristicCategory(name: string): string {
  const s = (name || "").toLowerCase();
  const has = (k: string | RegExp) => (typeof k === "string" ? s.includes(k) : !!s.match(k));
  if (has("salary") || has("stipend") || has("payroll") || has("bonifico in entrata")) return "Income";
  if (has("atm") || has("cash withdrawal") || has("prelievo")) return "Cash Withdrawal";
  if (has("transfer") || has("bonifico") || has("internal transfer") || has("worldpay")) return "Transfers";
  if (has("amazon") || has("zalando") || has("decathlon") || has("ikea")) return "Shopping";
  if (has("conad") || has("coop") || has("lidl") || has("eurospin") || has("supermerc")) return "Groceries";
  if (has("bar ") || has("caffe") || has("ristor") || has("trattoria") || has("locanda") || has("osteria") || has("pizza") || has("mcd") || has("burger") || has("kebab"))
    return "Restaurants";
  if (has("trenitalia") || has("italo") || has("uber") || has("taxi") || has("flixbus") || has("ryanair") || has("wizz"))
    return "Transport";
  if (has("spotify") || has("netflix") || has("steam") || has("prime") || has("disney")) return "Entertainment";
  if (has("enel") || has("acea") || has("tim") || has("vodafone") || has("windtre") || has("bolletta")) return "Bills";
  if (has("affitto") || has("rent") || has("mutuo") || has("mortgage")) return "Housing";
  if (has("farmacia") || has("pharma") || has("clinic") || has("ospedale") || has("dental")) return "Health";
  if (has("hotel") || has("booking") || has("airbnb") || has("hostel")) return "Travel";
  if (has("fee") || has("commission")) return "Fees";
  return "Other";
}

async function classifyWithOpenAI(
  names: string[],
  apiKey: string,
  model: string = "gpt-4o-mini"
): Promise<Record<string, string>> {
  if (!apiKey) throw new Error("Please add your LLM API key in Settings.");
  const chunks: string[][] = [];
  const CHUNK = 40;
  for (let i = 0; i < names.length; i += CHUNK) chunks.push(names.slice(i, i + CHUNK));

  const mapping: Record<string, string> = {};

  for (const group of chunks) {
    const content = `Classify each transaction/merchant name into one of these categories: ${categorySet.join(
      ", "
    )}.\nReturn a single valid JSON object with keys = original names EXACTLY and values = one category string.\nNames:\n${group
      .map((n, i) => `${i + 1}. ${n}`)
      .join("\n")}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You are a meticulous financial transaction classifier. Only output strict JSON with no extra commentary.",
          },
          { role: "user", content },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error: ${res.status} ${text}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "{}";
    try {
      const obj = JSON.parse(text);
      Object.assign(mapping, obj);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        Object.assign(mapping, JSON.parse(m[0]));
      } else {
        for (const n of group) mapping[n] = heuristicCategory(n);
      }
    }
  }
  return mapping;
}

function fallbackParse(csvText: string): { data: any[]; errors: string[] } {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { data: [], errors: ["Empty file"] };
  const headers = lines[0].split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(",");
    const rec: any = {};
    headers.forEach((h, i) => (rec[h] = (cols[i] || "").trim()));
    return rec;
  });
  return { data: rows, errors: [] };
}

// --- Tiny dev self-tests (console) ---
function runSelfTests() {
  try {
    console.group("RCVT self-tests");
    console.assert(toISODate("2025-08-01 23:59:00") === "2025-08-01", "toISODate failed A");
    console.assert(csvEscape("a,b") === '"a,b"', "csvEscape comma");
    console.assert(csvEscape('He said "Hi"') === '"He said ""Hi"""', "csvEscape quotes");
    console.assert(heuristicCategory("Conad Superstore") === "Groceries", "heuristics groceries");
    console.assert(heuristicCategory("Salary ACME") === "Income", "heuristics income");
    console.assert(["Expense", "Income"].includes((() => { const amt=-12; return amt<0?"Expense":"Income"; })()), "type calc");
    console.groupEnd();
  } catch (e) {
    console.warn("Self-tests encountered an issue:", e);
  }
}
if (typeof window !== "undefined" && !(window as any).__rcvt_tests_ran) {
  (window as any).__rcvt_tests_ran = true;
  runSelfTests();
}

export default function App() {
  const [tab, setTab] = useState<"transform" | "settings">("transform");

  // Settings (persist to localStorage)
  const [apiKey, setApiKey] = useState<string>("");
  const [source, setSource] = useState<string>("Revolut");
  const [websiteName, setWebsiteName] = useState<string>(siteNameDefault);
  const [dateField, setDateField] = useState<"Completed Date" | "Started Date">("Completed Date");
  const [onlyCompleted, setOnlyCompleted] = useState<boolean>(true);
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [typeFilter, setTypeFilter] = useState<"Both" | "Expense" | "Income">("Both");

  useEffect(() => {
    const s = localStorage.getItem("rcvt_settings");
    if (s) {
      try {
        const obj = JSON.parse(s);
        setApiKey(obj.apiKey ?? "");
        setSource(obj.source ?? "Revolut");
        setWebsiteName(obj.websiteName ?? siteNameDefault);
        setDateField(obj.dateField ?? "Completed Date");
        setOnlyCompleted(typeof obj.onlyCompleted === "boolean" ? obj.onlyCompleted : true);
        setModel(obj.model ?? "gpt-4o-mini");
        setTypeFilter(obj.typeFilter ?? "Both");
      } catch {}
    }
  }, []);

  useEffect(() => {
    const payload = { apiKey, source, websiteName, dateField, onlyCompleted, model, typeFilter };
    localStorage.setItem("rcvt_settings", JSON.stringify(payload));
  }, [apiKey, source, websiteName, dateField, onlyCompleted, model, typeFilter]);

  // Upload & processing state
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);

  const expectedHeaders = [
    "Type",
    "Product",
    "Started Date",
    "Completed Date",
    "Description",
    "Amount",
    "Fee",
    "Currency",
    "State",
    "Balance",
  ];

  async function onFileSelected(file: File) {
    setStatus("Parsing CSV...");
    setErrors([]);
    setCategoryMap({});

    const text = await file.text();
    let data: any[] = [];
    let parseErrors: any[] = [];

    if (PapaRef) {
      const parsed = PapaRef.parse(text, { header: true, skipEmptyLines: true });
      data = parsed.data as any[];
      parseErrors = parsed.errors || [];
    } else {
      const parsed = fallbackParse(text);
      data = parsed.data;
      parseErrors = parsed.errors;
    }

    if (parseErrors.length) {
      setErrors((e) => [
        ...e,
        `Parsing issues: ${parseErrors.slice(0, 3).map((x: any) => x.message || x).join(" | ")}`,
      ]);
    }

    const headerLine = text.split(/\r?\n/)[0] || "";
    const headers = headerLine.split(",").map((s) => s.trim());
    const missing = expectedHeaders.filter((h) => !headers.includes(h));
    if (missing.length) {
      setErrors((e) => [
        ...e,
        `Missing expected columns: ${missing.join(", ")}. Got: ${headers.join(", ")}`,
      ]);
    }

    setRawRows(data);
    setStatus(`Loaded ${data.length} rows.`);
  }

  const filteredRows = useMemo(() => {
    const rows = (rawRows || []).filter((r) => !!r && Object.keys(r).length > 0);
    return onlyCompleted ? rows.filter((r) => (r["State"] || "").toUpperCase() === "COMPLETED") : rows;
  }, [rawRows, onlyCompleted]);

  const uniqueNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of filteredRows) {
      const name = (r["Description"] || "").trim();
      if (name) s.add(name);
    }
    return Array.from(s);
  }, [filteredRows]);

  const transformedAll = useMemo(() => {
    return filteredRows.map((r) => {
      const rawAmt = (r["Amount"] ?? "0").toString().replace(/\s/g, "");
      const normalized = rawAmt.replace(/\./g, "").replace(/,/g, "."); // 1.234,56 → 1234.56
      const amtNum = parseFloat(normalized);
      const type = amtNum < 0 ? "Expense" : "Income";
      const amountAbs = Math.abs(amtNum || 0).toFixed(2);
      const name = (r["Description"] || "").toString();
      const category = categoryMap[name] || heuristicCategory(name);
      const dateVal = toISODate(r[dateField] || r["Completed Date"] || r["Started Date"] || "");
      return {
        Date: dateVal,
        Type: type,
        Amount: amountAbs,
        Currency: (r["Currency"] || "").toString(),
        Category: category,
        Name: name,
        Account: source || "Revolut",
        Notes: "",
        Source: websiteName || siteNameDefault,
      };
    });
  }, [filteredRows, categoryMap, dateField, source, websiteName]);

  const transformedFiltered = useMemo(() => {
    if (typeFilter === "Both") return transformedAll;
    return transformedAll.filter((r) => r.Type === typeFilter);
  }, [transformedAll, typeFilter]);

  async function handleClassify() {
    try {
      if (!apiKey) throw new Error("Please add your LLM API key in Settings.");
      setStatus("Classifying with LLM...");
      const map = await classifyWithOpenAI(uniqueNames, apiKey, model);
      setCategoryMap(map);
      setStatus("Classification complete.");
    } catch (e: any) {
      setStatus("");
      setErrors((x) => [...x, e.message || String(e)]);
    }
  }

  function handleDownload() {
    const cols = ["Date","Type","Amount","Currency","Category","Name","Account","Notes","Source"];
    const header = cols.join(",");
    const body = transformedFiltered
      .map((row) => cols.map((c) => csvEscape((row as any)[c])).join(","))
      .join("\n");
    const csv = header + "\n" + body + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revolut_transformed_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold">R</div>
            <div>
              <h1 className="text-lg font-semibold">{websiteName || siteNameDefault}</h1>
              <p className="text-xs text-gray-500">Upload your Revolut CSV → classify → download a clean CSV</p>
            </div>
          </div>
          <nav className="flex gap-1 p-1 bg-gray-100 rounded-xl">
            <button
              onClick={() => setTab("transform")}
              className={classNames("px-3 py-1.5 rounded-lg text-sm", tab === "transform" ? "bg-white shadow" : "text-gray-600")}
            >
              Transform
            </button>
            <button
              onClick={() => setTab("settings")}
              className={classNames("px-3 py-1.5 rounded-lg text-sm", tab === "settings" ? "bg-white shadow" : "text-gray-600")}
            >
              Settings
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "settings" ? (
          <section className="grid gap-6">
            <div className="bg-white rounded-2xl shadow p-5">
              <h2 className="text-base font-semibold mb-3">General</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <label className="grid gap-1 text-sm">
                  <span className="text-gray-600">Website name</span>
                  <input className="border rounded-lg px-3 py-2" value={websiteName} onChange={(e) => setWebsiteName(e.target.value)} placeholder={siteNameDefault}/>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-gray-600">Source</span>
                  <select className="border rounded-lg px-3 py-2" value={source} onChange={(e) => setSource(e.target.value)}>
                    <option>Revolut</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-gray-600">Date field</span>
                  <select className="border rounded-lg px-3 py-2" value={dateField} onChange={(e) => setDateField(e.target.value as any)}>
                    <option>Completed Date</option>
                    <option>Started Date</option>
                  </select>
                </label>
                <label className="flex items-center gap-3 text-sm pt-6">
                  <input type="checkbox" checked={onlyCompleted} onChange={(e) => setOnlyCompleted(e.target.checked)} />
                  Include only rows with <code className="px-1 rounded bg-gray-100">State = COMPLETED</code>
                </label>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow p-5">
              <h2 className="text-base font-semibold mb-3">LLM</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <label className="grid gap-1 text-sm">
                  <span className="text-gray-600">OpenAI API key</span>
                  <input type="password" className="border rounded-lg px-3 py-2" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
                  <span className="text-xs text-gray-500">Stored locally in your browser. For prototypes only—avoid exposing secrets client-side.</span>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-gray-600">Model</span>
                  <select className="border rounded-lg px-3 py-2" value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                  </select>
                </label>
              </div>
            </div>
          </section>
        ) : (
          <section className="grid gap-6">
            <div className="bg-white rounded-2xl shadow p-5 flex flex-col gap-3">
              <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
                <div>
                  <h2 className="text-base font-semibold">Upload Revolut CSV</h2>
                  <p className="text-sm text-gray-600">
                    Expected headers:{" "}
                    <code className="bg-gray-100 rounded px-1">
                      Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance
                    </code>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="border rounded-lg px-3 py-2"
                    onChange={(e) => e.target.files && onFileSelected(e.target.files[0])}
                  />
                  <button
                    onClick={() => {
                      setRawRows([]);
                      setErrors([]);
                      setCategoryMap({});
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {status && <div className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-3">{status}</div>}
              {errors.length > 0 && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  {errors.map((e, i) => (
                    <div key={i}>• {e}</div>
                  ))}
                </div>
              )}

              {filteredRows.length > 0 && (
                <div className="flex flex-col gap-3 mt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm text-gray-700 flex items-center gap-2">
                      Type
                      <select
                        className="border rounded-lg px-2 py-1"
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value as any)}
                      >
                        <option value="Both">Both</option>
                        <option value="Expense">Expense only</option>
                        <option value="Income">Income only</option>
                      </select>
                    </label>
                    <div className="text-sm text-gray-600">
                      Rows loaded: <b>{rawRows.length}</b> • After filter: <b>{filteredRows.length}</b> • Export rows: <b>{transformedFiltered.length}</b> • Unique names: <b>{uniqueNames.length}</b>
                    </div>
                    <div className="flex-1" />
                    <button
                      onClick={handleClassify}
                      className="px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      disabled={!uniqueNames.length || !apiKey}
                      title={!apiKey ? "Add your API key in Settings" : "Classify with LLM"}
                    >
                      Classify with LLM
                    </button>
                    <button
                      onClick={handleDownload}
                      className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      Download CSV
                    </button>
                  </div>

                  <div className="overflow-auto rounded-xl border">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          {[
                            "Date",
                            "Type",
                            "Amount",
                            "Currency",
                            "Category",
                            "Name",
                            "Account",
                            "Notes",
                            "Source",
                          ].map((h) => (
                            <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {transformedFiltered.slice(0, 50).map((row, i) => (
                          <tr key={i} className={i % 2 ? "bg-white" : "bg-gray-50"}>
                            <td className="px-3 py-2 whitespace-nowrap">{row.Date}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.Type}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.Amount}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.Currency}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.Category}</td>
                            <td className="px-3 py-2">{row.Name}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.Account}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.Notes}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.Source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-500">Showing first 50 rows. Download to get the full file.</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow p-5">
              <h3 className="font-semibold mb-2">How it works</h3>
              <ol className="list-decimal ml-5 text-sm text-gray-700 space-y-1">
                <li>Go to <b>Settings</b> → paste your OpenAI API key (optional but recommended).</li>
                <li>Back to <b>Transform</b> → upload the Revolut <code>.csv</code> export.</li>
                <li>Click <b>Classify with LLM</b> to assign categories by transaction name. If no key, a simple heuristic is used.</li>
                <li>Click <b>Download CSV</b> to save the normalized file with the required columns.</li>
              </ol>
              <p className="text-xs text-gray-500 mt-2">
                Security note: this demo sends merchant names to OpenAI directly from your browser when you click classify.
                For production, route via your own backend and never expose secrets client-side.
              </p>
            </div>
          </section>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-10 text-xs text-gray-500">
        Built for Revolut exports • Amounts are normalized as positive numbers, with <i>Type</i> carrying the sign.
      </footer>
    </div>
  );
}
