"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

interface MetricTickerProps {
  label: string;
  value: string | number;
  unit?: string;
  subValue?: string;
  trend?: number;
  status?: "normal" | "warning" | "success";
}

export function MetricTicker({
  label,
  value,
  unit,
  subValue,
  trend,
  status = "normal",
}: MetricTickerProps) {
  const isPositive = trend && trend > 0;

  let statusColor = "text-content-1";
  if (status === "warning") statusColor = "text-warning-fg";
  if (status === "success") statusColor = "text-success-fg";

  return (
    <Card className="border shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardContent className="p-5">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-sm font-medium text-content-3 uppercase tracking-wide">
              {label}
            </h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span
                className={`text-3xl font-bold tracking-tight ${statusColor}`}
              >
                {typeof value === "number" ? value.toLocaleString() : value}
              </span>
              {unit && (
                <span className="text-sm font-medium text-content-4">
                  {unit}
                </span>
              )}
            </div>
            {subValue && (
              <p className="mt-2 text-xs font-medium text-content-3 bg-surface-2 inline-block px-2 py-1 rounded-md">
                {subValue}
              </p>
            )}
          </div>
          {trend !== undefined && (
            <div
              className={`flex items-center text-xs font-bold px-2 py-1 rounded-full ${isPositive ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}
            >
              {isPositive ? (
                <ArrowUpRight className="h-3 w-3 mr-1" />
              ) : (
                <ArrowDownRight className="h-3 w-3 mr-1" />
              )}
              {Math.abs(trend)}%
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
