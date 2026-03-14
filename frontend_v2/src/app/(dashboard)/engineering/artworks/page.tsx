"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Search, Palette, Image as ImageIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { engineeringService, Artwork } from "@/services/engineering"
import { ArtworkDialog } from "@/components/engineering/artwork-dialog"

export default function EngineeringArtworksPage() {
    const queryClient = useQueryClient()
    const [editing, setEditing] = useState<Artwork | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")

    const { data: artworks = [], isLoading } = useQuery<Artwork[]>({
        queryKey: ["artworks"],
        queryFn: () => engineeringService.getArtworks(),
    })

    const filtered = artworks.filter((a) =>
        a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.design_code.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="p-6 lg:p-8 space-y-8 bg-[#f8fafc] min-h-screen">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pink-50 border border-pink-100 text-pink-600 text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
                        <ImageIcon className="h-3 w-3" /> Digital Assets
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                        Artwork
                        <span className="text-slate-300 font-light translate-y-[2px]">/</span>
                        <span className="text-pink-600 italic">Library</span>
                    </h1>
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        onClick={() => {
                            setEditing(null)
                            setIsOpen(true)
                        }}
                        data-testid="artwork-upload-button"
                        className="h-11 px-8 rounded-xl bg-slate-900 hover:bg-pink-600 text-white font-black uppercase text-[10px] tracking-widest shadow-xl shadow-slate-200 transition-all active-scale"
                    >
                        <Plus className="h-4 w-4 mr-2" /> Upload Artwork
                    </Button>
                </div>
            </div>

            <ArtworkDialog
                open={isOpen}
                onOpenChange={setIsOpen}
                artwork={editing}
            />

            <Card className="border-none shadow-premium rounded-[2rem] bg-white overflow-hidden min-h-[500px]">
                <CardHeader className="p-6 pb-2 border-b border-slate-50 bg-slate-50/30">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <CardTitle className="text-lg font-black tracking-tight text-slate-900 uppercase italic">Master Library</CardTitle>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder="Search artwork..."
                                className="pl-10 h-10 w-[250px] rounded-xl border-slate-200 bg-white font-bold text-xs shadow-sm focus:border-pink-600 transition-all"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50/50">
                            <TableRow className="border-none hover:bg-transparent">
                                <TableHead className="px-6 text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Design Code</TableHead>
                                <TableHead className="text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Name</TableHead>
                                <TableHead className="text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Colors</TableHead>
                                <TableHead className="text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Version</TableHead>
                                <TableHead className="text-right px-6 text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-20">Loading...</TableCell>
                                </TableRow>
                            ) : filtered.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-24 text-[11px] font-black uppercase text-slate-300 italic tracking-[0.2em]">
                                        No artwork found
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filtered.map((a) => (
                                    <TableRow
                                        key={a.id}
                                        onClick={() => {
                                            setEditing(a)
                                            setIsOpen(true)
                                        }}
                                        className="hover:bg-slate-50/50 transition-colors border-b border-slate-50/50 cursor-pointer"
                                    >
                                        <TableCell className="px-6 py-4 font-black font-mono text-xs text-slate-700">
                                            {a.design_code}
                                        </TableCell>
                                        <TableCell className="font-bold text-slate-900 text-xs uppercase">
                                            {a.name}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Palette className="h-3 w-3 text-slate-400" />
                                                <span className="text-xs font-bold text-slate-600">
                                                    F{(a as any).front_colors_count || 0}/B{(a as any).back_colors_count || 0}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs font-medium text-slate-500">v{a.version}</TableCell>
                                        <TableCell className="text-right px-6">
                                            <Badge variant="outline">{a.status}</Badge>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
