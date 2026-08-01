"use client";

import { usePMAgent } from "../../../../agents/pm/hooks/usePMAgent";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Bot, ChevronRight, Clock, MessageSquare, Plus } from "lucide-react";
import { format } from "date-fns";

export default function PMAgentPage() {
  const { sessions } = usePMAgent();

  const sortedSessions = (sessions ?? []).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="p-3 h-full min-h-0 flex flex-col gap-3">
      {/* Header */}
      <div className="glass p-3 rounded-xl border border-border/60 shadow-md shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            <div>
              <h1 className="text-sm font-bold text-foreground">PM Agent</h1>
              <p className="text-[9px] text-muted-foreground/60">Tro ly quan ly du an thong minh</p>
            </div>
          </div>
          <Link href="/pm-agent/chat">
            <Button size="sm" className="h-7 text-[10px] rounded-lg cursor-pointer">
              <Plus className="w-3 h-3 mr-1" />
              Phien moi
            </Button>
          </Link>
        </div>
      </div>

      {/* Recent Sessions */}
      <div className="flex-1 min-h-0 overflow-auto">
        {sortedSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <Bot className="w-12 h-12 text-muted-foreground/20 mb-4" />
            <p className="text-xs font-bold text-foreground/80">Chao mung den voi PM Agent!</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1 mb-6 max-w-xs">
              Toi co the giup ban tiep nhan ticket ISD, tao du an moi, quan ly nhan su, 
              va theo doi tien do trien khai.
            </p>
            <div className="flex flex-col gap-2">
              <Link href="/pm-agent/chat">
                <Button size="sm" className="h-8 text-xs rounded-lg cursor-pointer">
                  <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                  Bat dau tro chuyen
                </Button>
              </Link>
              <p className="text-[9px] text-muted-foreground/40 mt-2">
                VD: &quot;Tao du an tu ticket ISD-90335&quot;
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 px-1">
              Lich su ({sortedSessions.length})
            </p>
            {sortedSessions.slice(0, 10).map((s) => (
              <Link key={s._id} href={`/pm-agent/chat?session=${s._id}`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border border-border/40 hover:border-primary/30 hover:bg-muted/10 transition-all cursor-pointer group">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-foreground truncate">{s.projectName}</p>
                    <p className="text-[9px] text-muted-foreground/60">{s.ticketId ? `#${s.ticketId}` : (s.type === "general" ? "Chat general" : "")}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                      s.status === "active" ? "bg-emerald-500/10 text-emerald-500" :
                      s.status === "completed" ? "bg-blue-500/10 text-blue-500" :
                      "bg-neutral-500/10 text-neutral-500"
                    }`}>
                      {s.status === "active" ? "Dang xu ly" : s.status === "completed" ? "Hoan tat" : "Da huy"}
                    </span>
                    <Clock className="w-3 h-3 text-muted-foreground/30" />
                    <span className="text-[9px] text-muted-foreground/50 hidden sm:inline">
                      {format(new Date(s.createdAt), "dd/MM HH:mm")}
                    </span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-primary transition-colors shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
