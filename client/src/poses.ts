// ── Game modes & pose templates ──────────────────────────────────────────────
import { calcAngle } from './poseDetector';

export type GameModeId = 'pushup_repoff' | 'pose_hold';

export interface GameMode {
  id: GameModeId;
  name: string;
  emoji: string;
  duration: number; // seconds
  type: 'reps' | 'pose';
  description: string;
}

export const GAME_MODES: Record<GameModeId, GameMode> = {
  pushup_repoff: {
    id: 'pushup_repoff',
    name: 'Pushup Rep-Off',
    emoji: '💪',
    duration: 60,
    type: 'reps',
    description: 'Most pushups in 60 seconds wins. Form score affects bragging rights.',
  },
  pose_hold: {
    id: 'pose_hold',
    name: 'Pose Hold',
    emoji: '🤸',
    duration: 15,
    type: 'pose',
    description: 'Hold a random skill pose for 15 seconds. Best form match wins.',
  },
};

// MediaPipe Pose landmark indices we care about
// 7 L-ear, 8 R-ear, 11 L-shoulder, 12 R-shoulder, 13 L-elbow, 14 R-elbow,
// 15 L-wrist, 16 R-wrist, 23 L-hip, 24 R-hip, 25 L-knee, 26 R-knee, 27 L-ankle, 28 R-ankle

export interface AngleCheck {
  label: string;
  a: number; // landmark index
  b: number; // vertex
  c: number;
  target: number; // degrees
  tolerance: number; // degrees of "perfect" slack
  weight?: number;
}

export interface PoseTemplate {
  id: string;
  name: string;
  emoji: string;
  difficulty: 1 | 2 | 3;
  description: string;
  checks: AngleCheck[];
  // optional torso orientation vs vertical: 0 = upright, 90 = horizontal, 180 = inverted
  torsoFromVertical?: { target: number; tolerance: number; weight?: number };
}

export const POSE_TEMPLATES: PoseTemplate[] = [
  {
    id: 'elbow_lever',
    name: 'Elbow Lever',
    emoji: '🪽',
    difficulty: 3,
    description: 'Body horizontal, balanced on bent elbows.',
    checks: [
      { label: 'L elbow ~90°', a: 11, b: 13, c: 15, target: 90, tolerance: 25 },
      { label: 'R elbow ~90°', a: 12, b: 14, c: 16, target: 90, tolerance: 25 },
      { label: 'Body straight', a: 11, b: 23, c: 27, target: 170, tolerance: 18 },
    ],
    torsoFromVertical: { target: 90, tolerance: 22, weight: 1.5 },
  },
  {
    id: 'frog_stand',
    name: 'Frog Stand (Crow)',
    emoji: '🐸',
    difficulty: 2,
    description: 'Balance on hands, knees resting on elbows, deep tuck.',
    checks: [
      { label: 'Knees tucked', a: 23, b: 25, c: 27, target: 45, tolerance: 25 },
      { label: 'Hips closed', a: 11, b: 23, c: 25, target: 50, tolerance: 25 },
      { label: 'Elbows bent', a: 11, b: 13, c: 15, target: 90, tolerance: 30 },
    ],
  },
  {
    id: 'l_sit',
    name: 'L-Sit',
    emoji: '🔱',
    difficulty: 3,
    description: 'Legs straight out, torso upright, hips at 90°.',
    checks: [
      { label: 'Hip ~90°', a: 11, b: 23, c: 25, target: 90, tolerance: 22 },
      { label: 'Knees straight', a: 23, b: 25, c: 27, target: 172, tolerance: 15 },
      { label: 'Arms straight', a: 11, b: 13, c: 15, target: 172, tolerance: 18 },
    ],
    torsoFromVertical: { target: 0, tolerance: 22 },
  },
  {
    id: 'plank',
    name: 'Forearm Plank',
    emoji: '🪵',
    difficulty: 1,
    description: 'Body in a straight line, forearms down.',
    checks: [
      { label: 'Body straight', a: 11, b: 23, c: 27, target: 175, tolerance: 14 },
      { label: 'Elbow ~90°', a: 11, b: 13, c: 15, target: 90, tolerance: 28 },
    ],
    torsoFromVertical: { target: 90, tolerance: 22 },
  },
  {
    id: 'pistol_squat',
    name: 'Pistol Squat Hold',
    emoji: '🦵',
    difficulty: 2,
    description: 'One leg deeply bent, the other extended forward.',
    checks: [
      { label: 'Working knee bent', a: 23, b: 25, c: 27, target: 50, tolerance: 28 },
      { label: 'Free leg straight', a: 24, b: 26, c: 28, target: 168, tolerance: 22 },
      { label: 'Hip closed', a: 11, b: 23, c: 25, target: 55, tolerance: 28 },
    ],
    torsoFromVertical: { target: 25, tolerance: 30 },
  },
];

export function getPoseById(id: string): PoseTemplate | undefined {
  return POSE_TEMPLATES.find((p) => p.id === id);
}

type LM = { x: number; y: number; z: number };

function checkScore(deviation: number, tolerance: number): number {
  if (deviation <= tolerance) return 100;
  // Linear falloff: ~1.8 points lost per degree beyond tolerance
  return Math.max(0, 100 - (deviation - tolerance) * 1.8);
}

// Torso angle from vertical axis in degrees (0 upright, 90 horizontal, 180 inverted)
function torsoFromVertical(landmarks: LM[]): number {
  const midShoulder = {
    x: (landmarks[11].x + landmarks[12].x) / 2,
    y: (landmarks[11].y + landmarks[12].y) / 2,
  };
  const midHip = {
    x: (landmarks[23].x + landmarks[24].x) / 2,
    y: (landmarks[23].y + landmarks[24].y) / 2,
  };
  const dx = midHip.x - midShoulder.x;
  const dy = midHip.y - midShoulder.y;
  return Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
}

// Score how well the current landmarks match a pose template (0–100)
export function scorePose(
  template: PoseTemplate,
  landmarks: LM[]
): { score: number; perCheck: { label: string; score: number }[] } | null {
  if (!landmarks || landmarks.length < 33) return null;

  let totalWeight = 0;
  let weighted = 0;
  const perCheck: { label: string; score: number }[] = [];

  for (const c of template.checks) {
    const actual = calcAngle(landmarks[c.a], landmarks[c.b], landmarks[c.c]);
    const s = checkScore(Math.abs(actual - c.target), c.tolerance);
    const w = c.weight ?? 1;
    weighted += s * w;
    totalWeight += w;
    perCheck.push({ label: c.label, score: Math.round(s) });
  }

  if (template.torsoFromVertical) {
    const actual = torsoFromVertical(landmarks);
    const s = checkScore(
      Math.abs(actual - template.torsoFromVertical.target),
      template.torsoFromVertical.tolerance
    );
    const w = template.torsoFromVertical.weight ?? 1;
    weighted += s * w;
    totalWeight += w;
    perCheck.push({ label: 'Body orientation', score: Math.round(s) });
  }

  return { score: Math.round(weighted / totalWeight), perCheck };
}
