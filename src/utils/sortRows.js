function isNumericString(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;
  return /^-?\d+(\.\d+)?$/.test(t);
}

function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function normalize(value) {
  if (value === null || value === undefined) return { kind: "null", value: null };

  if (typeof value === "boolean") return { kind: "number", value: value ? 1 : 0 };

  if (typeof value === "number") {
    return { kind: "number", value: Number.isFinite(value) ? value : 0 };
  }

  if (value instanceof Date) {
    const t = toTimestamp(value);
    return t === null ? { kind: "string", value: String(value) } : { kind: "number", value: t };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { kind: "string", value: "" };

    if (isNumericString(trimmed)) return { kind: "number", value: Number(trimmed) };

    const t = toTimestamp(trimmed);
    if (t !== null && /\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return { kind: "number", value: t };
    }

    return { kind: "string", value: trimmed.toLowerCase() };
  }

  // Fallback for objects
  return { kind: "string", value: String(value).toLowerCase() };
}

export function compareValues(a, b) {
  const na = normalize(a);
  const nb = normalize(b);

  if (na.kind === "null" && nb.kind === "null") return 0;
  if (na.kind === "null") return 1; // nulls last
  if (nb.kind === "null") return -1;

  if (na.kind === "number" && nb.kind === "number") {
    return na.value - nb.value;
  }

  return String(na.value).localeCompare(String(nb.value), undefined, { numeric: true });
}

export function sortRows(rows, { key, direction = "asc", getValue } = {}) {
  const dir = direction === "desc" ? -1 : 1;
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (!key && typeof getValue !== "function") return list;

  // Stable sort by using original index as tiebreaker.
  const withIndex = list.map((row, index) => ({ row, index }));

  withIndex.sort((a, b) => {
    const av = typeof getValue === "function" ? getValue(a.row) : a.row?.[key];
    const bv = typeof getValue === "function" ? getValue(b.row) : b.row?.[key];
    const c = compareValues(av, bv);
    if (c !== 0) return c * dir;
    return a.index - b.index;
  });

  return withIndex.map((x) => x.row);
}

export function toggleSort(prev, nextKey) {
  const prevKey = prev?.key;
  const prevDir = prev?.direction || "asc";

  if (prevKey !== nextKey) return { key: nextKey, direction: "asc" };
  return { key: nextKey, direction: prevDir === "asc" ? "desc" : "asc" };
}
