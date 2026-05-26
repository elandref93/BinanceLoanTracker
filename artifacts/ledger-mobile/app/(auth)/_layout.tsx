import { Redirect, Stack } from "expo-router";

import { useSession } from "@/context/SessionContext";

export default function AuthLayout() {
  const { isLoaded, isSignedIn } = useSession();
  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
