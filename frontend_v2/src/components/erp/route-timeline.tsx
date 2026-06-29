"use client";

import * as React from "react";
import { ArrowRight, Flag, GitBranch, GitMerge, MapPin, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RouteTimelineStep {
  index: number;
  label: string;
  transition?: string;
  /** Whether this step is the first artwork-bearing step. */
  artwork_step?: boolean;
  /** Render a small process tag below the label. */
  tag?: string;
  routeNodeId?: string;
  branchKey?: string;
  joinKey?: string;
  parallelGroup?: string;
  predecessorNodeIds?: string[];
  successorNodeIds?: string[];
  isJoin?: boolean;
  isParallelStart?: boolean;
}

interface RouteTimelineProps {
  steps: RouteTimelineStep[];
  startIndex?: number;
  stopIndex?: number;
  onSelectStop?: (index: number) => void;
  onSelectStart?: (index: number) => void;
  showStartEnd?: boolean;
  helperText?: string;
  className?: string;
}

export function RouteTimeline({
  steps,
  startIndex,
  stopIndex,
  onSelectStop,
  onSelectStart,
  showStartEnd = true,
  helperText,
  className,
}: RouteTimelineProps) {
  const stages = React.useMemo(() => {
    const grouped = new Map<number, RouteTimelineStep[]>();
    for (const step of steps) {
      const key = Number(step.index);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(step);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .map(([index, stageSteps]) => ({
        index,
        steps: stageSteps.sort((a, b) =>
          String(a.branchKey || "MAIN").localeCompare(String(b.branchKey || "MAIN")),
        ),
      }));
  }, [steps]);

  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface-1 p-5",
        className,
      )}
    >
      {stages.length ? <RouteGraphSvg stages={stages} /> : null}
      <div className="flex flex-wrap items-stretch gap-2">
        {showStartEnd ? (
          <RouteEndCap label="Start" icon={<Flag className="h-3.5 w-3.5" />} />
        ) : null}
        {stages.map((stage, i) => {
          const isStageStart = startIndex === stage.index;
          const isStageStop = stopIndex === stage.index;
          const isStageInside =
            startIndex != null &&
            stopIndex != null &&
            stage.index > startIndex &&
            stage.index < stopIndex;
          const isParallel = stage.steps.length > 1;
          return (
            <React.Fragment key={`stage-${stage.index}`}>
              <div
                className={cn(
                  "flex min-w-[160px] flex-1 flex-col rounded-xl border p-2 transition",
                  isStageStop
                    ? "border-primary bg-info-bg text-primary ring-2 ring-info-border"
                    : isStageStart
                      ? "border-success-border bg-success-bg text-success-fg"
                      : isStageInside
                        ? "border-info-border bg-info-bg text-content-2"
                        : "border-line bg-surface-1 text-content-2 hover:border-info-border hover:bg-info-bg",
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <span className="font-mono text-[10px] font-black uppercase tracking-wider text-content-4">
                    Stage {stage.index}
                  </span>
                  {isParallel ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-order-bg px-2 py-0.5 text-[10px] font-black text-order-fg ring-1 ring-order-border">
                      <GitBranch className="h-3 w-3" /> + parallel
                    </span>
                  ) : null}
                </div>
                <div className={cn("grid gap-2", isParallel ? "grid-cols-1" : "grid-cols-1")}>
                  {stage.steps.map((s) => (
                    <RouteStepButton
                      key={`${s.index}-${s.routeNodeId || s.label}-${s.branchKey || "MAIN"}`}
                      step={s}
                      isStart={isStageStart}
                      isStop={isStageStop}
                      isInside={isStageInside}
                      onSelectStop={onSelectStop}
                      onSelectStart={onSelectStart}
                    />
                  ))}
                </div>
              </div>
              {i < stages.length - 1 ? (
                <ArrowRight className="my-auto hidden h-4 w-4 flex-none text-content-4 sm:block" />
              ) : null}
            </React.Fragment>
          );
        })}
        {showStartEnd ? <RouteEndCap label="End" /> : null}
      </div>
      {helperText ? (
        <p className="mt-3 text-[11px] font-medium text-content-3">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

function RouteGraphSvg({
  stages,
}: {
  stages: Array<{ index: number; steps: RouteTimelineStep[] }>;
}) {
  const branches = Array.from(
    new Set(
      stages.flatMap((stage) =>
        stage.steps.map((step) => String(step.branchKey || "MAIN")),
      ),
    ),
  ).sort((a, b) => (a === "MAIN" ? -1 : b === "MAIN" ? 1 : a.localeCompare(b)));
  const width = Math.max(520, stages.length * 156);
  const height = Math.max(92, branches.length * 42 + 52);
  const xFor = (stageIndex: number) => 44 + stageIndex * 150;
  const yFor = (branch: string) => 36 + branches.indexOf(branch) * 42;
  return (
    <div
      data-testid="route-graph"
      className="mb-4 overflow-x-auto rounded-xl border border-info-border bg-info-bg/60 p-3"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[110px] min-w-[620px] text-content-3"
        role="img"
        aria-label="Route graph"
      >
        <defs>
          <marker
            id="route-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
          </marker>
        </defs>
        {branches.map((branch) => (
          <g key={`lane-${branch}`}>
            <text
              x="2"
              y={yFor(branch) + 4}
              className="fill-current font-mono text-[9px] font-black uppercase"
            >
              {branch}
            </text>
            <line
              x1="42"
              x2={width - 32}
              y1={yFor(branch)}
              y2={yFor(branch)}
              stroke="currentColor"
              strokeDasharray={branch === "MAIN" ? "0" : "4 5"}
              strokeOpacity="0.24"
            />
          </g>
        ))}
        {stages.slice(1).map((stage, index) => {
          const previous = stages[index];
          const x1 = xFor(index) + 38;
          const x2 = xFor(index + 1) - 38;
          return stage.steps.map((step) => {
            const branch = String(step.branchKey || "MAIN");
            const previousBranch = previous.steps.some(
              (item) => String(item.branchKey || "MAIN") === branch,
            )
              ? branch
              : "MAIN";
            return (
              <path
                key={`edge-${stage.index}-${step.routeNodeId || step.label}-${branch}`}
                d={`M ${x1} ${yFor(previousBranch)} C ${x1 + 42} ${yFor(previousBranch)}, ${x2 - 42} ${yFor(branch)}, ${x2} ${yFor(branch)}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeOpacity="0.46"
                markerEnd="url(#route-arrow)"
              />
            );
          });
        })}
        {stages.map((stage, stageIndex) =>
          stage.steps.map((step) => {
            const branch = String(step.branchKey || "MAIN");
            const x = xFor(stageIndex);
            const y = yFor(branch);
            const isSpecial = step.artwork_step || step.isJoin || step.isParallelStart;
            return (
              <g key={`node-${stage.index}-${step.routeNodeId || step.label}-${branch}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={isSpecial ? 15 : 12}
                  className={cn(
                    step.artwork_step
                      ? "fill-[var(--accent-order-fg)]"
                      : step.isJoin
                        ? "fill-[var(--success-fg)]"
                        : step.isParallelStart
                          ? "fill-[var(--info-fg)]"
                          : "fill-[var(--surface-1)]",
                  )}
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  className={cn(
                    "font-mono text-[10px] font-black",
                    isSpecial
                      ? "fill-[var(--text-on-brand)]"
                      : "fill-[var(--content-1)]",
                  )}
                >
                  {stage.index}
                </text>
                <text
                  x={x}
                  y={y + 28}
                  textAnchor="middle"
                  className="fill-[var(--content-2)] text-[9px] font-black"
                >
                  {shortStepLabel(step)}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

function shortStepLabel(step: RouteTimelineStep) {
  const label = String(step.label || step.tag || "").trim();
  if (!label) return "Step";
  return label.length > 16 ? `${label.slice(0, 15)}...` : label;
}

function RouteStepButton({
  step,
  isStart,
  isStop,
  isInside,
  onSelectStop,
  onSelectStart,
}: {
  step: RouteTimelineStep;
  isStart: boolean;
  isStop: boolean;
  isInside: boolean;
  onSelectStop?: (index: number) => void;
  onSelectStart?: (index: number) => void;
}) {
  const branch = String(step.branchKey || "MAIN").trim() || "MAIN";
  return (
    <button
      type="button"
      onClick={() => onSelectStop?.(step.index)}
      onDoubleClick={() => onSelectStart?.(step.index)}
      className={cn(
        "group flex min-h-[92px] flex-col items-start rounded-lg border px-3 py-2 text-left transition",
        isStop
          ? "border-primary bg-surface-1 text-primary shadow-sm"
          : isStart
            ? "border-success-border bg-surface-1 text-success-fg"
            : isInside
              ? "border-info-border bg-surface-1 text-content-2"
              : "border-line bg-surface-1 text-content-2 hover:border-info-border hover:bg-info-bg",
      )}
    >
      <span className="flex w-full min-w-0 items-start gap-1.5 text-xs font-bold">
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px]",
            isStop
              ? "bg-primary text-white"
              : isStart
                ? "bg-success-fg text-white"
                : "bg-surface-2 text-content-3",
          )}
        >
          {step.index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-content-1">{step.label}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {branch !== "MAIN" ? (
              <span className="rounded-full bg-info-bg px-1.5 py-0.5 text-[9px] font-black uppercase text-primary ring-1 ring-info-border">
                {branch}
              </span>
            ) : null}
            {step.parallelGroup ? (
              <span className="rounded-full bg-order-bg px-1.5 py-0.5 text-[9px] font-black uppercase text-order-fg ring-1 ring-order-border">
                {step.parallelGroup}
              </span>
            ) : null}
            {step.isJoin || step.joinKey ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-1.5 py-0.5 text-[9px] font-black uppercase text-success-fg ring-1 ring-success-border">
                <GitMerge className="h-2.5 w-2.5" /> {step.joinKey || "Join"}
              </span>
            ) : null}
            {step.artwork_step ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-order-bg px-1.5 py-0.5 text-[9px] font-black uppercase text-order-fg ring-1 ring-order-border">
                <Palette className="h-2.5 w-2.5" /> Art
              </span>
            ) : null}
          </span>
        </span>
      </span>
      {step.transition || step.tag ? (
        <span className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-content-4">
          {step.transition || step.tag}
        </span>
      ) : null}
      {isStop ? (
        <span className="mt-auto inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-[10px] font-bold text-primary">
          <MapPin className="h-3 w-3" /> Stop
        </span>
      ) : null}
    </button>
  );
}

function RouteEndCap({
  label,
  icon,
}: {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex w-16 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-content-4">
      {icon}
      {label}
    </div>
  );
}
