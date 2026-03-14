"use client"

import { useState, useEffect } from 'react'
import { Bell, X, CheckCheck, ExternalLink, AlertTriangle, Package, Truck, Gauge, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from '@/components/ui/scroll-area'
import { NotificationService, type Notification } from '@/services/notifications'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

const TYPE_ICONS: Record<string, React.ElementType> = {
    FG_READY: Package,
    CHALLAN_CREATED: Truck,
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
    HIGH: 'bg-amber-100 text-amber-700',
    URGENT: 'bg-red-100 text-red-700',
}

export function NotificationBell() {
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

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative h-9 w-9 rounded-full hover:bg-slate-100"
                    data-testid="notification-bell-trigger"
                >
                    <Bell className="h-5 w-5 text-slate-600" />
                    {unreadCount > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-0" align="end" data-testid="notification-bell-popover">
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <h3 className="font-semibold text-slate-900">Notifications</h3>
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleMarkAllAsRead}
                            className="text-xs text-blue-600 hover:text-blue-700"
                        >
                            <CheckCheck className="mr-1 h-3 w-3" />
                            Mark all read
                        </Button>
                    )}
                </div>
                <ScrollArea className="h-[400px]">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <span className="text-sm text-slate-500">Loading...</span>
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                            <Bell className="mb-2 h-8 w-8 opacity-50" />
                            <span className="text-sm">No notifications yet</span>
                        </div>
                    ) : (
                        <div className="divide-y">
                            {notifications.map((notification) => {
                                const Icon = TYPE_ICONS[notification.type] || Bell
                                return (
                                    <div
                                        key={notification.id}
                                        data-testid={`notification-item-${notification.id}`}
                                        className={cn(
                                            "flex gap-3 px-4 py-3 transition-colors hover:bg-slate-50",
                                            !notification.is_read && "bg-blue-50/50"
                                        )}
                                    >
                                        <div className={cn(
                                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                            PRIORITY_COLORS[notification.priority] || 'bg-slate-100'
                                        )}>
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="text-sm font-medium text-slate-900 truncate">
                                                    {notification.title}
                                                </p>
                                                {!notification.is_read && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-5 w-5 shrink-0"
                                                        onClick={() => handleMarkAsRead(notification.id)}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">
                                                {notification.message}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span className="text-[10px] text-slate-400">
                                                    {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                                                </span>
                                                <Badge variant="outline" className="h-4 text-[9px] px-1.5">
                                                    {notification.type.replace(/_/g, ' ')}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    )
}
