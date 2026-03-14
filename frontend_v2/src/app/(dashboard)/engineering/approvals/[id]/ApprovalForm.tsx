"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TemplateBlueprint } from "@/services/templates"

interface ApprovalFormProps {
    template: TemplateBlueprint
}

export default function ApprovalForm({ template }: ApprovalFormProps) {
    return (
        <Card className="border-slate-200">
            <CardHeader>
                <CardTitle className="text-lg">Approval Console Retired</CardTitle>
                <CardDescription>
                    Template technical approval is removed in V2. Templates now manage only route, step category mapping, and roll policy.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-slate-600">
                    Continue editing this template in Template Studio.
                </p>
                <Button asChild>
                    <Link href={`/engineering/templates/${template.id}`}>
                        Open Template Studio
                        <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                </Button>
            </CardContent>
        </Card>
    )
}
