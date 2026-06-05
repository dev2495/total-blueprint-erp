"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  type ProfileChangeRequest,
  systemUserService,
} from "@/services/system-users";

type FilterState = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

function getErrorDetail(error: unknown) {
  const maybe = error as {
    response?: { data?: { detail?: string; message?: string } };
    message?: string;
  };
  const detail = maybe?.response?.data?.detail;
  if (Array.isArray(detail)) return detail.join(", ");
  return (
    detail ||
    maybe?.response?.data?.message ||
    maybe?.message ||
    "Could not review request."
  );
}

export function ProfileApprovalsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterState>("PENDING");
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  const requestsQuery = useQuery({
    queryKey: ["governance-profile-change-requests"],
    queryFn: () => systemUserService.getProfileChangeRequests(),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      requestId,
      decision,
      notes,
    }: {
      requestId: string;
      decision: "APPROVE" | "REJECT";
      notes: string;
    }) =>
      systemUserService.reviewProfileChangeRequest(requestId, decision, notes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["governance-profile-change-requests"],
      });
      toast({ title: "Request reviewed" });
    },
    onError: (error: unknown) => {
      toast({
        title: "Review failed",
        description: getErrorDetail(error),
        variant: "destructive",
      });
    },
  });

  const rows = useMemo(() => {
    const allRows = requestsQuery.data || [];
    if (filter === "ALL") return allRows;
    return allRows.filter((row) => row.status === filter);
  }, [filter, requestsQuery.data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Profile Approvals</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void requestsQuery.refetch()}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["PENDING", "APPROVED", "REJECTED", "ALL"] as FilterState[]).map(
            (value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "default" : "outline"}
                onClick={() => setFilter(value)}
              >
                {value}
              </Button>
            ),
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requestor</TableHead>
              <TableHead>Requested changes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Review note</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row: ProfileChangeRequest) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">
                    {row.requested_by_username || row.requested_by}
                  </div>
                  <div className="text-xs text-content-3">
                    {row.target_username || row.target_user}
                  </div>
                </TableCell>
                <TableCell className="max-w-[340px] text-xs text-content-3">
                  {Object.entries(row.requested_changes || {})
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(" | ") || "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      row.status === "APPROVED" ? "outline" : "secondary"
                    }
                  >
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {formatDateTime(row.created_at)}
                </TableCell>
                <TableCell className="min-w-[220px]">
                  <Input
                    value={notesById[row.id] ?? row.review_notes ?? ""}
                    placeholder="Optional review note"
                    onChange={(e) =>
                      setNotesById((prev) => ({
                        ...prev,
                        [row.id]: e.target.value,
                      }))
                    }
                    disabled={row.status !== "PENDING"}
                  />
                </TableCell>
                <TableCell className="text-right">
                  {row.status === "PENDING" ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          reviewMutation.mutate({
                            requestId: row.id,
                            decision: "APPROVE",
                            notes: notesById[row.id] ?? "",
                          })
                        }
                        disabled={reviewMutation.isPending}
                      >
                        {reviewMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Approve"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          reviewMutation.mutate({
                            requestId: row.id,
                            decision: "REJECT",
                            notes: notesById[row.id] ?? "",
                          })
                        }
                        disabled={reviewMutation.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-content-3">
                      {formatDateTime(row.reviewed_at)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-content-3"
                >
                  No profile requests for selected filter.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
