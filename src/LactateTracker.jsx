import { useState, useContext, createContext, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════════════
// SUPABASE
// ═══════════════════════════════════════════════════════════════════
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ═══════════════════════════════════════════════════════════════════
// THEME — sage + parchment + clay
// ═══════════════════════════════════════════════════════════════════
const T = {
  // backgrounds
  bg:         "#FAFAF7",
  bg2:        "#F3F1EC",
  surface:    "#FFFFFF",

  // borders
  border:     "#E8E4DB",
  borderSoft: "#EEF3EF",

  // text
  text:       "#1F2A24",
  textDim:    "#5F6B63",
  muted:      "#8A9690",
  dim:        "#C8CEC9",

  // sage (primary)
  sage100:    "#EEF3EF",
  sage200:    "#DCE7DF",
  sage300:    "#B7CCBC",
  sage400:    "#8AAE92",
  sage500:    "#5C8C68",
  sage600:    "#3E6A4B",
  sage700:    "#2B4B36",
  sage800:    "#1F3627",

  // clay / warm copper (accent for threshold & key values)
  clay:       "#D4A574",
  clayDark:   "#B8864F",
  claySoft:   "rgba(212,165,116,0.16)",

  // status
  ok:         "#5A8A5A",
  warn:       "#C89B3C",
  danger:     "#A85858",

  // metric hues (muted — not neon)
  pace:       "#5C8C68",  // sage
  pulse:      "#A85858",  // clay-red
  lactate:    "#B8860B",  // deep gold
};

const Ctx = createContext(T);
const useT = () => useContext(Ctx);

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const INTERVAL_TYPES = [
  { label: "Short",  sub: "< 3 min" },
  { label: "Medium", sub: "4–8 min" },
  { label: "Long",   sub: "8+ min"  },
];
const INTERVAL_COLORS = {
  Short:  "#A85858",  // clay-red
  Medium: "#C89B3C",  // amber
  Long:   "#5C8C68",  // sage
};
const BLANK_ENTRY = { speed: "", pulse: "", lactate: "", intervalType: "Medium", note: "" };

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════
const fmt = (iso, short = false) => {
  const d = new Date(iso);
  return short
    ? d.toLocaleDateString("nb-NO", { day: "2-digit", month: "short" })
    : d.toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const zone = (mmol) => {
  if (mmol < 2.0) return { label: "Aerob",         color: T.sage500 };
  if (mmol < 2.5) return { label: "Sub-terskel",   color: T.sage400 };
  if (mmol < 3.5) return { label: "Terskel",       color: T.clay    };
  if (mmol < 6.0) return { label: "Supra-terskel", color: "#C06B4A" };
  return               { label: "Max",              color: T.danger  };
};

const paceToSec = (p) => {
  if (!p) return null;
  const parts = String(p).split(":");
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0]), s = parseInt(parts[1]);
  return (isNaN(m) || isNaN(s)) ? null : m * 60 + s;
};

const secToPace = (sec) => {
  if (!sec || isNaN(sec) || sec <= 0) return "—";
  return `${Math.floor(sec / 60)}:${Math.round(sec % 60).toString().padStart(2, "0")}`;
};

const validatePace = (v) => {
  if (!v) return "Påkrevd";
  return /^\d{1,2}:[0-5]\d$/.test(String(v).trim()) ? null : "Format: m:ss";
};

// ═══════════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════════
const loadSessions = async () => {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .order("date", { ascending: false });
  if (error || !data) return [];
  return data.map(s => ({ id: s.id, date: s.date, entries: s.entries }));
};

const persistSessions = async (sessions) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase.from("sessions").select("id");
  const existingIds = new Set(existing?.map(s => s.id) || []);
  const newIds = new Set(sessions.map(s => s.id));

  const toDelete = [...existingIds].filter(id => !newIds.has(id));
  if (toDelete.length) await supabase.from("sessions").delete().in("id", toDelete);

  if (sessions.length) {
    await supabase.from("sessions").upsert(
      sessions.map(s => ({ id: s.id, user_id: user.id, date: s.date, entries: s.entries }))
    );
  }
};

