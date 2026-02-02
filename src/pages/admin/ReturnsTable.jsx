import { useEffect, useMemo, useState } from "react";
import AdminSidebar from "../../components/admin/AdminSidebar";
import { apiFetch } from "../../config/api";
import { ChevronLeft, ChevronRight, Package, DollarSign, Search, Download } from "lucide-react";
import { formatRentalId, formatReturnId } from "../../utils/entityId";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import { downloadCsv } from "../../utils/downloadCsv";
import { sortRows, toggleSort } from "../../utils/sortRows";


export default function ReturnsTable() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");
  const [depositFilter, setDepositFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState({ key: "returned_at", direction: "desc" });

  const load = async ({ showLoading } = {}) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const rows = await apiFetch("/api/returns");
      setData(rows || []);
    } catch (e) {
      setData([]);
      setError(String(e?.message || e || "Unable to load returns"));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    load({ showLoading: true });
    if (!autoRefresh) return () => { mounted = false; };
    const interval = setInterval(() => {
      if (!mounted) return;
      load({ showLoading: false });
    }, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  useEffect(() => {
    setPage(1);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, depositFilter, fromDate, toDate]);

  const isWithinDateRange = (value, from, to) => {
    if (!from && !to) return true;
    if (!value) return false;
    const t = Date.parse(value);
    if (!Number.isFinite(t)) return false;

    if (from) {
      const start = Date.parse(`${from}T00:00:00`);
      if (Number.isFinite(start) && t < start) return false;
    }
    if (to) {
      const end = Date.parse(`${to}T23:59:59.999`);
      if (Number.isFinite(end) && t > end) return false;
    }
    return true;
  };

  const fmtDateTime = (value) => {
    return formatDateTimeDDMMYYYY(value, "-");
  };

  const formatINR = (value) => {
    const n = Number(value || 0);
    const safe = Number.isFinite(n) ? n : 0;
    return `₹${safe.toLocaleString("en-IN")}`;
  };

  const rows = useMemo(() => {
    return (data || []).map((r) => {
      const depositReturned = Boolean(r?.deposit_returned);
      const depositReturnedAmount = Number(r?.deposit_returned_amount || 0);
      const rentalIdDisplay = formatRentalId(r?.rental_id);
      const returnIdDisplay = formatReturnId(r?.return_id);
      return {
        ...r,
        rider_full_name_display: r?.rider_full_name || "-",
        rider_mobile_display: r?.rider_mobile || "-",
        deposit_returned_display: depositReturned ? "Returned" : "-",
        deposit_returned_amount_value: depositReturned ? depositReturnedAmount : 0,
        rental_id_display: rentalIdDisplay,
        return_id_display: returnIdDisplay,
      };
    });
  }, [data]);

  const filteredRows = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();

    return rows.filter((r) => {
      if (depositFilter === "returned" && !r?.deposit_returned_amount_value) return false;
      if (depositFilter === "not_returned" && r?.deposit_returned_amount_value) return false;

      // Date range applies to return time
      if (!isWithinDateRange(r?.returned_at, fromDate, toDate)) return false;

      if (!q) return true;

      const hay = [
        r?.rider_full_name_display,
        r?.rider_mobile_display,
        r?.rider_code,
        r?.vehicle_number,
        r?.bike_id,
        r?.battery_id,
        r?.condition_notes,
        r?.rental_id,
        r?.return_id,
        r?.rental_id_display,
        r?.return_id_display,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" | ");

      return hay.includes(q);
    });
  }, [rows, search, depositFilter, fromDate, toDate]);

  const sortedRows = useMemo(() => {
    return sortRows(filteredRows, { key: sort?.key, direction: sort?.direction });
  }, [filteredRows, sort]);

  const summary = useMemo(() => {
    const totalReturns = sortedRows.length;
    const depositReturnedTotal = sortedRows.reduce(
      (sum, r) => sum + Number(r.deposit_returned_amount_value || 0),
      0
    );
    return { totalReturns, depositReturnedTotal };
  }, [sortedRows]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(sortedRows.length / pageSize));
  }, [sortedRows.length]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page]);

  const onExport = () => {
    downloadCsv({
      filename: `returns_${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { key: "rider_full_name_display", header: "Rider" },
        { key: "rider_code", header: "Rider Code" },
        { key: "rider_mobile_display", header: "Mobile" },
        { key: "vehicle_number", header: "Vehicle" },
        { key: "bike_id", header: "E-Bike ID" },
        { key: "battery_id", header: "Battery ID" },
        { key: "start_time", header: "Start" },
        { key: "returned_at", header: "Returned At" },
        { key: "deposit_returned_amount_value", header: "Deposit Returned" },
        { key: "condition_notes", header: "Condition" },
        { key: "rental_id_display", header: "Rental ID" },
        { key: "return_id_display", header: "Return ID" },
      ],
      rows: sortedRows,
    });
  };

  const renderSortableTh = ({ label, sortKey, className = "" }) => {
    const active = sort?.key === sortKey;
    const dir = active ? sort?.direction : null;
    const arrow = !active ? "" : dir === "asc" ? "▲" : "▼";
    return (
      <th
        key={sortKey}
        className={`px-6 py-4 text-left font-semibold text-slate-700 select-none cursor-pointer ${className}`}
        onClick={() => setSort((prev) => toggleSort(prev, sortKey))}
        title="Sort"
      >
        <span className="inline-flex items-center gap-2">
          {label}
          <span className={`text-xs ${active ? "text-slate-700" : "text-slate-300"}`}>{arrow || "▲"}</span>
        </span>
      </th>
    );
  };

  return (
    <div className="admin-viewport h-screen flex bg-white relative overflow-hidden">

      <AdminSidebar />

      <main className="flex-1 overflow-y-auto relative z-10">
        <div className="p-10 pb-0 space-y-8">
          {/* Hero Header */}
          <div className="mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-2">
              Returns Management
            </h1>
            <p className="text-slate-600 text-base font-normal">
              Track and manage all vehicle returns and deposit refunds
            </p>
          </div>

          <div className="flex items-center justify-end mb-6">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={onExport}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-lg hover:bg-blue-700"
              >
                <Download size={16} />
                Download CSV
              </button>

              <label className="flex items-center gap-3 text-slate-600 font-medium">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={e => setAutoRefresh(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-white/50 border-white/50 rounded focus:ring-blue-500/50"
                />
                Auto-refresh
              </label>
            </div>
          </div>

          {/* SEARCH + FILTER */}
          <div className="bg-white/70 backdrop-blur-xl border border-white/30 rounded-3xl shadow-xl p-6 flex flex-wrap items-center gap-3">
              <div className="flex items-center bg-slate-100/80 px-4 py-3 rounded-2xl w-full md:w-96">
                <Search size={18} className="text-slate-600" />
                <input
                  className="bg-transparent outline-none ml-3 w-full text-base font-normal placeholder-slate-400"
                  placeholder="Search rider, mobile, vehicle, bike, battery, rental id…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-600">From</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="border border-slate-200 rounded-2xl px-3 py-3 text-sm font-medium bg-white/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-600">To</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="border border-slate-200 rounded-2xl px-3 py-3 text-sm font-medium bg-white/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <select
                className="border border-slate-200 rounded-2xl px-4 py-3 text-base font-medium bg-white/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={depositFilter}
                onChange={(e) => setDepositFilter(e.target.value)}
                aria-label="Deposit filter"
              >
                <option value="all">All deposits</option>
                <option value="returned">Deposit returned</option>
                <option value="not_returned">Deposit not returned</option>
              </select>
          </div>

          {error ? (
            <div className="rounded-3xl border border-red-200/50 bg-red-50/70 backdrop-blur-xl px-6 py-4 text-sm text-red-700 shadow-lg">
              {error}
            </div>
          ) : null}

        {/* KPI CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            ["Total Returns", summary.totalReturns, "text-slate-800", Package],
            ["Deposit Returned", formatINR(summary.depositReturnedTotal), "text-green-600", DollarSign],
          ].map(([label, value, color, Icon]) => (
            <div key={label} className="group relative overflow-hidden bg-white/70 backdrop-blur-xl rounded-2xl p-6 shadow-xl border border-white/30 hover:shadow-2xl hover:scale-102 transition-all duration-300 cursor-pointer">
              {/* Floating geometric shapes */}
              <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-blue-400/20 to-purple-400/20 rounded-full -translate-y-6 translate-x-6 group-hover:scale-110 transition-transform duration-300"></div>
              <div className="absolute bottom-0 left-0 w-12 h-12 bg-gradient-to-br from-purple-400/20 to-pink-400/20 rounded-xl translate-y-3 -translate-x-3 group-hover:rotate-12 transition-transform duration-300"></div>

              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow duration-300">
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="text-2xl opacity-20 group-hover:opacity-60 transition-opacity duration-300 font-bold text-slate-400">
                    #
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {label}
                  </div>
                  <div className={`text-2xl font-black ${color} group-hover:text-blue-600 transition-colors duration-300`}>
                    {value}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-slate-500 py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            Loading…
          </div>
        ) : null}

        {/* TABLE */}
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-base font-normal">
              <thead className="bg-white/50 backdrop-blur-sm">
                <tr>
                  {renderSortableTh({ label: "Rider", sortKey: "rider_full_name_display" })}
                  {renderSortableTh({ label: "Mobile", sortKey: "rider_mobile_display" })}
                  {renderSortableTh({ label: "Vehicle", sortKey: "vehicle_number" })}
                  {renderSortableTh({ label: "E-Bike ID", sortKey: "bike_id" })}
                  {renderSortableTh({ label: "Battery ID", sortKey: "battery_id" })}
                  {renderSortableTh({ label: "Start", sortKey: "start_time" })}
                  {renderSortableTh({ label: "Returned At", sortKey: "returned_at" })}
                  {renderSortableTh({ label: "Deposit", sortKey: "deposit_returned_amount_value" })}
                  {renderSortableTh({ label: "Condition", sortKey: "condition_notes" })}
                  {renderSortableTh({ label: "Rental ID", sortKey: "rental_id_display" })}
                  {renderSortableTh({ label: "Return ID", sortKey: "return_id_display" })}
                </tr>
              </thead>

              <tbody>
                {pageRows.map((r, i) => {
                  const depositTone = r.deposit_returned_amount_value > 0 ? "text-green-700" : "text-slate-600";
                  return (
                    <tr key={r.return_id || i} className="border-t border-white/30 hover:bg-white/40 transition-colors duration-200">
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-800">{r.rider_full_name_display}</div>
                        <div className="text-xs text-slate-500">{r.rider_code || ""}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{r.rider_mobile_display}</td>
                      <td className="px-6 py-4 text-slate-600">{r.vehicle_number || "-"}</td>
                      <td className="px-6 py-4 text-slate-600">{r.bike_id || "-"}</td>
                      <td className="px-6 py-4 text-slate-600">{r.battery_id || "-"}</td>
                      <td className="px-6 py-4 text-slate-600">{fmtDateTime(r.start_time)}</td>
                      <td className="px-6 py-4 text-slate-600">{fmtDateTime(r.returned_at)}</td>
                      <td className={`px-6 py-4 font-semibold ${depositTone}`}>
                        {r.deposit_returned_amount_value > 0 ? formatINR(r.deposit_returned_amount_value) : "-"}
                      </td>
                      <td className="px-6 py-4 max-w-md">
                        <span className="line-clamp-2 text-slate-600">{r.condition_notes || "-"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-slate-500 font-medium">{r.rental_id_display}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-slate-500 font-medium">{r.return_id_display}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sortedRows.length === 0 && !loading ? (
            <div className="p-8 text-center text-slate-500">No records found</div>
          ) : null}

          <div className="px-6 py-4 border-t border-white/30 flex items-center justify-between bg-white/20 backdrop-blur-sm">
            <div className="text-sm text-slate-600 font-medium">
              Page {page} / {totalPages}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="p-3 rounded-2xl border border-white/50 bg-white/50 backdrop-blur-sm hover:bg-white/70 transition-all duration-200 disabled:opacity-50 shadow-lg hover:shadow-xl"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                title="Previous"
              >
                <ChevronLeft size={16} className="text-slate-600" />
              </button>
              <button
                type="button"
                className="p-3 rounded-2xl border border-white/50 bg-white/50 backdrop-blur-sm hover:bg-white/70 transition-all duration-200 disabled:opacity-50 shadow-lg hover:shadow-xl"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                title="Next"
              >
                <ChevronRight size={16} className="text-slate-600" />
              </button>
            </div>
          </div>
        </div>
        </div>
      </main>
    </div>
  );
}
