"use client";

// Proximity-gated peer-to-peer voice/video for the Virtual Office.
//
// A WebRTC peer mesh, adapted (and simplified) from the meetings feature: no
// waiting room, chat, transcript, or host/admit logic. It runs on its OWN
// Supabase Realtime signaling channel (`office-voice:${orgId}`), kept separate
// from the presence channel that OfficeShell owns.
//
// The mesh is proximity-gated: we hold an RTCPeerConnection to a remote human
// only while they are within PROXIMITY_RADIUS tiles, and tear it down the moment
// they walk out of range or leave the office. Each remote audio track plays
// through an HTMLAudioElement whose `.volume` is continuously driven by
// `gainForDistance(distance(self, peer))`, so voices fade with distance exactly
// like the avatars do.
//
// Signaling uses "perfect negotiation" (glare-safe: a deterministic polite/
// impolite role from comparing userIds) so either side can (re)negotiate — which
// is what lets the optional camera toggle add/remove a video track mid-call — and
// ICE candidates that arrive before the remote description are buffered per-peer
// and flushed once it is applied.
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PROXIMITY_RADIUS } from "@/lib/office/layout";
import { distance, type Participant } from "@/lib/office/presence";
import { gainForDistance, clamp01 } from "@/lib/office/spatialAudio";

// STUN-only fallback used until (and if) the app's TURN config is fetched. Mirrors
// the meetings feature so office calls traverse the same NATs.
const FALLBACK_ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const RECONCILE_MS = 500; // how often we (dis)connect peers as people move
const VOLUME_MS = 120; // how often we re-drive each peer's volume from distance

// Signaling payloads. `from`/`to` are userIds (the presence keys). We use `kind`
// rather than `type` to avoid confusion with Supabase's broadcast envelope.
type VoiceSignal =
  | { kind: "join"; from: string }
  | { kind: "bye"; from: string; to: string }
  | { kind: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; from: string; to: string; candidate: RTCIceCandidateInit };

interface PeerState {
  pc: RTCPeerConnection;
  /** Polite peer (larger userId) yields on offer collisions; impolite one wins. */
  polite: boolean;
  /** Perfect-negotiation flag: we are mid-offer, so an incoming offer collides. */
  makingOffer: boolean;
  /** ICE candidates received before the remote description was set. */
  pendingIce: RTCIceCandidateInit[];
  /** The <audio> sink whose volume we fade with distance. */
  audioEl: HTMLAudioElement | null;
}

export interface UseProximityVoiceOptions {
  /** false = solo mode / realtime off → the hook is a no-op. */
  enabled: boolean;
  orgId: string;
  userId: string;
  displayName: string;
  /** Read the live LOCAL tile position each tick (OfficeShell keeps it in a ref). */
  getSelfPos: () => { x: number; y: number };
  /** Remote HUMAN participants (agents excluded) with live x/y. */
  humans: Participant[];
}

export interface UseProximityVoiceResult {
  connected: boolean;
  micOn: boolean;
  toggleMic: () => void;
  camOn: boolean;
  toggleCam: () => void;
  localStream: MediaStream | null;
  /** peerId (userId) → their remote MediaStream. */
  peerStreams: Map<string, MediaStream>;
  /** peerId → current spatial gain 0..1 (derived from distance). */
  levels: Map<string, number>;
  error: string | null;
}

