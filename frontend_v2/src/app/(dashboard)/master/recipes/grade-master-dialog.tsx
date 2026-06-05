"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recipeService, RecipeGrade } from "@/services/recipes";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings2, Pencil, Trash2, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { describeApiError } from "@/lib/api";

export function GradeMasterDialog() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingGrade, setEditingGrade] = useState<RecipeGrade | null>(null);

  const {
    data: grades,
    isLoading,
    isError,
    error: gradeLoadError,
  } = useQuery({
    queryKey: ["recipe-grades"],
    queryFn: () => recipeService.getGrades(),
    enabled: isOpen,
  });

  const gradeLoadErrorMessage = isError
    ? describeApiError(gradeLoadError, "Failed to load grades.")
    : null;

  const createMutation = useMutation({
    mutationFn: recipeService.createGrade,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-grades"] });
      setNewName("");
      setCreateError(null);
      toast({ title: "Success", description: "Grade created" });
    },
    onError: (err: any) => {
      const msg = describeApiError(err, "Failed to create grade.");
      setCreateError(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      recipeService.updateGrade(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-grades"] });
      setEditingGrade(null);
      toast({ title: "Success", description: "Grade updated" });
    },
    onError: (err: any) => {
      const msg = describeApiError(err, "Failed to update grade.");
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: recipeService.deleteGrade,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-grades"] });
      toast({ title: "Success", description: "Grade deleted" });
    },
    onError: (err: any) => {
      const msg = describeApiError(err, "Failed to delete grade.");
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setCreateError("Enter a grade name before adding it.");
      return;
    }
    setCreateError(null);
    createMutation.mutate({ name: trimmedName });
  };

  const handleUpdate = () => {
    if (!editingGrade || !editingGrade.name.trim()) return;
    updateMutation.mutate({ id: editingGrade.id, name: editingGrade.name });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          setCreateError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 className="mr-2 h-4 w-4" /> Grade Master
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Grade Master List</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Create New */}
          <div className="flex gap-2">
            <Input
              placeholder="New Grade Name..."
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (createError) setCreateError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Button
              type="button"
              size="icon"
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>
          {createError ? (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm font-medium text-danger-fg">
              {createError}
            </div>
          ) : null}

          <div className="border rounded-md divide-y max-h-[300px] overflow-y-auto">
            {gradeLoadErrorMessage ? (
              <div className="m-3 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm font-medium text-danger-fg">
                {gradeLoadErrorMessage}
              </div>
            ) : isLoading ? (
              <div className="p-4 text-center text-content-3">Loading...</div>
            ) : grades?.length === 0 ? (
              <div className="p-4 text-center text-content-3">
                No grades found
              </div>
            ) : (
              grades?.map((grade) => (
                <div
                  key={grade.id}
                  className="p-3 flex items-center justify-between group"
                >
                  {editingGrade?.id === grade.id ? (
                    <div className="flex flex-1 gap-2">
                      <Input
                        size={1}
                        className="h-8 py-0"
                        value={editingGrade.name}
                        onChange={(e) =>
                          setEditingGrade({
                            ...editingGrade,
                            name: e.target.value,
                          })
                        }
                        onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={handleUpdate}
                        disabled={updateMutation.isPending}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-content-3"
                        onClick={() => setEditingGrade(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="font-medium text-content-2">
                        {grade.name}
                      </span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setEditingGrade(grade)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(grade.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
