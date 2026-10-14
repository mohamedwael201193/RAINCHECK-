import { useEffect, useState } from 'react';

const INK = '#0B1220';
const PAPER = '#F4EFE6';
const GREEN = '#35E0FF';

type Stats = {
  totalReceipts: number;
  captured: number;
  voided: number;
  volumeUsdc: number | string;
};

type Phase = 'loading' | 'ready' | 'hidden';

const FETCH_TIMEOUT_MS = 8000;

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        borderTop: `3px solid ${INK}`,
        paddingTop: 18,
      }}
    >
      <div
        style={{
          fontSize: 'clamp(40px, 5vw, 64px)',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 12,
          letterSpacing: '0.22em',
          fontWeight: 700,
          opacity: 0.6,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SkeletonCard({ label }: { label: string }) {
  return (
    <div style={{ borderTop: `3px solid ${INK}`, paddingTop: 18 }}>
      <div
        aria-hidden="true"
        style={{
          height: 58,
          borderRadius: 8,
          background: `linear-gradient(90deg, ${INK}14 25%, ${INK}2e 50%, ${INK}14 75%)`,
          backgroundSize: '200% 100%',
          animation: 'rc-shimmer 1.4s infinite',
        }}
      />
      <div
        style={{
          marginTop: 10,
          fontSize: 12,
          letterSpacing: '0.22em',
          fontWeight: 700,
          opacity: 0.6,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * LiveStats — every number comes from GET {VITE_API_URL}/api/stats.
 * No hardcoded numbers anywhere. Loading skeletons while fetching.
 * If the API is unreachable or returns an error, the whole section hides
 * itself instead of showing fake data.
 */
export default function LiveStats() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Vite build: VITE_ prefixed env via import.meta.env (founder redirect).
    // Fall back to the legacy Next-style var only if it exists.
    const base =
      (import.meta as unknown as { env?: Record<string, string | undefined> })
        .env?.VITE_API_URL ??
      (typeof process !== "undefined"
        ? (process as unknown as { env?: Record<string, string | undefined> })
            .env?.VITE_API_URL
        : undefined);

    // No API configured: never render invented numbers.
    if (!base) {
      setPhase('hidden');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    (async () => {
      try {
        const res = await fetch(`${base.replace(/\/$/, '')}/api/stats`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`stats ${res.status}`);
        const data = (await res.json()) as Partial<Stats>;

        // Validate shape: all four fields must be present and numeric.
        const fields: (keyof Stats)[] = [
          'totalReceipts',
          'captured',
          'voided',
          'volumeUsdc',
        ];
        const valid = fields.every(
          (f) => typeof data[f] === 'number' || typeof data[f] === 'string',
        ) && !Number.isNaN(Number(data.totalReceipts));

        if (!valid) throw new Error('stats shape invalid');

        if (!cancelled) {
          setStats(data as Stats);
          setPhase('ready');
        }
      } catch {
        if (!cancelled) setPhase('hidden');
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (phase === 'hidden') return null;

  const labels = [
    'TOTAL RECEIPTS',
    'CAPTURED',
    'VOIDED',
    'VOLUME (USDC)',
  ];

  return (
    <section
      id="live-stats"
      style={{ background: PAPER, color: INK, padding: '96px 24px' }}
      aria-label="Live on-chain statistics"
      aria-live="polite"
    >
      <style>{`@keyframes rc-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <p
          style={{
            fontSize: 12,
            letterSpacing: '0.28em',
            fontWeight: 700,
            color: GREEN,
            margin: '0 0 16px',
          }}
        >
          DERIVED FROM CHAIN LOGS. NOTHING INVENTED.
        </p>
        <h2
          style={{
            fontSize: 'clamp(32px, 5vw, 56px)',
            lineHeight: 1.05,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            margin: '0 0 56px',
            maxWidth: 800,
          }}
        >
          The ledger, live.
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 32,
          }}
        >
          {phase === 'loading'
            ? labels.map((l) => <SkeletonCard key={l} label={l} />)
            : stats && (
                <>
                  <StatCard
                    label={labels[0]}
                    value={Number(stats.totalReceipts).toLocaleString('en-US')}
                  />
                  <StatCard
                    label={labels[1]}
                    value={Number(stats.captured).toLocaleString('en-US')}
                  />
                  <StatCard
                    label={labels[2]}
                    value={Number(stats.voided).toLocaleString('en-US')}
                  />
                  <StatCard
                    label={labels[3]}
                    value={Number(stats.volumeUsdc).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  />
                </>
              )}
        </div>

        <p style={{ marginTop: 48, fontSize: 14, lineHeight: 1.6, opacity: 0.6, maxWidth: 720 }}>
          Receipt counts and volume are rebuilt from escrow contract events on
          Arc mainnet. If this block is empty, the stats service is unreachable
          — and we show nothing rather than numbers we can&apos;t stand behind.
        </p>
      </div>
    </section>
  );
}
