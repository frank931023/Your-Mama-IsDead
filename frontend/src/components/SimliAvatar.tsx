"use client";

/**
 * SimliAvatar — realtime lip-synced talking-head powered by Simli.
 *
 * Lifecycle
 * ─────────
 *  1. Mount → fetch a per-session compose token from backend
 *     (`POST /api/personas/:tokenId/simli-session`).
 *  2. Construct a SimliClient bound to the local <video>/<audio> tags.
 *  3. Call `start()` to open the WebRTC pipe to Simli's edge.
 *  4. Each time the parent has new TTS audio, it calls the imperative
 *     `playAudio(blobUrlOrSrc)` handle. We decode that audio in a hidden
 *     <audio>, route it through WebAudio into a MediaStreamTrack, and feed it
 *     to Simli via `listenToMediastreamTrack`. Simli responds with a lip-
 *     synced video track (rendered into our <video>) and echoes the audio
 *     into our <audio> tag.
 *  5. Unmount → `stop()` + close AudioContext.
 *
 * Why MediaStreamTrack and not `sendAudioData(Uint8Array)`?
 *   sendAudioData requires raw PCM16 @ 16 kHz. Our TTS endpoint returns mp3.
 *   Decoding mp3 → PCM in the browser is doable but adds latency and a
 *   resampler. listenToMediastreamTrack lets the browser's audio pipeline do
 *   the heavy lifting; Simli pulls samples from the track directly.
 */
import * as React from "react";
import { SimliClient } from "simli-client";
import { Loader2, AlertCircle } from "lucide-react";

import { fetchSimliSession } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface SimliAvatarHandle {
  /** Play an audio source (blob: URL, http(s):// URL, or any <audio>-compatible src)
   *  through the Simli lip-sync pipeline. Resolves when the clip finishes. */
  playAudio(src: string): Promise<void>;
  /** Stop the avatar mid-utterance (clears Simli's audio buffer). */
  interrupt(): void;
}

