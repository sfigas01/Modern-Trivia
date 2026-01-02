import { useQuery } from "@tanstack/react-query";

async function checkAdminStatus(): Promise<{ isAdmin: boolean }> {
  const response = await fetch("/api/admin/check", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export function useAdmin() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/check"],
    queryFn: checkAdminStatus,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    isAdmin: data?.isAdmin ?? false,
    isLoading,
    error,
  };
}
