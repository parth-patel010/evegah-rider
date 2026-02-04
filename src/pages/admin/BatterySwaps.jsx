import { useEffect, useMemo, useRef, useState } from "react";
import AdminSidebar from "../../components/admin/AdminSidebar";

import { Edit, Eye, Trash2, Battery, TrendingUp, Car, Clock, Zap, User, CheckSquare, Square } from "lucide-react";

import {
  adminBatterySwapsDaily,
  adminBatterySwapsTopBatteries,
  adminBatterySwapsTopVehicles,
  adminDeleteBatterySwap,
  adminDeleteBatterySwaps,
  adminListBatterySwaps,
  adminUpdateBatterySwap,
} from "../../utils/adminBatterySwaps";

import { BATTERY_ID_OPTIONS } from "../../utils/batteryIds";
import { VEHICLE_ID_OPTIONS } from "../../utils/vehicleIds";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PIE_COLORS = ["#4f46e5", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4"];

export default function AdminBatterySwapsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [batterySwaps, setBatterySwaps] = useState([]);
  const [batterySwapsDailyData, setBatterySwapsDailyData] = useState([]);
  const [batteryTopBatteriesData, setBatteryTopBatteriesData] = useState([]);
  const [batteryTopVehiclesData, setBatteryTopVehiclesData] = useState([]);

  const [swapRefresh, setSwapRefresh] = useState(0);

  const [editingSwapId, setEditingSwapId] = useState("");
  const [swapDraft, setSwapDraft] = useState(null);
  const [swapBusy, setSwapBusy] = useState(false);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTitle, setDetailsTitle] = useState("");
  const [detailsSubtitle, setDetailsSubtitle] = useState("");
  const [detailsSearch, setDetailsSearch] = useState("");
  const [detailsSelectedRow, setDetailsSelectedRow] = useState(null);
  const [detailsMode, setDetailsMode] = useState("history"); // history | view | edit
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsRows, setDetailsRows] = useState([]);
  const [selectedSwapIds, setSelectedSwapIds] = useState([]);

  const closeDetails = () => {
    setDetailsOpen(false);
    setDetailsTitle("");
    setDetailsSubtitle("");
    setDetailsSearch("");
    setDetailsSelectedRow(null);
    setDetailsMode("history");
    setDetailsRows([]);
    setDetailsLoading(false);
  };

  const openDetailsWithSearch = async ({ title, subtitle, search, selectedRow }) => {
    setDetailsOpen(true);
    setDetailsTitle(title || "Details");
    setDetailsSubtitle(subtitle || "");
    setDetailsSearch(search || "");
    setDetailsSelectedRow(selectedRow || null);
    setDetailsMode(selectedRow ? "view" : "history");
    setDetailsLoading(true);
    setDetailsRows([]);
    try {
      const rows = await adminListBatterySwaps({ search: search || "" }).catch(() => []);
      setDetailsRows(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(String(e?.message || e || "Unable to load details"));
      setDetailsRows([]);
    } finally {
      setDetailsLoading(false);
    }
  };

  const vehicleDropdownRef = useRef(null);
  const vehicleQueryRef = useRef(null);
  const batteryInDropdownRef = useRef(null);
  const batteryInQueryRef = useRef(null);
  const batteryOutDropdownRef = useRef(null);
  const batteryOutQueryRef = useRef(null);

  const [editVehicleOpen, setEditVehicleOpen] = useState(false);
  const [editVehicleQuery, setEditVehicleQuery] = useState("");
  const [editBatteryInOpen, setEditBatteryInOpen] = useState(false);
  const [editBatteryInQuery, setEditBatteryInQuery] = useState("");
  const [editBatteryOutOpen, setEditBatteryOutOpen] = useState(false);
  const [editBatteryOutQuery, setEditBatteryOutQuery] = useState("");

  const toDateTimeLocal = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  };

  const fmtSwapTime = (value) => {
    return formatDateTimeDDMMYYYY(value, "-");
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [swapRows, swapDaily, topBatteries, topVehicles] = await Promise.all([
        adminListBatterySwaps().catch(() => []),
        adminBatterySwapsDaily({ days: 14 }).catch(() => []),
        adminBatterySwapsTopBatteries({ days: 30 }).catch(() => []),
        adminBatterySwapsTopVehicles({ days: 30 }).catch(() => []),
      ]);

      setBatterySwaps(Array.isArray(swapRows) ? swapRows : []);
      setBatterySwapsDailyData(Array.isArray(swapDaily) ? swapDaily : []);
      setBatteryTopBatteriesData(Array.isArray(topBatteries) ? topBatteries : []);
      setBatteryTopVehiclesData(Array.isArray(topVehicles) ? topVehicles : []);
    } catch (e) {
      setError(String(e?.message || e || "Unable to load battery swaps"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    load();
    const interval = setInterval(() => {
      if (!mounted) return;
      load();
    }, 20000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapRefresh]);

  useEffect(() => {
    setSelectedSwapIds((prev) =>
      prev.filter((id) => (batterySwaps || []).some((row) => String(row?.id) === id))
    );
  }, [batterySwaps]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeDetails();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsOpen]);

  const startEditSwap = (row) => {
    setEditingSwapId(String(row?.id || ""));
    setSwapDraft({
      vehicle_number: row?.vehicle_number || "",
      battery_out: row?.battery_out || "",
      battery_in: row?.battery_in || "",
      swapped_at: toDateTimeLocal(row?.swapped_at || row?.created_at),
      notes: row?.notes || "",
      employee_email: row?.employee_email || "",
      employee_uid: row?.employee_uid || "",
    });

    setEditVehicleOpen(false);
    setEditBatteryInOpen(false);
    setEditBatteryOutOpen(false);
    setEditVehicleQuery("");
    setEditBatteryInQuery("");
    setEditBatteryOutQuery("");
  };

  const cancelEditSwap = () => {
    setEditingSwapId("");
    setSwapDraft(null);

    setEditVehicleOpen(false);
    setEditBatteryInOpen(false);
    setEditBatteryOutOpen(false);
    setEditVehicleQuery("");
    setEditBatteryInQuery("");
    setEditBatteryOutQuery("");
  };

  const filteredEditVehicleIds = useMemo(() => {
    const q = String(editVehicleQuery || "").trim().toUpperCase();
    if (!q) return VEHICLE_ID_OPTIONS;
    return VEHICLE_ID_OPTIONS.filter((id) => id.includes(q));
  }, [editVehicleQuery]);

  const filteredEditBatteryInIds = useMemo(() => {
    const q = String(editBatteryInQuery || "").trim().toUpperCase();
    if (!q) return BATTERY_ID_OPTIONS;
    return BATTERY_ID_OPTIONS.filter((id) => id.includes(q));
  }, [editBatteryInQuery]);

  const filteredEditBatteryOutIds = useMemo(() => {
    const q = String(editBatteryOutQuery || "").trim().toUpperCase();
    if (!q) return BATTERY_ID_OPTIONS;
    return BATTERY_ID_OPTIONS.filter((id) => id.includes(q));
  }, [editBatteryOutQuery]);

  useEffect(() => {
    if (!editVehicleOpen && !editBatteryInOpen && !editBatteryOutOpen) return;

    const onMouseDown = (e) => {
      if (editVehicleOpen && vehicleDropdownRef.current && !vehicleDropdownRef.current.contains(e.target)) {
        setEditVehicleOpen(false);
      }
      if (editBatteryInOpen && batteryInDropdownRef.current && !batteryInDropdownRef.current.contains(e.target)) {
        setEditBatteryInOpen(false);
      }
      if (editBatteryOutOpen && batteryOutDropdownRef.current && !batteryOutDropdownRef.current.contains(e.target)) {
        setEditBatteryOutOpen(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [editVehicleOpen, editBatteryInOpen, editBatteryOutOpen]);

  const saveSwap = async (id) => {
    if (!id || !swapDraft) return;
    setSwapBusy(true);
    try {
      const swappedAtIso = swapDraft.swapped_at ? new Date(swapDraft.swapped_at).toISOString() : null;
      const updated = await adminUpdateBatterySwap(id, {
        vehicle_number: swapDraft.vehicle_number,
        battery_out: swapDraft.battery_out,
        battery_in: swapDraft.battery_in,
        swapped_at: swappedAtIso,
        notes: swapDraft.notes,
        employee_email: swapDraft.employee_email,
        employee_uid: swapDraft.employee_uid,
      });

      setBatterySwaps((prev) =>
        (prev || []).map((r) => (String(r?.id) === String(id) ? { ...r, ...(updated || {}) } : r))
      );
      cancelEditSwap();
      setSwapRefresh((x) => x + 1);
    } catch (e) {
      setError(String(e?.message || e || "Unable to update swap"));
    } finally {
      setSwapBusy(false);
    }
  };

  const deleteSwap = async (id) => {
    if (!id) return;
    const ok = window.confirm("Delete this battery swap?");
    if (!ok) return;
    setSwapBusy(true);
    try {
      await adminDeleteBatterySwap(id);
      setBatterySwaps((prev) => (prev || []).filter((r) => String(r?.id) !== String(id)));
      setSelectedSwapIds((prev) => prev.filter((x) => String(x) !== String(id)));
      if (String(editingSwapId) === String(id)) cancelEditSwap();
      setSwapRefresh((x) => x + 1);
    } catch (e) {
      setError(String(e?.message || e || "Unable to delete swap"));
    } finally {
      setSwapBusy(false);
    }
  };

  const toggleSwapSelection = (id) => {
    const key = String(id);
    setSelectedSwapIds((prev) => {
      if (prev.includes(key)) {
        return prev.filter((x) => x !== key);
      }
      return [...prev, key];
    });
  };

  const toggleSelectCurrentPage = () => {
    if (allPageSelected) {
      setSelectedSwapIds((prev) => prev.filter((id) => !currentPageIds.includes(id)));
      return;
    }
    setSelectedSwapIds((prev) => {
      const next = new Set(prev);
      currentPageIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const bulkDeleteSelected = async () => {
    if (selectedSwapIds.length === 0) return;
    const ok = window.confirm(`Delete ${selectedSwapIds.length} selected swap${selectedSwapIds.length === 1 ? "" : "s"
      }?`);
    if (!ok) return;
    setSwapBusy(true);
    try {
      await adminDeleteBatterySwaps(selectedSwapIds);
      setBatterySwaps((prev) =>
        (prev || []).filter((row) => !selectedSwapIds.includes(String(row?.id)))
      );
      setSelectedSwapIds([]);
      setSwapRefresh((x) => x + 1);
    } catch (e) {
      setError(String(e?.message || e || "Unable to delete selected swaps"));
    } finally {
      setSwapBusy(false);
    }
  };

  const headerStats = useMemo(() => {
    return {
      totalSwapsShown: (batterySwaps || []).length,
      topBattery: (batteryTopBatteriesData || [])[0]?.battery_id || "-",
      topVehicle: (batteryTopVehiclesData || [])[0]?.vehicle_number || "-",
    };
  }, [batterySwaps, batteryTopBatteriesData, batteryTopVehiclesData]);

  const visibleSwaps = useMemo(() => {
    return Array.isArray(batterySwaps) ? batterySwaps : [];
  }, [batterySwaps]);

  const visibleSwapIds = useMemo(
    () => visibleSwaps.map((row) => String(row?.id || "")),
    [visibleSwaps]
  );

  const allVisibleSelected =
    visibleSwapIds.length > 0 && visibleSwapIds.every((id) => selectedSwapIds.includes(id));

  const toggleSelectVisible = () => {
    if (allVisibleSelected) {
      setSelectedSwapIds((prev) => prev.filter((id) => !visibleSwapIds.includes(id)));
      return;
    }
    setSelectedSwapIds((prev) => {
      const next = new Set(prev);
      visibleSwapIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  return (
    <div className="h-screen w-full flex bg-white relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-20 left-20 w-72 h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse"></div>
        <div className="absolute top-40 right-20 w-72 h-72 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-40 w-72 h-72 bg-pink-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse animation-delay-4000"></div>
      </div>

      <div className="flex relative z-10 w-full">
        <AdminSidebar />
        <main className="flex-1 w-full min-w-0 overflow-y-auto relative z-10 p-8 pb-0 overflow-x-hidden sm:ml-64">
          <div className="p-6">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">Battery Swaps</h1>
              <p className="text-slate-600 mt-2 text-base font-normal">View, edit, and delete battery swap records.</p>
            </div>

            {error ? (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              {[
                ["Swaps Loaded", headerStats.totalSwapsShown, "text-slate-800", Battery],
                ["Top Battery (30 days)", headerStats.topBattery, "text-blue-600", TrendingUp],
                ["Top Vehicle (30 days)", headerStats.topVehicle, "text-green-600", Car],
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

            <div className="mb-8 grid grid-cols-1 gap-5 xl:grid-cols-3">
              <div className="xl:col-span-2 bg-white/70 backdrop-blur-xl rounded-2xl p-6 shadow-xl border border-white/30">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <h2 className="text-base font-semibold text-evegah-text">Battery Swaps (14 Days)</h2>
                  <span className="text-xs text-evegah-muted">Area</span>
                </div>

                <div className="text-blue-600">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={batterySwapsDailyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="swaps"
                        stroke="currentColor"
                        fill="currentColor"
                        fillOpacity={0.18}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-6 shadow-xl border border-white/30">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <h2 className="text-base font-semibold text-evegah-text">Top Batteries (30 Days)</h2>
                  <span className="text-xs text-evegah-muted">Pie</span>
                </div>

                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={batteryTopBatteriesData} dataKey="installs" nameKey="battery_id" outerRadius={90} label>
                      {(batteryTopBatteriesData || []).map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/30 overflow-hidden">
              <div className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h2 className="text-base font-semibold text-evegah-text">Battery Swaps</h2>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    {selectedSwapIds.length > 0 ? (
                      <span className="text-xs text-red-600">
                        {selectedSwapIds.length} selected
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="btn-outline text-red-600"
                      disabled={selectedSwapIds.length === 0 || swapBusy}
                      onClick={bulkDeleteSelected}
                    >
                      Delete Selected
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn-primary"
                    disabled={swapBusy}
                    onClick={() => setSwapRefresh((x) => x + 1)}
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {loading && (batterySwaps || []).length === 0 ? (
                <div className="p-6 text-center text-gray-500">Loading swaps…</div>
              ) : visibleSwaps.length === 0 ? (
                <div className="p-6 text-center text-gray-500">No swaps found.</div>
              ) : (
                <div className="space-y-4">
                  {/* Bulk Actions Bar */}
                  <div className="flex items-center justify-between bg-white/60 backdrop-blur-xl rounded-2xl p-4 border border-white/30">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-3 text-slate-700 font-medium">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleSelectVisible}
                          className="w-4 h-4 text-blue-600 bg-white/50 border-white/50 rounded focus:ring-blue-500/50"
                        />
                        Select All ({visibleSwaps.length})
                      </label>
                      {selectedSwapIds.length > 0 && (
                        <span className="text-sm text-blue-600 font-semibold bg-blue-100/80 px-3 py-1 rounded-full">
                          {selectedSwapIds.length} selected
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {selectedSwapIds.length > 0 && (
                        <button
                          type="button"
                          className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold shadow-lg hover:bg-red-600 transition-all duration-200"
                          disabled={swapBusy}
                          onClick={bulkDeleteSelected}
                        >
                          Delete Selected
                        </button>
                      )}
                      <button
                        type="button"
                        className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-semibold shadow-lg hover:bg-blue-600 transition-all duration-200"
                        disabled={swapBusy}
                        onClick={() => setSwapRefresh((x) => x + 1)}
                      >
                        Refresh
                      </button>
                    </div>
                  </div>

                  {/* Cards Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    {visibleSwaps.map((row, index) => (
                      <div
                        key={row?.id}
                        className="group relative bg-white/70 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-white/30 hover:shadow-2xl hover:scale-102 transition-all duration-300 cursor-pointer overflow-hidden"
                      >
                        {/* Selection Indicator */}
                        <div className="absolute top-4 right-4 z-10">
                          <button
                            type="button"
                            onClick={() => toggleSwapSelection(row?.id)}
                            className="w-8 h-8 rounded-xl bg-white/80 backdrop-blur-sm border border-white/40 flex items-center justify-center hover:bg-white/90 transition-all duration-200"
                          >
                            {selectedSwapIds.includes(String(row?.id || "")) ? (
                              <CheckSquare className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        </div>

                        {/* Floating geometric shapes */}
                        <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-blue-400/10 to-purple-400/10 rounded-full -translate-y-8 translate-x-8 group-hover:scale-110 transition-transform duration-500"></div>
                        <div className="absolute bottom-0 left-0 w-16 h-16 bg-gradient-to-br from-purple-400/10 to-pink-400/10 rounded-2xl translate-y-6 -translate-x-6 group-hover:rotate-12 transition-transform duration-500"></div>

                        <div className="relative z-10">
                          {/* Header */}
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                                <Zap className="w-6 h-6 text-white" />
                              </div>
                              <div>
                                <h3 className="text-lg font-bold text-slate-900">Swap #{String(row?.id || "").slice(-4)}</h3>
                                <p className="text-sm text-slate-500">Battery Exchange</p>
                              </div>
                            </div>
                          </div>

                          {/* Content Grid */}
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-slate-400" />
                                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Time</span>
                              </div>
                              <p className="text-sm font-semibold text-slate-800">{fmtSwapTime(row?.swapped_at || row?.created_at)}</p>
                            </div>

                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <Car className="w-4 h-4 text-slate-400" />
                                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Vehicle</span>
                              </div>
                              <p className="text-sm font-semibold text-slate-800">{row?.vehicle_number || "-"}</p>
                            </div>

                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <Battery className="w-4 h-4 text-red-400" />
                                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Battery Out</span>
                              </div>
                              <p className="text-sm font-semibold text-red-600">{row?.battery_out || "-"}</p>
                            </div>

                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <Battery className="w-4 h-4 text-green-400" />
                                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Battery In</span>
                              </div>
                              <p className="text-sm font-semibold text-green-600">{row?.battery_in || "-"}</p>
                            </div>
                          </div>

                          {/* Rider Info */}
                          <div className="bg-slate-50/50 rounded-2xl p-3 mb-4">
                            <div className="flex items-center gap-2 mb-2">
                              <User className="w-4 h-4 text-slate-400" />
                              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Rider</span>
                            </div>
                            <p className="text-sm font-semibold text-slate-800">{row?.rider_full_name || row?.rider_mobile || "-"}</p>
                            {row?.rider_mobile && (
                              <p className="text-xs text-slate-500 mt-1">{row.rider_mobile}</p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center justify-between pt-3 border-t border-white/30">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all duration-200 text-sm font-medium"
                                onClick={() =>
                                  openDetailsWithSearch({
                                    title: row?.vehicle_number ? `Vehicle ${row.vehicle_number}` : "Swap Details",
                                    subtitle: row?.rider_mobile
                                      ? `Rider: ${row.rider_full_name || "-"} (${row.rider_mobile})`
                                      : "Swap history",
                                    search: row?.vehicle_number || row?.rider_mobile || "",
                                    selectedRow: row,
                                  })
                                }
                              >
                                <Eye className="w-4 h-4" />
                                View
                              </button>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="p-2 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all duration-200"
                                title="Edit"
                                disabled={swapBusy}
                                onClick={() => {
                                  openDetailsWithSearch({
                                    title: row?.vehicle_number ? `Vehicle ${row.vehicle_number}` : "Swap Details",
                                    subtitle: row?.rider_mobile
                                      ? `Rider: ${row.rider_full_name || "-"} (${row.rider_mobile})`
                                      : "Swap history",
                                    search: row?.vehicle_number || row?.rider_mobile || "",
                                    selectedRow: row,
                                  });
                                  setDetailsMode("edit");
                                  startEditSwap(row);
                                }}
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                className="p-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-all duration-200"
                                title="Delete"
                                disabled={swapBusy}
                                onClick={async () => {
                                  await deleteSwap(row?.id);
                                  setSwapRefresh((x) => x + 1);
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Empty State */}
                  {visibleSwaps.length === 0 && (
                    <div className="text-center py-12">
                      <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                        <Battery className="w-12 h-12 text-slate-400" />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-2">No Battery Swaps Found</h3>
                      <p className="text-slate-500">There are no battery swap records to display.</p>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </main>

        {detailsOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => {
              // close when clicking backdrop
              if (e.target === e.currentTarget) closeDetails();
            }}
          >
            <div className="w-full max-w-5xl bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/30">
              <div className="flex items-start justify-between gap-4 border-b border-evegah-border p-4">
                <div>
                  <div className="text-lg font-semibold text-evegah-text">{detailsTitle}</div>
                  {detailsSubtitle ? <div className="text-sm text-evegah-muted">{detailsSubtitle}</div> : null}
                  {detailsSearch ? <div className="text-xs text-evegah-muted mt-1">Search: {detailsSearch}</div> : null}
                </div>
                <div className="flex items-center gap-2">
                  {detailsSelectedRow && detailsMode !== "edit" ? (
                    <>
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={swapBusy}
                        onClick={() => {
                          setDetailsMode("edit");
                          startEditSwap(detailsSelectedRow);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-muted"
                        disabled={swapBusy}
                        onClick={async () => {
                          await deleteSwap(detailsSelectedRow?.id);
                          closeDetails();
                        }}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}

                  {detailsMode === "edit" ? (
                    <button
                      type="button"
                      className="btn-muted"
                      disabled={swapBusy}
                      onClick={() => {
                        cancelEditSwap();
                        setDetailsMode("view");
                      }}
                    >
                      Cancel Edit
                    </button>
                  ) : null}

                  <button type="button" className="btn-primary" onClick={closeDetails}>
                    Close
                  </button>
                </div>
              </div>

              <div className="p-4">
                {detailsMode === "edit" && swapDraft ? (
                  <div className="mb-4 rounded-2xl border border-evegah-border bg-evegah-card p-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <div className="label">Swapped At</div>
                        <input
                          type="datetime-local"
                          className="input"
                          value={swapDraft?.swapped_at || ""}
                          onChange={(e) => setSwapDraft((p) => ({ ...(p || {}), swapped_at: e.target.value }))}
                        />
                      </div>

                      <div>
                        <div className="label">Vehicle</div>
                        <div ref={(el) => (vehicleDropdownRef.current = el)} className="relative">
                          <button
                            type="button"
                            className="select flex items-center justify-between gap-3"
                            aria-haspopup="listbox"
                            aria-expanded={editVehicleOpen}
                            onClick={() => {
                              setEditVehicleOpen((v) => {
                                const next = !v;
                                if (!v && next) setTimeout(() => vehicleQueryRef.current?.focus?.(), 0);
                                return next;
                              });
                            }}
                          >
                            <span className={swapDraft?.vehicle_number ? "text-evegah-text" : "text-gray-500"}>
                              {swapDraft?.vehicle_number || "Select Vehicle"}
                            </span>
                            <span className="text-gray-400">▾</span>
                          </button>
                          {editVehicleOpen ? (
                            <div className="absolute z-20 mt-2 w-full rounded-xl border border-evegah-border bg-white shadow-card p-2">
                              <input
                                ref={(el) => (vehicleQueryRef.current = el)}
                                className="input"
                                placeholder="Search vehicle id..."
                                value={editVehicleQuery}
                                onChange={(e) => setEditVehicleQuery(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setEditVehicleOpen(false);
                                  }
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (filteredEditVehicleIds.length === 1) {
                                      const id = filteredEditVehicleIds[0];
                                      setSwapDraft((p) => ({ ...(p || {}), vehicle_number: id }));
                                      setEditVehicleOpen(false);
                                      setEditVehicleQuery("");
                                    }
                                  }
                                }}
                              />
                              <div className="mt-2 max-h-48 overflow-y-auto" role="listbox">
                                {filteredEditVehicleIds.length === 0 ? (
                                  <div className="px-3 py-2 text-sm text-gray-500">No matching vehicle id.</div>
                                ) : (
                                  filteredEditVehicleIds.map((id) => (
                                    <button
                                      key={id}
                                      type="button"
                                      className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 ${id === swapDraft?.vehicle_number ? "bg-gray-100" : ""
                                        }`}
                                      onClick={() => {
                                        setSwapDraft((p) => ({ ...(p || {}), vehicle_number: id }));
                                        setEditVehicleOpen(false);
                                        setEditVehicleQuery("");
                                      }}
                                    >
                                      {id}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <div className="label">Battery OUT</div>
                        <div ref={(el) => (batteryOutDropdownRef.current = el)} className="relative">
                          <button
                            type="button"
                            className="select flex items-center justify-between gap-3"
                            aria-haspopup="listbox"
                            aria-expanded={editBatteryOutOpen}
                            onClick={() => {
                              setEditBatteryOutOpen((v) => {
                                const next = !v;
                                if (!v && next) setTimeout(() => batteryOutQueryRef.current?.focus?.(), 0);
                                return next;
                              });
                            }}
                          >
                            <span className={swapDraft?.battery_out ? "text-evegah-text" : "text-gray-500"}>
                              {swapDraft?.battery_out || "Select Battery OUT"}
                            </span>
                            <span className="text-gray-400">▾</span>
                          </button>
                          {editBatteryOutOpen ? (
                            <div className="absolute z-20 mt-2 w-full rounded-xl border border-evegah-border bg-white shadow-card p-2">
                              <input
                                ref={(el) => (batteryOutQueryRef.current = el)}
                                className="input"
                                placeholder="Search battery id..."
                                value={editBatteryOutQuery}
                                onChange={(e) => setEditBatteryOutQuery(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setEditBatteryOutOpen(false);
                                  }
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (filteredEditBatteryOutIds.length === 1) {
                                      const id = filteredEditBatteryOutIds[0];
                                      setSwapDraft((p) => ({ ...(p || {}), battery_out: id }));
                                      setEditBatteryOutOpen(false);
                                      setEditBatteryOutQuery("");
                                    }
                                  }
                                }}
                              />
                              <div className="mt-2 max-h-48 overflow-y-auto" role="listbox">
                                {filteredEditBatteryOutIds.length === 0 ? (
                                  <div className="px-3 py-2 text-sm text-gray-500">No matching battery id.</div>
                                ) : (
                                  filteredEditBatteryOutIds.map((id) => (
                                    <button
                                      key={id}
                                      type="button"
                                      className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 ${id === swapDraft?.battery_out ? "bg-gray-100" : ""
                                        }`}
                                      onClick={() => {
                                        setSwapDraft((p) => ({ ...(p || {}), battery_out: id }));
                                        setEditBatteryOutOpen(false);
                                        setEditBatteryOutQuery("");
                                      }}
                                    >
                                      {id}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <div className="label">Battery IN</div>
                        <div ref={(el) => (batteryInDropdownRef.current = el)} className="relative">
                          <button
                            type="button"
                            className="select flex items-center justify-between gap-3"
                            aria-haspopup="listbox"
                            aria-expanded={editBatteryInOpen}
                            onClick={() => {
                              setEditBatteryInOpen((v) => {
                                const next = !v;
                                if (!v && next) setTimeout(() => batteryInQueryRef.current?.focus?.(), 0);
                                return next;
                              });
                            }}
                          >
                            <span className={swapDraft?.battery_in ? "text-evegah-text" : "text-gray-500"}>
                              {swapDraft?.battery_in || "Select Battery IN"}
                            </span>
                            <span className="text-gray-400">▾</span>
                          </button>
                          {editBatteryInOpen ? (
                            <div className="absolute z-20 mt-2 w-full rounded-xl border border-evegah-border bg-white shadow-card p-2">
                              <input
                                ref={(el) => (batteryInQueryRef.current = el)}
                                className="input"
                                placeholder="Search battery id..."
                                value={editBatteryInQuery}
                                onChange={(e) => setEditBatteryInQuery(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setEditBatteryInOpen(false);
                                  }
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (filteredEditBatteryInIds.length === 1) {
                                      const id = filteredEditBatteryInIds[0];
                                      setSwapDraft((p) => ({ ...(p || {}), battery_in: id }));
                                      setEditBatteryInOpen(false);
                                      setEditBatteryInQuery("");
                                    }
                                  }
                                }}
                              />
                              <div className="mt-2 max-h-48 overflow-y-auto" role="listbox">
                                {filteredEditBatteryInIds.length === 0 ? (
                                  <div className="px-3 py-2 text-sm text-gray-500">No matching battery id.</div>
                                ) : (
                                  filteredEditBatteryInIds.map((id) => (
                                    <button
                                      key={id}
                                      type="button"
                                      className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 ${id === swapDraft?.battery_in ? "bg-gray-100" : ""
                                        }`}
                                      onClick={() => {
                                        setSwapDraft((p) => ({ ...(p || {}), battery_in: id }));
                                        setEditBatteryInOpen(false);
                                        setEditBatteryInQuery("");
                                      }}
                                    >
                                      {id}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="md:col-span-2">
                        <div className="label">Notes</div>
                        <textarea
                          className="textarea h-[78px]"
                          value={swapDraft?.notes || ""}
                          onChange={(e) => setSwapDraft((p) => ({ ...(p || {}), notes: e.target.value }))}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={swapBusy}
                            onClick={async () => {
                              await saveSwap(detailsSelectedRow?.id);
                              setDetailsMode("view");
                            }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn-muted"
                            disabled={swapBusy}
                            onClick={() => {
                              cancelEditSwap();
                              setDetailsMode("view");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="text-sm text-evegah-muted mb-3">
                  {detailsLoading ? "Loading details..." : `Records: ${(detailsRows || []).length}`}
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-evegah-muted">
                        <th className="py-2 pr-3">Time</th>
                        <th className="py-2 pr-3">Rider</th>
                        <th className="py-2 pr-3">Mobile</th>
                        <th className="py-2 pr-3">Vehicle</th>
                        <th className="py-2 pr-3">Battery Out</th>
                        <th className="py-2 pr-3">Battery In</th>
                        <th className="py-2 pr-3">Employee</th>
                        <th className="py-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-evegah-border">
                      {detailsLoading ? (
                        <tr>
                          <td className="py-3 text-evegah-muted" colSpan={8}>
                            Loading...
                          </td>
                        </tr>
                      ) : (detailsRows || []).length === 0 ? (
                        <tr>
                          <td className="py-3 text-evegah-muted" colSpan={8}>
                            No records found.
                          </td>
                        </tr>
                      ) : (
                        (detailsRows || []).map((row) => (
                          <tr key={row.id}>
                            <td className="py-2 pr-3 whitespace-nowrap">{fmtSwapTime(row.swapped_at || row.created_at)}</td>
                            <td className="py-2 pr-3 whitespace-nowrap">{row.rider_full_name || "-"}</td>
                            <td className="py-2 pr-3 whitespace-nowrap text-evegah-muted">{row.rider_mobile || "-"}</td>
                            <td className="py-2 pr-3 whitespace-nowrap">{row.vehicle_number || "-"}</td>
                            <td className="py-2 pr-3 whitespace-nowrap">{row.battery_out || "-"}</td>
                            <td className="py-2 pr-3 whitespace-nowrap">{row.battery_in || "-"}</td>
                            <td className="py-2 pr-3 whitespace-nowrap text-evegah-muted">{row.employee_email || "-"}</td>
                            <td className="py-2">{row.notes || "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
