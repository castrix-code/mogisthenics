import { useRef, useState, useCallback } from 'react';
import type { Landmark, RepState } from './poseDetector';
import { calcPushupMetrics } from './poseDetector';

// A rep's descent must last at least this long, and a full down→up cycle this
// long, before it counts. Stops MediaPipe jitter around the angle thresholds
// (and deliberate fast "twitching") from racking up bogus reps.
const MIN_DOWN_MS = 300;
const MIN_REP_MS = 600;

export function useRepCounter() {
  const [reps, setReps] = useState(0);
  const [formScore, setFormScore] = useState(100);
  const stateRef = useRef<RepState>('up');
  const formScoresRef = useRef<number[]>([]);
  const downAtRef = useRef(0);
  const lastRepAtRef = useRef(0);

  const processPose = useCallback(
    (landmarks: Landmark[]) => {
      const metrics = calcPushupMetrics(landmarks);
      if (!metrics) return;

      const { elbowAngle, backStraightness, depth, valid } = metrics;

      // Ignore frames where the body isn't in a legitimate, fully-tracked
      // pushup position — this is what blocks glitch/cheated reps.
      if (!valid) return;

      const now = performance.now();

      // Track back straightness during movement
      if (elbowAngle < 130) {
        formScoresRef.current.push(backStraightness);
      }

      // State machine
      if (stateRef.current === 'up' && elbowAngle < 85) {
        stateRef.current = 'down';
        downAtRef.current = now;
      } else if (stateRef.current === 'down' && elbowAngle > 150) {
        stateRef.current = 'up';

        // Debounce: reject reps that complete impossibly fast (jitter / cheese).
        if (now - downAtRef.current < MIN_DOWN_MS || now - lastRepAtRef.current < MIN_REP_MS) {
          formScoresRef.current = [];
          return;
        }
        lastRepAtRef.current = now;
        setReps((r) => r + 1);

        // Compute form score for this rep
        const scores = formScoresRef.current;
        if (scores.length > 0) {
          const avgBack = scores.reduce((a, b) => a + b, 0) / scores.length;
          // depth bonus: 50% weight each
          const repScore = avgBack * 0.6 + Math.min(100, depth) * 0.4;
          setFormScore((prev) => {
            const count = formScoresRef.current.length;
            return Math.round((prev * (count - 1) + repScore) / count);
          });
          formScoresRef.current = [];
        }
      }
    },
    []
  );

  const reset = useCallback(() => {
    setReps(0);
    setFormScore(100);
    stateRef.current = 'up';
    formScoresRef.current = [];
    downAtRef.current = 0;
    lastRepAtRef.current = 0;
  }, []);

  return { reps, formScore, processPose, reset };
}
