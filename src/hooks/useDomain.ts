"use client";

import { useData, apiGet, apiPost, useInvalidate } from "./useData";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Projects ──────────────────────────────────────────────
export function useProjects(userId?: string | null, opts?: { includeArchived?: boolean; includeTrashed?: boolean }) {
  const key = userId ? `projects:${userId}:all` : null;
  const result = useData<any[]>(
    key,
    key
      ? () =>
          apiGet("/projects", {
            action: "getProjects",
            userId,
            includeArchived: "true",
            includeTrashed: "true",
          })
      : null
  );

  const filteredData = useMemo(() => {
    if (!result.data) return result.data;
    return result.data.filter(p => {
      if (!opts?.includeArchived && p.archived) return false;
      if (!opts?.includeTrashed && p.deletedAt) return false;
      return true;
    });
  }, [result.data, opts?.includeArchived, opts?.includeTrashed]);

  return {
    ...result,
    data: filteredData,
  };
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
  return useMemo(() => ({
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
  }), [invalidate]);
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
  return useMemo(() => ({
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
  }), [invalidate]);
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
  return useMemo(() => ({
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
  }), [invalidate]);
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
  return useMemo(() => ({
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
  }), [invalidate]);
}

// ─── Project Workflow (init → kick-off) ────────────────────
export function useProjectWorkflow(projectId?: string | null) {
  const key = projectId ? `workflow:${projectId}` : null;
  return useData<any>(
    key,
    key ? () => apiGet("/project-workflows", { action: "getWorkflowByProject", projectId }) : null
  );
}

export function useProjectWorkflowMutations() {
  const invalidate = useInvalidate();
  return useMemo(() => ({
    ensureWorkflow: async (body: any) => {
      const res = await apiPost("/project-workflows", { action: "ensureWorkflow", ...body });
      await invalidate(["workflow:"]);
      return res;
    },
    updateWorkflowStep: async (body: any) => {
      const res = await apiPost("/project-workflows", { action: "updateWorkflowStep", ...body });
      await invalidate(["workflow:"]);
      return res;
    },
    updateWorkflowPhase: async (body: any) => {
      const res = await apiPost("/project-workflows", { action: "updateWorkflowPhase", ...body });
      await invalidate(["workflow:", "projects:", "project:"]);
      return res;
    },
    updateWorkflowData: async (body: any) => {
      const res = await apiPost("/project-workflows", { action: "updateWorkflowData", ...body });
      await invalidate(["workflow:"]);
      return res;
    },
    generateTrackingTasks: async (body: any) => {
      const res = await apiPost("/project-workflows", { action: "generateTrackingTasks", ...body });
      await invalidate(["tasks", "tasksByProject"]);
      return res;
    },
  }), [invalidate]);
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
  return useMemo(() => ({
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
  }), [invalidate]);
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
  return useMemo(() => ({
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
  }), [invalidate]);
}

// ─── Sync logs ─────────────────────────────────────────────
export function useLogs(projectId?: string | null, limit?: number, opts?: { refreshInterval?: number, userId?: string | null }) {
  const resolvedProjectId = projectId ?? undefined;
  // Khi không có projectId → bắt buộc truyền userId để không lẫn log mọi user
  const resolvedUserId = opts?.userId ?? undefined;
  const key = `logs:${resolvedProjectId ?? resolvedUserId ?? "all"}:${limit ?? ""}`;
  return useData<any[]>(
    key,
    () => apiGet("/logs", { action: "getLogs", projectId: resolvedProjectId, userId: resolvedUserId, limit }),
    { refreshInterval: opts?.refreshInterval ?? 0 }
  );
}

