import { useState } from "react";

import ada from "cryptocurrency-icons/svg/color/ada.svg";
import atom from "cryptocurrency-icons/svg/color/atom.svg";
import avax from "cryptocurrency-icons/svg/color/avax.svg";
import bch from "cryptocurrency-icons/svg/color/bch.svg";
import bnb from "cryptocurrency-icons/svg/color/bnb.svg";
import btc from "cryptocurrency-icons/svg/color/btc.svg";
import dai from "cryptocurrency-icons/svg/color/dai.svg";
import doge from "cryptocurrency-icons/svg/color/doge.svg";
import dot from "cryptocurrency-icons/svg/color/dot.svg";
import etc from "cryptocurrency-icons/svg/color/etc.svg";
import eth from "cryptocurrency-icons/svg/color/eth.svg";
import fil from "cryptocurrency-icons/svg/color/fil.svg";
import link from "cryptocurrency-icons/svg/color/link.svg";
import ltc from "cryptocurrency-icons/svg/color/ltc.svg";
import matic from "cryptocurrency-icons/svg/color/matic.svg";
import sol from "cryptocurrency-icons/svg/color/sol.svg";
import trx from "cryptocurrency-icons/svg/color/trx.svg";
import tusd from "cryptocurrency-icons/svg/color/tusd.svg";
import uni from "cryptocurrency-icons/svg/color/uni.svg";
import usdc from "cryptocurrency-icons/svg/color/usdc.svg";
import usdt from "cryptocurrency-icons/svg/color/usdt.svg";
import xlm from "cryptocurrency-icons/svg/color/xlm.svg";
import xrp from "cryptocurrency-icons/svg/color/xrp.svg";

import binanceMark from "@/assets/binance.png";
import interactiveBrokersMark from "@/assets/interactive-brokers.png";
import lunoMark from "@/assets/luno.png";
import ninetyOneMark from "@/assets/ninety-one.svg";
import peresecMark from "@/assets/peresec.jpg";

import { assetColor } from "@/theme/ledgerColors";

/**
 * Bundled CC0 icons from `cryptocurrency-icons`. They ship with the app, so
 * rendering an asset never calls a third-party CDN. Small SVGs are inlined by
 * Vite as data URIs. Add an import here to support a new symbol.
 */
const ICONS: Record<string, string> = {
  ADA: ada,
  ATOM: atom,
  AVAX: avax,
  BCH: bch,
  BNB: bnb,
  BTC: btc,
  DAI: dai,
  DOGE: doge,
  DOT: dot,
  ETC: etc,
  ETH: eth,
  FIL: fil,
  LINK: link,
  LTC: ltc,
  MATIC: matic,
  POL: matic,
  SOL: sol,
  TRX: trx,
  TUSD: tusd,
  UNI: uni,
  USDC: usdc,
  USDT: usdt,
  XLM: xlm,
  XRP: xrp,
};

const FIAT_BADGES: Record<string, { bg: string; fg: string; label: string }> = {
  ZAR: { bg: "#007749", fg: "#FFB81C", label: "R" },
  USD: { bg: "#1E5631", fg: "#FFFFFF", label: "$" },
  EUR: { bg: "#003399", fg: "#FFCC00", label: "€" },
  GBP: { bg: "#012169", fg: "#FFFFFF", label: "£" },
};

const PERESEC = /peresec/i;
const INTERACTIVE_BROKERS = /interactive brokers|ibkr/i;
const NINETY_ONE = /ninety\s*one/i;

type IconPlace = { exchange: string; wallet: string };

/** Pickle Rick only. Institution lives on `wallet`; the holding name is `asset`. */
function usesPickleMark(asset: string, places: readonly IconPlace[] | undefined, pattern: RegExp): boolean {
  if (places && places.length > 0) {
    if (places.some((place) => place.exchange === "binance" || place.exchange === "luno")) return false;
    const pickle = places.filter((place) => place.exchange === "pickle_rick");
    if (pickle.length === 0) return false;
    return [asset, ...pickle.map((place) => place.wallet)].some((part) => pattern.test(part));
  }
  return pattern.test(asset);
}

/**
 * Pickle Rick rows held at Peresec use the bundled mark. The institution is
 * stored on the wallet. Personal and WLDD trust rows both match. Binance,
 * Luno, Ninety One, and Interactive Brokers do not.
 */
