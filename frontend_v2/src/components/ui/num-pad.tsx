"use client"

import * as React from "react"
import { Check, Delete, Minus, Plus, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export interface NumPadProps {
  value: number | string
  onChange: (value: string) => void
  onConfirm?: () => void
  unit?: string
  /** Increment used by the +/- stepper buttons. Default 1. */
  step?: number
  /** Maximum number of decimal places permitted. Default 2. */
  decimals?: number
  label?: string
  /** Optional min/max clamp applied to stepper + parsed entry. */
  min?: number
  max?: number
  /** Show the live value readout above the keypad. Default true. */
  showDisplay?: boolean
  /** Hide the confirm button (e.g. when embedded with an external save). */
  hideConfirm?: boolean
  className?: string
}

function clampValue(raw: number, min?: number, max?: number): number {
  let next = raw
  if (typeof min === "number" && next < min) next = min
  if (typeof max === "number" && next > max) next = max
  return next
}

function roundToDecimals(raw: number, decimals: number): number {
  if (!Number.isFinite(raw)) return 0
  const factor = Math.pow(10, Math.max(0, decimals))
  return Math.round(raw * factor) / factor
}

function formatStepResult(raw: number, decimals: number): string {
  const rounded = roundToDecimals(raw, decimals)
  // Avoid trailing ".00" noise but keep integer-friendly output.
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toFixed(Math.max(0, decimals)).replace(/0+$/, "").replace(/\.$/, "")
}

function useTouchNumPadEnabled() {
  const [enabled, setEnabled] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }

    const queries = [
      window.matchMedia("(pointer: coarse)"),
      window.matchMedia("(hover: none)"),
      window.matchMedia("(max-width: 1024px)"),
    ]
    const update = () => setEnabled(queries.some((query) => query.matches))

    update()
    queries.forEach((query) => query.addEventListener("change", update))
    return () => {
      queries.forEach((query) => query.removeEventListener("change", update))
    }
  }, [])

  return enabled
}

/**
 * Tap-friendly numeric keypad for factory tablets.
 * Controlled: parent owns `value` and receives string updates via `onChange`.
 * Physical keyboard input (0-9, ., backspace, enter) keeps working via the
 * hidden focus target so operators can use either modality.
 */
