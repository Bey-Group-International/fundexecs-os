import type { RtcOfferClientMessage, RtcAnswerClientMessage, RtcIceClientMessage, RtcLeaveClientMessage } from "../net/messages";

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME ?? "",
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL ?? "",
    });
  }
  return servers;
}

// Spatial audio: full volume inside bubble radius, fade to silence at exit radius
const BUBBLE_RADIUS_PX = 160;
const EXIT_RADIUS_PX = 200;

type RtcClientMessage = RtcOfferClientMessage | RtcAnswerClientMessage | RtcIceClientMessage | RtcLeaveClientMessage;
type SendFn = (msg: RtcClientMessage) => void;

interface PeerState {
  pc: RTCPeerConnection;
  gainNode: GainNode | null;
  audioEl: HTMLAudioElement | null;
  videoEl: HTMLVideoElement | null;
}

export type PeerVideoMap = Map<string, HTMLVideoElement | null>;

type VideoChangeHandler = (peerId: string, el: HTMLVideoElement | null) => void;

export class MeshManager {
  private myId = "";
  private peers = new Map<string, PeerState>();
  private localStream: MediaStream | null = null;
  // Active screen-share track, if the operator is currently presenting. Peers
  // that join the bubble mid-share pick this up in _createPeer.
  private screenTrack: MediaStreamTrack | null = null;
  private audioCtx: AudioContext | null = null;
  private send: SendFn;
  private onVideoChange: VideoChangeHandler;

  constructor(send: SendFn, onVideoChange: VideoChangeHandler) {
    this.send = send;
    this.onVideoChange = onVideoChange;
  }

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    // Add track to any already-open peer connections (late-join scenario)
    for (const [, state] of this.peers) {
      const senders = state.pc.getSenders();
      for (const track of stream.getTracks()) {
        if (!senders.find((s) => s.track === track)) {
          state.pc.addTrack(track, stream);
        }
      }
    }
  }

  /**
   * Start/stop broadcasting a screen-share to every peer. We swap the outgoing
   * camera video track for the screen track in place via replaceTrack — no
   * renegotiation, no glare, and the peer's existing video tile just shows the
   * screen. Passing null restores the camera feed. If a peer has no video
   * sender yet (camera never granted), we add the track and renegotiate.
   */
  async setScreenTrack(track: MediaStreamTrack | null): Promise<void> {
    this.screenTrack = track;
    const replacement = track ?? this.localStream?.getVideoTracks()[0] ?? null;
    for (const [peerId, state] of this.peers) {
      const sender = state.pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        try {
          await sender.replaceTrack(replacement);
        } catch {
          // Track ended between capture and replace — ignore
        }
      } else if (track) {
        // No camera video to swap — add the screen track and renegotiate once.
        state.pc.addTrack(track);
        await this._makeOffer(peerId);
      }
    }
  }

  /**
   * Swap the outgoing mic or camera track on every peer — used when the operator
   * picks a different input device mid-meeting. replaceTrack needs no
   * renegotiation, so peers keep receiving in place.
   */
  async replaceTrack(kind: "audio" | "video", track: MediaStreamTrack | null): Promise<void> {
    for (const [, state] of this.peers) {
      const sender = state.pc.getSenders().find((s) => s.track?.kind === kind);
      if (!sender) continue;
      try {
        await sender.replaceTrack(track);
      } catch {
        // Track ended mid-swap — ignore
      }
    }
  }

  /** Called when bubble.join fires — initiate offers to members with lower id */
  async joinBubble(myId: string, memberIds: string[]): Promise<void> {
    this.myId = myId;
    for (const peerId of memberIds) {
      if (peerId === myId) continue;
      if (this.peers.has(peerId)) continue;
      this._createPeer(peerId);
      // Polite-peer pattern: initiator = lexicographically larger id
      if (myId > peerId) {
        await this._makeOffer(peerId);
      }
    }
  }

  /** Called when bubble.update fires — add newly joined peers */
  async addPeer(peerId: string): Promise<void> {
    if (peerId === this.myId || this.peers.has(peerId)) return;
    this._createPeer(peerId);
    if (this.myId > peerId) {
      await this._makeOffer(peerId);
    }
  }

  /** Called on bubble.leave — tear down everything */
  leaveBubble(): void {
    for (const [peerId] of this.peers) {
      this._closePeer(peerId);
    }
    this.peers.clear();
    this.myId = "";
  }

  async handleOffer(from: string, sdp: string): Promise<void> {
    let state = this.peers.get(from);
    if (!state) {
      this._createPeer(from);
      state = this.peers.get(from)!;
    }
    await state.pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    this.send({ type: "rtc.answer", to: from, sdp: answer.sdp! });
  }

  async handleAnswer(from: string, sdp: string): Promise<void> {
    const state = this.peers.get(from);
    if (!state) return;
    await state.pc.setRemoteDescription({ type: "answer", sdp });
  }

  async handleIce(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    const state = this.peers.get(from);
    if (!state) return;
    try {
      await state.pc.addIceCandidate(candidate);
    } catch {
      // Stale candidate after restart — ignore
    }
  }

  /** Update spatial gain for a peer based on pixel distance */
  updateSpatialGain(peerId: string, distancePx: number): void {
    const state = this.peers.get(peerId);
    if (!state?.gainNode) return;
    // Smoothstep the linear falloff so the volume eases at the band edges
    // instead of ramping abruptly as a peer crosses the bubble boundary.
    const t = Math.max(
      0,
      Math.min(1, 1 - (distancePx - BUBBLE_RADIUS_PX) / (EXIT_RADIUS_PX - BUBBLE_RADIUS_PX))
    );
    const gain = t * t * (3 - 2 * t);
    state.gainNode.gain.setTargetAtTime(gain, this._audioCtx().currentTime, 0.05);
  }

  stopLocalStream(): void {
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private _audioCtx(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  private _createPeer(peerId: string): void {
    const pc = new RTCPeerConnection({ iceServers: buildIceServers() });
    const state: PeerState = { pc, gainNode: null, audioEl: null, videoEl: null };
    this.peers.set(peerId, state);

    // Add local tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    // If already presenting, this new peer should see the screen, not the
    // camera — swap the video sender in place (or add it if there's no camera).
    if (this.screenTrack) {
      const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (videoSender) void videoSender.replaceTrack(this.screenTrack);
      else pc.addTrack(this.screenTrack);
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.send({ type: "rtc.ice", to: peerId, candidate: ev.candidate.toJSON() });
      }
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);

      if (ev.track.kind === "audio") {
        const ctx = this._audioCtx();
        const src = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = 1;
        src.connect(gain);
        gain.connect(ctx.destination);
        state.gainNode = gain;

        // Also attach to an audio element for fallback
        const audio = new Audio();
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.muted = true; // Web Audio handles output; element just keeps stream alive
        state.audioEl = audio;
      }

      if (ev.track.kind === "video") {
        const video = document.createElement("video");
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        state.videoEl = video;
        this.onVideoChange(peerId, video);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this._closePeer(peerId);
        this.peers.delete(peerId);
      }
    };
  }

  private async _makeOffer(peerId: string): Promise<void> {
    const state = this.peers.get(peerId);
    if (!state) return;
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    this.send({ type: "rtc.offer", to: peerId, sdp: offer.sdp! });
  }

  private _closePeer(peerId: string): void {
    const state = this.peers.get(peerId);
    if (!state) return;
    state.pc.close();
    if (state.audioEl) {
      state.audioEl.srcObject = null;
    }
    this.onVideoChange(peerId, null);
  }
}
