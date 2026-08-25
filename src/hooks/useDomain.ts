"use client";

import { useData, apiGet, apiPost, useInvalidate } from "./useData";
import { useCallback, useMemo } from "react";

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

// ─── Files / upload ────────────────────────────────────────
export function useUploadFile() {
  return useCallback(async (dataUrl: string, userId: string, name?: string, mimeType?: string) => {
    const res = await apiPost<any>("/files", { userId, dataUrl, name, mimeType });
    return res.url as string;
  }, []);
}

// ─── Members (dùng cho import task — gán PIC/Support) ─────
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
    addOrUpdateMember: async (body: any) => {
      const res = await apiPost("/members", { action: "addOrUpdateMember", ...body });
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

// ─── Task Templates (task list mẫu — DÙNG CHUNG cho mọi user) ─────────
export function useTaskTemplates(_userId?: string | null, includeInactive = false) {
  const key = `task-templates:${includeInactive ? "all" : "active"}`;
  return useData<any[]>(
    key,
    () =>
      apiGet("/task-templates", {
        action: "getTaskTemplates",
        includeInactive: includeInactive ? "true" : "false",
      })
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

// ─── Task Modules (module task dùng chung — template tham chiếu) ─────────
export function useTaskModules(_userId?: string | null) {
  const key = `task-modules`;
  return useData<any[]>(
    key,
    () => apiGet("/task-modules", { action: "getTaskModules" })
  );
}

export function useTaskModuleMutations() {
  const invalidate = useInvalidate();
  return useMemo(() => ({
    createTaskModule: async (body: any) => {
      const res = await apiPost("/task-modules", { action: "createTaskModule", ...body });
      await invalidate(["task-modules"]);
      return res;
    },
    updateTaskModule: async (body: any) => {
      const res = await apiPost("/task-modules", { action: "updateTaskModule", ...body });
      await invalidate(["task-modules"]);
      return res;
    },
    deleteTaskModule: async (body: any) => {
      const res = await apiPost("/task-modules", { action: "deleteTaskModule", ...body });
      await invalidate(["task-modules"]);
      return res;
    },
  }), [invalidate]);
}
