"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";
import { usePmSessions, usePmSessionById, usePmMessages, usePmMutations } from "../../../src/hooks/useDomain";
import type { ChatMessage, WorkflowData, PMWorkflowStep, SalesInfo, PersonnelInfo, KickoffMeeting, SOWInfo } from "../lib/types";

export function usePMAgent(sessionId?: string) {
  const { userId } = useAuth();

  const { data: sessions } = usePmSessions(userId);
  const { data: session } = usePmSessionById(sessionId ?? null);
  const { data: messages } = usePmMessages(sessionId ?? null);

  const pmx = usePmMutations();
  const createSession = pmx.createSession;
  const updateSession = pmx.updateSession;
  const addMessage = pmx.addMessage;
  const advanceStep = pmx.advanceStep;
  const deleteSession = pmx.deleteSession;

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
      await updateSession(sessionId, { workflowData: JSON.stringify(merged) });
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

    updateSession: async (id: string, body: any) => {
      if (!sessionId) return;
      await updateSession(sessionId, body);
    },
    addMessage: async (role: string, content: string, metadata?: string) => {
      if (!sessionId) return;
      await addMessage({ sessionId, role, content, metadata });
    },

    advanceStep: async (step: string) => {
      if (!sessionId) return;
      await advanceStep(sessionId, step);
    },

    updateWorkflowData,
    deleteSession: async () => {
      if (!sessionId) return;
      await deleteSession(sessionId);
    },
  };
}
