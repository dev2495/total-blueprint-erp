import { ReactNode, Key } from "react";

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  /** Render a cell. If omitted, falls back to row[key]. */
  cell?: (row: Row) => ReactNode;
  /** Mark numeric columns to right-align + use mono font + tabular numerals. */
  numeric?: boolean;
  width?: string;
}

interface DataTableProps<Row extends { id?: Key }> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  onRowClick?: (row: Row) => void;
  emptyTitle?: string;
  emptyBody?: string;
  className?: string;
}

/**
 * DataTable — drop-in replacement for ad-hoc <table> markup.
 *
 * <DataTable
 *   columns={[
 *     { key: "date", header: "Date" },
 *     { key: "ref", header: "Reference", cell: r => <code className="mono">{r.ref}</code> },
 *     { key: "qty", header: "Qty", numeric: true, cell: r => r.qty.toFixed(3) },
 *   ]}
 *   rows={transactions}
 *   onRowClick={openDrawer}
 * />
 */
export function DataTable<Row extends { id?: Key }>({
  columns,
  rows,
  onRowClick,
  emptyTitle = "No rows yet",
  emptyBody,
  className = "",
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return (
      <div className={`ds-card ${className}`.trim()} style={{ padding: 32, textAlign: "center" }}>
        <div className="t-h3" style={{ marginBottom: 8 }}>{emptyTitle}</div>
        {emptyBody && <div className="t-caption">{emptyBody}</div>}
      </div>
    );
  }

  return (
    <div className={`ds-card ${className}`.trim()} style={{ padding: 0, overflow: "hidden" }}>
      <table className="ds-tbl">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} className={c.numeric ? "num" : ""} style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map(c => (
                <td key={c.key} className={c.numeric ? "num" : ""}>
                  {c.cell ? c.cell(row) : (row as Record<string, unknown>)[c.key] as ReactNode}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
