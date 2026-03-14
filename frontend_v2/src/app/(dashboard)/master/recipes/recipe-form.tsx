"use client"

import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { ExtrusionRecipe, recipeService } from "@/services/recipes"
import { filmVariantService } from "@/services/film-variants"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { Loader2, Trash2, Plus } from "lucide-react"
import { api } from "@/lib/api"

const useGranules = () => {
    return useQuery({
        queryKey: ["granules"],
        queryFn: async () => {
            const { data } = await api.get("/api/master/granules/");
            return data as { id: string, name: string, code: string }[];
        }
    })
}

const formSchema = z.object({
    film_variant: z.string().min(1, "Variant is required"),
    grade: z.string().min(1, "Grade is required"),
    thickness_min_micron: z.coerce.number().min(1, "Min thickness must be positive"),
    thickness_max_micron: z.coerce.number().min(1, "Max thickness must be positive"),
    components: z.array(z.object({
        granule: z.string().min(1, "Granule is required"),
        percentage: z.coerce.number().min(0).max(100),
    })).min(1, "At least one component is required").refine((items) => {
        const total = items.reduce((acc, item) => acc + item.percentage, 0);
        return Math.abs(total - 100) < 0.1;
    }, { message: "Total percentage must be 100%" }),
})

interface RecipeFormProps {
    initialData?: ExtrusionRecipe
    onSubmit: (data: z.infer<typeof formSchema>) => void
    isLoading?: boolean
}

export function RecipeForm({ initialData, onSubmit, isLoading }: RecipeFormProps) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            film_variant: "",
            grade: "",
            thickness_min_micron: 20,
            thickness_max_micron: 100,
            components: [{ granule: "", percentage: 100 }],
        },
    })

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "components",
    })

    // Data Queries
    const { data: variants } = useQuery({
        queryKey: ["film-variants"],
        queryFn: filmVariantService.getAll,
    })

    const { data: grades } = useQuery({
        queryKey: ["recipe-grades"],
        queryFn: () => recipeService.getGrades(),
    })

    const { data: granules } = useGranules()

    // Filter extrudable variants
    const extrudableVariants = variants?.filter(v => v.is_extrudable) || []

    // Effects
    useEffect(() => {
        if (initialData) {
            form.reset({
                film_variant: initialData.film_variant,
                grade: initialData.grade,
                thickness_min_micron: initialData.thickness_min_micron,
                thickness_max_micron: initialData.thickness_max_micron,
                components: initialData.components.map(c => ({
                    granule: c.granule,
                    percentage: c.percentage
                })),
            })
        }
    }, [initialData, form])

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="film_variant"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Film Variant</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select extrudable variant" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {extrudableVariants.map((v) => (
                                            <SelectItem key={v.id} value={String(v.id)}>
                                                {v.name} ({v.code})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="grade"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Grade</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select grade" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {grades?.map((g) => (
                                            <SelectItem key={g.id} value={String(g.id)}>
                                                {g.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="flex gap-4">
                    <FormField
                        control={form.control}
                        name="thickness_min_micron"
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormLabel>Min Thickness (μ)</FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} value={field.value as number} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="thickness_max_micron"
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormLabel>Max Thickness (μ)</FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} value={field.value as number} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="space-y-4 border rounded-md p-4 bg-slate-50">
                    <div className="flex items-center justify-between">
                        <h3 className="font-medium text-sm">Formulation</h3>
                        <Button type="button" variant="outline" size="sm" onClick={() => append({ granule: "", percentage: 0 })}>
                            <Plus className="h-4 w-4 mr-2" /> Add Component
                        </Button>
                    </div>

                    {fields.map((field, index) => (
                        <div key={field.id} className="flex items-end gap-2">
                            <FormField
                                control={form.control}
                                name={`components.${index}.granule`}
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormLabel className={index !== 0 ? "sr-only" : ""}>Granule</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select granule" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {granules?.map((g) => (
                                                    <SelectItem key={g.id} value={String(g.id)}>
                                                        {g.name} ({g.code})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name={`components.${index}.percentage`}
                                render={({ field }) => (
                                    <FormItem className="w-24">
                                        <FormLabel className={index !== 0 ? "sr-only" : ""}>%</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                {...field}
                                                value={field.value as number}
                                                onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="mb-0.5 text-destructive"
                                onClick={() => remove(index)}
                                disabled={fields.length === 1}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                    {form.formState.errors.components?.root && (
                        <p className="text-sm font-medium text-destructive">{form.formState.errors.components.root.message}</p>
                    )}
                    {/* Show total percentage */}
                    <div className="text-right text-sm">
                        Total: {form.watch("components").reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0)}%
                    </div>
                </div>

                <div className="flex justify-end gap-2">
                    <Button type="submit" disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Recipe
                    </Button>
                </div>
            </form>
        </Form>
    )
}
