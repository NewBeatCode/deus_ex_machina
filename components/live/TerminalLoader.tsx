"use client";

import { useEffect, useState, useRef } from "react";

export interface LoadingStep {
  id: string;
  label: string;
  status: "pending" | "loading" | "completed" | "error";
}

interface TerminalLoaderProps {
  steps: LoadingStep[];
  onComplete?: () => void;
  isLoaded?: boolean;
  stats?: {
    fps: string;
    faces: number;
    hands: number;
    bodies: number;
    objects: number;
    cells: number;
    uptime: string;
    simulation: {
      generation: number;
      density: string;
      peakPop: number;
      avgPop: number;
      rule: string;
      seed: string;
    };
    styles: {
      stability: string;
      period: number;
    };
    interaction: {
      injections: number;
      simSpeed: number;
      lastGesture: string;
      interactionRate: number;
    };
    confidence: {
      faces: number;
      hands: number;
      bodies: number;
    };
  };
}

export const TerminalLoader = ({
  steps,
  onComplete,
  isLoaded,
  stats,
}: TerminalLoaderProps) => {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [stepProgress, setStepProgress] = useState(0);
  const [completedIndices, setCompletedIndices] = useState<number[]>([]);
  const [isExiting, setIsExiting] = useState(false);
  const finishedRef = useRef(false);

  // Sequential loading animation
  useEffect(() => {
    if (isLoaded) return;

    if (activeStepIndex < steps.length) {
      const currentStep = steps[activeStepIndex];

      // If the true step is done and fake progress reached 100%, move on
      if (
        (currentStep.status === "completed" ||
          currentStep.status === "error") &&
        stepProgress === 100
      ) {
        const timeout = setTimeout(() => {
          setCompletedIndices((prevComp) => [...prevComp, activeStepIndex]);
          setActiveStepIndex((prevIdx) => prevIdx + 1);
          setStepProgress(0);
        }, 100);
        return () => clearTimeout(timeout);
      }

      // Animate progress bar for the current step
      const interval = setInterval(() => {
        setStepProgress((prev) => {
          if (
            currentStep.status === "completed" ||
            currentStep.status === "error"
          ) {
            return 100;
          }
          if (prev >= 99) {
            return 99; // Hang at 99% until the true status is completed
          }
          return prev + 5; // Speed of the fake progress bar
        });
      }, 50);
      return () => clearInterval(interval);
    } else if (!finishedRef.current) {
      // All UI steps complete, check if models are actually loaded
      const allActuallyDone = steps.every(
        (s) => s.status === "completed" || s.status === "error",
      );
      if (allActuallyDone) {
        finishedRef.current = true;
        setIsExiting(true);
        setTimeout(() => {
          onComplete?.();
        }, 500);
      }
    }
  }, [activeStepIndex, steps, stepProgress, onComplete, isLoaded]);

  const containerStyle =
    "fixed top-4 left-4 z-[100] font-mono text-white text-[10px] sm:text-xs text-left leading-tight pointer-events-none";

  if (isLoaded && stats) {
    return <StatsDisplay stats={stats} containerStyle={containerStyle} />;
  }

  return (
    <div
      className={`${containerStyle} transition-all duration-700 ease-in-out ${isExiting ? "-translate-y-10 opacity-0" : "translate-y-0 opacity-100"}`}
    >
      {steps.map((step, index) => {
        if (index > activeStepIndex) return null;

        const isCurrent = index === activeStepIndex;
        const isDone =
          completedIndices.includes(index) || index < activeStepIndex;
        const progress = isDone ? 100 : isCurrent ? stepProgress : 0;

        return (
          <div key={step.id} className="flex gap-4">
            <span className="min-w-[100px]">
              <Typewriter text={step.label} />
            </span>
            <span>{progress}%</span>
            <span>{isDone ? "done" : "..."}</span>
          </div>
        );
      })}
    </div>
  );
};

const StatsDisplay = ({
  stats,
  containerStyle,
}: {
  stats: NonNullable<TerminalLoaderProps["stats"]>;
  containerStyle: string;
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Small timeout to ensure transition plays
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`${containerStyle} transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
    >
      <div className="grid grid-cols-1 gap-0.5 pointer-events-none select-none">
        {/* Core Stats */}
        <div className="flex gap-3">
          <Typewriter text={`fps:${stats.fps}`} />
          <Typewriter text={`simSpeed:${stats.interaction.simSpeed}`} />
          <Typewriter text={`gen:${stats.simulation.generation}`} />
          <Typewriter text={`uptime:${stats.uptime}s`} />
        </div>

        {/* Population Metrics */}
        <div className="flex gap-3">
          <Typewriter text={`alive:${stats.cells.toLocaleString()}`} />
          <Typewriter text={`density:${stats.simulation.density}%`} />
          <Typewriter
            text={`peak:${stats.simulation.peakPop.toLocaleString()}`}
          />
        </div>

        {/* Grid & Rules */}
        <div className="flex gap-3">
          <Typewriter text={`seed:${stats.simulation.seed}`} />
          <Typewriter text={`rule:${stats.simulation.rule}`} />
          <Typewriter text={`stability:${stats.styles.stability}`} />
        </div>

        {/* Interaction & Vision */}
        <div className="flex gap-3">
          <Typewriter text={`faces:${stats.faces}`} />
          <Typewriter text={`hands:${stats.hands}`} />
          <Typewriter text={`bodies:${stats.bodies}`} />
          <Typewriter text={`objs:${stats.objects}`} />
          <Typewriter text={`last:${stats.interaction.lastGesture}`} />
          <Typewriter text={`inj:${stats.interaction.injections}`} />
        </div>

        {/* Debug/Confidence (Optional/Lower visibility) */}
        <div className="flex gap-3 opacity-50 mt-1">
          <Typewriter text={`conf[h]:${stats.confidence.hands}%`} />
          <Typewriter text={`conf[b]:${stats.confidence.bodies}%`} />
        </div>
      </div>
    </div>
  );
};

const Typewriter = ({ text }: { text: string }) => {
  const [displayLength, setDisplayLength] = useState(0);

  useEffect(() => {
    // If text changes, we want to ensure we show at least what we had,
    // or keep typing if not done.
    const intervalId = setInterval(
      () => {
        setDisplayLength((prev) => {
          if (prev >= text.length) {
            return prev; // Stop incrementing
          }
          return prev + 1;
        });
      },
      30 + Math.random() * 20,
    );

    return () => clearInterval(intervalId);
  }, [text]);

  return <span>{text.slice(0, displayLength)}</span>;
};
