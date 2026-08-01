"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Calendar, Users, FileText, X, Check } from "lucide-react";
import type { PersonnelInfo, KickoffMeeting } from "../lib/types";

interface PMAgentKickoffFormProps {
  personnel: PersonnelInfo[];
  meeting: KickoffMeeting | null;
  onSavePersonnel: (list: PersonnelInfo[]) => void;
  onSaveMeeting: (meeting: KickoffMeeting) => void;
  onComplete: () => void;
}

const TEAMS = [
  { value: "CSO-MSD", label: "CSO - MSD (LongDT13)" },
  { value: "CSO-CSD-HN", label: "CSO - CSD HN (LamNV23)" },
  { value: "CSO-CSD-HCM", label: "CSO - CSD HCM (AnhNTQ12)" },
  { value: "IaaS", label: "IaaS (TanNT46)" },
  { value: "SEC-HN", label: "SEC HN (DucNQ13)" },
  { value: "SEC-HCM", label: "SEC HCM (DatMT5)" },
  { value: "CDC", label: "CDC (DatPT15, NamPD21)" },
  { value: "xPlat-K8s", label: "xPlat K8s (ThanhTV30)" },
  { value: "xPlat-DB", label: "xPlat DB (DatPB)" },
  { value: "xPlat-FMON", label: "xPlat FMON (BachTX3)" },
  { value: "xPlat-DP", label: "xPlat DP (HoaLT2)" },
  { value: "DS", label: "DS (ChienVQ2)" },
  { value: "NCP", label: "NCP (NgocKB)" },
  { value: "BSS", label: "BSS (DucPN11)" },
];

const REGIONS = [
  { value: "HN", label: "Ha Noi" },
  { value: "HCM", label: "Ho Chi Minh" },
];

