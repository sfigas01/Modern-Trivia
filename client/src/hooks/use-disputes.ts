import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dispute, InsertDispute } from "@shared/schema";

async function fetchDisputes(): Promise<Dispute[]> {
  const response = await fetch("/api/disputes", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function createDispute(dispute: InsertDispute): Promise<Dispute> {
  const response = await fetch("/api/disputes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dispute),
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function clearAllDisputes(): Promise<void> {
  const response = await fetch("/api/disputes", {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }
}

export function useDisputes() {
  const queryClient = useQueryClient();

  const { data: disputes = [], isLoading, error } = useQuery({
    queryKey: ["/api/disputes"],
    queryFn: fetchDisputes,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: createDispute,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disputes"] });
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearAllDisputes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disputes"] });
    },
  });

  return {
    disputes,
    isLoading,
    error,
    createDispute: createMutation.mutate,
    clearDisputes: clearMutation.mutate,
    isCreating: createMutation.isPending,
    isClearing: clearMutation.isPending,
  };
}
