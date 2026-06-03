import { Feather } from "@expo/vector-icons";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container } from "@/components/Container";
import { Divider, Row, Section, TypeBadge } from "@/components/SettingsList";
import { useColors } from "@/hooks/useColors";
import { useSession } from "@/context/SessionContext";
import { listContainers, type StoredContainer } from "@/lib/accountStore";
import { listAccountsWithSecrets } from "@/lib/binanceKeys";
import { probeAccount, type ProbeResult } from "@/lib/keyHealth";
import { fmtAge } from "@/utils/format";

const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

type LinkHealth = ProbeResult | { status: "checking" };

function exchangeName(exchange: "binance" | "luno"): string {
  return exchange === "binance" ? "Binance" : "Luno";
}

export default function AccountsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getToken } = useSession();
  const [containers, setContainers] = useState<StoredContainer[]>([]);
  // Per-Binance-link health. A revoked/expired key is swallowed by the
  // multiplexed dashboard call (it returns an empty list, so the asset just
  // vanishes from the combined Binance + Luno view). Probing each key on its
  // own surfaces the real failure here, where the user can replace it.
  const [health, setHealth] = useState<Record<string, LinkHealth>>({});

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listContainers().then((c) => {
        if (active) setContainers(c);
      });
      if (baseUrl) {
        void (async () => {
          try {
            const accts = await listAccountsWithSecrets();
            if (!active || accts.length === 0) return;
            setHealth((h) => {
              const next = { ...h };
              for (const a of accts) next[a.id] = { status: "checking" };
              return next;
            });
            const token = await getToken();
            await Promise.all(
              accts.map(async (a) => {
                const r = await probeAccount(a, baseUrl, token);
                if (active) setHealth((h) => ({ ...h, [a.id]: r }));
              }),
            );
          } catch {
            // Probing is best-effort diagnostics; never let it crash the
            // accounts screen. A failed probe simply shows no health badge.
          }
        })();
      }
      return () => {
        active = false;
      };
    }, [getToken]),
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
                  c.links.map((link, i) => {
                    const hl =
                      link.exchange === "binance" ? health[link.id] : undefined;
                    return (
                      <View key={link.id}>
                        {i > 0 ? <Divider /> : null}
                        <Row
                          label={exchangeName(link.exchange)}
                          value={`${link.apiKeyMasked} · ${fmtAge(link.createdAt)}`}
                          right={
                            hl?.status === "checking" ? (
                              <Text
                                style={[
                                  styles.statusText,
                                  { color: colors.mutedForeground },
                                ]}
                              >
                                Checking…
                              </Text>
                            ) : undefined
                          }
                        />
                        {hl?.status === "fail" ? (
                          <Row
                            label="Key not working — tap to replace"
                            value={hl.reason}
                            destructive
                            onPress={() =>
                              router.push({
                                pathname: "/account/[id]",
                                params: { id: c.id },
                              })
                            }
                          />
                        ) : null}
                      </View>
                    );
                  })
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
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
