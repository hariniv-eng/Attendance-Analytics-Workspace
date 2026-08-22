import { useEffect, useMemo, useState } from "react";
import { useGetDashboardFilters } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";
import { ErrorState } from "@/components/PageStates";
import { Progress } from "@/components/ui/progress";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
} from "lucide-react";
import { pctTextColor } from "@/lib/utils";
import { exportCsv } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";

interface RecoveryStudent {
  studentId: string;
  studentName: string;
  sectionName: string | null;
  attendancePct: number;
  presentCount: number;
  totalCount: number;
}

interface RecoverySubjectCard {
  subjectTitle: string;
  attendancePct: number;
  studentsBelow80Count: number;
  students: RecoveryStudent[];
}

interface RecoveryCampusData {
  campus: string;
  subjects: RecoverySubjectCard[];
  totalSubjectsInRecovery: number;
  totalStudentsInRecovery: number;
}

interface RecoveryProgress {
  campus: string;
  subject: string;
  totalTopics: number;
  topicsBelowThreshold: number;
  topicsRecovered: number;
  topicsRemaining: number;
  recoveryCompletionPct: number;
  sessionsHeld: number;
  sessionsCancelled: number;
  lastSession: { date: string; topics: string[] } | null;
  nextScheduled: { date: string; topics: string[] } | null;
}

function formatRecoveryDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

