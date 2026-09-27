"use client";

import { useState, useMemo, useEffect } from "react";
import { AcademicItem, AcademicStatus, AcademicType, ChangeRecord, CollectorStats, CollectorGroupState, CollectorScanHistory } from "@/lib/types";
import {
  formatCalendarDate,
  formatDeadlineDisplay,
  formatTimeDeterministic,
  formatDateTimeDeterministic,
  isOverdue,
  isToday,
  isUpcoming,
  toLocalDateString
} from "@/lib/dateUtils";
import { isGroupAllowed } from "@/lib/collector/allowedGroups";
import { classifyAcademicMessage } from "@/lib/collector/relevanceFilter";
import {
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  History,
  MessageSquare,
  Search,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Tag,
  Check,
  Send,
  AlertCircle,
  Radio,
  RefreshCw,
  ShieldCheck,
  Bell
} from "lucide-react";
import ReminderCenter from "./ReminderCenter";

type TabType =
  | "TODAY"
  | "UPCOMING"
  | "ASSIGNMENTS"
  | "EXAMS"
  | "PROJECTS"
  | "SUBMISSIONS"
  | "ANNOUNCEMENTS"
  | "COMPLETED"
  | "OVERDUE"
  | "REMINDERS";

const INITIAL_DEMO_ITEMS: AcademicItem[] = [
  {
    id: "demo-lab-1",
    title: "NLP Lab Practice Question",
    subject: "NLP",
    type: "LAB",
    status: "NOT_STARTED",
    deadline: "2026-09-27T11:35:00",
    submissionUrl: "https://classroom.google.com",
    resourceUrls: [],
    attachmentNames: ["Lab2_Practice_Questions.ipynb"],
    description: "Students can practice the lab2 practice question and upload the document before 11:35 am.",
    sourceGroup: "NLP Lab",
    sourceSender: "Faculty Coordinator",
    originalMessages: [
      "Students can practice the lab2 practice question and upload the document before 11:35 am. Submit here: https://classroom.google.com"
    ],
    createdAt: "2026-09-27T08:00:00.000Z",
    updatedAt: "2026-09-27T08:00:00.000Z",
    changeHistory: [],
    confidence: "HIGH"
  },
  {
    id: "demo-exam-1",
    title: "Slip Test 2",
    subject: "NLP",
    type: "SLIP_TEST",
    status: "INBOX",
    eventDate: "2026-09-30",
    eventTime: "First hour",
    resourceUrls: [],
    attachmentNames: [],
    description: "Slip test 2 will be conducted on 30-09-2026 during the first hour.",
    sourceGroup: "NLP",
    sourceSender: "Course Lead",
    originalMessages: [
      "Slip test 2 will be conducted on 30-09-2026 during the first hour."
    ],
    createdAt: "2026-09-27T08:00:00.000Z",
    updatedAt: "2026-09-27T08:00:00.000Z",
    changeHistory: [],
    confidence: "HIGH"
  },
  {
    id: "demo-announcement-1",
    title: "Collect the answer sheets",
    subject: "NEEDS_CONFIRMATION",
    type: "ANNOUNCEMENT",
    status: "INBOX",
    eventDate: "2026-09-27",
    resourceUrls: [],
    attachmentNames: [],
    description: "Today is the last date to collect the answer sheets from the staff room.",
    sourceGroup: "College Notice Board",
    originalMessages: [
      "Today is the last date to collect the answer sheets from the staff room."
    ],
    createdAt: "2026-09-27T08:00:00.000Z",
    updatedAt: "2026-09-27T08:00:00.000Z",
    changeHistory: [],
    confidence: "NEEDS_CONFIRMATION"
  }
];

const TYPE_CONFIG: Record<AcademicType, { label: string; icon: string; bg: string; color: string }> = {
  ASSIGNMENT: { label: "Assignment", icon: "📝", bg: "#eff6ff", color: "#1d4ed8" },
  EXAM: { label: "Exam", icon: "🧪", bg: "#fef2f2", color: "#b91c1c" },
  SLIP_TEST: { label: "Slip Test", icon: "⚡", bg: "#fff7ed", color: "#c2410c" },
  QUIZ: { label: "Quiz", icon: "❓", bg: "#faf5ff", color: "#7e22ce" },
  LAB: { label: "Lab", icon: "💻", bg: "#ecfdf5", color: "#047857" },
  PROJECT: { label: "Project", icon: "🚀", bg: "#f0fdfa", color: "#0f766e" },
  PRESENTATION: { label: "Presentation", icon: "🎤", bg: "#fdf4ff", color: "#a21caf" },
  COURSE: { label: "Course / Cert", icon: "🎓", bg: "#f8fafc", color: "#334155" },
  ANNOUNCEMENT: { label: "Announcement", icon: "📢", bg: "#f1f5f9", color: "#475569" },
  OTHER: { label: "Other", icon: "📌", bg: "#f1f5f9", color: "#475569" }
};

const STATUS_CONFIG: Record<AcademicStatus, { label: string; bg: string; color: string }> = {
  INBOX: { label: "Inbox", bg: "#e0f2fe", color: "#0369a1" },
  NOT_STARTED: { label: "Not Started", bg: "#f1f5f9", color: "#475569" },
  IN_PROGRESS: { label: "In Progress", bg: "#fef3c7", color: "#92400e" },
  SUBMITTED: { label: "Submitted", bg: "#e0e7ff", color: "#4338ca" },
  COMPLETED: { label: "Completed", bg: "#dcfce7", color: "#15803d" },
  POSTPONED: { label: "Postponed", bg: "#ffedd5", color: "#c2410c" },
  CANCELLED: { label: "Cancelled", bg: "#fee2e2", color: "#b91c1c" },
  MISSED: { label: "Missed", bg: "#fef2f2", color: "#991b1b" }
};

const SAMPLE_MESSAGES = [
  {
    label: "Lab Submission",
    text: "Students can practice the lab2 practice question and upload the document before 11:35 am. Submit here: https://classroom.google.com/c/nlp-lab",
    group: "NLP Lab"
  },
  {
    label: "Slip Test Announcement",
    text: "Slip test 2 will be conducted on 30-09-2026 during the first hour.",
    group: "NLP"
  },
  {
    label: "Slip Test Postponement",
    text: "Slip Test 2 is postponed to 3 October.",
    group: "NLP"
  },
  {
    label: "Ambiguous (No Deadline)",
    text: "Submit this soon.",
    group: "Class Group"
  },
  {
    label: "Answer Sheets Notice",
    text: "Today is the last date to collect the answer sheets.",
    group: "Department Notice"
  },
  {
    label: "Non-academic Chatter",
    text: "Good morning sir 🙏",
    group: "General Group"
  }
];

