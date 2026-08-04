import useSWR, { SWRConfiguration } from "swr";
import { mutate as swrMutate } from "swr";
import { useCallback, useEffect, useRef } from "react";

// ─── Core fetch helpers ────────────────────────────────────
export const API_BASE = "/api/data";

export async function apiGet<T = any>(path: string, params?: Record<string, string | number | undefined | null>, config?: RequestInit): Promise<T> {
  const search = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        search.set(k, String(v));
      }
    }
  }
  const qs = search.toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...config,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function apiPost<T = any>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ─── Query hook ────────────────────────────────────────────
export interface UseDataResult<T> {
  data: T | undefined;
  error: any;
  isLoading: boolean;
  isValidating: boolean;
  mutate: (data?: T | Promise<T>, opts?: any) => Promise<any>;
}

export function useData<T = any>(
  key: string | null | undefined,
  fetcher: (() => Promise<T>) | null | undefined,
  config?: SWRConfiguration<T>
): UseDataResult<T> {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(
    key,
    fetcher ?? (async () => undefined as unknown as T),
    { revalidateOnFocus: false, dedupingInterval: 500, keepPreviousData: true, ...config }
  );
  return { data, error, isLoading, isValidating, mutate };
}

// ─── Mutation helper ───────────────────────────────────────
export function useDataMutation<T = any>(
  path: string,
  opts?: {
    onSuccess?: (data: T) => void;
    onError?: (err: any) => void;
    invalidate?: () => void; // gọi mutate lại sau khi thành công
  }
) {
  const onSuccessRef = useRef(opts?.onSuccess);
  const onErrorRef = useRef(opts?.onError);
  const invalidateRef = useRef(opts?.invalidate);
  onSuccessRef.current = opts?.onSuccess;
  onErrorRef.current = opts?.onError;
  invalidateRef.current = opts?.invalidate;

  const run = async (body: any): Promise<T> => {
    try {
      const res = await apiPost<T>(path, body);
      invalidateRef.current?.();
      onSuccessRef.current?.(res);
      return res;
    } catch (err) {
      onErrorRef.current?.(err);
      throw err;
    }
  };

  return { run, mutate: run };
}

/**
 * Invalidate một hoặc nhiều SWR keys (dùng sau mutation).
 * Pattern: `useInvalidate(["projects", "tasks", "deps"])`
 */
export function useInvalidate() {
  return useCallback((patterns: string[]) => {
    const keys = patterns.filter(Boolean);
    if (keys.length === 0) return Promise.resolve();
    return swrMutate(
      (key: any) => typeof key === "string" && keys.some((p) => key.startsWith(p))
    );
  }, []);
}