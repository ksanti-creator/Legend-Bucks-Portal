import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  useBulkInviteEmployees,
  useListEmployees,
  useListDepartments,
  useListLocations,
  useGetMe,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, Loader2, CheckCircle2, XCircle, FileSpreadsheet, RotateCcw } from "lucide-react";

const MAX_ROWS = 300;

const TEMPLATE_HEADERS = [
  "First Name",
  "Last Name",
  "Email",
  "Role",
  "Department",
  "Location",
  "Manager Email",
  "Yearly Award Budget",
  "Starting Balance",
];

const TEMPLATE_EXAMPLE = [
  "Jane",
  "Doe",
  "jane.doe@legendboats.com",
  "team_member",
  "Sales",
  "Head Office",
  "manager@legendboats.com",
  "",
  "",
];

// Accepts common spellings for each role.
const ROLE_ALIASES: Record<string, "admin" | "manager" | "team_member" | "accounting_admin"> = {
  admin: "admin",
  administrator: "admin",
  manager: "manager",
  team_member: "team_member",
  "team member": "team_member",
  teammember: "team_member",
  member: "team_member",
  employee: "team_member",
  accounting_admin: "accounting_admin",
  "accounting admin": "accounting_admin",
  accounting: "accounting_admin",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ParsedRow = {
  rowNumber: number; // 1-based spreadsheet row (excluding header)
  firstName: string;
  lastName: string;
  email: string;
  roleRaw: string;
  role: "admin" | "manager" | "team_member" | "accounting_admin" | null;
  departmentName: string;
  departmentId: number | null;
  locationName: string;
  locationId: number | null;
  managerEmail: string;
  managerId: number | null;
  awardBudgetYearly: number | null;
  startingBalance: number | null;
  errors: string[];
};

// Normalize a header cell to match template columns loosely.
function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z]/g, "");
}

const HEADER_MAP: Record<string, keyof typeof COLUMN_KEYS> = {};
const COLUMN_KEYS = {
  firstName: ["firstname", "first"],
  lastName: ["lastname", "last", "surname"],
  email: ["email", "emailaddress"],
  role: ["role"],
  department: ["department", "dept"],
  location: ["location", "office"],
  managerEmail: ["manageremail", "manager"],
  awardBudgetYearly: ["yearlyawardbudget", "awardbudget", "awardbudgetyearly", "budget"],
  startingBalance: ["startingbalance", "startingbucks", "initialbalance", "openingbalance"],
} as const;
for (const [key, aliases] of Object.entries(COLUMN_KEYS)) {
  for (const a of aliases) HEADER_MAP[a] = key as keyof typeof COLUMN_KEYS;
}