export default function Recovery() {
  const { toast } = useToast();
  const [selectedCampus, setSelectedCampus] = useState("");
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [recoveryData, setRecoveryData] = useState<RecoveryCampusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [recoveryProgress, setRecoveryProgress] =
    useState<RecoveryProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState("");

  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters({});

  useEffect(() => {
    if (!selectedCampus) {
      setRecoveryData(null);
      setSelectedSubject(null);
      return;
    }

    async function fetchRecovery() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/attendance/recovery/subjects?campus=${encodeURIComponent(selectedCampus)}`,
        );
        if (!response.ok) {
          throw new Error("Failed to fetch recovery data");
        }
        const data = await response.json();
        setRecoveryData(data);
        setSelectedSubject(
          data.subjects.length > 0 ? data.subjects[0].subjectTitle : null,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch data";
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      } finally {
        setLoading(false);
      }
    }

    fetchRecovery();
  }, [selectedCampus, toast]);

  const selectedSubjectData = useMemo(() => {
    if (!recoveryData || !selectedSubject) return null;
    return (
      recoveryData.subjects.find((subject) => subject.subjectTitle === selectedSubject) ??
      null
    );
  }, [recoveryData, selectedSubject]);

  const selectedBigQuerySubject = selectedSubjectData?.subjectTitle;

  useEffect(() => {
    if (!selectedCampus || !selectedBigQuerySubject) {
      setRecoveryProgress(null);
      setProgressError("");
      setProgressLoading(false);
      return;
    }

    const progressSubject = selectedBigQuerySubject;
    const controller = new AbortController();

    async function fetchProgress() {
      setProgressLoading(true);
      setProgressError("");
      setRecoveryProgress(null);

      try {
        const params = new URLSearchParams({
          campus: selectedCampus,
          subject: progressSubject,
        });
        const response = await fetch(`/api/dashboard/recovery-progress?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load recovery progress");
        }
        const data = (await response.json()) as RecoveryProgress;
        setRecoveryProgress(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setProgressError(
          err instanceof Error ? err.message : "Failed to load recovery progress",
        );
      } finally {
        if (!controller.signal.aborted) setProgressLoading(false);
      }
    }

    fetchProgress();
    return () => controller.abort();
  }, [selectedCampus, selectedBigQuerySubject]);

  const filteredStudents = useMemo(() => {
    if (!selectedSubjectData) return [];

    const lowerSearch = searchFilter.trim().toLowerCase();
    if (!lowerSearch) return selectedSubjectData.students;

    return selectedSubjectData.students.filter(
      (student) =>
        student.studentName.toLowerCase().includes(lowerSearch) ||
        student.studentId.toLowerCase().includes(lowerSearch),
    );
  }, [selectedSubjectData, searchFilter]);

  const handleExport = () => {
    if (!selectedSubjectData) {
      toast({ variant: "destructive", title: "No subject selected" });
      return;
    }

    const headers = [
      "Campus",
      "Subject",
      "Student ID",
      "Student Name",
      "Section",
      "Attendance",
      "Present/Total",
    ];
    const rows: (string | number)[][] = selectedSubjectData.students.map(
      (student) => [
        selectedCampus,
        selectedSubjectData.subjectTitle,
        student.studentId,
        student.studentName,
        student.sectionName || "-",
        `${student.attendancePct.toFixed(1)}%`,
        `${student.presentCount}/${student.totalCount}`,
      ],
    );

    exportCsv(
      `recovery-${selectedCampus}-${selectedSubjectData.subjectTitle}-${new Date()
        .toISOString()
        .split("T")[0]}.csv`,
      headers,
      rows,
    );
  };

  if (filtersLoading) {
    return <PageLoader />;
  }

  const campusOptions =
    filterOptions?.campuses.map((campus) => ({ value: campus, label: campus })) || [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Recovery Dashboard"
        subtitle="Campus subject recovery based on subject-level attendance below 80%"
      />

      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Select Campus
          </label>
          <Select value={selectedCampus} onValueChange={setSelectedCampus}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a campus..." />
            </SelectTrigger>
            <SelectContent>
              {campusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-gray-600">Loading subject recovery data...</span>
        </div>
      )}

      {error && !loading && (
        <ErrorState message={error} />
      )}

      {!selectedCampus && !loading && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-gray-400" />
          <p className="text-gray-600">Select a campus to view recovery subjects</p>
        </div>
      )}

      {selectedCampus && !loading && recoveryData && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-medium text-gray-600">Subjects in Recovery</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {recoveryData.totalSubjectsInRecovery}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-medium text-gray-600">Students Affected</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {recoveryData.totalStudentsInRecovery}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-medium text-gray-600">Campus</p>
              <p className="mt-2 text-lg font-bold text-gray-900">
                {recoveryData.campus}
              </p>
            </div>
          </div>

          {recoveryData.subjects.length === 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
              <p className="text-green-700">
                ✓ Great! No subject is below 80% attendance in <strong>{recoveryData.campus}</strong>.
              </p>
            </div>
          )}

          {recoveryData.subjects.length > 0 && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {recoveryData.subjects.map((subject) => (
                  <button
                    key={subject.subjectTitle}
                    type="button"
                    onClick={() => setSelectedSubject(subject.subjectTitle)}
                    className={`rounded-xl border p-4 text-left transition ${
                      selectedSubject === subject.subjectTitle
                        ? "border-red-300 bg-red-50 shadow-sm"
                        : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                          Subject
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-gray-900">
                          {subject.subjectTitle}
                        </h3>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${pctTextColor(subject.attendancePct)}`}>
                        {subject.attendancePct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-sm text-gray-600">Below 80%</span>
                      <span className="text-lg font-bold text-red-600">
                        {subject.studentsBelow80Count}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {selectedSubjectData && (
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Selected subject</p>
                      <h3 className="text-2xl font-bold text-gray-900">
                        {selectedSubjectData.subjectTitle}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${pctTextColor(selectedSubjectData.attendancePct)}`}>
                        {selectedSubjectData.attendancePct.toFixed(1)}% attendance
                      </span>
                      <Button onClick={handleExport} variant="outline" size="sm">
                        <Download className="mr-2 h-4 w-4" />
                        Export
                      </Button>
                    </div>
                  </div>

                  {progressLoading && (
                    <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading recovery progress…
                    </div>
                  )}

                  {progressError && !progressLoading && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Recovery progress is temporarily unavailable.
                    </div>
                  )}

                  {recoveryProgress && !progressLoading && (
                    <section
                      aria-label="Recovery progress summary"
                      className="mb-4 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-3"
                    >
                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[0.85fr_2fr_0.9fr_1.7fr] lg:gap-0">
                        <div className="flex items-center gap-2 lg:pr-4">
                          <CalendarDays className="h-4 w-4 shrink-0 text-brand-600" />
                          <div>
                            <p className="text-xs font-medium text-gray-500">Sessions held</p>
                            <p className="text-lg font-bold text-gray-900">
                              {recoveryProgress.sessionsHeld}
                            </p>
                          </div>
                        </div>

                        <div className="min-w-0 lg:border-l lg:border-gray-200 lg:px-4">
                          <div className="flex items-center justify-between gap-2">
                            <p className="flex items-center gap-2 text-xs font-medium text-gray-500">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                              Topics recovered
                            </p>
                            <span className="text-xs font-semibold text-gray-700">
                              {recoveryProgress.recoveryCompletionPct}%
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-bold text-gray-900">
                            {recoveryProgress.topicsRecovered}{" "}
                            <span className="font-medium text-gray-500">
                              of {recoveryProgress.topicsBelowThreshold}
                            </span>
                          </p>
                          <Progress
                            value={Math.min(
                              Math.max(recoveryProgress.recoveryCompletionPct, 0),
                              100,
                            )}
                            className="mt-2 h-1.5 bg-emerald-100 [&>div]:bg-emerald-600"
                          />
                        </div>

                        <div className="flex items-center gap-2 lg:border-l lg:border-gray-200 lg:px-4">
                          <Clock3 className="h-4 w-4 shrink-0 text-amber-600" />
                          <div>
                            <p className="text-xs font-medium text-gray-500">Topics remaining</p>
                            <p className="text-lg font-bold text-gray-900">
                              {recoveryProgress.topicsRemaining}
                            </p>
                          </div>
                        </div>

                        <div className="min-w-0 lg:border-l lg:border-gray-200 lg:pl-4">
                          <p className="text-xs font-medium text-gray-500">Last session</p>
                          {recoveryProgress.lastSession ? (
                            <>
                              <p className="mt-1 text-sm font-semibold text-gray-900">
                                {formatRecoveryDate(recoveryProgress.lastSession.date)}
                              </p>
                              <p
                                className="truncate text-xs text-gray-600"
                                title={recoveryProgress.lastSession.topics.join(", ")}
                              >
                                {recoveryProgress.lastSession.topics.join(", ")}
                              </p>
                            </>
                          ) : (
                            <p className="mt-1 text-sm text-gray-500">No session recorded</p>
                          )}
                        </div>
                      </div>
                    </section>
                  )}

                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Search by student name or ID..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  {filteredStudents.length === 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-gray-600">
                      No students match this search in {selectedSubjectData.subjectTitle}.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Student Name</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Student ID</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Section</th>
                            <th className="px-4 py-2 text-center font-medium text-gray-700">Attendance</th>
                            <th className="px-4 py-2 text-center font-medium text-gray-700">Sessions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredStudents.map((student) => (
                            <tr key={student.studentId} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium text-gray-900">{student.studentName}</td>
                              <td className="px-4 py-3 font-mono text-gray-600">{student.studentId}</td>
                              <td className="px-4 py-3 text-gray-600">{student.sectionName || "-"}</td>
                              <td className="px-4 py-3">
                                <div className="flex justify-center">
                                  <span className={`font-semibold ${pctTextColor(student.attendancePct)}`}>
                                    {student.attendancePct.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center text-gray-600">
                                {student.presentCount}/{student.totalCount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
