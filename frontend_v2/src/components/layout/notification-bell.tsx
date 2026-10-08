"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  X,
  CheckCheck,
  ExternalLink,
  AlertTriangle,
  Package,
  Truck,
  Gauge,
  Clock,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  NotificationService,
  type Notification,
} from "@/services/notifications";
import { gateBillsApi } from "@/services/gate-bills";
import { useAuth } from "@/components/auth-provider";
import { canReviewGateBills } from "@/components/gate/gate-access";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, React.ElementType> = {
  FG_READY: Package,
  CHALLAN_CREATED: Truck,
  PACKING_READY: Package,
  DISPATCH_READY: Truck,
  LOW_STOCK: AlertTriangle,
  SCRAP_HIGH: Gauge,
  DELAYED_JOB: Clock,
  JOB_COMPLETE: CheckCheck,
  ORDER_CREATED: Package,
  SYSTEM: Bell,
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "bg-surface-2 text-content-2",
  NORMAL: "bg-info-bg text-primary",
  HIGH: "bg-warning-bg text-warning-fg",
  URGENT: "bg-danger-bg text-danger-fg",
};

/** General unread poll (all users). Gate-bill reviewers additionally poll the bill summary at 5 s. */
const GENERAL_POLL_MS = 120_000;
const BILL_POLL_MS = 5_000;

const isBillAlert = (n: Notification) =>
  n.related_object_type === "GateInwardBill" || n.event_key === "gate.inward_bill_uploaded";

/** Only follow in-app relative routes from the server; never external URLs. */
function safeDeepLink(link?: string) {
  if (!link || !link.startsWith("/") || link.startsWith("//") || /[\\\x00-\x1f]/.test(link)) return "";
  return link;
}

