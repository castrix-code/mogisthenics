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

// Draw skeleton on canvas
export function drawPose(
  canvas: HTMLCanvasElement,
  result: PoseLandmarkerResult,
  videoWidth: number,
  videoHeight: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !result.landmarks.length) return;

  canvas.width = videoWidth;
  canvas.height = videoHeight;
  ctx.clearRect(0, 0, videoWidth, videoHeight);

  const drawingUtils = new DrawingUtils(ctx);
  for (const landmarks of result.landmarks) {
    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: '#00ff88',
      lineWidth: 2,
    });
    drawingUtils.drawLandmarks(landmarks, {
      color: '#ff4444',
      lineWidth: 1,
      radius: 3,
    });
  }
}

// Pushup rep counter using elbow angle
// State machine: up (angle > 150) -> down (angle < 80) -> up = 1 rep
export type RepState = 'up' | 'down';

export function calcPushupMetrics(landmarks: { x: number; y: number; z: number }[]): {
  elbowAngle: number;
  backStraightness: number; // 0-100, higher is better
  depth: number; // 0-100 based on elbow angle
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

  return { elbowAngle, backStraightness, depth };
}
