import DashboardLayout from "@/components/layouts/dashboard-layout";
import { initials } from "@/lib/format";
import { ROLE_LABEL, ROLE_VARIANT } from "@/lib/labels";
import { Avatar, AvatarFallback } from "@nilovon-wiki/ui/components/avatar";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Card } from "@nilovon-wiki/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nilovon-wiki/ui/components/table";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/members")({
  component: RouteComponent,
});

function RouteComponent() {
  const { auth } = Route.useRouteContext();
  const members = auth.organization.members;

  return (
    <DashboardLayout className="p-7">
      <div>
        <h1 className="text-lg font-semibold">Mitglieder &amp; Rechte</h1>
        <p className="text-sm text-muted-foreground">
          {members.length} {members.length === 1 ? "Mitglied" : "Mitglieder"} in{" "}
          {auth.organization.name}.
        </p>
      </div>

      <Card className="mt-4 overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead className="text-right">Rolle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-7">
                      <AvatarFallback className="text-[11px]">
                        {initials(member.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{member.user.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{member.user.email}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={ROLE_VARIANT[member.role] ?? "outline"}>
                    {ROLE_LABEL[member.role] ?? member.role}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </DashboardLayout>
  );
}
