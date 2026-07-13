"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startOfDay } from "date-fns";

export function NewTaskDialog({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const createTask = useMutation(api.tasks.createTask);
  const [open, setOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [estimatedTime, setEstimatedTime] = useState("1");
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [pic, setPic] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    await createTask({
      userId,
      title,
      estimatedTime: parseFloat(estimatedTime),
      startDate: startOfDay(new Date(startDate)).getTime(),
      endDate: startOfDay(new Date(startDate)).getTime(),
      status: "todo",
      pic: pic || undefined,
    });

    setOpen(false);
    setTitle("");
    setEstimatedTime("1");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="sm:max-w-[425px] bg-neutral-900 text-white border-neutral-800">
        <DialogHeader>
          <DialogTitle>Add New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="title">Task Title</Label>
            <Input 
              id="title" 
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
              className="bg-neutral-800 border-neutral-700 text-white"
              required 
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="estimatedTime">Est. Time (Hours)</Label>
              <Input 
                id="estimatedTime" 
                type="number" 
                min="0.5" 
                step="0.5" 
                value={estimatedTime} 
                onChange={(e) => setEstimatedTime(e.target.value)} 
                className="bg-neutral-800 border-neutral-700 text-white"
                required 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate">Date</Label>
              <Input 
                id="startDate" 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)} 
                className="bg-neutral-800 border-neutral-700 text-white block w-full"
                required 
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pic">Person In Charge (Optional)</Label>
            <Input 
              id="pic" 
              value={pic} 
              onChange={(e) => setPic(e.target.value)} 
              className="bg-neutral-800 border-neutral-700 text-white"
            />
          </div>
          <Button type="submit" className="w-full">Create Task</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
