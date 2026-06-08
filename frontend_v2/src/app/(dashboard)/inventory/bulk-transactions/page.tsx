"use client";

import { useQuery } from "@tanstack/react-query";
import { inventoryService } from "@/services/inventory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  History,
  ArrowDownLeft,
  ArrowUpRight,
  Repeat,
  Settings2,
  ExternalLink,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDisplayDateTime } from "@/lib/date-format";

export default function BulkTransactionsPage() {
  const { data: transactions, isLoading } = useQuery({
    queryKey: ["bulk-transactions"],
    queryFn: () => inventoryService.getBulkTransactions(),
  });

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case "INWARD":
        return <ArrowDownLeft className="w-4 h-4 text-success-fg" />;
      case "CONSUME":
        return <ArrowUpRight className="w-4 h-4 text-danger-fg" />;
      case "TRANSFER":
        return <Repeat className="w-4 h-4 text-primary" />;
      case "ADJUST":
        return <Settings2 className="w-4 h-4 text-content-3" />;
      default:
        return null;
    }
  };

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case "INWARD":
        return (
          <Badge className="bg-success-bg text-success-fg border-success-border hover:bg-success-bg">
            Inward
          </Badge>
        );
      case "CONSUME":
        return (
          <Badge className="bg-danger-bg text-danger-fg border-danger-border hover:bg-danger-bg">
            Consumption
          </Badge>
        );
      case "TRANSFER":
        return (
          <Badge className="bg-info-bg text-primary border-info-border hover:bg-info-bg">
            Transfer
          </Badge>
        );
      case "ADJUST":
        return (
          <Badge className="bg-surface-2 text-content-2 border-line hover:bg-surface-2">
            Adjustment
          </Badge>
        );
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const formatQty = (tx: any) => {
    const uom = String(tx.stock_uom || tx.base_uom || "KG").toUpperCase();
    const decimals = uom === "KG" ? 2 : uom === "METER" ? 1 : 0;
    return `${tx.qty_kg > 0 ? "+" : ""}${Number(tx.qty_kg || 0).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${uom}`;
  };

  return (
    <div className="p-6 space-y-6 bg-surface-2 min-h-screen">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-content-1">
            Bulk Transactions
          </h1>
          <p className="text-content-3 mt-1">
            Detailed audit log of all pooled material movements.
          </p>
        </div>
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-surface-1 border-b border-line">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <History className="w-5 h-5 text-content-4" /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-surface-2">
              <TableRow className="hover:bg-transparent border-line">
                <TableHead className="w-[180px]">Date & Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-4 w-16 ml-auto" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                  </TableRow>
                ))
              ) : transactions?.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-32 text-center text-content-3"
                  >
                    No transactions recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                transactions?.map((tx) => (
                  <TableRow
                    key={tx.id}
                    className="hover:bg-surface-2 transition-colors"
                  >
                    <TableCell className="text-content-3 text-sm">
                      {formatDisplayDateTime(tx.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getTransactionIcon(tx.type)}
                        {getTransactionLabel(tx.type)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-content-1">
                          {tx.material_name}
                        </span>
                        <span className="text-xs text-content-3">
                          {tx.material_code}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-content-3">
                      {tx.location_name}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-semibold ${tx.qty_kg > 0 ? "text-success-fg" : "text-danger-fg"}`}
                    >
                      {formatQty(tx)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-content-3 text-sm max-w-[200px] truncate">
                        {tx.job_no ? (
                          <div className="flex items-center gap-1 text-primary font-medium">
                            <span className="hover:underline cursor-pointer">
                              Job: {tx.job_no}
                            </span>
                            <ExternalLink className="w-3 h-3" />
                          </div>
                        ) : (
                          <span className="italic uppercase text-content-4 text-xs">
                            {tx.reference || "System Auto"}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