export default function Dashboard() {
  const [items, setItems] = useState<AcademicItem[]>(INITIAL_DEMO_ITEMS);
  const [isMounted, setIsMounted] = useState(false);

  // Client-side initialization for browser-dependent values (eliminates SSR hydration mismatch)
  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("academic_command_center_items");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setItems(parsed);
          }
        } catch {
          // fallback to initial demo
        }
      }
    }
  }, []);

  const [message, setMessage] = useState("");
  const [sourceGroup, setSourceGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "info" | "warning" | "error"; text: string } | null>(null);

  const [activeTab, setActiveTab] = useState<TabType>("TODAY");
  const [searchQuery, setSearchQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [expandedOriginal, setExpandedOriginal] = useState<Record<string, boolean>>({});

  // Reviewable Cleanup state (for removing bad data: promotional, attendance-only, disallowed groups)
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [selectedCleanupIds, setSelectedCleanupIds] = useState<string[]>([]);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  // Save to localStorage on change (only after initial client mount)
  useEffect(() => {
    if (isMounted && typeof window !== "undefined") {
      localStorage.setItem("academic_command_center_items", JSON.stringify(items));
    }
  }, [items, isMounted]);

  // Reference date: Deterministic fallback during SSR to ensure identical server-rendered HTML
  const ssrReferenceDate = useMemo(() => new Date("2026-09-27T12:00:00+05:30"), []);
  const now = useMemo(() => (isMounted ? new Date() : ssrReferenceDate), [isMounted, items]);

  // Safe deterministic formatting helpers that eliminate SSR hydration mismatches
  const formatTimeSafe = (isoStr?: string | null): string => {
    if (!isoStr) return "Never";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return formatTimeDeterministic(d);
    } catch (_) {
      return isoStr;
    }
  };

  const formatDateTimeSafe = (isoStr?: string | null): string => {
    if (!isoStr) return "Never";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return formatDateTimeDeterministic(d);
    } catch (_) {
      return isoStr;
    }
  };

  // Identify suspicious items for reviewable cleanup (Requirement 30)
  const suspiciousItems = useMemo(() => {
    return items.flatMap(item => {
      const issues: string[] = [];
      if (item.sourceGroup && !isGroupAllowed(item.sourceGroup)) {
        issues.push(`Disallowed group: ${item.sourceGroup}`);
      }
      const relevance = classifyAcademicMessage(`${item.title} ${item.description}`);
      if (!relevance.shouldProcess) {
        issues.push(relevance.reason || "Classified as non-academic");
      }
      if (issues.length > 0) {
        return [{ item, reason: issues.join("; ") }];
      }
      return [];
    });
  }, [items]);

  async function handleDeleteSuspiciousEvents(idsToDelete: string[]) {
    if (idsToDelete.length === 0) return;
    setIsCleaningUp(true);
    try {
      const res = await fetch("/api/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idsToDelete })
      });
      if (res.ok) {
        setItems(prev => prev.filter(i => !idsToDelete.includes(i.id)));
        setCleanupMessage(`Cleaned up ${idsToDelete.length} bad event(s).`);
        setSelectedCleanupIds([]);
        setTimeout(() => {
          setCleanupModalOpen(false);
          setCleanupMessage(null);
        }, 1500);
      } else {
        alert("Failed to delete events from server.");
      }
    } catch (e: any) {
      alert(`Error deleting events: ${e.message}`);
    } finally {
      setIsCleaningUp(false);
    }
  }

  // Statistics
  const stats = useMemo(() => {
    let overdueCount = 0;
    let dueTodayCount = 0;
    let upcomingExamsCount = 0;
    let pendingSubmissionsCount = 0;

    for (const item of items) {
      if (item.status === "COMPLETED" || item.status === "CANCELLED") continue;

      if (isOverdue(item.deadline || item.eventDate, item.eventTime, now)) {
        overdueCount++;
      } else if (isToday(item.deadline || item.eventDate, now)) {
        dueTodayCount++;
      }

      if ((item.type === "EXAM" || item.type === "SLIP_TEST" || item.type === "QUIZ") && !isOverdue(item.eventDate, item.eventTime, now)) {
        upcomingExamsCount++;
      }

      if (item.submissionUrl && item.status !== "SUBMITTED") {
        pendingSubmissionsCount++;
      }
    }

    return {
      overdue: overdueCount,
      dueToday: dueTodayCount,
      upcomingExams: upcomingExamsCount,
      pendingSubmissions: pendingSubmissionsCount,
      totalActive: items.filter(x => x.status !== "COMPLETED" && x.status !== "CANCELLED").length
    };
  }, [items, now]);

  // Distinct subjects for filter dropdown
  const uniqueSubjects = useMemo(() => {
    const subs = new Set<string>();
    items.forEach(i => {
      if (i.subject) subs.add(i.subject);
    });
    return Array.from(subs);
  }, [items]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<TabType, number> = {
      TODAY: 0,
      UPCOMING: 0,
      ASSIGNMENTS: 0,
      EXAMS: 0,
      PROJECTS: 0,
      SUBMISSIONS: 0,
      ANNOUNCEMENTS: 0,
      COMPLETED: 0,
      OVERDUE: 0,
      REMINDERS: 0
    };

    items.forEach(item => {
      const isItemOverdue = isOverdue(item.deadline || item.eventDate, item.eventTime, now) && item.status !== "COMPLETED" && item.status !== "CANCELLED";
      const isItemToday = isToday(item.deadline || item.eventDate, now);
      const isItemUpcoming = isUpcoming(item.deadline || item.eventDate, now) && item.status !== "COMPLETED" && item.status !== "CANCELLED";

      if (isItemOverdue) counts.OVERDUE++;
      if ((isItemToday || isItemOverdue) && item.status !== "COMPLETED" && item.status !== "CANCELLED") counts.TODAY++;
      if (isItemUpcoming) counts.UPCOMING++;
      if (item.type === "ASSIGNMENT" || item.type === "LAB") counts.ASSIGNMENTS++;
      if (item.type === "EXAM" || item.type === "SLIP_TEST" || item.type === "QUIZ") counts.EXAMS++;
      if (item.type === "PROJECT") counts.PROJECTS++;
      if (item.submissionUrl) counts.SUBMISSIONS++;
      if (item.type === "ANNOUNCEMENT" || item.type === "OTHER") counts.ANNOUNCEMENTS++;
      if (item.status === "COMPLETED" || item.status === "SUBMITTED") counts.COMPLETED++;
    });

    return counts;
  }, [items, now]);

  // Filtered items based on activeTab and search/filters
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // 1. Tab criteria
      const isItemOverdue = isOverdue(item.deadline || item.eventDate, item.eventTime, now) && item.status !== "COMPLETED" && item.status !== "CANCELLED";
      const isItemToday = isToday(item.deadline || item.eventDate, now);
      const isItemUpcoming = isUpcoming(item.deadline || item.eventDate, now) && item.status !== "COMPLETED" && item.status !== "CANCELLED";

      switch (activeTab) {
        case "TODAY":
          if (!isItemToday && !isItemOverdue) return false;
          if (item.status === "COMPLETED" || item.status === "CANCELLED") return false;
          break;
        case "UPCOMING":
          if (!isItemUpcoming) return false;
          break;
        case "ASSIGNMENTS":
          if (item.type !== "ASSIGNMENT" && item.type !== "LAB") return false;
          break;
        case "EXAMS":
          if (item.type !== "EXAM" && item.type !== "SLIP_TEST" && item.type !== "QUIZ") return false;
          break;
        case "PROJECTS":
          if (item.type !== "PROJECT") return false;
          break;
        case "SUBMISSIONS":
          if (!item.submissionUrl) return false;
          break;
        case "ANNOUNCEMENTS":
          if (item.type !== "ANNOUNCEMENT" && item.type !== "OTHER") return false;
          break;
        case "COMPLETED":
          if (item.status !== "COMPLETED" && item.status !== "SUBMITTED") return false;
          break;
        case "OVERDUE":
          if (!isItemOverdue) return false;
          break;
      }

      // 2. Subject filter
      if (subjectFilter !== "ALL" && item.subject !== subjectFilter) {
        return false;
      }

      // 3. Type filter
      if (typeFilter !== "ALL" && item.type !== typeFilter) {
        return false;
      }

      // 4. Status filter
      if (statusFilter !== "ALL" && item.status !== statusFilter) {
        return false;
      }

      // 5. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = item.title.toLowerCase().includes(q);
        const inSubject = item.subject.toLowerCase().includes(q);
        const inDesc = item.description.toLowerCase().includes(q);
        const inGroup = item.sourceGroup?.toLowerCase().includes(q) ?? false;
        if (!inTitle && !inSubject && !inDesc && !inGroup) return false;
      }

      return true;
    });
  }, [items, activeTab, subjectFilter, typeFilter, statusFilter, searchQuery, now]);

  interface InspectionData {
    originalMessage: string;
    sourceGroup?: string;
    providerUsed: string;
    fallbackOccurred: boolean;
    aiExtraction: any;
    validation: {
      valid: boolean;
      confidenceScore: number | null;
      confidenceLevel: string;
      needsConfirmation: boolean;
      confirmationReason: string | null;
    };
    engineResult: {
      action: string;
      item?: AcademicItem;
      updatedItemId?: string;
      changeSummary?: string;
      reason?: string;
      confidence?: string;
    };
    beforeAfter?: {
      before: Partial<AcademicItem>;
      after: Partial<AcademicItem>;
    };
  }

  const [inspection, setInspection] = useState<InspectionData | null>(null);

  // Message parsing submission
  async function handleCaptureMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!message.trim() || busy) return;

    setBusy(true);
    setNotice(null);

    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          existingItems: items,
          sourceGroup: sourceGroup.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse message");

      // Save complete inspection data for the AI Inspector UI
      setInspection({
        originalMessage: message.trim(),
        sourceGroup: sourceGroup.trim() || undefined,
        providerUsed: data.providerUsed ?? "deterministic-fallback",
        fallbackOccurred: Boolean(data.fallbackOccurred),
        aiExtraction: data.aiExtraction,
        validation: data.validation,
        engineResult: data.result,
        beforeAfter: data.beforeAfter ?? undefined
      });

      const action = data.result?.action;
      if (action === "NON_ACADEMIC") {
        setNotice({
          type: "warning",
          text: `Filtered: "${message.slice(0, 50)}..." was flagged as casual greeting or non-academic chatter.`
        });
      } else if (action === "IGNORED_DUPLICATE") {
        setNotice({
          type: "info",
          text: `Duplicate detected: Message is already recorded for "${data.result?.item?.title || "existing item"}".`
        });
      } else if (action === "UPDATED" && data.result?.item) {
        setItems(prev => prev.map(it => it.id === data.result.item.id ? data.result.item : it));
        setNotice({
          type: "success",
          text: `Event Updated: ${data.result.changeSummary || "Changes recorded in event history."}`
        });
        setMessage("");
      } else if (action === "CREATED" && data.result?.item) {
        setItems(prev => [data.result.item, ...prev]);
        setNotice({
          type: "success",
          text: `New item created: "${data.result.item.title}" (${data.result.item.type}).`
        });
        setMessage("");
      }
    } catch (err) {
      setNotice({
        type: "error",
        text: err instanceof Error ? err.message : "An unexpected error occurred while parsing."
      });
    } finally {
      setBusy(false);
    }
  }

  // Load events from Supabase server on mount
  useEffect(() => {
    async function loadServerEvents() {
      try {
        const res = await fetch("/api/events");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.events) && data.events.length > 0) {
            setItems(data.events);
          }
        }
      } catch (err) {
        console.warn("Could not fetch events from /api/events:", err);
      }
    }
    loadServerEvents();
    loadCollectorStats();

    const interval = setInterval(loadCollectorStats, 10000);
    return () => clearInterval(interval);
  }, []);

  interface FullCollectorStatus {
    status: string;
    stats: CollectorStats;
    whatsappStatus: "CONNECTED" | "UNAVAILABLE";
    lastHeartbeatAt: string | null;
    lastScan: {
      id: string;
      startedAt: string;
      completedAt: string | null;
      status: string;
      durationSeconds: number | null;
    } | null;
    nextScan: string;
    groupsDiscovered: number;
    groupsCompleted: number;
    groupsFailed: number;
    messagesScanned: number;
    messagesProcessed: number;
    messagesIgnored: number;
    eventsCreated: number;
    eventsUpdated: number;
    scanStatus?: "IDLE" | "SCANNING" | "COMPLETE" | "ERROR";
    scanStartedAt?: string | null;
    scanCompletedAt?: string | null;
    academicMessages?: number;
    duplicates?: number;
    errors?: number;
    lastProcessedTimestamp?: string | null;
    groups: CollectorGroupState[];
    recentScans: CollectorScanHistory[];
  }

  const [collectorData, setCollectorData] = useState<FullCollectorStatus | null>(null);
  const [collectorStats, setCollectorStats] = useState<CollectorStats | null>(null);
  const [collectorPanelOpen, setCollectorPanelOpen] = useState(true);

  async function loadCollectorStats() {
    try {
      const res = await fetch("/api/collector/status");
      if (res.ok) {
        const data = await res.json();
        setCollectorData(data);
        if (data?.stats) {
          setCollectorStats(data.stats);
        }
      }
    } catch (err) {
      console.warn("Could not load collector stats:", err);
    }
  }

  // Database Data Cleanup handlers
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<any>(null);

  async function handlePreviewCleanup() {
    setCleanupLoading(true);
    try {
      const res = await fetch("/api/events/cleanup");
      const data = await res.json();
      if (data.success) {
        setCleanupPreview(data.preview);
      }
    } catch (err) {
      console.error("Cleanup preview failed:", err);
    } finally {
      setCleanupLoading(false);
    }
  }

  async function handleExecuteCleanup() {
    if (!confirm("Are you sure you want to permanently delete identified invalid events (e.g. promotional spam or events from unallowed groups)? Legitimate academic events will NEVER be deleted.")) return;
    setCleanupLoading(true);
    try {
      const res = await fetch("/api/events/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false })
      });
      const data = await res.json();
      if (data.success) {
        setNotice({
          type: "success",
          text: `Cleaned up ${data.result.deletedCount} invalid events successfully.`
        });
        setCleanupPreview(null);
        // Refresh server events
        fetch("/api/events")
          .then(r => r.json())
          .then(d => {
            if (d.items) setItems(d.items);
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("Cleanup execution failed:", err);
    } finally {
      setCleanupLoading(false);
    }
  }

  // Toggle item complete status with Supabase + Notion persistence
  async function toggleComplete(id: string) {
    const item = items.find(it => it.id === id);
    if (!item) return;
    const isComp = item.status === "COMPLETED";
    const newStatus: AcademicStatus = isComp ? "IN_PROGRESS" : "COMPLETED";
    const updatedTime = new Date().toISOString();
    const changeRecord: ChangeRecord = {
      id: crypto.randomUUID(),
      eventId: id,
      timestamp: updatedTime,
      field: "status",
      oldValue: item.status,
      newValue: newStatus,
      summary: isComp ? "Reopened item" : "Marked as completed"
    };

    setItems(prev =>
      prev.map(it => it.id === id ? {
        ...it,
        status: newStatus,
        updatedAt: updatedTime,
        changeHistory: [...(it.changeHistory || []), changeRecord]
      } : it)
    );

    try {
      await fetch(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          changes: [changeRecord]
        })
      });
    } catch (err) {
      console.warn("Could not persist status change to server:", err);
    }
  }

  // Quick subject confirmation setter with server persistence
  async function updateItemSubject(id: string, newSubject: string) {
    if (!newSubject.trim()) return;
    const item = items.find(it => it.id === id);
    if (!item) return;

    const updatedTime = new Date().toISOString();
    const changeRecord: ChangeRecord = {
      id: crypto.randomUUID(),
      eventId: id,
      timestamp: updatedTime,
      field: "subject",
      oldValue: item.subject,
      newValue: newSubject.trim(),
      summary: `Subject set to ${newSubject.trim()}`
    };

    setItems(prev =>
      prev.map(it => it.id === id ? {
        ...it,
        subject: newSubject.trim(),
        updatedAt: updatedTime,
        confidence: "HIGH",
        needsConfirmation: false,
        changeHistory: [...(it.changeHistory || []), changeRecord]
      } : it)
    );

    try {
      await fetch(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: newSubject.trim(),
          needsConfirmation: false,
          changes: [changeRecord]
        })
      });
    } catch (err) {
      console.warn("Could not persist subject update to server:", err);
    }
  }

  return (
    <div style={{ minHeight: "100vh", padding: "28px 20px 80px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Top Header */}
      <header style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#64748b", textTransform: "uppercase" }}>
                College Intelligence Hub
              </span>
              <span style={{ fontSize: 11, background: "#dcfce7", color: "#15803d", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                Phase 4A: WhatsApp Collector Active
              </span>
            </div>
            <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 6px", color: "#0f172a", letterSpacing: "-0.02em" }}>
              Academic Command Center
            </h1>
            <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
              WhatsApp messages → Gemini AI → Supabase (Source of Truth) → Notion sync.
            </p>
          </div>

          {/* Quick Metrics */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <StatCard label="Due Today" value={stats.dueToday} alert={stats.dueToday > 0} icon={<Clock size={16} />} />
            <StatCard label="Overdue" value={stats.overdue} alert={stats.overdue > 0} icon={<AlertTriangle size={16} />} />
            <StatCard label="Upcoming Exams" value={stats.upcomingExams} icon={<Calendar size={16} />} />
            <StatCard label="Submissions" value={stats.pendingSubmissions} icon={<ExternalLink size={16} />} />
          </div>
        </div>
      </header>

      {/* Collector Status Panel (Phase 4A/4B) */}
      <section
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          padding: "18px 20px",
          marginBottom: 20,
          boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: collectorPanelOpen ? 16 : 0, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: collectorData?.whatsappStatus === "CONNECTED" ? "#22c55e" : "#f59e0b",
                boxShadow: collectorData?.whatsappStatus === "CONNECTED" ? "0 0 8px #22c55e" : "0 0 8px #f59e0b"
              }}
            />
            <Radio size={16} color="#0f766e" />
            <span style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>WhatsApp Web Collector</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 12,
                background: collectorData?.whatsappStatus === "CONNECTED" ? "#dcfce7" : "#fef3c7",
                color: collectorData?.whatsappStatus === "CONNECTED" ? "#15803d" : "#b45309"
              }}
            >
              {collectorData?.whatsappStatus === "CONNECTED" ? "CONNECTED" : "UNAVAILABLE"}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 12,
                background: "#f1f5f9",
                color: "#475569"
              }}
            >
              2-Hour Scan Cycle
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={loadCollectorStats}
              title="Refresh collector metrics"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "4px 8px",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "#64748b"
              }}
            >
              <RefreshCw size={13} />
              <span>Refresh</span>
            </button>
            <button
              onClick={() => setCollectorPanelOpen(!collectorPanelOpen)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#64748b"
              }}
            >
              {collectorPanelOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>

        {collectorPanelOpen && (
          <div style={{ display: "grid", gap: 14 }}>
            {/* Top Metrics Row: Schedule & Aggregates */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>WhatsApp Web</div>
                <div style={{
                  fontSize: 14,
                  fontWeight: 800,
                  marginTop: 4,
                  color: collectorData?.whatsappStatus === "CONNECTED" ? "#16a34a" : "#d97706"
                }}>
                  {collectorData?.whatsappStatus === "CONNECTED" ? "● Connected" : "○ Unavailable"}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>Keep Web Tab Open</div>
              </div>

              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Last Scan</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                  {collectorData?.lastScan?.startedAt
                    ? formatTimeSafe(collectorData.lastScan.startedAt)
                    : "No scans yet"}
                </div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                  {collectorData?.lastScan?.durationSeconds !== null && collectorData?.lastScan?.durationSeconds !== undefined
                    ? `Duration: ${collectorData.lastScan.durationSeconds}s`
                    : "Idle"}
                </div>
              </div>

              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Next Scheduled Scan</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#2563eb", marginTop: 4 }}>
                  {collectorData?.nextScan
                    ? formatTimeSafe(collectorData.nextScan)
                    : "Every 2 Hours"}
                </div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>2-hour recurring</div>
              </div>

              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Groups (Disc / Done)</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                  {collectorData?.groupsDiscovered ?? 0}
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#16a34a", marginLeft: 4 }}>
                    ({collectorData?.groupsCompleted ?? 0} backfilled)
                  </span>
                </div>
                {Boolean(collectorData?.groupsFailed) && (
                  <div style={{ fontSize: 10, color: "#dc2626", marginTop: 2 }}>
                    {collectorData?.groupsFailed} failed
                  </div>
                )}
              </div>

              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Messages (Scan / Proc)</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                  {collectorData?.messagesScanned ?? 0}
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#2563eb", marginLeft: 4 }}>
                    ({collectorData?.messagesProcessed ?? 0} proc)
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                  {collectorData?.messagesIgnored ?? 0} ignored / dup
                </div>
              </div>
            </div>

            {/* Current Context Row */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                fontSize: 12
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <span style={{ color: "#64748b", fontWeight: 600 }}>Active Chat: </span>
                  <span style={{ fontWeight: 700, color: "#0f172a" }}>
                    {collectorStats?.currentGroup || "None (Waiting for group selection)"}
                  </span>
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: collectorStats?.chatType === "GROUP" ? "#dbeafe" : "#f1f5f9",
                  color: collectorStats?.chatType === "GROUP" ? "#1e40af" : "#64748b"
                }}>
                  {collectorStats?.chatType || "GROUP"}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: collectorStats?.collectionStatus === "ACTIVE" ? "#dcfce7" : "#f1f5f9",
                  color: collectorStats?.collectionStatus === "ACTIVE" ? "#15803d" : "#64748b"
                }}>
                  Status: {collectorStats?.collectionStatus || "IDLE"}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <span style={{ color: "#64748b", fontWeight: 600 }}>Events Generated: </span>
                  <span style={{ fontWeight: 700, color: "#16a34a" }}>+{collectorStats?.eventsCreated ?? 0}</span>
                  <span style={{ color: "#64748b", margin: "0 4px" }}>/</span>
                  <span style={{ fontWeight: 700, color: "#2563eb" }}>~{collectorStats?.eventsUpdated ?? 0}</span>
                </div>
                <div>
                  <span style={{ color: "#64748b", fontWeight: 600 }}>Last Result: </span>
                  <span style={{
                    fontWeight: 700,
                    color: collectorStats?.lastResult === "CREATED" ? "#16a34a" :
                           collectorStats?.lastResult === "UPDATED" ? "#2563eb" :
                           collectorStats?.lastResult === "IGNORED_DUPLICATE" ? "#eab308" :
                           collectorStats?.lastResult === "NON_ACADEMIC" ? "#64748b" : "#94a3b8"
                  }}>
                    {collectorStats?.lastResult || "Idle"}
                  </span>
                </div>
              </div>
            </div>

            {/* Manual Group Scan Status Card (Requirement 11) */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "14px 16px",
                display: "grid",
                gap: 12
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    Manual Group Scan Status
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      background:
                        (collectorStats?.scanStatus === "SCANNING") ? "#fef3c7" :
                        (collectorStats?.scanStatus === "COMPLETE") ? "#dcfce7" :
                        (collectorStats?.scanStatus === "ERROR") ? "#fee2e2" : "#f1f5f9",
                      color:
                        (collectorStats?.scanStatus === "SCANNING") ? "#b45309" :
                        (collectorStats?.scanStatus === "COMPLETE") ? "#15803d" :
                        (collectorStats?.scanStatus === "ERROR") ? "#b91c1c" : "#475569",
                      border: `1px solid ${
                        (collectorStats?.scanStatus === "SCANNING") ? "#fde68a" :
                        (collectorStats?.scanStatus === "COMPLETE") ? "#bbf7d0" :
                        (collectorStats?.scanStatus === "ERROR") ? "#fecaca" : "#e2e8f0"
                      }`
                    }}
                  >
                    <span>
                      {(collectorStats?.scanStatus === "SCANNING") ? "🟡 Scanning" :
                       (collectorStats?.scanStatus === "COMPLETE") ? "✅ Scan Complete" :
                       (collectorStats?.scanStatus === "ERROR") ? "🔴 Scan Error" : "⚪ Idle"}
                    </span>
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  Per-group scan triggered on manual group selection
                </div>
              </div>

              {/* 12 Required Fields Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: 10,
                  fontSize: 12
                }}
              >
                {/* 1. Current Group */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Current Group</div>
                  <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={collectorStats?.currentGroup || "None"}>
                    {collectorStats?.currentGroup || "None"}
                  </div>
                </div>

                {/* 2. Scan Status */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Scan Status</div>
                  <div style={{ fontWeight: 800, marginTop: 2, color:
                    (collectorStats?.scanStatus === "SCANNING") ? "#d97706" :
                    (collectorStats?.scanStatus === "COMPLETE") ? "#16a34a" :
                    (collectorStats?.scanStatus === "ERROR") ? "#dc2626" : "#64748b"
                  }}>
                    {collectorStats?.scanStatus || "IDLE"}
                  </div>
                </div>

                {/* 3. Scan Started */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Scan Started</div>
                  <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                    {collectorStats?.scanStartedAt ? formatTimeSafe(collectorStats.scanStartedAt) : "—"}
                  </div>
                </div>

                {/* 4. Scan Completed */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Scan Completed</div>
                  <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                    {collectorStats?.scanCompletedAt ? formatTimeSafe(collectorStats.scanCompletedAt) : "—"}
                  </div>
                </div>

                {/* 5. Messages Scanned */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Messages Scanned</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                    {collectorStats?.messagesScanned ?? 0}
                  </div>
                </div>

                {/* 6. Academic Messages */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Academic Messages</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#2563eb", marginTop: 2 }}>
                    {collectorStats?.academicMessages ?? 0}
                  </div>
                </div>

                {/* 7. Ignored */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Ignored</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#64748b", marginTop: 2 }}>
                    {collectorStats?.messagesIgnored ?? 0}
                  </div>
                </div>

                {/* 8. Duplicates */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Duplicates</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#eab308", marginTop: 2 }}>
                    {collectorStats?.duplicates ?? 0}
                  </div>
                </div>

                {/* 9. Created */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Created</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#16a34a", marginTop: 2 }}>
                    +{collectorStats?.eventsCreated ?? 0}
                  </div>
                </div>

                {/* 10. Updated */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Updated</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#0284c7", marginTop: 2 }}>
                    ~{collectorStats?.eventsUpdated ?? 0}
                  </div>
                </div>

                {/* 11. Errors */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Errors</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: (collectorStats?.errors ?? 0) > 0 ? "#dc2626" : "#64748b", marginTop: 2 }}>
                    {collectorStats?.errors ?? 0}
                  </div>
                </div>

                {/* 12. Last Processed */}
                <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Last Processed</div>
                  <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                    {collectorStats?.lastProcessedTimestamp ? formatDateTimeSafe(collectorStats.lastProcessedTimestamp) : "—"}
                  </div>
                </div>
              </div>

              {/* Error Detail Banner if in ERROR state */}
              {collectorStats?.scanStatus === "ERROR" && collectorStats?.lastError && (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#9f1239" }}>
                  <strong>Error Reason:</strong> {collectorStats.lastError} (Cursor not advanced past failed message)
                </div>
              )}
            </div>

            {/* Monitored WhatsApp Groups Table (Explicit Academic Allowlist) */}
            <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px", overflowX: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    Monitored WhatsApp Groups (Academic Allowlist)
                  </span>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    Only messages from configured groups are processed. Disallowed groups (e.g. Embedded Project, Personal) are ignored.
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={handlePreviewCleanup}
                    disabled={cleanupLoading}
                    style={{
                      background: "#fef2f2",
                      color: "#991b1b",
                      border: "1px solid #fecaca",
                      borderRadius: 6,
                      padding: "5px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4
                    }}
                  >
                    <ShieldCheck size={13} />
                    {cleanupLoading ? "Checking..." : "Review / Cleanup Spam"}
                  </button>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    Backfill start: <strong>2026-09-10</strong>
                  </span>
                </div>
              </div>

              {/* Cleanup Preview Panel if triggered */}
              {cleanupPreview && (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 8, padding: "12px", marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, color: "#9f1239", fontSize: 12 }}>
                      ⚠️ Found {cleanupPreview.candidatesCount} Invalid Event(s) for Cleanup:
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {cleanupPreview.candidatesCount > 0 && (
                        <button
                          onClick={handleExecuteCleanup}
                          disabled={cleanupLoading}
                          style={{
                            background: "#e11d48",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 4,
                            padding: "4px 8px",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer"
                          }}
                        >
                          Delete {cleanupPreview.candidatesCount} Invalid Events
                        </button>
                      )}
                      <button
                        onClick={() => setCleanupPreview(null)}
                        style={{
                          background: "#ffffff",
                          color: "#475569",
                          border: "1px solid #cbd5e1",
                          borderRadius: 4,
                          padding: "4px 8px",
                          fontSize: 11,
                          cursor: "pointer"
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  {cleanupPreview.candidates.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#15803d" }}>✓ No invalid, promotional, or unallowed group events found. All academic events are legitimate!</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6, maxHeight: "160px", overflowY: "auto" }}>
                      {cleanupPreview.candidates.map((c: any) => (
                        <div key={c.id} style={{ fontSize: 11, background: "#ffffff", padding: "6px 8px", borderRadius: 4, border: "1px solid #ffe4e6" }}>
                          <span style={{ fontWeight: 700, color: "#881337" }}>[{c.reason}]</span>{" "}
                          <span style={{ fontWeight: 600, color: "#0f172a" }}>"{c.title}"</span>{" "}
                          <span style={{ color: "#64748b" }}>({c.sourceGroup || "No Group"})</span> - {c.detail}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Reviewable Bad Data Cleanup Banner */}
              {suspiciousItems.length > 0 && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "#fffbeb",
                  border: "1px solid #fef3c7",
                  borderRadius: 8,
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#92400e"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <AlertTriangle size={16} color="#d97706" />
                    <span>
                      <strong>{suspiciousItems.length} suspicious event(s) detected</strong> (promotional ads, attendance-only, or disallowed groups).
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCleanupIds(suspiciousItems.map(s => s.item.id));
                      setCleanupModalOpen(true);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      background: "#d97706",
                      color: "#ffffff",
                      border: "none",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    Review & Clean Data
                  </button>
                </div>
              )}

              {!collectorData?.groups || collectorData.groups.length === 0 ? (
                <div style={{ textAlign: "center", padding: "16px", color: "#64748b", fontSize: 12 }}>
                  Configured allowed groups will appear here as soon as collector connects.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b", textTransform: "uppercase", fontSize: 11 }}>
                      <th style={{ padding: "6px 8px" }}>Group Name</th>
                      <th style={{ padding: "6px 8px" }}>Status</th>
                      <th style={{ padding: "6px 8px" }}>Messages (Proc / Scan)</th>
                      <th style={{ padding: "6px 8px" }}>Last Scanned Cursor</th>
                      <th style={{ padding: "6px 8px" }}>Last Academic Event</th>
                      <th style={{ padding: "6px 8px" }}>Backfill Status</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Dev / Admin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collectorData.groups.map(g => (
                      <tr key={g.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 8px", fontWeight: 700, color: "#0f172a" }}>
                          {g.groupName}
                        </td>
                        <td style={{ padding: "8px 8px" }}>
                          <span style={{
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            background: (g as any).isAllowed !== false ? "#dcfce7" : "#fee2e2",
                            color: (g as any).isAllowed !== false ? "#15803d" : "#b91c1c"
                          }}>
                            {(g as any).isAllowed !== false ? "ALLOWED & MONITORED" : "DISALLOWED / IGNORED"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 8px", color: "#0f172a" }}>
                          <span style={{ fontWeight: 700 }}>{g.messagesProcessed || 0}</span>
                          <span style={{ color: "#64748b", fontSize: 11, marginLeft: 4 }}>
                            ({g.messagesScanned || 0} scanned)
                          </span>
                        </td>
                        <td style={{ padding: "8px 8px", color: "#334155", fontSize: 11 }}>
                          {formatDateTimeSafe(g.lastScannedMessageTimestamp || g.lastProcessedMessageTimestamp)}
                        </td>
                        <td style={{ padding: "8px 8px", color: "#334155", fontSize: 11 }}>
                          {formatDateTimeSafe(g.lastProcessedAcademicMessageTimestamp || g.lastProcessedMessageTimestamp)}
                        </td>
                        <td style={{ padding: "8px 8px" }}>
                          <span style={{
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            background: g.backfillComplete ? "#dcfce7" : (g.status === "BACKFILLING" ? "#fef3c7" : "#f1f5f9"),
                            color: g.backfillComplete ? "#15803d" : (g.status === "BACKFILLING" ? "#b45309" : "#64748b")
                          }}>
                            {g.backfillComplete ? "COMPLETED" : (g.status === "BACKFILLING" ? "IN PROGRESS" : "PENDING")}
                          </span>
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={async () => {
                              if (confirm(`Reset backfill for "${g.groupName}"?\n\nThis will clear the cursor and allow a full rescan from September 10, 2026 on the next scan.`)) {
                                try {
                                  const res = await fetch(`/api/collector/groups/${encodeURIComponent(g.groupName)}/reset`, { method: "POST" });
                                  if (res.ok) {
                                    alert(`Backfill reset for ${g.groupName}. Ready to rescan from September 10.`);
                                    loadCollectorStats();
                                  } else {
                                    const err = await res.json();
                                    alert(`Failed to reset: ${err.error || "Unknown error"}`);
                                  }
                                } catch (e: any) {
                                  alert(`Error: ${e.message}`);
                                }
                              }
                            }}
                            style={{
                              padding: "3px 8px",
                              fontSize: 11,
                              fontWeight: 600,
                              borderRadius: 4,
                              background: "#fee2e2",
                              color: "#991b1b",
                              border: "1px solid #fecdd3",
                              cursor: "pointer"
                            }}
                            title="Admin Action: Clear cursor and reset backfill to September 10"
                          >
                            Reset Backfill
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Scan History Table (Last 10 Scans) */}
            {collectorData?.recentScans && collectorData.recentScans.length > 0 && (
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px", overflowX: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    Recent Scan Cycles (Last 10)
                  </span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    Automated 2-hour backfill and incremental scans
                  </span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b", textTransform: "uppercase", fontSize: 11 }}>
                      <th style={{ padding: "6px 8px" }}>Scan ID</th>
                      <th style={{ padding: "6px 8px" }}>Start Time</th>
                      <th style={{ padding: "6px 8px" }}>End Time</th>
                      <th style={{ padding: "6px 8px" }}>Duration</th>
                      <th style={{ padding: "6px 8px" }}>Groups Scanned</th>
                      <th style={{ padding: "6px 8px" }}>Messages Scanned</th>
                      <th style={{ padding: "6px 8px" }}>Events Created</th>
                      <th style={{ padding: "6px 8px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collectorData.recentScans.map(s => {
                      const dur = s.completedAt
                        ? Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
                        : null;
                      return (
                        <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 8px", fontFamily: "monospace", fontSize: 11, color: "#64748b" }}>
                            {s.id.slice(0, 8)}
                          </td>
                          <td style={{ padding: "8px 8px", color: "#334155" }}>
                            {formatTimeSafe(s.startedAt)}
                          </td>
                          <td style={{ padding: "8px 8px", color: "#334155" }}>
                            {s.completedAt ? formatTimeSafe(s.completedAt) : "In Progress..."}
                          </td>
                          <td style={{ padding: "8px 8px", color: "#64748b" }}>
                            {dur !== null ? `${dur}s` : "-"}
                          </td>
                          <td style={{ padding: "8px 8px", color: "#0f172a", fontWeight: 600 }}>
                            {s.groupsCompleted} / {s.groupsDiscovered}
                          </td>
                          <td style={{ padding: "8px 8px", color: "#0f172a" }}>
                            {s.messagesScanned} <span style={{ color: "#64748b", fontSize: 11 }}>({s.messagesProcessed} proc)</span>
                          </td>
                          <td style={{ padding: "8px 8px", color: "#16a34a", fontWeight: 700 }}>
                            +{s.eventsCreated}
                          </td>
                          <td style={{ padding: "8px 8px" }}>
                            <span style={{
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              background: s.status === "COMPLETED" ? "#dcfce7" : (s.status === "IN_PROGRESS" ? "#dbeafe" : "#fee2e2"),
                              color: s.status === "COMPLETED" ? "#15803d" : (s.status === "IN_PROGRESS" ? "#1e40af" : "#b91c1c")
                            }}>
                              {s.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Message Ingestion Box */}
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          padding: 20,
          marginBottom: 26,
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={18} color="#2563eb" />
            <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>WhatsApp Message Ingestion</span>
          </div>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Extracts entities, detects updates/postponements, and rejects casual chatter.
          </span>
        </div>

        {/* Quick sample chips */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Try sample:</span>
          {SAMPLE_MESSAGES.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setMessage(s.text);
                setSourceGroup(s.group);
              }}
              style={{
                fontSize: 12,
                padding: "4px 9px",
                borderRadius: 6,
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                color: "#334155",
                display: "inline-flex",
                alignItems: "center",
                gap: 4
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleCaptureMessage}>
          <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <input
                type="text"
                placeholder="Source Group (optional, e.g. NLP Lab, OS Announcements)"
                value={sourceGroup}
                onChange={e => setSourceGroup(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 13,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc"
                }}
              />
            </div>
          </div>

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder='Paste faculty message here. e.g.: "Students can practice the lab2 practice question and upload the document before 11:35 am. Submit here: https://..." or "Slip Test 2 is postponed to 3 October."'
            rows={3}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              fontSize: 14,
              resize: "vertical",
              outline: "none"
            }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, flexWrap: "wrap", gap: 10 }}>
            <button
              type="submit"
              disabled={busy || !message.trim()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "#0f172a",
                color: "#ffffff",
                border: "none",
                borderRadius: 8,
                padding: "9px 18px",
                fontSize: 14,
                fontWeight: 600
              }}
            >
              <Send size={15} />
              {busy ? "Analyzing Message..." : "Capture & Process Message"}
            </button>

            {items !== INITIAL_DEMO_ITEMS && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Reset to initial demo items?")) {
                    setItems(INITIAL_DEMO_ITEMS);
                    localStorage.removeItem("academic_command_center_items");
                    setNotice({ type: "info", text: "Reset items to initial demo set." });
                  }
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  fontSize: 12,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4
                }}
              >
                <RotateCcw size={12} />
                Reset demo data
              </button>
            )}
          </div>
        </form>

        {notice && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background:
                notice.type === "success" ? "#f0fdf4" :
                notice.type === "warning" ? "#fffbeb" :
                notice.type === "error" ? "#fff1f2" : "#eff6ff",
              color:
                notice.type === "success" ? "#15803d" :
                notice.type === "warning" ? "#b45309" :
                notice.type === "error" ? "#be123c" : "#1d4ed8",
              border: `1px solid ${
                notice.type === "success" ? "#bbf7d0" :
                notice.type === "warning" ? "#fde68a" :
                notice.type === "error" ? "#fecdd3" : "#bfdbfe"
              }`
            }}
          >
            {notice.type === "success" && <Check size={16} />}
            {notice.type === "warning" && <AlertTriangle size={16} />}
            {notice.type === "error" && <AlertCircle size={16} />}
            {notice.type === "info" && <MessageSquare size={16} />}
            <span>{notice.text}</span>
          </div>
        )}

        {/* AI Extraction & Event Engine Inspector */}
        {inspection && (
          <div
            style={{
              marginTop: 18,
              borderTop: "1px dashed #cbd5e1",
              paddingTop: 16
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={16} color="#7c3aed" />
                <span style={{ fontWeight: 800, fontSize: 14, color: "#1e1b4b" }}>
                  AI Extraction & Event Engine Inspector
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 6,
                    background: inspection.providerUsed === "gemini" ? "#f3e8ff" : "#f1f5f9",
                    color: inspection.providerUsed === "gemini" ? "#6b21a8" : "#475569",
                    fontWeight: 700
                  }}
                >
                  Provider: {inspection.providerUsed}
                </span>
                {inspection.fallbackOccurred && (
                  <span style={{ fontSize: 11, background: "#fff7ed", color: "#c2410c", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                    Fallback Active
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
              {/* 1. Original Message */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>
                  1. Original WhatsApp Message
                </div>
                <div style={{ fontSize: 13, fontStyle: "italic", color: "#334155", background: "#ffffff", padding: "8px 10px", borderRadius: 6, border: "1px solid #e2e8f0", marginBottom: 6 }}>
                  "{inspection.originalMessage}"
                </div>
                {inspection.sourceGroup && (
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    Source Group: <strong>{inspection.sourceGroup}</strong>
                  </div>
                )}
              </div>

              {/* 2. AI Extraction */}
              <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#7e22ce", textTransform: "uppercase" }}>
                    2. AI Structured Extraction
                  </span>
                  {inspection.validation?.confidenceScore !== null && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: inspection.validation?.confidenceLevel === "HIGH" ? "#dcfce7" : inspection.validation?.confidenceLevel === "MEDIUM" ? "#fef3c7" : "#fee2e2",
                        color: inspection.validation?.confidenceLevel === "HIGH" ? "#15803d" : inspection.validation?.confidenceLevel === "MEDIUM" ? "#b45309" : "#b91c1c"
                      }}
                    >
                      Confidence: {Math.round((inspection.validation?.confidenceScore ?? 0) * 100)}% ({inspection.validation?.confidenceLevel})
                    </span>
                  )}
                </div>

                {inspection.aiExtraction ? (
                  <div style={{ fontSize: 12, display: "grid", gap: 4, color: "#1e1b4b" }}>
                    <div><strong>Action:</strong> <span style={{ padding: "1px 5px", borderRadius: 4, background: "#f3e8ff", color: "#6b21a8", fontWeight: 700 }}>{inspection.aiExtraction.action}</span></div>
                    <div><strong>Type:</strong> {inspection.aiExtraction.type}</div>
                    <div><strong>Subject:</strong> {inspection.aiExtraction.subject || "null (needs confirmation)"}</div>
                    <div><strong>Title:</strong> {inspection.aiExtraction.title || "null"}</div>
                    <div><strong>Date:</strong> {inspection.aiExtraction.eventDate || "null"}</div>
                    <div><strong>Time:</strong> {inspection.aiExtraction.eventTime || "null"}</div>
                    <div><strong>Deadline:</strong> {inspection.aiExtraction.deadline || "null"}</div>
                    <div>
                      <strong>Submission Link:</strong>{" "}
                      {inspection.aiExtraction.submissionUrl ? (
                        <a href={inspection.aiExtraction.submissionUrl} target="_blank" rel="noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
                          {inspection.aiExtraction.submissionUrl}
                        </a>
                      ) : (
                        "null"
                      )}
                    </div>
                    {inspection.aiExtraction.resourceUrls?.length > 0 && (
                      <div><strong>Resources:</strong> {inspection.aiExtraction.resourceUrls.join(", ")}</div>
                    )}
                    {inspection.aiExtraction.requirements?.length > 0 && (
                      <div><strong>Requirements:</strong> {inspection.aiExtraction.requirements.join("; ")}</div>
                    )}
                    {inspection.aiExtraction.changeDescription && (
                      <div><strong>Change Description:</strong> {inspection.aiExtraction.changeDescription}</div>
                    )}
                    {inspection.validation?.needsConfirmation && (
                      <div style={{ color: "#b45309", background: "#fef3c7", padding: "4px 8px", borderRadius: 4, marginTop: 4 }}>
                        ⚠️ Needs Confirmation: {inspection.validation?.confirmationReason || "Uncertain extraction"}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#64748b" }}>No extraction payload available.</div>
                )}
              </div>

              {/* 3. Event Engine Result & Before / After */}
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#166534", textTransform: "uppercase", marginBottom: 6 }}>
                  3. Event Engine Result
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#14532d", marginBottom: 6 }}>
                  Action: <span style={{ textTransform: "uppercase" }}>{inspection.engineResult?.action}</span>
                </div>
                {inspection.engineResult?.changeSummary && (
                  <div style={{ fontSize: 12, color: "#15803d", marginBottom: 8 }}>
                    {inspection.engineResult.changeSummary}
                  </div>
                )}

                {/* BEFORE → AFTER Box */}
                {inspection.beforeAfter && (
                  <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 8, padding: 8, marginTop: 6, fontSize: 11 }}>
                    <div style={{ fontWeight: 800, color: "#334155", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                      <History size={12} />
                      BEFORE → AFTER MODIFICATION:
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 4, alignItems: "center", background: "#f8fafc", padding: 6, borderRadius: 6 }}>
                      <div>
                        <div style={{ color: "#64748b", fontWeight: 600 }}>BEFORE</div>
                        <div>Date: {inspection.beforeAfter.before.eventDate || "unspecified"}</div>
                        <div>Status: {inspection.beforeAfter.before.status}</div>
                        {inspection.beforeAfter.before.eventTime && <div>Time: {inspection.beforeAfter.before.eventTime}</div>}
                        {inspection.beforeAfter.before.submissionUrl && <div>Link: {inspection.beforeAfter.before.submissionUrl.slice(0, 20)}...</div>}
                      </div>
                      <div style={{ fontWeight: 900, color: "#2563eb", fontSize: 14 }}>→</div>
                      <div>
                        <div style={{ color: "#15803d", fontWeight: 700 }}>AFTER</div>
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>Date: {inspection.beforeAfter.after.eventDate || "unspecified"}</div>
                        <div style={{ fontWeight: 700, color: "#c2410c" }}>Status: {inspection.beforeAfter.after.status}</div>
                        {inspection.beforeAfter.after.eventTime && <div>Time: {inspection.beforeAfter.after.eventTime}</div>}
                        {inspection.beforeAfter.after.submissionUrl && <div>Link: {inspection.beforeAfter.after.submissionUrl.slice(0, 20)}...</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Tabs Navigation (9 tabs requested) */}
      <nav
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          paddingBottom: 4,
          marginBottom: 16,
          borderBottom: "1px solid #e2e8f0"
        }}
      >
        <TabButton active={activeTab === "TODAY"} onClick={() => setActiveTab("TODAY")} label="Today" count={tabCounts.TODAY} alert={tabCounts.OVERDUE > 0} />
        <TabButton active={activeTab === "UPCOMING"} onClick={() => setActiveTab("UPCOMING")} label="Upcoming" count={tabCounts.UPCOMING} />
        <TabButton active={activeTab === "ASSIGNMENTS"} onClick={() => setActiveTab("ASSIGNMENTS")} label="Assignments" count={tabCounts.ASSIGNMENTS} />
        <TabButton active={activeTab === "EXAMS"} onClick={() => setActiveTab("EXAMS")} label="Exams & Tests" count={tabCounts.EXAMS} />
        <TabButton active={activeTab === "PROJECTS"} onClick={() => setActiveTab("PROJECTS")} label="Projects" count={tabCounts.PROJECTS} />
        <TabButton active={activeTab === "SUBMISSIONS"} onClick={() => setActiveTab("SUBMISSIONS")} label="Submissions" count={tabCounts.SUBMISSIONS} />
        <TabButton active={activeTab === "ANNOUNCEMENTS"} onClick={() => setActiveTab("ANNOUNCEMENTS")} label="Announcements" count={tabCounts.ANNOUNCEMENTS} />
        <TabButton active={activeTab === "COMPLETED"} onClick={() => setActiveTab("COMPLETED")} label="Completed" count={tabCounts.COMPLETED} />
        <TabButton active={activeTab === "OVERDUE"} onClick={() => setActiveTab("OVERDUE")} label="Missed/Overdue" count={tabCounts.OVERDUE} alert={tabCounts.OVERDUE > 0} />
        <TabButton active={activeTab === "REMINDERS"} onClick={() => setActiveTab("REMINDERS")} label="🔔 Reminders" />
      </nav>

      {activeTab === "REMINDERS" ? (
        <div style={{ marginTop: 12 }}>
          <ReminderCenter />
        </div>
      ) : (
        <>
          {/* Filters & Search bar */}
          <div
            style={{
              display: "flex",
              gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 20
        }}
      >
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
          <input
            type="text"
            placeholder="Search title, subject, notes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 10px 7px 32px",
              fontSize: 13,
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#ffffff"
            }}
          />
        </div>

        {/* Subject filter */}
        <select
          value={subjectFilter}
          onChange={e => setSubjectFilter(e.target.value)}
          style={{
            padding: "7px 10px",
            fontSize: 13,
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#ffffff",
            color: "#334155"
          }}
        >
          <option value="ALL">All Subjects</option>
          {uniqueSubjects.map(sub => (
            <option key={sub} value={sub}>{sub}</option>
          ))}
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{
            padding: "7px 10px",
            fontSize: 13,
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#ffffff",
            color: "#334155"
          }}
        >
          <option value="ALL">All Types</option>
          <option value="ASSIGNMENT">Assignment</option>
          <option value="LAB">Lab</option>
          <option value="SLIP_TEST">Slip Test</option>
          <option value="EXAM">Exam</option>
          <option value="QUIZ">Quiz</option>
          <option value="PROJECT">Project</option>
          <option value="PRESENTATION">Presentation</option>
          <option value="ANNOUNCEMENT">Announcement</option>
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            padding: "7px 10px",
            fontSize: 13,
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#ffffff",
            color: "#334155"
          }}
        >
          <option value="ALL">All Statuses</option>
          <option value="INBOX">Inbox</option>
          <option value="NOT_STARTED">Not Started</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="POSTPONED">Postponed</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        {(subjectFilter !== "ALL" || typeFilter !== "ALL" || statusFilter !== "ALL" || searchQuery) && (
          <button
            onClick={() => {
              setSubjectFilter("ALL");
              setTypeFilter("ALL");
              setStatusFilter("ALL");
              setSearchQuery("");
            }}
            style={{
              fontSize: 12,
              color: "#64748b",
              background: "transparent",
              border: "none",
              padding: "4px 8px"
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Main Items Grid */}
      {filteredItems.length === 0 ? (
        <div
          style={{
            background: "#ffffff",
            border: "1px dashed #cbd5e1",
            borderRadius: 14,
            padding: "48px 20px",
            textAlign: "center",
            color: "#64748b"
          }}
        >
          <FileText size={36} color="#94a3b8" style={{ marginBottom: 12, display: "inline-block" }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px", color: "#334155" }}>
            No academic items in this view
          </h3>
          <p style={{ margin: 0, fontSize: 13 }}>
            Paste a WhatsApp message above or pick another tab to view your schedule.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {filteredItems.map(item => {
            const typeConf = TYPE_CONFIG[item.type] || TYPE_CONFIG.OTHER;
            const statusConf = STATUS_CONFIG[item.status] || STATUS_CONFIG.INBOX;
            const itemOverdue = isOverdue(item.deadline || item.eventDate, item.eventTime, now) && item.status !== "COMPLETED" && item.status !== "CANCELLED";
            const itemDueToday = isToday(item.deadline || item.eventDate, now);
            const isCompleted = item.status === "COMPLETED";
            const isCancelled = item.status === "CANCELLED";
            const isPostponed = item.status === "POSTPONED";
            const hasHistory = item.changeHistory && item.changeHistory.length > 0;
            const isHistoryOpen = !!expandedHistory[item.id];
            const isOriginalOpen = !!expandedOriginal[item.id];

            return (
              <article
                key={item.id}
                style={{
                  background: "#ffffff",
                  border: itemOverdue
                    ? "1px solid #fca5a5"
                    : isPostponed
                    ? "1px solid #fdba74"
                    : "1px solid #e2e8f0",
                  borderRadius: 14,
                  padding: "18px 20px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                  opacity: isCompleted || isCancelled ? 0.75 : 1,
                  transition: "all 0.15s ease"
                }}
              >
                {/* Header Row: Subject, Type, Status */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {/* Subject badge */}
                    {item.subject === "NEEDS_CONFIRMATION" ? (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: "#fffbeb",
                          color: "#b45309",
                          border: "1px solid #fde68a",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4
                        }}
                      >
                        <AlertTriangle size={12} />
                        Needs Confirmation
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: "#f1f5f9",
                          color: "#334155"
                        }}
                      >
                        {item.subject}
                      </span>
                    )}

                    {/* Academic Type badge */}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: typeConf.bg,
                        color: typeConf.color
                      }}
                    >
                      {typeConf.icon} {typeConf.label}
                    </span>

                    {/* Source group tag */}
                    {item.sourceGroup && (
                      <span style={{ fontSize: 11, color: "#64748b" }}>
                        via {item.sourceGroup}
                      </span>
                    )}

                    {/* Notion synced tag */}
                    {item.notionPageId && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "#f5f3ff",
                          color: "#6d28d9",
                          border: "1px solid #ddd6fe"
                        }}
                      >
                        📝 Synced to Notion
                      </span>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {itemOverdue && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          background: "#fee2e2",
                          color: "#991b1b",
                          padding: "2px 8px",
                          borderRadius: 999
                        }}
                      >
                        Overdue
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        background: statusConf.bg,
                        color: statusConf.color,
                        padding: "3px 9px",
                        borderRadius: 999
                      }}
                    >
                      {statusConf.label}
                    </span>
                  </div>
                </div>

                {/* Title & Description */}
                <h2
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    margin: "0 0 6px",
                    color: isCompleted ? "#64748b" : "#0f172a",
                    textDecoration: isCompleted ? "line-through" : "none"
                  }}
                >
                  {item.title}
                </h2>
                <p style={{ margin: "0 0 14px", color: "#475569", fontSize: 14 }}>
                  {item.description}
                </p>

                {/* Prominent Metadata Cards */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
                  {/* Posted Date (WhatsApp message sent timestamp) */}
                  {(item.sourceMessageDate || item.sourceMessageTimestamp) && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "5px 10px",
                        borderRadius: 8,
                        background: "#f8fafc",
                        color: "#475569",
                        border: "1px solid #e2e8f0"
                      }}
                      title="Date message was posted on WhatsApp"
                    >
                      <MessageSquare size={13} />
                      <span>Posted: {formatCalendarDate(item.sourceMessageDate || item.sourceMessageTimestamp!.slice(0, 10))}</span>
                    </div>
                  )}

                  {/* Deadline display */}
                  {item.deadline && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "5px 10px",
                        borderRadius: 8,
                        background: itemOverdue ? "#fff1f2" : itemDueToday ? "#eff6ff" : "#f8fafc",
                        color: itemOverdue ? "#be123c" : itemDueToday ? "#1d4ed8" : "#334155",
                        border: `1px solid ${itemOverdue ? "#fecdd3" : itemDueToday ? "#bfdbfe" : "#e2e8f0"}`
                      }}
                    >
                      <Clock size={14} />
                      <span>Due: {formatDeadlineDisplay(item.deadline, now)}</span>
                    </div>
                  )}

                  {/* Exam / Quiz / Event Date & Time display */}
                  {item.eventDate && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "5px 10px",
                        borderRadius: 8,
                        background: isPostponed ? "#fff7ed" : "#f8fafc",
                        color: isPostponed ? "#c2410c" : "#334155",
                        border: `1px solid ${isPostponed ? "#fed7aa" : "#e2e8f0"}`
                      }}
                    >
                      <Calendar size={14} />
                      <span>
                        {item.type === "QUIZ" ? "Quiz: " : (item.type === "EXAM" || item.type === "SLIP_TEST") ? "Exam: " : "Event: "}
                        {formatCalendarDate(item.eventDate)}
                      </span>
                      {item.eventTime && <span>· {item.eventTime}</span>}
                    </div>
                  )}

                  {/* Reminder Scheduled indicator */}
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "5px 9px",
                      borderRadius: 8,
                      background: "#faf5ff",
                      color: "#7e22ce",
                      border: "1px solid #e9d5ff"
                    }}
                  >
                    <Bell size={12} />
                    <span>Reminder scheduled</span>
                  </div>

                  {/* Submission Link Button (Requested prominent [Open Submission]) */}
                  {item.submissionUrl && (
                    <a
                      href={item.submissionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 700,
                        padding: "5px 12px",
                        borderRadius: 8,
                        background: "#2563eb",
                        color: "#ffffff"
                      }}
                    >
                      <ExternalLink size={13} />
                      Open Submission
                    </a>
                  )}

                  {/* Attachments */}
                  {item.attachmentNames.map(att => (
                    <span
                      key={att}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        padding: "4px 8px",
                        borderRadius: 6,
                        background: "#f1f5f9",
                        color: "#475569"
                      }}
                    >
                      📎 {att}
                    </span>
                  ))}
                </div>

                {/* Change History Box if updates occurred */}
                {hasHistory && (
                  <div
                    style={{
                      background: "#fffaf0",
                      border: "1px solid #feebc8",
                      borderRadius: 10,
                      padding: "8px 12px",
                      marginBottom: 12,
                      fontSize: 13
                    }}
                  >
                    <div
                      onClick={() => setExpandedHistory(p => ({ ...p, [item.id]: !p[item.id] }))}
                      style={{
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        color: "#c05621",
                        fontWeight: 700
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <History size={14} />
                        {item.changeHistory.length} modification{item.changeHistory.length > 1 ? "s" : ""} recorded
                        {item.changeHistory[item.changeHistory.length - 1] && (
                          <span style={{ fontWeight: 500, color: "#744210" }}>
                            · Latest: {item.changeHistory[item.changeHistory.length - 1].summary}
                          </span>
                        )}
                      </span>
                      {isHistoryOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>

                    {isHistoryOpen && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #fed7aa", display: "grid", gap: 6 }}>
                        {item.changeHistory.map(change => (
                          <div key={change.id} style={{ fontSize: 12, color: "#7c2d12" }}>
                            <span style={{ fontWeight: 600 }}>
                              {formatTimeSafe(change.timestamp)}:
                            </span>{" "}
                            {change.summary}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Bottom Action Row */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 10,
                    paddingTop: 12,
                    borderTop: "1px solid #f1f5f9"
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {/* Mark Complete Button */}
                    <button
                      type="button"
                      onClick={() => toggleComplete(item.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "6px 12px",
                        borderRadius: 8,
                        background: isCompleted ? "#f1f5f9" : "#ffffff",
                        color: isCompleted ? "#475569" : "#0f172a",
                        border: "1px solid #cbd5e1"
                      }}
                    >
                      <CheckCircle2 size={15} color={isCompleted ? "#16a34a" : "#64748b"} />
                      {isCompleted ? "Completed (Click to Reopen)" : "Mark Complete"}
                    </button>

                    {/* Quick Subject Picker if NEEDS_CONFIRMATION */}
                    {item.subject === "NEEDS_CONFIRMATION" && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>Assign subject:</span>
                        {["NLP", "OS", "DBMS", "CN", "AI", "Maths"].map(sub => (
                          <button
                            key={sub}
                            type="button"
                            onClick={() => updateItemSubject(item.id, sub)}
                            style={{
                              fontSize: 11,
                              padding: "3px 7px",
                              borderRadius: 4,
                              background: "#f8fafc",
                              border: "1px solid #cbd5e1",
                              color: "#334155"
                            }}
                          >
                            {sub}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Original message toggle */}
                  <button
                    type="button"
                    onClick={() => setExpandedOriginal(p => ({ ...p, [item.id]: !p[item.id] }))}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#64748b",
                      fontSize: 12,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4
                    }}
                  >
                    <MessageSquare size={12} />
                    {isOriginalOpen ? "Hide WhatsApp Text" : "View WhatsApp Text"}
                  </button>
                </div>

                {/* Original WhatsApp messages display */}
                {isOriginalOpen && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 8,
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                      color: "#334155"
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4, color: "#475569" }}>Original Source Messages:</div>
                    {item.originalMessages.map((m, idx) => (
                      <div key={idx} style={{ fontStyle: "italic", marginBottom: 4 }}>
                        "{m}"
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* Reviewable Bad Data Cleanup Modal (Requirement 30) */}
      {cleanupModalOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.6)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 99999,
          padding: 20
        }}>
          <div style={{
            background: "#ffffff",
            borderRadius: 16,
            maxWidth: 650,
            width: "100%",
            maxHeight: "85vh",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)"
          }}>
            {/* Modal Header */}
            <div style={{
              padding: "18px 24px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>
                  Review & Clean Suspicious Events
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
                  Review flagged events before deletion. Uncheck any legitimate items you wish to keep.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCleanupModalOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 20,
                  cursor: "pointer",
                  color: "#64748b"
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: "18px 24px", overflowY: "auto", flex: 1 }}>
              {cleanupMessage && (
                <div style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "#dcfce7",
                  color: "#15803d",
                  fontWeight: 600,
                  marginBottom: 14,
                  fontSize: 13
                }}>
                  ✓ {cleanupMessage}
                </div>
              )}

              {suspiciousItems.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px 0", color: "#64748b" }}>
                  No suspicious events found in the database.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
                      Found {suspiciousItems.length} candidate(s)
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setSelectedCleanupIds(suspiciousItems.map(s => s.item.id))}
                        style={{ fontSize: 11, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCleanupIds([])}
                        style={{ fontSize: 11, color: "#64748b", background: "none", border: "none", cursor: "pointer" }}
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  {suspiciousItems.map(({ item, reason }) => {
                    const isSelected = selectedCleanupIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          setSelectedCleanupIds(prev =>
                            isSelected ? prev.filter(id => id !== item.id) : [...prev, item.id]
                          );
                        }}
                        style={{
                          padding: "12px 14px",
                          borderRadius: 10,
                          border: `1px solid ${isSelected ? "#fca5a5" : "#e2e8f0"}`,
                          background: isSelected ? "#fff5f5" : "#f8fafc",
                          cursor: "pointer",
                          display: "flex",
                          gap: 12,
                          alignItems: "flex-start"
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          style={{ marginTop: 3, cursor: "pointer" }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                              {item.title}
                            </span>
                            <span style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "#fee2e2",
                              color: "#991b1b"
                            }}>
                              {reason}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                            {item.sourceGroup && <span>Group: {item.sourceGroup} · </span>}
                            <span>Posted: {formatCalendarDate(item.sourceMessageDate || item.createdAt.slice(0, 10))}</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#334155", marginTop: 4, fontStyle: "italic" }}>
                            "{item.description.slice(0, 120)}{item.description.length > 120 ? "..." : ""}"
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div style={{
              padding: "14px 24px",
              borderTop: "1px solid #e2e8f0",
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              background: "#f8fafc"
            }}>
              <button
                type="button"
                onClick={() => setCleanupModalOpen(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#475569",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedCleanupIds.length === 0 || isCleaningUp}
                onClick={() => handleDeleteSuspiciousEvents(selectedCleanupIds)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: selectedCleanupIds.length === 0 ? "#cbd5e1" : "#dc2626",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#ffffff",
                  cursor: selectedCleanupIds.length === 0 || isCleaningUp ? "not-allowed" : "pointer"
                }}
              >
                {isCleaningUp ? "Deleting..." : `Delete ${selectedCleanupIds.length} Selected Events`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, alert, icon }: { label: string; value: number; alert?: boolean; icon: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${alert ? "#fca5a5" : "#e2e8f0"}`,
        borderRadius: 12,
        padding: "8px 14px",
        minWidth: 100,
        boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, color: alert ? "#dc2626" : "#64748b" }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{label}</span>
        {icon}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: alert ? "#dc2626" : "#0f172a" }}>
        {value}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  alert
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: 8,
        border: "none",
        background: active ? "#0f172a" : "transparent",
        color: active ? "#ffffff" : "#64748b",
        fontWeight: active ? 700 : 500,
        fontSize: 13,
        whiteSpace: "nowrap"
      }}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span
          style={{
            fontSize: 11,
            padding: "1px 6px",
            borderRadius: 999,
            background: active
              ? (alert ? "#ef4444" : "#334155")
              : (alert ? "#fee2e2" : "#f1f5f9"),
            color: active
              ? "#ffffff"
              : (alert ? "#b91c1c" : "#475569"),
            fontWeight: 700
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}