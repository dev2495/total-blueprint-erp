import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Factory, Activity, AlertTriangle } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { analyticsApi } from "@/services/analytics";

interface WorkCenterData {
  work_center: {
    id: string;
    name: string;
    code: string;
  };
  kpis: {
    oee_avg: number;
    total_output_kg: number;
    total_scrap_kg: number;
    total_downtime_minutes: number;
  };
  charts?: {
    trend: { date: string; output: number; scrap: number }[];
  };
  machines: any[];
}

export function WorkCenterPerformanceReport({
  wcId,
  onBack,
  onSelectMachine,
}: {
  wcId: string;
  onBack: () => void;
  onSelectMachine: (id: string) => void;
}) {
  const [data, setData] = useState<WorkCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wcId) return;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const json = await analyticsApi.getWorkCenterReport(wcId);
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
        }
      } catch (err) {
        console.error("Failed to load WC report", err);
        setError("Failed to load report data. Please check your connection.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [wcId]);

  if (loading)
    return (
      <div className="p-8 text-center animate-pulse text-muted-foreground">
        Loading Work Center Analytics...
      </div>
    );
  if (error)
    return (
      <div className="p-8 text-center">
        <div className="text-danger-fg font-medium mb-2">
          Unable to load report
        </div>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={onBack} className="mt-4">
          Go Back
        </Button>
      </div>
    );
  if (!data) return null;

  const { work_center, kpis, machines, charts } = data;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {work_center.name}
          </h2>
          <p className="text-muted-foreground">
            Work Center Performance Overview
          </p>
        </div>
      </div>

      {/* Aggregated KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg OEE</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${kpis.oee_avg >= 85 ? "text-success-fg" : "text-warning-fg"}`}
            >
              {kpis.oee_avg}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Output</CardTitle>
            <Factory className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.total_output_kg.toLocaleString()} kg
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Scrap</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.total_scrap_kg.toLocaleString()} kg
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Downtime
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.total_downtime_minutes} min
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Work Center Trend Chart */}
      {charts?.trend && charts.trend.length > 0 && (
        <Card className="border-line shadow-sm">
          <CardHeader>
            <CardTitle>Work Center Output Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={charts.trend}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="colorWcOutput"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e2e8f0"
                />
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value}kg`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#fff",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                  itemStyle={{ color: "#1e293b" }}
                />
                <Area
                  type="monotone"
                  dataKey="output"
                  stroke="#60a5fa"
                  fillOpacity={1}
                  fill="url(#colorWcOutput)"
                  strokeWidth={2}
                  name="Output (kg)"
                />
                <Area
                  type="monotone"
                  dataKey="scrap"
                  stroke="#ef4444"
                  fill="none"
                  strokeWidth={2}
                  name="Scrap (kg)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Machine Grid */}
      <h3 className="text-lg font-semibold mt-8 mb-4">Machine Breakdown</h3>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {machines.map((m) => (
          <Card
            key={m.machine.id}
            className="cursor-pointer hover:shadow-md transition-all border-l-4"
            style={{
              borderLeftColor:
                m.machine.status === "ACTIVE" ? "#22c55e" : "#ef4444",
            }}
            onClick={() => onSelectMachine(m.machine.id)}
          >
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <CardTitle className="text-base font-semibold">
                  {m.machine.name}
                </CardTitle>
                <Badge
                  variant={
                    m.machine.status === "ACTIVE" ? "outline" : "destructive"
                  }
                >
                  {m.machine.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{m.machine.code}</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">OEE:</span>
                  <span className="font-medium ml-1">{m.kpis.oee}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Output:</span>
                  <span className="font-medium ml-1">
                    {m.kpis.total_output_kg} kg
                  </span>
                </div>
                <div className="col-span-2 text-xs text-muted-foreground mt-2">
                  Operator: {m.machine.operator}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
