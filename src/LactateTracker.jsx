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
// THEME
// ═══════════════════════════════════════════════════════════════════
const DARK = {
  name: "dark",
  bg: "#0A0A0F", surface: "#0F0F1A", surface2: "#141420",
  border: "#1A1A28", text: "#E0E0E0", muted: "#555", dim: "#252535",
};
const LIGHT = {
  name: "light",
  bg: "#F0EFE9", surface: "#E5E4DE", surface2: "#D9D8D2",
  border: "#C4C3BC", text: "#1A1A14", muted: "#888", dim: "#C8C7C0",
};
const Ctx = createContext(DARK);
const useT = () => useContext(Ctx);

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const BORG_VALUES = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
const BORG_LABELS = {
  6:"No exertion", 7:"Extremely light", 8:"", 9:"Very light", 10:"",
  11:"Light", 12:"", 13:"Somewhat hard", 14:"", 15:"Hard",
  16:"", 17:"Very hard", 18:"", 19:"Extremely hard", 20:"Max exertion",
};
const INTERVAL_TYPES = [
  { label: "Short",  sub: "< 3 min" },
  { label: "Medium", sub: "4–8 min" },
  { label: "Long",   sub: "8+ min"  },
];
const INTERVAL_COLORS = { Short: "#00CFFF", Medium: "#FFD600", Long: "#FF6B35" };
const BLANK_ENTRY = { speed: "", pulse: "", lactate: "", intervalType: "Medium", borg: 13 };

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
  if (mmol < 2.0) return { label: "Aerobic",         color: "#00FF87" };
  if (mmol < 2.5) return { label: "Sub-threshold",   color: "#ADFF2F" };
  if (mmol < 3.5) return { label: "Threshold",       color: "#FFD600" };
  if (mmol < 6.0) return { label: "Supra-threshold", color: "#FF6B35" };
  return               { label: "Max",              color: "#FF2D55" };
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
  if (!v) return "Required";
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
  const hdr = ["Date","Pace (min/km)","Pulse (bpm)","Lactate (mmol/L)","Zone","Interval Type","Borg RPE","Fatigue Delta (mmol/L)"];
  const rows = [hdr, ...sessions.flatMap(s =>
    s.entries.map(e => [fmt(s.date), e.speed, e.pulse, e.lactate,
      zone(e.lactate).label, e.intervalType, e.borg,
      e.fatigueDelta != null ? e.fatigueDelta.toFixed(2) : ""])
  )];
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" })),
    download: `lactate-${new Date().toISOString().slice(0, 10)}.csv`,
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

