import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { openUrl } from "@/components/Banners";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Screen } from "@/components/Screen";
import { Button, Card, IconButton, IconTile, SectionTitle, type IconName } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { useI18n, type LanguagePref } from "@/lib/i18n";
import { goHome } from "@/lib/nav";
import { renameConnection, type SavedConnection } from "@/lib/storage";
import { appVersion, GITHUB_URL, KOFI_URL, RELEASES_URL } from "@/lib/updates";
import { nativeTabBarAvailable, usePrefs, type TabBarStyle } from "@/state/prefs";
import { useRemote } from "@/state/remote";
import { useToast } from "@/state/toasts";
import { useUpdates } from "@/state/updates";
import { colors, radius } from "@/theme";

export default function Settings() {
  const { t, pref, setPref } = useI18n();
  const { session, saved, connectSaved, disconnect, forget, logout, refreshSaved, phase } = useRemote();
  const prefs = usePrefs();
  const toast = useToast();
  const updates = useUpdates();
  const [toForget, setToForget] = useState<SavedConnection | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);

  const langs: { id: LanguagePref; label: string }[] = [
    { id: "system", label: t("settings.langSystem") },
    { id: "es", label: "Español" },
    { id: "en", label: "English" },
  ];

  async function saveName(id: string) {
    await renameConnection(id, name);
    setRenaming(null);
    await refreshSaved();
  }

  return (
    <Screen>
      {/* Current connection */}
      <SectionTitle>{t("settings.connection")}</SectionTitle>
      {session ? (
        <Card>
          <View style={styles.row}>
            <IconTile icon="desktop-outline" size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.label}>{t("settings.connectedTo")}</Text>
              <Text style={styles.title} numberOfLines={1}>
                {session.conn.name}
              </Text>
              <View style={styles.metaRow}>
                <View style={[styles.dot, { backgroundColor: phase === "connected" ? colors.success : colors.warning }]} />
                <Text style={styles.meta} numberOfLines={1}>
                  {session.host}:{session.conn.port} · Vexcast {session.coreVersion || "?"}
                </Text>
              </View>
            </View>
          </View>
          <View style={[styles.row, { marginTop: 14, gap: 10 }]}>
            <Button label={t("settings.addPc")} icon="add" variant="outline" size="sm" onPress={() => router.push("/connect")} style={{ flex: 1 }} />
            <Button
              label={t("settings.disconnect")}
              icon="power"
              variant="outline"
              size="sm"
              onPress={() => {
                haptic.warning();
                disconnect();
                router.replace("/connect");
              }}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}

      {/* Saved PCs */}
      {saved.length > 0 ? (
        <>
          <SectionTitle>{t("settings.saved")}</SectionTitle>
          <Card padded={false}>
            {saved.map((c, i) => {
              const current = session?.conn.id === c.id;
              return (
                <View key={c.id} style={[styles.savedRow, i > 0 && styles.divider]}>
                  <Ionicons name="desktop-outline" size={18} color={current ? colors.text : colors.muted} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {renaming === c.id ? (
                      <TextInput
                        value={name}
                        onChangeText={setName}
                        autoFocus
                        onSubmitEditing={() => saveName(c.id)}
                        onBlur={() => saveName(c.id)}
                        style={styles.renameInput}
                        selectionColor={colors.primary}
                        cursorColor={colors.text}
                      />
                    ) : (
                      <Text style={styles.savedName} numberOfLines={1}>
                        {c.name}
                      </Text>
                    )}
                    <Text style={styles.meta} numberOfLines={1}>
                      {(c.lastHost ?? c.hosts[0]) + ":" + c.port}
                      {c.coreVersion ? ` · v${c.coreVersion}` : ""}
                    </Text>
                  </View>
                  {current ? (
                    <View style={styles.currentTag}>
                      <Text style={styles.currentText}>{t("settings.current")}</Text>
                    </View>
                  ) : switching === c.id ? (
                    <ActivityIndicator color={colors.muted} />
                  ) : (
                    <Pressable
                      style={({ pressed }) => [styles.switchBtn, pressed && { opacity: 0.85 }]}
                      onPress={async () => {
                        haptic.light();
                        setSwitching(c.id);
                        const ok = await connectSaved(c);
                        setSwitching(null);
                        if (ok) {
                          haptic.success();
                          goHome();
                        } else {
                          haptic.error();
                          toast.show(t("settings.switchFailed", { name: c.name }), "error");
                        }
                      }}
                    >
                      <Text style={styles.switchText}>{t("settings.switch")}</Text>
                    </Pressable>
                  )}
                  <IconButton
                    icon="pencil-outline"
                    label={t("settings.rename")}
                    size={17}
                    color={colors.muted}
                    onPress={() => {
                      setName(c.name);
                      setRenaming(c.id);
                    }}
                  />
                  <IconButton icon="trash-outline" label={t("connect.forget")} size={17} color={colors.muted} onPress={() => setToForget(c)} />
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      {/* Appearance */}
      <SectionTitle>{t("settings.appearance")}</SectionTitle>
      <Card style={{ gap: 14 }}>
        <Text style={styles.cardLabel}>{t("settings.tabBar")}</Text>
        <View style={styles.styleRow}>
          {nativeTabBarAvailable ? (
            <TabBarOption
              id="native"
              label={t("settings.tabBarNative")}
              hint={t("settings.tabBarNativeHint")}
              selected={prefs.tabBar === "native"}
              onSelect={(v) => prefs.setPrefs({ tabBar: v })}
            />
          ) : null}
          <TabBarOption
            id="glass"
            label={t("settings.tabBarGlass")}
            hint={t("settings.tabBarGlassHint")}
            selected={prefs.tabBar === "glass"}
            onSelect={(v) => prefs.setPrefs({ tabBar: v })}
          />
          <TabBarOption
            id="classic"
            label={t("settings.tabBarClassic")}
            hint={t("settings.tabBarClassicHint")}
            selected={prefs.tabBar === "classic"}
            onSelect={(v) => prefs.setPrefs({ tabBar: v })}
          />
        </View>
        <View style={[styles.row, styles.switchRow]}>
          <Text style={[styles.cardLabel, { flex: 1 }]}>{t("settings.tabBarLabels")}</Text>
          <Switch
            value={prefs.tabBarLabels}
            onValueChange={(v) => {
              haptic.tap();
              prefs.setPrefs({ tabBarLabels: v });
            }}
            trackColor={{ false: colors.cardStrong, true: colors.primary }}
            thumbColor={prefs.tabBarLabels ? colors.primaryFg : colors.muted}
            ios_backgroundColor={colors.cardStrong}
            // react-native-web colours the "on" thumb with activeThumbColor
            {...({ activeThumbColor: colors.primaryFg } as object)}
            accessibilityLabel={t("settings.tabBarLabels")}
          />
        </View>
      </Card>

      <Card>
        <View style={styles.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardLabel}>{t("settings.miniPlayer")}</Text>
            <Text style={[styles.hint, { marginTop: 2 }]}>{t("settings.miniPlayerHint")}</Text>
          </View>
          <Switch
            value={prefs.miniPlayer}
            onValueChange={(v) => {
              haptic.tap();
              prefs.setPrefs({ miniPlayer: v });
            }}
            trackColor={{ false: colors.cardStrong, true: colors.primary }}
            thumbColor={prefs.miniPlayer ? colors.primaryFg : colors.muted}
            ios_backgroundColor={colors.cardStrong}
            {...({ activeThumbColor: colors.primaryFg } as object)}
            accessibilityLabel={t("settings.miniPlayer")}
            testID="mini-player-toggle"
          />
        </View>
      </Card>

      {/* Language */}
      <SectionTitle>{t("settings.language")}</SectionTitle>
      <View style={styles.segment}>
        {langs.map((l) => {
          const active = pref === l.id;
          return (
            <Pressable
              key={l.id}
              onPress={() => {
                haptic.tap();
                setPref(l.id);
              }}
              style={[styles.segBtn, active && styles.segActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segText, active && { color: colors.text }]}>{l.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* About */}
      <SectionTitle>{t("settings.about")}</SectionTitle>
      <Card padded={false}>
        <InfoRow icon="phone-portrait-outline" label={t("settings.version")} value={`Vexcast Remote ${appVersion()}`} />
        {session ? <InfoRow icon="desktop-outline" label={t("settings.coreVersion")} value={session.coreVersion || "?"} divider /> : null}
        <LinkRow
          icon="refresh"
          label={
            updates.checking
              ? t("settings.checking")
              : updates.status?.updateAvailable
                ? t("settings.updateAvailable", { version: updates.status.latestVersion ?? "" })
                : updates.status?.latestVersion
                  ? t("settings.upToDate")
                  : t("settings.checkUpdates")
          }
          accent={!!updates.status?.updateAvailable}
          onPress={() => {
            if (updates.status?.updateAvailable) openUrl(updates.status.releaseUrl ?? RELEASES_URL);
            else void updates.check(true);
          }}
        />
        <LinkRow icon="logo-github" label={t("settings.github")} onPress={() => openUrl(GITHUB_URL)} />
        <LinkRow
          icon="cafe-outline"
          label={t("settings.kofi")}
          hint={t("settings.kofiHint")}
          onPress={() => {
            haptic.light();
            openUrl(KOFI_URL);
          }}
          testID="kofi-button"
        />
      </Card>

      {/* Session */}
      <SectionTitle>{t("settings.session")}</SectionTitle>
      <Card style={{ gap: 12 }}>
        <Text style={styles.hint}>{t("settings.logoutHint")}</Text>
        <Button
          label={t("settings.logout")}
          icon="log-out-outline"
          variant="destructive"
          onPress={() => {
            haptic.warning();
            setConfirmLogout(true);
          }}
          testID="logout"
        />
      </Card>

      <Text style={styles.license}>{t("settings.license")}</Text>

      <ConfirmSheet
        visible={!!toForget}
        title={t("settings.forgetTitle")}
        body={toForget ? t("settings.forgetBody", { name: toForget.name }) : undefined}
        confirmLabel={t("connect.forget")}
        icon="trash-outline"
        destructive
        onCancel={() => setToForget(null)}
        onConfirm={async () => {
          const c = toForget;
          setToForget(null);
          if (!c) return;
          const wasCurrent = session?.conn.id === c.id;
          await forget(c.id);
          if (wasCurrent) router.replace("/connect");
        }}
      />
      <ConfirmSheet
        visible={confirmLogout}
        title={t("settings.logoutTitle")}
        body={t("settings.logoutBody")}
        confirmLabel={t("settings.logout")}
        icon="log-out-outline"
        destructive
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => {
          setConfirmLogout(false);
          await logout();
          haptic.success();
          toast.show(t("settings.loggedOut"), "success");
          try {
            if (router.canDismiss()) router.dismissAll();
          } catch {
            /* nothing to dismiss */
          }
          router.replace("/connect");
        }}
      />
    </Screen>
  );
}

/** Selectable card with a tiny drawing of each tab-bar style. */
function TabBarOption({
  id,
  label,
  hint,
  selected,
  onSelect,
}: {
  id: TabBarStyle;
  label: string;
  hint: string;
  selected: boolean;
  onSelect: (id: TabBarStyle) => void;
}) {
  const floating = id !== "classic";
  return (
    <Pressable
      onPress={() => {
        if (selected) return;
        haptic.tap();
        onSelect(id);
      }}
      style={({ pressed }) => [styles.option, selected && styles.optionActive, pressed && !selected && { backgroundColor: colors.accent }]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={`tabbar-${id}`}
    >
      <View style={styles.phone}>
        <View style={styles.phoneLine} />
        <View style={[styles.phoneLine, { width: "60%" }]} />
        <View style={[styles.phoneLine, { width: "75%" }]} />
        {floating ? (
          <View style={[styles.miniGlass, id === "native" && styles.miniNative]}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.miniIcon, i === 0 && (id === "native" ? styles.miniIconNative : styles.miniIconActive)]} />
            ))}
          </View>
        ) : (
          <View style={styles.miniClassic}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.miniIcon, i === 0 && { backgroundColor: colors.text }]} />
            ))}
          </View>
        )}
      </View>
      <View style={styles.optionText}>
        <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.optionLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.optionHint} numberOfLines={2}>
            {hint}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function InfoRow({ icon, label, value, divider }: { icon: IconName; label: string; value: string; divider?: boolean }) {
  return (
    <View style={[styles.infoRow, divider && styles.divider]}>
      <Ionicons name={icon} size={18} color={colors.muted} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function LinkRow({
  icon,
  label,
  hint,
  onPress,
  accent,
  testID,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
  accent?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.infoRow, styles.divider, pressed && { backgroundColor: colors.accent }]}
      accessibilityRole="link"
      testID={testID}
    >
      <Ionicons name={icon} size={18} color={accent ? colors.success : colors.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.infoLabel, accent && { color: colors.success }]}>{label}</Text>
        {hint ? <Text style={styles.linkHint}>{hint}</Text> : null}
      </View>
      <Ionicons name="open-outline" size={16} color={colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "500" },
  title: { color: colors.text, fontSize: 17, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  meta: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  cardLabel: { color: colors.text, fontSize: 14, fontWeight: "500" },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  savedRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  savedName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  renameInput: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingVertical: 2,
  },
  currentTag: {
    backgroundColor: colors.cardStrong,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  currentText: { color: colors.text, fontSize: 11, fontWeight: "600" },
  switchBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 6 },
  switchText: { color: colors.primaryFg, fontSize: 12, fontWeight: "600" },
  styleRow: { flexDirection: "row", gap: 8 },
  option: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.input,
    padding: 8,
    gap: 8,
  },
  optionActive: { borderColor: colors.primary, borderWidth: 2, padding: 7 },
  phone: {
    height: 84,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    gap: 5,
    overflow: "hidden",
  },
  phoneLine: { height: 6, width: "90%", borderRadius: 3, backgroundColor: colors.cardStrong },
  miniGlass: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 8,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  miniClassic: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 20,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.bg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  // iOS 26's bar: a wider, brighter glass capsule with a bubble behind the active tab.
  miniNative: { left: 6, right: 6, backgroundColor: "rgba(255,255,255,0.18)", borderColor: "rgba(255,255,255,0.32)" },
  miniIconNative: { width: 16, height: 12, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.85)" },
  miniIcon: { width: 7, height: 7, borderRadius: 2, backgroundColor: colors.faint },
  miniIconActive: { width: 14, borderRadius: 4, backgroundColor: colors.text },
  optionText: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.faint,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  optionLabel: { color: colors.text, fontSize: 13, fontWeight: "600" },
  optionHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 1 },
  switchRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.cardStrong,
    borderRadius: radius.lg,
    padding: 3,
    gap: 3,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: "center" },
  segActive: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderStrong },
  segText: { color: colors.muted, fontWeight: "500", fontSize: 14 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  infoLabel: { color: colors.text, fontSize: 15, fontWeight: "500" },
  infoValue: { color: colors.muted, fontSize: 14, marginLeft: "auto", flexShrink: 1 },
  linkHint: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  license: { color: colors.faint, fontSize: 12, textAlign: "center", marginTop: 8 },
});
