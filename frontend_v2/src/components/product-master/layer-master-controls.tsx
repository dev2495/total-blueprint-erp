"use client"

import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { Material } from "@/services/master-data"
import type { LayerTemplateRow } from "@/services/product-master"
import type { ExtrusionRecipe, RecipeGrade } from "@/services/recipes"

const STANDARD_MICRONS = [8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 120, 150]

export function filmForLayer(layer: LayerTemplateRow, films: Material[]) {
    const filmId = String(layer.film_variant_id || "").toLowerCase()
    const code = String(layer.film_variant_code || "").toLowerCase()
    return films.find((film) => String(film.id || "").toLowerCase() === filmId || String(film.code || "").toLowerCase() === code)
}

export function isPurchasedOnlyFilm(film?: Material | null) {
    return !!film?.is_purchasable && !film?.is_extrudable
}

export function layerRequiresGrade(film?: Material | null) {
    return !!film && !isPurchasedOnlyFilm(film)
}

function uniqueNumbers(values: Array<number | string | null | undefined>) {
    return Array.from(
        new Set(
            values
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0)
                .map((value) => Number(value.toFixed(3)))
        )
    ).sort((a, b) => a - b)
}

function parseThicknessFromText(text: string) {
    const match = String(text || "").match(/(?:^|[-\s])(\d+(?:\.\d+)?)\s*(?:micron|microns|um|u|µ|μ)?(?:$|[-\s])/i)
    return match ? Number(match[1]) : null
}

export function recipeThicknessOptions(film: Material | undefined, recipes: ExtrusionRecipe[]) {
    if (!film?.id) return []
    const rows = recipes.filter((recipe) => String(recipe.film_variant) === String(film.id) && recipe.is_active !== false)
    const values: number[] = []
    rows.forEach((recipe) => {
        const min = Number(recipe.thickness_min_micron)
        const max = Number(recipe.thickness_max_micron)
        if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return
        values.push(min, max)
        STANDARD_MICRONS.forEach((option) => {
            if (option >= min && option <= max) values.push(option)
        })
    })
    return uniqueNumbers(values)
}

export function thicknessOptionsForLayer(layer: LayerTemplateRow, films: Material[], recipes: ExtrusionRecipe[]) {
    const film = filmForLayer(layer, films)
    const explicit = uniqueNumbers(layer.thickness_options || [])
    if (explicit.length) return uniqueNumbers([...explicit, layer.thickness_micron])

    if (film && isPurchasedOnlyFilm(film)) {
        const parsed = parseThicknessFromText(`${film.code} ${film.name}`)
        return uniqueNumbers([parsed, layer.thickness_micron])
    }

    const fromRecipes = recipeThicknessOptions(film, recipes)
    if (fromRecipes.length) return uniqueNumbers([...fromRecipes, layer.thickness_micron])
    return uniqueNumbers([layer.thickness_micron])
}

export function gradeOptionsForLayer(layer: LayerTemplateRow, films: Material[], grades: RecipeGrade[], recipes: ExtrusionRecipe[]) {
    const film = filmForLayer(layer, films)
    if (isPurchasedOnlyFilm(film)) return []
    const defaults = layer.default_grade ? [String(layer.default_grade).trim()].filter(Boolean) : []
    const explicit = (layer.grade_options || []).map((g) => String(g).trim()).filter(Boolean)
    const activeGradeMasterNames = grades
        .filter((grade) => (grade as any).is_active !== false)
        .map((grade) => String(grade.name || "").trim())
        .filter(Boolean)
    if (activeGradeMasterNames.length) return Array.from(new Set([...defaults, ...explicit, ...activeGradeMasterNames]))
    if (explicit.length) return Array.from(new Set([...defaults, ...explicit]))
    if (film?.id) {
        const recipeGrades = recipes
            .filter((recipe) => String(recipe.film_variant) === String(film.id) && recipe.is_active !== false)
            .map((recipe) => recipe.grade_name)
            .filter(Boolean)
        if (recipeGrades.length) return Array.from(new Set([...defaults, ...recipeGrades]))
    }
    return defaults
}

export function sanitizeLayerForFilm(
    layer: LayerTemplateRow,
    film: Material | undefined,
    grades: RecipeGrade[],
    recipes: ExtrusionRecipe[]
): LayerTemplateRow {
    const next: LayerTemplateRow = {
        ...layer,
        film_variant_id: film?.id || layer.film_variant_id || null,
        film_variant_code: (film?.code || layer.film_variant_code || "").toUpperCase(),
    }
    const thicknessOptions = thicknessOptionsForLayer(next, film ? [film] : [], recipes)
    if (!next.thickness_micron && thicknessOptions.length) next.thickness_micron = thicknessOptions[0]
    if (thicknessOptions.length) next.thickness_options = thicknessOptions

    if (isPurchasedOnlyFilm(film)) {
        next.default_grade = ""
        next.grade_options = []
        return next
    }

    const gradeOptions = gradeOptionsForLayer(next, film ? [film] : [], grades, recipes)
    if (gradeOptions.length) {
        if (!next.default_grade || !gradeOptions.includes(next.default_grade)) next.default_grade = gradeOptions[0]
        next.grade_apportion = next.grade_apportion || "fixed"
        next.grade_options = next.grade_apportion === "variable" ? gradeOptions : [next.default_grade]
    }
    return next
}

