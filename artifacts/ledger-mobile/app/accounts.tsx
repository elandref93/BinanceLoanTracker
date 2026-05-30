import { Feather } from "@expo/vector-icons";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container } from "@/components/Container";
import { Divider, Row, Section, TypeBadge } from "@/components/SettingsList";
import { useColors } from "@/hooks/useColors";
import { listContainers, type StoredContainer } from "@/lib/accountStore";
import { fmtAge } from "@/utils/format";

function exchangeName(exchange: "binance" | "luno"): string {
  return exchange === "binance" ? "Binance" : "Luno";
}

export default function AccountsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [containers, setContainers] = useState<StoredContainer[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listContainers().then((c) => {
        if (active) setContainers(c);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <>
      <Stack.Screen options={{ title: "Accounts" }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 16,
          gap: 20,
        }}
      >
        <Container style={{ gap: 20 }}>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            Group your Binance and Luno links under Personal or Trust accounts.
            Tap an account to view its keys, targets and alerts.
          </Text>

          {containers.length === 0 ? (
            <Section title="No accounts yet">
              <Row label="No accounts connected" value="Tap below to add" />
              <Divider />
              <Row
                label="Add account"
                right={<Feather name="plus" size={18} color={colors.primary} />}
                onPress={() => router.push("/add-account")}
              />
            </Section>
          ) : (
            containers.map((c) => (
              <Section key={c.id} title={c.name} right={<TypeBadge type={c.type} />}>
                {c.links.length === 0 ? (
                  <Row label="No exchanges linked yet" />
                ) : (
                  c.links.map((link, i) => (
                    <View key={link.id}>
                      {i > 0 ? <Divider /> : null}
                      <Row
                        label={exchangeName(link.exchange)}
                        value={`${link.apiKeyMasked} · ${fmtAge(link.createdAt)}`}
                      />
                    </View>
                  ))
                )}
                <Divider />
                <Row
                  label="Account settings"
                  onPress={() =>
                    router.push({
                      pathname: "/account/[id]",
                      params: { id: c.id },
                    })
                  }
                />
              </Section>
            ))
          )}

          {containers.length > 0 ? (
            <Section title="Add account">
              <Row
                label="Add another account (e.g. a Trust)"
                right={<Feather name="plus" size={18} color={colors.primary} />}
                onPress={() => router.push("/add-account")}
              />
            </Section>
          ) : null}
        </Container>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
});
