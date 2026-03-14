"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Package, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { inventoryService } from "@/services/inventory"
import { masterDataService } from "@/services/master-data"
import { factoryService } from "@/services/factory"

export default function PackagingInventoryPage() {
  const [materialId, setMaterialId] = useState<string>("__ALL_MATERIALS__")
  const [locationId, setLocationId] = useState<string>("__ALL_LOCATIONS__")
  const [typeFilter, setTypeFilter] = useState<string>("__ALL_TYPES__")
  const [search, setSearch] = useState("")

  const { data: materials } = useQuery({
    queryKey: ["master-packaging"],
    queryFn: masterDataService.getPackaging,
  })

  const { data: locations } = useQuery({
    queryKey: ["factory-locations"],
    queryFn: factoryService.getLocations,
  })

  const stockQuery = useQuery({
    queryKey: ["packaging-stock", materialId, locationId],
    queryFn: () => inventoryService.getPackagingStock({
      material: materialId === "__ALL_MATERIALS__" ? undefined : materialId,
      location: locationId === "__ALL_LOCATIONS__" ? undefined : locationId,
    }),
  })

  const txQuery = useQuery({
    queryKey: ["packaging-transactions", materialId, locationId, typeFilter],
    queryFn: () => inventoryService.getPackagingTransactions({
      material: materialId === "__ALL_MATERIALS__" ? undefined : materialId,
      location: locationId === "__ALL_LOCATIONS__" ? undefined : locationId,
      type: typeFilter === "__ALL_TYPES__" ? undefined : typeFilter,
    }),
  })

  const materialsList = Array.isArray(materials) ? materials : []
  const locationsList = Array.isArray(locations) ? locations : []
  const stockRows = Array.isArray(stockQuery.data) ? stockQuery.data : []
  const transactionRows = Array.isArray(txQuery.data) ? txQuery.data : []

  const filteredStock = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return stockRows
    return stockRows.filter((row: any) => {
      const name = String(row.material_name || "").toLowerCase()
      const code = String(row.material_code || "").toLowerCase()
      const kind = String(row.packaging_kind || "").toLowerCase()
      const location = String(row.location_name || "").toLowerCase()
      return name.includes(needle) || code.includes(needle) || kind.includes(needle) || location.includes(needle)
    })
  }, [search, stockRows])

  const materialKindMap = useMemo(() => {
    const map = new Map<string, string>()
    materialsList.forEach((row: any) => {
      if (row?.id) {
        map.set(String(row.id), String(row.packaging_kind || ""))
      }
    })
    return map
  }, [materialsList])

  return (
    <div className="p-6 lg:p-8 space-y-6 bg-[#f8fafc] min-h-screen">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
            <Package className="h-6 w-6 text-indigo-600" /> Packaging Inventory
          </h1>
          <p className="text-sm text-slate-500">Live pooled packaging stock and consumption ledger.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/master/packaging">Manage Packaging SKUs</Link>
          </Button>
          <Button variant="outline" onClick={() => { stockQuery.refetch(); txQuery.refetch(); }}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input placeholder="Search material / code / kind" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={materialId} onValueChange={setMaterialId}>
            <SelectTrigger><SelectValue placeholder="All Materials" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL_MATERIALS__">All Materials</SelectItem>
              {materialsList.map((m: any) => (
                <SelectItem key={m.id} value={String(m.id)}>{m.code} - {m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger><SelectValue placeholder="All Locations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL_LOCATIONS__">All Locations</SelectItem>
              {locationsList.map((l: any) => (
                <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="All Tx Types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL_TYPES__">All Tx Types</SelectItem>
              {['INWARD', 'CONSUME', 'TRANSFER', 'ADJUST', 'PRODUCE'].map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {stockQuery.isError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-red-700">Packaging stock could not be loaded.</div>
              <div className="text-sm text-red-600">
                {String((stockQuery.error as any)?.response?.data?.detail || (stockQuery.error as any)?.response?.data?.message || "Retry after the backend is healthy.")}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Stock</CardTitle>
          <CardDescription>Material, kind, base UOM, quantity, location and latest update.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Material</th>
                <th className="py-2">Kind</th>
                <th className="py-2">UOM</th>
                <th className="py-2">Qty</th>
                <th className="py-2">Location</th>
                <th className="py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filteredStock.map((row: any) => (
                <tr key={row.id} className="border-b">
                  <td className="py-2">{row.material_code} - {row.material_name}</td>
                  <td className="py-2">{row.packaging_kind || '-'}</td>
                  <td className="py-2">{row.base_uom || '-'}</td>
                  <td className="py-2 font-bold">{Number(row.qty || 0).toFixed(3)}</td>
                  <td className="py-2">{row.location_name || '-'}</td>
                  <td className="py-2">{row.updated_at ? new Date(row.updated_at).toLocaleString() : '-'}</td>
                </tr>
              ))}
              {filteredStock.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">No packaging stock found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>Detailed inward, conversion, consumption and claim-lineage ledger.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Time</th>
                <th className="py-2">Type</th>
                <th className="py-2">Material</th>
                <th className="py-2">Kind</th>
                <th className="py-2">Signed Qty</th>
                <th className="py-2">Base UOM</th>
                <th className="py-2">Input Qty</th>
                <th className="py-2">Input UOM</th>
                <th className="py-2">Factor</th>
                <th className="py-2">Basis</th>
                <th className="py-2">Location</th>
                <th className="py-2">Vendor</th>
                <th className="py-2">Job</th>
                <th className="py-2">Sales Item</th>
                <th className="py-2">Stock Order</th>
                <th className="py-2">Roll</th>
                <th className="py-2">Reference</th>
              </tr>
            </thead>
            <tbody>
              {transactionRows.slice(0, 200).map((tx: any) => (
                <tr key={tx.id} className="border-b">
                  <td className="py-2">{tx.created_at ? new Date(tx.created_at).toLocaleString() : '-'}</td>
                  <td className="py-2">{tx.type}</td>
                  <td className="py-2">{tx.material_code} - {tx.material_name}</td>
                  <td className="py-2">{materialKindMap.get(String(tx.material || "")) || '-'}</td>
                  <td className="py-2 font-bold">{Number(tx.qty || 0).toFixed(3)}</td>
                  <td className="py-2">{tx.base_uom || '-'}</td>
                  <td className="py-2">{tx.meta_json?.input_qty != null ? Number(tx.meta_json.input_qty).toFixed(3) : '-'}</td>
                  <td className="py-2">{tx.meta_json?.input_uom || '-'}</td>
                  <td className="py-2">{tx.meta_json?.conversion_factor != null ? Number(tx.meta_json.conversion_factor).toFixed(6) : '-'}</td>
                  <td className="py-2">{tx.meta_json?.basis || '-'}</td>
                  <td className="py-2">{tx.location_name || '-'}</td>
                  <td className="py-2">{tx.vendor_name || '-'}</td>
                  <td className="py-2">{tx.job_no || '-'}</td>
                  <td className="py-2 font-mono text-[11px]">{tx.sales_order_item ? String(tx.sales_order_item).slice(0, 8) : '-'}</td>
                  <td className="py-2 font-mono text-[11px]">{tx.mts_order ? String(tx.mts_order).slice(0, 8) : '-'}</td>
                  <td className="py-2 font-mono text-[11px]">{tx.meta_json?.roll_id ? String(tx.meta_json.roll_id).slice(0, 8) : '-'}</td>
                  <td className="py-2">{tx.reference || '-'}</td>
                </tr>
              ))}
              {transactionRows.length === 0 && (
                <tr>
                  <td colSpan={17} className="py-8 text-center text-slate-500">No transactions found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {txQuery.isError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-red-700">Packaging transactions could not be loaded.</div>
              <div className="text-sm text-red-600">
                {String((txQuery.error as any)?.response?.data?.detail || (txQuery.error as any)?.response?.data?.message || "Retry after the backend is healthy.")}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