export function NotificationBell({
  triggerTestId = "notification-bell-trigger",
}: {
  triggerTestId?: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, effectiveRole } = useAuth();
  const billReviewer = Boolean(user) && canReviewGateBills(user, effectiveRole);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Both bells share requests within one account/role context. A role preview
  // or account change must never reuse another context's private alert cache.
  const scope = [user?.id, effectiveRole, billReviewer] as const;
  const listKey = ["notifications", "list", ...scope] as const;
  const unreadQ = useQuery({
    queryKey: ["notifications", "unread-count", ...scope],
    queryFn: () => NotificationService.getUnreadCount(),
    enabled: Boolean(user),
    refetchInterval: GENERAL_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
    meta: { suppressGlobalError: true },
  });

  const billQ = useQuery({
    queryKey: ["notifications", "inward-bill-summary", ...scope],
    queryFn: () => gateBillsApi.summary(),
    enabled: billReviewer,
    refetchInterval: BILL_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
    meta: { suppressGlobalError: true },
  });

  // A new bill alert arrived (or was read elsewhere): refresh the total unread count.
  const lastBillUnread = useRef<number | undefined>(undefined);
  useEffect(() => {
    const next = billQ.data?.unread_count;
    if (next === undefined) return;
    if (lastBillUnread.current !== undefined && next !== lastBillUnread.current) {
      void qc.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
      if (isOpen) void qc.invalidateQueries({ queryKey: ["notifications", "list"] });
    }
    lastBillUnread.current = next;
  }, [billQ.data?.unread_count, isOpen, qc]);

  const listQ = useQuery({
    queryKey: listKey,
    queryFn: () => NotificationService.getNotifications(false, 20),
    enabled: isOpen && Boolean(user),
    refetchInterval: isOpen && billReviewer ? BILL_POLL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
    meta: { suppressGlobalError: true },
  });

  const unreadCount = unreadQ.data;
  const refreshIssue = unreadQ.isError || billQ.isError;
  const notifications = (listQ.data ?? []).filter((notification) => billReviewer || !isBillAlert(notification));

  const markRead = useMutation({
    mutationFn: (id: string) => NotificationService.markAsRead(id),
    onSuccess: (_d, id) => {
      setActionError(null);
      qc.setQueryData<Notification[]>(listKey, (prev) => (prev ?? []).map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      void qc.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
      void qc.invalidateQueries({ queryKey: ["notifications", "inward-bill-summary"] });
    },
    onError: () => setActionError("Could not mark as read — the server did not confirm. Try again."),
    meta: { suppressGlobalError: true },
  });

  const markAll = useMutation({
    mutationFn: () => NotificationService.markAllAsRead(),
    onSuccess: () => {
      setActionError(null);
      qc.setQueryData<Notification[]>(listKey, (prev) => (prev ?? []).map((n) => ({ ...n, is_read: true })));
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: () => setActionError("The server did not confirm marking all as read. Refresh and try again."),
    meta: { suppressGlobalError: true },
  });

  const notificationHref = (notification: Notification) => {
    const deep = safeDeepLink(notification.deep_link);
    if (deep) return deep;
    if (isBillAlert(notification) && notification.related_object_id) return `/inventory/gate-bills/${notification.related_object_id}`;
    if (notification.related_object_type === "ReportDispatchRun") return "/system/report-center";
    if (notification.related_object_type === "SalesOrder" && notification.related_object_id) {
      return `/sales/orders/${notification.related_object_id}/tracking`;
    }
    if (notification.related_object_type === "ProductionJob") return "/production/planner";
    if (notification.related_object_type === "DeliveryChallan") return "/logistics/dispatch";
    if (notification.event_key?.startsWith("reports.")) return "/system/report-center";
    if (notification.type === "ORDER_CREATED") return "/sales/orders";
    if (notification.type === "LOW_STOCK") return "/inventory/inventory-health";
    return "";
  };

  const handleOpenNotification = (notification: Notification) => {
    // Navigation does not wait on mark-read; read state changes only if the server confirms.
    if (!notification.is_read) markRead.mutate(notification.id);
    const href = notificationHref(notification);
    if (href) {
      setIsOpen(false);
      router.push(href);
    }
  };

  const billPending = billQ.data?.pending_count;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-11 w-11 rounded-full hover:bg-surface-2"
          data-testid={triggerTestId}
          aria-label={typeof unreadCount === "number" && unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        >
          <Bell className="h-5 w-5 text-content-3" />
          {typeof unreadCount === "number" && unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger-solid text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : refreshIssue ? (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-warning-fg ring-2 ring-surface-1" aria-hidden />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] max-h-[72vh] overflow-y-auto overscroll-contain rounded-2xl border-line p-0 shadow-2xl sm:w-[440px]"
        align="end"
        sideOffset={8}
        data-testid="notification-bell-popover"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-content-1">Notifications</h3>
            {typeof unreadCount === "number" && unreadCount > 0 && (
              <p className="text-[11px] text-content-4 font-medium mt-0.5">
                {unreadCount} unread
              </p>
            )}
          </div>
          {typeof unreadCount === "number" && unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="min-h-11 rounded-lg text-[11px] font-semibold text-primary hover:text-primary hover:bg-info-bg"
            >
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        {billReviewer ? (
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              router.push("/inventory/gate-bills");
            }}
            className="flex w-full items-center gap-3 border-b border-line bg-surface-2/60 px-5 py-3 text-left hover:bg-surface-2"
            data-testid="notification-gate-bills"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning-bg text-warning-fg">
              <Inbox className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-content-1">Gate bills waiting for GRN</span>
              <span className="block text-[11px] text-content-3">
                {billQ.isError ? "Could not refresh — count may be out of date" : "Stays until inventory receives or resolves each bill"}
              </span>
            </span>
            <span className="text-[18px] font-semibold tabular-nums text-content-1">{billPending ?? "—"}</span>
          </button>
        ) : null}

        {refreshIssue || actionError ? (
          <div role="status" className="flex items-center justify-between gap-2 border-b border-line bg-warning-bg px-5 py-2 text-[11px] text-warning-fg">
            <span>{actionError ?? "Notifications could not refresh. Counts may be out of date."}</span>
            <button
              type="button"
              className="inline-flex min-h-11 shrink-0 items-center gap-1 px-2 font-semibold"
              onClick={() => {
                setActionError(null);
                void qc.invalidateQueries({ queryKey: ["notifications"] });
              }}
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        ) : null}

        <div className="max-h-[calc(72vh-69px)] overflow-y-auto">
          {listQ.isLoading || (!listQ.data && listQ.isFetching) ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-primary" />
              <span className="text-xs text-content-4 font-medium mt-3">
                Loading notifications...
              </span>
            </div>
          ) : listQ.isError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-content-3">
              <span className="text-sm font-medium">Could not load notifications</span>
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => void listQ.refetch()}>
                Retry
              </Button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-content-4">
              <div className="h-12 w-12 rounded-2xl bg-surface-2 flex items-center justify-center mb-3">
                <Bell className="h-5 w-5 text-content-4" />
              </div>
              <span className="text-sm font-medium">All caught up</span>
              <span className="text-[11px] mt-1">No notifications to show</span>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {notifications.map((notification) => {
                const bill = isBillAlert(notification);
                const Icon = bill ? Inbox : TYPE_ICONS[notification.type] || Bell;
                const href = notificationHref(notification);
                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "flex w-full items-start gap-1 px-3 py-1 transition-colors",
                      !notification.is_read && "bg-info-bg",
                    )}
                  >
                    <button
                      type="button"
                      data-testid={`notification-item-${notification.id}`}
                      onClick={() => handleOpenNotification(notification)}
                      className="flex min-h-11 min-w-0 flex-1 gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
                    >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        bill ? "bg-warning-bg text-warning-fg" : PRIORITY_COLORS[notification.priority] || "bg-surface-2",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="block min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="block text-[13px] font-semibold text-content-1 leading-snug break-words">
                          {notification.title}
                        </span>

                      </span>
                      <span className="block text-[12px] text-content-3 leading-relaxed line-clamp-2 mt-1">
                        {notification.message}
                      </span>
                      <span className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-content-4 font-medium">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </span>
                        <span className="text-content-4">·</span>
                        <span
                          className="h-[18px] text-[10px] font-semibold px-1.5 rounded-md border-line text-content-3"
                        >
                          {bill ? "GATE BILL" : notification.type.replace(/_/g, " ")}
                        </span>
                        {href ? (
                          <>
                            <span className="text-content-4">·</span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
                              Open
                              <ExternalLink className="h-3 w-3" />
                            </span>
                          </>
                        ) : null}
                      </span>
                    </span>
                    </button>
                    {!notification.is_read && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Mark ${notification.title} as read`}
                        disabled={markRead.isPending}
                        className="mt-2 h-11 w-11 shrink-0 rounded-lg hover:bg-surface-2"
                        onClick={() => markRead.mutate(notification.id)}
                      >
                        <X className="h-4 w-4 text-content-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
