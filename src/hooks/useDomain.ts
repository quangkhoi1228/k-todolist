"use client";

import { useData, apiGet, apiPost, useInvalidate } from "./useData";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Projects ──────────────────────────────────────────────
export function useProjects(userId?: string | null, opts?: { includeArchived?: boolean; includeTrashed?: boolean }) {
  const key = userId ? `projects:${userId}:${opts?.includeArchived}:${opts?.includeTrashed}` : null;
  return useData<any[]>(
    key,
    key
      ? () =>
          apiGet("/projects", {
            action: "getProjects",
            userId,
            includeArchived: opts?.includeArchived ? "true" : undefined,
            includeTrashed: opts?.includeTrashed ? "true" : undefined,
          })
      : null
  );
}

export function useProject(id?: string | null) {
  const key = id ? `project:${id}` : null;
  return useData<any>(key, key ? () => apiGet("/projects", { action: "getProject", id }) : null);
}

export function useActiveProjectsWithTeamsGroups(userId?: string | null) {
  const key = userId ? `projects:active-teams:${userId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/projects", { action: "getActiveProjectsWithTeamsGroups", userId }) : null
  );
}

export function useProjectMutations() {
  const invalidate = useInvalidate();
  return {
    createProject: async (body: { userId: string; name: string; color?: string }) => {
      const res = await apiPost("/projects", { action: "createProject", ...body });
      await invalidate(["projects:"]);
      return res;
    },
    updateProject: async (body: any) => {
      const res = await apiPost("/projects", { action: "updateProject", ...body });
      await invalidate(["projects:", "project:"]);
      return res;
    },
    updateProjectDetail: async (id: string, notes?: string) => {
      const res = await apiPost("/projects", { action: "updateProjectDetail", id, notes });
      await invalidate(["projects:", "project:"]);
      return res;
    },
    updateProjectTeamsGroups: async (body: any) => {
      const res = await apiPost("/projects", { action: "updateProjectTeamsGroups", ...body });
      await invalidate(["projects:", "project:"]);
      return res;
    },
    updateProjectIsdStatus: async (body: any) => {
      const res = await apiPost("/projects", { action: "updateProjectIsdStatus", ...body });
      await invalidate(["projects:", "project:"]);
      return res;
    },
    setProjectArchived: async (id: string, archived: boolean) => {
      const res = await apiPost("/projects", { action: "setProjectArchived", id, archived });
      await invalidate(["projects:", "project:"]);
      return res;
    },
    softDeleteProject: async (id: string) => {
      const res = await apiPost("/projects", { action: "softDeleteProject", id });
      await invalidate(["projects:", "project:"]);
      return res;
    },
    restoreProject: async (id: string) => {
      const res = await apiPost("/projects", { action: "restoreProject", id });
      await invalidate(["projects:", "project:"]);
      return res;
    },
    deleteProject: async (id: string) => {
      const res = await apiPost("/projects", { action: "deleteProject", id });
      await invalidate(["projects:", "project:", "tasks", "notes"]);
      return res;
    },
    updateProjectOrders: async (updates: Array<{ id: string; order: number }>) => {
      const res = await apiPost("/projects", { action: "updateProjectOrders", updates });
      await invalidate(["projects:"]);
      return res;
    },
    cloneProject: async (projectId: string, userId: string, name?: string) => {
      const res = await apiPost("/projects", { action: "cloneProject", projectId, userId, name });
      await invalidate(["projects:", "tasks"]);
      return res;
    },
  };
}

// ─── Tasks ─────────────────────────────────────────────────
export function useTasks(userId?: string | null) {
  const key = userId ? `tasks:${userId}` : null;
  return useData<any[]>(key, key ? () => apiGet("/tasks", { action: "getTasks", userId }) : null);
}

export function useTasksByProject(projectId?: string | null) {
  const key = projectId ? `tasksByProject:${projectId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/tasks", { action: "getTasksByProject", projectId }) : null
  );
}

