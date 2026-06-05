"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Microscope,
  Palette,
  Disc,
  FileText,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { StatsGrid } from "@/components/dashboard/stats-grid";

export default function EngineeringDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["engineering-dashboard-stats"],
    queryFn: async () => {
      return {
        metrics: [
          {
            label: "Pending Artworks",
            value: "4",
            unit: "To Review",
            trend: 2,
          },
          { label: "Cylinder Maint.", value: "2", unit: "Due Soon", trend: 0 },
          { label: "Routing Approvals", value: "5", unit: "Pending", trend: 1 },
          { label: "Active BOMs", value: "142", unit: "Master Data", trend: 0 },
        ],
      };
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-content-1 tracking-tight">
            Engineering Hub
          </h1>
          <p className="text-content-3 font-medium">
            Product Design & Master Data Management
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/engineering/artworks/new">
            <Button className="bg-primary hover:bg-primary">
              <Palette className="mr-2 h-4 w-4" /> New Artwork
            </Button>
          </Link>
          <Link href="/engineering/cylinders/new">
            <Button variant="outline">
              <Disc className="mr-2 h-4 w-4" /> New Cylinder
            </Button>
          </Link>
        </div>
      </div>

      <StatsGrid metrics={stats?.metrics || []} />

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Approvals Queue</CardTitle>
            <CardDescription>
              Items awaiting engineering sign-off
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3].map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-surface-2 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-info-bg text-primary flex items-center justify-center">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-content-1">
                      New Template Spec #{100 + i}
                    </p>
                    <p className="text-xs text-content-3">
                      For: Apex Foods • Submitted by Sales
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-8">
                  Review
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Catalog Health</CardTitle>
            <CardDescription>Master data status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-success-bg rounded-xl border border-success-border">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-success-fg" />
                  <span className="text-xs font-bold text-success-fg uppercase">
                    Artworks
                  </span>
                </div>
                <p className="text-2xl font-black text-content-1">98%</p>
                <p className="text-xs text-content-3">Validated & Active</p>
              </div>
              <div className="p-4 bg-info-bg rounded-xl border border-info-border">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="text-xs font-bold text-primary uppercase">
                    BOMs
                  </span>
                </div>
                <p className="text-2xl font-black text-content-1">100%</p>
                <p className="text-xs text-content-3">Routing Coverage</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
