"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ChatMessage, WorkflowData, PMWorkflowStep, SalesInfo, PersonnelInfo, KickoffMeeting, SOWInfo } from "../lib/types";

export function usePMAgent(sessionId?: Id<"pmAgentSessions">) {
  const { userId } = useAuth();

  const sessions = useQuery(api.agents_pm.getSessions, userId ? { userId } : "skip");
  const session = useQuery(api.agents_pm.getSession, sessionId ? { id: sessionId } : "skip");
  const messages = useQuery(api.agents_pm.getMessages, sessionId ? { sessionId } : "skip");

  const createSession = useMutation(api.agents_pm.createSession);
  const updateSession = useMutation(api.agents_pm.updateSession);
  const addMessage = useMutation(api.agents_pm.addMessage);
  const advanceStep = useMutation(api.agents_pm.advanceStep);
  const deleteSession = useMutation(api.agents_pm.deleteSession);

  const getWorkflowData = useCallback((): WorkflowData | null => {
    if (!session?.workflowData) return null;
    try {
      return JSON.parse(session.workflowData);
    } catch {
      return null;
    }
  }, [session?.workflowData]);

  const updateWorkflowData = useCallback(
    async (data: Partial<WorkflowData>) => {
      if (!sessionId) return;
      const current = getWorkflowData() || {
        personnel: [] as PersonnelInfo[],
        meeting: null as KickoffMeeting | null,
        sow: { status: "pending", draftUrl: "", reviewNotes: "" } as SOWInfo,
        notes: "",
      };
      const merged = { ...current, ...data };
      await updateSession({ id: sessionId, workflowData: JSON.stringify(merged) });
    },
    [sessionId, updateSession, getWorkflowData]
  );

  const getSalesInfo = useCallback((): SalesInfo | null => {
    if (!session?.salesInfo) return null;
    try {
      return JSON.parse(session.salesInfo);
    } catch {
      return null;
    }
  }, [session?.salesInfo]);

  return {
    // Data
    sessions,
    session,
    messages: (messages ?? []) as ChatMessage[],
    userId: userId ?? "",

    // Helpers
    getWorkflowData,
    getSalesInfo,

    // Mutations
    createSession: async (args: {
      ticketId: string;
      projectName: string;
      salesInfo: string;
      isdConfig?: string;
      presaleInfo?: string;
    }) => {
      if (!userId) throw new Error("Not authenticated");
      return await createSession({ userId, ...args });
    },

    updateSession,
    addMessage: async (role: string, content: string, metadata?: string) => {
      if (!sessionId) return;
      await addMessage({ sessionId, role, content, metadata });
    },

    advanceStep: async (step: string) => {
      if (!sessionId) return;
      await advanceStep({ id: sessionId, step });
    },

    updateWorkflowData,
    deleteSession: async () => {
      if (!sessionId) return;
      await deleteSession({ id: sessionId });
    },
  };
}