export function useTaskDependencies(taskId?: string | null) {
  const key = taskId ? `taskDeps:${taskId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/tasks", { action: "getTaskDependencies", taskId }) : null
  );
}

export function useAllDependencies(userId?: string | null) {
  const key = userId ? `deps:${userId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/tasks", { action: "getAllDependencies", userId }) : null
  );
}

export function useTaskMutations() {
  const invalidate = useInvalidate();
  return {
    createTask: async (body: any) => {
      const res = await apiPost("/tasks", { action: "createTask", ...body });
      await invalidate(["tasks", "tasksByProject", "deps"]);
      return res;
    },
    updateTask: async (id: string, body: any) => {
      const res = await apiPost("/tasks", { action: "updateTask", id, ...body });
      await invalidate(["tasks", "tasksByProject"]);
      return res;
    },
    updateTaskOrders: async (updates: any[]) => {
      const res = await apiPost("/tasks", { action: "updateTaskOrders", updates });
      await invalidate(["tasks", "tasksByProject"]);
      return res;
    },
    deleteTask: async (id: string) => {
      const res = await apiPost("/tasks", { action: "deleteTask", id });
      await invalidate(["tasks", "tasksByProject", "deps"]);
      return res;
    },
    createDependency: async (body: any) => {
      const res = await apiPost("/tasks", { action: "createDependency", ...body });
      await invalidate(["tasks", "deps"]);
      return res;
    },
    deleteDependency: async (id: string) => {
      const res = await apiPost("/tasks", { action: "deleteDependency", id });
      await invalidate(["tasks", "deps"]);
      return res;
    },
  };
}

// ─── Notes ─────────────────────────────────────────────────
export function useNotes(userId?: string | null) {
  const key = userId ? `notes:${userId}` : null;
  return useData<any[]>(key, key ? () => apiGet("/notes", { action: "getNotes", userId }) : null);
}

export function useNote(id?: string | null) {
  const key = id ? `note:${id}` : null;
  return useData<any>(key, key ? () => apiGet("/notes", { action: "getNote", id }) : null);
}

export function useNotesWithoutProject(userId?: string | null) {
  const key = userId ? `notes:noproject:${userId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/notes", { action: "getNotesWithoutProject", userId }) : null
  );
}

export function useNotesByProject(projectId?: string | null) {
  const key = projectId ? `notes:project:${projectId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/notes", { action: "getNotesByProject", projectId }) : null
  );
}

export function useNoteByShareSlug(slug?: string | null) {
  const key = slug ? `note:slug:${slug}` : null;
  return useData<any>(
    key,
    key ? () => apiGet("/notes", { action: "getNoteByShareSlug", slug }) : null
  );
}

export function useNoteMutations() {
  const invalidate = useInvalidate();
  return {
    createNote: async (body: any) => {
      const res = await apiPost("/notes", { action: "createNote", ...body });
      await invalidate(["notes"]);
      return res;
    },
    updateNote: async (id: string, body: any) => {
      const res = await apiPost("/notes", { action: "updateNote", id, ...body });
      await invalidate(["notes", "note:"]);
      return res;
    },
    deleteNote: async (id: string) => {
      const res = await apiPost("/notes", { action: "deleteNote", id });
      await invalidate(["notes", "note:"]);
      return res;
    },
    updateNoteOrders: async (updates: any[]) => {
      const res = await apiPost("/notes", { action: "updateNoteOrders", updates });
      await invalidate(["notes"]);
      return res;
    },
    moveNoteToProject: async (noteId: string, projectId?: string | null) => {
      const res = await apiPost("/notes", { action: "moveNoteToProject", noteId, projectId });
      await invalidate(["notes"]);
      return res;
    },
    generateShareSlug: async (noteId: string) => {
      const res = await apiPost("/notes", { action: "generateShareSlug", noteId });
      await invalidate(["notes"]);
      return res;
    },
    removeShareSlug: async (noteId: string) => {
      const res = await apiPost("/notes", { action: "removeShareSlug", noteId });
      await invalidate(["notes"]);
      return res;
    },
  };
}

