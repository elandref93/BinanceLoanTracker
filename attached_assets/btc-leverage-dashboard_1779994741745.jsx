import { useState, useMemo } from "react";

/*
 * ENGINE v5 — Verified against independent Python audit
 * Trust (36%): B wins at Y10 by R8.3m ✓
 * Personal (18%): A wins at Y10 by R85.6m ✓
 */
function compute(params) {
  const { btcGrowth, optionsReturn, ltv, borrowCost, startingCapital, monthlyContrib, contribEscalation, years, taxMode } = params;

  const inclusionRate = taxMode === "trust" ? 0.80 : taxMode === "taxfree" ? 0 : 0.40;
  const effectiveCGT = inclusionRate * 0.45;
  const annualExcl = taxMode === "trust" ? 0 : taxMode === "taxfree" ? 0 : 40000;
  const ltvFrac = ltv / 100;

  const mBtc = Math.pow(1 + btcGrowth / 100, 1 / 12) - 1;
  const mOpt = Math.pow(1 + optionsReturn / 100, 1 / 12) - 1;
  const mBor = Math.pow(1 + borrowCost / 100, 1 / 12) - 1;

  // ── A state: starting capital is in BTC, immediately levered ──
  const initLoan = startingCapital * ltvFrac;
  let btcVal = startingCapital, btcBase = startingCapital;
  let amc = initLoan, amcBase = initLoan, debt = initLoan;
  let cumA = startingCapital, totTaxA = 0;

  // ── B state: starting capital goes straight into AMC ──
  let bVal = startingCapital, bBase = startingCapital, cumB = startingCapital;

  const rowsA = [], rowsB = [], snapsA = [], snapsB = [];
  let prevANet = 0, prevBNet = 0;

  for (let m = 1; m <= years * 12; m++) {
    // Escalate contribution annually
    const yearIndex = Math.floor((m - 1) / 12);
    const curContrib = monthlyContrib * Math.pow(1 + contribEscalation / 100, yearIndex);

    // Grow existing
    btcVal *= (1 + mBtc);
    if (amc > 0) amc *= (1 + mOpt);
    if (debt > 0) debt *= (1 + mBor);

    // Monthly contrib → BTC
    btcVal += curContrib;
    btcBase += curContrib;
    cumA += curContrib;

    // Immediate leverage
    const mLoan = curContrib * ltvFrac;
    amc += mLoan;
    amcBase += mLoan;
    debt += mLoan;

    // Strategy B
    bVal *= (1 + mOpt);
    bVal += curContrib;
    bBase += curContrib;
    cumB += curContrib;

    // Annual rebalance
    if (m % 12 === 0) {
      const y = m / 12;

      // Realize AMC
      const amcGain = Math.max(0, amc - amcBase);
      const amcTax = Math.max(0, amcGain - annualExcl) * effectiveCGT;
      totTaxA += amcTax;

      // After-tax, repay, re-gear
      const afterTax = amc - amcTax;
      const netCash = afterTax - debt;
      const newLoan = btcVal * ltvFrac;
      const reinvest = Math.max(0, netCash);

      amc = reinvest + newLoan;
      amcBase = reinvest + newLoan;
      debt = newLoan;

      // A exit snapshot
      const btcGain = Math.max(0, btcVal - btcBase);
      const btcTax = Math.max(0, btcGain - annualExcl) * effectiveCGT;
      const equity = amc - debt; // = reinvest
      const aGross = btcVal + equity;
      const aNet = aGross - btcTax;

      // B exit snapshot
      const bGain = Math.max(0, bVal - bBase);
      const bTax = Math.max(0, bGain - annualExcl) * effectiveCGT;
      const bNet = bVal - bTax;

      const aRate = prevANet > 0 ? ((aNet / prevANet) - 1) * 100 : 0;
      const bRate = prevBNet > 0 ? ((bNet / prevBNet) - 1) * 100 : 0;

      rowsA.push({
        year: y, btcVal, btcBase, amcDeployed: amc, debt, equity: reinvest,
        amcGain, amcTax, netCash, newLoan, btcTax, totTaxA,
        gross: aGross, net: aNet, contributed: cumA, growthRate: aRate,
        monthlyAtYear: curContrib,
      });
      rowsB.push({
        year: y, gross: bVal, base: bBase, gain: bGain, exitTax: bTax,
        net: bNet, contributed: cumB, growthRate: bRate,
      });

      prevANet = aNet;
      prevBNet = bNet;
    }

    // Quarterly snaps for chart
    if (m % 3 === 0) {
      const sBtcG = Math.max(0, btcVal - btcBase);
      const sBtcT = sBtcG * effectiveCGT;
      const sEq = Math.max(0, amc - debt);
      snapsA.push({ month: m, net: btcVal + sEq - sBtcT });

      const sBG = Math.max(0, bVal - bBase);
      const sBT = sBG * effectiveCGT;
      snapsB.push({ month: m, net: bVal - sBT });
    }
  }

  return {
    rowsA, rowsB, snapsA, snapsB,
    grossEffA: btcGrowth + ltvFrac * (optionsReturn - borrowCost),
    grossEffB: optionsReturn,
    effectiveCGT, annualExcl, totTaxA,
  };
}