export function PMAgentKickoffForm({
  personnel,
  meeting,
  onSavePersonnel,
  onSaveMeeting,
  onComplete,
}: PMAgentKickoffFormProps) {
  const [localPersonnel, setLocalPersonnel] = useState<PersonnelInfo[]>(personnel);
  const [localMeeting, setLocalMeeting] = useState<KickoffMeeting | null>(meeting);
  const [activeTab, setActiveTab] = useState<"personnel" | "meeting">("personnel");

  const [newPerson, setNewPerson] = useState<PersonnelInfo>({
    name: "", email: "", team: "", region: "HN", role: "pic",
  });

  const addPersonnel = () => {
    if (!newPerson.name.trim() || !newPerson.email.trim()) return;
    setLocalPersonnel([...localPersonnel, { ...newPerson }]);
    setNewPerson({ name: "", email: "", team: "", region: "HN", role: "pic" });
  };

  const removePersonnel = (idx: number) => {
    setLocalPersonnel(localPersonnel.filter((_, i) => i !== idx));
  };

  const saveAndNext = () => {
    onSavePersonnel(localPersonnel);
    setActiveTab("meeting");
  };

  const saveMeeting = () => {
    if (!localMeeting) return;
    onSaveMeeting(localMeeting);
    onComplete();
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/30 pb-2">
        <button
          type="button"
          onClick={() => { onSavePersonnel(localPersonnel); setActiveTab("personnel"); }}
          className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            activeTab === "personnel"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="w-3 h-3" />
          Nhan su ({localPersonnel.length})
        </button>
        <button
          type="button"
          onClick={() => { onSavePersonnel(localPersonnel); setActiveTab("meeting"); }}
          className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            activeTab === "meeting"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Calendar className="w-3 h-3" />
          Kickoff Meeting
        </button>
      </div>

      {/* Personnel Tab */}
      {activeTab === "personnel" && (
        <div className="flex flex-col gap-3">
          {/* Personnel List */}
          {localPersonnel.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold text-muted-foreground">
                Danh sach nhan su
              </Label>
              {localPersonnel.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/40 bg-muted/10 text-[10px]"
                >
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    p.role === "pic" ? "bg-blue-500" : "bg-emerald-500"
                  }`} />
                  <span className="font-semibold text-foreground min-w-[120px]">{p.name}</span>
                  <span className="text-muted-foreground">{p.email}</span>
                  <span className="text-muted-foreground/60">- {p.team}</span>
                  <span className="text-muted-foreground/60">({p.region})</span>
                  <span className={`ml-auto text-[9px] font-medium px-1.5 py-0.5 rounded ${
                    p.role === "pic"
                      ? "bg-blue-500/10 text-blue-500"
                      : "bg-emerald-500/10 text-emerald-500"
                  }`}>
                    {p.role === "pic" ? "PIC" : "Support"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePersonnel(i)}
                    className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add New Person */}
          <div className="flex flex-col gap-2 p-2.5 rounded-lg border border-dashed border-border/60 bg-muted/5">
            <Label className="text-[10px] font-semibold text-muted-foreground">
              Them nhan su
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Ho ten"
                value={newPerson.name}
                onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })}
                className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg"
              />
              <Input
                placeholder="Email"
                value={newPerson.email}
                onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })}
                className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select
                value={newPerson.team || " "}
                onValueChange={(v) => setNewPerson({ ...newPerson, team: v ?? "" })}
              >
                <SelectTrigger className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg cursor-pointer">
                  <SelectValue placeholder="Team" />
                </SelectTrigger>
                <SelectContent className="bg-card/95 backdrop-blur-xl border-border text-[10px]">
                  {TEAMS.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-[10px] cursor-pointer">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={newPerson.region}
                onValueChange={(v) => setNewPerson({ ...newPerson, region: v ?? "" })}
              >
                <SelectTrigger className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg cursor-pointer">
                  <SelectValue placeholder="Region" />
                </SelectTrigger>
                <SelectContent className="bg-card/95 backdrop-blur-xl border-border text-[10px]">
                  {REGIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value} className="text-[10px] cursor-pointer">
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={newPerson.role}
                onValueChange={(v) => setNewPerson({ ...newPerson, role: (v ?? "pic") as "pic" | "support" })}
              >
                <SelectTrigger className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg cursor-pointer">
                  <SelectValue placeholder="Vai tro" />
                </SelectTrigger>
                <SelectContent className="bg-card/95 backdrop-blur-xl border-border text-[10px]">
                  <SelectItem value="pic" className="text-[10px] cursor-pointer">PIC</SelectItem>
                  <SelectItem value="support" className="text-[10px] cursor-pointer">Support</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={addPersonnel}
              disabled={!newPerson.name || !newPerson.email}
              className="h-7 text-[10px] rounded-lg cursor-pointer self-end"
            >
              <Plus className="w-3 h-3 mr-1" />
              Them
            </Button>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={saveAndNext}
            disabled={localPersonnel.length === 0}
            className="h-7 text-[10px] rounded-lg font-semibold cursor-pointer mt-1"
          >
            Tiep theo: Tao meeting kickoff
          </Button>
        </div>
      )}

      {/* Meeting Tab */}
      {activeTab === "meeting" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 p-2.5 rounded-lg border border-border/40">
            <Label className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Thong tin meeting
            </Label>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[9px] text-muted-foreground">Ngay</Label>
                <Input
                  type="date"
                  value={localMeeting?.date?.split("T")[0] || ""}
                  onChange={(e) => setLocalMeeting({
                    date: e.target.value,
                    time: localMeeting?.time || "",
                    participants: localMeeting?.participants || [],
                    agenda: localMeeting?.agenda || "",
                    meetingUrl: localMeeting?.meetingUrl,
                  })}
                  className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[9px] text-muted-foreground">Gio</Label>
                <Input
                  type="time"
                  value={localMeeting?.time || ""}
                  onChange={(e) => setLocalMeeting({
                    date: localMeeting?.date || "",
                    time: e.target.value,
                    participants: localMeeting?.participants || [],
                    agenda: localMeeting?.agenda || "",
                    meetingUrl: localMeeting?.meetingUrl,
                  })}
                  className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-[9px] text-muted-foreground">Link meeting (Teams/Zoom)</Label>
              <Input
                placeholder="https://teams.microsoft.com/..."
                value={localMeeting?.meetingUrl || ""}
                onChange={(e) => setLocalMeeting({
                  date: localMeeting?.date || "",
                  time: localMeeting?.time || "",
                  participants: localMeeting?.participants || [],
                  agenda: localMeeting?.agenda || "",
                  meetingUrl: e.target.value,
                })}
                className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-[9px] text-muted-foreground">Noi dung / Agenda</Label>
              <Textarea
                placeholder="VD: Presale trinh bay yeu cau KH, phuong an trien khai..."
                value={localMeeting?.agenda || ""}
                onChange={(e) => setLocalMeeting({
                  date: localMeeting?.date || "",
                  time: localMeeting?.time || "",
                  participants: localMeeting?.participants || [],
                  agenda: e.target.value,
                  meetingUrl: localMeeting?.meetingUrl,
                })}
                className="min-h-[60px] text-[10px] bg-background/50 border-border/60 rounded-lg"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-[9px] text-muted-foreground">Thanh vien tham gia</Label>
              <div className="flex flex-wrap gap-1">
                {localPersonnel.map((p, i) => (
                  <label
                    key={i}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border cursor-pointer transition-colors ${
                      localMeeting?.participants?.includes(p.email)
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-muted/20 border-border/30 text-muted-foreground hover:border-border/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={localMeeting?.participants?.includes(p.email) || false}
                      onChange={(e) => {
                        const list = localMeeting?.participants || [];
                        const updated = e.target.value
                          ? [...list, p.email]
                          : list.filter((e) => e !== p.email);
                        setLocalMeeting({
                          date: localMeeting?.date || "",
                          time: localMeeting?.time || "",
                          participants: updated,
                          agenda: localMeeting?.agenda || "",
                          meetingUrl: localMeeting?.meetingUrl,
                        });
                      }}
                      className="hidden"
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("personnel")}
              className="h-7 text-[10px] rounded-lg cursor-pointer"
            >
              Quay lai
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={saveMeeting}
              disabled={!localMeeting?.date || !localMeeting?.time}
              className="h-7 text-[10px] rounded-lg font-semibold cursor-pointer"
            >
              <Check className="w-3 h-3 mr-1" />
              Hoan tat Kickoff
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