export function useRecentLogs(userId?: string | null, type?: string, limit?: number) {
  const key = userId ? `logs:recent:${userId}:${type ?? ""}:${limit ?? ""}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/logs", { action: "getRecentLogs", type, userId, limit }) : null,
    { refreshInterval: 10000 }
  );
}

export function useLogMutations() {
  const invalidate = useInvalidate();
  return useMemo(() => ({
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
  }), [invalidate]);
}

// ─── Paginated logs (thay usePaginatedQuery) ───────────────
export function usePaginatedLogs(userId?: string | null, limit = 20) {
  const [logs, setLogs] = useState<any[] | undefined>(undefined);
  const [status, setStatus] = useState<"LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted">("LoadingFirstPage");
  const cursorRef = useRef<number | null>(null);

  const fetchFirst = useCallback(async () => {
    setStatus("LoadingFirstPage");
    try {
      const res = await apiGet("/logs", { action: "getLogsPaginated", cursor: null, userId, limit });
      setLogs(res.results ?? []);
      cursorRef.current = res.nextCursor;
      setStatus(res.hasMore ? "CanLoadMore" : "Exhausted");
    } catch (err) {
      console.error("[logs] failed to load first page:", err);
      setStatus("Exhausted");
    }
  }, [limit, userId]);

  const loadMore = useCallback(async (count = 20) => {
    if (status === "LoadingMore") return;
    setStatus("LoadingMore");
    try {
      const res = await apiGet("/logs", { action: "getLogsPaginated", cursor: cursorRef.current, userId, limit: count });
      setLogs((prev) => [...(prev ?? []), ...(res.results ?? [])]);
      cursorRef.current = res.nextCursor;
      setStatus(res.hasMore ? "CanLoadMore" : "Exhausted");
    } catch (err) {
      console.error("[logs] failed to load more:", err);
      setStatus("CanLoadMore");
    }
  }, [status, userId]);

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
  return useMemo(() => ({
    updateUserPreferences: async (body: any) => {
      const res = await apiPost("/preferences", { ...body });
      await invalidate(["prefs:"]);
      return res;
    },
  }), [invalidate]);
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
  return useMemo(() => ({
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
  }), [invalidate]);
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
  const inv = useCallback(async () => invalidate(["pmsessions", "pmgeneral", "pmsession", "pmmessages", "projects:", "tasks", "notes"]), [invalidate]);
  return useMemo(() => ({
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
  }), [inv]);
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
  return useMemo(() => ({
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
  }), [invalidate]);
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
  return useMemo(() => ({
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
  }), [invalidate]);
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
  return useMemo(() => ({
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
  }), [invalidate]);
}

// ─── Files / upload ────────────────────────────────────────
export function useUploadFile() {
  return useCallback(async (dataUrl: string, userId: string, name?: string, mimeType?: string) => {
    const res = await apiPost<any>("/files", { userId, dataUrl, name, mimeType });
    return res.url as string;
  }, []);
}

// ─── Task Templates (task list mẫu — render task list theo template) ────────
export function useTaskTemplates(userId?: string | null, includeInactive = false) {
  const key = userId ? `task-templates:${userId}:${includeInactive ? "all" : "active"}` : null;
  return useData<any[]>(
    key,
    key
      ? () =>
          apiGet("/task-templates", {
            action: "getTaskTemplates",
            userId,
            includeInactive: includeInactive ? "true" : "false",
          })
      : null
  );
}

export function useTaskTemplateMutations() {
  const invalidate = useInvalidate();
  return useMemo(() => ({
    createTaskTemplate: async (body: any) => {
      const res = await apiPost("/task-templates", { action: "createTaskTemplate", ...body });
      await invalidate(["task-templates"]);
      return res;
    },
    updateTaskTemplate: async (body: any) => {
      const res = await apiPost("/task-templates", { action: "updateTaskTemplate", ...body });
      await invalidate(["task-templates"]);
      return res;
    },
    deleteTaskTemplate: async (body: any) => {
      const res = await apiPost("/task-templates", { action: "deleteTaskTemplate", ...body });
      await invalidate(["task-templates"]);
      return res;
    },
  }), [invalidate]);
}

// ─── Project Summaries (bản tóm tắt dự án theo version) ─────────
export function useProjectSummaries(projectId?: string | null, limit = 20) {
  const key = projectId ? `summaries:project:${projectId}` : null;
  return useData<any[]>(
    key,
    key ? () => apiGet("/project-summaries", { action: "getSummariesByProject", projectId, limit }) : null
  );
}

export function useProjectSummaryMutations() {
  const invalidate = useInvalidate();
  return useMemo(() => ({
    // Sinh + lưu version tóm tắt (LLM gate qua route agents; manual trigger từ UI)
    generateSummary: async (body: { projectId: string; userId: string; trigger?: string }) => {
      const res = await apiPost("/agents/generate-project-summary", {
        action: "generate",
        projectId: body.projectId,
        userId: body.userId,
        trigger: body.trigger === "manual" ? "manual" : "auto",
      });
      await invalidate(["summaries:", "logs:"]);
      return res;
    },
    deleteSummary: async (body: { id: string }) => {
      const res = await apiPost("/project-summaries", { action: "deleteSummary", ...body });
      await invalidate(["summaries:"]);
      return res;
    },
  }), [invalidate]);
}