import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatMessage } from "@vexcast/protocol";
import { memo, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AlertsPanel } from "@/components/AlertsPanel";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { PlatformIcon } from "@/components/PlatformIcon";
import { EmptyState } from "@/components/ui";
import { formatTime, nameColor } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { useTabBarInset } from "@/state/prefs";
import { useRemote } from "@/state/remote";
import { colors, platformColors, radius } from "@/theme";

const badgeColors: Record<string, string> = {
  broadcaster: "#EF4444",
  moderator: "#22C55E",
  vip: "#E879F9",
  subscriber: "#A78BFA",
  member: "#22C55E",
  founder: "#F59E0B",
  verified: "#38BDF8",
};

export default function ChatTab() {
  const { t } = useI18n();
  const { alerts } = useRemote();
  const [segment, setSegment] = useState<"chat" | "alerts">("chat");
  const seen = useRef(alerts.length);
  if (segment === "alerts") seen.current = alerts.length;
  const unseen = Math.max(0, alerts.length - seen.current);
  return (
    <View style={styles.root}>
      <View style={styles.segmentWrap}>
        <View style={styles.segment}>
          {(["chat", "alerts"] as const).map((id) => {
            const on = segment === id;
            return (
              <Pressable
                key={id}
                onPress={() => {
                  haptic.tap();
                  setSegment(id);
                }}
                style={[styles.segBtn, on && styles.segBtnOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                testID={`chat-segment-${id}`}
              >
                <Text style={[styles.segText, on && { color: colors.text }]}>{id === "chat" ? t("chat.tabChat") : t("chat.tabAlerts")}</Text>
                {id === "alerts" && unseen > 0 ? (
                  <View style={styles.segBadge}>
                    <Text style={styles.segBadgeText}>{unseen > 99 ? "99+" : unseen}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      {segment === "chat" ? <Chat /> : <AlertsPanel />}
    </View>
  );
}

function Chat() {
  const { t } = useI18n();
  const { chat, state, run, highlightId } = useRemote();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [toDelete, setToDelete] = useState<ChatMessage | null>(null);
  const data = useMemo(() => [...chat].reverse(), [chat]);
  const connected = (state?.chat ?? []).filter((c) => c.enabled);
  const inset = useTabBarInset();

  async function send() {
    const msg = text.trim();
    if (!msg || sending) return;
    haptic.light();
    setSending(true);
    const r = await run((c) => c.sendChat(msg).then(() => true));
    setSending(false);
    if (r) setText("");
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 188 : 0}
    >
      {connected.length > 0 ? (
        <View style={styles.conns}>
          {connected.map((c) => (
            <View key={`${c.platform}-${c.channel}`} style={styles.conn}>
              <PlatformIcon platform={c.platform} size={18} />
              <Text style={styles.connText} numberOfLines={1}>
                {c.channel}
              </Text>
              <View
                style={[
                  styles.connDot,
                  { backgroundColor: c.state === "connected" ? colors.success : c.state === "error" ? colors.danger : colors.warning },
                ]}
              />
            </View>
          ))}
        </View>
      ) : null}
      <FlatList
        style={{ flex: 1 }}
        data={data}
        inverted={data.length > 0}
        keyExtractor={(m) => m.id}
        contentContainerStyle={data.length === 0 ? styles.emptyWrap : styles.list}
        renderItem={({ item }) => <Message msg={item} onLongPress={() => {
          haptic.medium();
          setToDelete(item);
        }} />}
        ListEmptyComponent={
          <EmptyState icon="chatbubbles-outline" text={connected.length === 0 ? t("chat.noConnections") : t("chat.empty")} />
        }
        keyboardShouldPersistTaps="handled"
      />
      <View style={[styles.composer, inset ? { marginBottom: inset - 4 } : null]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t("chat.placeholder")}
          placeholderTextColor={colors.faint}
          selectionColor={colors.primary}
          cursorColor={colors.text}
          style={styles.input}
          onSubmitEditing={send}
          returnKeyType="send"
          maxLength={500}
          testID="chat-input"
        />
        <Pressable
          onPress={send}
          disabled={!text.trim() || sending}
          style={({ pressed }) => [styles.sendBtn, { opacity: !text.trim() ? 0.4 : pressed ? 0.8 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={t("chat.send")}
          testID="chat-send"
        >
          <Ionicons name="send" size={17} color={colors.primaryFg} />
        </Pressable>
      </View>

      <ConfirmSheet
        visible={!!toDelete}
        icon="trash-outline"
        destructive
        title={toDelete ? t("chat.actionsTitle", { user: toDelete.user.name }) : ""}
        body={toDelete ? `“${toDelete.text}”\n\n${t("chat.deleteBody", { user: toDelete.user.name })}` : undefined}
        confirmLabel={t("common.delete")}
        extra={
          toDelete && !toDelete.isBot
            ? {
                label: highlightId === toDelete.id ? t("chat.unhighlight") : t("chat.highlight"),
                icon: "star-outline",
                onPress: () => {
                  const m = toDelete;
                  const on = highlightId === m.id;
                  setToDelete(null);
                  void run((c) => (on ? c.clearChatHighlight() : c.highlightChatMessage(m.id)), on ? t("chat.unhighlighted") : t("chat.highlighted"));
                },
              }
            : undefined
        }
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          const m = toDelete;
          setToDelete(null);
          if (m) void run((c) => c.deleteChatMessage(m.id), t("chat.deleted"));
        }}
      />
    </KeyboardAvoidingView>
  );
}

const Message = memo(function Message({ msg, onLongPress }: { msg: ChatMessage; onLongPress: () => void }) {
  const { t, locale } = useI18n();
  const color = msg.user.color || nameColor(msg.user.name);
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.msg,
        msg.flagged && styles.msgFlagged,
        pressed && { backgroundColor: colors.accent },
        { borderLeftColor: platformColors[msg.platform] ?? colors.border },
      ]}
    >
      <View style={styles.msgHead}>
        <PlatformIcon platform={msg.platform} size={18} />
        {msg.user.badges.map((b) => (
          <View key={b.id} style={[styles.badge, { backgroundColor: `${badgeColors[b.id] ?? colors.muted}2A`, borderColor: `${badgeColors[b.id] ?? colors.muted}66` }]}>
            <Text style={[styles.badgeText, { color: badgeColors[b.id] ?? colors.textDim }]} numberOfLines={1}>
              {b.label}
            </Text>
          </View>
        ))}
        {msg.isBot ? (
          <View style={[styles.badge, { backgroundColor: colors.cardStrong, borderColor: colors.borderStrong }]}>
            <Text style={[styles.badgeText, { color: colors.textDim }]}>{t("chat.bot")}</Text>
          </View>
        ) : null}
        <Text style={[styles.name, { color }]} numberOfLines={1}>
          {msg.user.name}
        </Text>
        <Text style={styles.time}>{formatTime(msg.ts, locale)}</Text>
      </View>
      <Text style={styles.text}>{msg.text}</Text>
      {msg.flagged ? (
        <View style={styles.flagRow}>
          <Ionicons name="flag" size={11} color={colors.warning} />
          <Text style={styles.flagText}>{t("chat.flagged")}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  segmentWrap: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 },
  segment: { flexDirection: "row", backgroundColor: colors.cardStrong, borderRadius: radius.lg, padding: 3, gap: 3, width: "100%", maxWidth: 720, alignSelf: "center" },
  segBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", height: 34, borderRadius: radius.md },
  segBtnOn: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderStrong },
  segText: { color: colors.muted, fontSize: 14, fontWeight: "500" },
  segBadge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.live, alignItems: "center", justifyContent: "center" },
  segBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  conns: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  conn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 200,
  },
  connText: { color: colors.textDim, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  connDot: { width: 6, height: 6, borderRadius: 3 },
  list: { padding: 12, gap: 8 },
  emptyWrap: { flexGrow: 1, justifyContent: "center", padding: 24 },
  msg: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  msgFlagged: { backgroundColor: "rgba(245,158,11,0.08)" },
  msgHead: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  badge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, maxWidth: 90 },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  name: { fontWeight: "700", fontSize: 14, flexShrink: 1 },
  time: { color: colors.faint, fontSize: 11, marginLeft: "auto" },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  flagRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  flagText: { color: colors.warning, fontSize: 11, fontWeight: "700" },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 12 : 9,
    color: colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  sendBtn: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
});
