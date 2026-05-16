"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Eye, Image as ImageIcon, Palette, Plus, Search, ShieldCheck, UploadCloud } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import { artworkImageUrls, engineeringService, isPdfMediaUrl, type Artwork } from "@/services/engineering"
import { ArtworkDialog } from "@/components/engineering/artwork-dialog"

function ArtworkThumbnail({ artwork }: { artwork: Artwork }) {
  const imageUrl = artworkImageUrls(artwork)[0] || null
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">(imageUrl ? "loading" : "failed")

  useEffect(() => {
    if (!imageUrl) {
      setLoadState("failed")
      return
    }
    if (isPdfMediaUrl(imageUrl)) {
      setLoadState("ready")
      return
    }

    let cancelled = false
    const image = new window.Image()
    setLoadState("loading")
    image.onload = () => {
      if (cancelled) return
      setLoadState(image.naturalWidth > 0 && image.naturalHeight > 0 ? "ready" : "failed")
    }
    image.onerror = () => {
      if (!cancelled) setLoadState("failed")
    }
    image.src = imageUrl

    return () => {
      cancelled = true
    }
  }, [imageUrl])

  if (imageUrl && loadState === "ready") {
    if (isPdfMediaUrl(imageUrl)) {
      return <iframe src={imageUrl} title={`${artwork.name} PDF preview`} className="h-full w-full bg-white" />
    }
    return (
      <img
        src={imageUrl}
        alt={artwork.name}
        className="h-full w-full object-cover"
        onLoad={(event) => {
          if (!event.currentTarget.naturalWidth || !event.currentTarget.naturalHeight) setLoadState("failed")
        }}
        onError={() => setLoadState("failed")}
      />
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-100 via-white to-blue-50 text-slate-400">
      <ImageIcon className="h-12 w-12" />
    </div>
  )
}

export default function EngineeringArtworksPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Artwork | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const { data: artworks = [], isLoading } = useQuery<Artwork[]>({ queryKey: ["artworks"], queryFn: () => engineeringService.getArtworks() })

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return artworks
    return artworks.filter((item) => [item.name, item.design_code, item.print_type, item.substrate_mode, item.status].map((value) => String(value || "").toLowerCase()).join(" ").includes(q))
  }, [artworks, searchQuery])

  const stats = useMemo(() => {
    return {
      total: filtered.length,
      approved: filtered.filter((item) => item.status === "APPROVED").length,
      pending: filtered.filter((item) => item.status === "PENDING_APPROVAL").length,
      mapped: filtered.filter((item) => item.cylinder_ready).length,
    }
  }, [filtered])

  return (
    <MasterRegistryShell
      title="Artwork Library"
      description="Visual gallery of approved print assets, live thumbnails, color-side coverage, and cylinder readiness."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search design code, artwork name, print type, or status"
      actions={
        <Button
          onClick={() => {
            setEditing(null)
            setIsOpen(true)
          }}
          data-testid="artwork-upload-button"
        >
          <Plus className="mr-2 h-4 w-4" /> Upload Artwork
        </Button>
      }
      stats={[
        { label: "Total Assets", value: stats.total, icon: ImageIcon, toneClassName: "bg-pink-50 text-pink-600" },
        { label: "Approved", value: stats.approved, icon: ShieldCheck, toneClassName: "bg-emerald-50 text-emerald-600" },
        { label: "Pending", value: stats.pending, icon: UploadCloud, toneClassName: "bg-amber-50 text-amber-600" },
        { label: "Cylinder Ready", value: stats.mapped, icon: CheckCircle2, toneClassName: "bg-blue-50 text-blue-600" },
      ]}
      chips={[
        { kind: "approval", value: "APPROVED", label: "Approved artwork" },
        { kind: "approval", value: "PENDING", label: "Pending approval" },
        { kind: "severity", value: "INFO", label: "Thumbnail visible in catalog" },
      ]}
    >
      <ArtworkDialog open={isOpen} onOpenChange={setIsOpen} artwork={editing} />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="h-[340px] border-0 shadow-sm ring-1 ring-slate-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm ring-1 ring-slate-100">
          <CardContent className="p-10 text-center text-slate-400">No artwork matches the current search.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((artwork) => (
            <Card
              key={artwork.id}
              className="overflow-hidden border-0 shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => {
                  setEditing(artwork)
                  setIsOpen(true)
                }}
              >
                <div className="relative h-52 w-full overflow-hidden bg-slate-100">
                  <ArtworkThumbnail artwork={artwork} />
                </div>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black tracking-tight text-slate-900">{artwork.name}</div>
                      <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{artwork.design_code}</div>
                    </div>
                    <Button type="button" size="icon" variant="ghost" className="pointer-events-none rounded-full text-slate-400">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <SemanticBadge kind="approval" value={artwork.status === "APPROVED" ? "APPROVED" : artwork.status === "PENDING_APPROVAL" ? "PENDING" : "REJECTED"} label={artwork.status.replaceAll("_", " ")} />
                    <SemanticBadge kind="severity" value={artwork.cylinder_ready ? "LOW" : "MEDIUM"} label={artwork.cylinder_ready ? "Cylinder mapped" : "Mapping pending"} />
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50/70 p-4 text-sm">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Front / Back</div>
                      <div className="mt-1 font-black text-slate-900">F{artwork.front_colors_count || 0} / B{artwork.back_colors_count || 0}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Print / Film</div>
                      <div className="mt-1 font-black text-slate-900">{artwork.print_type || "FLEXO"} · {artwork.substrate_mode || "SHEET"}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Color Identity</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(artwork.color_list || []).slice(0, 6).map((color) => (
                          <span key={color} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700">
                            <Palette className="h-3 w-3 text-pink-500" /> {color}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </button>
            </Card>
          ))}
        </div>
      )}
    </MasterRegistryShell>
  )
}
