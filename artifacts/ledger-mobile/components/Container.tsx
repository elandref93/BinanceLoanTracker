import { useWindowDimensions, View, type ViewStyle } from "react-native";

const MAX_CONTENT_WIDTH = 720;
const TABLET_BREAKPOINT = 600;

export function isWideScreen(width: number): boolean {
  return width >= TABLET_BREAKPOINT;
}

export function useWideScreen(): boolean {
  const { width } = useWindowDimensions();
  return isWideScreen(width);
}

export function Container({
  children,
  style,
  maxWidth = MAX_CONTENT_WIDTH,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  maxWidth?: number;
}) {
  const { width } = useWindowDimensions();
  const wide = isWideScreen(width);
  return (
    <View style={{ width: "100%", alignItems: "center" }}>
      <View
        style={[
          { width: "100%", maxWidth: wide ? maxWidth : undefined },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}
