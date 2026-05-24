import React from "react";
import { ChevronRight, KeyRound, Plus, Check, RefreshCw } from "lucide-react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator, TabBar, ACCOUNTS, useCurrency, USD_ZAR_RATE } from "./_phone";

export function Settings() {
  const { c, set } = useCurrency();
  const [target, setTarget] = React.useState(65);
  const [warning, setWarning] = React.useState(72);
  const [danger, setDanger] = React.useState(76);
  const [refreshIv, setRefreshIv] = React.useState<"15m" | "1h" | "manual">("15m");

  return (
    <Phone>
      <StatusBar />
      <div className="px-5 pt-2 pb-3 shrink-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-primary">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {/* Triple-handle threshold slider */}
        <Section title="Loan thresholds">
          <div className="px-4 py-4">
            <TripleSlider target={target} warning={warning} danger={danger} onTarget={setTarget} onWarning={setWarning} onDanger={setDanger} />
            <div className="grid grid-cols-3 gap-2 mt-4">
              <ThresholdLabel name="Target" value={target} color="var(--ledger-safe)" />
              <ThresholdLabel name="Warning" value={warning} color="var(--ledger-warning)" />
              <ThresholdLabel name="Danger" value={danger} color="var(--ledger-danger)" />
            </div>
            <div className="text-[10px] text-muted mt-3 tabular leading-tight">Liquidation is set by Binance at 78% and shown as the right edge.</div>
          </div>
        </Section>

        {/* Display currency */}
        <Section title="Display currency">
          <div className="px-4 py-3">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#0F0F11]">
              {(["USD", "ZAR"] as const).map(opt => (
                <button key={opt} onClick={() => set(opt)} className="py-2 text-[12px] font-semibold rounded-md transition-colors"
                  style={{ backgroundColor: c === opt ? "var(--ledger-surface-elevated)" : "transparent", color: c === opt ? "var(--ledger-text)" : "var(--ledger-muted)" }}>
                  {opt === "USD" ? "US Dollar ($)" : "South African Rand (R)"}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-muted tabular mt-2">Rate: 1 USD = R {USD_ZAR_RATE.toFixed(2)} · auto-updated daily</div>
          </div>
        </Section>

        {/* Refresh interval */}
        <Section title="Data refresh">
          <div className="px-4 py-3">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#0F0F11]">
              {(["15m", "1h", "manual"] as const).map(opt => (
                <button key={opt} onClick={() => setRefreshIv(opt)} className="py-2 text-[12px] font-semibold rounded-md transition-colors"
                  style={{ backgroundColor: refreshIv === opt ? "var(--ledger-surface-elevated)" : "transparent", color: refreshIv === opt ? "var(--ledger-text)" : "var(--ledger-muted)" }}>
                  {opt === "manual" ? "Manual" : `Every ${opt}`}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Binance accounts with per-account test + last sync */}
        <Section title="Binance accounts" trailing={<span className="text-[10px] text-muted tabular">{ACCOUNTS.length} connected</span>}>
          {ACCOUNTS.map((a, i) => (
            <div key={a.id} className={`px-4 py-3 ${i < ACCOUNTS.length - 1 ? "border-b border-subtle" : "border-b border-subtle"}`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--ledger-accent-muted)" }}>
                  <KeyRound className="w-4 h-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-primary truncate">{a.name}</span>
                    <span className="inline-flex items-center gap-1 shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-safe" />
                      <span className="text-[10px] uppercase tracking-wide text-safe font-medium">Live</span>
                    </span>
                  </div>
                  <div className="text-[11px] text-muted tabular truncate">{a.apiKeyMasked} · read-only · synced 2m ago</div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-[#3A3A3C] shrink-0" />
              </div>
              <div className="flex gap-2 mt-2.5 ml-12">
                <button className="px-2.5 py-1 rounded-md bg-[#0F0F11] border border-subtle text-[10px] font-medium text-primary flex items-center gap-1">
                  <Check className="w-3 h-3 text-safe" /> Test connection
                </button>
                <button className="px-2.5 py-1 rounded-md bg-[#0F0F11] border border-subtle text-[10px] font-medium text-primary">Rename</button>
                <button className="px-2.5 py-1 rounded-md bg-[#0F0F11] border border-subtle text-[10px] font-medium text-danger">Remove</button>
              </div>
            </div>
          ))}
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[#0F0F11] border border-dashed border-subtle">
              <Plus className="w-4 h-4 text-muted" />
            </div>
            <span className="text-[13px] font-medium text-accent">Add another Binance account</span>
          </div>
        </Section>

        <Section title="Notifications">
          <Toggle label="Warning alerts" sub="Push when LTV crosses warning threshold" on />
          <Toggle label="Danger alerts" sub="Push when LTV crosses danger threshold" on />
          <Toggle label="Daily summary" sub="9:00 AM digest of loan + interest" last />
        </Section>

        <Section title="Account">
          <Row label="Google account" value="alex@ledger.app" />
          <Row label="Sign out" value="" valueClass="text-danger" last />
        </Section>

        <div className="text-center mt-6 mb-2">
          <div className="text-[10px] text-muted tabular tracking-widest uppercase">Ledger · v1.0.4 · Private build</div>
        </div>
      </div>
      <TabBar active="settings" />
      <HomeIndicator />
    </Phone>
  );
}

// Triple-handle slider: target (cyan), warning (amber), danger (red). Liquidation pinned at 78.
function TripleSlider({ target, warning, danger, onTarget, onWarning, onDanger }: {
  target: number; warning: number; danger: number;
  onTarget: (n: number) => void; onWarning: (n: number) => void; onDanger: (n: number) => void;
}) {
  const MAX = 78; // liquidation
  const pos = (v: number) => `${(v / MAX) * 100}%`;
  const handleSize = 16;

  const startDrag = (which: "target" | "warning" | "danger") => (e: React.PointerEvent<HTMLDivElement>) => {
    const bar = (e.currentTarget.parentElement as HTMLElement);
    const rect = bar.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(0, ev.clientX - rect.left), rect.width);
      const pct = (x / rect.width) * MAX;
      const rounded = Math.round(pct);
      if (which === "target") onTarget(Math.min(rounded, warning - 1));
      else if (which === "warning") onWarning(Math.min(Math.max(rounded, target + 1), danger - 1));
      else onDanger(Math.min(Math.max(rounded, warning + 1), MAX - 1));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="select-none">
      <div className="relative h-2 rounded-full bg-[#1F1F22]" style={{ touchAction: "none" }}>
        {/* Zone fills */}
        <div className="absolute top-0 bottom-0 left-0 rounded-l-full bg-safe/50" style={{ width: pos(target) }} />
        <div className="absolute top-0 bottom-0 bg-warning/40" style={{ left: pos(target), width: `calc(${pos(warning)} - ${pos(target)})` }} />
        <div className="absolute top-0 bottom-0 bg-danger/40" style={{ left: pos(warning), width: `calc(${pos(danger)} - ${pos(warning)})` }} />
        <div className="absolute top-0 bottom-0 bg-danger/70 rounded-r-full" style={{ left: pos(danger), right: 0 }} />
        {/* Handles */}
        {([
          { v: target, color: "var(--ledger-safe)", which: "target" as const },
          { v: warning, color: "var(--ledger-warning)", which: "warning" as const },
          { v: danger, color: "var(--ledger-danger)", which: "danger" as const },
        ]).map(h => (
          <div key={h.which} onPointerDown={startDrag(h.which)} className="absolute rounded-full border-2 border-white shadow cursor-grab active:cursor-grabbing"
            style={{ width: handleSize, height: handleSize, top: "50%", left: pos(h.v), transform: "translate(-50%, -50%)", backgroundColor: h.color }} />
        ))}
      </div>
      {/* Scale */}
      <div className="flex justify-between mt-1.5">
        <span className="text-[9px] text-muted tabular">0%</span>
        <span className="text-[9px] text-muted tabular">39%</span>
        <span className="text-[9px] text-danger tabular">Liq 78%</span>
      </div>
    </div>
  );
}

function ThresholdLabel({ name, value, color }: { name: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-[#0F0F11] border border-subtle p-2.5">
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] uppercase tracking-widest text-muted">{name}</span>
      </div>
      <div className="tabular text-[16px] font-semibold mt-0.5" style={{ color }}>{value}%</div>
    </div>
  );
}

function Section({ title, children, trailing }: { title: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-[10px] uppercase tracking-widest text-muted">{title}</div>
        {trailing}
      </div>
      <div className="rounded-2xl bg-surface border border-subtle overflow-hidden">{children}</div>
    </div>
  );
}

function Row({ label, value, last, valueClass = "text-muted" }: { label: string; value: string; last?: boolean; valueClass?: string }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3.5 ${last ? "" : "border-b border-subtle"}`}>
      <span className="text-[13px] text-primary">{label}</span>
      <span className={`tabular text-[13px] ${valueClass}`}>{value}</span>
    </div>
  );
}

function Toggle({ label, sub, on, last }: { label: string; sub?: string; on?: boolean; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3.5 ${last ? "" : "border-b border-subtle"}`}>
      <div className="min-w-0 pr-4">
        <div className="text-[13px] text-primary">{label}</div>
        {sub && <div className="text-[11px] text-muted leading-tight">{sub}</div>}
      </div>
      <div className="w-[44px] h-[26px] rounded-full p-[2px] transition-colors" style={{ backgroundColor: on ? "var(--ledger-safe)" : "#1F1F22" }}>
        <div className="w-[22px] h-[22px] rounded-full bg-white transition-transform" style={{ transform: on ? "translateX(18px)" : "translateX(0)" }} />
      </div>
    </div>
  );
}