export function useProximityVoice(
  opts: UseProximityVoiceOptions,
): UseProximityVoiceResult {
  const { enabled, orgId, userId, displayName, getSelfPos, humans } = opts;

  // --- Public state --------------------------------------------------------
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerStreams, setPeerStreams] = useState<Map<string, MediaStream>>(
    () => new Map(),
  );
  const [levels, setLevels] = useState<Map<string, number>>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  // --- Live inputs mirrored into refs so the long-lived effect / intervals
  // read the latest values without re-subscribing the channel each render. ---
  const humansRef = useRef<Participant[]>(humans);
  humansRef.current = humans;
  const getSelfPosRef = useRef(getSelfPos);
  getSelfPosRef.current = getSelfPos;

  // --- Long-lived mesh internals (stable across renders) -------------------
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);
  const sendRef = useRef<(msg: VoiceSignal) => void>(() => {});
  const mountedRef = useRef(false);

  // Publish the current peer→stream map to React state (new Map so it re-renders).
  const publishStreams = useCallback(() => {
    if (!mountedRef.current) return;
    const map = new Map<string, MediaStream>();
    for (const [id, st] of peersRef.current) {
      const s = st.audioEl?.srcObject;
      if (s instanceof MediaStream) map.set(id, s);
    }
    setPeerStreams(map);
  }, []);

  // Tear a single peer down: close the connection, stop its audio sink, and drop
  // it from every map. `announce` sends a `bye` so the other side reconciles fast.
  const closePeer = useCallback(
    (peerId: string, announce: boolean) => {
      const st = peersRef.current.get(peerId);
      if (!st) return;
      if (announce) sendRef.current({ kind: "bye", from: userId, to: peerId });
      try {
        st.pc.onnegotiationneeded = null;
        st.pc.onicecandidate = null;
        st.pc.ontrack = null;
        st.pc.close();
      } catch {
        /* already closed */
      }
      if (st.audioEl) {
        try {
          st.audioEl.pause();
          st.audioEl.srcObject = null;
        } catch {
          /* ignore */
        }
      }
      peersRef.current.delete(peerId);
      publishStreams();
      setLevels((prev) => {
        if (!prev.has(peerId)) return prev;
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    },
    [userId, publishStreams],
  );

  // Create a peer connection for `peerId`, wired for perfect negotiation. Adding
  // our local tracks here fires `onnegotiationneeded`, which drives the offer.
  const createPeer = useCallback(
    (peerId: string): PeerState => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(iceConfigRef.current);
      const st: PeerState = {
        pc,
        polite: userId > peerId, // deterministic, symmetric across the two peers
        makingOffer: false,
        pendingIce: [],
        audioEl: null,
      };
      peersRef.current.set(peerId, st);

      // Send our current tracks. With none (e.g. mic denied) negotiation simply
      // waits until the remote — who does have a track — offers to us.
      const local = localStreamRef.current;
      if (local) {
        for (const track of local.getTracks()) {
          try {
            pc.addTrack(track, local);
          } catch {
            /* ignore */
          }
        }
      }

      pc.onnegotiationneeded = async () => {
        try {
          st.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            sendRef.current({
              kind: "offer",
              from: userId,
              to: peerId,
              sdp: pc.localDescription,
            });
          }
        } catch {
          /* transient — the reconcile loop will retry or tear down */
        } finally {
          st.makingOffer = false;
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendRef.current({
            kind: "ice",
            from: userId,
            to: peerId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          try {
            pc.restartIce();
          } catch {
            /* ignore */
          }
        }
      };

      pc.ontrack = (ev) => {
        const stream = ev.streams[0] ?? null;
        if (!stream) return;
        if (!st.audioEl) {
          const el = new Audio();
          el.autoplay = true;
          el.srcObject = stream;
          el.volume = 0; // faded in by the volume loop from real distance
          void el.play().catch(() => {
            /* autoplay may be blocked until a gesture — retried next tick */
          });
          st.audioEl = el;
        } else if (st.audioEl.srcObject !== stream) {
          st.audioEl.srcObject = stream;
        }
        publishStreams();
      };

      return st;
    },
    [userId, publishStreams],
  );

  // Handle one inbound signaling message (perfect negotiation for offer/answer).
  const handleSignal = useCallback(
    async (msg: VoiceSignal) => {
      if (msg.from === userId) return; // broadcast self:false, but be defensive

      if (msg.kind === "join") {
        // A newcomer announced themselves; connect immediately if they are in
        // range rather than waiting for the next reconcile tick.
        const h = humansRef.current.find((p) => p.id === msg.from);
        if (h && distance(getSelfPosRef.current(), h) <= PROXIMITY_RADIUS) {
          createPeer(msg.from);
        }
        return;
      }

      if (msg.kind === "bye") {
        if (msg.to === userId) closePeer(msg.from, false);
        return;
      }

      if (msg.to !== userId) return; // not addressed to us

      if (msg.kind === "ice") {
        const st = peersRef.current.get(msg.from);
        if (!st) return;
        if (st.pc.remoteDescription) {
          try {
            await st.pc.addIceCandidate(msg.candidate);
          } catch {
            /* a candidate can be safely dropped after a rolled-back offer */
          }
        } else {
          st.pendingIce.push(msg.candidate);
        }
        return;
      }

      // offer / answer
      const st = peersRef.current.get(msg.from) ?? createPeer(msg.from);
      const { pc } = st;
      const description = msg.sdp;

      const offerCollision =
        description.type === "offer" &&
        (st.makingOffer || pc.signalingState !== "stable");
      // The impolite peer ignores a colliding offer; the polite one rolls back.
      if (!st.polite && offerCollision) return;

      try {
        await pc.setRemoteDescription(description);
        // Flush any ICE that arrived before the remote description existed.
        const buffered = st.pendingIce;
        st.pendingIce = [];
        for (const c of buffered) {
          try {
            await pc.addIceCandidate(c);
          } catch {
            /* ignore */
          }
        }
        if (description.type === "offer") {
          await pc.setLocalDescription();
          if (pc.localDescription) {
            sendRef.current({
              kind: "answer",
              from: userId,
              to: msg.from,
              sdp: pc.localDescription,
            });
          }
        }
      } catch {
        /* negotiation raced with teardown — reconcile will settle it */
      }
    },
    [userId, createPeer, closePeer],
  );

  // --- Main lifecycle: media + channel + proximity/volume loops ------------
  useEffect(() => {
    if (!enabled || !orgId || !userId) return;

    mountedRef.current = true;
    let cancelled = false;
    const supabase = createClient();
    // The peers Map is created once and never reassigned, so capturing it here
    // is equivalent to reading `.current` at cleanup and satisfies the linter.
    const peers = peersRef.current;
    let reconcileTimer: ReturnType<typeof setInterval> | null = null;
    let volumeTimer: ReturnType<typeof setInterval> | null = null;

    // Connect newly in-range humans; disconnect anyone out of range or gone.
    const reconcile = () => {
      const self = getSelfPosRef.current();
      const inRange = new Set<string>();
      for (const h of humansRef.current) {
        if (h.id === userId || h.kind !== "human") continue;
        if (distance(self, h) <= PROXIMITY_RADIUS) inRange.add(h.id);
      }
      for (const id of inRange) {
        if (!peersRef.current.has(id)) createPeer(id);
      }
      for (const id of [...peersRef.current.keys()]) {
        if (!inRange.has(id)) closePeer(id, true);
      }
    };

    // Continuously drive each peer's audio volume (and the exposed level) from
    // the live distance between us and them.
    const driveVolumes = () => {
      const self = getSelfPosRef.current();
      const next = new Map<string, number>();
      for (const [id, st] of peersRef.current) {
        const h = humansRef.current.find((p) => p.id === id);
        const gain = h ? clamp01(gainForDistance(distance(self, h))) : 0;
        if (st.audioEl) {
          st.audioEl.volume = gain;
          if (st.audioEl.paused) {
            void st.audioEl.play().catch(() => {
              /* still blocked — try again next tick */
            });
          }
        }
        next.set(id, gain);
      }
      if (mountedRef.current) setLevels(next);
    };

    async function init() {
      // Best-effort TURN/STUN config; keep the STUN fallback on any failure.
      try {
        const r = await fetch("/api/meetings/ice-servers");
        if (r.ok) {
          const { iceServers } = (await r.json()) as {
            iceServers: RTCIceServer[];
          };
          if (Array.isArray(iceServers) && iceServers.length > 0) {
            iceConfigRef.current = { iceServers };
          }
        }
      } catch {
        /* keep fallback */
      }
      if (cancelled) return;

      // Acquire the mic. Denial is non-fatal: presence keeps working and we can
      // still receive audio from peers who do have a mic.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setMicOn(true);
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Microphone access was denied. You can still see teammates — allow the mic and reload to talk."
            : name === "NotFoundError"
              ? "No microphone found. You can still see teammates."
              : "Could not access your microphone. You can still see teammates.",
        );
        localStreamRef.current = new MediaStream();
        setLocalStream(localStreamRef.current);
        setMicOn(false);
      }
      if (cancelled) return;

      // Dedicated voice signaling channel — separate from office presence.
      const channel = supabase.channel(`office-voice:${orgId}`, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;
      sendRef.current = (msg: VoiceSignal) => {
        void channel.send({ type: "broadcast", event: "signal", payload: msg });
      };

      channel
        .on(
          "broadcast",
          { event: "signal" },
          ({ payload }: { payload: VoiceSignal }) => {
            void handleSignal(payload);
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            if (mountedRef.current) setConnected(true);
            // Announce ourselves once so in-range peers can connect promptly.
            sendRef.current({ kind: "join", from: userId });
          }
        });

      reconcileTimer = setInterval(reconcile, RECONCILE_MS);
      volumeTimer = setInterval(driveVolumes, VOLUME_MS);
      reconcile();
    }

    void init();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (reconcileTimer) clearInterval(reconcileTimer);
      if (volumeTimer) clearInterval(volumeTimer);
      // Politely notify peers, then close everything.
      for (const [id, st] of peers) {
        try {
          sendRef.current({ kind: "bye", from: userId, to: id });
        } catch {
          /* ignore */
        }
        try {
          st.pc.close();
        } catch {
          /* ignore */
        }
        if (st.audioEl) {
          try {
            st.audioEl.pause();
            st.audioEl.srcObject = null;
          } catch {
            /* ignore */
          }
        }
      }
      peers.clear();
      localStreamRef.current?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      localStreamRef.current = null;
      sendRef.current = () => {};
      try {
        channelRef.current?.unsubscribe();
      } catch {
        /* ignore */
      }
      try {
        if (channelRef.current) void supabase.removeChannel(channelRef.current);
      } catch {
        /* ignore */
      }
      channelRef.current = null;
      setConnected(false);
      setPeerStreams(new Map());
      setLevels(new Map());
      setLocalStream(null);
      setMicOn(false);
      setCamOn(false);
    };
    // Inputs that change every render (humans, positions, displayName) are read
    // through refs, so the mesh is set up once per enabled session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, orgId, userId]);

  // --- Controls ------------------------------------------------------------
  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    const tracks = stream?.getAudioTracks() ?? [];
    if (tracks.length === 0) return; // nothing to toggle (mic never granted)
    const nextOn = !tracks[0].enabled;
    tracks.forEach((t) => {
      t.enabled = nextOn;
    });
    setMicOn(nextOn);
  }, []);

  const toggleCam = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const existing = stream.getVideoTracks();
    if (existing.length > 0) {
      // Turn the camera OFF: stop + remove the track from the stream and from
      // every peer sender, which triggers renegotiation via onnegotiationneeded.
      for (const track of existing) {
        for (const st of peersRef.current.values()) {
          const sender = st.pc
            .getSenders()
            .find((s) => s.track === track);
          if (sender) {
            try {
              st.pc.removeTrack(sender);
            } catch {
              /* ignore */
            }
          }
        }
        track.stop();
        stream.removeTrack(track);
      }
      setCamOn(false);
      publishStreams();
      return;
    }

    // Turn the camera ON: acquire video, attach to the local stream and to every
    // peer connection. addTrack fires onnegotiationneeded → renegotiate.
    void navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((camStream) => {
        const track = camStream.getVideoTracks()[0];
        if (!track) return;
        const local = localStreamRef.current;
        if (!local) {
          track.stop();
          return;
        }
        local.addTrack(track);
        for (const st of peersRef.current.values()) {
          try {
            st.pc.addTrack(track, local);
          } catch {
            /* ignore */
          }
        }
        setCamOn(true);
        publishStreams();
      })
      .catch((err) => {
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Camera access was denied."
            : "Could not access your camera.",
        );
      });
  }, [publishStreams]);

  return {
    connected,
    micOn,
    toggleMic,
    camOn,
    toggleCam,
    localStream,
    peerStreams,
    levels,
    error,
  };
}
