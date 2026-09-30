"use client";

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Keep planner overlays outside the page shell's clipping and stacking contexts.
export function PlannerDialogLayer({ children }: { children: ReactNode }) {
    return typeof document === 'undefined' ? null : createPortal(children, document.body);
}