interface SimliAvatarProps {
  tokenId: string;
  jwt: string;
  className?: string;
  /** Optional poster image shown until the WebRTC stream produces a frame. */
  posterUrl?: string | null;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export const SimliAvatar = React.forwardRef<SimliAvatarHandle, SimliAvatarProps>(
  function SimliAvatar({ tokenId, jwt, className, posterUrl, onReady, onError }, ref) {
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);
    const clientRef = React.useRef<SimliClient | null>(null);
    const audioCtxRef = React.useRef<AudioContext | null>(null);
    // We tear down the previous playback graph before starting a new one so
    // consecutive replies don't pile up sources on the same MediaStreamDestination.
    const activePlaybackRef = React.useRef<{
      el: HTMLAudioElement;
      source: MediaElementAudioSourceNode;
      destination: MediaStreamAudioDestinationNode;
    } | null>(null);

    const [status, setStatus] = React.useState<"connecting" | "ready" | "error">("connecting");
    const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

    // Lazily create the shared AudioContext on first user gesture / play call.
    // Some browsers block AudioContext until a user interaction; the parent
    // typing & submitting counts, so by the time playAudio fires we're fine.
    const ensureAudioContext = React.useCallback((): AudioContext => {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AC();
      }
      if (audioCtxRef.current.state === "suspended") {
        void audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    }, []);

    const teardownPlayback = React.useCallback(() => {
      const pb = activePlaybackRef.current;
      if (!pb) return;
      try {
        pb.el.pause();
        pb.el.src = "";
        pb.source.disconnect();
        pb.destination.disconnect();
      } catch {
        /* graph already torn down */
      }
      activePlaybackRef.current = null;
    }, []);

    // Bring up the WebRTC pipe. Re-runs only if tokenId / jwt change.
    React.useEffect(() => {
      let cancelled = false;

      const init = async (): Promise<void> => {
        try {
          setStatus("connecting");
          setErrorMessage(null);

          const session = await fetchSimliSession(tokenId, jwt);
          if (cancelled) return;
          if (!videoRef.current || !audioRef.current) {
            throw new Error("avatar media elements not mounted");
          }

          const client = new SimliClient(
            session.sessionToken,
            videoRef.current,
            audioRef.current,
            null, // default iceServers
          );
          clientRef.current = client;

          // Wire events before start() so we don't miss the first 'start' tick.
          client.on("start", () => {
            if (cancelled) return;
            setStatus("ready");
            onReady?.();
          });
          client.on("error", (msg: unknown) => {
            const text = typeof msg === "string" ? msg : "Simli error";
            if (cancelled) return;
            setErrorMessage(text);
            setStatus("error");
            onError?.(text);
          });
          client.on("startup_error", (msg: unknown) => {
            const text = typeof msg === "string" ? msg : "Simli startup error";
            if (cancelled) return;
            setErrorMessage(text);
            setStatus("error");
            onError?.(text);
          });

          await client.start();
        } catch (err) {
          if (cancelled) return;
          const text = err instanceof Error ? err.message : "Simli connection failed";
          setErrorMessage(text);
          setStatus("error");
          onError?.(text);
        }
      };

      void init();

      return () => {
        cancelled = true;
        teardownPlayback();
        try {
          clientRef.current?.stop();
        } catch {
          /* best-effort */
        }
        clientRef.current = null;
        // Close the AudioContext on unmount so the page doesn't leak it
        // (Chrome caps live AudioContexts per origin).
        const ctx = audioCtxRef.current;
        audioCtxRef.current = null;
        if (ctx && ctx.state !== "closed") {
          void ctx.close();
        }
      };
    }, [tokenId, jwt, onReady, onError, teardownPlayback]);

    React.useImperativeHandle(
      ref,
      (): SimliAvatarHandle => ({
        async playAudio(src: string): Promise<void> {
          const client = clientRef.current;
          if (!client) throw new Error("Simli client not ready");

          // Stop any in-flight playback first; Simli will splice cleanly when
          // we attach a new track.
          teardownPlayback();
          try {
            client.ClearBuffer();
          } catch {
            /* ClearBuffer is best-effort; if not supported yet, ignore */
          }

          const ctx = ensureAudioContext();

          // Use a fresh hidden <audio> per utterance so MediaElementSource
          // (which is one-shot per element) doesn't throw on re-use.
          const el = new Audio();
          el.crossOrigin = "anonymous";
          el.preload = "auto";
          el.src = src;

          const source = ctx.createMediaElementSource(el);
          const destination = ctx.createMediaStreamDestination();
          source.connect(destination);
          // NOTE: deliberately *not* connecting source → ctx.destination.
          // The user hears the audio via Simli's <audio> tag (echoed back in
          // sync with the video). Connecting here would double-play.

          activePlaybackRef.current = { el, source, destination };

          const track = destination.stream.getAudioTracks()[0];
          if (!track) throw new Error("failed to create audio track");
          client.listenToMediastreamTrack(track);

          await new Promise<void>((resolve, reject) => {
            const cleanup = (): void => {
              el.removeEventListener("ended", onEnded);
              el.removeEventListener("error", onErr);
            };
            const onEnded = (): void => {
              cleanup();
              resolve();
            };
            const onErr = (): void => {
              cleanup();
              reject(new Error("audio playback failed"));
            };
            el.addEventListener("ended", onEnded);
            el.addEventListener("error", onErr);
            void el.play().catch(onErr);
          });
        },
        interrupt(): void {
          teardownPlayback();
          try {
            clientRef.current?.ClearBuffer();
          } catch {
            /* ignore */
          }
        },
      }),
      [ensureAudioContext, teardownPlayback],
    );

    return (
      <div className={cn("relative w-full overflow-hidden rounded-md bg-paper-soft", className)}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          poster={posterUrl ?? undefined}
          className="h-full w-full object-cover"
        />
        {/* Audio element is hidden but must exist in the DOM so Simli can attach the
            inbound remote track to it. Browsers won't autoplay audio without it being
            on the page. */}
        <audio ref={audioRef} autoPlay className="hidden" />

        {status === "connecting" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-paper-soft/60">
            <div className="flex items-center gap-2 rounded-md bg-paper px-3 py-1.5 text-xs text-ink-muted shadow-sm">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              連線數位分身中…
            </div>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-paper-soft/80 p-3 text-center">
            <div className="flex max-w-full items-start gap-2 rounded-md bg-paper px-3 py-2 text-xs text-red-700 shadow-sm">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="break-words">{errorMessage ?? "分身連線失敗"}</span>
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);
