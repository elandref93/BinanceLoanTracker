import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { displayAsset } from "@/lib/lunoPricing";

/**
 * Known crypto symbols available in the atomiclabs/cryptocurrency-icons
 * set on jsDelivr. Pinned to a commit so an upstream rename or removal
 * doesn't silently break our icons in production.
 *
 * Symbols are the post-`displayAsset()` form (BTC, not XBT). Add an
 * entry here when supporting a new Luno/Binance asset. Anything not
 * listed falls back to the text badge — safe default for fiat (ZAR)
 * and exotic tokens with no upstream icon.
 */
const KNOWN_CRYPTO_ICONS = new Set([
  "BTC",
  "ETH",
  "LTC",
  "XRP",
  "BCH",
  "BNB",
  "SOL",
  "USDC",
  "USDT",
  "DAI",
  "ADA",
  "DOT",
  "AVAX",
  "MATIC",
  "LINK",
  "TRX",
  "DOGE",
  "UNI",
  "ATOM",
  "XLM",
]);

/**
 * Fiat-style assets we want to render as a flag-coloured badge rather
 * than reach for crypto-icons (which doesn't ship fiat). Keyed by the
 * symbol → background hex.
 */
const FIAT_BADGES: Record<string, { bg: string; fg: string; label: string }> = {
  ZAR: { bg: "#007749", fg: "#FFFFFF", label: "R" },
  USD: { bg: "#1E5631", fg: "#FFFFFF", label: "$" },
  EUR: { bg: "#003399", fg: "#FFC400", label: "€" },
  GBP: { bg: "#012169", fg: "#FFFFFF", label: "£" },
};

const ICON_CDN =
  "https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/128/color";

type Props = {
  /** Raw asset symbol (XBT/BTC/ETH/ZAR/etc). Case-insensitive. */
  asset: string;
  /** Pixel size of the badge (square). Default 32. */
  size?: number;
};

/**
 * Square asset badge. Renders the official crypto logo for known
 * tokens, a fiat colour-coded letter badge for ZAR/USD/EUR/GBP, or
 * the symbol text on a neutral chip for anything else. The Image
 * loader falls back to the text badge if the CDN fetch fails so a
 * network-flaky launch never shows a broken-image glyph.
 */
export function AssetIcon({ asset, size = 32 }: Props) {
  const colors = useColors();
  const symbol = displayAsset(asset);
  const [failed, setFailed] = useState(false);

  const fiat = FIAT_BADGES[symbol];
  if (fiat) {
    return (
      <View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: fiat.bg,
            borderColor: colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.badgeText,
            { color: fiat.fg, fontSize: size * 0.42 },
          ]}
        >
          {fiat.label}
        </Text>
      </View>
    );
  }

  if (KNOWN_CRYPTO_ICONS.has(symbol) && !failed) {
    return (
      <Image
        source={{ uri: `${ICON_CDN}/${symbol.toLowerCase()}.png` }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.background,
        }}
        onError={() => setFailed(true)}
      />
    );
  }

  // Unknown / failed-load → neutral text chip.
  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.background,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          { color: colors.foreground, fontSize: size * 0.32 },
        ]}
        numberOfLines={1}
      >
        {symbol.slice(0, 4)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  badgeText: {
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.2,
  },
});
