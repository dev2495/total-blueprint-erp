import { type ClassValue } from "clsx"
import clsx from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The theme adds font sizes `text-caption` (12px) and `text-label` (13px). Without telling
// tailwind-merge, it reads them as colours and drops them when a text colour follows.
const twMerge = extendTailwindMerge({
    extend: { classGroups: { "font-size": [{ text: ["caption", "label"] }] } },
})

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}
