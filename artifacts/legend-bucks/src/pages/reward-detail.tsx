import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetReward, useGetMe, useCreateRedemption, getGetRewardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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

import giftCardImg from "@assets/Untitled_design_(70)_1788380591097.png";
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
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [giftCardAmount, setGiftCardAmount] = useState(100);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");

  if (isLoading || !reward || !user) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const sizes = reward.sizes ?? [];
  const isSized = sizes.length > 0;
  const chosenCost = reward.isCustomGiftCard ? giftCardAmount : reward.buckCost;
  const increment = reward.giftCardIncrementLb ?? 100;
  const minimum = reward.giftCardMinimumLb ?? 100;
  const customAmountValid = Number.isInteger(giftCardAmount) && giftCardAmount > 0 &&
    giftCardAmount >= minimum && giftCardAmount % increment === 0 &&
    (reward.giftCardMaximumLb == null || giftCardAmount <= reward.giftCardMaximumLb);
  const canAfford = (user.balance || 0) >= chosenCost;
  const isAvailable =
    reward.active &&
    (isSized
      ? sizes.some((s) => s.quantity === null || s.quantity > 0)
      : reward.quantity == null || reward.quantity > 0);
  const canRedeem = isAvailable && (reward.isCustomGiftCard || canAfford);
  const needsSize = isSized && !selectedSize;

  const handleRedeem = () => {
    redeemMut.mutate(
      { data: {
        rewardId: id,
        note: note || undefined,
        ...(isSized && selectedSize ? { sizeLabel: selectedSize } : {}),
        ...(reward.isCustomGiftCard ? {
          giftCardLbAmount: giftCardAmount,
          giftCardRecipientName: recipientName.trim(),
          giftCardRecipientEmail: recipientEmail.trim(),
        } : {}),
      } },
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
        onError: (err: any) => {
          toast({
            title: "Redemption failed",
            description:
              err?.response?.data?.error || "There was an error processing your redemption.",
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
              <div className="flex gap-2 mb-4">
                <Badge variant="outline" className="w-fit text-xs tracking-wider uppercase">{reward.category}</Badge>
                {reward.isCustomGiftCard && <Badge className="text-xs uppercase">Custom Value</Badge>}
              </div>
            )}
            
            <h1 className="text-3xl font-display font-bold mb-4">{reward.name}</h1>
            
            <div className="flex items-center text-primary font-bold text-2xl mb-6">
              <Coins className="h-6 w-6 mr-2" />
              {reward.isCustomGiftCard ? "Custom amount · 100 LB = $10" : `${reward.buckCost.toLocaleString()} LB`}
            </div>

            <div className="prose prose-sm dark:prose-invert text-muted-foreground mb-8">
              <p>{reward.description}</p>
            </div>

            <div className="space-y-4 mb-8">
              {isSized && (
                <div className="py-2 border-b border-border/50 text-sm">
                  <div className="text-muted-foreground mb-2">Sizes</div>
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((s) => {
                      const out = s.quantity === 0;
                      const low = s.quantity !== null && s.quantity > 0 && s.quantity <= 5;
                      return (
                        <span
                          key={s.label}
                          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
                            out ? "opacity-50 line-through" : ""
                          }`}
                        >
                          {s.label}
                          {out ? (
                            <span className="no-underline text-muted-foreground">(sold out)</span>
                          ) : low ? (
                            <span className="text-destructive">({s.quantity} left)</span>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {!isSized && reward.quantity !== null && (
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
                   !reward.isCustomGiftCard && !canAfford ? `Need ${(reward.buckCost - (user.balance || 0)).toLocaleString()} more LB` :
                   "Redeem Now"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Redemption</DialogTitle>
                  <DialogDescription>
                    {reward.isCustomGiftCard
                      ? `Choose how many Legend Bucks to convert. Available balance: ${(user.balance || 0).toLocaleString()} LB.`
                      : <>You are about to spend {reward.buckCost} LB on "{reward.name}".
                        Your new balance will be {((user.balance || 0) - reward.buckCost).toLocaleString()} LB.</>}
                  </DialogDescription>
                </DialogHeader>

                {reward.isCustomGiftCard && (
                  <div className="space-y-4 my-3">
                    <div>
                      <label className="block text-sm font-medium mb-2">Legend Bucks to convert</label>
                      <Input type="number" min={minimum} step={increment} value={giftCardAmount}
                        onChange={(e) => setGiftCardAmount(Number(e.target.value))} />
                      <p className="mt-2 text-sm font-medium text-primary">
                        {Number.isFinite(giftCardAmount) ? `${giftCardAmount.toLocaleString()} LB = $${(giftCardAmount / 10).toFixed(2)} CAD` : "Enter an amount"}
                      </p>
                      {!customAmountValid && <p className="text-xs text-destructive">Use a whole multiple of {increment} LB, at least {minimum} LB{reward.giftCardMaximumLb ? ` and no more than ${reward.giftCardMaximumLb} LB` : ""}.</p>}
                      {customAmountValid && !canAfford && <p className="text-xs text-destructive">Amount exceeds your available balance.</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-sm font-medium mb-2">Recipient name</label><Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} /></div>
                      <div><label className="block text-sm font-medium mb-2">Recipient email</label><Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} /></div>
                    </div>
                    <p className="text-xs text-muted-foreground">Gift cards are issued after approval and cannot be exchanged for cash.</p>
                  </div>
                )}
                
                {isSized && (
                  <div className="my-4">
                    <label className="block text-sm font-medium mb-2">Pick a size</label>
                    <div className="flex flex-wrap gap-2">
                      {sizes.map((s) => {
                        const out = s.quantity === 0;
                        const selected = selectedSize === s.label;
                        return (
                          <button
                            key={s.label}
                            type="button"
                            disabled={out}
                            onClick={() => setSelectedSize(s.label)}
                            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : out
                                  ? "opacity-40 line-through cursor-not-allowed"
                                  : "hover:border-primary"
                            }`}
                          >
                            {s.label}
                            {!out && s.quantity !== null && s.quantity <= 5 && (
                              <span className={`ml-1 text-xs ${selected ? "" : "text-destructive"}`}>({s.quantity} left)</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {needsSize && (
                      <p className="text-xs text-muted-foreground mt-2">Select a size to continue.</p>
                    )}
                  </div>
                )}

                {!reward.isCustomGiftCard && <div className="my-4">
                  <label className="block text-sm font-medium mb-2">Note (Optional)</label>
                  <Textarea 
                    placeholder="E.g. Size Large, prefer black color" 
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Add any details needed for fulfillment (sizes, dates, etc.)
                  </p>
                </div>}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={handleRedeem} disabled={redeemMut.isPending || needsSize || (reward.isCustomGiftCard && (!customAmountValid || !canAfford || !recipientName.trim() || !recipientEmail.trim()))} className="bg-primary hover:bg-primary/90 text-primary-foreground">
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
