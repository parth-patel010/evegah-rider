import { useEffect, useMemo, useState, useCallback } from "react";
import AdminSidebar from "../../components/admin/AdminSidebar";
import { apiFetch } from "../../config/api";

import EditRiderModal from "./EditRiderModal";
import DeleteModal from "./DeleteModal";
import RiderProfileModal from "./RiderProfileModal";

import { formatDateDDMMYYYY } from "../../utils/dateFormat";
import { Eye, Edit, Trash2, Download, Users, Bike, UserCheck, UserX, Search } from "lucide-react";
import { downloadCsv } from "../../utils/downloadCsv";
import { sortRows, toggleSort } from "../../utils/sortRows";

export default function RidersTable() {
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(true);

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Summary stats
  const [totalRiders, setTotalRiders] = useState(0);
  const [activeRentedVehicles, setActiveRentedVehicles] = useState(0);
  const [retainRiders, setRetainRiders] = useState(0);
  const [endedRiders, setEndedRiders] = useState(0);

  // Bulk select
  const [selected, setSelected] = useState([]);

  // Filter/sort
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState({ key: "created_at", direction: "desc" });

  // Modals
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [viewItem, setViewItem] = useState(null);

  /* ===================== API ===================== */

  const loadStats = useCallback(async () => {
    const stats = await apiFetch("/api/riders/stats");
    setTotalRiders(stats?.totalRiders || 0);
    setActiveRentedVehicles(stats?.activeRentedVehicles || 0);
    setRetainRiders(stats?.retainRiders || 0);
    setEndedRiders(stats?.endedRiders || 0);
  }, []);

  const loadRiders = useCallback(async () => {
    setLoading(true);

    const res = await apiFetch("/api/riders");

    setRiders(res?.data || []);
    setLoading(false);
  }, []);

  /* ===================== EFFECTS ===================== */

  useEffect(() => {
    loadRiders();
  }, [loadRiders]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadStats();
      loadRiders();
    }, 15000);

    return () => clearInterval(interval);
  }, [autoRefresh, loadRiders, loadStats]);

  /* ===================== EXPORT ===================== */

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

  const filteredRows = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    return (riders || []).filter((r) => {
      if (statusFilter !== "all" && String(r?.status || "").toLowerCase() !== statusFilter) return false;
      if (typeFilter !== "all" && String(r?.rider_type || "").toLowerCase() !== typeFilter) return false;

      // Date range applies to created_at
      if (!isWithinDateRange(r?.created_at, fromDate, toDate)) return false;

      if (!q) return true;
      const hay = [
        r?.full_name,
        r?.mobile,
        r?.aadhaar,
        r?.status,
        r?.ride_status,
        r?.rider_type,
        r?.id,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" | ");
      return hay.includes(q);
    });
  }, [riders, search, statusFilter, typeFilter, fromDate, toDate]);

  const sortedRows = useMemo(() => {
    return sortRows(filteredRows, { key: sort?.key, direction: sort?.direction });
  }, [filteredRows, sort]);

  const exportRows = (rows, filename) => {
    downloadCsv({
      filename,
      columns: [
        { key: "full_name", header: "Name" },
        { key: "mobile", header: "Mobile" },
        { key: "aadhaar", header: "Aadhaar" },
        { key: "status", header: "Status" },
        { key: "ride_status", header: "Ride" },
        { key: "rider_type", header: "Type" },
        { key: "created_at", header: "Created At" },
      ],
      rows,
    });
  };

  const exportSelected = () => {
    exportRows(
      (riders || []).filter((r) => selected.includes(r.id)),
      `riders_selected_${new Date().toISOString().slice(0, 10)}.csv`
    );
  };

  const exportCurrentView = () => {
    exportRows(sortedRows, `riders_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const statuses = useMemo(() => {
    const set = new Set();
    (riders || []).forEach((r) => {
      const s = String(r?.status || "").trim().toLowerCase();
      if (s) set.add(s);
    });
    return Array.from(set);
  }, [riders]);

  const types = useMemo(() => {
    const set = new Set();
    (riders || []).forEach((r) => {
      const s = String(r?.rider_type || "").trim().toLowerCase();
      if (s) set.add(s);
    });
    return Array.from(set);
  }, [riders]);

  const renderSortableTh = ({ label, sortKey }) => {
    const active = sort?.key === sortKey;
    const dir = active ? sort?.direction : null;
    const arrow = !active ? "" : dir === "asc" ? "▲" : "▼";
    return (
      <th
        key={sortKey}
        className="p-4 font-semibold text-left select-none cursor-pointer"
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

  /* ===================== UI ===================== */

  return (
    <div className="admin-viewport h-screen flex bg-white relative overflow-hidden">

      <AdminSidebar />

      <main className="flex-1 overflow-y-auto relative z-10">
        <div className="p-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Rider Fleet Management
            </h1>
            <p className="text-slate-600 mt-2 text-base font-normal">
              Oversee your rider network and track performance metrics
            </p>
          </div>
          {/* SEARCH + FILTERS */}
          <div className="mb-6 bg-white/70 backdrop-blur-xl border border-white/30 rounded-2xl shadow-xl p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center bg-slate-100/80 px-4 py-3 rounded-2xl w-full md:w-96">
              <Search size={18} className="text-slate-600" />
              <input
                className="bg-transparent outline-none ml-3 w-full text-base font-normal placeholder-slate-400"
                placeholder="Search name, mobile, aadhaar, status…"
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
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              className="border border-slate-200 rounded-2xl px-4 py-3 text-base font-medium bg-white/80 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Type filter"
            >
              <option value="all">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {/* SUMMARY */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            {[
              ["Total Riders", totalRiders, "text-slate-800", Users],
              ["Active Rented", activeRentedVehicles, "text-green-600", Bike],
              ["Retain Riders", retainRiders, "text-blue-600", UserCheck],
              ["Ended Riders", endedRiders, "text-slate-800", UserX],
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

          {/* BULK BAR */}
          {selected.length > 0 && (
            <div className="mb-6 flex gap-4 bg-white/70 backdrop-blur-xl p-4 rounded-2xl shadow-xl border border-white/30">
              <span className="font-semibold">{selected.length} selected</span>
              <button
                type="button"
                onClick={exportSelected}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-lg hover:bg-blue-700"
              >
                Export
              </button>
              <button
                type="button"
                onClick={() => setDeleteItem({ bulk: true, ids: selected })}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold shadow-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          )}

          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={exportCurrentView}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-lg hover:bg-blue-700"
            >
              <Download size={16} />
              Export CSV
            </button>

            <label className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/70 backdrop-blur-xl border border-white/30 text-sm font-medium text-slate-700 shadow-lg">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Auto-refresh
            </label>
          </div>

        

          {/* TABLE */}
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/30 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center">Loading riders…</div>
            ) : sortedRows.length === 0 ? (
              <div className="p-8 text-center">No riders found</div>
            ) : (
              <table className="w-full text-sm font-medium">
                <thead className="bg-blue-50/70">
                  <tr>
                    <th className="p-4 font-semibold text-left" />
                    {renderSortableTh({ label: "Name", sortKey: "full_name" })}
                    {renderSortableTh({ label: "Mobile", sortKey: "mobile" })}
                    {renderSortableTh({ label: "Aadhaar", sortKey: "aadhaar" })}
                    {renderSortableTh({ label: "Ride", sortKey: "ride_status" })}
                    {renderSortableTh({ label: "Type", sortKey: "rider_type" })}
                    {renderSortableTh({ label: "Created", sortKey: "created_at" })}
                    <th className="p-4 font-semibold text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-slate-50/50 transition-colors">
                      <td className="p-4">
                        <input
                          type="checkbox"
                          checked={selected.includes(r.id)}
                          onChange={() =>
                            setSelected((prev) =>
                              prev.includes(r.id)
                                ? prev.filter((x) => x !== r.id)
                                : [...prev, r.id]
                            )
                          }
                        />
                      </td>
                      <td className="p-4">{r.full_name}</td>
                      <td className="p-4">{r.mobile}</td>
                      <td className="p-4">{r.aadhaar}</td>
                      <td className="p-4">{r.ride_status || "-"}</td>
                      <td className="p-4">{r.rider_type || "-"}</td>
                      <td className="p-4">
                        {formatDateDDMMYYYY(r.created_at, "-")}
                      </td>
                      <td className="p-4 flex gap-2">
                        <button onClick={() => setViewItem(r)} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
                          <Eye size={16} />
                        </button>
                        <button onClick={() => setEditItem(r)} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
                          <Edit size={16} />
                        </button>
                        <button onClick={() => setDeleteItem(r)} className="p-2 rounded-lg hover:bg-red-100 text-red-600 transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {/* MODALS */}
      {editItem && (
        <EditRiderModal
          rider={editItem}
          close={() => setEditItem(null)}
          reload={loadRiders}
        />
      )}
      {deleteItem && (
        <DeleteModal
          rider={deleteItem?.bulk ? null : deleteItem}
          bulkIds={deleteItem?.bulk ? deleteItem.ids : []}
          close={() => setDeleteItem(null)}
          reload={loadRiders}
          onBulkSuccess={() => setSelected([])}
        />
      )}
      {viewItem && (
        <RiderProfileModal
          rider={viewItem}
          close={() => setViewItem(null)}
        />
      )}
    </div>
  );
}
