const DEFAULT_ZONE_OPTIONS = ["", "Zone 1", "Zone 2", "Zone 3", "Zone 4"];

export default function Filters({
  className = "",
  search,
  setSearch,
  searchPlaceholder = "Search…",
  zone,
  setZone,
  zoneOptions,
  date,
  setDate,
  dateRange,
  setDateRange,
  days,
  setDays,
  daysOptions = [7, 14, 30, 60, 90],
  status,
  setStatus,
  statusOptions,
  statusPlaceholder = "All",
}) {
  const zones = Array.isArray(zoneOptions) && zoneOptions.length ? zoneOptions : DEFAULT_ZONE_OPTIONS;
  const hasSearch = typeof setSearch === "function";
  const hasZone = typeof setZone === "function";
  const hasDate = typeof setDate === "function";
  const hasDateRange = typeof setDateRange === "function";
  const hasDays = typeof setDays === "function";
  const hasStatus = typeof setStatus === "function";

  return (
    <div
      className={
        "flex flex-wrap items-end gap-3 bg-white/70 backdrop-blur-xl border border-white/30 rounded-2xl p-4 shadow-xl " +
        className
      }
    >
      {hasSearch ? (
        <div className="min-w-[220px] flex-1">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Search
          </label>
          <input
            value={search || ""}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="mt-1 w-full rounded-xl border border-white/40 bg-white/70 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>
      ) : null}

      {hasDays ? (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Period
          </label>
          <select
            value={Number(days || 0) || daysOptions[0]}
            onChange={(e) => setDays(Number(e.target.value || daysOptions[0]))}
            className="mt-1 rounded-xl border border-white/40 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-800 shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            {daysOptions.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {hasZone ? (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Zone
          </label>
          <select
            value={zone || ""}
            onChange={(e) => setZone(e.target.value)}
            className="mt-1 rounded-xl border border-white/40 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-800 shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            {zones.map((z) => (
              <option key={z || "all"} value={z}>
                {z ? z : "All zones"}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {hasStatus ? (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Status
          </label>
          <select
            value={status || ""}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 rounded-xl border border-white/40 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-800 shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            <option value="">{statusPlaceholder}</option>
            {(Array.isArray(statusOptions) ? statusOptions : []).map((opt) => (
              <option key={String(opt?.value ?? opt)} value={String(opt?.value ?? opt)}>
                {String(opt?.label ?? opt)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {hasDateRange ? (
        <>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Start date
            </label>
            <input
              type="date"
              value={dateRange?.start || ""}
              onChange={(e) => setDateRange((p) => ({ ...(p || {}), start: e.target.value }))}
              className="mt-1 rounded-xl border border-white/40 bg-white/70 px-4 py-2.5 text-sm text-slate-800 shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              End date
            </label>
            <input
              type="date"
              value={dateRange?.end || ""}
              onChange={(e) => setDateRange((p) => ({ ...(p || {}), end: e.target.value }))}
              className="mt-1 rounded-xl border border-white/40 bg-white/70 px-4 py-2.5 text-sm text-slate-800 shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
          </div>
        </>
      ) : null}

      {hasDate ? (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Date
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="date"
              value={date || ""}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-white/40 bg-white/70 px-4 py-2.5 text-sm text-slate-800 shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            {date ? (
              <button
                type="button"
                onClick={() => setDate("")}
                className="rounded-xl border border-white/40 bg-white/60 px-3 py-2.5 text-sm font-medium text-slate-700 shadow-lg hover:bg-white/80"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
