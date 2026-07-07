import { useState } from "react";
import { Link } from "wouter";
import {
  useListDepartments,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
  useReassignDepartment,
  useListLocations,
  useCreateLocation,
  useUpdateLocation,
  useDeleteLocation,
  useReassignLocation,
  useGetMe,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, ArrowLeft, Pencil, Trash2, Check, X, Building2, MapPin } from "lucide-react";

interface OrgUnit {
  id: number;
  name: string;
  employeeCount: number;
}

interface OrgSectionProps {
  title: string;
  singular: string;
  icon: React.ReactNode;
  items: OrgUnit[] | undefined;
  isLoading: boolean;
  isMutating: boolean;
  onCreate: (name: string, done: () => void) => void;
  onRename: (id: number, name: string, done: () => void) => void;
  onDelete: (item: OrgUnit) => void;
}

function OrgSection({
  title,
  singular,
  icon,
  items,
  isLoading,
  isMutating,
  onCreate,
  onRename,
  onDelete,
}: OrgSectionProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name, () => setNewName(""));
  };

  const startEdit = (item: OrgUnit) => {
    setEditingId(item.id);
    setEditName(item.name);
  };

  const saveEdit = (id: number) => {
    const name = editName.trim();
    if (!name) return;
    onRename(id, name, () => setEditingId(null));
  };

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="border-b bg-muted/20">
        <CardTitle className="text-lg flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>Create, rename, or remove {title.toLowerCase()}.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex gap-2 p-4 border-b">
          <Input
            placeholder={`New ${singular.toLowerCase()} name`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
          <Button onClick={handleCreate} disabled={isMutating || !newName.trim()} className="shrink-0">
            {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-1 hidden sm:inline">Add</span>
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Name</TableHead>
              <TableHead>Employees</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : items && items.length > 0 ? (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {editingId === item.id ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveEdit(item.id);
                          }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        className="max-w-xs"
                      />
                    ) : (
                      item.name
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{item.employeeCount}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {editingId === item.id ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => saveEdit(item.id)}
                            disabled={isMutating || !editName.trim()}
                          >
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setEditingId(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => startEdit(item)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => onDelete(item)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  No {title.toLowerCase()} yet. Add one above.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function ManageOrg() {
  const { data: user } = useGetMe();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: departments, isLoading: loadingDepts } = useListDepartments();
  const { data: locations, isLoading: loadingLocs } = useListLocations();

  const createDept = useCreateDepartment();
  const updateDept = useUpdateDepartment();
  const deleteDept = useDeleteDepartment();
  const reassignDept = useReassignDepartment();

  const createLoc = useCreateLocation();
  const updateLoc = useUpdateLocation();
  const deleteLoc = useDeleteLocation();
  const reassignLoc = useReassignLocation();

  type Kind = "department" | "location";
  const [reassignState, setReassignState] = useState<{ item: OrgUnit; kind: Kind } | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("none");

  if (!isAdmin && user) {
    return <div className="p-8 text-center text-destructive">Unauthorized. Admins only.</div>;
  }

  const invalidate = (key: string) => {
    queryClient.invalidateQueries({ queryKey: [key] });
    // Employee names are resolved from these lists, so refresh them too.
    queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
  };

  const errMessage = (err: any, fallback: string) => {
    const msg = err?.response?.data?.error || err?.data?.error || err?.message;
    return typeof msg === "string" ? msg : fallback;
  };

  const keyFor = (kind: Kind) => (kind === "department" ? "/api/departments" : "/api/locations");
  const labelFor = (kind: Kind) => (kind === "department" ? "Department" : "Location");

  // Delete a unit that has no employees assigned.
  const performDelete = (item: OrgUnit, kind: Kind) => {
    const mut = kind === "department" ? deleteDept : deleteLoc;
    mut.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          toast({ title: `${labelFor(kind)} deleted` });
          invalidate(keyFor(kind));
        },
        onError: (err) =>
          toast({ title: errMessage(err, `Failed to delete ${kind}`), variant: "destructive" }),
      },
    );
  };

  // Entry point for the delete button: reassign first if employees are still assigned.
  const requestDelete = (item: OrgUnit, kind: Kind) => {
    if (item.employeeCount > 0) {
      setReassignTo("none");
      setReassignState({ item, kind });
      return;
    }
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    performDelete(item, kind);
  };

  const reassignOptions = reassignState
    ? ((reassignState.kind === "department" ? departments : locations) ?? []).filter(
        (u) => u.id !== reassignState.item.id,
      )
    : [];

  const reassignPending =
    reassignDept.isPending || reassignLoc.isPending || deleteDept.isPending || deleteLoc.isPending;

  // Reassign all employees off the unit, then delete it.
  const handleReassignAndDelete = () => {
    if (!reassignState) return;
    const { item, kind } = reassignState;
    const target = reassignTo === "none" ? null : parseInt(reassignTo);
    const reassignMut = kind === "department" ? reassignDept : reassignLoc;
    reassignMut.mutate(
      { id: item.id, data: { reassignTo: target } },
      {
        onSuccess: () => {
          invalidate(keyFor(kind));
          const delMut = kind === "department" ? deleteDept : deleteLoc;
          delMut.mutate(
            { id: item.id },
            {
              onSuccess: () => {
                toast({ title: `${labelFor(kind)} deleted` });
                invalidate(keyFor(kind));
                setReassignState(null);
              },
              onError: (err) =>
                toast({ title: errMessage(err, `Failed to delete ${kind}`), variant: "destructive" }),
            },
          );
        },
        onError: (err) =>
          toast({ title: errMessage(err, "Failed to reassign employees"), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
        <Link href="/employees">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Directory
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Departments &amp; Locations</h1>
        <p className="text-muted-foreground mt-1">
          Manage the canonical lists employees are assigned to.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrgSection
          title="Departments"
          singular="Department"
          icon={<Building2 className="h-5 w-5 text-primary" />}
          items={departments}
          isLoading={loadingDepts}
          isMutating={createDept.isPending || updateDept.isPending}
          onCreate={(name, done) =>
            createDept.mutate(
              { data: { name } },
              {
                onSuccess: () => {
                  toast({ title: "Department added" });
                  invalidate("/api/departments");
                  done();
                },
                onError: (err) =>
                  toast({ title: errMessage(err, "Failed to add department"), variant: "destructive" }),
              },
            )
          }
          onRename={(id, name, done) =>
            updateDept.mutate(
              { id, data: { name } },
              {
                onSuccess: () => {
                  toast({ title: "Department renamed" });
                  invalidate("/api/departments");
                  done();
                },
                onError: (err) =>
                  toast({ title: errMessage(err, "Failed to rename department"), variant: "destructive" }),
              },
            )
          }
          onDelete={(item) => requestDelete(item, "department")}
        />

        <OrgSection
          title="Locations"
          singular="Location"
          icon={<MapPin className="h-5 w-5 text-primary" />}
          items={locations}
          isLoading={loadingLocs}
          isMutating={createLoc.isPending || updateLoc.isPending}
          onCreate={(name, done) =>
            createLoc.mutate(
              { data: { name } },
              {
                onSuccess: () => {
                  toast({ title: "Location added" });
                  invalidate("/api/locations");
                  done();
                },
                onError: (err) =>
                  toast({ title: errMessage(err, "Failed to add location"), variant: "destructive" }),
              },
            )
          }
          onRename={(id, name, done) =>
            updateLoc.mutate(
              { id, data: { name } },
              {
                onSuccess: () => {
                  toast({ title: "Location renamed" });
                  invalidate("/api/locations");
                  done();
                },
                onError: (err) =>
                  toast({ title: errMessage(err, "Failed to rename location"), variant: "destructive" }),
              },
            )
          }
          onDelete={(item) => requestDelete(item, "location")}
        />
      </div>

      <Dialog open={reassignState !== null} onOpenChange={(open) => !open && setReassignState(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign employees before deleting</DialogTitle>
            <DialogDescription>
              {reassignState && (
                <>
                  <span className="font-medium text-foreground">{reassignState.item.name}</span> still has{" "}
                  {reassignState.item.employeeCount} employee(s). Choose where to move them, then it will be
                  deleted.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Move employees to</Label>
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger>
                <SelectValue placeholder="Select a destination" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No {reassignState?.kind ?? "assignment"} (leave blank)</SelectItem>
                {reassignOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id.toString()}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignState(null)} disabled={reassignPending}>
              Cancel
            </Button>
            <Button
              onClick={handleReassignAndDelete}
              disabled={reassignPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {reassignPending ? "Working..." : "Reassign & Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
