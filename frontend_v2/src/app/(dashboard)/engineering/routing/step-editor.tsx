import React from "react";
import { Button } from "@/components/ui/button";
import { GripVertical, X, Plus } from "lucide-react";
import { Process } from "@/services/factory";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function StepEditor({
  value,
  onChange,
  allProcesses,
}: {
  value: string[];
  onChange: (val: string[]) => void;
  allProcesses: Process[];
}) {
  const addStep = () => {
    onChange([...value, ""]);
  };

  const removeStep = (index: number) => {
    const newValue = [...value];
    newValue.splice(index, 1);
    onChange(newValue);
  };

  const updateStep = (index: number, processCode: string) => {
    const newValue = [...value];
    newValue[index] = processCode;
    onChange(newValue);
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    const newValue = [...value];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= value.length) return;

    const temp = newValue[index];
    newValue[index] = newValue[targetIndex];
    newValue[targetIndex] = temp;
    onChange(newValue);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">
          Production Steps (Ordered)
        </label>
        <Button type="button" variant="outline" size="sm" onClick={addStep}>
          <Plus className="mr-2 h-3 w-3" /> Add Step
        </Button>
      </div>

      <div className="space-y-2">
        {value.map((stepCode, index) => (
          <div
            key={index}
            className="flex items-center gap-2 bg-surface-2 p-2 rounded-md border"
          >
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => moveStep(index, "up")}
                disabled={index === 0}
              >
                <GripVertical className="h-3 w-3 rotate-180" />
              </Button>
            </div>

            <div className="flex-1">
              <Select
                value={stepCode}
                onValueChange={(val) => updateStep(index, val)}
              >
                <SelectTrigger className="h-8 bg-surface-1">
                  <SelectValue placeholder="Select process" />
                </SelectTrigger>
                <SelectContent>
                  {allProcesses.map((p) => (
                    <SelectItem key={p.id} value={p.code}>
                      {p.name} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => removeStep(index)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        {value.length === 0 && (
          <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-md">
            No steps added yet.
          </div>
        )}
      </div>
    </div>
  );
}
