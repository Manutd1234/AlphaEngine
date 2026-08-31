import { mulberry32, seedFromString } from "../../lib/random";
import { BARS_PER_YEAR, type Bar } from "../../lib/types";

/** Deterministic generated bars for quantitative tests. Never imported by runtime code. */
export function syntheticBars(symbol: string, interval: string, bars: number): Bar[] {
  const rand = mulberry32(seedFromString(symbol));
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const anchor: Record<string, number> = {
    BTCUSDT: 68_000,
    ETHUSDT: 3_500,
    SOLUSDT: 160,
    BNBUSDT: 600,
    XRPUSDT: 0.6,
    ADAUSDT: 0.45,
    DOGEUSDT: 0.16,
    AVAXUSDT: 36,
    LINKUSDT: 18,
    DOTUSDT: 7,
    LTCUSDT: 85,
    TRXUSDT: 0.13,
  };
  const ann = BARS_PER_YEAR[interval] ?? 8760;
  const vol = 0.6 / Math.sqrt(ann);
  const drift = 0.25 / ann;
  const stepMs =
    { "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 }[interval] ?? 36e5;
  const now = Math.floor(Date.now() / stepMs) * stepMs;
  const out: Bar[] = [];
  let price = anchor[symbol.toUpperCase()] ?? 100;
  for (let i = 0; i < bars; i++) {
    const mu = i < bars / 2 ? drift : -drift * 0.6;
    const ret = gauss() * vol + mu + Math.sin(i / 90) * vol * 0.4;
    const open = price;
    price *= Math.exp(ret);
    const noise = Math.abs(gauss()) * vol * 0.5;
    out.push({
      t: now - (bars - i) * stepMs,
      o: open,
      h: price * (1 + noise),
      l: price * (1 - noise),
      c: price,
      v: 1e6 * (0.5 + rand()),
    });
  }
  return out;
}
