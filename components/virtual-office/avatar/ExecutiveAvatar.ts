import * as Phaser from "phaser";
import type { AvatarProp, AvatarSpec } from "./avatarPalette";
import { vivify } from "./avatarPalette";

/** Bold silhouette outline color — a near-black cool ink for a crisp rim. */
const OUTLINE = 0x0a0a0d;
import type { AgentState } from "../program/officeProgram";
import type { WorkPantomime } from "@/lib/office/characterSheet";
import { AvatarAnimator } from "@/lib/office/avatarAnim/player";
import { CLIPS, type ClipName } from "@/lib/office/avatarAnim/clips";
import { sampleClip } from "@/lib/office/avatarAnim/sampler";

/** One-shot reaction gestures the scene triggers on workflow events. */
export type AvatarGesture = "wave" | "nod" | "celebrate";

export type AvatarFacing = "down" | "up" | "left" | "right";

/**
 * Discrete animation states the figure can render. Mirrors the Unity-style
 * AI-character-controller animation set from the design brief so the current
 * Canvas2D renderer and a future Three.js/WebGPU or Unreal rig share the same
 * vocabulary. The office program drives *program* state; the avatar resolves
 * it into a *visual* animation state on its own.
 */
export type AnimationState =
  | "idle_breathing"
  | "walking"
  | "typing"
  | "reviewing_docs"
  | "presenting"
  | "analyzing_model"
  | "waiting"
  | "celebrating_complete";

/** How the arms are posed for the current animation. */
type ArmMode = "walk" | "idle" | "type" | "review" | "present";

/**
 * A humanized executive avatar drawn entirely from canvas primitives —
 * no sprite sheets, no boxes. Composed of layered vector shapes (soft
 * ground shadow, presence rim light, head with shaded hair, blazer with
 * lapels and a volume highlight, tie/accent, arms, legs) into a
 * recognizable professional figure with a four-way facing, a walk cycle,
 * and state-driven *work* animations (typing, reviewing, presenting,
 * analyzing) that only play when the agent is actually doing that work.
 *
 * MetaHuman / Omniverse-ACE influence, kept web-performant:
 *  - directional posture + role-specific silhouette and carried prop
 *  - a soft rim/presence light that ignites only while an agent works
 *  - a "thinking" pulse while analyzing — a lightweight ACE presence cue
 *
 * Rendering is cheap: the body is only redrawn when the visible pose
 * changes (facing, walk step, or work step), never every frame. Idle and
 * "thinking" motion are transform-only. AI agents add a tweened aura ring
 * that pulses only while actively working.
 *
 * The avatar rides on top of the scene's existing position anchors (the
 * arcade physics sprites / NPC path targets), so all movement, collision,
 * and networking logic is untouched. When the rendering layer is later
 * upgraded, only this class is replaced.
 */
export class ExecutiveAvatar {
  /**
   * Global accessibility flag. When true (user has
   * `prefers-reduced-motion: reduce`), all decorative *looping* motion is
   * suppressed — aura/rim pulse, breathing bob, typing keystroke motion, and
   * the thinking-dot pulse. The figure still shows the correct pose, state
   * color, and badges statically. Set by OfficeScene before avatars spawn.
   */
  static reducedMotion = false;

  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private spec: AvatarSpec;

  private shadow: Phaser.GameObjects.Graphics;
  private rim: Phaser.GameObjects.Arc;
  private aura: Phaser.GameObjects.Arc;
  // The drawn figure. `body` is the Graphics everything is painted into; it now
  // lives inside `figure`, an inner Container that carries the whole-figure
  // transforms (breathing / lean / bounce, and hover dim). Keeping these on the
  // container — not `body` — lets later PRs split the figure into independently
  // transformable limb objects (base / arms / torso / head) that all ride the
  // same figure transform while rotating on their own pivots.
  private figure: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Graphics;
  // The head as its own Graphics, so it can rotate about the neck (real
  // headTilt / nod) instead of the whole figure bouncing. Currently peeled out
  // for the FRONT facing only (drawn on top of `body`, pivoted at the neck);
  // profile / back / seated still draw the head into `body`, so `head` is left
  // empty for them. Later PRs peel those too.
  private head: Phaser.GameObjects.Graphics;
  // The blazer/shirt/tie trunk as its own Graphics, layered above `body` (which
  // now carries only the legs/feet/outline and the arms) and below `head`. It
  // stays upright — never rotated — so the directional suit gradient always reads
  // top-lit; the legs in `body` can later swing on their own without skewing it.
  // Peeled for the FRONT facing only; other facings still paint the trunk into
  // `body`, so `torso` is left empty for them. Later PRs peel those too.
  private torso: Phaser.GameObjects.Graphics;
  // The resting (idle / walk) arms as their own Graphics, each drawn once in
  // shoulder-pivot-local coordinates (shoulder at the object origin) and placed
  // at the shoulder, so a later PR can swing them by rotating the object instead
  // of redrawing. `armNear` is the viewer's-left arm, `armFar` the right. Peeled
  // for the FRONT resting pose only; work poses (type/review/present) and the
  // wave still paint the arms into `body`, so these are left empty for them.
  private armNear: Phaser.GameObjects.Graphics;
  private armFar: Phaser.GameObjects.Graphics;
  private think: Phaser.GameObjects.Graphics;

  private facing: AvatarFacing = "down";
  private walking = false;
  private seated = false;
  private programState: AgentState = "idle";
  private animState: AnimationState = "idle_breathing";
  /**
   * The action this figure mimes while heads-down ("working"). Derived from the
   * agent's current task/skill by the scene; null falls back to typing so the
   * pose is always defined. Only refines the generic "working" state — explicit
   * program states (reviewing, presenting) still win.
   */
  private workPantomime: WorkPantomime | null = null;

  private walkPhase = 0;
  private workPhase = 0;
  // Thinking-dot clock, in ms — samples the engine's looping "think" clip.
  private thinkPhase = Math.random() * CLIPS.think.durationMs;
  // Keyframe-engine driven idle motion (breathing). Replaces the ad-hoc sine
  // bob with an eased, hand-authored clip (see lib/office/avatarAnim); seeded to
  // a random phase in the constructor so a room never breathes in unison.
  private animator = new AvatarAnimator("idleBreathe");
  // A transient one-shot gesture overlay (wave / nod / celebrate) the scene
  // triggers on workflow events. Additive over the idle breathing; cleared when
  // the clip finishes. Null when no reaction is playing.
  private gesture: AvatarAnimator | null = null;
  // Engine-driven continuous limb amount (−1..1), quantized. Drives the raised
  // presenting arm as real limb motion (see _drawFrontArms), redrawn only when
  // the quantized value changes so a floor of avatars stays cheap.
  private _limbAmt = 0;
  // Live wave state: while a `wave` one-shot plays on a front-facing figure the
  // near arm is drawn raised and oscillating (real limb motion). `_waving` gates
  // the raised-arm draw; raise/swing are the quantized engine channels.
  private _waving = false;
  private _waveRaise = 0;
  private _waveSwing = 0;
  private lastPoseKey = "";
  // Blink: staggered so a room of executives never blinks in unison.
  private blinkTimer = 1200 + Math.random() * 4200;
  private eyesClosed = false;