// ─── Suggestions ───────────────────────────────────────────
export function useSuggestionsByProject(projectId?: string | null) {
  const key = projectId ? `suggestions:project:${projectId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/suggestions", { action: "getSuggestionsByProject", projectId }) : null
  );
}

export function useUnresolvedSuggestionsByUser(userId?: string | null) {
  const key = userId ? `suggestions:user:${userId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/suggestions", { action: "getUnresolvedSuggestionsByUser", userId }) : null
  );
}

export function useUnresolvedCountByUser(userId?: string | null) {
  const key = userId ? `suggestions:count:${userId}` : null;
  return useData<number>(
    key,
    key ? () => apiGet("/suggestions", { action: "getUnresolvedCountByUser", userId }) : null
  );
}

export function useSuggestionMutations() {
  const invalidate = useInvalidate();
  return {
    addSuggestion: async (body: any) => {
      const res = await apiPost("/suggestions", { action: "addSuggestion", ...body });
      await invalidate(["suggestions"]);
      return res;
    },
    markSuggestionAsRead: async (id: string) => {
      const res = await apiPost("/suggestions", { action: "markSuggestionAsRead", id });
      await invalidate(["suggestions"]);
      return res;
    },
    markSuggestionAsResolved: async (id: string) => {
      const res = await apiPost("/suggestions", { action: "markSuggestionAsResolved", id });
      await invalidate(["suggestions"]);
      return res;
    },
    markAllAsReadByProject: async (projectId: string) => {
      const res = await apiPost("/suggestions", { action: "markAllAsReadByProject", projectId });
      await invalidate(["suggestions"]);
      return res;
    },
    deleteSuggestion: async (id: string) => {
      const res = await apiPost("/suggestions", { action: "deleteSuggestion", id });
      await invalidate(["suggestions"]);
      return res;
    },
    addSuggestionsBatch: async (body: any) => {
      const res = await apiPost("/suggestions", { action: "addSuggestionsBatch", ...body });
      await invalidate(["suggestions"]);
      return res;
    },
  };
}

// ─── Chats (projectChats) ──────────────────────────────────
export function useMessagesByProject(projectId?: string | null, chatNames?: string[]) {
  const key = projectId ? `chats:${projectId}:${JSON.stringify(chatNames ?? [])}` : null;
  return useData<any[]>(
    key,
    key
      ? () =>
          apiGet("/chats", {
            action: "getMessagesByProject",
            projectId,
            chatNames: chatNames && chatNames.length > 0 ? JSON.stringify(chatNames) : undefined,
          })
      : null
  );
}

export function useChatMutations() {
  const invalidate = useInvalidate();
  return {
    saveMessages: async (body: any) => {
      const res = await apiPost("/chats", { action: "saveMessages", ...body });
      await invalidate(["chats:"]);
      return res;
    },
    updateImages: async (body: any) => {
      const res = await apiPost("/chats", { action: "updateImages", ...body });
      await invalidate(["chats:"]);
      return res;
    },
    clearProjectMessages: async (projectId: string, chatName?: string) => {
      const res = await apiPost("/chats", { action: "clearProjectMessages", projectId, chatName });
      await invalidate(["chats:"]);
      return res;
    },
    uploadChatImage: async (dataUrl: string, userId: string) => {
      return apiPost("/chats", { action: "uploadChatImage", dataUrl, userId });
    },
  };
}