export function LayerThicknessSelect({
    layer,
    films,
    recipes,
    onChange,
    className,
}: {
    layer: LayerTemplateRow
    films: Material[]
    recipes: ExtrusionRecipe[]
    onChange: (patch: Partial<LayerTemplateRow>) => void
    className?: string
}) {
    const options = thicknessOptionsForLayer(layer, films, recipes)
    const current = Number(layer.thickness_micron || 0)
    if (!options.length) {
        return (
            <input
                type="number"
                min={0.1}
                step={0.1}
                value={current || ""}
                onChange={(event) => onChange({ thickness_micron: Number(event.target.value) })}
                placeholder="Micron"
                className={cn("h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none", className)}
            />
        )
    }
    return (
        <div className={cn("space-y-1.5", className)}>
            <input
                type="number"
                min={0.1}
                step={0.1}
                value={current || ""}
                onChange={(event) => onChange({ thickness_micron: Number(event.target.value), thickness_options: options })}
                placeholder="Micron"
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none"
            />
            <Select
                value={options.includes(current) ? String(current) : undefined}
                onValueChange={(value) => onChange({ thickness_micron: Number(value), thickness_options: options })}
            >
                <SelectTrigger className="h-8 rounded-xl border-slate-200 bg-slate-50 text-[11px]">
                    <SelectValue placeholder="Use recipe preset" />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                            {option} micron
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="text-[10px] font-semibold text-slate-500">
                Presets guide entry; any valid micron can be typed. Recipe range selects extrusion BOM.
            </div>
        </div>
    )
}

export function LayerDefaultGradeSelect({
    layer,
    films,
    grades,
    recipes,
    onChange,
    className,
}: {
    layer: LayerTemplateRow
    films: Material[]
    grades: RecipeGrade[]
    recipes: ExtrusionRecipe[]
    onChange: (patch: Partial<LayerTemplateRow>) => void
    className?: string
}) {
    const film = filmForLayer(layer, films)
    const options = gradeOptionsForLayer(layer, films, grades, recipes)
    if (isPurchasedOnlyFilm(film)) {
        return (
            <div className={cn("rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600", className)}>
                Grade not required for purchased film
            </div>
        )
    }
    if (!options.length) {
        return (
            <div className={cn("rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800", className)}>
                Add grade master/recipe first
            </div>
        )
    }
    return (
        <Select
            value={layer.default_grade || undefined}
            onValueChange={(value) => {
                const selected = Array.from(new Set([value, ...(layer.grade_options || [])]))
                onChange({ default_grade: value, grade_options: selected })
            }}
        >
            <SelectTrigger className={cn("h-9 rounded-xl text-xs", className)}>
                <SelectValue placeholder="Pick grade" />
            </SelectTrigger>
            <SelectContent>
                {options.map((grade) => (
                    <SelectItem key={grade} value={grade}>
                        {grade}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

export function LayerAllowedGradePicker({
    layer,
    films,
    grades,
    recipes,
    onChange,
}: {
    layer: LayerTemplateRow
    films: Material[]
    grades: RecipeGrade[]
    recipes: ExtrusionRecipe[]
    onChange: (patch: Partial<LayerTemplateRow>) => void
}) {
    const film = filmForLayer(layer, films)
    if (isPurchasedOnlyFilm(film)) {
        return <div className="text-[11px] font-semibold text-slate-500">Purchased-only film: no grade selection appears in sales.</div>
    }
    const options = gradeOptionsForLayer({ ...layer, grade_options: [] }, films, grades, recipes)
    const selected = new Set([
        ...(layer.default_grade ? [layer.default_grade] : []),
        ...(Array.isArray(layer.grade_options) ? layer.grade_options : []),
    ])
    if (!options.length) {
        return <div className="text-[11px] font-semibold text-amber-700">No active grade choices found for this film.</div>
    }
    return (
        <div className="space-y-1.5">
            <Label className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Allowed grades</Label>
            <div className="flex flex-wrap gap-1.5">
                {options.map((grade) => {
                    const active = selected.has(grade)
                    return (
                        <button
                            key={grade}
                            type="button"
                            onClick={() => {
                                const next = new Set(selected)
                                if (active) next.delete(grade)
                                else next.add(grade)
                                if (layer.default_grade) next.add(layer.default_grade)
                                onChange({ grade_apportion: "variable", grade_options: Array.from(next) })
                            }}
                            className={cn(
                                "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset transition",
                                active ? "bg-violet-600 text-white ring-violet-700" : "bg-white text-slate-600 ring-slate-200 hover:ring-violet-200"
                            )}
                        >
                            {grade}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

export function LayerGradeBadge({ layer, films }: { layer: LayerTemplateRow; films: Material[] }) {
    const film = filmForLayer(layer, films)
    if (isPurchasedOnlyFilm(film)) return <Badge variant="secondary">Purchased film: no grade</Badge>
    if (layer.default_grade) return <Badge variant="outline">Default {layer.default_grade}</Badge>
    return <Badge variant="destructive">Grade needed</Badge>
}
