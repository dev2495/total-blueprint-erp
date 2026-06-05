"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, X, CheckCheck, ExternalLink, AlertTriangle, Package, Truck, Gauge, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { NotificationService, type Notification } from '@/services/notifications'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

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
}

const PRIORITY_COLORS: Record<string, string> = {
    LOW: 'bg-slate-100 text-slate-700',
    NORMAL: 'bg-blue-100 text-blue-700',
    HIGH: 'bg-amber-100 text-warning-fg',
    URGENT: 'bg-red-100 text-red-700',
}

export function NotificationBell({ triggerTestId = "notification-bell-trigger" }: { triggerTestId?: string }) {
    const router = useRouter()
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [isOpen, setIsOpen] = useState(false)
    const [loading, setLoading] = useState(false)

    const fetchUnreadCount = async () => {
        try {
            const count = await NotificationService.getUnreadCount()
            setUnreadCount(count)
        } catch {
            // Notification polling is best-effort. The shell must remain usable even
            // when the background unread endpoint is temporarily unavailable.
            setUnreadCount(0)
        }
    }

    const fetchNotifications = async () => {
        setLoading(true)
        try {
            const data = await NotificationService.getNotifications(false, 20)
            setNotifications(data)
        } catch {
            setNotifications([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchUnreadCount()
        // Poll for new notifications every 30 seconds
        const interval = setInterval(fetchUnreadCount, 30000)
        return () => clearInterval(interval)
    }, [])

    useEffect(() => {
        if (isOpen) {
            fetchNotifications()
        }
    }, [isOpen])

    const handleMarkAsRead = async (notificationId: string) => {
        try {
            await NotificationService.markAsRead(notificationId)
            setNotifications(prev =>
                prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
            )
            setUnreadCount(prev => Math.max(0, prev - 1))
        } catch {
            return
        }
    }

    const handleMarkAllAsRead = async () => {
        try {
            await NotificationService.markAllAsRead()
            setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
            setUnreadCount(0)
        } catch {
            return
        }
    }

    const notificationHref = (notification: Notification) => {
        if (notification.related_object_type === "ReportDispatchRun") return "/system/report-center"
        if (notification.related_object_type === "SalesOrder" && notification.related_object_id) {
            return `/sales/orders/${notification.related_object_id}/tracking`
        }
        if (notification.related_object_type === "ProductionJob") return "/production/planner"
        if (notification.related_object_type === "DeliveryChallan") return "/logistics/dispatch"
        if (notification.event_key?.startsWith("reports.")) return "/system/report-center"
        if (notification.type === "ORDER_CREATED") return "/sales/orders"
        if (notification.type === "LOW_STOCK") return "/inventory/inventory-health"
        return ""
    }

    const handleOpenNotification = async (notification: Notification) => {
        if (!notification.is_read) {
            await handleMarkAsRead(notification.id)
        }
        const href = notificationHref(notification)
        if (href) {
            setIsOpen(false)
            router.push(href)
        }
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative h-9 w-9 rounded-full hover:bg-slate-100"
                    data-testid={triggerTestId}
                >
                    <Bell className="h-5 w-5 text-content-3" />
                    {unreadCount > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[calc(100vw-2rem)] max-h-[72vh] overflow-y-auto overscroll-contain rounded-2xl border-slate-200 p-0 shadow-2xl sm:w-[440px]"
                align="end"
                sideOffset={8}
                data-testid="notification-bell-popover"
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">Notifications</h3>
                        {unreadCount > 0 && (
                            <p className="text-[11px] text-content-4 font-medium mt-0.5">{unreadCount} unread</p>
                        )}
                    </div>
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleMarkAllAsRead}
                            className="h-8 rounded-lg text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        >
                            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
                            Mark all read
                        </Button>
                    )}
                </div>
                <div className="max-h-[calc(72vh-69px)] overflow-y-auto">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
                            <span className="text-xs text-content-4 font-medium mt-3">Loading notifications...</span>
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-content-4">
                            <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                                <Bell className="h-5 w-5 text-slate-300" />
                            </div>
                            <span className="text-sm font-medium">All caught up</span>
                            <span className="text-[11px] mt-1">No notifications to show</span>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {notifications.map((notification) => {
                                const Icon = TYPE_ICONS[notification.type] || Bell
                                const href = notificationHref(notification)
                                return (
                                    <div
                                        key={notification.id}
                                        role="button"
                                        tabIndex={0}
                                        data-testid={`notification-item-${notification.id}`}
                                        onClick={() => handleOpenNotification(notification)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault()
                                                handleOpenNotification(notification)
                                            }
                                        }}
                                        className={cn(
                                            "flex w-full cursor-pointer gap-3 px-5 py-3.5 text-left transition-colors hover:bg-slate-50/80 focus:outline-none focus-visible:bg-slate-50/80 focus-visible:ring-2 focus-visible:ring-blue-300",
                                            !notification.is_read && "bg-blue-50/30"
                                        )}
                                    >
                                        <div className={cn(
                                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                                            PRIORITY_COLORS[notification.priority] || 'bg-slate-100'
                                        )}>
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="text-[13px] font-semibold text-slate-900 leading-snug break-words">
                                                    {notification.title}
                                                </p>
                                                {!notification.is_read && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6 shrink-0 rounded-lg hover:bg-slate-200"
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            handleMarkAsRead(notification.id)
                                                        }}
                                                    >
                                                        <X className="h-3 w-3 text-content-4" />
                                                    </Button>
                                                )}
                                            </div>
                                            <p className="text-[12px] text-slate-500 leading-relaxed line-clamp-2 mt-1">
                                                {notification.message}
                                            </p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className="text-[10px] text-content-4 font-medium">
                                                    {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                                                </span>
                                                <span className="text-slate-200">·</span>
                                                <Badge variant="outline" className="h-[18px] text-[9px] font-semibold px-1.5 rounded-md border-slate-200 text-slate-500">
                                                    {notification.type.replace(/_/g, ' ')}
                                                </Badge>
                                                {href ? (
                                                    <>
                                                        <span className="text-slate-200">·</span>
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600">
                                                            Open
                                                            <ExternalLink className="h-3 w-3" />
                                                        </span>
                                                    </>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