// ─── Groups / scrapedGroups ────────────────────────────────
export function useScrapedGroups(userId?: string | null, platform?: string) {
  const key = userId ? `groups:${userId}:${platform ?? "all"}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/groups", { action: "getScrapedGroups", userId, platform }) : null
  );
}

export function useGroupMutations() {
  const invalidate = useInvalidate();
  return {
    syncGroups: async (body: any) => {
      const res = await apiPost("/groups", { action: "syncGroups", ...body });
      await invalidate(["groups:"]);
      return res;
    },
    updateGroupSyncedAt: async (body: any) => {
      const res = await apiPost("/groups", { action: "updateGroupSyncedAt", ...body });
      await invalidate(["groups:"]);
      return res;
    },
  };
}

// ─── Sync logs ─────────────────────────────────────────────
export function useLogs(projectId?: string | null, limit?: number) {
  const key = `logs:${projectId ?? "all"}:${limit ?? ""}`;
  return useData<any[]>(
    key,
    () => apiGet("/logs", { action: "getLogs", projectId, limit }),
    { refreshInterval: 5000 }
  );
}

export function useRecentLogs(type?: string, limit?: number) {
  const key = `logs:recent:${type ?? ""}:${limit ?? ""}`;
  return useData<any[]>(
    key,
    () => apiGet("/logs", { action: "getRecentLogs", type, limit }),
    { refreshInterval: 10000 }
  );
}

export function useLogMutations() {
  const invalidate = useInvalidate();
  return {
    addLog: async (body: any) => {
      const res = await apiPost("/logs", { action: "addLog", ...body });
      await invalidate(["logs"]);
      return res;
    },
    addLogsBatch: async (logs: any[]) => {
      const res = await apiPost("/logs", { action: "addLogsBatch", logs });
      await invalidate(["logs"]);
      return res;
    },
    clearLogs: async (before?: number) => {
      const res = await apiPost("/logs", { action: "clearLogs", before });
      await invalidate(["logs"]);
      return res;
    },
  };
}

// ─── Paginated logs (thay usePaginatedQuery) ───────────────
export function usePaginatedLogs(limit = 20) {
  const [logs, setLogs] = useState<any[] | undefined>(undefined);
  const [status, setStatus] = useState<"LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted">("LoadingFirstPage");
  const cursorRef = useRef<number | null>(null);

  const fetchFirst = useCallback(async () => {
    setStatus("LoadingFirstPage");
    try {
      const res = await apiGet("/logs", { action: "getLogsPaginated", cursor: null, limit });
      setLogs(res.results ?? []);
      cursorRef.current = res.nextCursor;
      setStatus(res.hasMore ? "CanLoadMore" : "Exhausted");
    } catch (err) {
      console.error("[logs] failed to load first page:", err);
      setStatus("Exhausted");
    }
  }, [limit]);

  const loadMore = useCallback(async (count = 20) => {
    if (status === "LoadingMore") return;
    setStatus("LoadingMore");
    try {
      const res = await apiGet("/logs", { action: "getLogsPaginated", cursor: cursorRef.current, limit: count });
      setLogs((prev) => [...(prev ?? []), ...(res.results ?? [])]);
      cursorRef.current = res.nextCursor;
      setStatus(res.hasMore ? "CanLoadMore" : "Exhausted");
    } catch (err) {
      console.error("[logs] failed to load more:", err);
      setStatus("CanLoadMore");
    }
  }, [status]);

  useEffect(() => {
    void fetchFirst();
  }, [fetchFirst]);

  return { results: logs, status, loadMore };
}

// ─── User preferences ──────────────────────────────────────
export function useUserPreferences(userId?: string | null) {
  const key = userId ? `prefs:${userId}` : null;
  return useData<any>(key, key ? () => apiGet("/preferences", { userId }) : null);
}

export function usePreferenceMutations() {
  const invalidate = useInvalidate();
  return {
    updateUserPreferences: async (body: any) => {
      const res = await apiPost("/preferences", { ...body });
      await invalidate(["prefs:"]);
      return res;
    },
  };
}

// ─── Emails ────────────────────────────────────────────────
export function useEmails(userId?: string | null, opts?: { limit?: number; projectId?: string }) {
  const key = userId ? `emails:${userId}:${opts?.projectId ?? ""}:${opts?.limit ?? ""}` : null;
  return useData<any[]>(
    key,
    key
      ? () =>
          apiGet("/emails", {
            action: "getByUser",
            userId,
            limit: opts?.limit,
            projectId: opts?.projectId,
          })
      : null
  );
}

export function useRecipients(userId?: string | null) {
  const key = userId ? `recipients:${userId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/emails", { action: "getAllRecipients", userId }) : null
  );
}

