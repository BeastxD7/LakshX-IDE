"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const chartConfig = {
  cost_usd: { label: "Spend ($)", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

export function SpendChart({ data }: { data: { day: string; cost_usd: number; requests: number }[] }) {
  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle>Spend over time</CardTitle>
        <CardDescription>Daily cost against the Azure credit, last {data.length} days with activity</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No usage recorded yet.</p>
        ) : (
          <ChartContainer config={chartConfig} className="h-[240px] w-full">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="fillCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    formatter={(value) => `$${Number(value).toFixed(4)}`}
                  />
                }
              />
              <Area dataKey="cost_usd" type="monotone" fill="url(#fillCost)" stroke="var(--color-chart-1)" strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
