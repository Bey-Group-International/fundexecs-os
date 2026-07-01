import type { RtcOfferClientMessage, RtcAnswerClientMessage, RtcIceClientMessage, RtcLeaveClientMessage } from "../net/messages";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

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
    const gain = Math.max(
      0,
      Math.min(1, 1 - (distancePx - BUBBLE_RADIUS_PX) / (EXIT_RADIUS_PX - BUBBLE_RADIUS_PX))
    );
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const state: PeerState = { pc, gainNode: null, audioEl: null, videoEl: null };
    this.peers.set(peerId, state);

    // Add local tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
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
