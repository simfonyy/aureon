import { api } from "@/api/client";
import type { PresencePayload, Track } from "@/api/types";
import { musicTrackUrl } from "@/lib/musicClips";
import { DEFAULT_DISCORD_CLIENT_ID, useUiStore } from "@/stores/ui/index";
import { useTogetherStore } from "@/stores/together/index";

export interface PresenceContext {
  track: Track | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  playbackRate: number;
}

function template(text: string, track: Track): string {
  const artist = track.artists.map((item) => item.name).join(", ");
  return text
    .replaceAll("{title}", track.title)
    .replaceAll("{artist}", artist)
    .replaceAll("{album}", track.album_title || "Без альбома")
    .trim();
}

function normalizeCover(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://")) return url.replace("http://", "https://");
  return url;
}

function clampLine(value: string, fallback: string): string {
  const text = (value || "").trim() || fallback.trim();
  const padded = text.length < 2 ? `${text} ` : text;
  return padded.slice(0, 128);
}

const statusDisplayTypes = { app: 0, artist: 1, track: 2 } as const;

let lastSignature = "";

export function resetPresenceSignature(): void {
  lastSignature = "";
}

export async function syncDiscordPresence(
  context: PresenceContext,
  options: { force?: boolean } = {},
): Promise<string | null> {
  const settings = useUiStore().settings;
  const track = context.isPlaying ? context.track : null;
  const clientId = settings.discordClientId.trim() || DEFAULT_DISCORD_CLIENT_ID;

  if (!settings.discordEnabled) {
    if (lastSignature) {
      lastSignature = "";
      await api.clearDiscordPresence().catch(() => undefined);
    }
    return null;
  }

  const payload: PresencePayload = {
    enabled: true,
    applicationId: clientId,
    idle: !track,
    statusDisplayType: statusDisplayTypes.app,
    details: context.track && !track ? "На паузе" : "",
    state: "",
    album: "",
    coverUrl: null,
    trackUrl: "",
    buttonLabel: "",
    showDownloadButton: settings.discordDownloadButton,
    startedAt: null,
    endsAt: null,
    partyId: null,
    partySize: null,
    partyMax: null,
  };

  if (track) {
    const artists = track.artists.map(item => item.name).filter(name => name.trim()).join(", ");
    const statusTitle = settings.discordStatusTitle;
    payload.statusDisplayType = statusDisplayTypes[statusTitle] ?? statusDisplayTypes.track;
    payload.details = clampLine(statusTitle === "track" ? track.title : template(settings.discordDetails, track), track.title);
    payload.state = clampLine(statusTitle === "artist" ? artists : template(settings.discordState, track), artists || "Яндекс Музыка");
    if (statusTitle === "artist" && !artists) payload.statusDisplayType = statusDisplayTypes.app;
    if (statusTitle === "track" && !track.title.trim()) payload.statusDisplayType = statusDisplayTypes.app;

    payload.album = clampLine(track.album_title || track.title, track.title);
    payload.coverUrl = settings.discordShowArtwork && !track.id.startsWith("local:") ? normalizeCover(track.cover_url) : null;
    payload.trackUrl = musicTrackUrl(track.id) ?? "";
    payload.buttonLabel = settings.discordButtonLabel.trim();

    const duration = context.duration || (track.duration_ms ?? 0) / 1000;
    if (settings.discordShowTime && duration > 0) {
      const rate = Math.max(0.25, context.playbackRate);
      const now = Math.floor(Date.now() / 1000);
      payload.startedAt = now - Math.floor(context.progress / rate);
      payload.endsAt = now + Math.max(1, Math.floor((duration - context.progress) / rate));
    }

    const together = useTogetherStore();
    if (together.active) {
      const size = Math.max(1, together.peers.length);
      const note = together.isHost
        ? size > 1 ? `в группе · ${size}` : "в группе"
        : `в группе с ${together.hostNick}`;
      const field = statusTitle === "artist" ? "details" : "state";
      payload[field] = clampLine(`${payload[field]} · 🎧 ${note}`, `🎧 ${note}`);
      payload.partyId = `nightlezz:${together.invite || "together"}`.slice(0, 128);
      payload.partySize = size;
      payload.partyMax = Math.max(size, 2);
    }
  }

  const signature = JSON.stringify({
    ...payload,
    startedAt: payload.startedAt ? Math.round(payload.startedAt / 4) : null,
    endsAt: payload.endsAt ? Math.round(payload.endsAt / 4) : null,
  });
  if (!options.force && signature === lastSignature) return null;
  lastSignature = signature;

  try {
    await api.updateDiscordPresence(payload);
    return null;
  } catch (error) {
    lastSignature = "";
    return error instanceof Error ? error.message : "Discord недоступен";
  }
}