const exportCSV = (sessions) => {
  const hdr = ["Dato","Fart (min/km)","Puls (bpm)","Laktat (mmol/L)","Sone","Intervalltype","Fatigue Δ (mmol/L)","Notat"];
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [hdr, ...sessions.flatMap(s =>
    s.entries.map(e => [fmt(s.date), e.speed, e.pulse, e.lactate,
      zone(e.lactate).label, e.intervalType,
      e.fatigueDelta != null ? e.fatigueDelta.toFixed(2) : "",
      e.note || ""].map(esc))
  )];
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" })),
    download: `laktat-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

// ═══════════════════════════════════════════════════════════════════
// REGRESSION
// ═══════════════════════════════════════════════════════════════════
function linReg(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const xM = xs.reduce((a, b) => a + b, 0) / n;
  const yM = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - xM) * (ys[i] - yM), 0);
  const den = xs.reduce((s, x) => s + (x - xM) ** 2, 0);
  if (den === 0) return null;
  const slope = num / den, intercept = yM - slope * xM;
  const ssTot = ys.reduce((s, y) => s + (y - yM) ** 2, 0);
  const ssRes = xs.reduce((s, x, i) => s + (ys[i] - (slope * x + intercept)) ** 2, 0);
  return { slope, intercept, r2: ssTot !== 0 ? Math.max(0, 1 - ssRes / ssTot) : 0, n };
}

function linRegWeighted(xs, ys, ws) {
  const n = xs.length;
  if (n < 2) return null;
  const wSum = ws.reduce((a, b) => a + b, 0);
  if (wSum === 0) return null;
  const xM = xs.reduce((s, x, i) => s + ws[i] * x, 0) / wSum;
  const yM = ys.reduce((s, y, i) => s + ws[i] * y, 0) / wSum;
  const num = xs.reduce((s, x, i) => s + ws[i] * (x - xM) * (ys[i] - yM), 0);
  const den = xs.reduce((s, x, i) => s + ws[i] * (x - xM) ** 2, 0);
  if (den === 0) return null;
  const slope = num / den, intercept = yM - slope * xM;
  const ssTot = ys.reduce((s, y, i) => s + ws[i] * (y - yM) ** 2, 0);
  const ssRes = xs.reduce((s, x, i) => s + ws[i] * (ys[i] - (slope * x + intercept)) ** 2, 0);
  return { slope, intercept, r2: ssTot !== 0 ? Math.max(0, 1 - ssRes / ssTot) : 0, n };
}

const HALFLIFE_MS = 60 * 24 * 60 * 60 * 1000;
const ageWeight = (dateIso, now) => Math.pow(0.5, (now - new Date(dateIso).getTime()) / HALFLIFE_MS);

const buildModelFor = (entries, now = Date.now()) => {
  const valid = entries.filter(e =>
    e.lactate >= 1.5 && e.lactate <= 6.5 && paceToSec(e.speed) !== null && e.pulse > 60
  );
  if (valid.length < 3) return null;
  const xs = valid.map(e => paceToSec(e.speed));
  const ys = valid.map(e => e.lactate);
  const ps = valid.map(e => e.pulse);
  const ws = valid.map(e => ageWeight(e.date, now));
  const rXY = linRegWeighted(xs, ys, ws);
  const rPY = linRegWeighted(ps, ys, ws);
  if (!rXY || rXY.slope === 0) return null;
  const paceAt  = lac => (lac - rXY.intercept) / rXY.slope;
  const pulseAt = lac => (rPY && rPY.slope !== 0) ? Math.round((lac - rPY.intercept) / rPY.slope) : null;
  return { paceAt, pulseAt, r2: rXY.r2, n: valid.length, slope: rXY.slope, intercept: rXY.intercept };
};

const buildModel = (sessions) => {
  const now = Date.now();
  const all = sessions.flatMap(s => s.entries.map(e => ({ ...e, date: s.date })));
  const base = buildModelFor(all, now);
  if (!base) return null;
  const perType = {};
  for (const type of ["Short", "Medium", "Long"]) {
    perType[type] = buildModelFor(all.filter(e => e.intervalType === type), now) || base;
  }
  return {
    lo: base.paceAt(2.5), hi: base.paceAt(3.5),
    loP: base.pulseAt(2.5), hiP: base.pulseAt(3.5),
    r2: base.r2, n: base.n, slope: base.slope, intercept: base.intercept,
    perType,
  };
};

// ═══════════════════════════════════════════════════════════════════
// FATIGUE ENGINE
// ═══════════════════════════════════════════════════════════════════
const PACE_WINDOW = 12;

const computeFatigue = (candidate, historicalSessions, excludeSessionId = null) => {
  const candPace = paceToSec(candidate.speed);
  if (!candPace || !candidate.lactate) return null;
  const nearby = historicalSessions
    .filter(s => s.id !== excludeSessionId)
    .flatMap(s => s.entries)
    .filter(e => { const ep = paceToSec(e.speed); return ep !== null && Math.abs(ep - candPace) <= PACE_WINDOW; })
    .map(e => e.lactate);
  if (nearby.length < 2) return null;
  const sorted = [...nearby].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const baseline = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const delta = candidate.lactate - baseline;
  return {
    baseline: +baseline.toFixed(2),
    delta: +delta.toFixed(2),
    level: delta > 0.8 ? "high" : delta > 0.4 ? "elevated" : "normal",
    n: nearby.length,
  };
};

// ═══════════════════════════════════════════════════════════════════
// THRESHOLD DRIFT
// ═══════════════════════════════════════════════════════════════════
const computeThresholdDrift = (sessions) => {
  if (sessions.length < 3) return [];
  const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const byMonth = {};
  sorted.forEach(s => {
    const d = new Date(s.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = [];
    s.entries.forEach(e => byMonth[key].push(e));
  });
  const monthKeys = Object.keys(byMonth).sort();
  if (monthKeys.length < 2) return [];
  const results = [];
  let cum = [];
  for (const mk of monthKeys) {
    cum = [...cum, ...byMonth[mk]];
    const valid = cum.filter(e => e.lactate >= 1.5 && e.lactate <= 6.5 && paceToSec(e.speed) !== null && e.pulse > 60);
    if (valid.length < 3) continue;
    const reg = linReg(valid.map(e => paceToSec(e.speed)), valid.map(e => e.lactate));
    if (!reg || reg.slope === 0) continue;
    const p = (3.0 - reg.intercept) / reg.slope;
    if (p > 0 && p < 1200) results.push({ month: mk, paceSec: p, r2: reg.r2, n: valid.length });
  }
  return results;
};

// ═══════════════════════════════════════════════════════════════════
// SHARED UI ATOMS
// ═══════════════════════════════════════════════════════════════════
function Card({ children, style, padded = true }) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 14,
      boxShadow: "0 1px 2px rgba(42,31,61,.04), 0 4px 12px rgba(42,31,61,.04)",
      padding: padded ? 20 : 0,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Eyebrow({ children, style }) {
  return (
    <div style={{
      fontSize: 11, letterSpacing: 2, textTransform: "uppercase",
      color: T.muted, fontWeight: 500, marginBottom: 10, ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children, sub, right, style }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
      gap: 12, marginBottom: 16, ...style }}>
      <div>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500,
          fontSize: 24, color: T.sage800, letterSpacing: "-0.01em", margin: 0 }}>
          {children}
        </h2>
        {sub && <div style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function Pill({ children, color, style }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px",
      borderRadius: 999, fontSize: 11, letterSpacing: .5, fontWeight: 500,
      background: color + "18",
      color: color,
      border: `1px solid ${color}33`,
      ...style,
    }}>
      {children}
    </span>
  );
}

function MetricInput({ label, unit, value, onChange, onBlur, placeholder, type, step, color, error }) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${error ? T.danger : T.border}`,
      borderRadius: 12, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 6,
      transition: "border-color .15s",
    }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
        fontWeight: 600, color: color || T.textDim }}>{label}</div>
      <input
        type={type} inputMode={type === "number" ? "decimal" : "text"} step={step}
        value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        placeholder={placeholder} className="metric-input"
        style={{
          background: "transparent", border: "none", color: T.text,
          fontSize: 28, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500,
          width: "100%", padding: 0, caretColor: color || T.sage600,
          fontVariantNumeric: "tabular-nums",
        }}
      />
      <div style={{ fontSize: 11, color: error ? T.danger : T.muted }}>
        {error || unit}
      </div>
    </div>
  );
}

function ZoneCard({ label, sub, lactate, color, pace, pulse }) {
  return (
    <Card padded={false} style={{ overflow: "hidden", display: "flex", alignItems: "stretch" }}>
      <div style={{ width: 4, background: color, flexShrink: 0 }} />
      <div style={{ padding: "14px 18px", flex: 1, display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: T.text,
            fontFamily: "'Fraunces', Georgia, serif" }}>{label}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
            {sub} · mål {lactate}
          </div>
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontFamily: "'Fraunces', Georgia, serif",
              fontWeight: 500, color: T.sage700, fontVariantNumeric: "tabular-nums" }}>{pace}</div>
            <div style={{ fontSize: 10, color: T.muted, letterSpacing: 1,
              textTransform: "uppercase" }}>min/km</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontFamily: "'Fraunces', Georgia, serif",
              fontWeight: 500, color: T.pulse, fontVariantNumeric: "tabular-nums" }}>{pulse ?? "—"}</div>
            <div style={{ fontSize: 10, color: T.muted, letterSpacing: 1,
              textTransform: "uppercase" }}>bpm</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FATIGUE BADGE
