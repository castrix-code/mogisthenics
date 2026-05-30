import { useCallback, useRef, useState } from 'react';
import { getPoseById, scorePose } from './poses';

// Scores a held pose over the round. The live score is the current match;
// the final score is the time-weighted average once enough frames are in,
// rewarding athletes who reach AND sustain the pose.
export function usePoseHold(poseId: string | null) {
  const [liveScore, setLiveScore] = useState(0);
  const [perCheck, setPerCheck] = useState<{ label: string; score: number }[]>([]);
  const sumRef = useRef(0);
  const countRef = useRef(0);
  const [finalScore, setFinalScore] = useState(0);

  const processPose = useCallback(
    (landmarks: { x: number; y: number; z: number }[]) => {
      if (!poseId) return;
      const template = getPoseById(poseId);
      if (!template) return;
      const result = scorePose(template, landmarks);
      if (!result) return;

      setLiveScore(result.score);
      setPerCheck(result.perCheck);

      sumRef.current += result.score;
      countRef.current += 1;
      setFinalScore(Math.round(sumRef.current / countRef.current));
    },
    [poseId]
  );

  const reset = useCallback(() => {
    setLiveScore(0);
    setFinalScore(0);
    setPerCheck([]);
    sumRef.current = 0;
    countRef.current = 0;
  }, []);

  return { liveScore, finalScore, perCheck, processPose, reset };
}
