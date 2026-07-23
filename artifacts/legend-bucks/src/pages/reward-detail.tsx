import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetReward, useGetMe, useCreateRedemption, getGetRewardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Gift, Coins, AlertCircle, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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

export default function RewardDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: user } = useGetMe();
  const { data: reward, isLoading } = useGetReward(id, { query: { queryKey: getGetRewardQueryKey(id), enabled: !!id } });
  const redeemMut = useCreateRedemption();
  const queryClient = useQueryClient();

  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);

  if (isLoading || !reward || !user) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const canAfford = (user.balance || 0) >= reward.buckCost;
  const isAvailable = reward.active && (reward.quantity == null || reward.quantity > 0);
  const canRedeem = canAfford && isAvailable;

  const handleRedeem = () => {
    redeemMut.mutate(
      { data: { rewardId: id, note: note || undefined } },
      {
        onSuccess: () => {
          setOpen(false);
          toast({
            title: "Reward Redeemed!",
            description: reward.approvalRequired 
              ? "Your request has been submitted for approval." 
              : "Your reward has been redeemed successfully.",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }); // Update balance
          setLocation("/dashboard");
        },
        onError: () => {
          toast({
            title: "Redemption failed",
            description: "There was an error processing your redemption.",
            variant: "destructive",
          });
        }
      }
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
        <Link href="/rewards">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Catalog
        </Link>
      </Button>

      <Card className="border-none shadow-md overflow-hidden bg-card">
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Photo gallery side */}
          <div className="border-r border-border">
            {(() => {
              const photos = reward.imageUrls?.length
                ? reward.imageUrls
                : reward.imageUrl
                  ? [reward.imageUrl]
                  : [];
              const fallback = fallbackImages[reward.category || ""];
              const current = Math.min(photoIndex, Math.max(photos.length - 1, 0));
              const mainSrc = photos[current] ?? fallback;
              return (
                <div className="flex h-full flex-col">
                  <div className="bg-muted aspect-square md:aspect-auto md:flex-1 flex items-center justify-center relative overflow-hidden">
                    {mainSrc ? (
                      <img src={mainSrc} alt={reward.name} className="object-cover w-full h-full" />
                    ) : (
                      <Gift className="h-24 w-24 text-muted-foreground/30" />
                    )}
                    {photos.length > 1 && (
                      <>
                        <button
                          type="button"
                          aria-label="Previous photo"
                          onClick={() => setPhotoIndex((current - 1 + photos.length) % photos.length)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 transition-colors"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Next photo"
                          onClick={() => setPhotoIndex((current + 1) % photos.length)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 transition-colors"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </button>
                        <span className="absolute bottom-2 right-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">
                          {current + 1} / {photos.length}
                        </span>
                      </>
                    )}
                  </div>
                  {photos.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto bg-card p-2">
                      {photos.map((url, i) => (
                        <button
                          key={`${url}-${i}`}
                          type="button"
                          aria-label={`Show photo ${i + 1}`}
                          onClick={() => setPhotoIndex(i)}
                          className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                            i === current ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"
                          }`}
                        >
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Details Side */}
          <div className="p-8 md:p-10 flex flex-col justify-center">
            {reward.category && (
              <Badge variant="outline" className="w-fit mb-4 text-xs tracking-wider uppercase">
                {reward.category}
              </Badge>
            )}
            
            <h1 className="text-3xl font-display font-bold mb-4">{reward.name}</h1>
            
            <div className="flex items-center text-primary font-bold text-2xl mb-6">
              <Coins className="h-6 w-6 mr-2" />
              {reward.buckCost.toLocaleString()} LB
            </div>

            <div className="prose prose-sm dark:prose-invert text-muted-foreground mb-8">
              <p>{reward.description}</p>
            </div>

            <div className="space-y-4 mb-8">
              {reward.quantity !== null && (
                <div className="flex justify-between py-2 border-b border-border/50 text-sm">
                  <span className="text-muted-foreground">Availability</span>
                  <span className="font-medium">{reward.quantity} remaining</span>
                </div>
              )}
              {reward.locationRestriction && (
                <div className="flex justify-between py-2 border-b border-border/50 text-sm">
                  <span className="text-muted-foreground">Location</span>
                  <span className="font-medium">{reward.locationRestriction}</span>
                </div>
              )}
              {reward.approvalRequired && (
                <div className="flex items-center gap-2 py-2 text-sm text-accent">
                  <AlertCircle className="h-4 w-4" />
                  <span>Requires manager approval</span>
                </div>
              )}
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button 
                  size="lg" 
                  className="w-full text-base font-semibold"
                  disabled={!canRedeem}
                >
                  {!isAvailable ? "Out of Stock" : 
                   !canAfford ? `Need ${(reward.buckCost - (user.balance || 0)).toLocaleString()} more LB` : 
                   "Redeem Now"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Redemption</DialogTitle>
                  <DialogDescription>
                    You are about to spend {reward.buckCost} LB on "{reward.name}".
                    Your new balance will be {((user.balance || 0) - reward.buckCost).toLocaleString()} LB.
                  </DialogDescription>
                </DialogHeader>
                
                <div className="my-4">
                  <label className="block text-sm font-medium mb-2">Note (Optional)</label>
                  <Textarea 
                    placeholder="E.g. Size Large, prefer black color" 
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Add any details needed for fulfillment (sizes, dates, etc.)
                  </p>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={handleRedeem} disabled={redeemMut.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    {redeemMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Confirm Purchase
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </Card>
    </div>
  );
}
