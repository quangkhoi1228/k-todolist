"use client";

import { useState, useEffect, useRef } from "react";
import { format, startOfDay, isToday, isYesterday, isTomorrow, addDays, startOfMonth, endOfMonth, isSameDay } from "date-fns";
import { vi } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarIcon, Clock, X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DatePickerPopoverProps {
  /** Current timestamp (ms) for the date value */
  date: number | null | undefined;
  /** Callback when date changes (receives timestamp or null) */
  onDateChange: (timestamp: number | null) => void;
  /** Whether to include time picker */
  showTime?: boolean;
  /** Placeholder text when no date is selected */
  placeholder?: string;
  /** Label for the date field */
  label?: string;
  /** For endDate: when start date changes, auto-adjust if needed */
  minDate?: Date;
  /** If true, show "no date" quick action */
  allowClear?: boolean;
  /** Quick date buttons (e.g. "Hôm nay", "Ngày mai") */
  quickDates?: { label: string; getDate: () => Date }[];
  /** Default time (HH:mm) to use when day is picked but no time set */
  defaultTime?: string;
  /** Side of the popover */
  side?: "top" | "bottom" | "left" | "right";
  /** Align */
  align?: "start" | "center" | "end";
  /** Trigger class name */
  triggerClassName?: string;
  /** Custom trigger content (if not provided, renders a default date badge) */
  children?: React.ReactNode;
  /** Whether the picker is open */
  open?: boolean;
  /** Open state change handler */
  onOpenChange?: (open: boolean) => void;
  /** Additional class name for the popover content */
  className?: string;
}

