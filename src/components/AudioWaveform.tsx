import { useEffect, useRef, memo } from "react";
import { cn } from "@/lib/utils";

interface AudioWaveformProps {
  levels: Uint8Array;
  isActive: boolean;
  variant: "input" | "output";
  className?: string;
}

export const AudioWaveform = memo(function AudioWaveform({
  levels,
  isActive,
  variant,
  className,
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const barCount = 24;
      const barWidth = (width - (barCount - 1) * 3) / barCount;
      const maxHeight = height * 0.8;

      // Colors based on variant
      const color = variant === "input" 
        ? "hsl(175, 80%, 45%)" 
        : "hsl(200, 75%, 50%)";
      const dimColor = variant === "input"
        ? "hsl(175, 30%, 70%)"
        : "hsl(200, 30%, 70%)";

      for (let i = 0; i < barCount; i++) {
        const levelIndex = Math.floor((i / barCount) * levels.length);
        const level = levels[levelIndex] || 0;
        const normalizedLevel = level / 255;
        
        // Smooth animation with some randomness when active
        let barHeight: number;
        if (isActive) {
          barHeight = Math.max(
            8,
            normalizedLevel * maxHeight + Math.sin(Date.now() / 200 + i) * 4
          );
        } else {
          barHeight = 4 + Math.sin(Date.now() / 1000 + i * 0.5) * 2;
        }

        const x = i * (barWidth + 3);
        const y = (height - barHeight) / 2;

        // Gradient effect
        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
        gradient.addColorStop(0, isActive ? color : dimColor);
        gradient.addColorStop(1, isActive ? color : dimColor);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [levels, isActive, variant]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={60}
      className={cn("w-full h-[60px]", className)}
    />
  );
});