// ═══════════════════════════════════════════════════════════════════
function FatigueBadge({ fatigue }) {
  if (!fatigue) return null;
  const { delta, level, baseline, n } = fatigue;
  const colors = { normal: T.ok, elevated: T.warn, high: T.danger };
  const labels = { normal: "Normal", elevated: "Forhøyet", high: "Høy fatigue" };
  const c = colors[level];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
      background: c + "12", borderRadius: 10, border: `1px solid ${c}44`, marginTop: 12 }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <span style={{ color: c, fontWeight: 600, fontSize: 13 }}>{labels[level]}</span>
        <span style={{ color: T.textDim, fontSize: 12, marginLeft: 8 }}>
          {delta >= 0 ? "+" : ""}{delta.toFixed(2)} vs {baseline} baseline
        </span>
      </div>
      <div style={{ color: T.muted, fontSize: 11 }}>n={n}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email) return;
    setLoading(true);
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setSent(true);
    setLoading(false);
  };

  if (sent) return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: 24 }}>
      <Card style={{ maxWidth: 420, width: "100%", textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>✉</div>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500,
          fontSize: 22, color: T.sage800, margin: 0, marginBottom: 8 }}>
          Sjekk e-posten din
        </h2>
        <div style={{ color: T.textDim, fontSize: 14 }}>
          Vi har sendt en innloggingslenke til<br /><strong>{email}</strong>
        </div>
      </Card>
    </div>
  );

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: 24 }}>
      <Card style={{ maxWidth: 420, width: "100%", padding: 36 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500,
            fontSize: 36, color: T.sage800, margin: 0, letterSpacing: "-0.02em" }}>
            Terskel
          </h1>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 6, letterSpacing: 1 }}>
            Laktat · løping · utvikling
          </div>
        </div>

        <Eyebrow>E-post</Eyebrow>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder="din@epost.no"
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: 15,
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            background: T.surface,
            color: T.text,
            outline: "none",
            fontFamily: "inherit",
          }}
        />

        <button onClick={handleLogin} disabled={!email || loading}
          style={{
            width: "100%", marginTop: 14,
            padding: "13px",
            border: "none", borderRadius: 12,
            fontSize: 14, fontWeight: 600,
            fontFamily: "inherit",
            cursor: email && !loading ? "pointer" : "not-allowed",
            transition: "all .15s",
            background: email && !loading ? T.sage600 : T.bg2,
            color: email && !loading ? "#fff" : T.muted,
          }}>
          {loading ? "Sender…" : "Send innloggingslenke"}
        </button>

        <div style={{ marginTop: 16, color: T.muted, fontSize: 12,
          textAlign: "center", lineHeight: 1.6 }}>
          Ingen passord — vi sender deg en magisk lenke.
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ENTRY FORM
// ═══════════════════════════════════════════════════════════════════
function EntryForm({ initial, onSubmit, submitLabel, onCancel, onFormChange }) {
  const base = { ...BLANK_ENTRY, ...(initial || {}) };
  const [form, setForm] = useState(base);
  const [paceErr, setPaceErr] = useState(null);

  const update = (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (onFormChange) onFormChange(next);
  };

  const trySubmit = () => {
    const err = validatePace(form.speed);
    setPaceErr(err);
    if (err || !form.pulse || !form.lactate) return;
    onSubmit({ ...form, pulse: Number(form.pulse), lactate: Number(form.lactate) });
  };

  const ready = form.speed && !validatePace(form.speed) && form.pulse && form.lactate;
  const z = form.lactate && !isNaN(Number(form.lactate)) ? zone(Number(form.lactate)) : null;

  return (
    <div>
      <div className="metric-grid">
        <MetricInput label="Fart" unit="min/km" value={form.speed}
          onChange={v => { update({ speed: v }); if (paceErr) setPaceErr(validatePace(v)); }}
          onBlur={() => setPaceErr(validatePace(form.speed))}
          placeholder="4:30" type="text" color={T.pace} error={paceErr} />
        <MetricInput label="Puls" unit="bpm" value={form.pulse}
          onChange={v => update({ pulse: v })} placeholder="160" type="number" color={T.pulse} />
        <MetricInput label="Laktat" unit="mmol/L" value={form.lactate}
          onChange={v => update({ lactate: v })} placeholder="3.2" type="number" step="0.1" color={T.lactate} />
      </div>

      {z && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14,
          padding: "10px 14px", background: T.bg2, borderRadius: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: z.color }} />
          <span style={{ color: z.color, fontWeight: 600, fontSize: 13 }}>{z.label}</span>
          <span style={{ marginLeft: "auto", color: T.textDim, fontSize: 12,
            fontVariantNumeric: "tabular-nums" }}>
            {Number(form.lactate).toFixed(1)} mmol/L
          </span>
        </div>
      )}

      <Eyebrow style={{ marginTop: 22 }}>Intervalltype</Eyebrow>
      <div style={{ display: "flex", gap: 8 }}>
        {INTERVAL_TYPES.map(({ label, sub }) => {
          const selected = form.intervalType === label;
          const c = INTERVAL_COLORS[label];
          return (
            <button key={label} onClick={() => update({ intervalType: label })}
              style={{
                flex: 1, padding: "10px 8px", borderRadius: 10,
                border: `1px solid ${selected ? c : T.border}`,
                background: selected ? c + "1a" : T.surface,
                color: selected ? c : T.textDim,
                fontFamily: "inherit", fontSize: 13, fontWeight: 500,
                cursor: "pointer", transition: "all .15s",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              }}>
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 11, color: T.muted }}>{sub}</span>
            </button>
          );
        })}
      </div>

      <Eyebrow style={{ marginTop: 22 }}>Notat (valgfritt)</Eyebrow>
      <textarea
        value={form.note || ""}
        onChange={e => update({ note: e.target.value })}
        placeholder="Vind, underlag, følelse, drakt…"
        rows={2}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: 12,
          border: `1px solid ${T.border}`,
          background: T.surface,
          color: T.text,
          fontSize: 14,
          fontFamily: "inherit",
          resize: "vertical",
          minHeight: 60,
          outline: "none",
        }}
      />

      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        {onCancel && (
          <button onClick={onCancel}
            style={{
              flex: "0 0 110px", padding: "12px", background: "transparent",
              border: `1px solid ${T.border}`, borderRadius: 12, color: T.textDim,
              fontSize: 14, fontWeight: 500, fontFamily: "inherit", cursor: "pointer",
            }}>
            Avbryt
          </button>
        )}
        <button onClick={trySubmit} disabled={!ready}
          style={{
            flex: 1, padding: "12px",
            background: ready ? T.sage600 : T.bg2,
            color: ready ? "#fff" : T.muted,
            border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600,
            fontFamily: "inherit",
            cursor: ready ? "pointer" : "not-allowed", transition: "all .15s",
          }}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EDIT MODAL
