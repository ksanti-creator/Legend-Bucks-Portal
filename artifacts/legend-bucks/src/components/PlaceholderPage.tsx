import { Card, CardContent } from "@/components/ui/card";
import { HardHat } from "lucide-react";

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="h-[80vh] flex flex-col items-center justify-center text-center animate-in fade-in">
      <Card className="border-none shadow-none bg-transparent">
        <CardContent className="pt-6">
          <div className="inline-flex items-center justify-center p-4 bg-muted text-muted-foreground rounded-full mb-6">
            <HardHat className="h-12 w-12" />
          </div>
          <h1 className="text-3xl font-display font-bold mb-2">{title}</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            This module is currently under construction in the workshop. 
            Check back later for updates.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