export default function BulkInviteUpload() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: me } = useGetMe();
  const { data: employees } = useListEmployees();
  const { data: departments } = useListDepartments();
  const { data: locations } = useListLocations();
  const bulkMut = useBulkInviteEmployees();

  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    invitedCount: number;
    skippedCount: number;
    failed: { email: string; rowNumber: number; error: string }[];
  } | null>(null);

  const isAdmin = me?.role === "admin";

  const downloadTemplate = () => {
    const csv =
      TEMPLATE_HEADERS.join(",") +
      "\n" +
      TEMPLATE_EXAMPLE.join(",") +
      "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "team-members-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseFile = async (file: File) => {
    setParseError(null);
    setResults(null);
    setRows(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("The file has no sheets");
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (raw.length === 0) {
        setParseError("The file has no data rows. Download the template to see the expected format.");
        return;
      }
      if (raw.length > MAX_ROWS) {
        setParseError(`Too many rows (${raw.length}). The maximum per upload is ${MAX_ROWS} — split the file and upload in parts.`);
        return;
      }

      // Map spreadsheet headers to our known columns.
      const getCell = (r: Record<string, unknown>, key: keyof typeof COLUMN_KEYS): string => {
        for (const h of Object.keys(r)) {
          if (HEADER_MAP[normHeader(h)] === key) return String(r[h] ?? "").trim();
        }
        return "";
      };

      const deptByName = new Map((departments ?? []).map((d) => [d.name.toLowerCase(), d.id]));
      const locByName = new Map((locations ?? []).map((l) => [l.name.toLowerCase(), l.id]));
      const employeeByEmail = new Map((employees ?? []).map((e) => [e.email.toLowerCase(), e]));
      const seen = new Set<string>();

      const parsed: ParsedRow[] = raw.map((r, i) => {
        const firstName = getCell(r, "firstName");
        const lastName = getCell(r, "lastName");
        const email = getCell(r, "email").toLowerCase();
        const roleRaw = getCell(r, "role");
        const departmentName = getCell(r, "department");
        const locationName = getCell(r, "location");
        const managerEmail = getCell(r, "managerEmail").toLowerCase();
        const budgetRaw = getCell(r, "awardBudgetYearly");
        const startingBalanceRaw = getCell(r, "startingBalance");

        const errors: string[] = [];
        if (firstName.length < 2) errors.push("First name required (min 2 characters)");
        if (lastName.length < 2) errors.push("Last name required (min 2 characters)");
        if (!EMAIL_RE.test(email)) errors.push("Invalid email address");
        else {
          if (seen.has(email)) errors.push("Duplicate email in this file");
          seen.add(email);
          if (employeeByEmail.has(email)) errors.push("Already in the system");
        }

        const role = ROLE_ALIASES[roleRaw.toLowerCase().trim()] ?? null;
        if (!role) errors.push(roleRaw ? `Unknown role "${roleRaw}"` : "Role required (admin, manager, or team_member)");

        let departmentId: number | null = null;
        if (departmentName) {
          departmentId = deptByName.get(departmentName.toLowerCase()) ?? null;
          if (departmentId === null) errors.push(`Unknown department "${departmentName}"`);
        }
        let locationId: number | null = null;
        if (locationName) {
          locationId = locByName.get(locationName.toLowerCase()) ?? null;
          if (locationId === null) errors.push(`Unknown location "${locationName}"`);
        }
        let managerId: number | null = null;
        if (managerEmail) {
          const mgr = employeeByEmail.get(managerEmail);
          if (!mgr) errors.push(`Manager "${managerEmail}" not found`);
          else if (mgr.role !== "manager" && mgr.role !== "admin") errors.push(`"${managerEmail}" is not a manager or admin`);
          else managerId = mgr.id;
        }

        let awardBudgetYearly: number | null = null;
        if (budgetRaw !== "") {
          const n = Number(budgetRaw);
          if (!Number.isInteger(n) || n < 1) errors.push(`Invalid yearly award budget "${budgetRaw}"`);
          else if (role && role !== "admin" && role !== "manager") errors.push("Only admins and managers can have an award budget");
          else awardBudgetYearly = n;
        }

        let startingBalance: number | null = null;
        if (startingBalanceRaw !== "") {
          const n = Number(startingBalanceRaw);
          if (!Number.isInteger(n) || n < 1) errors.push(`Invalid starting balance "${startingBalanceRaw}" — use a whole number of 1 or more, or leave the cell empty`);
          else startingBalance = n;
        }

        return {
          rowNumber: i + 2, // +1 header, +1 one-based
          firstName,
          lastName,
          email,
          roleRaw,
          role,
          departmentName,
          departmentId,
          locationName,
          locationId,
          managerEmail,
          managerId,
          awardBudgetYearly,
          startingBalance,
          errors,
        };
      });

      setRows(parsed);
    } catch (err: any) {
      setParseError(`Could not read the file: ${err?.message ?? "unknown error"}. Upload a .csv or .xlsx file.`);
    }
  };

  const validRows = (rows ?? []).filter((r) => r.errors.length === 0);
  const invalidRows = (rows ?? []).filter((r) => r.errors.length > 0);

  const submit = () => {
    if (validRows.length === 0) return;
    bulkMut.mutate(
      {
        data: {
          invites: validRows.map((r) => ({
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            role: r.role!,
            departmentId: r.departmentId,
            locationId: r.locationId,
            managerId: r.managerId,
            awardBudgetYearly: r.awardBudgetYearly,
            startingBalance: r.startingBalance,
          })),
        },
      },
      {
        onSuccess: (data) => {
          const failed = data.results
            .filter((res) => res.status === "skipped")
            .map((res) => ({
              email: res.email,
              rowNumber: validRows[res.index]?.rowNumber ?? res.index + 1,
              error: res.error ?? "Unknown error",
            }));
          setResults({ invitedCount: data.invitedCount, skippedCount: data.skippedCount, failed });
          setRows(null);
          queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
          toast({
            title: `${data.invitedCount} team member${data.invitedCount === 1 ? "" : "s"} invited`,
            description: data.skippedCount > 0 ? `${data.skippedCount} row(s) were skipped.` : "Invitation emails are on their way.",
          });
        },
        onError: () =>
          toast({
            title: "Bulk invite failed",
            description: "No invitations were sent. Please try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const reset = () => {
    setRows(null);
    setResults(null);
    setParseError(null);
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!isAdmin) {
    return (
      <Card className="border-none shadow-md">
        <CardContent className="p-8 text-center text-muted-foreground">
          Bulk upload is available to administrators only.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-md">
      <CardHeader className="border-b bg-muted/20">
        <CardTitle className="text-2xl font-display">Bulk Upload</CardTitle>
        <CardDescription>
          Add many team members at once from a CSV or Excel file. Each new member receives the normal
          invitation email.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Step 1: template + file picker */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            Download Template
          </Button>
          <Button onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Choose File
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parseFile(f);
            }}
          />
          {fileName && (
            <span className="inline-flex items-center text-sm text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              {fileName}
            </span>
          )}
        </div>

        {parseError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {parseError}
          </div>
        )}

        {/* Step 2: preview */}
        {rows && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{rows.length} rows</Badge>
              <Badge className="bg-green-600 hover:bg-green-600 text-white">{validRows.length} ready</Badge>
              {invalidRows.length > 0 && <Badge variant="destructive">{invalidRows.length} with problems</Badge>}
            </div>

            <div className="border rounded-md overflow-x-auto max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Row</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Dept / Location</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.rowNumber} className={r.errors.length ? "bg-destructive/5" : ""}>
                      <TableCell className="text-muted-foreground">{r.rowNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.firstName} {r.lastName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{r.email}</TableCell>
                      <TableCell>{r.role ?? r.roleRaw}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {[r.departmentName, r.locationName].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell>
                        {r.errors.length === 0 ? (
                          <span className="inline-flex items-center text-green-600 text-sm">
                            <CheckCircle2 className="h-4 w-4 mr-1" /> Ready
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            {r.errors.map((e, i) => (
                              <div key={i} className="inline-flex items-start text-destructive text-xs">
                                <XCircle className="h-3.5 w-3.5 mr-1 mt-px shrink-0" />
                                {e}
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t">
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Start Over
              </Button>
              <Button onClick={submit} disabled={validRows.length === 0 || bulkMut.isPending}>
                {bulkMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Invite {validRows.length} Member{validRows.length === 1 ? "" : "s"}
              </Button>
            </div>
            {invalidRows.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">
                Rows with problems will be skipped. Fix them in the file and re-upload if needed — already-invited
                members are never double-invited.
              </p>
            )}
          </div>
        )}

        {/* Step 3: results */}
        {results && (
          <div className="space-y-3">
            <div className="rounded-md border border-green-600/30 bg-green-600/5 p-4 text-sm">
              <span className="font-medium text-green-700">
                {results.invitedCount} team member{results.invitedCount === 1 ? "" : "s"} invited successfully.
              </span>{" "}
              {results.skippedCount > 0 && (
                <span className="text-muted-foreground">{results.skippedCount} row(s) skipped:</span>
              )}
            </div>
            {results.failed.length > 0 && (
              <ul className="text-sm space-y-1">
                {results.failed.map((f, i) => (
                  <li key={i} className="text-destructive">
                    Row {f.rowNumber} ({f.email}): {f.error}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" size="sm" onClick={reset}>
              Upload Another File
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
