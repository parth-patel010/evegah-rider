function escapeCsvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote if contains special chars (comma, quote, newline) or leading/trailing spaces.
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv({ columns, rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeColumns = Array.isArray(columns) ? columns.filter(Boolean) : [];

  const inferredColumns = safeColumns.length
    ? safeColumns
    : Array.from(
        safeRows.reduce((set, row) => {
          Object.keys(row || {}).forEach((k) => set.add(k));
          return set;
        }, new Set())
      ).map((key) => ({ key, header: key }));

  const headerLine = inferredColumns.map((c) => escapeCsvCell(c.header ?? c.key)).join(",");
  const lines = [headerLine];

  for (const row of safeRows) {
    const line = inferredColumns
      .map((c) => {
        const raw = typeof c.getValue === "function" ? c.getValue(row) : row?.[c.key];
        return escapeCsvCell(raw);
      })
      .join(",");
    lines.push(line);
  }

  // Use CRLF for best compatibility with Excel on Windows.
  return lines.join("\r\n");
}

export function downloadCsv({ filename = "export.csv", columns, rows } = {}) {
  const csv = toCsv({ columns, rows });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  // Cleanup
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