export function NumPad({
  value,
  onChange,
  onConfirm,
  unit,
  step = 1,
  decimals = 2,
  label,
  min,
  max,
  showDisplay = true,
  hideConfirm = false,
  className,
}: NumPadProps) {
  const stringValue = value === null || value === undefined ? "" : String(value)
  const allowDecimal = decimals > 0

  const emit = React.useCallback(
    (next: string) => {
      onChange(next)
    },
    [onChange]
  )

  const appendDigit = React.useCallback(
    (digit: string) => {
      const current = stringValue
      // Enforce decimal-place cap.
      if (allowDecimal && current.includes(".")) {
        const [, frac = ""] = current.split(".")
        if (frac.length >= decimals) return
      }
      // Normalise a lone leading zero ("0" + "5" => "5").
      let base = current
      if (base === "0" && digit !== ".") base = ""
      emit(`${base}${digit}`)
    },
    [allowDecimal, decimals, emit, stringValue]
  )

  const appendDecimal = React.useCallback(() => {
    if (!allowDecimal) return
    if (stringValue.includes(".")) return
    emit(stringValue === "" ? "0." : `${stringValue}.`)
  }, [allowDecimal, emit, stringValue])

  const backspace = React.useCallback(() => {
    if (!stringValue) return
    emit(stringValue.slice(0, -1))
  }, [emit, stringValue])

  const clear = React.useCallback(() => {
    emit("")
  }, [emit])

  const applyStep = React.useCallback(
    (direction: 1 | -1) => {
      const parsed = Number.parseFloat(stringValue)
      const baseline = Number.isFinite(parsed) ? parsed : 0
      const next = clampValue(baseline + direction * step, min, max)
      emit(formatStepResult(next, decimals))
    },
    [decimals, emit, max, min, step, stringValue]
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const { key } = event
      if (key >= "0" && key <= "9") {
        event.preventDefault()
        appendDigit(key)
        return
      }
      if (key === "." || key === ",") {
        event.preventDefault()
        appendDecimal()
        return
      }
      if (key === "Backspace") {
        event.preventDefault()
        backspace()
        return
      }
      if (key === "Delete") {
        event.preventDefault()
        clear()
        return
      }
      if (key === "ArrowUp") {
        event.preventDefault()
        applyStep(1)
        return
      }
      if (key === "ArrowDown") {
        event.preventDefault()
        applyStep(-1)
        return
      }
      if (key === "Enter" && onConfirm) {
        event.preventDefault()
        onConfirm()
      }
    },
    [appendDecimal, appendDigit, applyStep, backspace, clear, onConfirm]
  )

  const keys: Array<{ label: React.ReactNode; onClick: () => void; key: string; variant?: "digit" | "action" | "danger" }> = [
    { key: "1", label: "1", onClick: () => appendDigit("1"), variant: "digit" },
    { key: "2", label: "2", onClick: () => appendDigit("2"), variant: "digit" },
    { key: "3", label: "3", onClick: () => appendDigit("3"), variant: "digit" },
    { key: "4", label: "4", onClick: () => appendDigit("4"), variant: "digit" },
    { key: "5", label: "5", onClick: () => appendDigit("5"), variant: "digit" },
    { key: "6", label: "6", onClick: () => appendDigit("6"), variant: "digit" },
    { key: "7", label: "7", onClick: () => appendDigit("7"), variant: "digit" },
    { key: "8", label: "8", onClick: () => appendDigit("8"), variant: "digit" },
    { key: "9", label: "9", onClick: () => appendDigit("9"), variant: "digit" },
    {
      key: "dot",
      label: allowDecimal ? "." : <Minus className="size-5" />,
      onClick: allowDecimal ? appendDecimal : () => applyStep(-1),
      variant: "action",
    },
    { key: "0", label: "0", onClick: () => appendDigit("0"), variant: "digit" },
    { key: "back", label: <Delete className="size-5" />, onClick: backspace, variant: "action" },
  ]

  return (
    <div
      className={cn(
        "flex w-full max-w-xs flex-col gap-3 rounded-3xl border border-slate-200/70 bg-surface-1 p-4 shadow-sm ring-1 ring-slate-100/60",
        className
      )}
      role="group"
      aria-label={label ? `${label} keypad` : "Numeric keypad"}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {label ? (
        <div className="font-display text-sm font-bold tracking-tight text-slate-700">{label}</div>
      ) : null}

      {showDisplay ? (
        <div className="flex items-baseline justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="font-mono text-2xl font-bold tabular-nums text-slate-900">
            {stringValue === "" ? "0" : stringValue}
          </span>
          {unit ? <span className="ml-2 text-sm font-semibold text-content-4">{unit}</span> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        {keys.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={entry.onClick}
            className={cn(
              "flex h-14 min-h-[56px] items-center justify-center rounded-2xl text-xl font-bold tabular-nums transition-all duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20",
              entry.variant === "digit"
                ? "border border-slate-200 bg-surface-1 text-slate-900 shadow-sm hover:-translate-y-px hover:border-blue-400 hover:bg-slate-50"
                : entry.variant === "danger"
                  ? "border border-danger-border bg-danger-bg text-rose-600 hover:bg-rose-100"
                  : "border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200"
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => applyStep(-1)}
          className="flex h-12 min-h-[48px] items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-surface-1 text-sm font-bold text-slate-700 shadow-sm transition-all duration-150 ease-out active:scale-[0.97] hover:-translate-y-px hover:border-blue-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20"
          aria-label={`Decrease by ${step}`}
        >
          <Minus className="size-4" /> {formatStepResult(step, decimals)}
        </button>
        <button
          type="button"
          onClick={() => applyStep(1)}
          className="flex h-12 min-h-[48px] items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-surface-1 text-sm font-bold text-slate-700 shadow-sm transition-all duration-150 ease-out active:scale-[0.97] hover:-translate-y-px hover:border-blue-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20"
          aria-label={`Increase by ${step}`}
        >
          <Plus className="size-4" /> {formatStepResult(step, decimals)}
        </button>
      </div>

      <div className={cn("grid gap-2", hideConfirm ? "grid-cols-1" : "grid-cols-2")}>
        <button
          type="button"
          onClick={clear}
          className="flex h-12 min-h-[48px] items-center justify-center gap-1.5 rounded-2xl border border-danger-border bg-danger-bg text-sm font-bold text-rose-600 transition-all duration-150 ease-out active:scale-[0.97] hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/20"
        >
          <X className="size-4" /> Clear
        </button>
        {hideConfirm ? null : (
          <button
            type="button"
            onClick={() => onConfirm?.()}
            className="flex h-12 min-h-[48px] items-center justify-center gap-1.5 rounded-2xl bg-blue-600 text-sm font-bold text-white shadow-[0_1px_1px_rgba(15,23,42,0.10),0_6px_16px_-8px_rgba(37,99,235,0.45)] transition-all duration-150 ease-out active:scale-[0.97] hover:-translate-y-px hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20"
          >
            <Check className="size-4" /> Confirm
          </button>
        )}
      </div>
    </div>
  )
}

export interface NumPadPopoverProps extends Omit<NumPadProps, "showDisplay"> {
  placeholder?: string
  disabled?: boolean
  inputClassName?: string
  /** Extra props forwarded to the trigger input. */
  inputProps?: Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "disabled" | "placeholder" | "className"
  >
  /** Controlled open state (optional). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * An input that opens the NumPad in a popover when tapped/focused, while still
 * accepting direct keyboard typing. Confirm (or closing the popover) commits.
 */
export function NumPadPopover({
  value,
  onChange,
  onConfirm,
  unit,
  step,
  decimals = 2,
  label,
  min,
  max,
  placeholder,
  disabled,
  className,
  inputClassName,
  inputProps,
  hideConfirm,
  open: controlledOpen,
  onOpenChange,
}: NumPadPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const touchNumPadEnabled = useTouchNumPadEnabled()
  const open = touchNumPadEnabled && (isControlled ? controlledOpen : uncontrolledOpen)

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (next && !touchNumPadEnabled) return
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange, touchNumPadEnabled]
  )

  const stringValue = value === null || value === undefined ? "" : String(value)

  const sanitizeTyped = React.useCallback(
    (raw: string): string => {
      // Allow only digits and a single decimal point, capped to `decimals`.
      let cleaned = raw.replace(/[^0-9.]/g, "")
      const firstDot = cleaned.indexOf(".")
      if (firstDot !== -1) {
        const head = cleaned.slice(0, firstDot + 1)
        const tail = cleaned.slice(firstDot + 1).replace(/\./g, "")
        cleaned = head + (decimals > 0 ? tail.slice(0, decimals) : "")
        if (decimals <= 0) cleaned = cleaned.replace(".", "")
      }
      return cleaned
    },
    [decimals]
  )

  const handleConfirm = React.useCallback(() => {
    onConfirm?.()
    setOpen(false)
  }, [onConfirm, setOpen])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className={cn("relative", className)}>
          <input
            {...inputProps}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder}
            value={stringValue}
            onChange={(event) => onChange(sanitizeTyped(event.target.value))}
            onFocus={() => {
              if (!disabled && touchNumPadEnabled) setOpen(true)
            }}
            className={cn(
              "flex h-12 w-full rounded-2xl border border-slate-200 bg-surface-1 px-4 py-2 text-right font-mono text-lg font-bold tabular-nums text-slate-950 ring-offset-background transition-[border-color,box-shadow] duration-200 ease-out placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-content-4 hover:border-line-strong focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60",
              unit ? "pr-12" : undefined,
              inputClassName
            )}
          />
          {unit ? (
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-content-4">
              {unit}
            </span>
          ) : null}
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-none bg-transparent p-0 shadow-none ring-0">
        <NumPad
          value={value}
          onChange={onChange}
          onConfirm={handleConfirm}
          unit={unit}
          step={step}
          decimals={decimals}
          label={label}
          min={min}
          max={max}
          hideConfirm={hideConfirm}
        />
      </PopoverContent>
    </Popover>
  )
}

export default NumPad
