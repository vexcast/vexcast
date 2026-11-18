/**
 * Title and category of the connected Twitch/Kick channels — the phone's take on
 * the desktop's stream info dialog (synced titles, per-platform categories,
 * recent titles and categories remembered on the phone).
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AccountPlatform, StreamCategory, StreamInfo } from "@vexcast/protocol";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlatformIcon } from "@/components/PlatformIcon";
import { Screen } from "@/components/Screen";
import { INFO_PLATFORMS } from "@/components/StreamInfoCard";
import { Button, Card, Field, IconButton, SectionTitle } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { getJSON, setJSON } from "@/lib/storage";
import { useRemote } from "@/state/remote";
import { useToast } from "@/state/toasts";
import { colors, radius } from "@/theme";

const MAX_TITLE = 140;
const MAX_RECENT = 8;
const SYNC_KEY = "vexcast.info.sync";
const RECENT_TITLES_KEY = "vexcast.info.recentTitles";
const RECENT_CATS_KEY = "vexcast.info.recentCategories";
const NAMES: Record<AccountPlatform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

interface Row {
  platform: AccountPlatform;
  current: StreamInfo | null;
  loading: boolean;
  error: string | null;
  include: boolean;
  title: string;
  /** New category; null = keep the current one. */
  category: StreamCategory | null;
}

const pushRecent = <T,>(list: T[], item: T, key: (x: T) => string) => [item, ...list.filter((x) => key(x) !== key(item))].slice(0, MAX_RECENT);