  constructor(scene: Phaser.Scene, x: number, y: number, spec: AvatarSpec, depth = 8) {
    this.scene = scene;
    this.spec = spec;
    // Desync the shared breathing loop so figures don't inhale in lockstep.
    this.animator.update(Math.random() * 4200);

    // Soft, layered ground shadow — three stacked ellipses fake a penumbra and
    // ground the figure in the 2.5D floor (deeper + slightly offset from the light).
    this.shadow = scene.add.graphics();
    this.shadow.fillStyle(0x000000, 0.14);
    this.shadow.fillEllipse(1.5, 16.5, 26, 9.5);
    this.shadow.fillStyle(0x000000, 0.22);
    this.shadow.fillEllipse(1, 16, 20, 7);
    this.shadow.fillStyle(0x000000, 0.32);
    this.shadow.fillEllipse(0.5, 16, 14, 4.6);

    // Presence rim light — a soft disc behind the figure. Neural-rendering
    // influence: ignites only while an agent is actively working.
    this.rim = scene.add.arc(0, 4, 20, 0, 360, false)
      .setFillStyle(spec.accent, 0.09)
      .setVisible(false);

    // Crisp aura ring — the AI-native "active" cue.
    this.aura = scene.add.arc(0, 6, 13, 0, 360, false)
      .setStrokeStyle(1.5, spec.accent, 0.85)
      .setFillStyle(spec.accent, 0.06)
      .setVisible(false);

    this.body = scene.add.graphics();
    // The head rides above the body and pivots at the neck (figure y ≈ −8).
    // Drawn in body-local coords shifted up by +8 so its local origin sits at
    // the neck, letting setRotation tilt the head about the neck.
    this.head = scene.add.graphics().setPosition(0, -8);
    // The trunk rides above the body (legs/arms) and below the head, upright at
    // the figure origin — never rotated, so its suit gradient stays top-lit.
    this.torso = scene.add.graphics();
    // The resting arms ride between the body (legs) and the trunk, each pinned at
    // its shoulder so it can later rotate off that pivot.
    this.armFar = scene.add.graphics().setPosition(6.4, -5);
    this.armNear = scene.add.graphics().setPosition(-6.4, -5);
    // Inner figure container — wraps the split limb objects. Whole-figure motion
    // is applied here so the limbs' local draw coordinates never move. Child
    // order is the paint order: body (legs/feet/outline) → arms → torso → head.
    this.figure = scene.add.container(0, 0, [
      this.body, this.armFar, this.armNear, this.torso, this.head,
    ]);

    // "Thinking" pulse — three dots floating above the head, ACE-style
    // presence cue shown only while analyzing.
    this.think = scene.add.graphics().setVisible(false).setPosition(0, -25);
    this.think.fillStyle(vivify(spec.accent), 0.95);
    this.think.fillCircle(-3, 0, 1.1);
    this.think.fillCircle(0, 0, 1.1);
    this.think.fillCircle(3, 0, 1.1);

    this.container = scene.add.container(x, y, [
      this.shadow, this.rim, this.aura, this.figure, this.think,
    ]);
    this.container.setDepth(depth);

    this._redraw();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y);
  }

  get x() { return this.container.x; }
  get y() { return this.container.y; }

  setFacing(facing: AvatarFacing) {
    if (this.facing !== facing) {
      this.facing = facing;
      this._redraw();
    }
  }

  setWalking(walking: boolean) {
    if (this.walking === walking) return;
    this.walking = walking;
    if (!walking) this.walkPhase = 0;
    this._resolveAnim();
    this._redraw();
  }

  /** Sit / stand. Seated is a stationary idle stance drawn behind a desk. */
  setSeated(seated: boolean) {
    if (this.seated === seated) return;
    this.seated = seated;
    if (seated) { this.walking = false; this.walkPhase = 0; }
    this._resolveAnim();
    this._redraw();
  }

  /** Program state drives the AI aura color, rim light, and work animation. */
  setState(state: AgentState) {
    if (this.programState === state) return;
    const prev = this.programState;
    this.programState = state;
    this._resolveAnim();
    this._applyAura();
    this._redraw();
    // Brief celebration pop on transition into "complete".
    if (state === "complete" && prev !== "complete") this._celebrate();
  }

  /**
   * Set the work pantomime this figure mimes while "working" — the on-floor
   * action that matches its current task/skill (typing a model, reviewing docs,
   * presenting to a room, analyzing a dashboard). Data-driven: the scene derives
   * it from the agent and passes it in. Re-resolves the pose immediately when the
   * figure is currently heads-down so a mid-task action change reads at once.
   */
  setWorkPantomime(pantomime: WorkPantomime | null) {
    if (this.workPantomime === pantomime) return;
    this.workPantomime = pantomime;
    if (this.programState === "working" && !this.walking && !this.seated) {
      this._resolveAnim();
      this._redraw();
    }
  }

  /** Make the figure clickable; the whole silhouette is the hit target. */
  setInteractive(onClick: () => void) {
    this.container.setSize(24, 44);
    this.container.setInteractive({ useHandCursor: true });
    this.container.on("pointerdown", onClick);
    this.container.on("pointerover", () => { this.figure.setAlpha(0.82); this.rim.setVisible(true); });
    this.container.on("pointerout", () => { this.figure.setAlpha(1); this._applyAura(); });
  }

  /** Per-frame animation: advance the walk/work cycle or breathe while idle. */
  update(delta: number) {
    const dt = delta / 1000;

    // Blinking — a small, discrete life cue. Runs while walking or idle (but
    // not under reduced motion). Redraws only on the open/close transition.
    if (!ExecutiveAvatar.reducedMotion) this._updateBlink(delta);

    if (this.walking) {
      this.walkPhase += dt * 9; // ~9 steps/sec
      const step = Math.floor(this.walkPhase) % 4;
      const key = this._poseKey(step, -1);
      if (key !== this.lastPoseKey) this._redraw();
      this.figure.setPosition(0, 0);
      return;
    }

    // Reduced-motion: hold the figure statically. The correct pose/state is
    // already drawn by _redraw(); we only suppress decorative looping motion
    // (breathing bob, typing keystrokes, thinking-dot pulse). The thinking
    // dots remain visible at a fixed alpha/scale.
    if (ExecutiveAvatar.reducedMotion) {
      this.figure.setPosition(0, 0);
      if (this.think.visible) this.think.setAlpha(0.9).setScale(1);
      return;
    }

    // Idle + work motion is keyframe-engine driven. The animator plays the clip
    // for the current activity (breathe when idle; a slow sway when presenting,
    // a page-bob when reviewing, a keystroke bob when typing) and cross-fades on
    // change. We apply its body-level channels — `breatheY` (vertical) and
    // `leanX` (horizontal sway) — as transforms; the discrete arm-pose redraw
    // below still animates the limbs. All transform-only, so no per-frame redraw.
    this.animator.play(this._activeClip());
    this.animator.update(delta);
    const s = this.animator.sample();
    let bodyY = s.breatheY ?? 0;
    const bodyX = s.leanX ?? 0;

    // Overlay a one-shot reaction gesture, if any. `celebrate` pops the whole
    // figure up via `bounce`; `nod` tilts the head via `headTilt`. Transform-only,
    // so it composes with breathing and never redraws.
    let gestureHeadTilt = 0;
    if (this.gesture) {
      const isWave = this.gesture.current === "wave";
      this.gesture.update(delta);
      const g = this.gesture.sample();
      bodyY += g.bounce ?? 0;
      gestureHeadTilt = g.headTilt ?? 0;
      // A `wave` on a front-facing figure raises and oscillates the near arm as
      // real limb motion. Quantize the raise/swing channels and redraw only on
      // change; other facings just get the additive bounce above.
      if (isWave && this.facing === "down") {
        const raise = Math.round((g.gestureRaise ?? 0) / 0.15) * 0.15;
        const sw = Math.round((g.armSwing ?? 0) / 0.15) * 0.15;
        if (!this._waving || raise !== this._waveRaise || sw !== this._waveSwing) {
          this._waving = true;
          this._waveRaise = raise;
          this._waveSwing = sw;
          this._redraw();
        }
      }
      if (this.gesture.isFinished()) {
        this.gesture = null;
        if (this._waving) {
          // Wave over — drop the raised arm and redraw the resting pose once.
          this._waving = false;
          this._waveRaise = 0;
          this._waveSwing = 0;
          this._redraw();
        }
      }
    }

    // Head tilt — the review clip's gentle sway (`s.headTilt`) plus any nod
    // gesture. A front-facing figure has its head peeled into a separate object,
    // so we rotate it for real about the neck pivot; every other facing draws the
    // head into `body`, so the tilt reads as a small additive dip instead.
    const headTiltDeg = (s.headTilt ?? 0) + gestureHeadTilt;
    if (this.facing === "down") {
      this.head.setRotation((headTiltDeg * Math.PI) / 180);
    } else {
      this.head.setRotation(0);
      bodyY += headTiltDeg * 0.16;
    }

    this.figure.setPosition(bodyX, bodyY);

    // Redraw-based work gestures advance a discrete step: brisk keystrokes for
    // typing, a slower sway for presenting, a gentle page-bob for reviewing —
    // so a working executive keeps moving instead of freezing in one pose.
    const rate = this._gestureRate();
    if (rate > 0) {
      if (this.animState === "presenting") {
        // Presenting drives the raised arm continuously from the engine's
        // armSwing channel (real limb motion). Quantize to 0.2 steps and redraw
        // only when it changes, so the hand sways smoothly but stays cheap.
        const target = Math.round(((s.armSwing ?? 0) * 4) / 0.2) * 0.2;
        if (target !== this._limbAmt) {
          this._limbAmt = target;
          this._redraw();
        }
      } else {
        // Typing / reviewing keep their discrete keystroke / page-bob beat.
        this.workPhase += dt * rate;
        const wstep = Math.floor(this.workPhase) % 2;
        const key = this._poseKey(-1, wstep);
        if (key !== this.lastPoseKey) this._redraw();
      }
    }

    // "Thinking" pulse while analyzing — transform-only on the dots, driven by
    // the engine's eased "think" clip instead of a raw sine.
    if (this.think.visible) {
      this.thinkPhase += delta;
      const p = sampleClip(CLIPS.think, this.thinkPhase).thinkPulse ?? 0; // 0..1
      this.think.setAlpha(0.35 + p * 0.6).setScale(0.8 + p * 0.35);
    }
  }

  /**
   * A quick acknowledgment "nod" — a scale pop used when the figure is
   * clicked/addressed, so the executive visibly registers the interaction.
   * Scale is safe: the scene drives position/depth each frame but never scale.
   */
  /**
   * Play a one-shot reaction gesture (wave / nod / celebrate) driven by the
   * keyframe engine — the office's "avatars react to real work" cue. Additive
   * over idle breathing (a vertical bounce/dip), so it never disturbs the pose
   * or the walk cycle. Suppressed under reduced motion.
   */
  playGesture(name: AvatarGesture) {
    if (ExecutiveAvatar.reducedMotion) return;
    this.gesture = new AvatarAnimator(name);
  }

  react() {
    if (ExecutiveAvatar.reducedMotion) return;
    this.scene.tweens.killTweensOf(this.container);
    this.container.setScale(1);
    this.scene.tweens.add({
      targets: this.container, scaleX: 1.13, scaleY: 1.13,
      duration: 130, yoyo: true, ease: "Back.easeOut",
    });
    // A standing, front-facing executive waves back when addressed — a visible
    // greeting, real limb motion via the wave clip. Skipped while walking,
    // seated, or facing away (no near arm to raise), and for the coin mascot.
    if (!this.walking && !this.seated && !this.spec.coin && this.facing === "down") {
      this.playGesture("wave");
    }
  }

  /** Advance the blink timer; toggle the eyes and redraw on transition. */
  private _updateBlink(delta: number) {
    this.blinkTimer -= delta;
    if (this.blinkTimer > 0) return;
    if (!this.eyesClosed) {
      this.eyesClosed = true;
      this.blinkTimer = 120;              // eyes shut briefly
    } else {
      this.eyesClosed = false;
      this.blinkTimer = 2600 + Math.random() * 4200; // next blink
    }
    this._redraw();
  }

  destroy() {
    this.scene.tweens.killTweensOf(this.aura);
    this.scene.tweens.killTweensOf(this.rim);
    this.scene.tweens.killTweensOf(this.container);
    this.container.destroy(true);
  }

  // ── Animation resolution ────────────────────────────────────────────────────

  /** Map program state → a visual animation state. */
  private _resolveAnim() {
    if (this.seated) { this.animState = "idle_breathing"; this.think.setVisible(false); return; }
    if (this.walking) { this.animState = "walking"; return; }
    switch (this.programState) {
      case "working":              this.animState = this.workPantomime ?? "typing"; break;
      case "reviewing":            this.animState = "reviewing_docs"; break;
      case "collaborating":        this.animState = "presenting"; break;
      case "classifying":
      case "listening":            this.animState = "analyzing_model"; break;
      case "waiting_for_approval": this.animState = "waiting"; break;
      case "complete":             this.animState = "celebrating_complete"; break;
      default:                     this.animState = "idle_breathing"; break;
    }
    // The thinking indicator belongs to analysis only.
    this.think.setVisible(this.animState === "analyzing_model");
  }

  private _armMode(): ArmMode {
    if (this.walking) return "walk";
    switch (this.animState) {
      case "typing":          return "type";
      case "reviewing_docs":  return "review";
      case "presenting":      return "present";
      default:                return "idle";
    }
  }

  /**
   * The keyframe clip whose body-level channels (breatheY / leanX) drive the
   * figure right now: a presenting sway, a reviewing page-bob, a typing bob, or
   * the calm idle breathe. Limb poses still come from the arm-mode redraw; this
   * only shapes the transform-level motion the animator plays.
   */
  private _activeClip(): ClipName {
    switch (this._armMode()) {
      case "present": return "present";
      case "type":    return "type";
      case "review":  return "review";
      default:        return "idleBreathe";
    }
  }

  /** Whether the carried role prop should be visible right now. */
  private _showProp(): boolean {
    if (this.walking) return false;
    if (!this.spec.prop || this.spec.prop === "none") return false;
    return (
      this.animState === "typing" ||
      this.animState === "reviewing_docs" ||
      this.animState === "presenting" ||
      this.animState === "analyzing_model" ||
      this.animState === "waiting"
    );
  }

  /** One-shot celebration: a quick upward pop when work completes. */
  private _celebrate() {
    this.scene.tweens.add({
      targets: this.container, scaleX: 1.08, scaleY: 1.08,
      duration: 160, yoyo: true, ease: "Back.easeOut",
    });
  }

  // ── Aura + rim (AI-native cues) ─────────────────────────────────────────────

  private _applyAura() {
    const colors: Partial<Record<AgentState, number>> = {
      classifying: 0xfbbf24,
      listening: 0xfbbf24,
      assigned: 0xc9a84c,
      moving: 0xc9a84c,
      working: 0x38bdf8,
      collaborating: 0x38bdf8,
      reviewing: 0xa855f7,
      waiting_for_approval: 0xf59e0b,
      complete: 0x22c55e,
      blocked: 0xef4444,
    };
    this.scene.tweens.killTweensOf(this.aura);
    this.scene.tweens.killTweensOf(this.rim);
    const color = colors[this.programState];
    if (!color) {
      this.aura.setVisible(false);
      this.rim.setVisible(false);
      return;
    }
    // Push the state color to a punchier, higher-saturation hue so the AI-native
    // cue reads bold and vivid — matching the figures and the room accents.
    const vivColor = vivify(color);
    this.aura.setVisible(true);
    this.aura.setStrokeStyle(1.75, vivColor, 0.92);
    this.aura.setFillStyle(vivColor, 0.09);
    this.aura.setScale(1).setAlpha(1);

    // Presence rim light — soft disc that glows under working agents.
    this.rim.setVisible(true);
    this.rim.setFillStyle(vivColor, 0.13).setScale(1).setAlpha(1);

    const pulses =
      !ExecutiveAvatar.reducedMotion &&
      (this.programState === "working" ||
        this.programState === "classifying" ||
        this.programState === "collaborating" ||
        this.programState === "waiting_for_approval");
    if (pulses) {
      this.scene.tweens.add({
        targets: this.aura, scale: 1.24, alpha: 0.5,
        duration: 850, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
      this.scene.tweens.add({
        targets: this.rim, scale: 1.18, alpha: 0.55,
        duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
    }
  }

  // ── Figure drawing ──────────────────────────────────────────────────────────

  private _poseKey(step: number, workStep: number): string {
    return `${this.facing}:w${step}:k${workStep}:${this.animState}:${this.seated ? "S" : "_"}:${this.spec.kind}`;
  }

  /** Redraw rate for the current gesture (0 = no redraw-based gesture). */
  private _gestureRate(): number {
    switch (this.animState) {
      case "typing":         return 5.5; // brisk keystrokes
      case "presenting":     return 1.8; // slow speaking sway
      case "reviewing_docs": return 1.4; // gentle page bob
      default:               return 0;
    }
  }

  private _redraw() {
    const step = this.walking ? Math.floor(this.walkPhase) % 4 : -1;
    const workStep = this._gestureRate() > 0 ? Math.floor(this.workPhase) % 2 : -1;
    this.lastPoseKey = this._poseKey(step, workStep);
    const g = this.body;
    g.clear();
    // The head and trunk are separate objects peeled out for front facing (the
    // head so it can rotate about the neck; the trunk so it stays upright above
    // the moving legs). Cleared every redraw; only the front branch fills them,
    // so every other facing/pose leaves them empty and paints into `body`.
    this.head.clear();
    this.torso.clear();
    this.armNear.clear();
    this.armFar.clear();

    // Earn renders as the gold-coin mascot — its own full pose set.
    if (this.spec.coin) { this._redrawCoin(g, step); return; }

    if (this.seated) {
      if (this.facing === "up") this._drawSeatedBack(g, this.spec);
      else this._drawSeated(g, this.spec);
      return;
    }

    // Walk-cycle limb offsets (discrete 4-frame swing). step -1 = idle.
    const swing = step === -1 ? 0 : [3, 0, -3, 0][step];
    const s = this.spec;
    const arm = this._armMode();

    if (this.facing === "up") this._drawBack(g, s, swing);
    else if (this.facing === "left") this._drawProfile(g, s, swing, -1, arm, workStep);
    else if (this.facing === "right") this._drawProfile(g, s, swing, 1, arm, workStep);
    else {
      this._drawFront(g, s, swing, arm, workStep);
      // Resting (idle / walk) arms are peeled into shoulder-pivoted objects; the
      // walk swing rides as a vertical offset (armNear +, armFar −), matching the
      // old inline arms. Work poses (type/review/present) and the wave keep their
      // arms in `body`, so the objects stay empty for those.
      if (!this._waving && (arm === "idle" || arm === "walk")) {
        this._drawFrontRestArms(s);
        this.armNear.setPosition(-6.4, -5 + swing * 0.4).setRotation(0);
        this.armFar.setPosition(6.4, -5 - swing * 0.4).setRotation(0);
      }
      this._drawFrontTorso(this.torso, s);
      this._drawHead(this.head, s, 0, 8);
    }

    // Carried prop sits above the trunk. For the front facing the trunk is its
    // own object, so paint the prop into it (above the blazer, below the head);
    // every other facing still draws the prop into `body` as before.
    if (this._showProp()) this._drawProp(this.facing === "down" ? this.torso : g, s);
  }

  /** Shoulder half-width for the torso top, by build. */
  private _shoulder(s: AvatarSpec): number {
    switch (s.build) {
      case "slim":  return 6.2;
      case "broad": return 8;
      default:      return 7;
    }
  }

  /**
   * Seated stance (facing the viewer). The desk drawn in front occludes the
   * lap, so we draw a short seated base, hands resting toward the desk, the
   * gradient blazer, and the full head — head and shoulders read above the
   * desk while the legs stay hidden behind it.
   */
  private _drawSeated(g: Phaser.GameObjects.Graphics, s: AvatarSpec) {
    const sw = this._shoulder(s);

    // Short seated thighs (mostly hidden by the desk in front).
    g.fillStyle(this._shade(s.trouser, 0.92), 1);
    g.fillRoundedRect(-4.4, 4, 3.8, 8, 1.6);
    g.fillRoundedRect(0.6, 4, 3.8, 8, 1.6);

    // Forearms resting toward the desk, hands just ahead of the lap.
    g.fillStyle(s.suit, 1);
    g.fillRoundedRect(-7.4, -4, 3, 9, 1.5);
    g.fillRoundedRect(4.4, -4, 3, 9, 1.5);
    g.fillStyle(s.skin, 1);
    g.fillCircle(-4.6, 4.5, 1.7);
    g.fillCircle(4.6, 4.5, 1.7);

    // Torso — gradient blazer (same directional light as the standing pose).
    const suitHi = this._shade(s.suit, 1.35);
    const suitMid = this._shade(s.suit, 1.08);
    const suitLo = this._shade(s.suit, 0.7);
    g.fillGradientStyle(suitHi, suitMid, suitLo, this._shade(s.suit, 0.85), 1);
    g.fillPoints([
      new Phaser.Geom.Point(-sw, -6), new Phaser.Geom.Point(sw, -6),
      new Phaser.Geom.Point(5.5, 7), new Phaser.Geom.Point(-5.5, 7),
    ], true);
    // Shirt V + collar + tie.
    g.fillStyle(this._shade(s.shirt, 1.02), 1);
    g.fillTriangle(-2.6, -6, 2.6, -6, 0, 2.5);
    g.fillStyle(this._shade(s.suit, 0.8), 1);
    g.fillTriangle(-3.2, -6, -0.4, -6, -2.2, 1);
    g.fillTriangle(3.2, -6, 0.4, -6, 2.2, 1);
    g.fillStyle(s.accent, 1);
    g.fillTriangle(-1.1, -5, 1.1, -5, 0, 4);
    g.fillStyle(this._shade(s.accent, 1.15), 1);
    g.fillTriangle(-1.3, -5.2, 1.3, -5.2, 0, -3);

    this._drawHead(g, s, 0, 0);
  }

  /**
   * Seated stance seen from behind (facing "up"). Used for the near side of a
   * conference table, where the table sits behind the occupant — so we draw
   * short seated hips, the blazer back, and the back of the head.
   */
  private _drawSeatedBack(g: Phaser.GameObjects.Graphics, s: AvatarSpec) {
    const sw = this._shoulder(s);

    // Seated hips / upper thighs.
    g.fillStyle(this._shade(s.trouser, 0.9), 1);
    g.fillRoundedRect(-4.4, 4, 3.8, 9, 1.6);
    g.fillRoundedRect(0.6, 4, 3.8, 9, 1.6);

    // Arms at the sides.
    g.fillStyle(this._shade(s.suit, 0.9), 1);
    g.fillRoundedRect(-7.2, -4, 3, 10, 1.5);
    g.fillRoundedRect(4.2, -4, 3, 10, 1.5);

    // Blazer back — vertical gradient with a center seam and collar.
    const bHi = this._shade(s.suit, 1.24);
    const bLo = this._shade(s.suit, 0.74);
    g.fillGradientStyle(bHi, bHi, bLo, bLo, 1);
    g.fillPoints([
      new Phaser.Geom.Point(-sw, -6), new Phaser.Geom.Point(sw, -6),
      new Phaser.Geom.Point(5.5, 7), new Phaser.Geom.Point(-5.5, 7),
    ], true);
    g.lineStyle(0.6, this._shade(s.suit, 0.8), 0.8);
    g.beginPath(); g.moveTo(0, -6); g.lineTo(0, 7); g.strokePath();
    g.fillStyle(this._shade(s.suit, 0.85), 1);
    g.fillRect(-3.5, -6.5, 7, 1.6); // collar

    // Neck + back of the head (no face).
    g.fillStyle(this._shade(s.skin, 0.9), 1);
    g.fillRect(-1.7, -9, 3.4, 3.2);
    if (s.hairStyle === "bald") {
      g.fillStyle(s.skin, 1);
      g.fillEllipse(0, -13, 9.5, 11);
    } else {
      g.fillStyle(s.hair, 1);
      g.fillEllipse(0, -13, 9.5, 11);
      if (s.hairStyle === "tied") g.fillCircle(0, -18.4, 2.1);
      g.fillStyle(this._shade(s.hair, 1.2), 0.4);
      g.fillEllipse(-2, -15.5, 3.4, 2);
    }
  }

  /** Front view (facing down / toward the viewer). */
  private _drawFront(g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number, arm: ArmMode, workStep: number) {
    const sw = this._shoulder(s);

    // Bold outline — a crisp dark silhouette behind the figure for a sharp,
    // premium read (torso, head, legs, shoes; arms omitted so work poses stay
    // clean). Drawn first so the colored fills leave a thin rim.
    g.fillStyle(OUTLINE, 1);
    g.fillRect(-5.05, 5.4 - Math.max(0, swing), 4.1, 10.2 + Math.abs(swing) * 0.4);
    g.fillRect(0.45, 5.4 - Math.max(0, -swing), 4.1, 10.2 + Math.abs(swing) * 0.4);
    g.fillEllipse(-2.7, 15 - Math.max(0, swing), 5.4, 3.2);
    g.fillEllipse(2.7, 15 - Math.max(0, -swing), 5.4, 3.2);
    g.fillPoints([
      new Phaser.Geom.Point(-sw - 0.85, -6.7), new Phaser.Geom.Point(sw + 0.85, -6.7),
      new Phaser.Geom.Point(6.35, 7.6), new Phaser.Geom.Point(-6.35, 7.6),
    ], true);
    g.fillEllipse(0, -13, 11, 12.5);

    // Legs — soft vertical gradient (lit at the thigh, shaded at the cuff).
    const legHi = this._shade(s.trouser, 1.18);
    const legLo = this._shade(s.trouser, 0.82);
    g.fillGradientStyle(legHi, legHi, legLo, legLo, 1);
    g.fillRect(-4.5, 6 - Math.max(0, swing), 3.5, 9 + Math.abs(swing) * 0.4);
    g.fillRect(1, 6 - Math.max(0, -swing), 3.5, 9 + Math.abs(swing) * 0.4);
    // Inseam shadow between the legs — a defined trouser break.
    g.fillStyle(this._shade(s.trouser, 0.55), 0.7);
    g.fillRect(-0.4, 6.5, 0.8, 8);
    // Shoes — dark leather with a specular toe highlight.
    g.fillStyle(0x14110d, 1);
    g.fillEllipse(-2.7, 15 - Math.max(0, swing), 4.4, 2.4);
    g.fillEllipse(2.7, 15 - Math.max(0, -swing), 4.4, 2.4);
    g.fillStyle(0x3c362c, 0.9);
    g.fillEllipse(-3.3, 14.5 - Math.max(0, swing), 1.7, 0.9);
    g.fillEllipse(2.1, 14.5 - Math.max(0, -swing), 1.7, 0.9);

    // Arms — pose depends on the work animation. Resting (idle/walk) arms are
    // peeled into their own objects (see _redraw); this paints only the work and
    // wave poses into the body.
    this._drawFrontArms(g, s, arm, workStep);

    // Torso (blazer/shirt/tie) is drawn into the separate upright `torso` object
    // (see _redraw), layered above these arms — not painted into the body here.

    // Head is drawn into the separate `head` object (see _redraw) so it can
    // rotate about the neck — not painted into the body here.
  }

  /**
   * The front trunk — tapered blazer, shirt V, lapels, buttons, pocket square,
   * and tie. Painted into its own upright `torso` object (never rotated) so the
   * directional suit gradient stays top-lit while the legs/arms in `body` move.
   * Static geometry: depends only on the spec, so it's drawn once per redraw.
   */
  private _drawFrontTorso(g: Phaser.GameObjects.Graphics, s: AvatarSpec) {
    const sw = this._shoulder(s);
    const acc = vivify(s.accent);

    // Torso — tapered blazer with a directional gradient (lit upper-left →
    // deeper waist) for real volume.
    const suitHi = this._shade(s.suit, 1.35);
    const suitMid = this._shade(s.suit, 1.08);
    const suitLo = this._shade(s.suit, 0.7);
    g.fillGradientStyle(suitHi, suitMid, suitLo, this._shade(s.suit, 0.85), 1);
    g.fillPoints([
      new Phaser.Geom.Point(-sw, -6), new Phaser.Geom.Point(sw, -6),
      new Phaser.Geom.Point(5.5, 7), new Phaser.Geom.Point(-5.5, 7),
    ], true);
    // Shoulder-seam highlight across the top of the blazer — a defined shoulder line.
    g.lineStyle(0.5, this._shade(s.suit, 1.5), 0.6);
    g.beginPath(); g.moveTo(-sw + 0.6, -5.6); g.lineTo(sw - 0.6, -5.6); g.strokePath();
    // Waist ambient occlusion for a grounded torso.
    g.fillStyle(this._shade(s.suit, 0.55), 0.3);
    g.fillTriangle(-5.5, 7, 5.5, 7, 0, 2.5);

    // Shirt V with a soft chest gradient.
    const shHi = this._shade(s.shirt, 1.06);
    const shLo = this._shade(s.shirt, 0.82);
    g.fillGradientStyle(shHi, shHi, shLo, shLo, 1);
    g.fillTriangle(-2.6, -6, 2.6, -6, 0, 2.5);
    // Collar edges
    g.fillStyle(this._shade(s.shirt, 0.86), 1);
    g.fillTriangle(-2.6, -6, -1.2, -6, -1.9, -2.6);
    g.fillTriangle(2.6, -6, 1.2, -6, 1.9, -2.6);
    // Lapels — shaded plane + a lit outer edge.
    g.fillStyle(this._shade(s.suit, 0.8), 1);
    g.fillTriangle(-3.2, -6, -0.4, -6, -2.2, 1);
    g.fillTriangle(3.2, -6, 0.4, -6, 2.2, 1);
    // Defined lapel notch — a dark seam with a crisp lit outer edge alongside it.
    g.lineStyle(0.7, OUTLINE, 0.55);
    g.beginPath(); g.moveTo(-3.2, -6); g.lineTo(-2.2, 1); g.strokePath();
    g.beginPath(); g.moveTo(3.2, -6); g.lineTo(2.2, 1); g.strokePath();
    g.lineStyle(0.4, this._shade(s.suit, 1.5), 0.8);
    g.beginPath(); g.moveTo(-3.0, -5.6); g.lineTo(-2.1, 0.6); g.strokePath();
    g.beginPath(); g.moveTo(3.0, -5.6); g.lineTo(2.1, 0.6); g.strokePath();
    // Breast-pocket welt above the pocket square — a crisp tailored seam.
    g.lineStyle(0.5, this._shade(s.suit, 0.55), 0.85);
    g.beginPath(); g.moveTo(-4.9, -2.7); g.lineTo(-3.0, -2.7); g.strokePath();
    // Blazer buttons down the center closure, below the tie tip.
    g.fillStyle(this._shade(s.suit, 0.45), 1);
    g.fillCircle(0, 5.0, 0.5); g.fillCircle(0, 6.4, 0.46);
    g.fillStyle(this._shade(s.suit, 1.5), 0.6);
    g.fillCircle(-0.16, 4.85, 0.18); g.fillCircle(-0.15, 6.26, 0.16);
    // Pocket square — a small folded accent on the left chest (vivid accent).
    g.fillStyle(this._shade(acc, 1.1), 0.98);
    g.fillTriangle(-4.6, -2.2, -3.2, -2.2, -3.9, -3.6);
    // Tie with a knot and a highlighted center ridge (vivid accent).
    g.fillStyle(acc, 1);
    g.fillTriangle(-1.1, -5, 1.1, -5, 0, 4);
    g.fillStyle(this._shade(acc, 1.3), 0.85);
    g.fillTriangle(-0.4, -4.6, 0.4, -4.6, 0, 3.4);
    g.fillStyle(this._shade(acc, 1.18), 1);
    g.fillTriangle(-1.3, -5.2, 1.3, -5.2, 0, -3);
  }

  /** Front-view arm variants keyed to the work animation. */
  private _drawFrontArms(g: Phaser.GameObjects.Graphics, s: AvatarSpec, arm: ArmMode, workStep: number) {
    const sleeve = s.suit;
    if (arm === "type") {
      // Forearms angled to a desk; hands bob with the keystroke step.
      const kb = workStep === 0 ? 0 : 0.9;
      g.fillStyle(sleeve, 1);
      g.fillRoundedRect(-7.6, -4, 3, 8, 1.5);
      g.fillRoundedRect(4.6, -4, 3, 8, 1.5);
      g.fillStyle(s.skin, 1);
      g.fillCircle(-4.6, 5 + kb, 1.7);
      g.fillCircle(4.6, 5 + (0.9 - kb), 1.7);
      return;
    }
    if (arm === "review") {
      // Both hands raised in front, holding a document; a gentle page bob.
      const rb = workStep === 1 ? 0.8 : 0;
      g.fillStyle(sleeve, 1);
      g.fillRoundedRect(-7.4, -4.5, 3, 7, 1.5);
      g.fillRoundedRect(4.4, -4.5, 3, 7, 1.5);
      g.fillStyle(s.skin, 1);
      g.fillCircle(-3.4, 1.5 + rb, 1.6);
      g.fillCircle(3.4, 1.5 + rb, 1.6);
      return;
    }
    if (arm === "present") {
      // One arm raised outward, swaying with the point being made. The raised
      // hand's height tracks the engine's armSwing channel (`_limbAmt`, −1..1)
      // continuously — real limb motion, eased — instead of a discrete beat.
      const ph = this._limbAmt * -1.6;
      g.fillStyle(sleeve, 1);
      g.fillRoundedRect(-8.4, -6.5 + ph * 0.5, 3, 8, 1.5); // raised
      g.fillRoundedRect(4.8, -5, 3.2, 11, 1.6);
      g.fillStyle(s.skin, 1);
      g.fillCircle(-8.6, -7 + ph, 1.7);
      g.fillCircle(6.4, 6, 1.7);
      return;
    }
    // Waving — the near (left) arm lifts beside the head and the hand
    // oscillates, driven by the engine's gestureRaise (lift) + armSwing (wave).
    if (this._waving) {
      const r = this._waveRaise;
      const w = this._waveSwing;
      const handX = -8.5 + w * 1.8;
      const handY = -6 - r * 13;
      g.fillStyle(sleeve, 1);
      g.fillRoundedRect(-8.4, -6, 3, 6, 1.5); // upper arm rising from the shoulder
      g.fillRoundedRect(handX - 1.5, handY, 3, 9 + r * 3, 1.5); // forearm up to the hand
      g.fillStyle(this._shade(s.suit, 0.6), 0.8);
      g.fillRect(handX - 1.4, handY, 0.7, 8); // inner-sleeve seam
      g.fillStyle(s.skin, 1);
      g.fillCircle(handX, handY - 1, 1.9); // waving hand
      // Far (right) arm rests at the side.
      g.fillStyle(sleeve, 1);
      g.fillRoundedRect(4.8, -5, 3.2, 11, 1.6);
      g.fillStyle(this._shade(s.suit, 0.6), 0.8);
      g.fillRect(4.6, -4.5, 0.8, 10);
      g.fillStyle(s.skin, 1);
      g.fillCircle(6.4, 6, 1.7);
      g.fillStyle(this._shade(s.shirt, 1.02), 0.95);
      g.fillRect(4.8, 4.4, 3.2, 0.9);
      return;
    }

    // Walk / idle resting arms are peeled into their own shoulder-pivoted objects
    // (see _drawFrontRestArms / _redraw), so nothing is painted into `body` here.
  }

  /**
   * The resting (idle / walk) front arms, each painted once into its own object
   * in shoulder-pivot-local coordinates — the shoulder sits at the object origin,
   * the arm hangs straight down (+y). `_redraw` pins each object at its shoulder
   * (armNear at the viewer's-left, armFar at the right) and applies the walk
   * swing as a vertical offset; at rotation 0 and that offset the result is
   * pixel-identical to the previous inline arms. Drawing at the shoulder pivot
   * lets a later PR swing the arm with a single setRotation.
   */
  private _drawFrontRestArms(s: AvatarSpec) {
    const sleeve = s.suit;
    const seam = this._shade(s.suit, 0.6);
    const cuff = this._shade(s.shirt, 1.02);
    const btn = this._shade(s.suit, 0.45);
    // Near (viewer's-left) arm — inner seam on its right edge (toward the body).
    const n = this.armNear;
    n.fillStyle(sleeve, 1); n.fillRoundedRect(-1.6, 0, 3.2, 11, 1.6);
    n.fillStyle(seam, 0.8); n.fillRect(1.3, 0.5, 0.8, 10);
    n.fillStyle(s.skin, 1); n.fillCircle(0, 11, 1.7);
    n.fillStyle(cuff, 0.95); n.fillRect(-1.6, 9.4, 3.2, 0.9);
    n.fillStyle(btn, 1); n.fillCircle(0, 10.5, 0.33);
    // Far (right) arm — inner seam on its left edge.
    const f = this.armFar;
    f.fillStyle(sleeve, 1); f.fillRoundedRect(-1.6, 0, 3.2, 11, 1.6);
    f.fillStyle(seam, 0.8); f.fillRect(-1.8, 0.5, 0.8, 10);
    f.fillStyle(s.skin, 1); f.fillCircle(0, 11, 1.7);
    f.fillStyle(cuff, 0.95); f.fillRect(-1.6, 9.4, 3.2, 0.9);
    f.fillStyle(btn, 1); f.fillCircle(0, 10.5, 0.33);
  }

  /** Shared head/hair/face block, offset by (ox, oy). */
  private _drawHead(g: Phaser.GameObjects.Graphics, s: AvatarSpec, ox: number, oy: number) {
    const skinLo = this._shade(s.skin, 0.82);
    const iris = 0x4a3524;
    // Neck + a soft jaw occlusion (feathered, not a hard band).
    g.fillStyle(this._shade(s.skin, 0.9), 1);
    g.fillRect(ox - 1.9, oy - 9.2, 3.8, 3.8);
    g.fillStyle(skinLo, 0.4);
    g.fillEllipse(ox, oy - 8.8, 4.2, 1.6);
    // Ears with a subtle inner shadow.
    g.fillStyle(this._shade(s.skin, 0.95), 1);
    g.fillEllipse(ox - 4.6, oy - 12.6, 1.9, 3.1);
    g.fillEllipse(ox + 4.6, oy - 12.6, 1.9, 3.1);
    g.fillStyle(this._shade(s.skin, 0.7), 0.4);
    g.fillEllipse(ox - 4.6, oy - 12.4, 0.9, 1.8);
    g.fillEllipse(ox + 4.6, oy - 12.4, 0.9, 1.8);
    // Head base — slightly narrower/taller for a natural face; soft contour behind.
    g.fillStyle(this._shade(s.skin, 0.62), 0.85);
    g.fillEllipse(ox, oy - 12.7, 9.6, 12.0);
    g.fillStyle(s.skin, 1);
    g.fillEllipse(ox, oy - 13, 9.0, 11.4);
    // Soft top-lit forehead + gentle, feathered jaw/cheek volume (low alpha).
    g.fillStyle(this._shade(s.skin, 1.1), 0.4);
    g.fillEllipse(ox - 0.6, oy - 15.6, 6.2, 4.6);
    g.fillStyle(skinLo, 0.34);
    g.fillEllipse(ox, oy - 9.8, 6.6, 3.6);
    g.fillStyle(this._shade(s.skin, 0.76), 0.28);
    g.fillEllipse(ox + 3.0, oy - 12.2, 2.8, 5.2); // shaded (right) cheek plane
    g.fillStyle(this._shade(s.skin, 1.14), 0.26);
    g.fillEllipse(ox - 2.9, oy - 12.4, 3.0, 4.6); // lit (left) cheek plane
    // Cheekbone catch — subtle, not a hard smudge.
    g.fillStyle(this._shade(s.skin, 1.12), 0.22);
    g.fillEllipse(ox - 2.4, oy - 11.4, 1.8, 1.2);
    // Hair
    if (s.hairStyle !== "bald") {
      g.fillStyle(this._shade(s.hair, 0.5), 1);
      g.fillEllipse(ox, oy - 16.1, 10.6, 8.0);
      g.fillStyle(s.hair, 1);
      g.fillEllipse(ox, oy - 15.8, 9.8, 7.2);
      g.fillRect(ox - 4.9, oy - 15.8, 9.8, 2.6);
      // Sideburns framing the face.
      g.fillEllipse(ox - 4.4, oy - 15, 1.5, 3.2);
      g.fillEllipse(ox + 4.4, oy - 15, 1.5, 3.2);
      if (s.hairStyle === "textured") {
        g.fillStyle(this._shade(s.hair, 1.4), 0.42);
        g.fillEllipse(ox - 2.4, oy - 17.4, 4.2, 2.2);
        g.fillStyle(this._shade(s.hair, 1.4), 0.42);
        g.fillEllipse(ox + 1.6, oy - 17.8, 2.6, 1.6);
        g.fillStyle(this._shade(s.hair, 0.7), 0.35);
        g.fillEllipse(ox + 2.8, oy - 15.8, 2.8, 2.0);
      } else if (s.hairStyle === "tied") {
        g.fillStyle(s.hair, 1);
        g.fillCircle(ox, oy - 18.8, 2.2); // top knot
        g.fillStyle(this._shade(s.hair, 1.35), 0.42);
        g.fillEllipse(ox - 1.6, oy - 17.6, 3, 1.5);
      } else {
        g.fillStyle(this._shade(s.hair, 1.42), 0.5); // sheen
        g.fillEllipse(ox - 2.2, oy - 17.6, 4.0, 1.8);
      }
      // Clean, soft hairline arc (no hard band).
      g.fillStyle(this._shade(s.hair, 0.55), 0.4);
      g.fillEllipse(ox, oy - 16.3, 8.4, 1.4);
    }
    const EX = 1.75;
    const eyeY = oy - 12.55;
    // Brows — thin, tapered, angled along the brow ridge (not floating bars).
    g.fillStyle(this._shade(s.hair, 0.68), 0.95);
    g.fillPoints(
      [
        { x: ox - 3.3, y: oy - 13.35 },
        { x: ox - 0.85, y: oy - 13.95 },
        { x: ox - 0.85, y: oy - 13.62 },
        { x: ox - 3.3, y: oy - 13.02 },
      ],
      true,
    );
    g.fillPoints(
      [
        { x: ox + 3.3, y: oy - 13.35 },
        { x: ox + 0.85, y: oy - 13.95 },
        { x: ox + 0.85, y: oy - 13.62 },
        { x: ox + 3.3, y: oy - 13.02 },
      ],
      true,
    );
    // Eyes — smaller/closer almond, iris+pupil, lids, tear-trough, catchlight;
    // or a thin closed line while blinking.
    if (this.eyesClosed) {
      g.fillStyle(this._shade(s.skin, 0.55), 0.9);
      g.fillRect(ox - EX - 0.8, eyeY - 0.05, 1.6, 0.55);
      g.fillRect(ox + EX - 0.8, eyeY - 0.05, 1.6, 0.55);
    } else {
      g.fillStyle(this._shade(s.skin, 0.78), 0.22);
      g.fillEllipse(ox - EX, eyeY - 0.7, 2.0, 0.8);
      g.fillEllipse(ox + EX, eyeY - 0.7, 2.0, 0.8);
      g.fillStyle(this._shade(s.skin, 0.82), 0.18);
      g.fillEllipse(ox - EX, eyeY + 0.85, 1.7, 0.7);
      g.fillEllipse(ox + EX, eyeY + 0.85, 1.7, 0.7);
      g.fillStyle(0xece5d7, 1);
      g.fillEllipse(ox - EX, eyeY, 1.62, 0.94);
      g.fillEllipse(ox + EX, eyeY, 1.62, 0.94);
      g.fillStyle(iris, 1);
      g.fillCircle(ox - EX, eyeY + 0.05, 0.54);
      g.fillCircle(ox + EX, eyeY + 0.05, 0.54);
      g.fillStyle(this._shade(iris, 1.35), 0.5);
      g.fillCircle(ox - EX - 0.12, eyeY - 0.08, 0.3);
      g.fillCircle(ox + EX - 0.12, eyeY - 0.08, 0.3);
      g.fillStyle(0x120d0a, 1);
      g.fillCircle(ox - EX, eyeY + 0.05, 0.27);
      g.fillCircle(ox + EX, eyeY + 0.05, 0.27);
      g.fillStyle(0xfcf8f0, 0.92);
      g.fillCircle(ox - EX - 0.2, eyeY - 0.22, 0.17);
      g.fillCircle(ox + EX - 0.2, eyeY - 0.22, 0.17);
      g.lineStyle(0.5, 0x241c15, 0.9);
      g.beginPath();
      g.arc(ox - EX, eyeY - 0.06, 1.32, 1.02 * Math.PI, 1.98 * Math.PI, false);
      g.strokePath();
      g.beginPath();
      g.arc(ox + EX, eyeY - 0.06, 1.32, 1.02 * Math.PI, 1.98 * Math.PI, false);
      g.strokePath();
      g.lineStyle(0.32, this._shade(s.skin, 0.62), 0.5);
      g.beginPath();
      g.arc(ox - EX, eyeY + 0.12, 1.26, 0.08 * Math.PI, 0.92 * Math.PI, false);
      g.strokePath();
      g.beginPath();
      g.arc(ox + EX, eyeY + 0.12, 1.26, 0.08 * Math.PI, 0.92 * Math.PI, false);
      g.strokePath();
    }
    // Nose — bridge shadow down the shaded side, lit ridge, tip, wings/nostrils.
    g.fillStyle(this._shade(s.skin, 0.8), 0.34);
    g.fillEllipse(ox + 0.55, oy - 11.6, 0.72, 2.4);
    g.fillStyle(this._shade(s.skin, 1.12), 0.3);
    g.fillEllipse(ox - 0.5, oy - 11.4, 0.6, 2.0);
    g.fillStyle(this._shade(s.skin, 1.12), 0.34);
    g.fillEllipse(ox - 0.1, oy - 10.5, 0.95, 0.9);
    g.fillStyle(this._shade(s.skin, 0.7), 0.4);
    g.fillEllipse(ox - 0.05, oy - 10.15, 1.3, 0.55);
    g.fillStyle(this._shade(s.skin, 0.55), 0.55);
    g.fillEllipse(ox - 0.72, oy - 10.05, 0.4, 0.32);
    g.fillEllipse(ox + 0.72, oy - 10.05, 0.4, 0.32);
    // Lips — philtrum, upper/lower lip, seam, corner shadows.
    g.fillStyle(this._shade(s.skin, 0.72), 0.28);
    g.fillEllipse(ox, oy - 9.95, 0.42, 0.5);
    g.fillStyle(this._shade(s.skin, 0.8), 0.5);
    g.fillEllipse(ox, oy - 9.55, 2.5, 0.62);
    g.fillStyle(this._shade(s.skin, 1.14), 0.42);
    g.fillEllipse(ox, oy - 9.2, 1.9, 0.55);
    g.lineStyle(0.4, this._shade(s.skin, 0.5), 0.55);
    g.beginPath();
    g.arc(ox, oy - 9.9, 1.4, 0.12 * Math.PI, 0.88 * Math.PI, false);
    g.strokePath();
    g.fillStyle(this._shade(s.skin, 0.55), 0.4);
    g.fillEllipse(ox - 1.35, oy - 9.6, 0.4, 0.4);
    g.fillEllipse(ox + 1.35, oy - 9.6, 0.4, 0.4);
    // Facial hair — over the lower face (full beard sits over the lips).
    this._drawFacialHairFront(g, s, ox, oy);
    // Eyewear — drawn last so the frames sit over the eyes.
    this._drawGlassesFront(g, s, ox, oy);
  }

  /** Front-view facial hair over the lower face (stubble / mustache / beard). */
  private _drawFacialHairFront(g: Phaser.GameObjects.Graphics, s: AvatarSpec, ox: number, oy: number) {
    const fh = s.facialHair ?? "none";
    if (fh === "none") return;
    const hair = this._shade(s.hair, 0.92);
    if (fh === "stubble") {
      g.fillStyle(hair, 0.3);
      g.fillEllipse(ox, oy - 9.4, 8.4, 4.8);
    } else if (fh === "beard") {
      g.fillStyle(hair, 1);
      g.fillEllipse(ox, oy - 8.8, 8.4, 5.6);       // jaw + chin
      g.fillRect(ox - 4.6, oy - 13.4, 1.5, 4.6);   // left sideburn link
      g.fillRect(ox + 3.1, oy - 13.4, 1.5, 4.6);   // right sideburn link
      g.fillStyle(this._shade(s.hair, 1.2), 0.4);  // top sheen
      g.fillEllipse(ox, oy - 10.8, 6.2, 1.6);
    }
    if (fh === "beard" || fh === "mustache") {
      g.fillStyle(hair, 1);
      g.fillEllipse(ox, oy - 10.5, 3.6, 1.1);      // mustache above the lip
    }
  }

  /** Front-view eyewear — rounded frames with a faint lens sheen. */
  private _drawGlassesFront(g: Phaser.GameObjects.Graphics, s: AvatarSpec, ox: number, oy: number) {
    if ((s.glasses ?? "none") === "none") return;
    const frame = 0x241f1b;
    g.fillStyle(0xbfe0f0, 0.12);                   // faint lens glass
    g.fillCircle(ox - 2, oy - 12.5, 1.8);
    g.fillCircle(ox + 2, oy - 12.5, 1.8);
    g.lineStyle(0.7, frame, 0.95);
    g.strokeCircle(ox - 2, oy - 12.5, 2.1);
    g.strokeCircle(ox + 2, oy - 12.5, 2.1);
    g.fillStyle(frame, 0.9);
    g.fillRect(ox - 0.3, oy - 12.8, 0.6, 0.5);     // bridge
    g.fillRect(ox - 4.9, oy - 12.8, 0.9, 0.4);     // left temple toward ear
    g.fillRect(ox + 4, oy - 12.8, 0.9, 0.4);       // right temple toward ear
  }

  /** Back view (facing up / away). */
  private _drawBack(g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number) {
    const sw = this._shoulder(s);
    // Bold outline — matches the front silhouette so the rim reads the same
    // from behind (torso, head, legs, shoes; arms omitted).
    g.fillStyle(OUTLINE, 1);
    g.fillRoundedRect(-5.05, 5.4 - Math.max(0, swing), 4.1, 10.2 + Math.abs(swing) * 0.4, 1.6);
    g.fillRoundedRect(0.45, 5.4 - Math.max(0, -swing), 4.1, 10.2 + Math.abs(swing) * 0.4, 1.6);
    g.fillEllipse(-2.7, 15 - Math.max(0, swing), 5.4, 3.2);
    g.fillEllipse(2.7, 15 - Math.max(0, -swing), 5.4, 3.2);
    g.fillPoints([
      new Phaser.Geom.Point(-sw - 0.85, -6.7), new Phaser.Geom.Point(sw + 0.85, -6.7),
      new Phaser.Geom.Point(6.35, 7.6), new Phaser.Geom.Point(-6.35, 7.6),
    ], true);
    g.fillEllipse(0, -13, 11, 12.5);
    g.fillStyle(s.trouser, 1);
    g.fillRoundedRect(-4.5, 6 - Math.max(0, swing), 3.5, 9 + Math.abs(swing) * 0.4, 1.4);
    g.fillRoundedRect(1, 6 - Math.max(0, -swing), 3.5, 9 + Math.abs(swing) * 0.4, 1.4);
    g.fillStyle(0x14110d, 1);
    g.fillEllipse(-2.7, 15 - Math.max(0, swing), 4.4, 2.4);
    g.fillEllipse(2.7, 15 - Math.max(0, -swing), 4.4, 2.4);

    g.fillStyle(s.suit, 1);
    g.fillRoundedRect(-8, -5 - swing * 0.4, 3.2, 11, 1.6);
    g.fillRoundedRect(4.8, -5 + swing * 0.4, 3.2, 11, 1.6);
    g.fillStyle(s.skin, 1);
    g.fillCircle(-6.4, 6 - swing * 0.4, 1.7);
    g.fillCircle(6.4, 6 + swing * 0.4, 1.7);

    // Blazer back — vertical gradient with a subtle center seam + collar.
    const bHi = this._shade(s.suit, 1.24);
    const bLo = this._shade(s.suit, 0.74);
    g.fillGradientStyle(bHi, bHi, bLo, bLo, 1);
    g.fillPoints([
      new Phaser.Geom.Point(-sw, -6), new Phaser.Geom.Point(sw, -6),
      new Phaser.Geom.Point(5.5, 7), new Phaser.Geom.Point(-5.5, 7),
    ], true);
    g.fillStyle(this._shade(s.suit, 1.35), 0.35);
    g.fillTriangle(-sw, -6, -sw + 3, -6, -3.4, 6.4);
    g.lineStyle(0.6, this._shade(s.suit, 0.8), 0.8);
    g.beginPath(); g.moveTo(0, -6); g.lineTo(0, 7); g.strokePath();
    g.fillStyle(this._shade(s.suit, 0.85), 1);
    g.fillRect(-3.5, -6.5, 7, 1.6);

    g.fillStyle(this._shade(s.skin, 0.9), 1);
    g.fillRect(-1.7, -9, 3.4, 3.2);
    // Back of head — hair only, no face
    if (s.hairStyle === "bald") {
      g.fillStyle(s.skin, 1);
      g.fillEllipse(0, -13, 9.5, 11);
    } else {
      g.fillStyle(s.hair, 1);
      g.fillEllipse(0, -13, 9.5, 11);
      if (s.hairStyle === "tied") {
        g.fillCircle(0, -18.4, 2.1);
      }
      g.fillStyle(this._shade(s.hair, 1.2), 0.4);
      g.fillEllipse(-2, -15.5, 3.4, 2);
    }
  }

  /** Profile view (facing left dir=-1 / right dir=+1). */
  private _drawProfile(
    g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number, dir: number, arm: ArmMode, workStep: number,
  ) {
    // Bold outline — inflated silhouette behind the profile figure (legs,
    // shoes, torso, head + the back-of-head hair bump). Arms omitted.
    g.fillStyle(OUTLINE, 1);
    g.fillRoundedRect(-2.05 + dir * swing * 0.6, 5.4, 3.7, 11.2, 1.5);
    g.fillRoundedRect(-2.05 - dir * swing * 0.6, 5.4, 3.7, 11.2, 1.5);
    g.fillEllipse(dir * (2.5 + swing * 0.5), 15.5, 6, 3.2);
    g.fillEllipse(-dir * (1 + swing * 0.5), 15.5, 6, 3.2);
    g.fillPoints([
      new Phaser.Geom.Point(-5.85, -6.7), new Phaser.Geom.Point(5.85, -6.7),
      new Phaser.Geom.Point(4.85, 7.6), new Phaser.Geom.Point(-4.85, 7.6),
    ], true);
    g.fillEllipse(dir * 1.3, -13, 10.7, 12.2);
    g.fillEllipse(dir * 1.3 - dir * 3.4, -13, 6, 9.4);

    // Legs (front/back leg offset along facing axis)
    g.fillStyle(s.trouser, 1);
    g.fillRoundedRect(-2 + dir * swing * 0.6, 6, 3.6, 10, 1.4);
    g.fillRoundedRect(-2 - dir * swing * 0.6, 6, 3.6, 10, 1.4);
    g.fillStyle(0x14110d, 1);
    g.fillEllipse(dir * (2.5 + swing * 0.5), 15.5, 5, 2.4);
    g.fillEllipse(-dir * (1 + swing * 0.5), 15.5, 5, 2.4);

    // Back arm
    g.fillStyle(this._shade(s.suit, 0.85), 1);
    g.fillRoundedRect(-1.7 - dir * swing * 0.7, -5, 3, 11, 1.5);

    // Torso — vertical gradient for volume (lit top → shaded hem).
    const pHi = this._shade(s.suit, 1.28);
    const pLo = this._shade(s.suit, 0.72);
    g.fillGradientStyle(pHi, pHi, pLo, pLo, 1);
    g.fillPoints([
      new Phaser.Geom.Point(-5, -6), new Phaser.Geom.Point(5, -6),
      new Phaser.Geom.Point(4, 7), new Phaser.Geom.Point(-4, 7),
    ], true);
    // Front-facing sheen band on the facing side.
    g.fillStyle(this._shade(s.suit, 1.3), 0.35);
    g.fillRect(dir * 1.8, -6, dir * 2.4, 12);
    // Accent placket down the facing side (vivid accent).
    g.fillStyle(vivify(s.accent), 1);
    g.fillRect(dir * 2.4 - 0.7, -5, 1.5, 9);

    // Front arm — posed by work mode.
    this._drawProfileArm(g, s, swing, dir, arm, workStep);

    // Neck + head, gently shifted toward the facing direction
    const hx = dir * 1.3;
    g.fillStyle(this._shade(s.skin, 0.88), 1);
    g.fillRect(hx - 1.5, -9.5, 3, 4);
    g.fillStyle(this._shade(s.skin, 0.68), 0.5); // jaw AO
    g.fillRect(hx - 1.5, -9.5, 3, 1.3);
    // Ear on the near side
    g.fillStyle(this._shade(s.skin, 0.92), 1);
    g.fillEllipse(hx - dir * 1.4, -12.6, 2, 3);
    g.fillStyle(s.skin, 1);
    g.fillEllipse(hx, -13, 9.2, 10.8);
    // Forehead highlight + jaw shading.
    g.fillStyle(this._shade(s.skin, 1.12), 0.5);
    g.fillEllipse(hx + dir * 1.4, -15, 4.4, 3.4);
    g.fillStyle(this._shade(s.skin, 0.8), 0.4);
    g.fillEllipse(hx + dir * 1.6, -10, 4.4, 2.8);
    // Subtle nose just past the face edge
    g.fillTriangle(hx + dir * 4.2, -13, hx + dir * 4.2, -11.6, hx + dir * 5.1, -12.4);
    // Hair — crown cap and back of the head, sitting on the skull
    if (s.hairStyle !== "bald") {
      g.fillStyle(s.hair, 1);
      g.fillEllipse(hx - dir * 1.4, -15, 9, 6.5);
      g.fillEllipse(hx - dir * 3.4, -13, 4.6, 8);
      if (s.hairStyle === "tied") g.fillCircle(hx - dir * 4.2, -13.5, 2);
      g.fillStyle(this._shade(s.hair, 1.3), 0.45);
      g.fillEllipse(hx - dir * 1.4, -16.4, 3.4, 1.6);
    }
    // Brow + eye on the facing side — iris/pupil when open, thin line blinking.
    g.fillStyle(this._shade(s.hair, 0.66), 0.9);
    g.fillRect(hx + dir * 1.0, -13.7, 1.9, 0.6);
    if (this.eyesClosed) {
      g.fillStyle(this._shade(s.skin, 0.55), 0.9);
      g.fillRect(hx + dir * 1.1, -12.6, 1.8, 0.6);
    } else {
      g.fillStyle(0xe9e2d4, 1);
      g.fillEllipse(hx + dir * 1.95, -12.5, 1.5, 1.05);
      g.fillStyle(0x4a3524, 1);
      g.fillCircle(hx + dir * 2.0, -12.45, 0.5);
      g.fillStyle(0x140f0b, 1);
      g.fillCircle(hx + dir * 2.0, -12.45, 0.26);
      g.fillStyle(0xfbf7ee, 0.9);
      g.fillCircle(hx + dir * 1.75, -12.75, 0.16);
    }
    // Facial hair over the visible jaw (drawn under the mouth hint).
    this._drawFacialHairProfile(g, s, hx, dir);
    // Mouth hint
    g.fillStyle(this._shade(s.skin, 0.66), 0.55);
    g.fillRect(hx + dir * 1.6, -10.2, 1.8, 0.6);
    // Eyewear on the facing side.
    this._drawGlassesProfile(g, s, hx, dir);
  }

  /** Profile facial hair over the visible jaw. Sign-safe primitives only. */
  private _drawFacialHairProfile(g: Phaser.GameObjects.Graphics, s: AvatarSpec, hx: number, dir: number) {
    const fh = s.facialHair ?? "none";
    if (fh === "none") return;
    const hair = this._shade(s.hair, 0.92);
    if (fh === "stubble") {
      g.fillStyle(hair, 0.3);
      g.fillEllipse(hx + dir * 1.9, -9.4, 5.8, 4.6);
    } else if (fh === "beard") {
      g.fillStyle(hair, 1);
      g.fillEllipse(hx + dir * 2.1, -9, 6, 5.2);        // jaw + chin
      g.fillEllipse(hx + dir * 0.4, -12.4, 1.8, 3.2);   // sideburn toward the ear
      g.fillStyle(this._shade(s.hair, 1.2), 0.4);
      g.fillEllipse(hx + dir * 2.1, -10.8, 4.2, 1.4);   // top sheen
    }
    if (fh === "beard" || fh === "mustache") {
      g.fillStyle(hair, 1);
      g.fillEllipse(hx + dir * 1.9, -10.7, 2.6, 1.1);   // mustache
    }
  }

  /** Profile eyewear — the visible lens plus a temple arm back to the ear. */
  private _drawGlassesProfile(g: Phaser.GameObjects.Graphics, s: AvatarSpec, hx: number, dir: number) {
    if ((s.glasses ?? "none") === "none") return;
    const frame = 0x241f1b;
    g.fillStyle(0xbfe0f0, 0.12);
    g.fillCircle(hx + dir * 1.9, -12.6, 1.6);
    g.lineStyle(0.7, frame, 0.95);
    g.strokeCircle(hx + dir * 1.9, -12.6, 2);
    // Temple arm back toward the ear + a short bridge forward over the nose.
    g.beginPath(); g.moveTo(hx + dir * 3.9, -12.7); g.lineTo(hx - dir * 2, -12.9); g.strokePath();
    g.beginPath(); g.moveTo(hx + dir * 3.8, -12.5); g.lineTo(hx + dir * 4.8, -12.3); g.strokePath();
  }

  private _drawProfileArm(
    g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number, dir: number, arm: ArmMode, workStep: number,
  ) {
    if (arm === "type" || arm === "review") {
      const kb = workStep === 1 ? 0.8 : 0; // keystroke / page bob
      g.fillStyle(s.suit, 1);
      g.fillRoundedRect(-1 + dir * 1.5, -5, 3, 9, 1.5);
      g.fillStyle(s.skin, 1);
      g.fillCircle(dir * 4 + dir * 0.5, 3 + kb, 1.7);
      return;
    }
    if (arm === "present") {
      const ph = workStep === 1 ? -1.4 : 0; // gesturing sway
      g.fillStyle(s.suit, 1);
      g.fillRoundedRect(-1 + dir * 2, -7.5 + ph * 0.5, 3, 8, 1.5);
      g.fillStyle(s.skin, 1);
      g.fillCircle(dir * 5.2, -8 + ph, 1.7);
      return;
    }
    // Walk / idle — front arm swings across.
    g.fillStyle(s.suit, 1);
    g.fillRoundedRect(-1.7 + dir * swing * 0.7, -5, 3, 11, 1.5);
    g.fillStyle(s.skin, 1);
    g.fillCircle(dir * swing * 0.7, 6, 1.7);
  }

  // ── Role prop ────────────────────────────────────────────────────────────────

  /**
   * A small role-signifying object drawn in front of the working figure.
   * Placement is toward the facing direction so it reads as "held".
   */
  private _drawProp(g: Phaser.GameObjects.Graphics, s: AvatarSpec) {
    // Anchor in front of the torso at desk height.
    const dir = this.facing === "left" ? -1 : this.facing === "right" ? 1 : 0;
    const px = dir === 0 ? 0 : dir * 7.5;
    const py = 2;
    const a = s.accent;

    switch (s.prop as AvatarProp) {
      case "command": {
        // Concentric command rings around a bright node.
        g.lineStyle(0.8, a, 0.9);
        g.strokeCircle(px, py - 1, 3.4);
        g.strokeCircle(px, py - 1, 1.8);
        g.fillStyle(this._shade(a, 1.25), 1);
        g.fillCircle(px, py - 1, 1);
        break;
      }
      case "files": {
        g.fillStyle(0xe8eef5, 1); g.fillRoundedRect(px - 3.5, py - 3, 7, 6, 0.8);
        g.fillStyle(a, 0.9); g.fillRect(px - 3.5, py - 3, 7, 1.4);
        g.lineStyle(0.5, 0x9aa4b2, 0.8);
        g.beginPath(); g.moveTo(px - 2, py); g.lineTo(px + 2, py); g.strokePath();
        break;
      }
      case "folder": {
        g.fillStyle(this._shade(a, 0.9), 1); g.fillRoundedRect(px - 3.8, py - 2.6, 7.6, 5.6, 0.8);
        g.fillStyle(a, 1); g.fillRect(px - 3.8, py - 3.4, 3.4, 1.6);
        break;
      }
      case "chart": {
        g.fillStyle(0x0f1720, 0.9); g.fillRoundedRect(px - 4, py - 4, 8, 7, 0.8);
        g.fillStyle(0x38bdf8, 1);
        g.fillRect(px - 2.8, py + 0.5, 1.4, 2);
        g.fillRect(px - 0.7, py - 1, 1.4, 3.5);
        g.fillStyle(0x22c55e, 1);
        g.fillRect(px + 1.4, py - 2.4, 1.4, 4.9);
        break;
      }
      case "shield": {
        g.fillStyle(a, 0.95);
        g.fillTriangle(px - 3.4, py - 3.2, px + 3.4, py - 3.2, px, py + 3.6);
        g.fillRect(px - 3.4, py - 3.4, 6.8, 2.4);
        g.fillStyle(0x0a0806, 1);
        g.fillRect(px - 0.5, py - 2.2, 1, 3.4);
        g.fillRect(px - 1.6, py - 0.8, 3.2, 1);
        break;
      }
      case "document": {
        g.fillStyle(0xf2ede2, 1); g.fillRoundedRect(px - 3, py - 3.6, 6, 7, 0.6);
        g.lineStyle(0.5, 0x9aa4b2, 0.9);
        for (let i = 0; i < 3; i++) {
          g.beginPath(); g.moveTo(px - 2, py - 2 + i * 1.4); g.lineTo(px + 2, py - 2 + i * 1.4); g.strokePath();
        }
        g.fillStyle(a, 1); g.fillCircle(px + 1.6, py + 2.4, 1.2); // stamp
        break;
      }
      case "envelope": {
        g.fillStyle(0xeef2f7, 1); g.fillRoundedRect(px - 3.6, py - 2.6, 7.2, 5.2, 0.6);
        g.lineStyle(0.6, a, 0.9);
        g.beginPath(); g.moveTo(px - 3.6, py - 2.6); g.lineTo(px, py + 0.4); g.lineTo(px + 3.6, py - 2.6); g.strokePath();
        break;
      }
      case "capital": {
        for (let i = 0; i < 3; i++) {
          g.fillStyle(this._shade(a, 1 + i * 0.08), 1);
          g.fillEllipse(px, py + 2.4 - i * 1.8, 6, 2);
        }
        break;
      }
      case "kpi": {
        g.fillStyle(0x0f1720, 0.92); g.fillRoundedRect(px - 4, py - 3.4, 8, 6.6, 0.8);
        g.fillStyle(0x22c55e, 1); g.fillCircle(px - 2, py - 1.4, 1);
        g.fillStyle(a, 1); g.fillCircle(px + 1, py - 1.4, 1);
        g.lineStyle(0.6, 0x38bdf8, 0.9);
        g.beginPath(); g.moveTo(px - 2.6, py + 1.4); g.lineTo(px - 0.4, py + 0.2); g.lineTo(px + 2.6, py + 1); g.strokePath();
        break;
      }
      case "calendar": {
        g.fillStyle(0xeef2f7, 1); g.fillRoundedRect(px - 3.4, py - 3, 6.8, 6.4, 0.8);
        g.fillStyle(a, 1); g.fillRect(px - 3.4, py - 3, 6.8, 1.8);
        g.fillStyle(0x9aa4b2, 1);
        for (let i = 0; i < 3; i++) g.fillRect(px - 2.4 + i * 2, py + 0.4, 1, 1);
        break;
      }
      case "network": {
        g.lineStyle(0.6, a, 0.85);
        const pts = [[-3, -2], [3, -2.6], [2.6, 2.4], [-2.4, 1.8]];
        g.beginPath();
        g.moveTo(px + pts[0][0], py + pts[0][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(px + pts[i][0], py + pts[i][1]);
        g.strokePath();
        g.fillStyle(this._shade(a, 1.2), 1);
        for (const [dx, dy] of pts) g.fillCircle(px + dx, py + dy, 1);
        break;
      }
      default:
        break;
    }
  }

  // ── Earn — the gold-coin mascot ──────────────────────────────────────────────
  //
  // A round coin body with a friendly face, stubby dark arms tipped with white
  // gloves, and little white shoes — inspired by a classic platformer-coin
  // mascot. It reuses the same facing / walk-cycle / work-gesture vocabulary as
  // the humanized figures so every office state (walking, seated, typing,
  // talking) just works.

  private static readonly COIN_LIMB = 0x15120b; // near-black arms/legs
  private static readonly COIN_GLOVE = 0xf4f0e8; // white gloves/shoes
  // Vivid coin palette — a bright saturated gold with a deep amber rim, layered
  // so the disc reads with real top-lit volume (not a flat averaged gradient).
  private static readonly COIN_RIM = 0xa96e12;
  private static readonly COIN_BASE = 0xf2c12a;
  private static readonly COIN_SHADE = 0xcf941c;
  private static readonly COIN_HI = 0xf9d24e;
  private static readonly COIN_SPEC = 0xfff0b4;
  private static readonly COIN_RING = 0xc98a18;

  /**
   * The coin disc with real volume: deep-amber rim, a solid bright-gold base,
   * a lower shadow band and an upper highlight, a specular glint, and (for
   * head-on views) a milled inner ring. Works for circles (front/seated) and
   * narrowed ellipses (3/4 profile).
   */
  private _coinBody(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, ry: number, ring: boolean) {
    // Bold dark outline behind the disc (head-on views) so Earn carries the same
    // crisp premium rim as the humanized executives. Profiles keep their milled
    // edge instead, so the outline is tied to the head-on `ring` flag.
    if (ring) {
      g.fillStyle(OUTLINE, 1);
      g.fillEllipse(cx, cy, rx * 2 + 5, ry * 2 + 5);
    }
    g.fillStyle(ExecutiveAvatar.COIN_RIM, 1);
    g.fillEllipse(cx, cy, rx * 2 + 2.6, ry * 2 + 2.6);
    g.fillStyle(ExecutiveAvatar.COIN_BASE, 1);
    g.fillEllipse(cx, cy, rx * 2, ry * 2);
    g.fillStyle(ExecutiveAvatar.COIN_SHADE, 0.55);
    g.fillEllipse(cx, cy + ry * 0.52, rx * 1.5, ry * 0.9); // lower shadow band
    g.fillStyle(ExecutiveAvatar.COIN_HI, 0.9);
    g.fillEllipse(cx, cy - ry * 0.4, rx * 1.36, ry * 0.78); // upper highlight
    g.fillStyle(ExecutiveAvatar.COIN_SPEC, 0.75);
    g.fillEllipse(cx - rx * 0.42, cy - ry * 0.5, rx * 0.5, ry * 0.32); // glint
    if (ring) {
      g.lineStyle(1.2, ExecutiveAvatar.COIN_RING, 0.7);
      g.strokeEllipse(cx, cy, rx * 2 - 4.6, ry * 2 - 4.6);
    }
  }

  private _redrawCoin(g: Phaser.GameObjects.Graphics, step: number) {
    if (this.seated) {
      if (this.facing === "up") this._drawCoinSeatedBack(g);
      else this._drawCoinSeated(g);
      return;
    }
    const swing = step === -1 ? 0 : [3, 0, -3, 0][step];
    const arm = this._armMode();
    const workStep = this._gestureRate() > 0 ? Math.floor(this.workPhase) % 2 : -1;

    if (this.facing === "up") this._drawCoinBack(g, swing);
    else if (this.facing === "left") this._drawCoinProfile(g, swing, -1);
    else if (this.facing === "right") this._drawCoinProfile(g, swing, 1);
    else this._drawCoinFront(g, swing, arm, workStep);

    // The command-signal prop still reads while Earn is actively working.
    if (this._showProp() && this.facing !== "up") this._drawProp(g, this.spec);
  }

  /** Coin face — eyes (blink), a smile, or an open talking mouth. `dx` shifts for profiles. */
  private _drawCoinFace(g: Phaser.GameObjects.Graphics, cx: number, cy: number, dx: number) {
    const ex = 3.2;
    const eyeY = cy - 1.4;
    if (this.eyesClosed) {
      g.fillStyle(0x2a2018, 0.9);
      g.fillRect(cx - ex - 1.1 + dx, eyeY, 2.3, 0.8);
      g.fillRect(cx + ex - 1.1 + dx, eyeY, 2.3, 0.8);
    } else {
      g.fillStyle(0x241a12, 1);
      g.fillEllipse(cx - ex + dx, eyeY, 2.5, 3.2);
      g.fillEllipse(cx + ex + dx, eyeY, 2.5, 3.2);
      g.fillStyle(0xf7f3ea, 0.9);
      g.fillCircle(cx - ex - 0.5 + dx, eyeY - 0.9, 0.7);
      g.fillCircle(cx + ex - 0.5 + dx, eyeY - 0.9, 0.7);
    }
    // Talking: an open, happy mouth with a tongue. Otherwise a simple smile.
    if (this.animState === "presenting" && !this.eyesClosed) {
      g.fillStyle(0x3a220e, 1);
      g.fillEllipse(cx + dx * 0.6, cy + 2.6, 4.4, 3);
      g.fillStyle(0xe4573c, 1);
      g.fillEllipse(cx + dx * 0.6, cy + 3.5, 2.6, 1.4);
    } else {
      g.lineStyle(1.5, 0x4a2f14, 1);
      g.beginPath();
      g.arc(cx + dx * 0.6, cy + 1.9, 3.4, 0.15 * Math.PI, 0.85 * Math.PI, false);
      g.strokePath();
    }
  }

  /** Two little legs + white shoes, with the walk-cycle lift. */
  private _drawCoinLegs(g: Phaser.GameObjects.Graphics, swing: number) {
    const lL = Math.max(0, swing) * 0.6;
    const lR = Math.max(0, -swing) * 0.6;
    g.fillStyle(ExecutiveAvatar.COIN_LIMB, 1);
    g.fillRoundedRect(-4.6, 3 - lL, 3.1, 9, 1.4);
    g.fillRoundedRect(1.5, 3 - lR, 3.1, 9, 1.4);
    g.fillStyle(ExecutiveAvatar.COIN_GLOVE, 1);
    g.fillEllipse(-3.0, 12.6 - lL, 4.6, 2.7);
    g.fillEllipse(3.0, 12.6 - lR, 4.6, 2.7);
    g.fillStyle(0xcbc6b8, 1);
    g.fillEllipse(-3.0, 13.4 - lL, 3.4, 1.2);
    g.fillEllipse(3.0, 13.4 - lR, 3.4, 1.2);
  }

  /** Front-facing arms/gloves, posed by the work mode. */
  private _drawCoinArms(g: Phaser.GameObjects.Graphics, swing: number, arm: ArmMode, workStep: number) {
    const A = ExecutiveAvatar.COIN_LIMB;
    const W = ExecutiveAvatar.COIN_GLOVE;
    if (arm === "type") {
      const kb = workStep === 1 ? 0.9 : 0;
      g.fillStyle(A, 1);
      g.fillRoundedRect(-9.6, -3, 3, 7, 1.4);
      g.fillRoundedRect(6.6, -3, 3, 7, 1.4);
      g.fillStyle(W, 1);
      g.fillCircle(-7.2, 4.6 + kb, 2.2);
      g.fillCircle(7.2, 4.6 + (0.9 - kb), 2.2);
      return;
    }
    if (arm === "present") {
      const ph = workStep === 1 ? -1.6 : 0;
      g.fillStyle(A, 1);
      g.fillRoundedRect(-12.6, -10 + ph, 3, 7, 1.4);
      g.fillRoundedRect(9.6, -5, 3, 7, 1.4);
      g.fillStyle(W, 1);
      g.fillCircle(-12.2, -11 + ph, 2.3);
      g.fillCircle(11.4, 1.6, 2.2);
      return;
    }
    if (arm === "review") {
      const rb = workStep === 1 ? 0.8 : 0;
      g.fillStyle(A, 1);
      g.fillRoundedRect(-9, -4, 3, 6, 1.4);
      g.fillRoundedRect(6, -4, 3, 6, 1.4);
      g.fillStyle(W, 1);
      g.fillCircle(-4.6, 1 + rb, 2.1);
      g.fillCircle(4.6, 1 + rb, 2.1);
      return;
    }
    // Walk / idle — gloves at the sides, swinging opposite the legs.
    g.fillStyle(A, 1);
    g.fillRoundedRect(-12, -7 + swing * 0.4, 3, 7, 1.4);
    g.fillRoundedRect(9, -7 - swing * 0.4, 3, 7, 1.4);
    g.fillStyle(W, 1);
    g.fillCircle(-11.4, -0.4 + swing * 0.5, 2.3);
    g.fillCircle(11.4, -0.4 - swing * 0.5, 2.3);
  }

  private _drawCoinFront(g: Phaser.GameObjects.Graphics, swing: number, arm: ArmMode, workStep: number) {
    this._drawCoinLegs(g, swing);
    this._coinBody(g, 0, -7, 11, 11, true);
    this._drawCoinFace(g, 0, -8, 0);
    this._drawCoinArms(g, swing, arm, workStep);
  }

  /** Back view (facing up) — a plain gold disc, no face. */
  private _drawCoinBack(g: Phaser.GameObjects.Graphics, swing: number) {
    this._drawCoinLegs(g, swing);
    // Arms first so the gloves peek at the disc's sides.
    this._drawCoinArms(g, swing, "idle", -1);
    this._coinBody(g, 0, -7, 11, 11, true);
    g.fillStyle(ExecutiveAvatar.COIN_SPEC, 0.28);
    g.fillEllipse(-2.6, -7, 3.4, 15); // vertical shine band
  }

  /** Profile (facing left dir=-1 / right dir=+1) — coin at a 3/4 turn with a milled edge. */
  private _drawCoinProfile(g: Phaser.GameObjects.Graphics, swing: number, dir: number) {
    // Legs.
    g.fillStyle(ExecutiveAvatar.COIN_LIMB, 1);
    g.fillRoundedRect(-1.6 + dir * swing * 0.6, 3, 3, 9, 1.4);
    g.fillRoundedRect(-1.6 - dir * swing * 0.6, 3, 3, 9, 1.4);
    g.fillStyle(ExecutiveAvatar.COIN_GLOVE, 1);
    g.fillEllipse(dir * (2.6 + swing * 0.4), 12.6, 5, 2.7);
    g.fillEllipse(-dir * (1 + swing * 0.4), 12.6, 5, 2.7);

    const cx = -dir * 1.2, cy = -7;
    // Coin thickness (edge) behind, offset to the trailing side, with milled ridges.
    g.fillStyle(this._shade(ExecutiveAvatar.COIN_RIM, 0.86), 1);
    g.fillEllipse(cx - dir * 2.4, cy, 13, 22);
    g.lineStyle(0.8, this._shade(ExecutiveAvatar.COIN_RIM, 1.15), 0.9);
    for (let i = -3; i <= 3; i++) {
      const yy = cy + i * 2.7;
      g.beginPath();
      g.moveTo(cx - dir * 5.5, yy);
      g.lineTo(cx - dir * 8, yy);
      g.strokePath();
    }
    // Coin face (angled ellipse), top-lit volume.
    this._coinBody(g, cx, cy, 8, 11, false);
    // 3/4 face, shifted toward the facing direction.
    this._drawCoinFace(g, cx + dir * 1.4, cy - 1, dir * 0.8);
    // Near arm + glove.
    g.fillStyle(ExecutiveAvatar.COIN_LIMB, 1);
    g.fillRoundedRect(cx + dir * 3.4 - 1.5, cy + 1 + swing * 0.3, 3, 6, 1.4);
    g.fillStyle(ExecutiveAvatar.COIN_GLOVE, 1);
    g.fillCircle(cx + dir * 5.2, cy + 6.5 + swing * 0.3, 2.2);
  }

  /** Seated (facing the viewer) — coin sits low, gloves resting toward the desk. */
  private _drawCoinSeated(g: Phaser.GameObjects.Graphics) {
    g.fillStyle(ExecutiveAvatar.COIN_LIMB, 1);
    g.fillRoundedRect(-9.6, 1, 3, 6, 1.4);
    g.fillRoundedRect(6.6, 1, 3, 6, 1.4);
    g.fillStyle(ExecutiveAvatar.COIN_GLOVE, 1);
    g.fillCircle(-6.6, 6.6, 2.1);
    g.fillCircle(6.6, 6.6, 2.1);
    this._coinBody(g, 0, -4, 10.5, 10.5, true);
    this._drawCoinFace(g, 0, -5, 0);
  }

  /** Seated from behind (facing up) — a plain disc, arms at the sides. */
  private _drawCoinSeatedBack(g: Phaser.GameObjects.Graphics) {
    g.fillStyle(ExecutiveAvatar.COIN_LIMB, 1);
    g.fillRoundedRect(-10, -2, 3, 7, 1.4);
    g.fillRoundedRect(7, -2, 3, 7, 1.4);
    this._coinBody(g, 0, -4, 10.5, 10.5, true);
  }

  /** Multiply an 0xRRGGBB color's brightness by f. */
  private _shade(color: number, f: number): number {
    const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
    const gc = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
    const b = Math.min(255, Math.round((color & 0xff) * f));
    return (r << 16) | (gc << 8) | b;
  }
}
