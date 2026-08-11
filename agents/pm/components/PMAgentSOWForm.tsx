"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FileText, FolderOpen, Send, ExternalLink } from "lucide-react";
import type { SOWInfo } from "../lib/types";

interface PMAgentSOWFormProps {
  sow: SOWInfo;
  onSave: (sow: SOWInfo) => void;
  onComplete: () => void;
}

const SOW_STATUSES = [
  { value: "pending", label: "Chờ xử lý" },
  { value: "presale_drafting", label: "Presale đang soạn" },
  { value: "kt_updating", label: "KT đang cập nhật" },
  { value: "pm_reviewing", label: "PM đang review" },
  { value: "customer_review", label: "KH đang review" },
  { value: "approved", label: "KH đã duyệt" },
  { value: "rejected", label: "KH từ chối" },
];

export function PMAgentSOWForm({ sow, onSave, onComplete }: PMAgentSOWFormProps) {
  const [localSOW, setLocalSOW] = useState<SOWInfo>(sow);

  const update = (field: keyof SOWInfo, value: string) => {
    setLocalSOW((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(localSOW);
  };

  const handleSendToCustomer = () => {
    onSave({ ...localSOW, status: "customer_review" });
  };

  const handleApprove = () => {
    const updated = { ...localSOW, status: "approved" as const };
    onSave(updated);
    onComplete();
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Status Bar */}
      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/10 border border-border/30">
        <FileText className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] text-muted-foreground">Trang thai SOW:</span>
        <Select
          value={localSOW.status}
          onValueChange={(v) => update("status", v ?? "pending")}
        >
          <SelectTrigger className="h-6 text-[10px] bg-background/50 border-border/60 rounded-lg cursor-pointer w-auto min-w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card/95 backdrop-blur-xl border-border text-[10px]">
            {SOW_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-[10px] cursor-pointer">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* SOW URL */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
          <FolderOpen className="w-3 h-3" />
          Link SOW / Folder du an
        </Label>
        <Input
          placeholder="https://fci.sharepoint.com/..."
          value={localSOW.draftUrl}
          onChange={(e) => update("draftUrl", e.target.value)}
          className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg"
        />
        {localSOW.draftUrl && (
          <a
            href={localSOW.draftUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-primary hover:text-primary/80 flex items-center gap-1"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            Mo SOW
          </a>
        )}
      </div>

      {/* Shared Folder URL */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
          <FolderOpen className="w-3 h-3" />
          Shared folder (SharePoint CDC)
        </Label>
        <Input
          placeholder="https://fci.sharepoint.com/sites/..."
          value={localSOW.sharedFolderUrl || ""}
          onChange={(e) => update("sharedFolderUrl", e.target.value)}
          className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg"
        />
      </div>

      {/* Review Notes */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
          <FileText className="w-3 h-3" />
          Ghi chu / Review notes
        </Label>
        <Textarea
          placeholder="VD: Presale đã cung cấp SOW draft. Cần KT cập nhật scope triển khai..."
          value={localSOW.reviewNotes}
          onChange={(e) => update("reviewNotes", e.target.value)}
          className="min-h-[60px] text-[10px] bg-background/50 border-border/60 rounded-lg"
        />
      </div>

      {/* Evidence URL */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] font-semibold text-muted-foreground">
          Evidence (KH dong y SOW)
        </Label>
        <Input
          placeholder="Link screenshot / email..."
          value={localSOW.evidenceUrl || ""}
          onChange={(e) => update("evidenceUrl", e.target.value)}
          className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/30">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleSave}
          className="h-7 text-[10px] rounded-lg cursor-pointer"
        >
          Luu tam
        </Button>
        {localSOW.draftUrl && (
          <Button
            type="button"
            size="sm"
            onClick={handleSendToCustomer}
            className="h-7 text-[10px] rounded-lg cursor-pointer"
          >
            <Send className="w-3 h-3 mr-1" />
            Gui KH review
          </Button>
        )}
        {localSOW.status === "customer_review" && (
          <Button
            type="button"
            size="sm"
            onClick={handleApprove}
            className="h-7 text-[10px] rounded-lg font-semibold cursor-pointer bg-emerald-600 hover:bg-emerald-500"
          >
            KH dong y - Hoan tat
          </Button>
        )}
      </div>
    </div>
  );
}
