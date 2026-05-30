import {
  PoseLandmarker,
  FilesetResolver,
  type PoseLandmarkerResult,
  DrawingUtils,
} from '@mediapipe/tasks-vision';

let poseLandmarker: PoseLandmarker | null = null;

export async function initPoseDetector() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

export function detectPose(video: HTMLVideoElement, timestamp: number): PoseLandmarkerResult | null {
  if (!poseLandmarker) return null;
  return poseLandmarker.detectForVideo(video, timestamp);
}

// Returns angle in degrees between three points (b is the vertex)
export function calcAngle(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

// Draw skeleton on canvas. `skeletonColor` lets callers signal form state —
// e.g. green when the rep is valid, amber when the body isn't in position.
export function drawPose(
  canvas: HTMLCanvasElement,
  result: PoseLandmarkerResult,
  videoWidth: number,
  videoHeight: number,
  skeletonColor = '#00ff88'
) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !result.landmarks.length) return;

  canvas.width = videoWidth;
  canvas.height = videoHeight;
  ctx.clearRect(0, 0, videoWidth, videoHeight);

  const drawingUtils = new DrawingUtils(ctx);
  for (const landmarks of result.landmarks) {
    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: skeletonColor,
      lineWidth: 2,
    });
    drawingUtils.drawLandmarks(landmarks, {
      color: '#ffffff',
      lineWidth: 1,
      radius: 3,
    });
  }
}

// Real-time coaching cue for the pushup form overlay, derived from the current
// elbow angle + validity. `tone` drives the on-screen color.
export type PushupCue = { text: string; tone: 'idle' | 'down' | 'up' | 'invalid' };
export function pushupCue(m: { elbowAngle: number; valid: boolean }): PushupCue {
  if (!m.valid) return { text: 'GET IN POSITION', tone: 'invalid' };
  if (m.elbowAngle > 150) return { text: 'GO DOWN', tone: 'down' };
  if (m.elbowAngle < 85) return { text: 'PUSH UP!', tone: 'up' };
  return { text: 'KEEP GOING', tone: 'down' };
}

// A MediaPipe normalized landmark. `visibility` (0–1) is the model's confidence
// that the joint is actually present in frame; we use it to reject phantom poses.
export type Landmark = { x: number; y: number; z: number; visibility?: number };

// Are every one of the given landmark indices confidently tracked this frame?
// IMPORTANT: @mediapipe/tasks-vision often returns visibility = 0 (or undefined)
// for all joints even when the person is clearly in frame, so we only gate on
// visibility when the model is actually reporting it — otherwise this would
// reject every frame and nothing would ever count.
export function keypointsVisible(
  landmarks: Landmark[],
  indices: number[],
  threshold = 0.5
): boolean {
  let maxV = 0;
  for (const i of indices) maxV = Math.max(maxV, landmarks[i]?.visibility ?? 0);
  if (maxV < 0.1) return true; // model isn't providing visibility — don't gate
  return indices.every((i) => (landmarks[i]?.visibility ?? 0) >= threshold);
}

// Pushup rep counter using elbow angle
// State machine: up (angle > 150) -> down (angle < 80) -> up = 1 rep
export type RepState = 'up' | 'down';

// Joints that must be tracked for a rep to count: both arms + shoulders. Hips
// are intentionally excluded — they often sit near the frame edge during a
// pushup and would otherwise reject valid reps.
const PUSHUP_KEYPOINTS = [11, 12, 13, 14, 15, 16];

export function calcPushupMetrics(landmarks: Landmark[]): {
  elbowAngle: number;
  backStraightness: number; // 0-100, higher is better
  depth: number; // 0-100 based on elbow angle
  valid: boolean; // body is in a real, fully-tracked pushup position this frame
} | null {
  if (!landmarks || landmarks.length < 33) return null;

  // Right side: shoulder(12), elbow(14), wrist(16)
  // Left side: shoulder(11), elbow(13), wrist(15)
  const ls = landmarks[11];
  const le = landmarks[13];
  const lw = landmarks[15];
  const rs = landmarks[12];
  const re = landmarks[14];
  const rw = landmarks[16];

  const leftAngle = calcAngle(ls, le, lw);
  const rightAngle = calcAngle(rs, re, rw);
  const elbowAngle = (leftAngle + rightAngle) / 2;

  // Back straightness: compare hip-shoulder-ear alignment
  // landmarks: left hip(23), left shoulder(11), left ear(7)
  const lhip = landmarks[23];
  const lshoulder = landmarks[11];
  const lear = landmarks[7];
  const backAngle = calcAngle(lhip, lshoulder, lear);
  // Perfect plank = ~180 degrees; score drops as it deviates
  const backStraightness = Math.max(0, Math.min(100, 100 - Math.abs(180 - backAngle) * 2));

  // Depth: how low they go — map elbow angle 160->80 to 0->100
  const depth = Math.max(0, Math.min(100, ((160 - elbowAngle) / 80) * 100));

  // ── Validity gate (light sanity check) ─────────────────────────────────────
  // Kept deliberately loose so real reps from any camera angle still count; the
  // rep debounce in useRepCounter is the primary anti-cheat. We only require:
  //  1) the joints are tracked (when the model reports visibility), and
  //  2) both arms roughly agree — a single waving arm gives lopsided angles.
  const visible = keypointsVisible(landmarks, PUSHUP_KEYPOINTS, 0.5);
  const symmetric = Math.abs(leftAngle - rightAngle) < 60;
  const valid = visible && symmetric;

  return { elbowAngle, backStraightness, depth, valid };
}
