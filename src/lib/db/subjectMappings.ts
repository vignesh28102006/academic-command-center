import { getSupabaseClient } from "./supabase";
import { SubjectMappingRecord } from "../types";

const defaultMappings: Record<string, string> = {
  "19CSE312": "NLP",
  "CS301": "OS",
  "CS302": "DBMS",
  "CS303": "CN",
  "CS304": "AI",
  "MAT201": "Mathematics"
};

const inMemoryMappings: Map<string, string> = new Map(Object.entries(defaultMappings));

export async function resolveSubjectCode(text: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const upper = text.toUpperCase();

  // 1. Check in-memory / defaults first
  for (const [code, subject] of Array.from(inMemoryMappings.entries())) {
    const codeRegex = new RegExp(`\\b${code}\\b`, "i");
    if (codeRegex.test(text)) {
      return subject;
    }
  }

  // 2. Query Supabase subject_mappings if connected
  if (supabase) {
    const { data } = await supabase
      .from("subject_mappings")
      .select("course_code, subject_name");

    if (data) {
      for (const row of data) {
        inMemoryMappings.set(row.course_code.toUpperCase(), row.subject_name);
        const codeRegex = new RegExp(`\\b${row.course_code}\\b`, "i");
        if (codeRegex.test(text)) {
          return row.subject_name;
        }
      }
    }
  }

  return null;
}

export async function getAllSubjectMappings(): Promise<SubjectMappingRecord[]> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    const now = new Date().toISOString();
    return Array.from(inMemoryMappings.entries()).map(([code, name]) => ({
      id: code,
      courseCode: code,
      subjectName: name,
      createdAt: now,
      updatedAt: now
    }));
  }

  const { data, error } = await supabase
    .from("subject_mappings")
    .select("*")
    .order("course_code", { ascending: true });

  if (error || !data) {
    const now = new Date().toISOString();
    return Array.from(inMemoryMappings.entries()).map(([code, name]) => ({
      id: code,
      courseCode: code,
      subjectName: name,
      createdAt: now,
      updatedAt: now
    }));
  }

  return data.map(r => ({
    id: r.id,
    courseCode: r.course_code,
    subjectName: r.subject_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

export async function upsertSubjectMapping(courseCode: string, subjectName: string): Promise<void> {
  const cleanCode = courseCode.trim().toUpperCase();
  const cleanName = subjectName.trim();
  inMemoryMappings.set(cleanCode, cleanName);

  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase.from("subject_mappings").upsert(
      {
        course_code: cleanCode,
        subject_name: cleanName,
        updated_at: new Date().toISOString()
      },
      { onConflict: "course_code" }
    );
  }
}
