import { useEffect, useState } from 'react';
import TokenIcon from "../TokenIcon";
import Reveal from "./Reveal";
import './LiveStats.css';

type Stats = {
  totalReceipts: number;
  captured: number;
  voided: number;
  volumeUsdc: number | string;
};

type Phase = 'loading' | 'ready' | 'hidden';

const FETCH_TIMEOUT_MS = 8000;

function StatCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rc-stat">
      <div className="rc-stat-value">{value}</div>
      <div className="rc-stat-label">
        {icon}
        {label}
      </div>
    </div>
  );
}

function SkeletonCard({ label }: { label: string }) {
  return (
    <div className="rc-stat">
      <div aria-hidden="true" className="rc-stat-skeleton" />
      <div className="rc-stat-label">{label}</div>
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
      className="rc-stats"
      aria-label="Live on-chain statistics"
      aria-live="polite"
    >
      <div className="rc-stats-wrap">
        <Reveal>
          <p className="rc-eyebrow">Derived from chain logs. Nothing invented.</p>
          <h2 className="rc-section-title">The ledger, live.</h2>
          <p className="rc-parenthetical">
            <em>( rebuilt from escrow events on Arc mainnet )</em>
          </p>
        </Reveal>

        <div className="rc-stat-grid">
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
                    icon={<TokenIcon token="USDC" size={16} />}
                    value={Number(stats.volumeUsdc).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  />
                </>
              )}
        </div>

        <Reveal>
          <p className="rc-stats-note">
            Receipt counts and volume are rebuilt from escrow contract events
            on Arc mainnet. If this block is empty, the stats service is
            unreachable — and we show nothing rather than numbers we
            can&apos;t stand behind.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
