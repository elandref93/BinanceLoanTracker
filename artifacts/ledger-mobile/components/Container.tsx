import { Children, isValidElement, useState } from "react";
import {
  type LayoutChangeEvent,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";

const MAX_CONTENT_WIDTH = 720;
/**
 * Wider cap used by data-dense screens (dashboard, interest, portfolio) so an
 * iPad / large window gets a roomier canvas with multi-column content instead
 * of a narrow phone-width column floating in the middle of the screen.
 */
export const WIDE_CONTENT_WIDTH = 900;
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

/**
 * Responsive grid that flows its children into as many columns as fit, given a
 * minimum column width. It measures its own rendered width, so the column count
 * always reflects the real available space (Container cap, split-view size,
 * orientation, …) rather than the raw window width.
 *
 * On a phone the measured width can only ever fit a single column, so children
 * stack exactly as they would in a plain `View` with `gap` — the existing
 * layout is preserved untouched. Extra columns only appear on wider screens.
 */
export function Grid({
  children,
  minColumnWidth = 340,
  gap = 12,
  style,
}: {
  children: React.ReactNode;
  /** Smallest acceptable column width before dropping to fewer columns. */
  minColumnWidth?: number;
  gap?: number;
  style?: ViewStyle;
}) {
  const items = Children.toArray(children);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - measuredWidth) > 0.5) {
      setMeasuredWidth(next);
    }
  };

  // How many columns of at least `minColumnWidth` fit the measured width.
  // Until the first layout pass we use a single column, matching the
  // pre-existing stacked layout so there's never a wrong-width flash.
  const fit =
    measuredWidth > 0
      ? Math.max(
          1,
          Math.floor((measuredWidth + gap) / (minColumnWidth + gap)),
        )
      : 1;
  // Never use more columns than there are items, so a lone card still fills the
  // row instead of sitting at a fraction of the width with empty space beside.
  const columns = Math.max(1, Math.min(fit, items.length || 1));
  // Floor the width so the per-row total (columns * width + gaps) can never
  // exceed the measured width by a sub-pixel and wrap to one item per line.
  const itemWidth =
    columns > 1
      ? Math.floor((measuredWidth - gap * (columns - 1)) / columns)
      : undefined;

  return (
    <View
      onLayout={onLayout}
      style={[
        { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap },
        style,
      ]}
    >
      {items.map((child, i) => {
        const key =
          isValidElement(child) && child.key != null ? child.key : i;
        return (
          <View key={key} style={{ width: itemWidth ?? "100%" }}>
            {child}
          </View>
        );
      })}
    </View>
  );
}
