import { useEffect, useMemo, useRef, useState } from "react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import EmployeeLayout from "../../../components/layouts/EmployeeLayout";
import useAuth from "../../../hooks/useAuth";
import {
  createBatterySwap,
  getBatteryUsage,
  listBatterySwaps,
} from "../../../utils/batterySwaps";
import { BATTERY_ID_OPTIONS } from "../../../utils/batteryIds";
import { VEHICLE_ID_OPTIONS } from "../../../utils/vehicleIds";
import { apiFetch } from "../../../config/api";
import { formatDateTimeDDMMYYYY } from "../../../utils/dateFormat";

const normalizeId = (value) => String(value || "").trim().toUpperCase();
const normalizeForCompare = (value) =>
  String(value || "").replace(/[^a-z0-9]+/gi, "").toUpperCase();

const bannerStyles = {
  success: "bg-green-50 border-green-200 text-green-700",
  warning: "bg-yellow-50 border-yellow-200 text-yellow-700",
  info: "bg-blue-50 border-blue-200 text-blue-700",
  error: "bg-red-50 border-red-200 text-red-700",
};

function KpiCard({ label, value, helper, period, onPeriodChange, showPeriod }) {

  return (
    <div className="rounded-2xl border border-evegah-border bg-white shadow-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-evegah-text">{label}</p>

        {showPeriod ? (
          <select
            className="rounded-lg border border-evegah-border bg-white px-2 py-1 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-evegah-primary"
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
          >
            <option value="day">Day</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        ) : null}
      </div>

      <p className="mt-3 text-4xl font-semibold text-evegah-text leading-none">{value}</p>
      {helper ? <p className="mt-1 text-xs text-gray-500">{helper}</p> : null}
    </div>
  );
}

