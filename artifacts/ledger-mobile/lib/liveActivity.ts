// JS bridge stub for the LedgerLiveActivity (see
// targets/widget/LedgerLiveActivity.swift).
//
// A future native module — `LedgerLiveActivityModule` — will expose
// start/update/end functions backed by ActivityKit. Until that module
// ships, every call here is a no-op so app code can be written against the
// final API today without crashes on devices missing the module.

import { NativeModules, Platform } from "react-native";

type LiveActivityContent = {
  ltv: number;
  closestAsset: string;
  targetLtv: number;
};

type Bridge = {
  start: (sessionName: string, content: LiveActivityContent) => Promise<void>;
  update: (content: LiveActivityContent) => Promise<void>;
  end: () => Promise<void>;
  isSupported: () => Promise<boolean>;
};

function getBridge(): Bridge | null {
  if (Platform.OS !== "ios") return null;
  const mod = (NativeModules as Record<string, unknown>)
    .LedgerLiveActivityModule as Bridge | undefined;
  return mod ?? null;
}

export async function isLiveActivitySupported(): Promise<boolean> {
  const b = getBridge();
  if (!b) return false;
  try {
    return await b.isSupported();
  } catch {
    return false;
  }
}

export async function startRiskActivity(
  content: LiveActivityContent,
): Promise<void> {
  const b = getBridge();
  if (!b) return;
  try {
    await b.start("Loan risk", content);
  } catch {
    // ignore — caller should not depend on the activity being present.
  }
}

export async function updateRiskActivity(
  content: LiveActivityContent,
): Promise<void> {
  const b = getBridge();
  if (!b) return;
  try {
    await b.update(content);
  } catch {
    // ignore
  }
}

export async function endRiskActivity(): Promise<void> {
  const b = getBridge();
  if (!b) return;
  try {
    await b.end();
  } catch {
    // ignore
  }
}