export default function StreamInfoScreen() {
  const t = useT();
  const toast = useToast();
  const { session, state } = useRemote();
  const platforms = (state?.accounts ?? []).filter((a) => a.connected && INFO_PLATFORMS.includes(a.platform)).map((a) => a.platform);
  const key = platforms.join(",");
  const [rows, setRows] = useState<Row[]>([]);
  const [sync, setSyncState] = useState(true);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [recentTitles, setRecentTitles] = useState<string[]>([]);
  const [recentCats, setRecentCats] = useState<Partial<Record<AccountPlatform, StreamCategory[]>>>({});
  const [picker, setPicker] = useState<AccountPlatform | null>(null);

  useEffect(() => {
    getJSON<boolean>(SYNC_KEY, true).then(setSyncState);
    getJSON<string[]>(RECENT_TITLES_KEY, []).then(setRecentTitles);
    getJSON<Partial<Record<AccountPlatform, StreamCategory[]>>>(RECENT_CATS_KEY, {}).then(setRecentCats);
  }, []);

  const setSync = (v: boolean) => {
    setSyncState(v);
    void setJSON(SYNC_KEY, v);
  };
  const patch = (p: AccountPlatform, v: Partial<Row>) => setRows((rs) => rs.map((r) => (r.platform === p ? { ...r, ...v } : r)));

  useEffect(() => {
    if (!session) return;
    const list = key ? (key.split(",") as AccountPlatform[]) : [];
    setRows(list.map((p) => ({ platform: p, current: null, loading: true, error: null, include: true, title: "", category: null })));
    setTitle("");
    let first = true;
    for (const p of list) {
      session.client
        .getStreamInfo(p)
        .then((info) => {
          setRows((rs) => rs.map((r) => (r.platform === p ? { ...r, current: info, loading: false, title: info.title } : r)));
          if (first) {
            first = false;
            setTitle((cur) => cur || info.title);
          }
        })
        .catch((e: unknown) => setRows((rs) => rs.map((r) => (r.platform === p ? { ...r, loading: false, error: e instanceof Error ? e.message : String(e) } : r))));
    }
  }, [session, key]);

  const included = rows.filter((r) => r.include && !r.error);
  const titles = new Set(rows.filter((r) => r.current).map((r) => r.current!.title.trim()));
  const canSave = included.length > 0 && !saving && included.every((r) => !r.loading) && (sync ? !!title.trim() : included.every((r) => r.title.trim()));

  async function save() {
    if (!session) return;
    haptic.medium();
    setSaving(true);
    const ok: string[] = [];
    await Promise.all(
      included.map(async (r) => {
        const newTitle = (sync ? title : r.title).trim();
        try {
          await session.client.setStreamInfo(r.platform, { title: newTitle || undefined, categoryId: r.category?.id });
          ok.push(NAMES[r.platform]);
          patch(r.platform, { current: { title: newTitle || r.current?.title || "", category: r.category ?? r.current?.category ?? null }, category: null });
        } catch (e) {
          toast.show(t("info.failed", { name: NAMES[r.platform], error: e instanceof Error ? e.message : String(e) }), "error");
        }
      }),
    );
    setSaving(false);
    let rt = recentTitles;
    for (const tt of sync ? [title] : included.map((r) => r.title)) if (tt.trim()) rt = pushRecent(rt, tt.trim(), (x) => x);
    setRecentTitles(rt);
    void setJSON(RECENT_TITLES_KEY, rt);
    const rc = { ...recentCats };
    for (const r of included) if (r.category) rc[r.platform] = pushRecent(rc[r.platform] ?? [], r.category, (x) => x.id);
    setRecentCats(rc);
    void setJSON(RECENT_CATS_KEY, rc);
    if (ok.length) {
      haptic.success();
      toast.show(t("info.saved", { names: ok.join(", ") }), "success");
      if (ok.length === included.length) router.back();
    }
  }

  if (platforms.length === 0) {
    return (
      <Screen>
        <Card>
          <Text style={styles.muted}>{t("info.none")}</Text>
        </Card>
      </Screen>
    );
  }

  const pickerRow = rows.find((r) => r.platform === picker);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Screen>
        <Card>
          <View style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.label}>{t("info.sync")}</Text>
              <Text style={[styles.muted, { fontSize: 13, marginTop: 2 }]}>{t("info.syncHint")}</Text>
            </View>
            <Switch
              value={sync}
              onValueChange={(v) => {
                haptic.tap();
                setSync(v);
              }}
              trackColor={{ false: colors.cardStrong, true: colors.primary }}
              thumbColor={sync ? colors.primaryFg : colors.muted}
              ios_backgroundColor={colors.cardStrong}
              {...({ activeThumbColor: colors.primaryFg } as object)}
              accessibilityLabel={t("info.sync")}
              testID="info-sync"
            />
          </View>
        </Card>

        {sync ? (
          <>
            <SectionTitle>{t("info.titleLabel")}</SectionTitle>
            <TitleInput value={title} onChange={setTitle} recent={recentTitles} testID="info-title" />
            {titles.size > 1 ? (
              <View style={styles.warn}>
                <Ionicons name="warning-outline" size={15} color={colors.warning} />
                <Text style={styles.warnText}>{t("info.mismatch")}</Text>
              </View>
            ) : null}
          </>
        ) : null}

        {rows.map((r) => {
          const shown = r.category ?? r.current?.category ?? null;
          return (
            <Card key={r.platform} style={{ gap: 12 }}>
              <View style={styles.row}>
                <PlatformIcon platform={r.platform} size={28} />
                <Text style={[styles.label, { flex: 1 }]}>{NAMES[r.platform]}</Text>
                {r.loading ? <ActivityIndicator color={colors.muted} /> : null}
                <Switch
                  value={r.include && !r.error}
                  disabled={!!r.error}
                  onValueChange={(v) => patch(r.platform, { include: v })}
                  trackColor={{ false: colors.cardStrong, true: colors.primary }}
                  thumbColor={r.include ? colors.primaryFg : colors.muted}
                  ios_backgroundColor={colors.cardStrong}
                  {...({ activeThumbColor: colors.primaryFg } as object)}
                  accessibilityLabel={`${t("info.include")} ${NAMES[r.platform]}`}
                />
              </View>
              {r.error ? (
                <Text style={[styles.muted, { color: colors.danger }]}>{r.error}</Text>
              ) : (
                <>
                  {!sync ? <TitleInput value={r.title} onChange={(v) => patch(r.platform, { title: v })} recent={recentTitles} /> : null}
                  <Pressable
                    onPress={() => {
                      haptic.tap();
                      setPicker(r.platform);
                    }}
                    disabled={r.loading}
                    style={({ pressed }) => [styles.catBtn, pressed && { backgroundColor: colors.accent }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("info.category")}: ${shown?.name ?? t("info.pickCategory")}`}
                    testID={`info-category-${r.platform}`}
                  >
                    <CategoryThumb category={shown} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.catLabel}>{t("info.category")}</Text>
                      <Text style={[styles.catName, !shown && { color: colors.muted }]} numberOfLines={1}>
                        {shown?.name ?? t("info.pickCategory")}
                      </Text>
                    </View>
                    {r.category && r.current?.category?.id !== r.category.id ? <View style={styles.changedDot} /> : null}
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Pressable>
                </>
              )}
            </Card>
          );
        })}

        <Button label={t("info.save")} icon="checkmark" loading={saving} disabled={!canSave} onPress={save} style={{ marginTop: 6 }} testID="info-save" />
      </Screen>

      <CategorySheet
        platform={picker}
        current={pickerRow?.current?.category ?? null}
        value={pickerRow?.category ?? null}
        recent={picker ? (recentCats[picker] ?? []) : []}
        onClose={() => setPicker(null)}
        onPick={(c) => {
          if (picker) patch(picker, { category: c });
          setPicker(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function TitleInput({ value, onChange, recent, testID }: { value: string; onChange: (v: string) => void; recent: string[]; testID?: string }) {
  const t = useT();
  const [showRecent, setShowRecent] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Field value={value} onChangeText={onChange} maxLength={MAX_TITLE} placeholder={t("info.titlePh")} autoCapitalize="sentences" autoCorrect testID={testID} style={{ paddingRight: 52 }} />
          <Text style={styles.counter} pointerEvents="none">
            {value.length}/{MAX_TITLE}
          </Text>
        </View>
        {recent.length > 0 ? (
          <IconButton icon="time-outline" label={t("info.recentTitles")} variant="outline" onPress={() => setShowRecent((v) => !v)} style={{ height: 44, width: 44 }} />
        ) : null}
      </View>
      {showRecent ? (
        <Card padded={false}>
          {recent.map((r, i) => (
            <Pressable
              key={r}
              onPress={() => {
                haptic.tap();
                onChange(r);
                setShowRecent(false);
              }}
              style={({ pressed }) => [styles.recent, i > 0 && styles.divider, pressed && { backgroundColor: colors.accent }]}
            >
              <Text style={styles.recentText} numberOfLines={1}>
                {r}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

function CategoryThumb({ category, size = 40 }: { category: StreamCategory | null; size?: number }) {
  return category?.image ? (
    <Image source={{ uri: category.image }} style={[styles.thumb, { height: size, width: size * 0.75 }]} contentFit="cover" />
  ) : (
    <View style={[styles.thumb, styles.thumbEmpty, { height: size, width: size * 0.75 }]}>
      <Ionicons name="game-controller-outline" size={14} color={colors.muted} />
    </View>
  );
}

/** Full-screen search for a game/category on one platform. */
function CategorySheet({
  platform,
  current,
  value,
  recent,
  onClose,
  onPick,
}: {
  platform: AccountPlatform | null;
  current: StreamCategory | null;
  value: StreamCategory | null;
  recent: StreamCategory[];
  onClose: () => void;
  onPick: (c: StreamCategory | null) => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { session } = useRemote();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StreamCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!platform) setQuery("");
  }, [platform]);

  const search = useCallback(
    (q: string) => {
      if (!platform || !session) return;
      // Kick has no "popular" list: wait for a query.
      if (!q && platform === "kick") {
        setResults([]);
        setBusy(false);
        return;
      }
      const n = ++seq.current;
      setBusy(true);
      session.client
        .searchCategories(platform, q)
        .then((r) => n === seq.current && setResults(r))
        .catch(() => n === seq.current && setResults([]))
        .finally(() => n === seq.current && setBusy(false));
    },
    [platform, session],
  );

  useEffect(() => {
    if (!platform) return;
    const q = query.trim();
    const id = setTimeout(() => search(q), q ? 300 : 0);
    return () => clearTimeout(id);
  }, [platform, query, search]);

  const q = query.trim();
  const recentShown = q ? [] : recent;
  const list = [...recentShown, ...results.filter((r) => !recentShown.some((x) => x.id === r.id))];
  const selected = (value ?? current)?.id;

  return (
    <Modal visible={!!platform} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, Platform.OS !== "ios" && { paddingTop: insets.top }]}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>
            {t("info.category")} · {platform ? NAMES[platform] : ""}
          </Text>
          <IconButton icon="close" label={t("common.close")} variant="outline" onPress={onClose} />
        </View>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("info.searchCategory")}
            placeholderTextColor={colors.faint}
            selectionColor={colors.primary}
            cursorColor={colors.text}
            autoFocus
            autoCorrect={false}
            style={styles.searchInput}
            testID="category-search"
          />
          {busy ? <ActivityIndicator size="small" color={colors.muted} /> : null}
        </View>
        {value ? (
          <Pressable onPress={() => onPick(null)} style={({ pressed }) => [styles.keep, pressed && { backgroundColor: colors.accent }]}>
            <Ionicons name="arrow-undo-outline" size={17} color={colors.muted} />
            <Text style={styles.keepText}>{t("info.keepCategory")}</Text>
            {current ? <Text style={styles.keepCur} numberOfLines={1}>{current.name}</Text> : null}
          </Pressable>
        ) : null}
        <FlatList
          data={list}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={
            list.length ? <Text style={styles.listHead}>{q ? t("info.results") : recentShown.length ? t("info.recent") : t("info.popular")}</Text> : undefined
          }
          ListEmptyComponent={busy ? undefined : <Text style={styles.empty}>{q || platform !== "kick" ? t("info.noResults") : t("info.typeToSearch")}</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                haptic.tap();
                onPick(item);
              }}
              style={({ pressed }) => [styles.catRow, pressed && { backgroundColor: colors.accent }]}
            >
              <CategoryThumb category={item} size={44} />
              <Text style={styles.catRowName} numberOfLines={2}>
                {item.name}
              </Text>
              {item.id === selected ? <Ionicons name="checkmark" size={18} color={colors.text} /> : null}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { color: colors.text, fontSize: 15, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  warn: { flexDirection: "row", alignItems: "center", gap: 6 },
  warnText: { color: colors.warning, fontSize: 12, flex: 1 },
  titleRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  counter: { position: "absolute", right: 12, top: 13, color: colors.faint, fontSize: 11, fontVariant: ["tabular-nums"] },
  recent: { paddingHorizontal: 14, paddingVertical: 12 },
  recentText: { color: colors.textDim, fontSize: 14 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  catBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.input,
  },
  catLabel: { color: colors.muted, fontSize: 11, fontWeight: "500" },
  catName: { color: colors.text, fontSize: 15, fontWeight: "500", marginTop: 1 },
  changedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  thumb: { borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  thumbEmpty: { backgroundColor: colors.cardStrong, alignItems: "center", justifyContent: "center" },
  sheet: { flex: 1, backgroundColor: colors.bg },
  sheetHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: "600", flex: 1 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.input,
  },
  // The box draws the field; drop the browser focus ring on web.
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) },
  keep: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  keepText: { color: colors.textDim, fontSize: 14 },
  keepCur: { color: colors.muted, fontSize: 13, marginLeft: "auto", flexShrink: 1 },
  listHead: { color: colors.muted, fontSize: 13, fontWeight: "600", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  empty: { color: colors.muted, fontSize: 14, textAlign: "center", paddingVertical: 32 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  catRowName: { color: colors.text, fontSize: 15, flex: 1 },
});