export function usesPeresecIcon(asset: string, places?: readonly { exchange: string; wallet: string }[]): boolean {
  if (places && places.length > 0) {
    if (places.some((place) => place.exchange === "binance" || place.exchange === "luno")) return false;
    const pickle = places.filter((place) => place.exchange === "pickle_rick");
    if (pickle.length === 0) return false;
    return [asset, ...pickle.map((place) => place.wallet)].some((part) => PERESEC.test(part));
  }
  return PERESEC.test(asset);
}

/**
 * Pickle Rick rows at Interactive Brokers. Matches the holding name or the
 * institution when either contains "Interactive Brokers" or "IBKR".
 */
export function usesInteractiveBrokersIcon(asset: string, places?: readonly IconPlace[]): boolean {
  return usesPickleMark(asset, places, INTERACTIVE_BROKERS);
}

/**
 * Pickle Rick rows at Ninety One, including TFSA, retirement annuity, and
 * Ivelle when the name or institution contains "Ninety One" or "NinetyOne".
 */
export function usesNinetyOneIcon(asset: string, places?: readonly IconPlace[]): boolean {
  return usesPickleMark(asset, places, NINETY_ONE);
}

/** Small Binance or Luno mark for a wallet line. Other exchanges get no mark. */
export function ExchangeMark(props: { exchange: string; size?: number }) {
  const size = props.size ?? 14;
  const src = props.exchange === "binance" ? binanceMark : props.exchange === "luno" ? lunoMark : null;
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      decoding="async"
      className="inline-block shrink-0 rounded-[3px] object-contain"
    />
  );
}

/** Luno reports Bitcoin as XBT; statement names stay as written. */
export function displaySymbol(asset: string): string {
  const trimmed = asset.trim();
  if (/[^\w]/.test(trimmed) || trimmed.length > 12) return trimmed;
  const upper = trimmed.toUpperCase();
  return upper === "XBT" ? "BTC" : upper;
}

export function hasAssetIcon(asset: string): boolean {
  const symbol = displaySymbol(asset);
  return symbol in ICONS || symbol in FIAT_BADGES;
}

export function AssetIcon(props: {
  asset: string;
  size?: number;
  className?: string;
  places?: readonly { exchange: string; wallet: string }[];
}) {
  const size = props.size ?? 32;
  const symbol = displaySymbol(props.asset);
  const [failed, setFailed] = useState(false);
  const fiat = FIAT_BADGES[symbol];
  const src = ICONS[symbol];
  const common = {
    width: size,
    height: size,
    className: `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${props.className ?? ""}`,
  };

  if (usesPeresecIcon(props.asset, props.places)) {
    return (
      <span className={common.className} style={{ width: size, height: size }}>
        <img
          src={peresecMark}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          className="h-full w-full max-w-none object-cover"
          style={{ transform: "scale(1.25)" }}
        />
      </span>
    );
  }

  if (usesInteractiveBrokersIcon(props.asset, props.places)) {
    return (
      <span className={common.className} style={{ width: size, height: size }}>
        <img
          src={interactiveBrokersMark}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          className="h-full w-full max-w-none object-cover"
        />
      </span>
    );
  }

  if (usesNinetyOneIcon(props.asset, props.places)) {
    return (
      <span className={common.className} style={{ width: size, height: size, background: "#221B3B" }}>
        <img
          src={ninetyOneMark}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          className="box-border h-full w-full max-w-none object-contain"
          style={{ padding: Math.max(2, Math.round(size * 0.12)) }}
        />
      </span>
    );
  }

  if (fiat) {
    return (
      <span
        aria-hidden="true"
        className={common.className}
        style={{ width: size, height: size, background: fiat.bg, color: fiat.fg, fontSize: size * 0.48, fontWeight: 700 }}
      >
        {fiat.label}
      </span>
    );
  }
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={common.className}
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }
  const color = assetColor(symbol);
  return (
    <span
      aria-hidden="true"
      className={common.className}
      style={{
        width: size,
        height: size,
        background: `${color}26`,
        color,
        boxShadow: `inset 0 0 0 1px ${color}55`,
        fontSize: symbol.length > 3 ? size * 0.28 : size * 0.34,
        fontWeight: 700,
        letterSpacing: "-0.02em",
      }}
    >
      {symbol.slice(0, 4)}
    </span>
  );
}
