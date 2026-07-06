import { useState } from "react";
import { Link } from "wouter";
import { useListRewards, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Gift, Coins, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

import giftCardImg from "@assets/generated_images/gift-card.png";
import ptoImg from "@assets/generated_images/pto.png";
import brandedGearImg from "@assets/generated_images/branded-gear.png";
import experienceImg from "@assets/generated_images/experience.png";
import lunchImg from "@assets/generated_images/lunch.png";

const fallbackImages: Record<string, string> = {
  "Gift Card": giftCardImg,
  "Time Off": ptoImg,
  "Gear": brandedGearImg,
  "Experience": experienceImg,
  "Lunch": lunchImg,
};

export default function Rewards() {
  const { data: user } = useGetMe();
  const [category, setCategory] = useState<string>("all");
  
  const { data: rewards, isLoading } = useListRewards({ active: true });

  const categories = Array.from(new Set(rewards?.map(r => r.category).filter(Boolean) as string[]));

  const filteredRewards = rewards?.filter(r => category === "all" || r.category === category);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Rewards Catalog</h1>
          <p className="text-muted-foreground mt-1">Redeem your Legend Bucks for gear, time off, and more.</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="bg-primary/10 text-primary px-4 py-2 rounded-lg font-bold font-display shadow-inner">
            <span className="text-sm font-sans font-medium opacity-80 mr-2 uppercase tracking-wide">Balance:</span> 
            {user?.balance?.toLocaleString()} LB
          </div>
          
          {user?.role === "admin" && (
            <Button variant="outline" asChild>
              <Link href="/rewards/manage">
                <Settings className="h-4 w-4 mr-2" />
                Manage Catalog
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="border-b pb-4">
        <Tabs value={category} onValueChange={setCategory} className="w-full">
          <TabsList className="bg-transparent p-0 gap-2 overflow-x-auto flex-nowrap w-full justify-start h-auto border-none">
            <TabsTrigger 
              value="all" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full px-4 py-2 border bg-muted/50"
            >
              All Rewards
            </TabsTrigger>
            {categories.map(cat => (
              <TabsTrigger 
                key={cat} 
                value={cat}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full px-4 py-2 border bg-muted/50 capitalize"
              >
                {cat}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1,2,3,4,5,6,7,8].map(i => (
            <Card key={i} className="overflow-hidden border-none shadow-sm">
              <Skeleton className="h-48 w-full rounded-none" />
              <CardContent className="p-5 space-y-3">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
              <CardFooter className="p-5 pt-0">
                <Skeleton className="h-10 w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : filteredRewards?.length === 0 ? (
        <div className="text-center py-20 bg-muted/20 rounded-xl border border-dashed">
          <Gift className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-foreground mb-1">No rewards found</h3>
          <p className="text-muted-foreground">Check back later for new items.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredRewards?.map(reward => (
            <Link key={reward.id} href={`/rewards/${reward.id}`}>
              <Card className="h-full flex flex-col overflow-hidden border-none shadow-sm hover:shadow-md transition-all group cursor-pointer bg-card">
                <div className="aspect-[4/3] bg-muted relative overflow-hidden flex items-center justify-center">
                  {reward.imageUrl || fallbackImages[reward.category || ""] ? (
                    <img 
                      src={reward.imageUrl || fallbackImages[reward.category || ""]} 
                      alt={reward.name} 
                      className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <Gift className="h-16 w-16 text-muted-foreground/30" />
                  )}
                  {reward.quantity !== null && reward.quantity <= 5 && (
                    <Badge variant="destructive" className="absolute top-3 right-3 shadow-sm">
                      Only {reward.quantity} left
                    </Badge>
                  )}
                </div>
                
                <CardContent className="p-5 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <h3 className="font-display font-semibold text-lg leading-tight group-hover:text-primary transition-colors">
                      {reward.name}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4 flex-1">
                    {reward.description}
                  </p>
                  
                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-border/50">
                    <div className="flex items-center text-primary font-bold font-display">
                      <Coins className="h-4 w-4 mr-1.5" />
                      {reward.buckCost.toLocaleString()} LB
                    </div>
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
