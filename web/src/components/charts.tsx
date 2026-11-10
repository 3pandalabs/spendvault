"use client";

// Hand-rolled SVG/CSS charts. No chart library: these are bars only, and a
// library would add ~100 KB to every dashboard load on a phone.

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useId, useState } from "react";
import { categoryColor } from "@/lib/categories";
import { money, moneyShort, pct, pctChange } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "+12% vs last month". For spending, up is bad (red) and down is good (green).
 * `invert` flips that for things where up is good.
 */
export function Delta({
  value,
  base,
  suffix,
  invert,
  className,
}: {
  value: number;
  base: number;
  suffix?: string;
  invert?: boolean;
  className?: string;
}) {
  const p = pctChange(value, base);
  if (p == null) return <span className={cn("text-xs text-fg-muted", className)}>No earlier data{suffix ? ` ${suffix}` : ""}</span>;
  const flat = Math.abs(p) < 1;
  const up = p > 0;
  const bad = invert ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular",
        flat ? "text-fg-muted" : bad ? "text-up" : "text-down",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span>
        {flat ? "About the same" : `${pct(p)}`}
        {suffix ? <span className="font-normal text-fg-muted"> {suffix}</span> : null}
      </span>
    </span>
  );
}

/** Horizontal bar list: one row per item, bar width relative to the largest. */
export function HBarList({
  rows,
  currency,
}: {
  rows: Array<{ key: string; label: string; amount: number; color: string; meta?: React.ReactNode; aside?: React.ReactNode }>;
  currency: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
              <span className="truncate text-fg">{r.label}</span>
              {r.meta ? <span className="shrink-0 text-xs text-fg-muted">{r.meta}</span> : null}
            </span>
            <span className="shrink-0 font-medium tabular">{money(r.amount, currency)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-subtle">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(1.5, (r.amount / max) * 100)}%`, background: r.color }}
              />
            </div>
            {r.aside ? <div className="w-28 shrink-0 text-right">{r.aside}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Vertical bar chart. Bars are focusable/hoverable with a tooltip; the whole
 * chart also has a visually-hidden table for screen readers.
 */
export function BarChart({
  data,
  currency,
  height = 160,
  highlight,
  refLine,
  refLabel,
  color = "var(--accent)",
  tickEvery = 1,
  caption,
  onSelect,
  selected,
}: {
  data: Array<{ key: string; label: string; tick: string; value: number }>;
  currency: string;
  height?: number;
  /** Bars to emphasise (e.g. spike days). */
  highlight?: (d: { key: string; value: number }) => boolean;
  refLine?: number;
  refLabel?: string;
  color?: string;
  tickEvery?: number;
  caption: string;
  onSelect?: (key: string) => void;
  selected?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, refLine ?? 0, ...data.map((d) => d.value));
  const n = Math.max(1, data.length);
  const W = 100; // viewBox units per chart width; bars sized in %
  const gap = n > 20 ? 0.25 : 1.2;
  const bw = W / n - gap;
  const active = hover != null ? data[hover] : null;

  return (
    <figure className="relative">
      <div className="flex gap-2">
        {/* y-axis: just the max and half */}
        <div className="flex w-10 shrink-0 flex-col justify-between text-right text-[10px] text-fg-muted tabular" style={{ height }} aria-hidden>
          <span>{moneyShort(max, currency)}</span>
          <span>{moneyShort(max / 2, currency)}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} 100`}
            preserveAspectRatio="none"
            className="block w-full overflow-visible"
            style={{ height }}
            role="img"
            aria-labelledby={`${id}-cap`}
            onMouseLeave={() => setHover(null)}
          >
            <line x1="0" x2={W} y1="50" y2="50" stroke="var(--border)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2={W} y1="100" y2="100" stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {data.map((d, i) => {
              const h = (d.value / max) * 100;
              const hl = highlight?.(d);
              const isSel = selected === d.key;
              return (
                <g key={d.key}>
                  {/* full-height hit area */}
                  <rect
                    x={i * (W / n)}
                    y={0}
                    width={W / n}
                    height={100}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onClick={() => onSelect?.(d.key)}
                    style={{ cursor: onSelect ? "pointer" : "default" }}
                  />
                  <rect
                    x={i * (W / n) + gap / 2}
                    y={100 - h}
                    width={Math.max(0.3, bw)}
                    height={Math.max(d.value > 0 ? 0.8 : 0, h)}
                    rx={n > 20 ? 0.3 : 0.8}
                    fill={hl ? "var(--up)" : color}
                    opacity={hover == null || hover === i || isSel ? 1 : 0.55}
                    pointerEvents="none"
                  />
                </g>
              );
            })}
            {refLine ? (
              <line
                x1="0"
                x2={W}
                y1={100 - (refLine / max) * 100}
                y2={100 - (refLine / max) * 100}
                stroke="var(--fg-muted)"
                strokeDasharray="3 3"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {/* keyboard access: invisible buttons over each bar */}
          <div className="absolute inset-0 flex" style={{ height }}>
            {data.map((d, i) => (
              <button
                key={d.key}
                type="button"
                className="h-full flex-1 opacity-0 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={`${d.label}: ${money(d.value, currency)}`}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onMouseEnter={() => setHover(i)}
                onClick={() => onSelect?.(d.key)}
                tabIndex={onSelect ? 0 : -1}
              />
            ))}
          </div>
          {active ? (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-fg px-2 py-1 text-xs text-white shadow"
              style={{ left: `${Math.min(88, Math.max(12, ((hover! + 0.5) / n) * 100))}%` }}
              role="status"
            >
              {active.label} · <span className="font-semibold tabular">{money(active.value, currency)}</span>
            </div>
          ) : null}
          <div className="mt-1 flex text-[10px] text-fg-muted" aria-hidden>
            {data.map((d, i) => (
              <span key={d.key} className="flex-1 text-center">
                {i % tickEvery === 0 ? d.tick : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption id={`${id}-cap`} className="sr-only">
        {caption}
        {refLine && refLabel ? `. ${refLabel}: ${money(refLine, currency)}` : ""}
      </figcaption>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{money(d.value, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {refLine && refLabel ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted">
          <span className="inline-block w-4 border-t border-dashed border-fg-muted" aria-hidden /> {refLabel}{" "}
          {money(refLine, currency)}
        </p>
      ) : null}
    </figure>
  );
}

/** Stacked share bar (one strip, segments per category). */
export function ShareStrip({ rows }: { rows: Array<{ key: string; share: number }> }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-bg-subtle" aria-hidden>
      {rows.map((r) => (
        <div key={r.key} style={{ width: `${r.share * 100}%`, background: categoryColor(r.key) }} />
      ))}
    </div>
  );
}