// ═══════════════════════════════════════════════════════════════════
function EditModal({ entry, onSave, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(31,42,36,0.35)",
        backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div style={{ position: "relative", width: "100%", maxWidth: 520,
        animation: "slideUp .25s cubic-bezier(.16,1,.3,1)" }}>
        <Card style={{ padding: 28 }}>
          <SectionTitle>Endre måling</SectionTitle>
          <EntryForm initial={entry} onSubmit={onSave} submitLabel="Oppdater måling" onCancel={onClose} />
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SPARKLINE
// ═══════════════════════════════════════════════════════════════════
function LactateTrend({ sessions }) {
  if (sessions.length < 2) return null;
  const recent = sessions.slice(0, 12).reverse();
  const avgs = recent.map(s => s.entries.reduce((a, e) => a + e.lactate, 0) / s.entries.length);
  const W = 600, H = 90, P = { t: 8, r: 10, b: 22, l: 32 };
  const pW = W - P.l - P.r, pH = H - P.t - P.b;
  const minY = Math.min(1.0, ...avgs) - 0.2, maxY = Math.max(4.5, ...avgs) + 0.2;
  const X = i => P.l + (i / Math.max(recent.length - 1, 1)) * pW;
  const Y = v => P.t + pH - ((v - minY) / (maxY - minY || 1)) * pH;
  const pts = avgs.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const trend = avgs.length > 1 ? avgs[avgs.length - 1] - avgs[0] : 0;
  const tC = trend < -0.3 ? T.ok : trend > 0.3 ? T.danger : T.warn;
  const tL = trend < -0.3 ? "↓ Fremgang" : trend > 0.3 ? "↑ Stiger" : "→ Stabil";
  return (
    <Card style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase",
          color: T.muted }}>Laktat-trend</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: tC }}>{tL}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible", height: 90 }}>
        <rect x={P.l} y={Y(3.5)} width={pW} height={Math.max(0, Y(2.5) - Y(3.5))}
          fill={T.claySoft} stroke={T.clay + "55"} strokeWidth={0.5} />
        {[2, 3, 4].map(v => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke={T.border} strokeWidth={1} />
            <text x={P.l - 4} y={Y(v) + 4} textAnchor="end" fill={T.muted} fontSize={9}>{v}</text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke={T.sage600} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        {avgs.map((v, i) => (
          <circle key={i} cx={X(i)} cy={Y(v)} r={4} fill={zone(v).color}
            stroke={T.surface} strokeWidth={1.5} />
        ))}
        {recent.map((s, i) => (i === 0 || i === recent.length - 1) && (
          <text key={i} x={X(i)} y={H - 4} textAnchor={i === 0 ? "start" : "end"}
            fill={T.muted} fontSize={9}>{fmt(s.date, true)}</text>
        ))}
      </svg>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// THRESHOLD DRIFT CHART
// ═══════════════════════════════════════════════════════════════════
function ThresholdDriftChart({ drift }) {
  if (drift.length < 2) return null;
  const W = 600, H = 120, P = { t: 14, r: 14, b: 30, l: 52 };
  const pW = W - P.l - P.r, pH = H - P.t - P.b;
  const paces = drift.map(d => d.paceSec);
  const minP = Math.min(...paces) - 8, maxP = Math.max(...paces) + 8;
  const X = i => P.l + (i / Math.max(drift.length - 1, 1)) * pW;
  const Y = sec => P.t + ((sec - minP) / (maxP - minP || 1)) * pH;
  const pts = drift.map((d, i) => `${X(i)},${Y(d.paceSec)}`).join(" ");
  const improved = drift[drift.length - 1].paceSec < drift[0].paceSec;
  const lineColor = improved ? T.ok : T.danger;
  const delta = drift[drift.length - 1].paceSec - drift[0].paceSec;
  const deltaStr = (delta < 0 ? "↓ " : "↑ +") + secToPace(Math.abs(delta)) + " min/km";
  return (
    <Card style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase",
          color: T.muted }}>Terskel-drift</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: lineColor }}>{deltaStr}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible", height: 120 }}>
        {[minP + 10, (minP + maxP) / 2, maxP - 10].map((sec, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={Y(sec)} y2={Y(sec)} stroke={T.border} strokeWidth={1} />
            <text x={P.l - 6} y={Y(sec) + 4} textAnchor="end" fill={T.muted} fontSize={9}>{secToPace(sec)}</text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke={lineColor} strokeWidth={2.5}
          strokeLinejoin="round" strokeLinecap="round" />
        {drift.map((d, i) => (
          <circle key={i} cx={X(i)} cy={Y(d.paceSec)} r={4.5} fill={lineColor}
            stroke={T.surface} strokeWidth={1.5} />
        ))}
        {[0, drift.length - 1].map(i => (
          <text key={i} x={X(i)} y={H - 4} textAnchor={i === 0 ? "start" : "end"}
            fill={T.muted} fontSize={9}>{drift[i].month}</text>
        ))}
      </svg>
      <div style={{ marginTop: 8, fontSize: 12, color: T.muted }}>
        Terskelfart ved 3.0 mmol/L · raskere = fremgang
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RACE PREDICTION
// ═══════════════════════════════════════════════════════════════════
const RIEGEL = 1.06;

function formatRaceTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`
    : `${m}:${s.toString().padStart(2,"0")}`;
}

function RacePrediction({ model }) {
  const hmPaceSec = model.slope === 0 ? null : (3.0 - model.intercept) / model.slope;
  const fmPaceSec = model.lo;
  if (!hmPaceSec || !fmPaceSec || hmPaceSec <= 0 || fmPaceSec <= 0) return null;
  const HM_DIST = 21.0975, FM_DIST = 42.195;
  const hmTimeSec = hmPaceSec * HM_DIST;
  const fmTimeSec = fmPaceSec * FM_DIST;
  const fmFinalSec = (fmTimeSec + hmTimeSec * Math.pow(FM_DIST / HM_DIST, RIEGEL)) / 2;
  const fmFinalPace = fmFinalSec / FM_DIST;
  const races = [
    { label: "Halvmaraton", dist: "21.1 km", lacRef: "3.0 mmol/L",
      time: hmTimeSec, pace: hmPaceSec, color: T.clay,
      sub: hmTimeSec < 5400 ? "Sub-90" : hmTimeSec < 6000 ? "Sub-1:40" : null },
    { label: "Maraton", dist: "42.2 km", lacRef: "2.5 mmol/L",
      time: fmFinalSec, pace: fmFinalPace, color: T.sage600,
      sub: fmFinalSec < 10800 ? "Sub-3:00" : fmFinalSec < 11400 ? "Sub-3:10" : fmFinalSec < 12000 ? "Sub-3:20" : null },
  ];
  return (
    <div>
      <SectionTitle style={{ marginTop: 8 }}>Løpsprognoser</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {races.map(r => (
          <Card key={r.label} padded={false} style={{ overflow: "hidden",
            display: "flex", alignItems: "stretch" }}>
            <div style={{ width: 4, background: r.color, flexShrink: 0 }} />
            <div style={{ flex: 1, padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "flex-start",
                justifyContent: "space-between", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 17, fontFamily: "'Fraunces', Georgia, serif",
                    fontWeight: 500, color: T.text }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                    {r.dist} · basert på {r.lacRef}
                  </div>
                </div>
                {r.sub && <Pill color={r.color}>{r.sub}</Pill>}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontSize: 36, fontFamily: "'Fraunces', Georgia, serif",
                  fontWeight: 500, color: r.color, lineHeight: 1,
                  fontVariantNumeric: "tabular-nums" }}>
                  {formatRaceTime(r.time)}
                </span>
                <div style={{ fontSize: 13, color: T.textDim,
                  fontVariantNumeric: "tabular-nums" }}>{secToPace(r.pace)} /km</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: T.muted, lineHeight: 1.7 }}>
        HM basert på terskel-pace · FM fra laktatmodell kombinert med Riegel fra HM (eksp. 1.06).
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SCATTER PLOT
// ═══════════════════════════════════════════════════════════════════
function LactateScatter({ sessions, model }) {
  const all = sessions.flatMap(s => s.entries).filter(e =>
    e.lactate >= 1.0 && e.lactate <= 7.5 && paceToSec(e.speed) !== null);
  if (!all.length) return null;
  const W = 600, H = 200, P = { t: 14, r: 14, b: 30, l: 40 };
  const pW = W - P.l - P.r, pH = H - P.t - P.b;
  const paces = all.map(e => paceToSec(e.speed));
  const minP = Math.min(...paces) - 15, maxP = Math.max(...paces) + 15;
  const px = p => P.l + (p - minP) / (maxP - minP) * pW;
  const py = l => P.t + pH - ((l - 1.0) / 6.5) * pH;
  return (
    <Card style={{ padding: "16px 20px" }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase",
        color: T.muted, marginBottom: 10 }}>Målinger — fart vs laktat</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible", height: 200 }}>
        <rect x={P.l} y={py(3.5)} width={pW} height={Math.max(0, py(2.5) - py(3.5))}
          fill={T.claySoft} stroke={T.clay + "55"} strokeWidth={1} />
        {[2, 3, 4, 5, 6].map(l => (
          <g key={l}>
            <line x1={P.l} x2={W - P.r} y1={py(l)} y2={py(l)} stroke={T.border} strokeWidth={1} />
            <text x={P.l - 5} y={py(l) + 4} textAnchor="end" fill={T.muted} fontSize={9}>{l}</text>
          </g>
        ))}
        <line x1={px(minP)} y1={py(model.slope * minP + model.intercept)}
          x2={px(maxP)} y2={py(model.slope * maxP + model.intercept)}
          stroke={T.clay} strokeWidth={1.5} strokeDasharray="5 3" opacity={.75} />
        {all.map((e, i) => {
          const z = zone(e.lactate);
          return <circle key={i} cx={px(paceToSec(e.speed))} cy={py(e.lactate)}
            r={5} fill={z.color} fillOpacity={.85} stroke={T.surface} strokeWidth={1.5} />;
        })}
        <text x={10} y={H / 2} textAnchor="middle" fill={T.muted} fontSize={10}
          transform={`rotate(-90,10,${H / 2})`}>mmol/L</text>
        {[minP + 20, (minP + maxP) / 2, maxP - 20].map((s, i) => (
          <text key={i} x={px(s)} y={H - 6} textAnchor="middle"
            fill={T.muted} fontSize={9}>{secToPace(s)}</text>
        ))}
      </svg>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOG VIEW
// ═══════════════════════════════════════════════════════════════════
function LogView({ sessions, setSessions }) {
  const [staged, setStaged]     = useState([]);
  const [flashSaved, setFlash]  = useState(false);
  const [liveForm, setLiveForm] = useState({});

  const liveFatigue = useMemo(() => {
    if (!liveForm.speed || !liveForm.lactate) return null;
    return computeFatigue({ speed: liveForm.speed, lactate: Number(liveForm.lactate) }, sessions);
  }, [liveForm.speed, liveForm.lactate, sessions]);

  const addEntry = (form) => {
    const fatigue = computeFatigue(form, sessions);
    setStaged(prev => [...prev, { ...form, id: Date.now().toString(), fatigueDelta: fatigue?.delta ?? null }]);
    setLiveForm({});
  };

  const saveSession = () => {
    if (!staged.length) return;
    const s = { id: Date.now().toString(), date: new Date().toISOString(), entries: staged };
    const updated = [s, ...sessions];
    setSessions(updated); persistSessions(updated);
    setStaged([]);
    setFlash(true); setTimeout(() => setFlash(false), 2500);
  };

  const fdColor = (fd) => fd == null ? T.muted : fd > 0.8 ? T.danger : fd > 0.4 ? T.warn : T.ok;

  return (
    <div className="fade-in">
      <SectionTitle sub="Legg til målinger for dagens økt">Ny økt</SectionTitle>
      <Card>
        <EntryForm key={staged.length} onSubmit={addEntry} submitLabel="Legg til måling"
          onFormChange={f => setLiveForm(f)} />
        {liveFatigue && <FatigueBadge fatigue={liveFatigue} />}
      </Card>

      {staged.length > 0 && (
        <div style={{ marginTop: 24 }} className="fade-in">
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: 12 }}>
            <Eyebrow style={{ margin: 0 }}>
              Denne økten — {staged.length} {staged.length === 1 ? "måling" : "målinger"}
            </Eyebrow>
            <button onClick={() => setStaged([])}
              style={{ background: "transparent", border: "none", color: T.muted,
                fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              Tøm alle
            </button>
          </div>
          <Card padded={false} style={{ overflow: "hidden" }}>
            <div className="entry-row entry-head">
              <div>Fart</div>
              <div>Puls</div>
              <div>Laktat</div>
              <div>Type</div>
              <div>Fatigue</div>
              <div></div>
            </div>
            {staged.map((e, i) => {
              const z = zone(e.lactate);
              return (
                <div key={e.id} style={{ borderTop: i > 0 ? `1px solid ${T.border}` : "none" }}>
                  <div className="entry-row">
                    <span className="num" style={{ color: T.pace }}>{e.speed}</span>
                    <span className="num" style={{ color: T.pulse }}>{e.pulse}</span>
                    <span className="num" style={{ color: z.color }}>{e.lactate}</span>
                    <span style={{ fontSize: 12, fontWeight: 500,
                      color: INTERVAL_COLORS[e.intervalType] }}>{e.intervalType}</span>
                    <span className="num" style={{ color: fdColor(e.fatigueDelta) }}>
                      {e.fatigueDelta != null
                        ? (e.fatigueDelta >= 0 ? `+${e.fatigueDelta.toFixed(1)}` : e.fatigueDelta.toFixed(1))
                        : "—"}
                    </span>
                    <button onClick={() => setStaged(prev => prev.filter(x => x.id !== e.id))}
                      style={{ background: "transparent", border: "none", color: T.muted,
                        fontSize: 15, cursor: "pointer" }}>✕</button>
                  </div>
                  {e.note && (
                    <div style={{
                      padding: "0 20px 10px",
                      fontSize: 12, color: T.textDim, fontStyle: "italic",
                      lineHeight: 1.5, marginTop: -4,
                    }}>
                      “{e.note}”
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
          <button onClick={saveSession}
            style={{
              width: "100%", marginTop: 14, padding: "14px",
              background: T.sage600, color: "#fff",
              border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600,
              fontFamily: "inherit", cursor: "pointer", transition: "all .15s",
            }}>
            {flashSaved ? "✓ Økten er lagret" : "Lagre økt"}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HISTORY VIEW
// ═══════════════════════════════════════════════════════════════════
function HistoryView({ sessions, setSessions }) {
  const [expandedId, setExpandedId] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);

  const updateEntry = (sid, eid, data) => {
    const updated = sessions.map(s => s.id !== sid ? s : {
      ...s, entries: s.entries.map(e => e.id !== eid ? e : { ...e, ...data }),
    });
    setSessions(updated); persistSessions(updated); setEditTarget(null);
  };

  const deleteEntry = (sid, eid) => {
    const updated = sessions
      .map(s => s.id !== sid ? s : { ...s, entries: s.entries.filter(e => e.id !== eid) })
      .filter(s => s.entries.length > 0);
    setSessions(updated); persistSessions(updated);
  };

  const deleteSession = (sid) => {
    const updated = sessions.filter(s => s.id !== sid);
    setSessions(updated); persistSessions(updated);
    setExpandedId(null); setDelConfirm(null);
  };

  const fdColor = (fd) => fd == null ? T.muted : fd > 0.8 ? T.danger : fd > 0.4 ? T.warn : T.ok;

  if (!sessions.length) return (
    <div className="fade-in">
      <SectionTitle>Historikk</SectionTitle>
      <Card style={{ textAlign: "center", padding: 60 }}>
        <div style={{ fontSize: 32, color: T.dim, marginBottom: 10 }}>—</div>
        <div style={{ color: T.textDim, fontSize: 14 }}>Ingen økter registrert ennå.</div>
      </Card>
    </div>
  );

  const totalEntries = sessions.reduce((n, s) => n + s.entries.length, 0);

  return (
    <div className="fade-in">
      <SectionTitle
        sub={`${sessions.length} økter · ${totalEntries} målinger · siste ${fmt(sessions[0].date, true)}`}
        right={
          <button onClick={() => exportCSV(sessions)}
            style={{
              padding: "8px 14px", background: T.surface,
              border: `1px solid ${T.border}`, borderRadius: 10,
              color: T.sage700, fontSize: 13, fontFamily: "inherit",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            }}>
            <span style={{ fontSize: 15 }}>↓</span> Eksporter CSV
          </button>
        }>Historikk</SectionTitle>

      <div style={{ marginBottom: 20 }}>
        <LactateTrend sessions={sessions} />
      </div>

      {sessions.map(session => {
        const open = expandedId === session.id;
        const avgLac = session.entries.reduce((s, e) => s + e.lactate, 0) / session.entries.length;
        const z = zone(avgLac);
        const confirmDel = delConfirm === session.id;
        const types = [...new Set(session.entries.map(e => e.intervalType))];
        return (
          <Card key={session.id} padded={false} style={{ marginBottom: 12, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 14 }}
              onClick={() => setExpandedId(open ? null : session.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontFamily: "'Fraunces', Georgia, serif",
                  fontWeight: 500, color: T.text, marginBottom: 6 }}>
                  {fmt(session.date)}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {types.map(it => <Pill key={it} color={INTERVAL_COLORS[it]}>{it}</Pill>)}
                  <span style={{ fontSize: 12, color: T.muted }}>
                    {session.entries.length} {session.entries.length === 1 ? "måling" : "målinger"}
                  </span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 26, fontFamily: "'Fraunces', Georgia, serif",
                  fontWeight: 500, color: z.color, lineHeight: 1,
                  fontVariantNumeric: "tabular-nums" }}>{avgLac.toFixed(1)}</div>
                <div style={{ fontSize: 10, color: T.muted, letterSpacing: 1,
                  textTransform: "uppercase" }}>snitt mmol/L</div>
              </div>
              <span style={{ color: T.muted, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
            </div>

            {open && (
              <div className="fade-in" style={{ borderTop: `1px solid ${T.border}`, background: T.bg }}>
                <div className="entry-row entry-head" style={{ background: T.bg2 }}>
                  <div>Fart</div>
                  <div>Puls</div>
                  <div>Laktat</div>
                  <div>Type</div>
                  <div>Fatigue</div>
                  <div></div>
                </div>
                {session.entries.map((e, i) => {
                  const ez = zone(e.lactate);
                  const rowBg = i % 2 === 0 ? T.surface : T.bg;
                  return (
                    <div key={e.id} style={{ borderTop: `1px solid ${T.border}`, background: rowBg }}>
                      <div className="entry-row">
                        <span className="num" style={{ color: T.pace }}>{e.speed}</span>
                        <span className="num" style={{ color: T.pulse }}>{e.pulse}</span>
                        <span className="num" style={{ color: ez.color }}>{e.lactate}</span>
                        <span style={{ fontSize: 12, fontWeight: 500,
                          color: INTERVAL_COLORS[e.intervalType] }}>{e.intervalType}</span>
                        <span className="num" style={{ color: fdColor(e.fatigueDelta) }}>
                          {e.fatigueDelta != null
                            ? (e.fatigueDelta >= 0 ? `+${e.fatigueDelta.toFixed(1)}` : e.fatigueDelta.toFixed(1))
                            : "—"}
                        </span>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button onClick={() => setEditTarget({ sessionId: session.id, entryId: e.id })}
                            style={{ background: "transparent", border: `1px solid ${T.border}`,
                              color: T.textDim, borderRadius: 8, padding: "3px 10px",
                              fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>Endre</button>
                          <button onClick={() => deleteEntry(session.id, e.id)}
                            style={{ background: "transparent", border: `1px solid ${T.danger}33`,
                              color: T.danger, borderRadius: 8, padding: "3px 8px",
                              fontSize: 11, cursor: "pointer" }}>✕</button>
                        </div>
                      </div>
                      {e.note && (
                        <div style={{
                          padding: "0 20px 10px",
                          fontSize: 12, color: T.textDim, fontStyle: "italic",
                          lineHeight: 1.5, marginTop: -4,
                        }}>
                          “{e.note}”
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{ padding: "12px 20px", display: "flex", justifyContent: "flex-end",
                  alignItems: "center", gap: 10, background: T.bg2, borderTop: `1px solid ${T.border}` }}>
                  {confirmDel ? (
                    <>
                      <span style={{ fontSize: 12, color: T.textDim, marginRight: 4 }}>
                        Slette hele økten?
                      </span>
                      <button onClick={() => setDelConfirm(null)}
                        style={{ background: "transparent", border: `1px solid ${T.border}`,
                          color: T.textDim, borderRadius: 8, padding: "6px 14px",
                          fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Avbryt</button>
                      <button onClick={() => deleteSession(session.id)}
                        style={{ background: T.danger, border: "none", color: "#fff",
                          borderRadius: 8, padding: "6px 14px", fontSize: 12,
                          fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>Bekreft</button>
                    </>
                  ) : (
                    <button onClick={() => setDelConfirm(session.id)}
                      style={{ background: "transparent", border: `1px solid ${T.danger}44`,
                        color: T.danger, borderRadius: 8, padding: "6px 14px",
                        fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                      Slett økt
                    </button>
                  )}
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {editTarget && (() => {
        const s = sessions.find(s => s.id === editTarget.sessionId);
        const e = s?.entries.find(e => e.id === editTarget.entryId);
        return e ? (
          <EditModal entry={e}
            onSave={data => updateEntry(editTarget.sessionId, editTarget.entryId, data)}
            onClose={() => setEditTarget(null)} />
        ) : null;
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ZONES VIEW
// ═══════════════════════════════════════════════════════════════════
function ZonesView({ sessions }) {
  const totalEntries = sessions.reduce((n, s) => n + s.entries.length, 0);
  const model = useMemo(() => buildModel(sessions), [sessions]);
  const drift = useMemo(() => computeThresholdDrift(sessions), [sessions]);

  return (
    <div className="fade-in">
      <SectionTitle sub="Din beregnede terskel fordelt på intervalltype">
        Soner & terskel
      </SectionTitle>

      {totalEntries < 3 ? (
        <Card style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 48, fontFamily: "'Fraunces', Georgia, serif",
            fontWeight: 500, color: T.sage300, marginBottom: 10,
            fontVariantNumeric: "tabular-nums" }}>{totalEntries}/3</div>
          <div style={{ color: T.textDim, fontSize: 14 }}>
            Datapunkter trengs før vi kan regne ut terskel.
          </div>
        </Card>
      ) : !model ? (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ color: T.textDim, fontSize: 14 }}>
            For lite variasjon i dataene. Logg målinger på ulike farter.
          </div>
        </Card>
      ) : (
        <>
          {/* Confidence bar */}
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between",
              fontSize: 13, marginBottom: 10 }}>
              <span style={{ color: T.textDim }}>Modellens pålitelighet</span>
              <span style={{ fontWeight: 600,
                color: model.r2 > .7 ? T.ok : model.r2 > .4 ? T.warn : T.danger }}>
                {model.r2 > .7 ? "Høy" : model.r2 > .4 ? "Middels" : "Lav"} · R²={model.r2.toFixed(2)}
              </span>
            </div>
            <div style={{ height: 6, background: T.bg2, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 4, transition: "width .5s",
                width: `${Math.min(100, model.r2 * 100)}%`,
                background: model.r2 > .7 ? T.ok : model.r2 > .4 ? T.warn : T.danger }} />
            </div>
            <div style={{ color: T.muted, fontSize: 12, marginTop: 8 }}>
              Basert på {model.n} målinger på tvers av {sessions.length} økter
            </div>
          </Card>

          {/* Zone recommendations.
              Medium clamped so it never becomes slower (higher sec/km) than Long. */}
          {(() => {
            const longPaceSec = model.perType.Long.paceAt(3.5);
            let medPaceSec   = model.perType.Medium.paceAt(3.5);
            let medPulse     = model.perType.Medium.pulseAt(3.5);
            if (longPaceSec > 0 && medPaceSec > longPaceSec) {
              medPaceSec = longPaceSec;
              const longPulse = model.perType.Long.pulseAt(3.5);
              if (longPulse != null && (medPulse == null || medPulse < longPulse)) medPulse = longPulse;
            }
            return (
              <>
                <Eyebrow>Anbefalt tempo</Eyebrow>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                  <ZoneCard label="Lange intervaller" sub="8+ min · 3.5 mmol/L" lactate="3.5 mmol/L"
                    color={T.sage600}
                    pace={secToPace(longPaceSec)}
                    pulse={model.perType.Long.pulseAt(3.5)} />
                  <ZoneCard label="Middels intervaller" sub="4–8 min · 3.5 mmol/L" lactate="3.5 mmol/L"
                    color="#C89B3C"
                    pace={secToPace(medPaceSec)}
                    pulse={medPulse} />
                  <ZoneCard label="Korte intervaller" sub="< 3 min · 4.5 mmol/L" lactate="4.5 mmol/L"
                    color="#A85858"
                    pace={secToPace(model.perType.Short.paceAt(4.5))}
                    pulse={model.perType.Short.pulseAt(4.5)} />
                </div>
              </>
            );
          })()}

          {drift.length >= 2 && (
            <div style={{ marginBottom: 28 }}>
              <ThresholdDriftChart drift={drift} />
            </div>
          )}

          <div style={{ marginBottom: 28 }}>
            <RacePrediction model={model} />
          </div>

          <LactateScatter sessions={sessions} model={model} />

          <div style={{ marginTop: 18, fontSize: 12, color: T.muted, lineHeight: 1.7 }}>
            Terskelsonen = 2.5–3.5 mmol/L (norsk modell). Drift-grafen krever data fra minst 2 kalendermåneder.
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// APP SHELL — sidebar + main + mobile nav
// ═══════════════════════════════════════════════════════════════════
const NAV = [
  { id: "log",     label: "Økt",        icon: "●" },
  { id: "zones",   label: "Soner",      icon: "◎" },
  { id: "history", label: "Historikk",  icon: "◇" },
];

function Sidebar({ view, setView, onSignOut, email }) {
  return (
    <aside className="sidebar">
      <div style={{ padding: "28px 24px 20px" }}>
        <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500,
          fontSize: 26, color: T.sage800, margin: 0, letterSpacing: "-0.02em" }}>
          Terskel
        </h1>
        <div style={{ fontSize: 11, color: T.muted, letterSpacing: 1.5,
          textTransform: "uppercase", marginTop: 4 }}>
          Laktat · løping
        </div>
      </div>

      <nav style={{ padding: "0 12px", flex: 1 }}>
        {NAV.map(item => {
          const active = view === item.id;
          return (
            <button key={item.id} onClick={() => setView(item.id)}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%",
                padding: "11px 14px", marginBottom: 4,
                background: active ? T.sage100 : "transparent",
                color: active ? T.sage800 : T.textDim,
                border: "none", borderRadius: 10,
                fontSize: 14, fontWeight: active ? 600 : 500,
                fontFamily: "inherit", cursor: "pointer",
                textAlign: "left", transition: "all .15s",
              }}>
              <span style={{ fontSize: 14, color: active ? T.sage600 : T.muted }}>
                {item.icon}
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: 16, borderTop: `1px solid ${T.border}` }}>
        {email && (
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 10,
            wordBreak: "break-all" }}>{email}</div>
        )}
        <button onClick={onSignOut}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            width: "100%", padding: "9px 12px",
            background: "transparent", border: `1px solid ${T.border}`,
            borderRadius: 10, color: T.textDim, fontSize: 12,
            fontFamily: "inherit", cursor: "pointer",
          }}>
          Logg ut
        </button>
      </div>
    </aside>
  );
}

function MobileNav({ view, setView }) {
  return (
    <nav className="mobile-nav">
      {NAV.map(item => {
        const active = view === item.id;
        return (
          <button key={item.id} onClick={() => setView(item.id)}
            style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 3,
              padding: "10px 4px 8px",
              background: "transparent", border: "none",
              color: active ? T.sage700 : T.muted,
              cursor: "pointer", fontFamily: "inherit",
            }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
            <span style={{ fontSize: 11, fontWeight: active ? 600 : 500 }}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function MobileHeader({ onSignOut }) {
  return (
    <header className="mobile-header">
      <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500,
        fontSize: 20, color: T.sage800, margin: 0, letterSpacing: "-0.01em" }}>
        Terskel
      </h1>
      <button onClick={onSignOut}
        style={{
          padding: "6px 12px", background: "transparent",
          border: `1px solid ${T.border}`, borderRadius: 20,
          color: T.textDim, fontSize: 12, fontFamily: "inherit", cursor: "pointer",
        }}>
        Logg ut
      </button>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════
export default function LactateTracker() {
  const [sessions, setSessions] = useState([]);
  const [view, setView]         = useState("log");
  const [user, setUser]         = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    loadSessions().then(setSessions);
  }, [user?.id]);

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html, body, #root { min-height: 100vh; min-height: 100dvh; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: ${T.bg};
      color: ${T.text};
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    .num {
      font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum';
      font-family: 'Fraunces', Georgia, serif;
      font-weight: 500;
      font-size: 15px;
    }
    .fade-in { animation: fadeIn .2s ease; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
    @keyframes slideUp { from { transform:translateY(20px); opacity:0; } to { transform:translateY(0); opacity:1; } }

    .metric-input::placeholder { color: ${T.dim}; }
    .metric-input:focus { outline: none; }
    input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
    input[type=number] { -moz-appearance: textfield; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: ${T.bg}; }
    ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
    ::selection { background: ${T.sage200}; color: ${T.sage800}; }

    /* Layout */
    .app-shell { display: flex; min-height: 100vh; min-height: 100dvh; }
    .sidebar {
      width: 240px; flex-shrink: 0;
      background: ${T.surface};
      border-right: 1px solid ${T.border};
      display: flex; flex-direction: column;
      position: sticky; top: 0; height: 100vh; height: 100dvh;
    }
    .main {
      flex: 1; min-width: 0;
      padding: 40px 48px 60px;
    }
    .main-inner { max-width: 900px; margin: 0 auto; }
    .mobile-nav, .mobile-header { display: none; }

    /* Entry row — grid layout for staged + history tables */
    .entry-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1.2fr 1fr 50px;
      gap: 10px; align-items: center;
      padding: 11px 20px;
    }
    .entry-row > * { text-align: center; font-size: 13px; }
    .entry-row > *:last-child { text-align: right; }
    .entry-head {
      background: ${T.bg2};
      font-size: 10px !important;
      letterspacing: 1.5px;
      text-transform: uppercase;
      color: ${T.muted};
      font-weight: 600;
      padding-top: 9px; padding-bottom: 9px;
    }
    .entry-head > * { font-size: 10px !important; letter-spacing: 1.5px; }

    /* Metric grid — 3 cols on desktop, 1 on mobile */
    .metric-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px;
    }

    /* Mobile */
    @media (max-width: 767px) {
      .sidebar { display: none; }
      .main { padding: 72px 16px 88px; }
      .mobile-header {
        display: flex; align-items: center; justify-content: space-between;
        position: fixed; top: 0; left: 0; right: 0; z-index: 50;
        padding: 12px 16px;
        background: rgba(250,250,247,0.92);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid ${T.border};
      }
      .mobile-nav {
        display: flex; position: fixed; bottom: 0; left: 0; right: 0;
        z-index: 50;
        background: rgba(255,255,255,0.96);
        backdrop-filter: blur(10px);
        border-top: 1px solid ${T.border};
        padding-bottom: env(safe-area-inset-bottom);
      }
      .metric-grid { grid-template-columns: 1fr; gap: 10px; }
      .entry-row {
        grid-template-columns: 1fr 1fr 1fr 40px;
        padding: 10px 14px;
      }
      .entry-row > *:nth-child(4),
      .entry-row > *:nth-child(5) { display: none; }
      .entry-row > *:nth-child(6) { display: block; grid-column: 4; }
    }
  `;

  if (authLoading) return (
    <div style={{ minHeight: "100dvh", background: T.bg,
      display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: T.sage600, fontSize: 14, letterSpacing: 1 }}>
        Laster…
      </div>
    </div>
  );

  if (!user) return (
    <Ctx.Provider value={T}>
      <style>{css}</style>
      <LoginScreen />
    </Ctx.Provider>
  );

  return (
    <Ctx.Provider value={T}>
      <style>{css}</style>
      <div className="app-shell">
        <Sidebar view={view} setView={setView}
          onSignOut={() => supabase.auth.signOut()} email={user.email} />

        <MobileHeader onSignOut={() => supabase.auth.signOut()} />

        <main className="main">
          <div className="main-inner">
            {view === "log"     && <LogView     sessions={sessions} setSessions={setSessions} />}
            {view === "history" && <HistoryView sessions={sessions} setSessions={setSessions} />}
            {view === "zones"   && <ZonesView   sessions={sessions} />}
          </div>
        </main>

        <MobileNav view={view} setView={setView} />
      </div>
    </Ctx.Provider>
  );
}
