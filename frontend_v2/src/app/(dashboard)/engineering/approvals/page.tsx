"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { templateService } from "@/services/templates";

export default function EngineeringApprovalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates", "engineering"],
    queryFn: () => templateService.getTemplates({ status: "ENGINEERING" }),
  });

  const approveMutation = useMutation({
    mutationFn: templateService.approveTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast({
        title: "Approved",
        description:
          "Template is approved and ready for workflow review before going LIVE.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Approval Failed",
        description:
          err.response?.data?.detail || err.message || "Validation failed.",
        variant: "destructive",
      });
    },
  });

  const filtered = (Array.isArray(templates) ? templates : []).filter((t) =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="p-6 lg:p-8 space-y-8 bg-[#f8fafc] min-h-screen">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-warm border border-warning-border text-warm text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
            <ShieldCheck className="h-3 w-3" /> QA & Release
          </div>
          <h1 className="text-3xl font-black tracking-tight text-content-1 flex items-center gap-3">
            Pending
            <span className="text-content-4 font-light translate-y-[2px]">
              /
            </span>
            <span className="text-warm italic">Approvals</span>
          </h1>
          <p className="text-content-3 font-medium text-xs flex items-center gap-2 italic">
            Review and release finalized blueprints to Sales
          </p>
        </div>
      </div>

      <Card className="border-none shadow-premium rounded-[2rem] bg-surface-1 overflow-hidden min-h-[500px]">
        <CardHeader className="p-6 pb-2 border-b border-line bg-surface-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="text-lg font-black tracking-tight text-content-1 uppercase italic">
              Review Queue
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-content-4" />
              <Input
                placeholder="Search pending..."
                className="pl-10 h-10 w-[250px] rounded-xl border-line bg-surface-1 font-bold text-xs shadow-sm focus:border-warning-border transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-surface-2">
              <TableRow className="border-none hover:bg-transparent">
                <TableHead className="px-6 text-[9px] font-black uppercase text-content-4 italic tracking-widest w-[40%]">
                  Product Snapshot
                </TableHead>
                <TableHead className="text-[9px] font-black uppercase text-content-4 italic tracking-widest w-[30%]">
                  Route & Integrity
                </TableHead>
                <TableHead className="text-right px-6 text-[9px] font-black uppercase text-content-4 italic tracking-widest">
                  Decision
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-20">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-center py-24 text-[11px] font-black uppercase text-content-4 italic tracking-[0.2em]"
                  >
                    No pending approvals
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((t) => {
                  return (
                    <TableRow
                      key={t.id}
                      className="hover:bg-surface-2 transition-colors border-b border-line"
                    >
                      <TableCell className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-content-1 uppercase tracking-tight text-xs">
                              {t.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[9px] border-line text-content-3 h-5 px-1"
                            >
                              {t.fg_type}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-content-3 font-medium">
                            <span className="flex items-center gap-1 bg-surface-2 px-1.5 py-0.5 rounded-md">
                              Route: {t.routing_rule_name || "Unassigned"}
                            </span>
                            <span className="font-mono text-[9px] text-content-4">
                              {t.id.slice(0, 8)}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            {t.routing_rule ? (
                              <Badge
                                variant="default"
                                className="bg-info-bg hover:bg-info-bg text-primary border border-info-border text-[9px] h-5"
                              >
                                Route Bound
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-content-4 text-[9px] h-5"
                              >
                                No Route
                              </Badge>
                            )}
                          </div>

                          {/* Integrity Check */}
                          <div className="flex items-center gap-2">
                            {t.routing_rule ? (
                              <span className="text-[9px] text-content-4 flex items-center gap-1">
                                <div className="h-1.5 w-1.5 rounded-full bg-success-fg" />{" "}
                                Routing Info
                              </span>
                            ) : (
                              <span className="text-[9px] text-danger-fg font-bold flex items-center gap-1">
                                <div className="h-1.5 w-1.5 rounded-full bg-danger-solid" />{" "}
                                No Routing Rule
                              </span>
                            )}
                          </div>
                          <p className="text-[9px] text-content-4">
                            Bulk category mapping and roll policy are maintained
                            in Template Studio.
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right px-6">
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/engineering/templates/${t.id}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-[10px] uppercase font-bold hover:bg-surface-2"
                            >
                              Review
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            className="h-8 bg-surface-3 hover:bg-success-fg text-white text-[10px] uppercase font-black tracking-widest shadow-lg "
                            disabled={approveMutation.isPending}
                            onClick={() => approveMutation.mutate(t.id)}
                          >
                            {approveMutation.isPending
                              ? "Signing..."
                              : "Approve"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