const buildModel = (sessions) => {
  const all = sessions.flatMap(s => s.entries).filter(e =>
    e.lactate >= 1.5 && e.lactate <= 6.5 && paceToSec(e.speed) !== null && e.pulse > 60
  );
  if (all.length < 3) return null;
  const xs = all.map(e => paceToSec(e.speed));
  const ys = all.map(e => e.lactate);
  const ps = all.map(e => e.pulse);
  const rXY = linReg(xs, ys);
  const rPY = linReg(ps, ys);
  if (!rXY) return null;
  const paceAt  = lac => rXY.slope === 0 ? null : (lac - rXY.intercept) / rXY.slope;
  const pulseAt = lac => (rPY && rPY.slope !== 0) ? Math.round((lac - rPY.intercept) / rPY.slope) : null;
  return {
    lo: paceAt(2.5), hi: paceAt(3.5),
    loP: pulseAt(2.5), hiP: pulseAt(3.5),
    r2: rXY.r2, n: all.length,
    slope: rXY.slope, intercept: rXY.intercept,
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
function SectionLabel({ children, style }) {
  const t = useT();
  return (
    <div style={{ fontSize: 10, letterSpacing: 3, color: t.muted,
      fontFamily: "'JetBrains Mono',monospace", marginBottom: 8, marginTop: 18, ...style }}>
      {children}
    </div>
  );
}

function MetricInput({ label, unit, value, onChange, onBlur, placeholder, type, step, color, error }) {
  const t = useT();
  return (
    <div style={{ background: t.surface, border: `1px solid ${error ? "#FF2D55" : color + "33"}`,
      borderRadius: 12, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color }}>{label}</div>
      <input type={type} inputMode={type === "number" ? "decimal" : "text"} step={step}
        value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        placeholder={placeholder} className="metric-input"
        style={{ background: "transparent", border: "none", color: t.text, fontSize: 26,
          fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", width: "100%", padding: 0, caretColor: color }} />
      <div style={{ fontSize: 9, color: error ? "#FF2D55" : t.muted, fontFamily: "'JetBrains Mono',monospace" }}>
        {error || unit}
      </div>
    </div>
  );
}

function BorgSelector({ value, onChange }) {
  const t = useT();
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 10 }}>
        <span style={{ fontSize: 52, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", color: "#FFD600", lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 14, color: t.muted, letterSpacing: 1 }}>{BORG_LABELS[value] || ""}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 24, marginBottom: 6 }}>
        {BORG_VALUES.map(v => {
          const anchor = !!BORG_LABELS[v], sel = v === value;
          return (
            <button key={v} onClick={() => onChange(v)}
              title={`${v}${BORG_LABELS[v] ? " – " + BORG_LABELS[v] : ""}`}
              style={{ flex: 1, borderRadius: 2, cursor: "pointer", border: "none", transition: "all .1s",
                height: anchor ? 20 : 12, background: sel ? "#FFD600" : anchor ? t.dim : t.border,
                transform: sel ? "scaleY(1.5)" : "none" }} />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}>
        <span style={{ color: t.muted }}>6 — No exertion</span>
        <span style={{ color: "#FF2D55" }}>20 — Max</span>
      </div>
    </div>
  );
}

function ZoneCard({ label, lactate, color, pace, pulse }) {
  const t = useT();
  return (
    <div style={{ background: t.surface, border: `1px solid ${color}44`, borderRadius: 12,
      display: "flex", alignItems: "center", overflow: "hidden" }}>
      <div style={{ width: 4, alignSelf: "stretch", background: color, flexShrink: 0 }} />
      <div style={{ padding: "12px 14px", flex: 1 }}>
        <div style={{ color: t.muted, fontSize: 10, letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace" }}>{label.toUpperCase()}</div>
        <div style={{ color, fontSize: 13, fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>{lactate}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, paddingRight: 16 }}>
        {[{ val: pace, unit: "min/km", c: "#00CFFF" }, { val: pulse ?? "—", unit: "bpm", c: "#FF2D55" }].map(({ val, unit, c }) => (
          <div key={unit} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c }}>{val}</div>
            <div style={{ fontSize: 9, color: t.muted, fontFamily: "'JetBrains Mono',monospace" }}>{unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FATIGUE BADGE
// ═══════════════════════════════════════════════════════════════════
function FatigueBadge({ fatigue }) {
  const t = useT();
  if (!fatigue) return null;
  const { delta, level, baseline, n } = fatigue;
  const colors = { normal: "#00FF87", elevated: "#FFD600", high: "#FF6B35" };
  const labels = { normal: "Normal", elevated: "Elevated", high: "High fatigue" };
  const c = colors[level];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
      background: t.surface, borderRadius: 10, border: `1px solid ${c}44`, marginTop: 10 }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <span style={{ color: c, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 12 }}>{labels[level]}</span>
        <span style={{ color: t.muted, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, marginLeft: 8 }}>
          {delta >= 0 ? "+" : ""}{delta.toFixed(2)} vs {baseline} baseline
        </span>
      </div>
      <div style={{ color: t.muted, fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}>n={n}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════
function LoginScreen() {
  const t = useT();
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
    <div style={{ textAlign: "center", padding: "80px 20px" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
      <div style={{ color: t.text, fontSize: 16, fontFamily: "'JetBrains Mono',monospace", marginBottom: 8, fontWeight: 700 }}>
        Check your email
      </div>
      <div style={{ color: t.muted, fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>
        We sent a login link to<br />{email}
      </div>
    </div>
  );

  return (
    <div style={{ padding: "60px 20px 40px" }}>
      <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 2, lineHeight: 1, marginBottom: 6 }}>
        <span style={{ color: "#00FF87", fontFamily: "'JetBrains Mono',monospace" }}>LA</span>
        <span style={{ color: t.text }}>TRACKER</span>
      </div>
      <div style={{ fontSize: 11, color: t.muted, letterSpacing: 2, marginBottom: 40, fontFamily: "'JetBrains Mono',monospace" }}>
        Lactate · Running · Performance
      </div>

      <SectionLabel style={{ marginTop: 0 }}>SIGN IN</SectionLabel>

      <div style={{ background: t.surface, border: `1px solid #00FF8733`, borderRadius: 12,
        padding: "12px 10px", marginBottom: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace",
          fontWeight: 600, color: "#00FF87", marginBottom: 4 }}>EMAIL</div>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder="your@email.com"
          style={{ background: "transparent", border: "none", color: t.text, fontSize: 22,
            fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", width: "100%",
            padding: 0, outline: "none", caretColor: "#00FF87" }}
        />
      </div>

      <button onClick={handleLogin} disabled={!email || loading}
        style={{ width: "100%", padding: "14px", border: "none", borderRadius: 12,
          fontSize: 15, fontWeight: 900, letterSpacing: 2, fontFamily: "'Barlow Condensed',sans-serif",
          cursor: email && !loading ? "pointer" : "not-allowed", transition: "all .15s",
          background: email && !loading ? "#00FF87" : t.dim,
          color: email && !loading ? "#0A0A0F" : t.muted }}>
        {loading ? "SENDING..." : "SEND LOGIN LINK"}
      </button>

      <div style={{ marginTop: 12, color: t.muted, fontSize: 10,
        fontFamily: "'JetBrains Mono',monospace", textAlign: "center", lineHeight: 1.6 }}>
        No password needed — we'll email you a magic link
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ENTRY FORM
// ═══════════════════════════════════════════════════════════════════
function EntryForm({ initial, onSubmit, submitLabel, onCancel, onFormChange }) {
  const t = useT();
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <MetricInput label="PACE" unit="min/km" value={form.speed}
          onChange={v => { update({ speed: v }); if (paceErr) setPaceErr(validatePace(v)); }}
          onBlur={() => setPaceErr(validatePace(form.speed))}
          placeholder="4:30" type="text" color="#00CFFF" error={paceErr} />
        <MetricInput label="PULSE" unit="bpm" value={form.pulse}
          onChange={v => update({ pulse: v })} placeholder="160" type="number" color="#FF2D55" />
        <MetricInput label="LACTATE" unit="mmol/L" value={form.lactate}
          onChange={v => update({ lactate: v })} placeholder="3.2" type="number" step="0.1" color="#00FF87" />
      </div>

      {z && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10,
          padding: "8px 12px", background: t.surface, borderRadius: 10 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: z.color, flexShrink: 0 }} />
          <span style={{ color: z.color, fontFamily: "monospace", fontWeight: 700, fontSize: 13 }}>{z.label}</span>
          <span style={{ marginLeft: "auto", color: t.muted, fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
            {Number(form.lactate).toFixed(1)} mmol/L
          </span>
        </div>
      )}

      <SectionLabel>INTERVAL TYPE</SectionLabel>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {INTERVAL_TYPES.map(({ label, sub }) => (
          <button key={label} onClick={() => update({ intervalType: label })}
            style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: "1px solid",
              background: "transparent", fontFamily: "'Barlow Condensed',sans-serif",
              fontSize: 14, fontWeight: 700, letterSpacing: 1, cursor: "pointer",
              transition: "all .15s", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              ...(form.intervalType === label
                ? { background: INTERVAL_COLORS[label], color: "#0A0A0F", borderColor: INTERVAL_COLORS[label] }
                : { borderColor: INTERVAL_COLORS[label] + "55", color: INTERVAL_COLORS[label] }) }}>
            <span style={{ fontWeight: 800 }}>{label}</span>
            <span style={{ fontSize: 9, opacity: .75, fontFamily: "'JetBrains Mono',monospace" }}>{sub}</span>
          </button>
        ))}
      </div>

      <SectionLabel style={{ marginTop: 0 }}>BORG RPE</SectionLabel>
      <BorgSelector value={form.borg} onChange={v => update({ borg: v })} />

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {onCancel && (
          <button onClick={onCancel}
            style={{ flex: "0 0 90px", padding: "12px", background: "transparent",
              border: `1px solid ${t.border}`, borderRadius: 12, color: t.muted,
              fontSize: 13, fontWeight: 700, letterSpacing: 1,
              fontFamily: "'Barlow Condensed',sans-serif", cursor: "pointer" }}>
            CANCEL
          </button>
        )}
        <button onClick={trySubmit} disabled={!ready} className="save-btn"
          style={{ flex: 1, padding: "12px",
            background: ready ? "#00FF87" : t.dim, color: ready ? "#0A0A0F" : t.muted,
            border: "none", borderRadius: 12, fontSize: 15, fontWeight: 900, letterSpacing: 2,
            fontFamily: "'Barlow Condensed',sans-serif",
            cursor: ready ? "pointer" : "not-allowed", transition: "all .15s" }}>
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
  const t = useT();
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)" }} onClick={onClose} />
      <div style={{ position: "relative", background: t.bg, borderRadius: "20px 20px 0 0",
        padding: "20px 20px 40px", maxWidth: 440, margin: "0 auto", width: "100%",
        boxShadow: "0 -24px 60px rgba(0,0,0,.4)", animation: "slideUp .25s cubic-bezier(.16,1,.3,1)" }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: t.border, margin: "0 auto 16px" }} />
        <SectionLabel style={{ marginTop: 0 }}>EDIT ENTRY</SectionLabel>
        <EntryForm initial={entry} onSubmit={onSave} submitLabel="UPDATE ENTRY" onCancel={onClose} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SPARKLINE
// ═══════════════════════════════════════════════════════════════════
function LactateTrend({ sessions }) {
  const t = useT();
  if (sessions.length < 2) return null;
  const recent = sessions.slice(0, 12).reverse();
  const avgs = recent.map(s => s.entries.reduce((a, e) => a + e.lactate, 0) / s.entries.length);
  const W = 310, H = 68, P = { t: 8, r: 8, b: 20, l: 28 };
  const pW = W - P.l - P.r, pH = H - P.t - P.b;
  const minY = Math.min(1.0, ...avgs) - 0.2, maxY = Math.max(4.5, ...avgs) + 0.2;
  const X = i => P.l + (i / Math.max(recent.length - 1, 1)) * pW;
  const Y = v => P.t + pH - ((v - minY) / (maxY - minY || 1)) * pH;
  const pts = avgs.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const trend = avgs.length > 1 ? avgs[avgs.length - 1] - avgs[0] : 0;
  const tC = trend < -0.3 ? "#00FF87" : trend > 0.3 ? "#FF6B35" : "#FFD600";
  const tL = trend < -0.3 ? "↓ Improving" : trend > 0.3 ? "↑ Rising" : "→ Stable";
  return (
    <div style={{ background: t.surface, borderRadius: 12, padding: "12px 14px",
      border: `1px solid ${t.border}`, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: 2, color: t.muted, fontFamily: "'JetBrains Mono',monospace" }}>LACTATE TREND</span>
        <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: tC, fontWeight: 700 }}>{tL}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
        <rect x={P.l} y={Y(3.5)} width={pW} height={Math.max(0, Y(2.5) - Y(3.5))} fill="#FFD60012" stroke="#FFD60030" strokeWidth={0.5} />
        {[2, 3, 4].map(v => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke={t.border} strokeWidth={1} />
            <text x={P.l - 3} y={Y(v) + 4} textAnchor="end" fill={t.muted} fontSize={8} fontFamily="JetBrains Mono,monospace">{v}</text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke="#00FF87" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {avgs.map((v, i) => (
          <circle key={i} cx={X(i)} cy={Y(v)} r={3.5} fill={zone(v).color} stroke={t.bg} strokeWidth={1.5} />
        ))}
        {recent.map((s, i) => (i === 0 || i === recent.length - 1) && (
          <text key={i} x={X(i)} y={H} textAnchor={i === 0 ? "start" : "end"}
            fill={t.muted} fontSize={7} fontFamily="JetBrains Mono,monospace">{fmt(s.date, true)}</text>
        ))}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// THRESHOLD DRIFT CHART
// ═══════════════════════════════════════════════════════════════════
function ThresholdDriftChart({ drift }) {
  const t = useT();
  if (drift.length < 2) return null;
  const W = 310, H = 90, P = { t: 10, r: 10, b: 28, l: 44 };
  const pW = W - P.l - P.r, pH = H - P.t - P.b;
  const paces = drift.map(d => d.paceSec);
  const minP = Math.min(...paces) - 8, maxP = Math.max(...paces) + 8;
  const X = i => P.l + (i / Math.max(drift.length - 1, 1)) * pW;
  const Y = sec => P.t + ((sec - minP) / (maxP - minP || 1)) * pH;
  const pts = drift.map((d, i) => `${X(i)},${Y(d.paceSec)}`).join(" ");
  const improved = drift[drift.length - 1].paceSec < drift[0].paceSec;
  const lineColor = improved ? "#00FF87" : "#FF6B35";
  const delta = drift[drift.length - 1].paceSec - drift[0].paceSec;
  const deltaStr = (delta < 0 ? "↓ " : "↑ +") + secToPace(Math.abs(delta)) + " min/km";
  return (
    <div style={{ background: t.surface, borderRadius: 12, padding: "12px 14px",
      border: `1px solid ${t.border}`, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 10, letterSpacing: 2, color: t.muted, fontFamily: "'JetBrains Mono',monospace" }}>THRESHOLD DRIFT</span>
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: lineColor }}>{deltaStr}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
        {[minP + 10, (minP + maxP) / 2, maxP - 10].map((sec, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={Y(sec)} y2={Y(sec)} stroke={t.border} strokeWidth={1} />
            <text x={P.l - 4} y={Y(sec) + 4} textAnchor="end" fill={t.muted} fontSize={8} fontFamily="JetBrains Mono,monospace">{secToPace(sec)}</text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {drift.map((d, i) => (
          <circle key={i} cx={X(i)} cy={Y(d.paceSec)} r={4} fill={lineColor} stroke={t.bg} strokeWidth={1.5} />
        ))}
        {[0, drift.length - 1].map(i => (
          <text key={i} x={X(i)} y={H} textAnchor={i === 0 ? "start" : "end"}
            fill={t.muted} fontSize={7} fontFamily="JetBrains Mono,monospace">{drift[i].month}</text>
        ))}
      </svg>
      <div style={{ marginTop: 6, fontSize: 10, color: t.muted, fontFamily: "'JetBrains Mono',monospace" }}>
        Threshold pace at 3.0 mmol/L · faster = improvement
      </div>
    </div>
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
  const t = useT();
  const hmPaceSec = model.slope === 0 ? null : (3.0 - model.intercept) / model.slope;
  const fmPaceSec = model.lo;
  if (!hmPaceSec || !fmPaceSec || hmPaceSec <= 0 || fmPaceSec <= 0) return null;
  const HM_DIST = 21.0975, FM_DIST = 42.195;
  const hmTimeSec = hmPaceSec * HM_DIST;
  const fmTimeSec = fmPaceSec * FM_DIST;
  const fmFinalSec = (fmTimeSec + hmTimeSec * Math.pow(FM_DIST / HM_DIST, RIEGEL)) / 2;
  const fmFinalPace = fmFinalSec / FM_DIST;
  const races = [
    { label: "Half Marathon", dist: "21.1 km", lacRef: "3.0 mmol/L", time: hmTimeSec, pace: hmPaceSec, color: "#FFD600",
      sub: hmTimeSec < 5400 ? "Sub-90" : hmTimeSec < 6000 ? "Sub-100" : null },
    { label: "Marathon", dist: "42.2 km", lacRef: "2.5 mmol/L", time: fmFinalSec, pace: fmFinalPace, color: "#00FF87",
      sub: fmFinalSec < 10800 ? "Sub-3:00" : fmFinalSec < 11400 ? "Sub-3:10" : fmFinalSec < 12000 ? "Sub-3:20" : null },
  ];
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: t.muted, fontFamily: "'JetBrains Mono',monospace" }}>RACE PREDICTIONS</div>
        <div style={{ flex: 1, height: 1, background: t.border }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {races.map(r => (
          <div key={r.label} style={{ background: t.surface, borderRadius: 14, border: `1px solid ${r.color}33`,
            overflow: "hidden", display: "flex", alignItems: "stretch" }}>
            <div style={{ width: 4, background: r.color, flexShrink: 0 }} />
            <div style={{ flex: 1, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: 1, fontFamily: "'Barlow Condensed',sans-serif", color: t.text }}>{r.label}</div>
                  <div style={{ fontSize: 10, color: t.muted, fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>{r.dist} · based on {r.lacRef}</div>
                </div>
                {r.sub && (
                  <div style={{ background: r.color + "22", border: `1px solid ${r.color}55`, borderRadius: 20,
                    padding: "3px 10px", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: r.color, fontWeight: 700 }}>
                    {r.sub}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontSize: 42, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", color: r.color, lineHeight: 1 }}>
                  {formatRaceTime(r.time)}
                </span>
                <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono',monospace", color: t.muted }}>{secToPace(r.pace)} /km</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: t.muted, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.7 }}>
        HM based on threshold midpoint pace · FM averaged from lactate model + Riegel projection from HM (exp 1.06).
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SCATTER PLOT
// ═══════════════════════════════════════════════════════════════════
function LactateScatter({ sessions, model }) {
  const t = useT();
  const all = sessions.flatMap(s => s.entries).filter(e => e.lactate >= 1.0 && e.lactate <= 7.5 && paceToSec(e.speed) !== null);
  if (!all.length) return null;
  const W = 310, H = 150, P = { t: 10, r: 10, b: 28, l: 32 };
  const pW = W - P.l - P.r, pH = H - P.t - P.b;
  const paces = all.map(e => paceToSec(e.speed));
  const minP = Math.min(...paces) - 15, maxP = Math.max(...paces) + 15;
  const px = p => P.l + (p - minP) / (maxP - minP) * pW;
  const py = l => P.t + pH - ((l - 1.0) / 6.5) * pH;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
      <rect x={P.l} y={py(3.5)} width={pW} height={Math.max(0, py(2.5) - py(3.5))} fill="#FFD60012" stroke="#FFD60030" strokeWidth={1} />
      {[2, 3, 4, 5, 6].map(l => (
        <g key={l}>
          <line x1={P.l} x2={W - P.r} y1={py(l)} y2={py(l)} stroke={t.border} strokeWidth={1} />
          <text x={P.l - 4} y={py(l) + 4} textAnchor="end" fill={t.muted} fontSize={8} fontFamily="JetBrains Mono,monospace">{l}</text>
        </g>
      ))}
      <line x1={px(minP)} y1={py(model.slope * minP + model.intercept)}
        x2={px(maxP)} y2={py(model.slope * maxP + model.intercept)}
        stroke="#FFD600" strokeWidth={1.5} strokeDasharray="5 3" opacity={.65} />
      {all.map((e, i) => {
        const z = zone(e.lactate);
        return <circle key={i} cx={px(paceToSec(e.speed))} cy={py(e.lactate)}
          r={5} fill={z.color} fillOpacity={.85} stroke={t.bg} strokeWidth={1.5} />;
      })}
      <text x={8} y={H / 2} textAnchor="middle" fill={t.muted} fontSize={8}
        fontFamily="JetBrains Mono,monospace" transform={`rotate(-90,8,${H / 2})`}>mmol/L</text>
      {[minP + 20, (minP + maxP) / 2, maxP - 20].map((s, i) => (
        <text key={i} x={px(s)} y={H - 2} textAnchor="middle" fill={t.muted} fontSize={8} fontFamily="JetBrains Mono,monospace">{secToPace(s)}</text>
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOG VIEW
// ═══════════════════════════════════════════════════════════════════
function LogView({ sessions, setSessions }) {
  const t = useT();
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

  const fdColor = (fd) => fd == null ? t.muted : fd > 0.8 ? "#FF6B35" : fd > 0.4 ? "#FFD600" : "#00FF87";

  return (
    <div className="fade-in">
      <SectionLabel style={{ marginTop: 0 }}>ADD ENTRY</SectionLabel>
      <EntryForm key={staged.length} onSubmit={addEntry} submitLabel="ADD TO SESSION" onFormChange={f => setLiveForm(f)} />
      {liveFatigue && <FatigueBadge fatigue={liveFatigue} />}

      {staged.length > 0 && (
        <div style={{ marginTop: 22 }} className="fade-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <SectionLabel style={{ margin: 0 }}>THIS SESSION — {staged.length} {staged.length === 1 ? "ENTRY" : "ENTRIES"}</SectionLabel>
            <button onClick={() => setStaged([])}
              style={{ background: "transparent", border: "none", color: t.muted, fontSize: 11, fontFamily: "'JetBrains Mono',monospace", cursor: "pointer" }}>
              Clear all
            </button>
          </div>
          <div style={{ background: t.surface, borderRadius: 12, overflow: "hidden", border: `1px solid ${t.border}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 60px 36px 56px 28px",
              padding: "6px 12px", background: t.bg, borderBottom: `1px solid ${t.border}` }}>
              {["PACE","BPM","LA","TYPE","RPE","FAT.",""].map(h => (
                <div key={h} style={{ fontSize: 8, letterSpacing: 1.5, color: t.muted, fontFamily: "'JetBrains Mono',monospace", textAlign: "center" }}>{h}</div>
              ))}
            </div>
            {staged.map((e, i) => {
              const z = zone(e.lactate);
              return (
                <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 60px 36px 56px 28px",
                  padding: "9px 12px", alignItems: "center", borderTop: i > 0 ? `1px solid ${t.border}` : "none" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#00CFFF", textAlign: "center" }}>{e.speed}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#FF2D55", textAlign: "center" }}>{e.pulse}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: z.color, textAlign: "center" }}>{e.lactate}</span>
                  <span style={{ fontSize: 11, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, color: INTERVAL_COLORS[e.intervalType], textAlign: "center" }}>{e.intervalType}</span>
                  <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: "#FFD600", textAlign: "center" }}>{e.borg}</span>
                  <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: fdColor(e.fatigueDelta), textAlign: "center" }}>
                    {e.fatigueDelta != null ? (e.fatigueDelta >= 0 ? `+${e.fatigueDelta.toFixed(1)}` : e.fatigueDelta.toFixed(1)) : "—"}
                  </span>
                  <button onClick={() => setStaged(prev => prev.filter(x => x.id !== e.id))}
                    style={{ background: "transparent", border: "none", color: t.muted, fontSize: 14, cursor: "pointer", textAlign: "center" }}>✕</button>
                </div>
              );
            })}
          </div>
          <button onClick={saveSession} className="save-btn"
            style={{ width: "100%", marginTop: 10, padding: "15px", background: "#00FF87",
              color: "#0A0A0F", border: "none", borderRadius: 14, fontSize: 17, fontWeight: 900,
              letterSpacing: 3, fontFamily: "'Barlow Condensed',sans-serif", cursor: "pointer", transition: "all .15s" }}>
            {flashSaved ? "✓ SESSION SAVED" : "SAVE SESSION"}
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
  const t = useT();
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

  const fdColor = (fd) => fd == null ? t.muted : fd > 0.8 ? "#FF6B35" : fd > 0.4 ? "#FFD600" : "#00FF87";

  if (!sessions.length) return (
    <div className="fade-in" style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{ fontSize: 40, fontFamily: "monospace", color: t.border, marginBottom: 10 }}>—</div>
      <div style={{ color: t.muted, fontSize: 13, fontFamily: "'JetBrains Mono',monospace" }}>No sessions logged yet.</div>
    </div>
  );

  const totalEntries = sessions.reduce((n, s) => n + s.entries.length, 0);

  return (
    <div className="fade-in">
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[["SESSIONS", sessions.length], ["DATA PTS", totalEntries], ["LAST", fmt(sessions[0].date, true)]].map(([l, v]) => (
          <div key={l} style={{ flex: 1, background: t.surface, borderRadius: 10, padding: "10px 10px 8px", border: `1px solid ${t.border}` }}>
            <div style={{ fontSize: 8, letterSpacing: 2, color: t.muted, fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: t.text }}>{v}</div>
          </div>
        ))}
        <button onClick={() => exportCSV(sessions)}
          style={{ padding: "8px 12px", background: t.surface, border: `1px solid ${t.border}`,
            borderRadius: 10, color: "#00FF87", fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
            letterSpacing: 1, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>↓</span><span>CSV</span>
        </button>
      </div>

      <LactateTrend sessions={sessions} />

      {sessions.map(session => {
        const open = expandedId === session.id;
        const avgLac = session.entries.reduce((s, e) => s + e.lactate, 0) / session.entries.length;
        const z = zone(avgLac);
        const confirmDel = delConfirm === session.id;
        return (
          <div key={session.id} style={{ background: t.surface, borderRadius: 14, marginBottom: 10, border: `1px solid ${t.border}`, overflow: "hidden" }}>
            <div style={{ padding: "13px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
              onClick={() => setExpandedId(open ? null : session.id)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono',monospace", color: t.text, fontWeight: 600, marginBottom: 5 }}>{fmt(session.date)}</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                  {[...new Set(session.entries.map(e => e.intervalType))].map(it => (
                    <span key={it} style={{ fontSize: 10, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, letterSpacing: 1,
                      padding: "2px 7px", borderRadius: 5, background: INTERVAL_COLORS[it] + "22",
                      color: INTERVAL_COLORS[it], border: `1px solid ${INTERVAL_COLORS[it]}44` }}>{it}</span>
                  ))}
                  <span style={{ fontSize: 10, color: t.muted, fontFamily: "'JetBrains Mono',monospace" }}>
                    {session.entries.length} {session.entries.length === 1 ? "entry" : "entries"}
                  </span>
                </div>
              </div>
              <div style={{ textAlign: "right", marginRight: 6 }}>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: z.color, lineHeight: 1 }}>{avgLac.toFixed(1)}</div>
                <div style={{ fontSize: 9, color: t.muted, fontFamily: "'JetBrains Mono',monospace" }}>avg mmol/L</div>
              </div>
              <span style={{ color: t.muted, fontSize: 11 }}>{open ? "▲" : "▼"}</span>
            </div>

            {open && (
              <div className="fade-in" style={{ borderTop: `1px solid ${t.border}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 60px 36px 56px 80px", padding: "6px 14px", background: t.bg }}>
                  {["PACE","BPM","LA","TYPE","RPE","FAT.",""].map(h => (
                    <div key={h} style={{ fontSize: 8, letterSpacing: 1.5, color: t.muted, fontFamily: "'JetBrains Mono',monospace", textAlign: "center" }}>{h}</div>
                  ))}
                </div>
                {session.entries.map((e, i) => {
                  const ez = zone(e.lactate);
                  return (
                    <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 60px 36px 56px 80px",
                      padding: "9px 14px", alignItems: "center", borderTop: `1px solid ${t.border}`,
                      background: i % 2 === 0 ? t.surface : t.bg }}>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#00CFFF", textAlign: "center" }}>{e.speed}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#FF2D55", textAlign: "center" }}>{e.pulse}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: ez.color, textAlign: "center" }}>{e.lactate}</span>
                      <span style={{ fontSize: 11, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, color: INTERVAL_COLORS[e.intervalType], textAlign: "center" }}>{e.intervalType}</span>
                      <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: "#FFD600", textAlign: "center" }}>{e.borg}</span>
                      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: fdColor(e.fatigueDelta), textAlign: "center" }}>
                        {e.fatigueDelta != null ? (e.fatigueDelta >= 0 ? `+${e.fatigueDelta.toFixed(1)}` : e.fatigueDelta.toFixed(1)) : "—"}
                      </span>
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        <button onClick={() => setEditTarget({ sessionId: session.id, entryId: e.id })}
                          style={{ background: "transparent", border: `1px solid ${t.border}`, color: t.muted,
                            borderRadius: 6, padding: "3px 7px", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", cursor: "pointer" }}>Edit</button>
                        <button onClick={() => deleteEntry(session.id, e.id)}
                          style={{ background: "transparent", border: "1px solid #FF2D5533", color: "#FF2D55",
                            borderRadius: 6, padding: "3px 6px", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", cursor: "pointer" }}>✕</button>
                      </div>
                    </div>
                  );
                })}
                <div style={{ padding: "10px 14px", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, background: t.bg, borderTop: `1px solid ${t.border}` }}>
                  {confirmDel ? (
                    <>
                      <span style={{ fontSize: 11, color: t.muted, fontFamily: "'JetBrains Mono',monospace", marginRight: 4 }}>Delete entire session?</span>
                      <button onClick={() => setDelConfirm(null)}
                        style={{ background: "transparent", border: `1px solid ${t.border}`, color: t.muted, borderRadius: 8, padding: "5px 12px", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", cursor: "pointer" }}>Cancel</button>
                      <button onClick={() => deleteSession(session.id)}
                        style={{ background: "#FF2D55", border: "none", color: "#fff", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", cursor: "pointer", fontWeight: 700 }}>Confirm</button>
                    </>
                  ) : (
                    <button onClick={() => setDelConfirm(session.id)}
                      style={{ background: "transparent", border: "1px solid #FF2D5533", color: "#FF2D55", borderRadius: 8,
                        padding: "5px 14px", fontSize: 12, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, letterSpacing: 1, cursor: "pointer" }}>
                      Delete session
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {editTarget && (() => {
        const s = sessions.find(s => s.id === editTarget.sessionId);
        const e = s?.entries.find(e => e.id === editTarget.entryId);
        return e ? (
          <EditModal entry={e} onSave={data => updateEntry(editTarget.sessionId, editTarget.entryId, data)} onClose={() => setEditTarget(null)} />
        ) : null;
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ZONES VIEW
// ═══════════════════════════════════════════════════════════════════
function ZonesView({ sessions }) {
  const t = useT();
  const totalEntries = sessions.reduce((n, s) => n + s.entries.length, 0);
  const model = useMemo(() => buildModel(sessions), [sessions]);
  const drift = useMemo(() => computeThresholdDrift(sessions), [sessions]);

  return (
    <div className="fade-in">
      <SectionLabel style={{ marginTop: 0 }}>THRESHOLD ZONE PREDICTION</SectionLabel>
      {totalEntries < 3 ? (
        <div style={{ textAlign: "center", padding: "50px 20px" }}>
          <div style={{ fontSize: 64, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", color: t.border, marginBottom: 8 }}>{totalEntries}/3</div>
          <div style={{ color: t.muted, fontSize: 13, fontFamily: "'JetBrains Mono',monospace" }}>data points needed</div>
        </div>
      ) : !model ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: t.muted, fontFamily: "'JetBrains Mono',monospace", fontSize: 13 }}>
          Insufficient variance. Log entries across varying paces and intensities.
        </div>
      ) : (
        <>
          <div style={{ background: t.surface, borderRadius: 12, padding: 14, border: `1px solid ${t.border}`, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: t.muted }}>Model confidence</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
                color: model.r2 > .7 ? "#00FF87" : model.r2 > .4 ? "#FFD600" : "#FF6B35" }}>
                {model.r2 > .7 ? "High" : model.r2 > .4 ? "Medium" : "Low"} · R²={model.r2.toFixed(2)}
              </span>
            </div>
            <div style={{ height: 4, background: t.border, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 4, transition: "width .5s",
                width: `${Math.min(100, model.r2 * 100)}%`,
                background: model.r2 > .7 ? "#00FF87" : model.r2 > .4 ? "#FFD600" : "#FF6B35" }} />
            </div>
            <div style={{ color: t.muted, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", marginTop: 5 }}>
              Based on {model.n} entries across {sessions.length} sessions
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <ZoneCard label="Lower threshold" lactate="2.5 mmol/L" color="#ADFF2F" pace={secToPace(model.lo)} pulse={model.loP} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px" }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: "#FFD600", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>THRESHOLD ZONE</div>
              <div style={{ flex: 1, height: 1, background: "#FFD60033" }} />
            </div>
            <ZoneCard label="Upper threshold" lactate="3.5 mmol/L" color="#FFD600" pace={secToPace(model.hi)} pulse={model.hiP} />
          </div>
          {drift.length >= 2 && <ThresholdDriftChart drift={drift} />}
          <RacePrediction model={model} />
          <SectionLabel>DATA POINTS — PACE vs LACTATE</SectionLabel>
          <LactateScatter sessions={sessions} model={model} />
          <div style={{ marginTop: 14, color: t.muted, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.7 }}>
            Threshold zone = 2.5–3.5 mmol/L (Norwegian model). Drift chart requires data across 2+ calendar months.
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════
export default function LactateTracker() {
  const [sessions, setSessions] = useState([]);
  const [view, setView]         = useState("log");
  const [isDark, setIsDark]     = useState(true);
  const [user, setUser]         = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const t = isDark ? DARK : LIGHT;

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
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=JetBrains+Mono:wght@400;600&display=swap');
     html { scrollbar-gutter: stable; }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    .fade-in { animation: fadeIn .2s ease; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
    @keyframes slideUp { from { transform:translateY(100%); } to { transform:translateY(0); } }
    .metric-input::placeholder { color: ${t.dim}; }
    .metric-input:focus { outline: none; }
    .save-btn:active { transform: scale(.97); }
    input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
    input[type=number] { -moz-appearance: textfield; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: ${t.bg}; }
    ::-webkit-scrollbar-thumb { background: ${t.border}; border-radius: 2px; }
  `;

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: DARK.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#00FF87", fontFamily: "'JetBrains Mono',monospace", fontSize: 13, letterSpacing: 2 }}>LOADING...</div>
    </div>
  );

  return (
    <Ctx.Provider value={t}>
      <div style={{ minHeight: "100vh", background: t.bg, color: t.text,
        fontFamily: "'Barlow Condensed',sans-serif", maxWidth: 440, margin: "0 auto" }}>
        <style>{css}</style>

        {!user ? (
          <LoginScreen />
        ) : (
          <>
            <div style={{ padding: "18px 20px 0", borderBottom: `1px solid ${t.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 2, lineHeight: 1 }}>
                    <span style={{ color: "#00FF87", fontFamily: "'JetBrains Mono',monospace" }}>LA</span>
                    <span style={{ color: t.text }}>TRACKER</span>
                  </div>
                  <div style={{ fontSize: 11, color: t.muted, letterSpacing: 2, marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>
                    Lactate · Running · Performance
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                  <button onClick={() => setIsDark(d => !d)}
                    style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 20,
                      padding: "6px 12px", cursor: "pointer", fontSize: 15, color: t.text }}>
                    {isDark ? "☀️" : "🌙"}
                  </button>
                  <button onClick={() => supabase.auth.signOut()}
                    style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 20,
                      padding: "6px 12px", cursor: "pointer", fontSize: 10,
                      color: t.muted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>
                    OUT
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 5, paddingBottom: 14 }}>
                {[["log","Log"], ["history","History"], ["zones","Zones"]].map(([v, l]) => (
                  <button key={v} onClick={() => setView(v)}
                    style={{ background: view === v ? "#00FF87" : t.surface,
                      border: `1px solid ${view === v ? "#00FF87" : t.border}`,
                      borderRadius: 20, color: view === v ? "#0A0A0F" : t.muted,
                      padding: "5px 14px", fontFamily: "'Barlow Condensed',sans-serif",
                      fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5, transition: "all .15s" }}>
                    {l}
                    {v === "history" && sessions.length > 0 && (
                      <span style={{ background: view === "history" ? "#0A0A0F" : t.surface,
                        color: "#00FF87", borderRadius: 10, padding: "0 5px",
                        fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}>
                        {sessions.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: "20px" }}>
              {view === "log"     && <LogView     sessions={sessions} setSessions={setSessions} />}
              {view === "history" && <HistoryView sessions={sessions} setSessions={setSessions} />}
              {view === "zones"   && <ZonesView   sessions={sessions} />}
            </div>
          </>
        )}
      </div>
    </Ctx.Provider>
  );
}
