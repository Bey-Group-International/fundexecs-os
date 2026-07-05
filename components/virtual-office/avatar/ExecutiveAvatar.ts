import * as Phaser from "phaser";
import type { AvatarProp, AvatarSpec } from "./avatarPalette";
import type { AgentState } from "../program/officeProgram";

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
  private body: Phaser.GameObjects.Graphics;
  private think: Phaser.GameObjects.Graphics;

  private facing: AvatarFacing = "down";
  private walking = false;
  private programState: AgentState = "idle";
  private animState: AnimationState = "idle_breathing";

  private walkPhase = 0;
  private workPhase = 0;
  private thinkPhase = Math.random() * Math.PI * 2;
  private bobPhase = Math.random() * Math.PI * 2;
  private lastPoseKey = "";

  constructor(scene: Phaser.Scene, x: number, y: number, spec: AvatarSpec, depth = 8) {
    this.scene = scene;
    this.spec = spec;

    // Soft, layered ground shadow — two stacked ellipses fake a penumbra.
    this.shadow = scene.add.graphics();
    this.shadow.fillStyle(0x000000, 0.16);
    this.shadow.fillEllipse(0, 16, 22, 8);
    this.shadow.fillStyle(0x000000, 0.26);
    this.shadow.fillEllipse(0, 16, 15, 5);

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

    // "Thinking" pulse — three dots floating above the head, ACE-style
    // presence cue shown only while analyzing.
    this.think = scene.add.graphics().setVisible(false).setPosition(0, -25);
    this.think.fillStyle(spec.accent, 0.95);
    this.think.fillCircle(-3, 0, 1.1);
    this.think.fillCircle(0, 0, 1.1);
    this.think.fillCircle(3, 0, 1.1);

    this.container = scene.add.container(x, y, [
      this.shadow, this.rim, this.aura, this.body, this.think,
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

  /** Make the figure clickable; the whole silhouette is the hit target. */
  setInteractive(onClick: () => void) {
    this.container.setSize(24, 44);
    this.container.setInteractive({ useHandCursor: true });
    this.container.on("pointerdown", onClick);
    this.container.on("pointerover", () => { this.body.setAlpha(0.82); this.rim.setVisible(true); });
    this.container.on("pointerout", () => { this.body.setAlpha(1); this._applyAura(); });
  }

  /** Per-frame animation: advance the walk/work cycle or breathe while idle. */
  update(delta: number) {
    const dt = delta / 1000;

    if (this.walking) {
      this.walkPhase += dt * 9; // ~9 steps/sec
      const step = Math.floor(this.walkPhase) % 4;
      const key = this._poseKey(step, -1);
      if (key !== this.lastPoseKey) this._redraw();
      this.body.setY(0);
      return;
    }

    // Reduced-motion: hold the figure statically. The correct pose/state is
    // already drawn by _redraw(); we only suppress decorative looping motion
    // (breathing bob, typing keystrokes, thinking-dot pulse). The thinking
    // dots remain visible at a fixed alpha/scale.
    if (ExecutiveAvatar.reducedMotion) {
      this.body.setY(0);
      if (this.think.visible) this.think.setAlpha(0.9).setScale(1);
      return;
    }

    // Subtle breathing bob — transform only, no redraw.
    this.bobPhase += dt;
    const bob = Math.sin(this.bobPhase * 1.6) * 0.4;
    this.body.setY(bob);

    // Redraw-based work animations advance a discrete work step.
    if (this.animState === "typing") {
      this.workPhase += dt * 5.5; // brisk keystrokes
      const wstep = Math.floor(this.workPhase) % 2;
      const key = this._poseKey(-1, wstep);
      if (key !== this.lastPoseKey) this._redraw();
    }

    // "Thinking" pulse while analyzing — transform-only on the dots.
    if (this.think.visible) {
      this.thinkPhase += dt * 3.4;
      const p = (Math.sin(this.thinkPhase) + 1) / 2; // 0..1
      this.think.setAlpha(0.35 + p * 0.6).setScale(0.8 + p * 0.35);
    }
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
    if (this.walking) { this.animState = "walking"; return; }
    switch (this.programState) {
      case "working":              this.animState = "typing"; break;
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
    this.aura.setVisible(true);
    this.aura.setStrokeStyle(1.5, color, 0.85);
    this.aura.setFillStyle(color, 0.07);
    this.aura.setScale(1).setAlpha(1);

    // Presence rim light — soft disc that glows under working agents.
    this.rim.setVisible(true);
    this.rim.setFillStyle(color, 0.1).setScale(1).setAlpha(1);

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
    return `${this.facing}:w${step}:k${workStep}:${this.animState}:${this.spec.kind}`;
  }

  private _redraw() {
    const step = this.walking ? Math.floor(this.walkPhase) % 4 : -1;
    const workStep = this.animState === "typing" ? Math.floor(this.workPhase) % 2 : -1;
    this.lastPoseKey = this._poseKey(step, workStep);
    const g = this.body;
    g.clear();

    // Walk-cycle limb offsets (discrete 4-frame swing). step -1 = idle.
    const swing = step === -1 ? 0 : [3, 0, -3, 0][step];
    const s = this.spec;
    const arm = this._armMode();

    if (this.facing === "up") this._drawBack(g, s, swing);
    else if (this.facing === "left") this._drawProfile(g, s, swing, -1, arm, workStep);
    else if (this.facing === "right") this._drawProfile(g, s, swing, 1, arm, workStep);
    else this._drawFront(g, s, swing, arm, workStep);

    if (this._showProp()) this._drawProp(g, s);
  }

  /** Shoulder half-width for the torso top, by build. */
  private _shoulder(s: AvatarSpec): number {
    switch (s.build) {
      case "slim":  return 6.2;
      case "broad": return 8;
      default:      return 7;
    }
  }

  /** Front view (facing down / toward the viewer). */
  private _drawFront(g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number, arm: ArmMode, workStep: number) {
    const sw = this._shoulder(s);

    // Legs — soft vertical gradient (lit at the thigh, shaded at the cuff).
    const legHi = this._shade(s.trouser, 1.18);
    const legLo = this._shade(s.trouser, 0.82);
    g.fillGradientStyle(legHi, legHi, legLo, legLo, 1);
    g.fillRect(-4.5, 6 - Math.max(0, swing), 3.5, 9 + Math.abs(swing) * 0.4);
    g.fillRect(1, 6 - Math.max(0, -swing), 3.5, 9 + Math.abs(swing) * 0.4);
    // Shoes — dark leather with a specular toe highlight.
    g.fillStyle(0x14110d, 1);
    g.fillEllipse(-2.7, 15 - Math.max(0, swing), 4.4, 2.4);
    g.fillEllipse(2.7, 15 - Math.max(0, -swing), 4.4, 2.4);
    g.fillStyle(0x3c362c, 0.9);
    g.fillEllipse(-3.3, 14.5 - Math.max(0, swing), 1.7, 0.9);
    g.fillEllipse(2.1, 14.5 - Math.max(0, -swing), 1.7, 0.9);

    // Arms — pose depends on the work animation.
    this._drawFrontArms(g, s, swing, arm, workStep);

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
    g.lineStyle(0.4, this._shade(s.suit, 1.4), 0.7);
    g.beginPath(); g.moveTo(-3.2, -6); g.lineTo(-2.2, 1); g.strokePath();
    g.beginPath(); g.moveTo(3.2, -6); g.lineTo(2.2, 1); g.strokePath();
    // Pocket square — a small folded accent on the left chest.
    g.fillStyle(this._shade(s.accent, 1.1), 0.95);
    g.fillTriangle(-4.6, -2.2, -3.2, -2.2, -3.9, -3.6);
    // Tie with a knot and a highlighted center ridge.
    g.fillStyle(s.accent, 1);
    g.fillTriangle(-1.1, -5, 1.1, -5, 0, 4);
    g.fillStyle(this._shade(s.accent, 1.25), 0.8);
    g.fillTriangle(-0.4, -4.6, 0.4, -4.6, 0, 3.4);
    g.fillStyle(this._shade(s.accent, 1.15), 1);
    g.fillTriangle(-1.3, -5.2, 1.3, -5.2, 0, -3);

    this._drawHead(g, s, 0, 0);
  }

  /** Front-view arm variants keyed to the work animation. */
  private _drawFrontArms(g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number, arm: ArmMode, workStep: number) {
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
      // Both hands raised in front, holding a document (drawn as prop).
      g.fillStyle(sleeve, 1);
      g.fillRoundedRect(-7.4, -4.5, 3, 7, 1.5);
      g.fillRoundedRect(4.4, -4.5, 3, 7, 1.5);
      g.fillStyle(s.skin, 1);
      g.fillCircle(-3.4, 1.5, 1.6);
      g.fillCircle(3.4, 1.5, 1.6);
      return;
    }
    if (arm === "present") {
      // One arm raised outward in a presenting gesture.
      g.fillStyle(sleeve, 1);
      g.fillRoundedRect(-8.4, -6.5, 3, 8, 1.5); // raised
      g.fillRoundedRect(4.8, -5, 3.2, 11, 1.6);
      g.fillStyle(s.skin, 1);
      g.fillCircle(-8.6, -7, 1.7);
      g.fillCircle(6.4, 6, 1.7);
      return;
    }
    // Walk / idle — arms at the sides, swinging opposite the legs.
    g.fillStyle(sleeve, 1);
    g.fillRoundedRect(-8, -5 + swing * 0.4, 3.2, 11, 1.6);
    g.fillRoundedRect(4.8, -5 - swing * 0.4, 3.2, 11, 1.6);
    g.fillStyle(s.skin, 1);
    g.fillCircle(-6.4, 6 + swing * 0.4, 1.7);
    g.fillCircle(6.4, 6 - swing * 0.4, 1.7);
  }

  /** Shared head/hair/face block, offset by (ox, oy). */
  private _drawHead(g: Phaser.GameObjects.Graphics, s: AvatarSpec, ox: number, oy: number) {
    const skinLo = this._shade(s.skin, 0.82);
    // Neck with an ambient-occlusion shadow just under the jaw.
    g.fillStyle(this._shade(s.skin, 0.88), 1);
    g.fillRect(ox - 1.8, oy - 9, 3.6, 3.6);
    g.fillStyle(skinLo, 0.55);
    g.fillRect(ox - 1.8, oy - 9, 3.6, 1.4);
    // Ears
    g.fillStyle(this._shade(s.skin, 0.94), 1);
    g.fillEllipse(ox - 4.7, oy - 12.6, 2, 3.2);
    g.fillEllipse(ox + 4.7, oy - 12.6, 2, 3.2);
    // Head base
    g.fillStyle(s.skin, 1);
    g.fillEllipse(ox, oy - 13, 9.5, 11);
    // Forehead highlight (top-lit) + jaw / right-cheek shading for volume.
    g.fillStyle(this._shade(s.skin, 1.12), 0.5);
    g.fillEllipse(ox - 1, oy - 15, 6, 4);
    g.fillStyle(skinLo, 0.45);
    g.fillEllipse(ox, oy - 9.6, 7, 3.4);      // jaw
    g.fillEllipse(ox + 2.9, oy - 12, 3.2, 6); // cheek
    // Hair
    if (s.hairStyle !== "bald") {
      g.fillStyle(s.hair, 1);
      g.fillEllipse(ox, oy - 15.6, 10, 7.2);
      g.fillRect(ox - 5, oy - 15.6, 10, 2.6);
      // Sideburns framing the face.
      g.fillEllipse(ox - 4.5, oy - 15, 1.6, 3.4);
      g.fillEllipse(ox + 4.5, oy - 15, 1.6, 3.4);
      if (s.hairStyle === "textured") {
        g.fillStyle(this._shade(s.hair, 1.35), 0.5);
        g.fillEllipse(ox - 2.4, oy - 17.2, 4.2, 2.2);
        g.fillStyle(this._shade(s.hair, 0.7), 0.4);
        g.fillEllipse(ox + 2.6, oy - 15.6, 3, 2);
      } else if (s.hairStyle === "tied") {
        g.fillStyle(s.hair, 1);
        g.fillCircle(ox, oy - 18.6, 2.2); // top knot
        g.fillStyle(this._shade(s.hair, 1.3), 0.4);
        g.fillEllipse(ox - 1.6, oy - 17.4, 3, 1.5);
      } else {
        g.fillStyle(this._shade(s.hair, 1.32), 0.5); // sheen
        g.fillEllipse(ox - 2, oy - 17.4, 3.6, 1.7);
      }
      // Hairline shadow where hair meets the forehead.
      g.fillStyle(this._shade(s.hair, 0.7), 0.4);
      g.fillEllipse(ox, oy - 16.4, 8.6, 1.4);
    }
    // Brows
    g.fillStyle(this._shade(s.hair, 0.85), 0.85);
    g.fillRect(ox - 3.2, oy - 13.7, 2.4, 0.7);
    g.fillRect(ox + 0.8, oy - 13.7, 2.4, 0.7);
    // Eyes with a tiny catchlight.
    g.fillStyle(0x2a2320, 1);
    g.fillEllipse(ox - 2, oy - 12.4, 1.5, 1.7);
    g.fillEllipse(ox + 2, oy - 12.4, 1.5, 1.7);
    g.fillStyle(0xf4f0e8, 0.85);
    g.fillCircle(ox - 2.4, oy - 12.8, 0.4);
    g.fillCircle(ox + 1.6, oy - 12.8, 0.4);
    // Nose shadow to the shaded side.
    g.fillStyle(skinLo, 0.5);
    g.fillTriangle(ox + 0.3, oy - 12.4, ox + 0.3, oy - 10.6, ox + 1.4, oy - 10.8);
    // Mouth
    g.fillStyle(this._shade(s.skin, 0.66), 0.6);
    g.fillRect(ox - 1.5, oy - 10, 3, 0.7);
  }

  /** Back view (facing up / away). */
  private _drawBack(g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number) {
    const sw = this._shoulder(s);
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
    // Accent placket down the facing side
    g.fillStyle(s.accent, 1);
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
    // Brow + eye on the facing side, with a catchlight.
    g.fillStyle(this._shade(s.hair, 0.85), 0.85);
    g.fillRect(hx + dir * 1.1, -13.9, 1.8, 0.7);
    g.fillStyle(0x2a2320, 1);
    g.fillEllipse(hx + dir * 1.9, -12.6, 1.3, 1.6);
    g.fillStyle(0xf4f0e8, 0.85);
    g.fillCircle(hx + dir * 1.6, -13, 0.35);
    // Mouth hint
    g.fillStyle(this._shade(s.skin, 0.66), 0.55);
    g.fillRect(hx + dir * 1.6, -10.2, 1.8, 0.6);
  }

  private _drawProfileArm(
    g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number, dir: number, arm: ArmMode, workStep: number,
  ) {
    if (arm === "type" || arm === "review") {
      const kb = arm === "type" && workStep === 1 ? 0.8 : 0;
      g.fillStyle(s.suit, 1);
      g.fillRoundedRect(-1 + dir * 1.5, -5, 3, 9, 1.5);
      g.fillStyle(s.skin, 1);
      g.fillCircle(dir * 4 + dir * 0.5, 3 + kb, 1.7);
      return;
    }
    if (arm === "present") {
      g.fillStyle(s.suit, 1);
      g.fillRoundedRect(-1 + dir * 2, -7.5, 3, 8, 1.5);
      g.fillStyle(s.skin, 1);
      g.fillCircle(dir * 5.2, -8, 1.7);
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

  /** Multiply an 0xRRGGBB color's brightness by f. */
  private _shade(color: number, f: number): number {
    const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
    const gc = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
    const b = Math.min(255, Math.round((color & 0xff) * f));
    return (r << 16) | (gc << 8) | b;
  }
}
