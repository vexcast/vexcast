export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(ts: number, lang: "es" | "en"): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  if (s < 45) return rtf.format(-s, "second");
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  return rtf.format(-Math.floor(s / 86400), "day");
}

export function formatMoney(amount: number, currency: string | null, lang: string): string {
  if (!currency) return amount.toLocaleString(lang);
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Interpolate {name} placeholders. */
export function fmt(str: string, vars: Record<string, string | number>): string {
  return str.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = () => {
    last = Date.now();
    timer = null;
    if (pending) {
      const a = pending;
      pending = null;
      fn(...a);
    }
  };
  const throttled = (...args: A) => {
    pending = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) run();
    else if (!timer) timer = setTimeout(run, wait);
  };
  throttled.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  return throttled;
}
