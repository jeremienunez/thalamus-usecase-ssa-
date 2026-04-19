type SkeletonProps = {
  className?: string;
  width?: string | number;
  height?: string | number;
};

export function Skeleton({ className = "", width, height }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-shimmer ${className}`}
      style={{
        width,
        height,
        background:
          "linear-gradient(90deg, rgba(28,35,45,0.6) 0%, rgba(45,55,72,0.9) 50%, rgba(28,35,45,0.6) 100%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
}

export function FullPaneFallback({ label = "INITIALIZING" }: { label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-base">
      <div className="flex items-center gap-3">
        <span className="h-1.5 w-1.5 animate-ping bg-cyan" />
        <span className="mono text-label text-cyan tracking-widest">{label}</span>
      </div>
    </div>
  );
}
