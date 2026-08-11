"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Ticket, UserCircle, Folder, Save } from "lucide-react";

interface InitFormData {
  ticketId: string;
  projectName: string;
  salesName: string;
  salesContact: string;
  salesEmail: string;
  isdEndpoint: string;
  isdToken: string;
  presaleName: string;
  presaleInfo: string;
}

interface PMAgentInitFormProps {
  onSubmit: (data: InitFormData) => Promise<void>;
  loading?: boolean;
}

export function PMAgentInitForm({ onSubmit, loading }: PMAgentInitFormProps) {
  const [form, setForm] = useState<InitFormData>({
    ticketId: "",
    projectName: "",
    salesName: "",
    salesContact: "",
    salesEmail: "",
    isdEndpoint: "",
    isdToken: "",
    presaleName: "",
    presaleInfo: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  const update = (field: keyof InitFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Required Fields */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
          <Ticket className="w-3.5 h-3.5 text-primary" />
          Thong tin ticket
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] font-semibold text-muted-foreground">
              Ticket ID <span className="text-red-400">*</span>
            </Label>
            <Input
              placeholder="VD: ISD-12345"
              value={form.ticketId}
              onChange={(e) => update("ticketId", e.target.value)}
              className="h-8 text-xs bg-background/50 border-border/60 rounded-lg"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] font-semibold text-muted-foreground">
              Ten du an <span className="text-red-400">*</span>
            </Label>
            <Input
              placeholder="VD: Triển khai FW cho KH A"
              value={form.projectName}
              onChange={(e) => update("projectName", e.target.value)}
              className="h-8 text-xs bg-background/50 border-border/60 rounded-lg"
              required
            />
          </div>
        </div>
      </div>

      {/* Sales Info */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
          <UserCircle className="w-3.5 h-3.5 text-primary" />
          Thong tin Sale
        </h3>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] font-semibold text-muted-foreground">
              Ten Sale <span className="text-red-400">*</span>
            </Label>
            <Input
              placeholder="Nguyen Van A"
              value={form.salesName}
              onChange={(e) => update("salesName", e.target.value)}
              className="h-8 text-xs bg-background/50 border-border/60 rounded-lg"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] font-semibold text-muted-foreground">
              So dien thoai
            </Label>
            <Input
              placeholder="090xxxxxxx"
              value={form.salesContact}
              onChange={(e) => update("salesContact", e.target.value)}
              className="h-8 text-xs bg-background/50 border-border/60 rounded-lg"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] font-semibold text-muted-foreground">
              Email Sale
            </Label>
            <Input
              type="email"
              placeholder="sale@fci.vn"
              value={form.salesEmail}
              onChange={(e) => update("salesEmail", e.target.value)}
              className="h-8 text-xs bg-background/50 border-border/60 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Advanced: ISD + Presale */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-[10px] text-primary hover:text-primary/80 font-medium transition-colors self-start cursor-pointer bg-transparent border-none"
      >
        {showAdvanced ? "An" : "Hien"} cau hinh nang cao
      </button>

      {showAdvanced && (
        <>
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5 text-primary" />
              Cau hinh ISD API
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  ISD Endpoint
                </Label>
                <Input
                  placeholder="https://servicedesk.fci.vn/rest/api"
                  value={form.isdEndpoint}
                  onChange={(e) => update("isdEndpoint", e.target.value)}
                  className="h-8 text-xs bg-background/50 border-border/60 rounded-lg font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  ISD Token
                </Label>
                <Input
                  type="password"
                  placeholder="Bearer token..."
                  value={form.isdToken}
                  onChange={(e) => update("isdToken", e.target.value)}
                  className="h-8 text-xs bg-background/50 border-border/60 rounded-lg font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <UserCircle className="w-3.5 h-3.5 text-primary" />
              Thong tin Presale
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  Ten Presale
                </Label>
                <Input
                  placeholder="Tran Van B"
                  value={form.presaleName}
                  onChange={(e) => update("presaleName", e.target.value)}
                  className="h-8 text-xs bg-background/50 border-border/60 rounded-lg"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[10px] font-semibold text-muted-foreground">
                  Thong tin them
                </Label>
                <Input
                  placeholder="Team, phone..."
                  value={form.presaleInfo}
                  onChange={(e) => update("presaleInfo", e.target.value)}
                  className="h-8 text-xs bg-background/50 border-border/60 rounded-lg"
                />
              </div>
            </div>
          </div>
        </>
      )}

      <Button
        type="submit"
        disabled={loading || !form.ticketId || !form.projectName || !form.salesName}
        className="h-8 text-xs rounded-lg font-semibold cursor-pointer mt-2"
      >
        {loading ? (
          <>
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            Đang xử lý...
          </>
        ) : (
          <>
            <Ticket className="w-3 h-3 mr-1.5" />
            Tiep nhan ticket
          </>
        )}
      </Button>
    </form>
  );
}
