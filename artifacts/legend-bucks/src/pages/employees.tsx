import { useState } from "react";
import { Link } from "wouter";
import { useListEmployees, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, UserPlus, MapPin, Briefcase, Users } from "lucide-react";
import { getInitials } from "@/lib/utils";

export default function Employees() {
  const { data: user } = useGetMe();
  const isAdminOrManager = user?.role === "admin" || user?.role === "manager";
  
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState<string>("all");
  const [status, setStatus] = useState<string>("active");

  // Since filtering by search text isn't explicitly supported by the API params hook,
  // we'll fetch list and filter locally for text, but pass department/status to API
  const apiParams = {
    ...(department !== "all" && { department }),
    ...(status !== "all" && { status }),
  };

  const { data: employees, isLoading } = useListEmployees(apiParams);

  const filteredEmployees = employees?.filter(emp => {
    if (search) {
      const q = search.toLowerCase();
      return emp.firstName.toLowerCase().includes(q) || 
             emp.lastName.toLowerCase().includes(q) || 
             emp.email.toLowerCase().includes(q);
    }
    return true;
  });

  // Extract unique departments for filter
  const departments = Array.from(new Set(employees?.map(e => e.department).filter(Boolean) as string[]));

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Team Directory</h1>
          <p className="text-muted-foreground mt-1">Find and recognize your colleagues.</p>
        </div>
        
        {isAdminOrManager && (
          <Button asChild className="shrink-0 bg-primary text-primary-foreground">
            <Link href="/employees/new">
              <UserPlus className="h-4 w-4 mr-2" />
              Invite Employee
            </Link>
          </Button>
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search team members..."
              className="pl-9 bg-muted/50 border-transparent focus-visible:bg-transparent"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          <div className="flex gap-4 w-full md:w-auto">
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="w-full md:w-[180px] bg-muted/50 border-transparent focus:bg-transparent">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(dept => (
                  <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full md:w-[150px] bg-muted/50 border-transparent focus:bg-transparent">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="invited">Invited</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3,4,5,6].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-muted" />
                <div className="space-y-2 flex-1">
                  <div className="h-5 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredEmployees?.length === 0 ? (
        <div className="text-center py-20 bg-muted/30 rounded-xl border border-dashed border-border">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-foreground mb-1">No employees found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEmployees?.map((emp) => (
            <Link key={emp.id} href={`/employees/${emp.id}`}>
              <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full group">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <Avatar className="h-16 w-16 border-2 border-primary/10 group-hover:border-primary/30 transition-colors">
                      <AvatarFallback className="bg-primary/5 text-primary text-lg font-display">
                        {getInitials(emp.firstName, emp.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <Badge variant={
                      emp.status === "active" ? "success" : 
                      emp.status === "invited" ? "warning" : "secondary"
                    } className="capitalize">
                      {emp.status}
                    </Badge>
                  </div>
                  
                  <div>
                    <h3 className="font-display font-semibold text-lg text-foreground group-hover:text-primary transition-colors">
                      {emp.firstName} {emp.lastName}
                    </h3>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1 capitalize">
                      <Briefcase className="h-3.5 w-3.5" />
                      {emp.role.replace('_', ' ')} {emp.department ? `· ${emp.department}` : ''}
                    </p>
                    {emp.location && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {emp.location}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