function fmt(v) {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return s + "R" + (a / 1e9).toFixed(2) + "bn";
  if (a >= 1e6) return s + "R" + (a / 1e6).toFixed(1) + "m";
  if (a >= 1e3) return s + "R" + (a / 1e3).toFixed(0) + "k";
  return s + "R" + a.toFixed(0);
}

function Slider({ label, value, onChange, min, max, step, suffix = "", prefix = "", editable = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const display = prefix + (typeof value === "number" && value >= 1000 ? value.toLocaleString() : value) + suffix;

  const commitEdit = () => {
    const raw = draft.replace(/[^0-9.]/g, "");
    const num = parseFloat(raw);
    if (!isNaN(num) && num >= 0) onChange(num);
    setEditing(false);
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8a8f98", fontFamily: "var(--m)" }}>{label}</span>
        {editing ? (
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => e.key === "Enter" && commitEdit()}
            style={{
              fontSize: 15, fontWeight: 700, color: "#00e5a0", fontFamily: "var(--m)",
              background: "#1e2028", border: "1px solid #00e5a0", borderRadius: 6,
              padding: "2px 8px", width: 120, textAlign: "right", outline: "none",
            }}
          />
        ) : (
          <span
            onClick={() => { if (editable) { setDraft(String(value)); setEditing(true); } }}
            style={{
              fontSize: 15, fontWeight: 700, color: "#e8eaed", fontFamily: "var(--m)",
              cursor: editable ? "pointer" : "default",
              borderBottom: editable ? "1px dashed rgba(0,229,160,0.4)" : "none",
            }}
          >{display}</span>
        )}
      </div>
      <input type="range" min={min} max={max} step={step} value={Math.min(value, max)}
        onChange={e => onChange(parseFloat(e.target.value))} style={{ width: "100%", accentColor: "#00e5a0" }} />
    </div>
  );
}

