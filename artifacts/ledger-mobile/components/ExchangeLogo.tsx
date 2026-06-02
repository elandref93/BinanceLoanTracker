import { useState } from "react";
import { Image, View } from "react-native";

import { useColors } from "@/hooks/useColors";

const LOGOS: Record<string, ReturnType<typeof require>> = {
  Binance: require("../assets/images/binance.png"),
  Luno: require("../assets/images/luno.png"),
};

/**
 * Small square brand badge for an exchange (Binance / Luno). Renders the
 * bundled logo, falling back to a brand-coloured dot if the asset is
 * missing or fails to load so a row never shows a broken-image glyph.
 */
export function ExchangeLogo({
  exchange,
  size = 20,
}: {
  exchange: string;
  size?: number;
}) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const src = LOGOS[exchange];

  if (src && !failed) {
    return (
      <Image
        source={src}
        style={{ width: size, height: size, borderRadius: size / 4 }}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    );
  }

  const dot = exchange === "Binance" ? "#F0B90B" : colors.primary;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: dot,
      }}
    />
  );
}