export function DatePickerPopover({
  date,
  onDateChange,
  showTime = false,
  placeholder = "Chọn ngày",
  label,
  minDate,
  allowClear = true,
  quickDates,
  defaultTime = "17:30",
  side = "bottom",
  align = "start",
  triggerClassName,
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  className,
}: DatePickerPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

  // Calendar selected date (day only)
  const selectedDate = date ? new Date(date) : undefined;

  // Time string state (HH:mm)
  const currentTime = date
    ? format(new Date(date), "HH:mm")
    : defaultTime;
  const [timeStr, setTimeStr] = useState(currentTime);

  // Reset time when date changes externally
  useEffect(() => {
    setTimeStr(date ? format(new Date(date), "HH:mm") : defaultTime);
  }, [date, defaultTime]);

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) {
      onDateChange(null);
      return;
    }
    if (showTime) {
      const [h, m] = timeStr.split(":").map(Number);
      const newDate = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        h || 17,
        m || 30,
        0,
        0
      );
      onDateChange(newDate.getTime());
    } else {
      onDateChange(startOfDay(day).getTime());
    }
  };

  const handleTimeChange = (newTime: string) => {
    setTimeStr(newTime);
    if (date) {
      const [h, m] = newTime.split(":").map(Number);
      const existing = new Date(date);
      const newDate = new Date(
        existing.getFullYear(),
        existing.getMonth(),
        existing.getDate(),
        h || 0,
        m || 0,
        0,
        0
      );
      onDateChange(newDate.getTime());
    }
  };

  const handleQuickDate = (getDate: () => Date) => {
    const day = getDate();
    handleDaySelect(day);
    setOpen(false);
  };

  const handleClear = () => {
    onDateChange(null);
    setOpen(false);
  };

  const handleToday = () => handleQuickDate(() => new Date());
  const handleTomorrow = () => handleQuickDate(() => addDays(new Date(), 1));

  // Detect popover side based on available space
  const effectiveSide = side;

  const dayStr = date ? format(new Date(date), "yyyy-MM-dd") : null;
  const displayDate = date ? new Date(date) : null;

  // Build quick date suggestions
  const quickDateButtons = quickDates || [
    { label: "Hôm nay", getDate: () => new Date() },
    { label: "Ngày mai", getDate: () => addDays(new Date(), 1) },
  ];

  const isCurrentToday = selectedDate && isToday(selectedDate);
  const isCurrentYesterday = selectedDate && isYesterday(selectedDate);
  const isCurrentTomorrow = selectedDate && isTomorrow(selectedDate);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(
          "cursor-pointer",
          triggerClassName
        )}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children || (
          <div
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all",
              date
                ? isCurrentToday
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : isCurrentYesterday
                    ? "bg-destructive/10 border-destructive/30 text-destructive"
                    : "bg-muted/40 border-border/60 text-foreground hover:bg-muted"
                : "bg-muted/20 border-dashed border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted/40"
            )}
          >
            <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
            {displayDate ? (
              <span className="whitespace-nowrap">
                {isCurrentToday
                  ? "Hôm nay"
                  : isCurrentYesterday
                    ? "Hôm qua"
                    : isCurrentTomorrow
                      ? "Ngày mai"
                      : format(displayDate, "dd/MM/yyyy")}
                {showTime && ` ${format(displayDate, "HH:mm")}`}
              </span>
            ) : (
              <span className="italic whitespace-nowrap">{placeholder}</span>
            )}
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={effectiveSide}
        align={align}
        sideOffset={6}
        className={cn(
          "w-auto min-w-[280px] p-0 bg-card border-border shadow-2xl rounded-xl overflow-hidden",
          className
        )}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="p-3 pb-0">
          {label && (
            <div className="text-xs font-bold text-foreground mb-2">{label}</div>
          )}

          {/* Quick date buttons */}
          <div className="flex gap-1.5 mb-3">
            {quickDateButtons.map((qd) => {
              const qdDate = qd.getDate();
              const isActive = dayStr === format(qdDate, "yyyy-MM-dd");
              return (
                <button
                  key={qd.label}
                  type="button"
                  onClick={() => handleQuickDate(qd.getDate)}
                  className={cn(
                    "flex-1 text-[11px] py-1.5 rounded-lg border transition-all cursor-pointer font-medium",
                    isActive
                      ? "bg-primary/15 text-primary border-primary/30 font-semibold"
                      : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  {qd.label}
                </button>
              );
            })}
            {allowClear && date && (
              <button
                type="button"
                onClick={handleClear}
                className="px-2 text-[11px] py-1.5 rounded-lg border border-border/50 bg-muted/30 text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/10 transition-all cursor-pointer font-medium"
                title="Xoá ngày"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Calendar */}
        <div className="px-1 pb-1">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDaySelect}
            locale={vi}
            captionLayout="dropdown"
            className="w-full"
            classNames={{
              day: cn(
                "group/day relative aspect-square h-full w-full rounded-md p-0 text-center select-none text-xs",
                "[&:last-child[data-selected=true]_button]:rounded-r-md",
                "[&:first-child[data-selected=true]_button]:rounded-l-md"
              ),
              month_caption: "flex h-8 w-full items-center justify-center text-sm font-bold",
            }}
          />
        </div>

        {/* Time picker (optional) */}
        {showTime && (
          <div className="px-3 pb-3">
            <div className="flex items-center gap-2 border-t border-border/50 pt-3">
              <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <Input
                type="time"
                value={timeStr}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="h-8 text-xs bg-background/50 border-border rounded-lg flex-1 cursor-pointer"
                onClick={(e) => {
                  try { (e.target as HTMLInputElement).showPicker(); } catch { /* ignore */ }
                }}
              />
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between px-3 py-2 bg-muted/10 border-t border-border/30">
          <div className="text-[10px] text-muted-foreground">
            {selectedDate ? (
              <>
                {format(selectedDate, "EEEE, dd/MM/yyyy", { locale: vi })}
                {showTime && ` • ${timeStr}`}
              </>
            ) : (
              "Chưa chọn ngày"
            )}
          </div>
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs px-3 rounded-lg font-semibold cursor-pointer"
            onClick={() => setOpen(false)}
          >
            Xong
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