export function useEmailMutations() {
  const invalidate = useInvalidate();
  return {
    createEmailLog: async (body: any) => {
      const res = await apiPost("/emails", { action: "createEmailLog", ...body });
      await invalidate(["emails"]);
      return res;
    },
    updateEmailStatus: async (id: string, status: string, errorMessage?: string) => {
      const res = await apiPost("/emails", { action: "updateEmailStatus", id, status, errorMessage });
      await invalidate(["emails"]);
      return res;
    },
    setEmailProject: async (id: string, projectId?: string) => {
      const res = await apiPost("/emails", { action: "setProject", id, projectId });
      await invalidate(["emails"]);
      return res;
    },
    deleteEmail: async (id: string) => {
      const res = await apiPost("/emails", { action: "deleteEmail", id });
      await invalidate(["emails"]);
      return res;
    },
    saveRecipient: async (userId: string, email: string, name?: string) => {
      const res = await apiPost("/emails", { action: "saveRecipient", userId, email, name });
      await invalidate(["recipients"]);
      return res;
    },
    saveRecipients: async (userId: string, emails: string[]) => {
      const res = await apiPost("/emails", { action: "saveRecipients", userId, emails });
      await invalidate(["recipients"]);
      return res;
    },
  };
}

// ─── Agents PM (sessions + messages) ───────────────────────
export function usePmSessions(userId?: string | null) {
  const key = userId ? `pmsessions:${userId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/agents-pm", { action: "getSessions", userId }) : null
  );
}

export function usePmGeneralSession(userId?: string | null) {
  const key = userId ? `pmgeneral:${userId}` : null;
  return useData<any>(
    key,
    key ? () => apiGet("/agents-pm", { action: "getGeneralSession", userId }) : null
  );
}

export function usePmSessionByProject(projectId?: string | null, userId?: string | null) {
  const key = projectId && userId ? `pmsession-proj:${projectId}` : null;
  return useData<any>(
    key,
    key ? () => apiGet("/agents-pm", { action: "getSessionByProject", userId, projectId }) : null
  );
}

export function usePmMessages(sessionId?: string | null) {
  const key = sessionId ? `pmmessages:${sessionId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/agents-pm", { action: "getMessages", sessionId }) : null
  );
}

export function usePmSessionById(id?: string | null) {
  const key = id ? `pmsession:${id}` : null;
  return useData<any>(key, key ? () => apiGet("/agents-pm", { action: "getSession", id }) : null);
}

export function usePmMutations() {
  const invalidate = useInvalidate();
  const inv = async () => invalidate(["pmsessions", "pmgeneral", "pmsession", "pmmessages", "projects:", "tasks", "notes"]);
  return {
    createGeneralSession: async (userId: string) => {
      const res = await apiPost("/agents-pm", { action: "createGeneralSession", userId });
      await inv();
      return res;
    },
    createProjectSession: async (userId: string, projectId: string, projectName: string) => {
      const res = await apiPost("/agents-pm", {
        action: "createProjectSession",
        userId,
        projectId,
        projectName,
      });
      await inv();
      return res;
    },
    createSession: async (body: any) => {
      const res = await apiPost("/agents-pm", { action: "createSession", ...body });
      await inv();
      return res;
    },
    updateSession: async (id: string, body: any) => {
      const res = await apiPost("/agents-pm", { action: "updateSession", id, ...body });
      await inv();
      return res;
    },
    addMessage: async (body: any) => {
      const res = await apiPost("/agents-pm", { action: "addMessage", ...body });
      await inv();
      return res;
    },
    advanceStep: async (id: string, step: string) => {
      const res = await apiPost("/agents-pm", { action: "advanceStep", id, step });
      await inv();
      return res;
    },
    deleteSession: async (id: string) => {
      const res = await apiPost("/agents-pm", { action: "deleteSession", id });
      await inv();
      return res;
    },
    createCustomProject: async (userId: string, projectName: string) => {
      const res = await apiPost("/agents-pm", { action: "createCustomProject", userId, projectName });
      await inv();
      return res;
    },
    createProjectFromTicket: async (body: any) => {
      const res = await apiPost("/agents-pm", { action: "createProjectFromTicket", ...body });
      await inv();
      return res;
    },
  };
}

