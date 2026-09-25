"use client";

import { useState, useMemo, useEffect } from "react";
import { AcademicItem, AcademicStatus, AcademicType, ChangeRecord, CollectorStats } from "@/lib/types";
import {
  formatCalendarDate,
  formatDeadlineDisplay,
  isOverdue,
  isToday,
  isUpcoming,
  toLocalDateString
} from "@/lib/dateUtils";
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
  ShieldCheck
} from "lucide-react";

type TabType =
  | "TODAY"
  | "UPCOMING"
  | "ASSIGNMENTS"
  | "EXAMS"
  | "PROJECTS"
  | "SUBMISSIONS"
  | "ANNOUNCEMENTS"
  | "COMPLETED"
  | "OVERDUE";

const INITIAL_DEMO_ITEMS: AcademicItem[] = [
  {
    id: "demo-lab-1",
    title: "NLP Lab Practice Question",
    subject: "NLP",
    type: "LAB",
    status: "NOT_STARTED",
    deadline: `${toLocalDateString(new Date())}T11:35:00`,
    submissionUrl: "https://classroom.google.com",
    resourceUrls: [],
    attachmentNames: ["Lab2_Practice_Questions.ipynb"],
    description: "Students can practice the lab2 practice question and upload the document before 11:35 am.",
    sourceGroup: "NLP Lab",
    sourceSender: "Faculty Coordinator",
    originalMessages: [
      "Students can practice the lab2 practice question and upload the document before 11:35 am. Submit here: https://classroom.google.com"
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    changeHistory: [],
    confidence: "HIGH"
  },
  {
    id: "demo-announcement-1",
    title: "Collect the answer sheets",
    subject: "NEEDS_CONFIRMATION",
    type: "ANNOUNCEMENT",
    status: "INBOX",
    eventDate: toLocalDateString(new Date()),
    resourceUrls: [],
    attachmentNames: [],
    description: "Today is the last date to collect the answer sheets from the staff room.",
    sourceGroup: "College Notice Board",
    originalMessages: [
      "Today is the last date to collect the answer sheets from the staff room."
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
  const [items, setItems] = useState<AcademicItem[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("academic_command_center_items");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // fallback to demo
        }
      }
    }
    return INITIAL_DEMO_ITEMS;
  });

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

  // Save to localStorage on change
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("academic_command_center_items", JSON.stringify(items));
    }
  }, [items]);

  // Dynamic reference date (now)
  const now = useMemo(() => new Date(), [items]);

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
      OVERDUE: 0
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

  const [collectorStats, setCollectorStats] = useState<CollectorStats | null>(null);
  const [collectorPanelOpen, setCollectorPanelOpen] = useState(true);

  async function loadCollectorStats() {
    try {
      const res = await fetch("/api/collector/status");
      if (res.ok) {
        const data = await res.json();
        if (data?.stats) {
          setCollectorStats(data.stats);
        }
      }
    } catch (err) {
      console.warn("Could not load collector stats:", err);
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

      {/* Collector Status Panel (Phase 4A) */}
      <section
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          padding: "16px 20px",
          marginBottom: 20,
          boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: collectorPanelOpen ? 14 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
            <Radio size={16} color="#0f766e" />
            <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>WhatsApp Web Collector Status</span>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 12,
              background: collectorStats?.endpointStatus === "CONFIGURED" ? "#dcfce7" : "#fef3c7",
              color: collectorStats?.endpointStatus === "CONFIGURED" ? "#15803d" : "#b45309"
            }}>
              {collectorStats?.endpointStatus === "CONFIGURED" ? "Endpoint Ready" : "Awaiting Secret"}
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
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Messages Received</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{collectorStats?.totalReceived ?? 0}</div>
              </div>
              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Filtered Chatter</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#64748b" }}>{collectorStats?.nonAcademic ?? 0}</div>
              </div>
              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Duplicates Ignored</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#eab308" }}>{collectorStats?.duplicate ?? 0}</div>
              </div>
              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Events Created</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#16a34a" }}>{collectorStats?.eventsCreated ?? 0}</div>
              </div>
              <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Events Updated</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#2563eb" }}>{collectorStats?.eventsUpdated ?? 0}</div>
              </div>
            </div>

            <div style={{ background: "#ffffff", padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <span style={{ color: "#64748b", fontWeight: 600 }}>Endpoint: </span>
                <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, color: "#0f172a" }}>POST /api/collector/messages</code>
              </div>
              <div>
                <span style={{ color: "#64748b", fontWeight: 600 }}>Last Received: </span>
                <span style={{ color: "#0f172a" }}>
                  {collectorStats?.lastReceivedAt ? new Date(collectorStats.lastReceivedAt).toLocaleTimeString() : "No messages yet"}
                </span>
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
              {collectorStats?.lastProcessedMessage && (
                <div style={{ width: "100%", borderTop: "1px dashed #e2e8f0", paddingTop: 8, color: "#475569" }}>
                  <span style={{ color: "#64748b", fontWeight: 600 }}>Last Processed: </span>
                  <span style={{ fontStyle: "italic" }}>"{collectorStats.lastProcessedMessage}"</span>
                </div>
              )}
            </div>
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
      </nav>

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
                      <span>{formatDeadlineDisplay(item.deadline, now)}</span>
                    </div>
                  )}

                  {/* Exam Date & Time display */}
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
                      <span>{formatCalendarDate(item.eventDate)}</span>
                      {item.eventTime && <span>· {item.eventTime}</span>}
                    </div>
                  )}

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
                              {new Date(change.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}:
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
  count: number;
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
    </button>
  );
}