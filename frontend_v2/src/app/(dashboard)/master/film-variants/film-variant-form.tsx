"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { FilmVariant } from "@/services/film-variants"
import { filmFamilyService } from "@/services/film-families"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { Loader2 } from "lucide-react"

const formSchema = z.object({
    code: z.string().min(1, "Variant Code is required"),
    name: z.string().min(1, "Name is required"),
    parent_family: z.string().min(1, "Family is required"),
    grade: z.string().optional(),
    is_extrudable: z.boolean().default(false),
    is_purchasable: z.boolean().default(true),
}).superRefine((val, ctx) => {
    if (val.is_extrudable && !String(val.grade || "").trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Grade is required for extrudable variants.",
            path: ["grade"],
        })
    }
})

interface FilmVariantFormProps {
    initialData?: FilmVariant
    onSubmit: (data: z.infer<typeof formSchema>) => void
    isLoading?: boolean
}

export function FilmVariantForm({ initialData, onSubmit, isLoading }: FilmVariantFormProps) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: "",
            name: "",
            parent_family: "",
            grade: "",
            is_extrudable: false,
            is_purchasable: true,
        },
    })
    const isExtrudable = form.watch("is_extrudable")

    // Fetch Families for Dropdown
    const { data: families } = useQuery({
        queryKey: ["film-families"],
        queryFn: filmFamilyService.getAll,
    })

    // Fetch Grades for Dropdown
    const { data: grades } = useQuery({
        queryKey: ["recipe-grades"],
        queryFn: async () => {
            const { api } = await import("@/lib/api")
            const response = await api.get<{ id: string, name: string }[]>("/api/master/film-variants/grades/")
            return response.data
        }
    })

    useEffect(() => {
        if (initialData) {
            form.reset({
                code: initialData.code,
                name: initialData.name,
                parent_family: initialData.parent_family,
                grade: initialData.grade ?? "",
                is_extrudable: initialData.is_extrudable,
                is_purchasable: initialData.is_purchasable,
            })
        }
    }, [initialData, form])

    useEffect(() => {
        if (!isExtrudable && form.getValues("grade")) {
            form.setValue("grade", "")
        }
    }, [isExtrudable, form])

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Variant Code</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. F-101" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Variant Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. Standard Transparent" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="parent_family"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Film Family</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a family" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {families?.map((family) => (
                                        <SelectItem key={family.id} value={String(family.id)}>
                                            {family.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormDescription>
                                Base material family for this variant.
                            </FormDescription>
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
                            <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                                value={field.value}
                                disabled={!isExtrudable}
                            >
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder={isExtrudable ? "Select a grade" : "Not required"} />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {grades?.map((grade) => (
                                        <SelectItem key={grade.id} value={grade.id}>
                                            {grade.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormDescription>
                                Grade is mandatory only when variant is marked extrudable.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="is_extrudable"
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                            <FormControl>
                                <Checkbox
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel>
                                    Extrudable
                                </FormLabel>
                                <FormDescription>
                                    Check if this variant is produced via extrusion recipes.
                                </FormDescription>
                            </div>
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="is_purchasable"
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                            <FormControl>
                                <Checkbox
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel>
                                    Purchasable
                                </FormLabel>
                                <FormDescription>
                                    Check if this variant can be purchased directly from vendors.
                                </FormDescription>
                            </div>
                        </FormItem>
                    )}
                />

                <div className="flex justify-end gap-2">
                    <Button type="submit" disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save
                    </Button>
                </div>
            </form>
        </Form>
    )
}
