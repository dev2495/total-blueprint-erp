/**
 * Instant route skeleton: shown the moment a link is clicked, while the next
 * page's code and data load. Mirrors the shared hero + card rhythm so the
 * layout does not jump when the real page arrives.
 */
export default function DashboardLoading() {
  return (
    <div className="erp-page-enter space-y-4" aria-busy="true" aria-label="Loading page">
      <div className="erp-hero rounded-[22px] px-5 py-5 md:px-7 md:py-6">
        <div className="h-3 w-28 rounded-full bg-white/15" />
        <div className="mt-3 h-7 w-72 max-w-full rounded-lg bg-white/20" />
        <div className="mt-2.5 h-3.5 w-[28rem] max-w-full rounded-full bg-white/10" />
        <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[76px] rounded-2xl border border-white/10 bg-white/[0.06]" />
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="erp-skeleton h-[112px] rounded-[16px] border border-line" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="erp-skeleton h-[320px] rounded-[18px] border border-line" />
        <div className="erp-skeleton h-[320px] rounded-[18px] border border-line" />
      </div>
    </div>
  );
}