export default function BatterySwaps() {
  const { user, loading } = useAuth();

  const [kpiPeriod, setKpiPeriod] = useState("day");

  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  const [usageRows, setUsageRows] = useState([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const [usageQuery, setUsageQuery] = useState("");
  const [usageSort, setUsageSort] = useState("installs");
  const [selectedUsageBatteries, setSelectedUsageBatteries] = useState([]);
  const [usageBatteryDropdownOpen, setUsageBatteryDropdownOpen] = useState(false);
  const [usageBatteryFilterQuery, setUsageBatteryFilterQuery] = useState("");

  const RIDER_PAGE_SIZE = 5;
  const [riderPage, setRiderPage] = useState(1);

  const [riderDetailsOpen, setRiderDetailsOpen] = useState(false);
  const [riderDetailsLoading, setRiderDetailsLoading] = useState(false);
  const [riderDetails, setRiderDetails] = useState(null);
  const [riderSwapRows, setRiderSwapRows] = useState([]);

  const [form, setForm] = useState({
    riderId: "",
    riderName: "",
    riderPhone: "",
    vehicleNumber: "",
    batteryOut: "",
    batteryIn: "",
    notes: "",
  });

  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);

  const riderDropdownRef = useRef(null);
  const riderQueryRef = useRef(null);
  const vehicleDropdownRef = useRef(null);
  const vehicleQueryRef = useRef(null);
  const batteryOutDropdownRef = useRef(null);
  const batteryInDropdownRef = useRef(null);
  const batteryOutQueryRef = useRef(null);
  const batteryInQueryRef = useRef(null);
  const usageBatteryDropdownRef = useRef(null);

  const [riderOptions, setRiderOptions] = useState([]);
  const [riderLoading, setRiderLoading] = useState(true);
  const [riderQuery, setRiderQuery] = useState("");
  const [riderDropdownOpen, setRiderDropdownOpen] = useState(false);

  const [vehicleDropdownOpen, setVehicleDropdownOpen] = useState(false);
  const [vehicleQuery, setVehicleQuery] = useState("");

  const [batteryOutDropdownOpen, setBatteryOutDropdownOpen] = useState(false);
  const [batteryOutQuery, setBatteryOutQuery] = useState("");
  const [batteryInDropdownOpen, setBatteryInDropdownOpen] = useState(false);
  const [batteryInQuery, setBatteryInQuery] = useState("");

  const canLoad = useMemo(() => !loading && Boolean(user?.uid), [loading, user?.uid]);

  const usageChartRows = useMemo(() => {
    const q = String(usageQuery || "").trim().toUpperCase();
    const selected = Array.isArray(selectedUsageBatteries) ? selectedUsageBatteries : [];
    const selectedSet = new Set(selected.map((v) => normalizeId(v)).filter(Boolean));
    const all = Array.isArray(usageRows) ? usageRows : [];
    const mapped = all.map((u) => {
      const installs = Number(u?.installs || 0);
      const removals = Number(u?.removals || 0);
      return {
        battery: String(u?.battery_id || "").toUpperCase(),
        installs,
        removals,
        total: installs + removals,
      };
    });

    const filtered = q
      ? mapped.filter((r) => r.battery.includes(q))
      : mapped;

    const filteredBySelection = selectedSet.size
      ? filtered.filter((r) => selectedSet.has(r.battery))
      : filtered;

    const sortKey = usageSort;
    const sorted = [...filteredBySelection].sort((a, b) => {
      if (sortKey === "removals") return b.removals - a.removals;
      if (sortKey === "total") return b.total - a.total;
      return b.installs - a.installs;
    });

    return sorted;
  }, [usageRows, usageQuery, usageSort, selectedUsageBatteries]);

  const usageBatteryOptions = useMemo(() => {
    const all = Array.isArray(usageRows) ? usageRows : [];
    return Array.from(
      new Set(
        all
          .map((u) => String(u?.battery_id || "").trim().toUpperCase())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [usageRows]);

  const filteredUsageBatteryOptions = useMemo(() => {
    const q = normalizeForCompare(usageBatteryFilterQuery);
    if (!q) return usageBatteryOptions;
    return usageBatteryOptions.filter((id) => normalizeForCompare(id).includes(q));
  }, [usageBatteryOptions, usageBatteryFilterQuery]);

  const toggleSelectedUsageBattery = (batteryId) => {
    const nextId = normalizeId(batteryId);
    if (!nextId) return;
    setSelectedUsageBatteries((prev) => {
      const safePrev = Array.isArray(prev) ? prev : [];
      const exists = safePrev.some((v) => normalizeId(v) === nextId);
      return exists ? safePrev.filter((v) => normalizeId(v) !== nextId) : [...safePrev, nextId];
    });
  };

  const removeSelectedUsageBattery = (batteryId) => {
    const nextId = normalizeId(batteryId);
    setSelectedUsageBatteries((prev) => (Array.isArray(prev) ? prev.filter((v) => normalizeId(v) !== nextId) : []));
  };

  const clearSelectedUsageBatteries = () => {
    setSelectedUsageBatteries([]);
    setUsageBatteryFilterQuery("");
  };

  const usageChartHeight = useMemo(() => {
    // ~28px per row keeps labels readable; capped by scroll container anyway.
    return Math.max(260, usageChartRows.length * 28);
  }, [usageChartRows.length]);

  const riderGroups = useMemo(() => {
    const all = Array.isArray(rows) ? rows : [];
    const map = new Map();

    for (const r of all) {
      const riderId = r?.rider_id ? String(r.rider_id) : "";
      const key = riderId || `vehicle:${String(r?.vehicle_number || "")}`;
      const swappedAt = r?.swapped_at ? new Date(r.swapped_at) : null;
      const swappedAtMs = swappedAt && !Number.isNaN(swappedAt.getTime()) ? swappedAt.getTime() : 0;

      const prev = map.get(key);
      const next = prev
        ? {
            ...prev,
            swapCount: prev.swapCount + 1,
            lastSwappedAtMs: Math.max(prev.lastSwappedAtMs, swappedAtMs),
            lastVehicle: prev.lastSwappedAtMs >= swappedAtMs ? prev.lastVehicle : r?.vehicle_number,
            lastBatteryOut: prev.lastSwappedAtMs >= swappedAtMs ? prev.lastBatteryOut : r?.battery_out,
            lastBatteryIn: prev.lastSwappedAtMs >= swappedAtMs ? prev.lastBatteryIn : r?.battery_in,
          }
        : {
            key,
            rider_id: riderId || null,
            rider_full_name: r?.rider_full_name || "-",
            rider_mobile: r?.rider_mobile || "-",
            swapCount: 1,
            lastSwappedAtMs: swappedAtMs,
            lastVehicle: r?.vehicle_number || "",
            lastBatteryOut: r?.battery_out || "",
            lastBatteryIn: r?.battery_in || "",
          };

      map.set(key, next);
    }

    return Array.from(map.values())
      .sort((a, b) => b.lastSwappedAtMs - a.lastSwappedAtMs)
      .map((g) => ({
        ...g,
        lastSwappedAt: g.lastSwappedAtMs ? new Date(g.lastSwappedAtMs).toISOString() : null,
      }));
  }, [rows]);

  const riderTotal = riderGroups.length;
  const riderPageCount = Math.max(1, Math.ceil(riderTotal / RIDER_PAGE_SIZE));
  const riderPageRows = riderGroups.slice((riderPage - 1) * RIDER_PAGE_SIZE, riderPage * RIDER_PAGE_SIZE);
  const riderStart = riderTotal ? (riderPage - 1) * RIDER_PAGE_SIZE + 1 : 0;
  const riderEnd = Math.min(riderTotal, riderPage * RIDER_PAGE_SIZE);

  useEffect(() => {
    setRiderPage(1);
  }, [riderTotal]);

  const openRiderDetails = async (groupRow) => {
    if (!groupRow) return;
    setRiderDetails(groupRow);
    setRiderDetailsOpen(true);
    setRiderDetailsLoading(true);
    setRiderSwapRows([]);

    if (!groupRow.rider_id) {
      setRiderDetailsLoading(false);
      setRiderSwapRows([]);
      return;
    }

    try {
      const data = await apiFetch(`/api/riders/${encodeURIComponent(groupRow.rider_id)}/battery-swaps`);
      setRiderSwapRows(Array.isArray(data) ? data : []);
    } catch {
      setRiderSwapRows([]);
    } finally {
      setRiderDetailsLoading(false);
    }
  };

  const kpis = useMemo(() => {
    const all = Array.isArray(rows) ? rows : [];
    const now = new Date();

    const start = (() => {
      if (kpiPeriod === "day") {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      }
      if (kpiPeriod === "week") {
        return now.getTime() - 7 * 24 * 60 * 60 * 1000;
      }
      if (kpiPeriod === "month") {
        return now.getTime() - 30 * 24 * 60 * 60 * 1000;
      }
      if (kpiPeriod === "year") {
        return now.getTime() - 365 * 24 * 60 * 60 * 1000;
      }
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    })();

    const end = kpiPeriod === "day"
      ? start + 24 * 60 * 60 * 1000
      : now.getTime() + 1;

    const periodRows = all.filter((r) => {
      const t = r?.swapped_at ? new Date(r.swapped_at).getTime() : NaN;
      return Number.isFinite(t) && t >= start && t < end;
    });

    const uniqueVehicles = new Set(
      periodRows.map((r) => String(r?.vehicle_number || "").trim()).filter(Boolean)
    ).size;

    const uniqueBatteries = new Set(
      periodRows
        .flatMap((r) => [r?.battery_out, r?.battery_in])
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    ).size;

    return {
      swapsInPeriod: periodRows.length,
      swapsTotal: all.length,
      uniqueVehicles,
      uniqueBatteries,
    };
  }, [rows, kpiPeriod]);

  useEffect(() => {
    let mounted = true;
    setRiderLoading(true);
    apiFetch("/api/riders?limit=200")
      .then((result) => {
        if (!mounted) return;
        setRiderOptions(Array.isArray(result?.data) ? result.data : []);
      })
      .catch(() => {
        if (!mounted) return;
        setRiderOptions([]);
      })
      .finally(() => {
        if (!mounted) return;
        setRiderLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (
      !vehicleDropdownOpen &&
      !batteryOutDropdownOpen &&
      !batteryInDropdownOpen &&
      !riderDropdownOpen &&
      !usageBatteryDropdownOpen
    ) {
      return undefined;
    }

    const onMouseDown = (event) => {
      const target = event.target;
      if (vehicleDropdownOpen && vehicleDropdownRef.current && !vehicleDropdownRef.current.contains(target)) {
        setVehicleDropdownOpen(false);
      }
      if (batteryOutDropdownOpen && batteryOutDropdownRef.current && !batteryOutDropdownRef.current.contains(target)) {
        setBatteryOutDropdownOpen(false);
      }
      if (batteryInDropdownOpen && batteryInDropdownRef.current && !batteryInDropdownRef.current.contains(target)) {
        setBatteryInDropdownOpen(false);
      }
      if (riderDropdownOpen && riderDropdownRef.current && !riderDropdownRef.current.contains(target)) {
        setRiderDropdownOpen(false);
      }
      if (
        usageBatteryDropdownOpen &&
        usageBatteryDropdownRef.current &&
        !usageBatteryDropdownRef.current.contains(target)
      ) {
        setUsageBatteryDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [
    vehicleDropdownOpen,
    batteryOutDropdownOpen,
    batteryInDropdownOpen,
    riderDropdownOpen,
    usageBatteryDropdownOpen,
  ]);

  const filteredVehicleIds = useMemo(() => {
    const query = String(vehicleQuery || "").trim().toUpperCase();
    if (!query) return VEHICLE_ID_OPTIONS;
    return VEHICLE_ID_OPTIONS.filter((id) => id.includes(query));
  }, [vehicleQuery]);

  const filteredBatteryOutIds = useMemo(() => {
    const query = String(batteryOutQuery || "").trim().toUpperCase();
    if (!query) return BATTERY_ID_OPTIONS;
    return BATTERY_ID_OPTIONS.filter((id) => id.includes(query));
  }, [batteryOutQuery]);

  const filteredBatteryInIds = useMemo(() => {
    const query = String(batteryInQuery || "").trim().toUpperCase();
    if (!query) return BATTERY_ID_OPTIONS;
    return BATTERY_ID_OPTIONS.filter((id) => id.includes(query));
  }, [batteryInQuery]);

  const filteredRiders = useMemo(() => {
    const query = String(riderQuery || "").trim().toLowerCase();
    if (!query) return riderOptions;
    return (riderOptions || []).filter((r) => {
      const haystack = `${String(r?.full_name || "").toLowerCase()} ${String(r?.mobile || "").toLowerCase()} ${String(r?.aadhaar || "").toLowerCase()}`;
      return haystack.includes(query);
    });
  }, [riderOptions, riderQuery]);

  const selectRider = async (rider) => {
    const riderName = rider?.full_name || "";
    const riderPhone = String(rider?.mobile || "").replace(/\D+/g, "");

    setForm((prev) => ({
      ...prev,
      riderId: rider?.id || "",
      riderName,
      riderPhone,
    }));
    setRiderDropdownOpen(false);
    setRiderQuery("");

    if (!riderPhone) return;

    try {
      const active = await apiFetch(`/api/rentals/active?mobile=${encodeURIComponent(riderPhone)}`);
      if (!active) {
        setBanner({
          type: "warning",
          message: "No active rental found for this rider. Please select vehicle and battery OUT manually.",
        });
        return;
      }

      const vehicleNumber = normalizeId(active?.vehicle_number || "");
      const batteryOut = normalizeId(active?.current_battery_id || "");

      setForm((prev) => ({
        ...prev,
        vehicleNumber: vehicleNumber || prev.vehicleNumber,
        batteryOut: batteryOut || prev.batteryOut,
      }));
    } catch {
      setBanner({
        type: "warning",
        message: "Unable to auto-fill vehicle/battery from active rental. Please select manually.",
      });
    }
  };

  const selectVehicleId = (id) => {
    setForm((prev) => ({ ...prev, vehicleNumber: id }));
    setVehicleDropdownOpen(false);
    setVehicleQuery("");
  };

  const selectBatteryOutId = (id) => {
    setForm((prev) => ({ ...prev, batteryOut: id }));
    setBatteryOutDropdownOpen(false);
    setBatteryOutQuery("");
  };

  const selectBatteryInId = (id) => {
    setForm((prev) => ({ ...prev, batteryIn: id }));
    setBatteryInDropdownOpen(false);
    setBatteryInQuery("");
  };

  const loadAll = async () => {
    if (!user?.uid) return;
    try {
      setRowsLoading(true);
      setUsageLoading(true);
      const [swapList, usage] = await Promise.all([
        listBatterySwaps(),
        getBatteryUsage(),
      ]);
      setRows(swapList || []);
      setUsageRows(usage || []);
    } catch (e) {
      setRows([]);
      setUsageRows([]);
      setBanner({
        type: "error",
        message: e?.message || "Unable to load battery swaps. Check API/DB.",
      });
    } finally {
      setRowsLoading(false);
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    if (!canLoad) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad]);

  const validate = () => {
    const next = {};
    const vehicleNumber = normalizeId(form.vehicleNumber);
    const batteryOut = normalizeId(form.batteryOut);
    const batteryIn = normalizeId(form.batteryIn);

    if (!vehicleNumber) next.vehicleNumber = "Vehicle number is required";
    if (!batteryOut) next.batteryOut = "Battery OUT is required";
    if (!batteryIn) next.batteryIn = "Battery IN is required";
    if (batteryOut && batteryIn && batteryOut === batteryIn) {
      next.batteryIn = "Battery IN must be different from Battery OUT";
    }

    setErrors(next);
    return { ok: Object.keys(next).length === 0, vehicleNumber, batteryOut, batteryIn };
  };

  const submit = async () => {
    if (!user?.uid) return;
    const v = validate();
    if (!v.ok) return;

    try {
      const created = await createBatterySwap({
        employee_uid: user.uid,
        employee_email: user.email || null,
        vehicle_number: v.vehicleNumber,
        battery_out: v.batteryOut,
        battery_in: v.batteryIn,
        notes: form.notes?.trim() || null,
      });

      setBanner({ type: "success", message: "Battery swap recorded." });
      setForm({
        riderId: "",
        riderName: "",
        riderPhone: "",
        vehicleNumber: "",
        batteryOut: "",
        batteryIn: "",
        notes: "",
      });

      // Optimistic prepend, then refresh usage
      setRows((prev) => [created, ...prev]);
      setUsageLoading(true);
      const usage = await getBatteryUsage();
      setUsageRows(usage || []);
    } catch (e) {
      setBanner({
        type: "error",
        message: e?.message || "Unable to save battery swap. Check API/DB.",
      });
    } finally {
      setUsageLoading(false);
    }
  };

  if (loading) return null;

  return (
    <EmployeeLayout>
      <div className="w-full space-y-6">
        {riderDetailsOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label="Close rider swaps"
              onClick={() => {
                setRiderDetailsOpen(false);
                setRiderDetails(null);
                setRiderSwapRows([]);
              }}
            />
            <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-xl">
              <div className="flex items-start justify-between gap-4 border-b border-evegah-border p-4">
                <div>
                  <h3 className="text-base font-semibold text-evegah-text">Rider Swaps</h3>
                  <p className="text-sm text-gray-500">
                    {riderDetails?.rider_full_name || "-"} • {riderDetails?.rider_mobile || "-"}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-muted"
                  onClick={() => {
                    setRiderDetailsOpen(false);
                    setRiderDetails(null);
                    setRiderSwapRows([]);
                  }}
                >
                  Close
                </button>
              </div>

              <div className="p-4">
                {!riderDetails?.rider_id ? (
                  <div className="text-sm text-gray-500">No rider linked to these swaps.</div>
                ) : riderDetailsLoading ? (
                  <div className="text-sm text-gray-500">Loading swaps…</div>
                ) : riderSwapRows.length === 0 ? (
                  <div className="text-sm text-gray-500">No swaps found.</div>
                ) : (
                  <div className="max-h-[65vh] overflow-y-auto rounded-xl border border-evegah-border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-white">
                        <tr className="text-left text-gray-500 border-b border-evegah-border">
                          <th className="py-2 pr-3 font-medium">Vehicle</th>
                          <th className="py-2 pr-3 font-medium">Battery OUT</th>
                          <th className="py-2 pr-3 font-medium">Battery IN</th>
                          <th className="py-2 pr-3 font-medium">Swapped At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {riderSwapRows.map((r) => (
                          <tr key={r.id} className="border-b last:border-b-0">
                            <td className="py-3 pr-3">{r.vehicle_number}</td>
                            <td className="py-3 pr-3">{r.battery_out}</td>
                            <td className="py-3 pr-3">{r.battery_in}</td>
                            <td className="py-3 pr-3 text-gray-500">
                              {formatDateTimeDDMMYYYY(r.swapped_at, "-")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-3xl border border-evegah-border bg-white p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Operations
          </p>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-evegah-text">
                Battery Swaps
              </h1>
              <p className="text-sm text-gray-600">
                Record battery swap activity (battery OUT → battery IN) per vehicle.
              </p>
            </div>
            <div className="text-xs text-gray-500">
              Live view of swaps and battery usage
            </div>
          </div>
        </div>

        {banner && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              bannerStyles[banner.type] || bannerStyles.info
            }`}
          >
            {banner.message}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Battery Swaps"
            value={rowsLoading ? "—" : kpis.swapsInPeriod}
            helper="In selected period"
            period={kpiPeriod}
            onPeriodChange={setKpiPeriod}
            showPeriod
          />
          <KpiCard
            label="Total Swaps"
            value={rowsLoading ? "—" : kpis.swapsTotal}
            helper="All loaded"
            period={kpiPeriod}
            onPeriodChange={setKpiPeriod}
          />
          <KpiCard
            label="Vehicles"
            value={rowsLoading ? "—" : kpis.uniqueVehicles}
            helper="Unique vehicles (period)"
            period={kpiPeriod}
            onPeriodChange={setKpiPeriod}
          />
          <KpiCard
            label="Batteries"
            value={rowsLoading ? "—" : kpis.uniqueBatteries}
            helper="Unique IN/OUT (period)"
            period={kpiPeriod}
            onPeriodChange={setKpiPeriod}
          />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
          <div className="xl:col-span-5">
            <div className="card border-0 bg-white shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-evegah-text">
                    New Battery Swap
                  </h2>
                  <p className="text-sm text-gray-500">
                    Select a rider to auto-fill Vehicle & Battery OUT.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="label">Rider (optional)</label>
                  <div ref={riderDropdownRef} className="relative">
                    <button
                      type="button"
                      className="select flex items-center justify-between gap-3"
                      aria-haspopup="listbox"
                      aria-expanded={riderDropdownOpen}
                      onClick={() => {
                        setRiderDropdownOpen((prev) => {
                          const next = !prev;
                          if (!prev && next) {
                            setTimeout(() => riderQueryRef.current?.focus(), 0);
                          }
                          return next;
                        });
                      }}
                    >
                      <span className={form.riderName ? "text-evegah-text" : "text-gray-500"}>
                        {form.riderName
                          ? `${form.riderName} • ${form.riderPhone || "—"}`
                          : riderLoading
                            ? "Loading riders..."
                            : "Select rider"}
                      </span>
                      <span className="text-gray-400">▾</span>
                    </button>

                    {riderDropdownOpen ? (
                      <div className="absolute z-20 mt-2 w-full rounded-xl border border-evegah-border bg-white shadow-card p-2">
                        <input
                          ref={riderQueryRef}
                          className="input"
                          placeholder="Search rider name / phone..."
                          value={riderQuery}
                          onChange={(e) => setRiderQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setRiderDropdownOpen(false);
                            }
                          }}
                        />
                        <div className="mt-2 max-h-48 overflow-y-auto" role="listbox">
                          {riderLoading ? (
                            <div className="px-3 py-2 text-sm text-gray-500">Loading riders...</div>
                          ) : filteredRiders.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-500">No matching riders.</div>
                          ) : (
                            filteredRiders.map((rider) => {
                              const label = rider?.full_name || rider?.mobile || "Unknown rider";
                              const sub = rider?.mobile || rider?.aadhaar || "";
                              const selected = normalizeForCompare(rider?.id) === normalizeForCompare(form.riderId);
                              return (
                                <button
                                  key={rider.id ?? `${label}-${sub}`}
                                  type="button"
                                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                                    selected ? "bg-gray-100" : "hover:bg-gray-50"
                                  }`}
                                  onClick={() => selectRider(rider)}
                                >
                                  <p className="text-sm font-medium text-evegah-text">{label}</p>
                                  <p className="text-xs text-gray-500">{sub || "—"}</p>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <label className="label">Vehicle Number *</label>
                  <div ref={vehicleDropdownRef} className="relative">
                    <button
                      type="button"
                      className="select flex items-center justify-between gap-3"
                      aria-haspopup="listbox"
                      aria-expanded={vehicleDropdownOpen}
                      onClick={() => {
                        setVehicleDropdownOpen((prev) => {
                          const next = !prev;
                          if (!prev && next) {
                            setTimeout(() => vehicleQueryRef.current?.focus(), 0);
                          }
                          return next;
                        });
                      }}
                    >
                      <span className={form.vehicleNumber ? "text-evegah-text" : "text-gray-500"}>
                        {form.vehicleNumber || "Select E-bike ID"}
                      </span>
                      <span className="text-gray-400">▾</span>
                    </button>

                    {vehicleDropdownOpen ? (
                      <div className="absolute z-20 mt-2 w-full rounded-xl border border-evegah-border bg-white shadow-card p-2">
                        <input
                          ref={vehicleQueryRef}
                          className="input"
                          placeholder="Search vehicle id..."
                          value={vehicleQuery}
                          onChange={(e) => setVehicleQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setVehicleDropdownOpen(false);
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (filteredVehicleIds.length === 1) {
                                selectVehicleId(filteredVehicleIds[0]);
                              }
                            }
                          }}
                        />
                        <div className="mt-2 max-h-48 overflow-y-auto" role="listbox">
                          {filteredVehicleIds.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-500">No matching vehicle.</div>
                          ) : (
                            filteredVehicleIds.map((id) => {
                              const selected = normalizeForCompare(id) === normalizeForCompare(form.vehicleNumber);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                                    selected ? "bg-gray-100" : "hover:bg-gray-50"
                                  }`}
                                  onClick={() => selectVehicleId(id)}
                                >
                                  {id}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {errors.vehicleNumber && <p className="error">{errors.vehicleNumber}</p>}
                </div>

                <div>
                  <label className="label">Battery REMOVE *</label>
                  <div ref={batteryOutDropdownRef} className="relative">
                    <button
                      type="button"
                      className="select flex items-center justify-between gap-3"
                      aria-haspopup="listbox"
                      aria-expanded={batteryOutDropdownOpen}
                      onClick={() => {
                        setBatteryOutDropdownOpen((prev) => {
                          const next = !prev;
                          if (!prev && next) {
                            setTimeout(() => batteryOutQueryRef.current?.focus(), 0);
                          }
                          return next;
                        });
                      }}
                    >
                      <span className={form.batteryOut ? "text-evegah-text" : "text-gray-500"}>
                        {form.batteryOut || "Select battery out"}
                      </span>
                      <span className="text-gray-400">▾</span>
                    </button>

                    {batteryOutDropdownOpen ? (
                      <div className="absolute z-20 mt-2 w-full rounded-xl border border-evegah-border bg-white shadow-card p-2">
                        <input
                          ref={batteryOutQueryRef}
                          className="input"
                          placeholder="Search battery id..."
                          value={batteryOutQuery}
                          onChange={(e) => setBatteryOutQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setBatteryOutDropdownOpen(false);
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (filteredBatteryOutIds.length === 1) {
                                selectBatteryOutId(filteredBatteryOutIds[0]);
                              }
                            }
                          }}
                        />
                        <div className="mt-2 max-h-48 overflow-y-auto" role="listbox">
                          {filteredBatteryOutIds.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-500">No battery matches.</div>
                          ) : (
                            filteredBatteryOutIds.map((id) => {
                              const selected = normalizeForCompare(id) === normalizeForCompare(form.batteryOut);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                                    selected ? "bg-gray-100" : "hover:bg-gray-50"
                                  }`}
                                  onClick={() => selectBatteryOutId(id)}
                                >
                                  {id}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {errors.batteryOut && <p className="error">{errors.batteryOut}</p>}
                </div>

                <div>
                  <label className="label">Battery ADD *</label>
                  <div ref={batteryInDropdownRef} className="relative">
              <button
                type="button"
                className="select flex items-center justify-between gap-3"
                aria-haspopup="listbox"
                aria-expanded={batteryInDropdownOpen}
                onClick={() => {
                  setBatteryInDropdownOpen((prev) => {
                    const next = !prev;
                    if (!prev && next) {
                      setTimeout(() => batteryInQueryRef.current?.focus(), 0);
                    }
                    return next;
                  });
                }}
              >
                <span className={form.batteryIn ? "text-evegah-text" : "text-gray-500"}>
                  {form.batteryIn || "Select battery in"}
                </span>
                <span className="text-gray-400">▾</span>
              </button>

              {batteryInDropdownOpen ? (
                <div className="absolute z-20 mt-2 w-full rounded-xl border border-evegah-border bg-white shadow-card p-2">
                  <input
                    ref={batteryInQueryRef}
                    className="input"
                    placeholder="Search battery id..."
                    value={batteryInQuery}
                    onChange={(e) => setBatteryInQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setBatteryInDropdownOpen(false);
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (filteredBatteryInIds.length === 1) {
                          selectBatteryInId(filteredBatteryInIds[0]);
                        }
                      }
                    }}
                  />
                  <div className="mt-2 max-h-48 overflow-y-auto" role="listbox">
                    {filteredBatteryInIds.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No battery matches.</div>
                    ) : (
                      filteredBatteryInIds.map((id) => {
                        const selected = normalizeForCompare(id) === normalizeForCompare(form.batteryIn);
                        return (
                          <button
                            key={id}
                            type="button"
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                              selected ? "bg-gray-100" : "hover:bg-gray-50"
                            }`}
                            onClick={() => selectBatteryInId(id)}
                          >
                            {id}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {errors.batteryIn && <p className="error">{errors.batteryIn}</p>}
                </div>

                <div className="sm:col-span-2 lg:col-span-4">
                  <label className="label">Notes</label>
                  <input
                    className="input"
                    placeholder="Optional"
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                  <button type="button" className="btn-primary shadow-sm" onClick={submit}>
                    Save Swap
                  </button>
                </div>
              </div>
            </div>

            <div className="card border-0 bg-white shadow-card mt-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-evegah-text">Swap Records</h2>
                  <p className="text-sm text-gray-500">One row per rider (click to view swaps).</p>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <div className="max-h-[360px] overflow-y-auto rounded-xl border border-evegah-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-white">
                      <tr className="text-left text-gray-500 border-b border-evegah-border">
                        <th className="py-2 pr-3 font-medium">Rider</th>
                        <th className="py-2 pr-3 font-medium">Mobile</th>
                        <th className="py-2 pr-3 font-medium">Swaps</th>
                        <th className="py-2 pr-3 font-medium">Last Vehicle</th>
                        <th className="py-2 pr-3 font-medium">Last Swap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsLoading ? (
                        <tr>
                          <td className="py-3 text-gray-500" colSpan={5}>
                            Loading swaps...
                          </td>
                        </tr>
                      ) : riderTotal === 0 ? (
                        <tr>
                          <td className="py-3 text-gray-500" colSpan={5}>
                            No battery swaps to show.
                          </td>
                        </tr>
                      ) : (
                        riderPageRows.map((g) => (
                          <tr
                            key={g.key}
                            className={`border-b last:border-b-0 ${g.rider_id ? "cursor-pointer hover:bg-gray-50" : ""}`}
                            onClick={() => {
                              if (g.rider_id) openRiderDetails(g);
                            }}
                          >
                            <td className="py-3 pr-3">{g.rider_full_name || "-"}</td>
                            <td className="py-3 pr-3">{g.rider_mobile || "-"}</td>
                            <td className="py-3 pr-3 font-medium text-evegah-text">{g.swapCount}</td>
                            <td className="py-3 pr-3">{g.lastVehicle || "-"}</td>
                            <td className="py-3 pr-3 text-gray-500">
                              {g.lastSwappedAt ? formatDateTimeDDMMYYYY(g.lastSwappedAt, "-") : "-"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                  <p>
                    Showing {riderStart}-{riderEnd} of {riderTotal} riders
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-muted px-3 py-1 text-xs"
                      disabled={riderPage === 1}
                      onClick={() => setRiderPage((prev) => Math.max(1, prev - 1))}
                    >
                      Previous
                    </button>
                    <span>
                      Page {riderPage} / {riderPageCount}
                    </span>
                    <button
                      type="button"
                      className="btn-muted px-3 py-1 text-xs"
                      disabled={riderPage >= riderPageCount}
                      onClick={() => setRiderPage((prev) => Math.min(riderPageCount, prev + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="xl:col-span-7 space-y-4">
            <div className="card border-0 bg-white shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-evegah-text">
                    Most Used Batteries
                  </h2>
                  <p className="text-sm text-gray-500">All Battery IN/OUT counts.</p>
                </div>
              </div>

              {usageLoading ? (
                <div className="mt-4 text-sm text-gray-500">Loading usage...</div>
              ) : usageChartRows.length === 0 ? (
                <div className="mt-4 text-sm text-gray-500">No usage data yet.</div>
              ) : (
                <>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        className="input h-9 w-full sm:w-64"
                        placeholder="Search battery id..."
                        value={usageQuery}
                        onChange={(e) => setUsageQuery(e.target.value)}
                      />
                      <div className="relative" ref={usageBatteryDropdownRef}>
                        <button
                          type="button"
                          className="btn-muted px-3 py-2 text-xs"
                          onClick={() => setUsageBatteryDropdownOpen((prev) => !prev)}
                        >
                          {selectedUsageBatteries.length
                            ? `${selectedUsageBatteries.length} selected`
                            : "Select batteries"}
                        </button>

                        {usageBatteryDropdownOpen ? (
                          <div className="absolute left-0 z-20 mt-2 w-72 rounded-xl border border-evegah-border bg-white shadow-card">
                            <div className="p-2 border-b border-evegah-border">
                              <input
                                className="input h-9 w-full"
                                placeholder="Filter batteries..."
                                value={usageBatteryFilterQuery}
                                onChange={(e) => setUsageBatteryFilterQuery(e.target.value)}
                              />
                            </div>

                            <div className="max-h-64 overflow-y-auto p-2">
                              {filteredUsageBatteryOptions.length === 0 ? (
                                <div className="text-xs text-gray-500 px-2 py-2">No matches</div>
                              ) : (
                                filteredUsageBatteryOptions.map((id) => {
                                  const checked = selectedUsageBatteries.some(
                                    (v) => normalizeId(v) === normalizeId(id)
                                  );
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      onClick={() => toggleSelectedUsageBattery(id)}
                                      className="w-full flex items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-gray-50"
                                    >
                                      <span className="text-sm text-gray-800">{id}</span>
                                      <span
                                        className={`h-4 w-4 rounded border ${
                                          checked
                                            ? "bg-evegah-primary border-evegah-primary"
                                            : "bg-white border-gray-300"
                                        }`}
                                      />
                                    </button>
                                  );
                                })
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 p-2 border-t border-evegah-border">
                              <button
                                type="button"
                                className="btn-muted px-3 py-1 text-xs"
                                onClick={clearSelectedUsageBatteries}
                                disabled={selectedUsageBatteries.length === 0}
                              >
                                Clear
                              </button>
                              <button
                                type="button"
                                className="btn-muted px-3 py-1 text-xs"
                                onClick={() => setUsageBatteryDropdownOpen(false)}
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <span className="text-xs text-gray-500">
                        {selectedUsageBatteries.length
                          ? `Showing ${selectedUsageBatteries.length} battery${selectedUsageBatteries.length === 1 ? "" : "ies"}`
                          : `${usageChartRows.length} batteries`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Sort</span>
                      <select
                        className="rounded-lg border border-evegah-border bg-white px-2 py-1 text-xs text-gray-700"
                        value={usageSort}
                        onChange={(e) => setUsageSort(e.target.value)}
                      >
                        <option value="installs">By Installs (IN)</option>
                        <option value="removals">By Removals (OUT)</option>
                        <option value="total">By Total</option>
                      </select>
                    </div>
                  </div>

                  {selectedUsageBatteries.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedUsageBatteries
                        .slice()
                        .sort((a, b) => String(a).localeCompare(String(b)))
                        .map((id) => (
                          <span
                            key={id}
                            className="inline-flex items-center gap-2 rounded-full border border-evegah-border bg-gray-50 px-3 py-1 text-xs text-gray-700"
                          >
                            {id}
                            <button
                              type="button"
                              className="text-gray-500 hover:text-gray-900"
                              onClick={() => removeSelectedUsageBattery(id)}
                              aria-label={`Remove ${id}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                    </div>
                  ) : null}

                  <div className="mt-3 rounded-2xl border border-evegah-border bg-white p-3">
                    <div className="max-h-[520px] overflow-y-auto">
                      <div style={{ height: usageChartHeight }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            key={`${usageSort}|${usageQuery}|${selectedUsageBatteries.join(",")}`}
                            data={usageChartRows}
                            layout="vertical"
                            margin={{ top: 10, right: 10, left: 8, bottom: 10 }}
                            barCategoryGap={10}
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                            <YAxis
                              type="category"
                              dataKey="battery"
                              width={110}
                              tick={{ fontSize: 11 }}
                            />
                            <Tooltip />
                            <Legend />
                            <Bar
                              dataKey="installs"
                              name="Battery IN"
                              fill="#10B981"
                              stackId="a"
                              onClick={(data) => {
                                const battery = data?.payload?.battery;
                                if (battery) toggleSelectedUsageBattery(String(battery));
                              }}
                            />
                            <Bar
                              dataKey="removals"
                              name="Battery OUT"
                              fill="#6366F1"
                              stackId="a"
                              onClick={(data) => {
                                const battery = data?.payload?.battery;
                                if (battery) toggleSelectedUsageBattery(String(battery));
                              }}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      Tip: click any bar to add/remove that battery.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </EmployeeLayout>
  );
}
