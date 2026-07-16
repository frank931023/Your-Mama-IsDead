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

import { fetchSimliSession, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface SimliAvatarHandle {
  /** Resume the WebAudio context + the inbound LiveKit audio playback. MUST be
   *  called synchronously from inside a user-gesture handler (e.g. the click on
   *  "send"), because browsers only honour AudioContext.resume() / media
   *  playback unlock within the gesture's synchronous call stack — by the time
   *  the async TTS fetch resolves and playAudio() runs, that grace is gone and
   *  the context stays "suspended" (so no samples flow to Simli → avatar never
   *  lip-syncs). Safe to call repeatedly. */
  unlockAudio(): void;
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
  /** Called when the session request is rejected with 401 (stale/expired JWT).
   *  The parent should clear the cached token + re-run SIWE login; passing a
   *  fresh `jwt` prop then re-triggers the connection effect. */
  onAuthError?: () => void;
}

export const SimliAvatar = React.forwardRef<SimliAvatarHandle, SimliAvatarProps>(
  function SimliAvatar({ tokenId, jwt, className, posterUrl, onReady, onError, onAuthError }, ref) {
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
            // ICE/TURN servers from the backend (GET /compose/ice). Still passed
            // through for completeness; LiveKit transport (below) manages its
            // own connection, but P2P fallback inside simli-client would need
            // these. Fall back to null only if the list is empty.
            session.iceServers.length > 0 ? session.iceServers : null,
            undefined, // logLevel — keep SDK default (DEBUG)
            // Use LiveKit transport, NOT the default "p2p". Simli's edge is an
            // ice-lite server that only advertises a single Cloudflare relay
            // candidate; on most networks the browser can't complete the P2P
            // ICE handshake, so simli-client never fires its internal "start"
            // and the 15s connection timeout trips ("CONNECTION TIMED OUT"),
            // looping forever and tearing down the audio worklet each retry —
            // which is why the avatar rendered but never lip-synced. LiveKit
            // routes media through Simli's managed SFU and needs no P2P NAT
            // traversal, so it connects reliably here.
            "livekit",
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
          // 401 = the JWT we were handed is stale/expired. Ask the parent to
          // re-authenticate (clear token + re-run SIWE); a fresh `jwt` prop
          // re-runs this effect and reconnects. Don't show a hard error for it.
          if (err instanceof ApiError && err.status === 401) {
            onAuthError?.();
            return;
          }
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
    }, [tokenId, jwt, onReady, onError, onAuthError, teardownPlayback]);

    React.useImperativeHandle(
      ref,
      (): SimliAvatarHandle => ({
        unlockAudio(): void {
          // (1) Resume OUR WebAudio context (the one that decodes TTS into a
          // MediaStreamTrack for Simli). Must run inside the user gesture.
          ensureAudioContext();
          // (2) Unlock the inbound LiveKit playback <audio>. Simli's audio track
          // is attached to it (LivekitTransport.track.attach), and the browser
          // blocks autoplay until a gesture. A muted play()/pause() here, in the
          // gesture's stack, satisfies the autoplay policy; the real audio then
          // plays when Simli pushes the lip-synced reply.
          const a = audioRef.current;
          if (a) {
            const wasMuted = a.muted;
            a.muted = true;
            void a.play().then(() => {
              a.pause();
              a.muted = wasMuted;
            }).catch(() => {
              a.muted = wasMuted;
            });
          }
        },
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
          // Wait for the context to actually reach "running". A suspended
          // context produces NO samples, so the MediaStreamTrack we hand Simli
          // would be silent and the avatar would stay still (all-SILENT, no
          // SPEAK). resume() was already kicked off in unlockAudio() during the
          // gesture; here we just await it settling.
          if (ctx.state === "suspended") {
            await ctx.resume().catch(() => {});
          }

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

          // Kick the inbound playback <audio> (where LiveKit attached Simli's
          // lip-synced audio track) to play. We get口型 because Simli receives
          // our audio and streams video+audio back, but the browser's autoplay
          // policy keeps that <audio> muted until something plays it from a
          // gesture-rooted call stack — which this is (user just hit send).
          // Without this the avatar mouths the words silently.
          const playback = audioRef.current;
          if (playback) {
            playback.muted = false;
            playback.volume = 1;
            void playback.play().catch(() => {
              /* if it still blocks, unlockAudio() on next send should clear it */
            });
          }

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
            <div className="flex max-w-full items-start gap-2 rounded-md bg-paper px-3 py-2 text-xs text-red-400 shadow-sm">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="break-words">{errorMessage ?? "分身連線失敗"}</span>
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);
