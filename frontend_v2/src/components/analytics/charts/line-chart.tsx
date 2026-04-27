"use client"

import {
    LineChart as RechartsLineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts"

interface LineChartProps {
    data: any[]
    xKey: string
    yKey: string
    color?: string
}

export function LineChart({ data, xKey, yKey, color = "#2563eb" }: LineChartProps) {
    if (!data || data.length === 0) {
        return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data available</div>
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <RechartsLineChart
                data={data}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                    dataKey={xKey}
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                />
                <YAxis
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value}`}
                />
                <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                    cursor={{ stroke: '#9ca3af', strokeWidth: 1 }}
                />
                <Line
                    type="monotone"
                    dataKey={yKey}
                    stroke={color}
                    strokeWidth={2}
                    activeDot={{ r: 4 }}
                    dot={false}
                />
            </RechartsLineChart>
        </ResponsiveContainer>
    )
}
