import { useEffect, useMemo, useState } from "react";
import AdminSidebar from "../../components/admin/AdminSidebar";
import { apiFetch } from "../../config/api";
import { Search, FileText, Play, CheckCircle, DollarSign, Receipt, Download } from "lucide-react";
import { formatRentalId } from "../../utils/entityId";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import { downloadCsv } from "../../utils/downloadCsv";
import { sortRows, toggleSort } from "../../utils/sortRows";


export default function RentalsTable() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sort, setSort] = useState({ key: "start_time", direction: "desc" });

  const load = async ({ showLoading } = {}) => {
    if (showLoading) setLoading(true);
    try {
      const rows = await apiFetch("/api/rentals");
      setData(rows || []);
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

  const fmtDateTime = (value) => {
    return formatDateTimeDDMMYYYY(value, "-");
  };

  const formatINR = (value) => {
    const n = Number(value || 0);
    const safe = Number.isFinite(n) ? n : 0;
    return `₹${safe.toLocaleString("en-IN")}`;
  };

  const parseMaybeJson = (value) => {
    if (!value) return null;
    if (typeof value === "object") return value;
    if (typeof value !== "string") return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

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

  const rows = useMemo(() => {
    return (data || []).map((r) => {
      const meta = parseMaybeJson(r?.meta) || {};
      const expected = r?.expected_end_time || meta?.expected_end_time || "";
      const returnedAt = r?.returned_at || null;
      const status = returnedAt ? "Returned" : "Active";

      const paymentMode = String(r?.payment_mode || "").trim();
      const deposit = Number(r?.deposit_amount || 0);
      const rent = Number(r?.rental_amount || 0);
      const total = Number(r?.total_amount || 0);

      return {
        ...r,
        rental_id_display: formatRentalId(r?.id),
        expected_end_time_value: expected,
        returned_at_value: returnedAt,
        status_display: status,
        payment_mode_display: paymentMode || "-",
        deposit_value: deposit,
        rent_value: rent,
        total_value: total,
      };
    });
  }, [data]);

  const filteredRows = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && String(r.status_display || "").toLowerCase() !== statusFilter) {
        return false;
      }

      // Date range applies to rental start_time
      if (!isWithinDateRange(r?.start_time, fromDate, toDate)) return false;

      if (!q) return true;
      const hay = [
        r?.rider_full_name,
        r?.rider_mobile,
        r?.rider_code,
        r?.vehicle_number,
        r?.bike_id,
        r?.battery_id,
        r?.rental_package,
        r?.payment_mode_display,
        r?.id,
        r?.rental_id_display,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" | ");
      return hay.includes(q);
    });
  }, [rows, search, statusFilter, fromDate, toDate]);

  const sortedRows = useMemo(() => {
    return sortRows(filteredRows, { key: sort?.key, direction: sort?.direction });
  }, [filteredRows, sort]);

  const summary = useMemo(() => {
    const totalRentals = sortedRows.length;
    const activeRentals = sortedRows.filter((r) => r.status_display === "Active").length;
    const returnedRentals = totalRentals - activeRentals;
    const depositTotal = sortedRows.reduce((sum, r) => sum + Number(r.deposit_value || 0), 0);
    const rentTotal = sortedRows.reduce((sum, r) => sum + Number(r.rent_value || 0), 0);
    return { totalRentals, activeRentals, returnedRentals, depositTotal, rentTotal };
  }, [sortedRows]);

  const onExport = () => {
    downloadCsv({
      filename: `rentals_${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { key: "rider_full_name", header: "Rider" },
        { key: "rider_code", header: "Rider Code" },
        { key: "rider_mobile", header: "Mobile" },
        { key: "bike_id", header: "E-Bike ID" },
        { key: "battery_id", header: "Battery ID" },
        { key: "start_time", header: "Start" },
        { key: "expected_end_time_value", header: "Expected Return" },
        { key: "returned_at_value", header: "Returned At" },
        { key: "status_display", header: "Status" },
        { key: "deposit_value", header: "Deposit" },
        { key: "rent_value", header: "Rent" },
        { key: "total_value", header: "Total" },
        { key: "payment_mode_display", header: "Payment" },
        { key: "rental_id_display", header: "Rental ID" },
      ],
      rows: sortedRows,
    });
  };

  const renderSortableTh = ({ label, sortKey, align = "left" }) => {
    const active = sort?.key === sortKey;
    const dir = active ? sort?.direction : null;
    const arrow = !active ? "" : dir === "asc" ? "▲" : "▼";
    const alignClass = align === "right" ? "text-right" : "text-left";
    return (
      <th
        key={sortKey}
        className={`px-6 py-4 ${alignClass} select-none cursor-pointer`}
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
    <div className="h-screen w-full flex bg-white relative overflow-hidden">

      <div className="flex relative z-10">
        <AdminSidebar />

        <main className="flex-1 w-full p-8 pb-0 overflow-x-hidden">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent tracking-tight">
              Active Rentals
            </h1>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-300"
              />
              Auto-refresh
            </label>
          </div>

        {/* KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          {[
            ["Total Rentals", summary.totalRentals, "text-slate-800", FileText],
            ["Active", summary.activeRentals, "text-green-600", Play],
            ["Returned", summary.returnedRentals, "text-slate-800", CheckCircle],
            ["Deposit Total", formatINR(summary.depositTotal), "text-green-600", DollarSign],
            ["Rent Total", formatINR(summary.rentTotal), "text-slate-800", Receipt],
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

        {/* SEARCH + FILTER */}
        <div className="bg-white/70 backdrop-blur-xl border border-white/30 rounded-3xl shadow-xl p-6 flex flex-wrap items-center gap-3 mb-6">
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Status filter"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="returned">Returned</option>
          </select>

          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-blue-600 text-white text-sm font-semibold shadow-lg hover:bg-blue-700"
          >
            <Download size={16} />
            Download CSV
          </button>
        </div>

        {loading ? <div className="text-sm text-gray-500">Loading…</div> : null}

        {/* TABLE */}
        <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-base font-normal">
              <thead className="bg-white/50 backdrop-blur-sm">
                <tr>
                {renderSortableTh({ label: "Rider", sortKey: "rider_full_name" })}
                {renderSortableTh({ label: "Mobile", sortKey: "rider_mobile" })}
                {/* Vehicle column removed */}
                {renderSortableTh({ label: "E-Bike ID", sortKey: "bike_id" })}
                {renderSortableTh({ label: "Battery ID", sortKey: "battery_id" })}
                {renderSortableTh({ label: "Start", sortKey: "start_time" })}
                {renderSortableTh({ label: "Expected Return", sortKey: "expected_end_time_value" })}
                {renderSortableTh({ label: "Returned At", sortKey: "returned_at_value" })}
                {renderSortableTh({ label: "Status", sortKey: "status_display" })}
                {renderSortableTh({ label: "Deposit", sortKey: "deposit_value", align: "right" })}
                {renderSortableTh({ label: "Rent", sortKey: "rent_value", align: "right" })}
                {renderSortableTh({ label: "Total", sortKey: "total_value", align: "right" })}
                {renderSortableTh({ label: "Payment", sortKey: "payment_mode_display" })}
                {renderSortableTh({ label: "Rental ID", sortKey: "rental_id_display" })}
              </tr>
            </thead>

            <tbody>
              {sortedRows.map((r, i) => {
                const statusTone = r.status_display === "Active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700";
                return (
                  <tr key={r.id || i} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">{r.rider_full_name || "-"}</div>
                      <div className="text-xs text-gray-500">{r.rider_code || ""}</div>
                    </td>
                    <td className="px-4 py-2">{r.rider_mobile || "-"}</td>
                    {/* Vehicle column removed */}
                    <td className="px-4 py-2">{r.bike_id || "-"}</td>
                    <td className="px-4 py-2">{r.battery_id || "-"}</td>
                    <td className="px-4 py-2">{fmtDateTime(r.start_time)}</td>
                    <td className="px-4 py-2">{fmtDateTime(r.expected_end_time_value)}</td>
                    <td className="px-4 py-2">{fmtDateTime(r.returned_at_value)}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${statusTone}`}>
                        {r.status_display}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-green-700">{formatINR(r.deposit_value)}</td>
                    <td className="px-4 py-2 text-right">{formatINR(r.rent_value)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatINR(r.total_value)}</td>
                    <td className="px-4 py-2">{r.payment_mode_display}</td>
                    <td className="px-4 py-2">
                      <span className="text-xs text-gray-600">{r.rental_id_display}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {sortedRows.length === 0 && !loading ? (
            <div className="p-6 text-center text-gray-500">No records found</div>
          ) : null}
        </div>
      </main>
    </div>
  </div>
  );
}
