import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

import { Container } from "./Container";

/**
 * Pulsing placeholder block. Use to outline the shape of incoming content so
 * the screen doesn't flash blank → spinner → content.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  radius = 6,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.card,
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * Per-screen skeleton layouts. Mirrors the rough geometry of the loaded
 * screen so the visual jump on hydration is minimal.
 */
export function ScreenSkeleton({
  kind,
}: {
  kind: "dashboard" | "history" | "loanDetail";
}) {
  const colors = useColors();
  return (
    <View style={[skelStyles.wrap, { backgroundColor: colors.background }]}>
      <Container style={{ gap: 16, paddingTop: 8 }}>
        {kind === "dashboard" ? (
          <>
            <Skeleton width="40%" height={11} />
            <Skeleton height={56} radius={10} />
            <Skeleton height={140} radius={12} />
            <Skeleton width="30%" height={11} style={{ marginTop: 8 }} />
            <Skeleton height={92} radius={10} />
            <Skeleton height={92} radius={10} />
          </>
        ) : null}
        {kind === "history" ? (
          <>
            <Skeleton width="35%" height={11} />
            <Skeleton height={180} radius={12} />
            <Skeleton width="25%" height={11} style={{ marginTop: 8 }} />
            <Skeleton height={56} radius={10} />
            <Skeleton height={56} radius={10} />
            <Skeleton height={56} radius={10} />
          </>
        ) : null}
        {kind === "loanDetail" ? (
          <>
            <Skeleton width="50%" height={20} />
            <Skeleton width="30%" height={11} />
            <Skeleton height={120} radius={12} style={{ marginTop: 8 }} />
            <Skeleton height={64} radius={10} />
            <Skeleton height={64} radius={10} />
          </>
        ) : null}
      </Container>
    </View>
  );
}

const skelStyles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
});
