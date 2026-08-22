import React, { useEffect, useMemo, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface InstructorLink {
  instructorName: string;
  count: number;
  instructorId: string | null;
}

interface InstructorUser {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

interface LinkData {
  instructors: InstructorLink[];
  users: InstructorUser[];
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

function similarity(name: string, userName: string): number {
  const left = normalize(name);
  const right = normalize(userName);
  if (left.length === 0 || right.length === 0) return 0;
  const shared = left.filter((token) => right.some((other) => other === token || other.includes(token) || token.includes(other))).length;
  return shared / Math.max(left.length, right.length);
}

export default function AdminRecoveryInstructors() {
  const { toast } = useToast();
  const [data, setData] = useState<LinkData | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch("/api/admin/recovery-instructor-links", { credentials: "include" });
    if (!response.ok) throw new Error("Could not load recovery instructors");
    const next = await response.json() as LinkData;
    setData(next);
    setSelected(Object.fromEntries(next.instructors.map((item) => [item.instructorName, item.instructorId ?? "unlinked"])));
  };

  useEffect(() => {
    void load().catch((error) => toast({ variant: "destructive", title: error.message }));
  }, []);

  const suggestions = useMemo(() => {
    if (!data) return new Map<string, InstructorUser>();
    return new Map(data.instructors.map((item) => {
      const best = [...data.users].sort((a, b) => similarity(item.instructorName, b.name) - similarity(item.instructorName, a.name))[0];
      return [item.instructorName, best && similarity(item.instructorName, best.name) >= 0.5 ? best : undefined];
    }).filter((entry): entry is [string, InstructorUser] => Boolean(entry[1])));
  }, [data]);

  const save = async (item: InstructorLink) => {
    const userId = selected[item.instructorName] === "unlinked" ? null : selected[item.instructorName];
    setSaving(item.instructorName);
    try {
      const response = await fetch("/api/admin/recovery-instructor-links", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorName: item.instructorName, userId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save link");
      toast({ title: "Instructor link saved", description: `${result.linkedCount} session records updated.` });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Link not saved", description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col px-4 pb-10 sm:px-6">
      <PageHeader
        title="Recovery instructor links"
        subtitle="Connect names imported from historical reports to real instructor accounts. Suggestions are never applied until you confirm them."
      />
      {!data ? (
        <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
      ) : (
        <div className="mt-6 grid gap-3">
          {data.instructors.map((item) => {
            const suggestion = suggestions.get(item.instructorName);
            return (
              <Card key={item.instructorName}>
                <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(180px,1fr)_minmax(240px,1fr)_auto] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{item.instructorName || "Unnamed instructor"}</p>
                      <Badge variant="secondary">{item.count} session{item.count === 1 ? "" : "s"}</Badge>
                    </div>
                    {suggestion && !item.instructorId && (
                      <button
                        type="button"
                        className="mt-2 text-left text-xs font-medium text-brand-700 hover:underline"
                        onClick={() => setSelected((current) => ({ ...current, [item.instructorName]: suggestion.id }))}
                      >
                        Suggested match: {suggestion.name}
                      </button>
                    )}
                  </div>
                  <Select
                    value={selected[item.instructorName] ?? "unlinked"}
                    onValueChange={(value) => setSelected((current) => ({ ...current, [item.instructorName]: value }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Choose an account" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unlinked">Not linked</SelectItem>
                      {data.users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button
                    className="gap-2"
                    onClick={() => void save(item)}
                    disabled={saving === item.instructorName || (selected[item.instructorName] ?? "unlinked") === (item.instructorId ?? "unlinked")}
                  >
                    {saving === item.instructorName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    Confirm link
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}