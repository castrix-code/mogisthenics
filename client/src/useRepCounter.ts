import { useRef, useState, useCallback } from 'react';
import type { RepState } from './poseDetector';
import { calcPushupMetrics } from './poseDetector';

export function useRepCounter() {
  const [reps, setReps] = useState(0);
  const [formScore, setFormScore] = useState(100);
  const stateRef = useRef<RepState>('up');
  const formScoresRef = useRef<number[]>([]);

  const processPose = useCallback(
    (landmarks: { x: number; y: number; z: number }[]) => {
      const metrics = calcPushupMetrics(landmarks);
      if (!metrics) return;

      const { elbowAngle, backStraightness, depth } = metrics;

      // Track back straightness during movement
      if (elbowAngle < 130) {
        formScoresRef.current.push(backStraightness);
      }

      // State machine
      if (stateRef.current === 'up' && elbowAngle < 85) {
        stateRef.current = 'down';
      } else if (stateRef.current === 'down' && elbowAngle > 150) {
        stateRef.current = 'up';
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
  }, []);

  return { reps, formScore, processPose, reset };
}
