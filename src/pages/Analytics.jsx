import AdminSidebar from "../components/admin/AdminSidebar";
import useRiderAnalytics from "../hooks/useRiderAnalytics";
import useLiveAnalytics from "../hooks/useLiveAnalytics";

import DailyRiderChart from "../components/Charts/DailyRiderChart";
import EarningsChart from "../components/Charts/EarningsChart";
import ZonePieChart from "../components/Charts/ZonePieChart";
import RiderStatusPie from "../components/Charts/RiderStatusPie";
import ChartCard from "../components/ChartCard";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import { useMemo, useState } from "react";
import { downloadCsv } from "../utils/downloadCsv";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, BarChart3, MapPin, TrendingUp, Users, Download } from "lucide-react";

export default function Analytics() {
  const {
    totalRiders,
    activeRiders,
    suspendedRiders,
    totalRides,
    zoneStats,
  } = useRiderAnalytics();

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [csvDataset, setCsvDataset] = useState("rides");
  const [days, setDays] = useState(14);
  const [date, setDate] = useState("");

  const {
    ridersData,
    earningsData,
    zoneData,
    activeZoneCounts,
    loading,
    error,
    refresh,
  } = useLiveAnalytics({ autoRefresh, days, date: date || undefined });

  const totalEarnings = useMemo(() => {
    if (!Array.isArray(earningsData)) return 0;
    return earningsData.reduce((sum, row) => sum + Number(row?.amount || 0), 0);
  }, [earningsData]);

  const avgRidesPerDay = useMemo(() => {
    if (!Array.isArray(ridersData) || ridersData.length === 0) return 0;
    const total = ridersData.reduce((sum, row) => sum + Number(row?.total || 0), 0);
    return Math.round((total / ridersData.length) * 10) / 10;
  }, [ridersData]);

  const activeZoneBarData = useMemo(() => {
    const zones = Array.isArray(activeZoneCounts?.zones) ? activeZoneCounts.zones : [];
    const counts = activeZoneCounts?.counts && typeof activeZoneCounts.counts === "object" ? activeZoneCounts.counts : {};
    return zones.map((z) => ({ zone: z, value: Number(counts[z] || 0) }));
  }, [activeZoneCounts]);

  async function exportPDF() {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("EVegah – Analytics Report", 14, 20);

    autoTable(doc, {
      startY: 30,
      head: [["Metric", "Value"]],
      body: [
        ["Total Riders", totalRiders],
        ["Active Riders", activeRiders],
        ["Suspended Riders", suspendedRiders],
        ["Total Rides", totalRides],
      ],
    });

    const chartIds = [
      "ridesChart",
      "earningsChart",
      "zoneChart",
      "activeZoneChart",
      "statusChart",
    ];
    let y = doc.lastAutoTable.finalY + 10;

    for (const id of chartIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      const canvas = await html2canvas(el, { scale: 2 });
      const img = canvas.toDataURL("image/png");
      doc.addImage(img, "PNG", 15, y, 180, 80);
      y += 90;
    }

    doc.save("analytics-report.pdf");
  }

  const exportCSV = () => {
    const today = new Date().toISOString().slice(0, 10);

    if (csvDataset === "rides") {
      return downloadCsv({
        filename: `analytics_rides_${today}.csv`,
        columns: [
          { key: "date", header: "Date" },
          { key: "day", header: "Day" },
          { key: "total", header: "Rides" },
        ],
        rows: Array.isArray(ridersData) ? ridersData : [],
      });
    }

    if (csvDataset === "earnings") {
      return downloadCsv({
        filename: `analytics_earnings_${today}.csv`,
        columns: [
          { key: "date", header: "Date" },
          { key: "amount", header: "Amount" },
        ],
        rows: Array.isArray(earningsData) ? earningsData : [],
      });
    }

    if (csvDataset === "zones") {
      const rows = Array.isArray(zoneData) && zoneData.length ? zoneData : zoneStats;
      return downloadCsv({
        filename: `analytics_zone_distribution_${today}.csv`,
        columns: [
          { key: "zone", header: "Zone" },
          { key: "value", header: "Rides" },
        ],
        rows: Array.isArray(rows) ? rows : [],
      });
    }

    if (csvDataset === "active_zones") {
      return downloadCsv({
        filename: `analytics_active_rentals_by_zone_${today}.csv`,
        columns: [
          { key: "zone", header: "Zone" },
          { key: "value", header: "Active Rentals" },
        ],
        rows: activeZoneBarData,
      });
    }
  };

  return (
    <div className="h-screen w-full flex bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-20 left-20 w-72 h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse"></div>
        <div className="absolute top-40 right-20 w-72 h-72 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-40 w-72 h-72 bg-pink-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse animation-delay-4000"></div>
      </div>

      <div className="flex relative z-10 w-full">
        <AdminSidebar />
        <main className="flex-1 w-full min-w-0 overflow-y-auto relative z-10 p-8 pb-0 overflow-x-hidden sm:ml-64">
          <div className="space-y-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-3xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                  Analytics Dashboard
                </h1>
                <p className="text-md text-slate-600 mt-2">Filter and explore rides, earnings, and zone performance.</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-white/80 backdrop-blur-xl border border-white/30 rounded-2xl text-sm font-medium shadow-lg">
                  <span className="text-slate-600">From date</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="bg-white/70 border border-white/50 rounded-xl px-3 py-2 text-sm"
                  />

                  <span className="text-slate-600">Days</span>
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value || 14))}
                    className="bg-white/70 border border-white/50 rounded-xl px-3 py-2 text-sm"
                  >
                    {[7, 14, 30, 60, 90].map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-3 px-4 py-3 bg-white/80 backdrop-blur-xl border border-white/30 rounded-2xl text-sm font-medium shadow-lg hover:shadow-xl transition-all duration-300">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="rounded-lg"
                  />
                  Auto-refresh
                </label>

                <button
                  type="button"
                  onClick={refresh}
                  className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-2xl font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl disabled:opacity-60"
                  disabled={loading}
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>

                <button
                  onClick={exportPDF}
                  className="px-6 py-3 bg-gradient-to-r from-red-500 to-pink-600 text-white rounded-2xl font-semibold hover:from-red-600 hover:to-pink-700 transition-all duration-300 shadow-lg hover:shadow-xl"
                >
                  Export PDF
                </button>

                <select
                  className="px-4 py-3 bg-white/80 backdrop-blur-xl border border-white/30 rounded-2xl text-sm font-medium shadow-lg"
                  value={csvDataset}
                  onChange={(e) => setCsvDataset(e.target.value)}
                  aria-label="CSV dataset"
                >
                  <option value="rides">Rides (daily)</option>
                  <option value="earnings">Earnings (daily)</option>
                  <option value="zones">Rides by zone</option>
                  <option value="active_zones">Active rentals by zone</option>
                </select>

                <button
                  type="button"
                  onClick={exportCSV}
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all duration-300 shadow-lg hover:shadow-xl disabled:opacity-60"
                  disabled={loading}
                >
                  <span className="inline-flex items-center gap-2">
                    <Download size={16} />
                    Export CSV
                  </span>
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50/90 backdrop-blur-lg border border-red-200/50 rounded-3xl p-6 shadow-2xl">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center">
                    <span className="text-red-600 text-2xl">⚠️</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-red-800">Failed to load analytics</h3>
                    <p className="text-red-600 text-lg">Try refreshing the page.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-6">
              <Kpi title="Total Riders" value={totalRiders} />
              <Kpi title="Active Riders" value={activeRiders} green />
              <Kpi title="Suspended Riders" value={suspendedRiders} red />
              <Kpi title="Total Rides" value={totalRides} />
              <Kpi title="Earnings" value={`₹${Math.round(totalEarnings).toLocaleString()}`} />
              <Kpi title="Avg rides / day" value={avgRidesPerDay} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8">
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/30 hover:shadow-3xl transition-all duration-500">
                  <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
                        <BarChart3 className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-slate-800">Rides per day</h3>
                        <p className="text-slate-600">All zones</p>
                      </div>
                    </div>
                  </div>
                  <DailyRiderChart data={ridersData} />
                </div>
              </div>

              <div className="lg:col-span-4">
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/30 hover:shadow-3xl transition-all duration-500">
                  <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
                        <MapPin className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-slate-800">Rides by zone</h3>
                        <p className="text-slate-600">All-time distribution</p>
                      </div>
                    </div>
                  </div>
                  <ZonePieChart data={Array.isArray(zoneData) && zoneData.length ? zoneData : zoneStats} />
                </div>
              </div>

              <div className="lg:col-span-8">
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/30 hover:shadow-3xl transition-all duration-500">
                  <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-teal-500 rounded-2xl flex items-center justify-center shadow-lg">
                        <TrendingUp className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-slate-800">Earnings per day</h3>
                        <p className="text-slate-600">Real-time data</p>
                      </div>
                    </div>
                  </div>
                  <EarningsChart data={earningsData} />
                </div>
              </div>

              <div className="lg:col-span-4">
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/30 hover:shadow-3xl transition-all duration-500">
                  <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-red-500 rounded-2xl flex items-center justify-center shadow-lg">
                        <Users className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-slate-800">Rider status</h3>
                        <p className="text-slate-600">Active vs Suspended</p>
                      </div>
                    </div>
                  </div>
                  <RiderStatusPie
                    data={[
                      { name: "Active", value: Number(activeRiders || 0) },
                      { name: "Suspended", value: Number(suspendedRiders || 0) },
                    ]}
                  />
                </div>
              </div>

              <div className="lg:col-span-12">
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/30 hover:shadow-3xl transition-all duration-500">
                  <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
                        <Activity className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-slate-800">Active rentals by zone</h3>
                        <p className="text-slate-600">Currently ongoing rentals</p>
                      </div>
                    </div>
                  </div>
                  {activeZoneBarData.length === 0 ? (
                    <div className="h-[280px] flex items-center justify-center text-slate-400 text-lg">No active rentals data</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={activeZoneBarData}>
                        <XAxis dataKey="zone" stroke="#64748b" />
                        <YAxis stroke="#64748b" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            border: 'none',
                            borderRadius: '16px',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                          }}
                        />
                        <Bar dataKey="value" fill="url(#activeZoneGradient)" radius={[12, 12, 0, 0]} />
                        <defs>
                          <linearGradient id="activeZoneGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.8} />
                          </linearGradient>
                        </defs>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}

/* KPI CARD */
function Kpi({ title, value, green, red }) {
  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white/30 hover:shadow-3xl hover:scale-105 transition-all duration-500">
      <p className="text-slate-500 text-sm font-medium uppercase tracking-wider mb-2">{title}</p>
      <h2
        className={`text-3xl font-black ${green ? "text-green-600" : red ? "text-red-600" : "text-slate-800"
          }`}
      >
        {value}
      </h2>
    </div>
  );
}