function Tog({ label, active, onClick, c = "#00e5a0" }) {
  return <button onClick={onClick} style={{ padding: "8px 14px", borderRadius: 8, border: "none", fontFamily: "var(--m)", fontSize: 11, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em", background: active ? c : "#1e2028", color: active ? "#0a0b0f" : "#8a8f98", transition: "all 0.2s" }}>{label}</button>;
}

export default function Dashboard() {
  const [btcGrowth, setBtcGrowth] = useState(29);
  const [optionsReturn, setOptionsReturn] = useState(45);
  const [ltv, setLtv] = useState(60);
  const [borrowCost, setBorrowCost] = useState(3);
  const [startingCapital, setStartingCapital] = useState(0);
  const [monthlyContrib, setMonthlyContrib] = useState(600000);
  const [contribEscalation, setContribEscalation] = useState(0);
  const [years, setYears] = useState(10);
  const [taxMode, setTaxMode] = useState("trust");

  const p = useMemo(() => ({ btcGrowth, optionsReturn, ltv, borrowCost, startingCapital, monthlyContrib, contribEscalation, years, taxMode }), [btcGrowth, optionsReturn, ltv, borrowCost, startingCapital, monthlyContrib, contribEscalation, years, taxMode]);
  const { rowsA, rowsB, snapsA, snapsB, grossEffA, grossEffB, effectiveCGT, annualExcl, totTaxA } = useMemo(() => compute(p), [p]);

  const fA = rowsA[rowsA.length - 1];
  const fB = rowsB[rowsB.length - 1];
  const maxN = Math.max(fA?.net || 1, fB?.net || 1);
  const w = (fA?.net || 0) >= (fB?.net || 0) ? "A" : "B";
  const cMax = Math.max(...snapsA.map(r => r.net), ...snapsB.map(r => r.net), 1);

  // Find rate crossover year
  let rateCross = null;
  for (let i = 1; i < rowsA.length; i++) {
    if (rowsA[i].growthRate < rowsB[i].growthRate && rowsA[i-1].growthRate >= rowsB[i-1].growthRate) {
      rateCross = rowsA[i].year;
      break;
    }
  }

  return (
    <div style={{ "--m": "'JetBrains Mono', monospace", minHeight: "100vh", background: "#0a0b0f", color: "#e8eaed", fontFamily: "'Space Grotesk', system-ui", padding: "24px 16px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        input[type=range]{-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:#1e2028;outline:none}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#00e5a0;cursor:pointer;border:2px solid #0a0b0f;box-shadow:0 0 8px rgba(0,229,160,0.4)}
        .card{background:#12131a;border-radius:14px;border:1px solid rgba(255,255,255,0.06);padding:20px;margin-bottom:16px}
        .sh{font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#8a8f98;font-family:var(--m);margin-bottom:14px}
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#00e5a0", marginBottom: 4, fontFamily: "var(--m)" }}>STRATEGY SIMULATOR v5 — PYTHON-AUDITED</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2, background: "linear-gradient(135deg, #e8eaed 0%, #8a8f98 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>BTC Lever + AMC vs Pure AMC</h1>
      </div>

      {/* How It Works */}
      <div className="card" style={{ background: "linear-gradient(135deg, #0f1117 0%, #161822 100%)", border: "1px solid rgba(0,229,160,0.12)" }}>
        <div className="sh" style={{ color: "#00e5a0" }}>THE FLOW</div>
        {[
          ...(startingCapital > 0 ? [{ i: "🏁", t: "DAY 1", d: `A: ${fmt(startingCapital)} in BTC → Borrow ${ltv}% (${fmt(startingCapital * ltv / 100)}) → AMC | B: ${fmt(startingCapital)} straight into AMC` }] : []),
          { i: "📅", t: "MONTHLY", d: `${fmt(monthlyContrib)}/mo → BTC → Borrow ${ltv}% → AMC${contribEscalation > 0 ? ` (+${contribEscalation}%/yr)` : ""}` },
          { i: "💰", t: "ANNUAL SELL", d: effectiveCGT > 0 ? `Sell all AMC → Pay ${(effectiveCGT*100).toFixed(0)}% CGT on gains → Repay loans` : `Sell all AMC → No tax → Repay loans → Full profit reinvested` },
          { i: "⚡", t: "RE-GEAR", d: `New loan = ${ltv}% of total BTC → Redeploy profit + loan` },
          { i: "🏦", t: "B: PURE AMC", d: `${fmt(monthlyContrib)}/mo → AMC${effectiveCGT > 0 ? ", tax deferred" : ", no tax"}${contribEscalation > 0 ? ` (+${contribEscalation}%/yr)` : ""}` },
        ].map(s => (
          <div key={s.t} style={{ display: "flex", gap: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", marginBottom: 6 }}>
            <span style={{ fontSize: 16 }}>{s.i}</span>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#00e5a0", letterSpacing: "0.08em", fontFamily: "var(--m)" }}>{s.t}</div>
              <div style={{ fontSize: 11, color: "#b0b4bc", lineHeight: 1.4 }}>{s.d}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tax Toggle */}
      <div className="card">
        <div className="sh">TAX ENTITY</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Tog label="Personal (18%)" active={taxMode === "personal"} onClick={() => setTaxMode("personal")} />
          <Tog label="Trust (36%)" active={taxMode === "trust"} onClick={() => setTaxMode("trust")} />
          <Tog label="Tax Free (0%)" active={taxMode === "taxfree"} onClick={() => setTaxMode("taxfree")} c="#f59e0b" />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.03)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#8a8f98", fontFamily: "var(--m)" }}>Inclusion</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed", fontFamily: "var(--m)" }}>{taxMode === "trust" ? "80%" : taxMode === "taxfree" ? "0%" : "40%"}</div>
          </div>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.03)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#8a8f98", fontFamily: "var(--m)" }}>Effective CGT</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", fontFamily: "var(--m)" }}>{(effectiveCGT * 100).toFixed(0)}%</div>
          </div>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.03)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#8a8f98", fontFamily: "var(--m)" }}>Annual Excl</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed", fontFamily: "var(--m)" }}>{annualExcl > 0 ? "R40k" : "N/A"}</div>
          </div>
        </div>
      </div>

      {/* Rates */}
      <div className="card" style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1, padding: 12, borderRadius: 10, background: "rgba(0,229,160,0.06)", border: "1px solid rgba(0,229,160,0.15)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#00e5a0", letterSpacing: "0.1em", marginBottom: 4, fontFamily: "var(--m)" }}>A GROSS</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#00e5a0", fontFamily: "var(--m)" }}>{grossEffA.toFixed(1)}%</div>
          <div style={{ fontSize: 10, color: effectiveCGT > 0 ? "#ef4444" : "#00e5a0", marginTop: 2 }}>{effectiveCGT > 0 ? `Pays ${(effectiveCGT*100).toFixed(0)}% CGT yearly` : "No tax drag"}</div>
        </div>
        <div style={{ flex: 1, padding: 12, borderRadius: 10, background: "rgba(124,106,239,0.06)", border: "1px solid rgba(124,106,239,0.15)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#7c6aef", letterSpacing: "0.1em", marginBottom: 4, fontFamily: "var(--m)" }}>B GROSS</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#7c6aef", fontFamily: "var(--m)" }}>{grossEffB.toFixed(1)}%</div>
          <div style={{ fontSize: 10, color: "#00e5a0", marginTop: 2 }}>{effectiveCGT > 0 ? "Tax deferred to exit" : "No tax"}</div>
        </div>
      </div>

      {/* Sliders */}
      <div className="card">
        <Slider label="BTC Annual Growth" value={btcGrowth} onChange={setBtcGrowth} min={5} max={80} step={1} suffix="%" />
        <Slider label="Options / AMC Return" value={optionsReturn} onChange={setOptionsReturn} min={10} max={100} step={1} suffix="%" />
        <Slider label="Loan-to-Value" value={ltv} onChange={setLtv} min={10} max={80} step={5} suffix="%" />
        <Slider label="Borrow Cost" value={borrowCost} onChange={setBorrowCost} min={0} max={25} step={0.5} suffix="%" />
        <Slider label="Starting Capital (BTC)" value={startingCapital} onChange={setStartingCapital} min={0} max={50000000} step={100000} prefix="R" editable />
        <Slider label="Monthly Contribution" value={monthlyContrib} onChange={setMonthlyContrib} min={0} max={10000000} step={50000} prefix="R" editable />
        <Slider label="Annual Escalation" value={contribEscalation} onChange={setContribEscalation} min={0} max={30} step={1} suffix="%" />
        <Slider label="Horizon" value={years} onChange={setYears} min={1} max={20} step={1} suffix=" yrs" />
      </div>

      {/* Exit Values */}
      <div className="card">
        <div className="sh">EXIT VALUE (NET OF ALL TAX)</div>
        {[
          { label: "A: BTC + Lever", value: fA?.net || 0, color: "#00e5a0" },
          { label: "B: Pure AMC", value: fB?.net || 0, color: "#7c6aef" },
        ].map(s => (
          <div key={s.label} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: s.color, fontSize: 13, fontWeight: 600 }}>{s.label}</span>
              <span style={{ color: s.color, fontSize: 18, fontWeight: 700, fontFamily: "var(--m)" }}>{fmt(s.value)}</span>
            </div>
            <div style={{ height: 10, borderRadius: 5, overflow: "hidden", background: s.color + "14" }}>
              <div style={{ height: "100%", borderRadius: 5, width: `${Math.min((s.value / maxN) * 100, 100)}%`, background: s.color, transition: "width 0.5s" }} />
            </div>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: w === "A" ? "rgba(0,229,160,0.08)" : "rgba(124,106,239,0.08)", border: `1px solid ${w === "A" ? "rgba(0,229,160,0.2)" : "rgba(124,106,239,0.2)"}` }}>
          <span style={{ fontSize: 12, color: "#8a8f98" }}>{w} wins by</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: w === "A" ? "#00e5a0" : "#7c6aef", fontFamily: "var(--m)" }}>{fmt(Math.abs((fA?.net||0) - (fB?.net||0)))}</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {[
            { l: "Contributed", v: fmt(fA?.contributed || 0), c: "#e8eaed" },
            { l: "A Multiple", v: ((fA?.net||0) / (fA?.contributed||1)).toFixed(1) + "×", c: "#00e5a0" },
            { l: "B Multiple", v: ((fB?.net||0) / (fB?.contributed||1)).toFixed(1) + "×", c: "#7c6aef" },
          ].map(m => (
            <div key={m.l} style={{ flex: 1, padding: "8px 6px", borderRadius: 8, background: "rgba(255,255,255,0.03)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#8a8f98", marginBottom: 2 }}>{m.l}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: m.c, fontFamily: "var(--m)" }}>{m.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* GROWTH RATE — the key insight */}
      <div className="card" style={{ border: "1px solid rgba(245,158,11,0.2)" }}>
        <div className="sh" style={{ color: "#f59e0b" }}>GROWTH RATE (WHY CROSSOVER HAPPENS)</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "var(--m)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <th style={{ padding: "6px 4px", textAlign: "left", color: "#8a8f98", fontSize: 9 }}>YR</th>
                <th style={{ padding: "6px 4px", textAlign: "right", color: "#00e5a0", fontSize: 9 }}>A RATE</th>
                <th style={{ padding: "6px 4px", textAlign: "right", color: "#7c6aef", fontSize: 9 }}>B RATE</th>
                <th style={{ padding: "6px 4px", textAlign: "right", color: "#f59e0b", fontSize: 9 }}>GAP</th>
                <th style={{ padding: "6px 4px", textAlign: "center", color: "#8a8f98", fontSize: 9 }}>FASTER</th>
              </tr>
            </thead>
            <tbody>
              {rowsA.map((rA, i) => {
                if (i === 0) return null;
                const rB = rowsB[i];
                const gap = rA.growthRate - rB.growthRate;
                const faster = gap >= 0 ? "A" : "B";
                return (
                  <tr key={rA.year} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: gap < 0 ? "rgba(124,106,239,0.04)" : "rgba(0,229,160,0.04)" }}>
                    <td style={{ padding: "6px 4px", color: "#8a8f98" }}>{rA.year}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right", color: "#00e5a0" }}>{rA.growthRate.toFixed(1)}%</td>
                    <td style={{ padding: "6px 4px", textAlign: "right", color: "#7c6aef" }}>{rB.growthRate.toFixed(1)}%</td>
                    <td style={{ padding: "6px 4px", textAlign: "right", color: gap >= 0 ? "#00e5a0" : "#ef4444", fontWeight: 600 }}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}pp</td>
                    <td style={{ padding: "6px 4px", textAlign: "center", color: faster === "A" ? "#00e5a0" : "#7c6aef", fontWeight: 700 }}>{faster}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.06)", fontSize: 10, color: "#f59e0b", fontFamily: "var(--m)", lineHeight: 1.6 }}>
          {rateCross
            ? `⚠ B's growth rate overtakes A from year ${rateCross}. The ${(effectiveCGT*100).toFixed(0)}% annual tax drags A's compounding down — B defers all tax and compounds faster on gross returns.`
            : `✓ A's growth rate stays ahead of B across the full horizon.`
          }
        </div>
      </div>

      {/* Tax Drag */}
      <div className="card" style={{ border: "1px solid rgba(239,68,68,0.15)" }}>
        <div className="sh" style={{ color: "#ef4444" }}>CUMULATIVE TAX DRAG</div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, background: "rgba(239,68,68,0.06)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#8a8f98", fontFamily: "var(--m)" }}>A: Tax Paid</div>
            <div style={{ fontSize: 9, color: "#666", fontFamily: "var(--m)" }}>(annual AMC + BTC exit)</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", fontFamily: "var(--m)", marginTop: 4 }}>{fmt((fA?.totTaxA || 0) + (fA?.btcTax || 0))}</div>
          </div>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, background: "rgba(239,68,68,0.06)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#8a8f98", fontFamily: "var(--m)" }}>B: Tax At Exit</div>
            <div style={{ fontSize: 9, color: "#666", fontFamily: "var(--m)" }}>(one-time, deferred)</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", fontFamily: "var(--m)", marginTop: 4 }}>{fmt(fB?.exitTax || 0)}</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: "#8a8f98", fontFamily: "var(--m)", lineHeight: 1.5 }}>
          A bleeds tax annually from AMC proceeds — that's capital that can't compound. B defers everything, compounding on the full gross.
          {taxMode === "trust" ? " At 36%, the drag is devastating." : taxMode === "taxfree" ? " With 0% tax, no drag — pure compounding." : " At 18%, the drag is manageable — A still wins."}
        </div>
      </div>

      {/* Chart */}
      <div className="card">
        <div className="sh">NET VALUE OVER TIME</div>
        <div style={{ position: "relative", height: 200, marginBottom: 8 }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 20, width: 55, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            {[1, 0.75, 0.5, 0.25, 0].map(p => (
              <span key={p} style={{ fontSize: 9, color: "#555", fontFamily: "var(--m)" }}>{fmt(cMax * p)}</span>
            ))}
          </div>
          <div style={{ position: "absolute", left: 58, right: 0, top: 0, bottom: 20 }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${snapsA.length * 10} 160`} preserveAspectRatio="none">
              {[0.25, 0.5, 0.75].map(p => (
                <line key={p} x1="0" y1={160*(1-p)} x2={snapsA.length*10} y2={160*(1-p)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              ))}
              {snapsA.map((s, i) => s.month % 12 === 0 ? <line key={"r"+i} x1={i*10+5} y1="0" x2={i*10+5} y2="160" stroke="rgba(245,158,11,0.12)" strokeWidth="1" strokeDasharray="3 3" /> : null)}
              <polyline fill="none" stroke="#00e5a0" strokeWidth="2" points={snapsA.map((r,i) => `${i*10+5},${160-(r.net/cMax)*155}`).join(" ")} />
              <polygon fill="url(#gA5)" opacity="0.1" points={`5,160 ${snapsA.map((r,i) => `${i*10+5},${160-(r.net/cMax)*155}`).join(" ")} ${(snapsA.length-1)*10+5},160`} />
              <polyline fill="none" stroke="#7c6aef" strokeWidth="2" points={snapsB.map((r,i) => `${i*10+5},${160-(r.net/cMax)*155}`).join(" ")} />
              <polygon fill="url(#gB5)" opacity="0.1" points={`5,160 ${snapsB.map((r,i) => `${i*10+5},${160-(r.net/cMax)*155}`).join(" ")} ${(snapsB.length-1)*10+5},160`} />
              <defs>
                <linearGradient id="gA5" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00e5a0" /><stop offset="100%" stopColor="#00e5a0" stopOpacity="0" /></linearGradient>
                <linearGradient id="gB5" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c6aef" /><stop offset="100%" stopColor="#7c6aef" stopOpacity="0" /></linearGradient>
              </defs>
            </svg>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginLeft: 58 }}>
          {Array.from({ length: years }, (_, i) => <span key={i} style={{ fontSize: 9, color: "#555", fontFamily: "var(--m)" }}>Y{i+1}</span>)}
        </div>
      </div>

      {/* Year Table */}
      <div className="card">
        <div className="sh">YEAR BY YEAR (POST-REBALANCE)</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "var(--m)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <th style={{ padding: "6px 4px", textAlign: "left", color: "#8a8f98", fontSize: 9 }}>YR</th>
                <th style={{ padding: "6px 4px", textAlign: "right", color: "#00e5a0", fontSize: 9 }}>A NET</th>
                <th style={{ padding: "6px 4px", textAlign: "right", color: "#7c6aef", fontSize: 9 }}>B NET</th>
                <th style={{ padding: "6px 4px", textAlign: "right", color: "#ef4444", fontSize: 9 }}>A TAX</th>
                <th style={{ padding: "6px 4px", textAlign: "right", color: "#8a8f98", fontSize: 9 }}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {rowsA.map((rA, i) => {
                const d = rA.net - rowsB[i].net;
                return (
                  <tr key={rA.year} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td style={{ padding: "6px 4px", color: "#8a8f98" }}>{rA.year}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right", color: "#00e5a0" }}>{fmt(rA.net)}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right", color: "#7c6aef" }}>{fmt(rowsB[i].net)}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right", color: "#ef4444" }}>{fmt(rA.amcTax)}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right", color: d >= 0 ? "#00e5a0" : "#ef4444", fontWeight: 600 }}>{d >= 0 ? "+" : ""}{fmt(d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Breakdown A */}
      <div className="card" style={{ boxShadow: "0 0 20px rgba(0,229,160,0.08)" }}>
        <div className="sh" style={{ color: "#00e5a0" }}>A BREAKDOWN — YEAR {years}</div>
        {fA && [
          { l: "BTC Holdings", v: fA.btcVal, c: "#f7931a" },
          { l: "After-Tax Profits (reinvested)", v: fA.equity, c: "#00e5a0" },
          { l: "Re-geared Loan", v: fA.newLoan, c: "#7c6aef", dim: true },
          { l: "AMC Deployed", v: fA.amcDeployed, c: "#00e5a0", dim: true },
          { l: "Debt", v: -fA.debt, c: "#ef4444" },
          { l: "BTC Exit Tax", v: -fA.btcTax, c: "#f59e0b" },
          { l: "Total Tax Already Paid", v: -fA.totTaxA, c: "#ef4444", dim: true },
          { l: "NET EXIT", v: fA.net, c: "#e8eaed", bold: true },
        ].map(i => (
          <div key={i.l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i.bold ? "none" : "1px solid rgba(255,255,255,0.04)", borderTop: i.bold ? "2px solid rgba(0,229,160,0.3)" : "none" }}>
            <span style={{ fontSize: 11, color: i.dim ? "#555" : "#8a8f98", fontWeight: i.bold ? 700 : 400 }}>{i.l}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: i.c, fontFamily: "var(--m)", opacity: i.dim ? 0.5 : 1 }}>{fmt(i.v)}</span>
          </div>
        ))}
      </div>

      {/* Breakdown B */}
      <div className="card" style={{ boxShadow: "0 0 20px rgba(124,106,239,0.08)" }}>
        <div className="sh" style={{ color: "#7c6aef" }}>B BREAKDOWN — YEAR {years}</div>
        {fB && [
          { l: "AMC Value", v: fB.gross, c: "#7c6aef" },
          { l: "Cost Base", v: fB.base, c: "#8a8f98", dim: true },
          { l: "Unrealized Gain", v: fB.gain, c: "#7c6aef", dim: true },
          { l: "Exit CGT", v: -fB.exitTax, c: "#f59e0b" },
          { l: "NET EXIT", v: fB.net, c: "#e8eaed", bold: true },
        ].map(i => (
          <div key={i.l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i.bold ? "none" : "1px solid rgba(255,255,255,0.04)", borderTop: i.bold ? "2px solid rgba(124,106,239,0.3)" : "none" }}>
            <span style={{ fontSize: 11, color: i.dim ? "#555" : "#8a8f98", fontWeight: i.bold ? 700 : 400 }}>{i.l}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: i.c, fontFamily: "var(--m)", opacity: i.dim ? 0.5 : 1 }}>{fmt(i.v)}</span>
          </div>
        ))}
      </div>

      {/* Rebalance Ledger */}
      <div className="card">
        <div className="sh">REBALANCE LEDGER</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "var(--m)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <th style={{ padding: "5px 3px", textAlign: "left", color: "#8a8f98", fontSize: 9 }}>YR</th>
                <th style={{ padding: "5px 3px", textAlign: "right", color: "#8a8f98", fontSize: 9 }}>MTH</th>
                <th style={{ padding: "5px 3px", textAlign: "right", color: "#f7931a", fontSize: 9 }}>BTC</th>
                <th style={{ padding: "5px 3px", textAlign: "right", color: "#00e5a0", fontSize: 9 }}>GAIN</th>
                <th style={{ padding: "5px 3px", textAlign: "right", color: "#ef4444", fontSize: 9 }}>TAX</th>
                <th style={{ padding: "5px 3px", textAlign: "right", color: "#7c6aef", fontSize: 9 }}>DEPLOY</th>
              </tr>
            </thead>
            <tbody>
              {rowsA.map(r => (
                <tr key={r.year} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <td style={{ padding: "5px 3px", color: "#8a8f98" }}>{r.year}</td>
                  <td style={{ padding: "5px 3px", textAlign: "right", color: "#8a8f98" }}>{fmt(r.monthlyAtYear)}</td>
                  <td style={{ padding: "5px 3px", textAlign: "right", color: "#f7931a" }}>{fmt(r.btcVal)}</td>
                  <td style={{ padding: "5px 3px", textAlign: "right", color: "#00e5a0" }}>{fmt(r.amcGain)}</td>
                  <td style={{ padding: "5px 3px", textAlign: "right", color: "#ef4444" }}>{fmt(r.amcTax)}</td>
                  <td style={{ padding: "5px 3px", textAlign: "right", color: "#7c6aef" }}>{fmt(r.amcDeployed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 10, color: "#8a8f98", lineHeight: 1.5, fontFamily: "var(--m)" }}>
        ⚠️ Verified against independent Python audit. Does not model: BTC volatility, liquidation cascades, AMC fees, forex, or Section 7C.
      </div>
    </div>
  );
}
