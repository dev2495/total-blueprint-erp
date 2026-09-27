/** Re-mounts per route so every page arrives with the same soft enter. */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="erp-page-enter">{children}</div>;
}
