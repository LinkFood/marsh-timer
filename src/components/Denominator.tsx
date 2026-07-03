/**
 * Denominator — the doctrine-enforcement receipts component.
 *
 * Every claim this system surfaces must carry its denominator. No component
 * may show a hit count without the number of trials it came from. This is the
 * shared primitive for that rule: later increments render ALL receipts through
 * it, so a claim without a denominator becomes structurally impossible.
 *
 * Two render modes:
 * - default:      "appeared {n}× · outcome followed {k} · base rate {base}"
 * - with `label`: "{label}: {k}/{n} · base rate {base}"  (compact fraction)
 *
 * Nulls degrade honestly: missing n or k renders "no record yet".
 */

interface DenominatorProps {
  n: number | null | undefined;
  k: number | null | undefined;
  base?: number | null;
  label?: string;
  className?: string;
}

function formatBase(base: number): string {
  // Base rates are fractions (0-1) → percent; anything larger renders as-is.
  if (base >= 0 && base <= 1) return `${(base * 100).toFixed(1)}%`;
  return Number.isInteger(base) ? String(base) : base.toFixed(2);
}

export default function Denominator({ n, k, base, label, className = '' }: DenominatorProps) {
  if (n == null || k == null) {
    return (
      <span className={`font-mono tabular-nums text-white/30 ${className}`}>
        {label ? `${label}: ` : ''}no record yet
      </span>
    );
  }

  const body = label
    ? `${label}: ${k}/${n}`
    : `appeared ${n}× · outcome followed ${k}`;

  return (
    <span className={`font-mono tabular-nums text-white/50 ${className}`}>
      {body}
      {base != null && <span className="text-white/35"> · base rate {formatBase(base)}</span>}
    </span>
  );
}