// ─── Members & roles ───────────────────────────────────────
export function useMembersByProject(projectId?: string | null) {
  const key = projectId ? `members:${projectId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/members", { action: "getMembersByProject", projectId }) : null
  );
}

export function useMemberMutations() {
  const invalidate = useInvalidate();
  return {
    addMember: async (body: any) => {
      const res = await apiPost("/members", { action: "addMember", ...body });
      await invalidate(["members:", "roles"]);
      return res;
    },
    updateMember: async (id: string, body: any) => {
      const res = await apiPost("/members", { action: "updateMember", id, ...body });
      await invalidate(["members:"]);
      return res;
    },
    removeMember: async (id: string) => {
      const res = await apiPost("/members", { action: "removeMember", id });
      await invalidate(["members:", "roles"]);
      return res;
    },
  };
}

export function useRoles(userId?: string | null) {
  const key = userId ? `roles:${userId}` : null;
  return useData<any[]>(key, key ? () => apiGet("/roles", { action: "getRoles", userId }) : null);
}

export function useRoleUsageCounts(userId?: string | null) {
  const key = userId ? `roles:usage:${userId}` : null;
  return useData<any>(
    key,
    key ? () => apiGet("/roles", { action: "getRoleUsageCounts", userId }) : null
  );
}

export function useRoleMutations() {
  const invalidate = useInvalidate();
  return {
    seedDefaultRoles: async (userId: string) => {
      const res = await apiPost("/roles", { action: "seedDefaultRoles", userId });
      await invalidate(["roles"]);
      return res;
    },
    createRole: async (body: any) => {
      const res = await apiPost("/roles", { action: "createRole", ...body });
      await invalidate(["roles"]);
      return res;
    },
    updateRole: async (id: string, body: any) => {
      const res = await apiPost("/roles", { action: "updateRole", id, ...body });
      await invalidate(["roles"]);
      return res;
    },
    deleteRole: async (id: string) => {
      const res = await apiPost("/roles", { action: "deleteRole", id });
      await invalidate(["roles"]);
      return res;
    },
  };
}

// ─── ISD data ──────────────────────────────────────────────
export function useIsdByProject(projectId?: string | null) {
  const key = projectId ? `isd:project:${projectId}` : null;
  return useData<any>(
    key,
    key ? () => apiGet("/isd", { action: "getByProject", projectId }) : null
  );
}

export function useIsdMutations() {
  const invalidate = useInvalidate();
  return {
    upsertIsdByProject: async (body: any) => {
      const res = await apiPost("/isd", { action: "upsertByProject", ...body });
      await invalidate(["isd:"]);
      return res;
    },
    removeIsdByProject: async (projectId: string) => {
      const res = await apiPost("/isd", { action: "removeByProject", projectId });
      await invalidate(["isd:"]);
      return res;
    },
  };
}

// ─── Files / upload ────────────────────────────────────────
export function useUploadFile() {
  return useCallback(async (dataUrl: string, userId: string, name?: string, mimeType?: string) => {
    const res = await apiPost<any>("/files", { userId, dataUrl, name, mimeType });
    return res.url as string;
  }, []);
}