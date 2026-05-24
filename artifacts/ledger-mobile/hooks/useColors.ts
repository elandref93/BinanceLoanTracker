import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

type Palette = typeof colors.light;
type ColorsModule = typeof colors & { dark?: Palette };

export function useColors() {
  const scheme = useColorScheme();
  const mod = colors as ColorsModule;
  const palette: Palette = scheme === "dark" && mod.dark ? mod.dark : mod.light;
  return { ...palette, radius: colors.radius };
}
