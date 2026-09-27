"use client";

import { useState, useEffect } from "react";
import {
  Bell,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sun,
  Send,
  RefreshCw,
  ExternalLink,
  Shield,
  Filter,
  Check,
  X,
  Volume2
} from "lucide-react";
import { ReminderItem, ReminderSettings, MorningBriefingData } from "@/lib/reminders/reminderTypes";
import { formatCalendarDate } from "@/lib/dateUtils";

export default function ReminderCenter() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Briefing modal state
  const [briefingModalOpen, setBriefingModalOpen] = useState(false);
  const [briefingData, setBriefingData] = useState<MorningBriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

  // Browser notification permission state
  const [permission, setPermission] = useState<"granted" | "denied" | "default" | "unsupported">("default");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    } else {
      setPermission("unsupported");
    }
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [remRes, setRes] = await Promise.all([
        fetch("/api/reminders").then(r => r.json()),
        fetch("/api/reminders/settings").then(r => r.json())
      ]);

      if (remRes.success) {
        setReminders(remRes.reminders || []);
        setSchedulerStatus(remRes.scheduler || null);
      }
      if (setRes.success) {
        setSettings(setRes.settings);
      }
    } catch (err: any) {
      console.error("Failed to load reminders data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleEnabled() {
    if (!settings) return;
    setBusyAction("toggle-settings");
    try {
      const nextState = !settings.enabled;
      const res = await fetch("/api/reminders/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextState })
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setFeedback({
          type: "success",
          message: `Reminder engine ${nextState ? "ENABLED" : "PAUSED"}.`
        });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to update settings" });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRequestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setFeedback({ type: "error", message: "Browser notifications not supported in this browser." });
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") {
        setFeedback({ type: "success", message: "Browser notification permissions granted!" });
      } else {
        setFeedback({ type: "info", message: `Permission status: ${result}` });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message });
    }
  }

  async function handleGenerateReminders() {
    setBusyAction("generate");
    try {
      const res = await fetch("/api/reminders/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        const { remindersCreated, remindersCancelled, remindersSent } = data.result;
        setFeedback({
          type: "success",
          message: `Scan complete: +${remindersCreated} created, ${remindersCancelled} invalidated, ${remindersSent} dispatched.`
        });
        await loadData();
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSendTestReminder() {
    setBusyAction("send-test");
    try {
      const res = await fetch("/api/reminders/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Academic Command Center Test",
          message: "DBMS Assignment 3 is due tomorrow at 11:59 PM.",
          priority: "HIGH"
        })
      });
      const data = await res.json();
      if (data.success) {
        // Also trigger browser notification if granted
        if (permission === "granted" && typeof window !== "undefined" && "Notification" in window) {
          new Notification("Academic Command Center: Test Alert", {
            body: "DBMS Assignment 3 is due tomorrow at 11:59 PM.",
            icon: "/favicon.ico"
          });
        }
        setFeedback({
          type: "success",
          message: `Test reminder dispatched successfully via Console${permission === "granted" ? " and Browser" : ""}!`
        });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOpenBriefingPreview() {
    setBriefingLoading(true);
    setBriefingModalOpen(true);
    try {
      const res = await fetch("/api/briefing/preview");
      const data = await res.json();
      if (data.success) {
        setBriefingData(data.briefing);
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: "Failed to load morning briefing preview." });
    } finally {
      setBriefingLoading(false);
    }
  }

  const filteredReminders = reminders.filter(r => {
    if (statusFilter === "ALL") return true;
    return r.status === statusFilter;
  });

  function formatTime(isoStr?: string | null) {
    if (!isoStr) return "None scheduled";
    try {
      const d = new Date(isoStr);
      return d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
    } catch {
      return isoStr;
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Status & Controls Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
                <Bell className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  Academic Reminder Center
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                    settings?.enabled ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                  }`}>
                    {settings?.enabled ? "ENGINE ACTIVE" : "PAUSED"}
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Automated deadline alerts & 07:30 daily briefing (Asia/Kolkata)
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleToggleEnabled}
              disabled={busyAction !== null}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
                settings?.enabled
                  ? "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                  : "bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-500"
              }`}
            >
              {settings?.enabled ? "Pause Reminders" : "Enable Reminders"}
            </button>

            <button
              onClick={handleOpenBriefingPreview}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition flex items-center gap-1.5"
            >
              <Sun className="w-3.5 h-3.5" />
              Preview Morning Briefing
            </button>

            <button
              onClick={handleSendTestReminder}
              disabled={busyAction !== null}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1.5 shadow"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Send Test Reminder
            </button>

            <button
              onClick={handleGenerateReminders}
              disabled={busyAction !== null}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              title="Regenerate Reminders Now"
            >
              <RefreshCw className={`w-4 h-4 ${busyAction === "generate" ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Feedback alert */}
        {feedback && (
          <div className={`mt-4 text-xs p-3 rounded-lg flex items-center justify-between border ${
            feedback.type === "success"
              ? "bg-emerald-950/40 text-emerald-300 border-emerald-800/40"
              : feedback.type === "error"
              ? "bg-rose-950/40 text-rose-300 border-rose-800/40"
              : "bg-blue-950/40 text-blue-300 border-blue-800/40"
          }`}>
            <span>{feedback.message}</span>
            <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-800/80">
          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Engine State</span>
            <span className="text-sm font-semibold text-slate-200">
              {settings?.enabled ? "● Running (Server-side)" : "○ Paused"}
            </span>
          </div>

          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Next Scheduled Alert</span>
            <span className="text-sm font-semibold text-indigo-300 truncate block">
              {formatTime(schedulerStatus?.nextReminderTimestamp)}
            </span>
          </div>

          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Next Morning Briefing</span>
            <span className="text-sm font-semibold text-amber-300 truncate block">
              {formatTime(schedulerStatus?.nextMorningBriefingTimestamp)}
            </span>
          </div>

          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Browser Push</span>
              <span className={`text-xs font-semibold uppercase ${
                permission === "granted" ? "text-emerald-400" : permission === "denied" ? "text-rose-400" : "text-amber-400"
              }`}>
                {permission}
              </span>
            </div>
            {permission !== "granted" && permission !== "unsupported" && (
              <button
                onClick={handleRequestPermission}
                className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              >
                Grant
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Reminders Table Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-200">Scheduled & Recent Alerts</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              {filteredReminders.length}
            </span>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-xs bg-slate-950 border border-slate-800 text-slate-300 rounded-md px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="SCHEDULED">Scheduled Only</option>
              <option value="SENT">Sent</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Event</th>
                <th className="py-3 px-4">Interval</th>
                <th className="py-3 px-4">Scheduled For</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Submission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredReminders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    {loading ? "Loading reminders..." : "No reminders found matching filter."}
                  </td>
                </tr>
              ) : (
                filteredReminders.map(r => (
                  <tr key={r.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-200">{r.eventTitle}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <span className="px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded font-mono text-[10px]">
                          {r.eventSubject}
                        </span>
                        <span>•</span>
                        <span>{r.eventType}</span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono text-[11px]">
                        {r.reminderType}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">
                      {formatTime(r.scheduledFor)}
                    </td>

                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        r.priority === "URGENT"
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                          : r.priority === "HIGH"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          : r.priority === "REVIEW"
                          ? "bg-purple-500/10 text-purple-400 border border-purple-500/30"
                          : "bg-slate-800 text-slate-400"
                      }`}>
                        {r.priority}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        r.status === "SCHEDULED"
                          ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                          : r.status === "SENT"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : r.status === "CANCELLED"
                          ? "bg-slate-800 text-slate-500"
                          : "bg-rose-500/10 text-rose-400"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          r.status === "SCHEDULED" ? "bg-sky-400" : r.status === "SENT" ? "bg-emerald-400" : "bg-slate-500"
                        }`} />
                        {r.status}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      {r.submissionUrl ? (
                        <a
                          href={r.submissionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 underline"
                        >
                          Open Submission
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-600 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Morning Briefing Preview Modal */}
      {briefingModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun className="w-5 h-5 text-amber-400" />
                <h3 className="font-semibold text-white">Daily Morning Briefing Preview</h3>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  07:30 Asia/Kolkata
                </span>
              </div>
              <button
                onClick={() => setBriefingModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {briefingLoading ? (
                <div className="py-8 text-center text-slate-400 text-sm">
                  Generating briefing preview...
                </div>
              ) : briefingData ? (
                <>
                  <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800/80">
                    <span className="text-xs text-slate-400 block mb-1">Executive Summary</span>
                    <p className="text-sm font-medium text-slate-200">{briefingData.summary}</p>
                  </div>

                  <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
                    <span className="text-xs font-semibold text-slate-400 block uppercase tracking-wider mb-2">
                      Briefing Dispatch Format
                    </span>
                    <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">
                      {briefingData.rawText}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-400 text-center py-6">
                  No briefing data available.
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 flex justify-end gap-2">
              {briefingData && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(briefingData.rawText);
                    setFeedback({ type: "success", message: "Morning briefing copied to clipboard!" });
                    setBriefingModalOpen(false);
                  }}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition"
                >
                  Copy Text
                </button>
              )}
              <button
                onClick={() => setBriefingModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
