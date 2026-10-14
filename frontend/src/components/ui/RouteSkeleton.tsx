/**
 * RouteSkeleton — per-route Suspense fallback (design law §5/§6, bible §8.2).
 * Skeletons, never blank space: while a route chunk loads, the viewport shows
 * the page's skeleton shape instead of an empty screen or a bare "Loading…".
 */
export default function RouteSkeleton() {
  return (
    <main
      aria-label="Loading page"
      className="min-h-screen bg-ink text-ice"
      style={{ paddingTop: 72 }}
    >
      <div className="mx-auto max-w-6xl px-6 py-12">
        {/* nav row */}
        <div className="mb-14 flex items-center justify-between">
          <div className="rc-skel rc-skel-on-ink h-8 w-40" aria-hidden="true" />
          <div className="flex gap-3">
            <div className="rc-skel rc-skel-on-ink h-10 w-28 rounded-full" aria-hidden="true" />
            <div className="rc-skel rc-skel-on-ink h-10 w-36 rounded-full" aria-hidden="true" />
          </div>
        </div>
        {/* headline block */}
        <div className="rc-skel rc-skel-on-ink mb-4 h-16 w-3/4" aria-hidden="true" />
        <div className="rc-skel rc-skel-on-ink mb-10 h-16 w-1/2" aria-hidden="true" />
        <div className="rc-skel rc-skel-on-ink mb-12 h-5 w-2/3" aria-hidden="true" />
        {/* content cards */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-ice/10 p-6">
              <div className="rc-skel rc-skel-on-ink mb-4 h-6 w-2/3" aria-hidden="true" />
              <div className="rc-skel rc-skel-on-ink mb-2 h-4 w-full" aria-hidden="true" />
              <div className="rc-skel rc-skel-on-ink h-4 w-5/6" aria-hidden="true" />
            </div>
          ))}
        </div>
        <p className="sr-only">Loading…</p>
      </div>
    </main>
  );
}
