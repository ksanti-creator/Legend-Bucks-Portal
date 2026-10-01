import { useState } from "react";
import { Link } from "wouter";
import { 
  useListRewards, 
  useCreateReward, 
  useUpdateReward, 
  useDeleteReward,
  useGetMe
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch"; // Need to generate this
import { MultiImageUpload } from "@/components/image-upload";
import { useI18n } from "@/lib/i18n";

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

const createRewardSchema = (t: (source: string) => string) => z.object({
  name: z.string().min(3, t("Name must be at least 3 characters")),
  description: z.string().optional(),
  category: z.string().optional(),
  buckCost: z.coerce.number({ invalid_type_error: t("Enter a valid number") }).min(1, t("Cost must be at least 1 LB")),
  // Blank input must map to null (not 0), so a missing CAD value stays unset.
  cadValue: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number({ invalid_type_error: t("Enter a valid number") }).min(0, t("Value cannot be negative")).nullable(),
  ),
  imageUrls: z.array(z.string()).default([]),
  sizes: z
    .array(
      z.object({
        label: z.string().min(1, t("Label required")).max(40, t("Label must be at most 40 characters")),
        quantity: z.number({ invalid_type_error: t("Enter a valid number") }).int(t("Enter a whole number")).min(0, t("Quantity cannot be negative")).nullable(),
      }),
    )
    .max(20, t("You can add up to 20 sizes"))
    .default([]),
  productCode: z.string().optional(),
  serialNumber: z.string().optional(),
  quantity: z.coerce.number({ invalid_type_error: t("Enter a valid number") }).optional().nullable(),
  locationRestriction: z.string().optional().nullable(),
  active: z.boolean().default(true),
  approvalRequired: z.boolean().default(false),
  isCustomGiftCard: z.boolean().default(false),
  giftCardIncrementLb: z.literal(100).nullable().default(100),
  giftCardMinimumLb: z.coerce.number({ invalid_type_error: t("Enter a valid number") }).int(t("Enter a whole number")).positive(t("Enter a positive amount")).nullable().default(100),
  giftCardMaximumLb: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number({ invalid_type_error: t("Enter a valid number") }).int(t("Enter a whole number")).positive(t("Enter a positive amount")).nullable(),
  ),
});
type RewardValues = z.infer<ReturnType<typeof createRewardSchema>>;

// Explicit blank form values. react-hook-form's reset(values) replaces the
// stored defaults, so a bare reset() after editing would re-fill the last
// edited reward — always reset to these instead.
const emptyRewardValues: RewardValues = {
  name: "",
  description: "",
  category: "",
  buckCost: 100,
  cadValue: null,
  imageUrls: [],
  sizes: [],
  productCode: "",
  serialNumber: "",
  quantity: null,
  locationRestriction: "",
  active: true,
  approvalRequired: false,
  isCustomGiftCard: false,
  giftCardIncrementLb: 100,
  giftCardMinimumLb: 100,
  giftCardMaximumLb: null,
};

export default function ManageRewards() {
  const { t, number, currency, label } = useI18n();
  const rewardSchema = createRewardSchema(t);
  const { data: user } = useGetMe();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [openCreate, setOpenCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  const { data: rewards, isLoading } = useListRewards();
  
  const createMut = useCreateReward();
  const updateMut = useUpdateReward();
  const deleteMut = useDeleteReward();

  const form = useForm<RewardValues>({
    resolver: zodResolver(rewardSchema),
    defaultValues: emptyRewardValues,
  });
  const isCustomGiftCard = form.watch("isCustomGiftCard");

  if (!isAdmin && user) {
    return <div className="p-8 text-center text-destructive">{t("Unauthorized. Admins only.")}</div>;
  }

  const onSubmit = (data: RewardValues) => {
    // Transform empty strings to null for optional API fields.
    // CAD value is entered in dollars but stored as integer cents.
    const { cadValue, ...rest } = data;
    const payload = {
      ...rest,
      category: data.isCustomGiftCard ? "Gift Card" : data.category,
      buckCost: data.isCustomGiftCard ? 100 : data.buckCost,
      sizes: (data.sizes ?? []).map((s) => ({ label: s.label.trim(), quantity: s.quantity })),
      quantity: data.isCustomGiftCard || data.quantity === 0 || isNaN(data.quantity as any) ? null : data.quantity,
      locationRestriction: data.locationRestriction === "" ? null : data.locationRestriction,
      productCode: data.productCode?.trim() ? data.productCode.trim() : null,
      serialNumber: data.serialNumber?.trim() ? data.serialNumber.trim() : null,
      cadValueCents:
        data.isCustomGiftCard || cadValue === null || cadValue === undefined || isNaN(cadValue as any)
          ? null
          : Math.round(cadValue * 100),
    };

    if (editingId) {
      updateMut.mutate(
        { id: editingId, data: payload },
        {
          onSuccess: () => {
            setOpenCreate(false);
            setEditingId(null);
            toast({ title: t("Reward updated successfully") });
            queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
            form.reset(emptyRewardValues);
          },
          onError: () => toast({ title: t("Failed to update reward"), variant: "destructive" })
        }
      );
    } else {
      createMut.mutate(
        { data: payload },
        {
          onSuccess: () => {
            setOpenCreate(false);
            toast({ title: t("Reward created successfully") });
            queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
            form.reset(emptyRewardValues);
          },
          onError: () => toast({ title: t("Failed to create reward"), variant: "destructive" })
        }
      );
    }
  };

  const handleEdit = (reward: any) => {
    form.reset({
      name: reward.name,
      description: reward.description || "",
      category: reward.category || "",
      buckCost: reward.buckCost,
      cadValue: reward.cadValueCents != null ? reward.cadValueCents / 100 : null,
      imageUrls: reward.imageUrls?.length ? reward.imageUrls : reward.imageUrl ? [reward.imageUrl] : [],
      sizes: reward.sizes ?? [],
      productCode: reward.productCode || "",
      serialNumber: reward.serialNumber || "",
      quantity: reward.quantity,
      locationRestriction: reward.locationRestriction || "",
      active: reward.active,
      approvalRequired: reward.approvalRequired,
      isCustomGiftCard: reward.isCustomGiftCard ?? false,
      giftCardIncrementLb: 100,
      giftCardMinimumLb: reward.giftCardMinimumLb ?? 100,
      giftCardMaximumLb: reward.giftCardMaximumLb ?? null,
    });
    setEditingId(reward.id);
    setOpenCreate(true);
  };

  const handleDelete = (id: number) => {
    if (confirm(t("Are you sure you want to delete this reward? This cannot be undone."))) {
      deleteMut.mutate({ id }, {
        onSuccess: () => {
          toast({ title: t("Reward deleted") });
          queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
        },
        onError: () => toast({ title: t("Failed to delete reward"), variant: "destructive" })
      });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
        <Link href="/rewards">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("Back to Catalog")}
        </Link>
      </Button>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">{t("Manage Catalog")}</h1>
          <p className="text-muted-foreground mt-1">{t("Add, edit, or remove rewards from the catalog.")}</p>
        </div>
        
        <Dialog open={openCreate} onOpenChange={(open) => {
          setOpenCreate(open);
          if (!open) {
            setEditingId(null);
            form.reset(emptyRewardValues);
          }
        }}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="h-4 w-4 mr-2" />
              {t("New Reward")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? t("Edit Reward") : t("Add New Reward")}</DialogTitle>
              <DialogDescription>
                {t("Configure item details, cost, and availability.")}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="col-span-2 md:col-span-1">
                        <FormLabel>{t("Reward Name")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("e.g. Legend Hoodie")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {!isCustomGiftCard && <FormField
                    control={form.control}
                    name="buckCost"
                    render={({ field }) => (
                      <FormItem className="col-span-2 md:col-span-1">
                        <FormLabel>{t("Cost (LB)")}</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />}
                </div>

                {!isCustomGiftCard && <FormField
                  control={form.control}
                  name="cadValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("CAD Value ($) — Accounting only")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={t("e.g. {amount}", { amount: number(49.99, { minimumFractionDigits: 2 }) })}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormDescription>
                        {t("The real dollar cost of this reward. Visible only to admins on accounting ledgers — never shown to employees.")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />}

                <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                  <FormField
                    control={form.control}
                    name="isCustomGiftCard"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between space-y-0">
                        <div>
                          <FormLabel>{t("Custom denomination")}</FormLabel>
                          <FormDescription>{t("Legend Bucks Gift Card · {bucks} LB = {value}", { bucks: number(100), value: currency(10) })}</FormDescription>
                        </div>
                        <Switch
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (checked) {
                              if (!form.getValues("name").trim()) form.setValue("name", "Legend Bucks Gift Card");
                              form.setValue("category", "Gift Card");
                              form.setValue("approvalRequired", true);
                              form.setValue("quantity", null);
                            }
                          }}
                        />
                      </FormItem>
                    )}
                  />
                  {isCustomGiftCard && (
                    <div className="grid grid-cols-3 gap-3">
                       <FormField control={form.control} name="giftCardIncrementLb" render={({ field }) => (
                         <FormItem><FormLabel>{t("LB increment")}</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? 100} disabled /></FormControl><FormDescription>{t("Fixed for Legend Bucks gift cards")}</FormDescription><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="giftCardMinimumLb" render={({ field }) => (
                        <FormItem><FormLabel>{t("Minimum LB")}</FormLabel><FormControl><Input type="number" min="1" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="giftCardMaximumLb" render={({ field }) => (
                        <FormItem><FormLabel>{t("Maximum LB")}</FormLabel><FormControl><Input type="number" min="1" placeholder={t("Balance limit")} {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                  )}
                </div>

                <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">{t("Product Identifiers — Admin only")}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t("Optional internal tracking details. Visible only to admins — never shown to employees.")}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="productCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("Product Code (Optional)")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("e.g. SKU-12345")} {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="serialNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("Serial Number (Optional)")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("e.g. SN-000123")} {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Description")}</FormLabel>
                      <FormControl>
                        <Textarea placeholder={t("Item details...")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Category")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={isCustomGiftCard}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("Select category")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Gear">{t("Gear")}</SelectItem>
                            <SelectItem value="Experience">{t("Experience")}</SelectItem>
                            <SelectItem value="Time Off">{t("Time Off")}</SelectItem>
                            <SelectItem value="Gift Card">{t("Gift Card")}</SelectItem>
                            <SelectItem value="Other">{t("Other")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                </div>

                <FormField
                  control={form.control}
                  name="imageUrls"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Photos (Optional)")}</FormLabel>
                      <FormControl>
                        <MultiImageUpload
                          value={field.value ?? []}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!isCustomGiftCard && <FormField
                  control={form.control}
                  name="sizes"
                  render={({ field }) => {
                    const sizes = field.value ?? [];
                    const setSize = (i: number, patch: Partial<{ label: string; quantity: number | null }>) => {
                      field.onChange(sizes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
                    };
                    return (
                      <FormItem>
                        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <FormLabel>{t("Sizes (Optional)")}</FormLabel>
                              <p className="text-xs text-muted-foreground mt-1">
                                {t("For sized items (shirts, boots...). Employees must pick a size; stock is tracked per size and the pooled quantity below is ignored.")}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={sizes.length >= 20}
                              onClick={() => field.onChange([...sizes, { label: "", quantity: null }])}
                            >
                              <Plus className="h-4 w-4 mr-1" /> {t("Add Size")}
                            </Button>
                          </div>
                          {sizes.length > 0 && (
                            <div className="space-y-2">
                              {sizes.map((s, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <Input
                                    placeholder={t("Label (e.g. M)")}
                                    aria-label={t("Label (e.g. M)")}
                                    value={s.label}
                                    onChange={(e) => setSize(i, { label: e.target.value })}
                                    className="flex-1"
                                  />
                                  <Input
                                    type="number"
                                    min="0"
                                    placeholder={t("Unlimited")}
                                    value={s.quantity ?? ""}
                                    onChange={(e) =>
                                      setSize(i, { quantity: e.target.value === "" ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })
                                    }
                                    className="w-32"
                                    aria-label={t("Stock for size {size}", { size: s.label || number(i + 1) })}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t("Remove size")}
                                    onClick={() => field.onChange(sizes.filter((_, idx) => idx !== i))}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              ))}
                              <p className="text-[11px] text-muted-foreground">{t("Leave stock blank for unlimited. Sizes show in this order.")}</p>
                            </div>
                          )}
                        </div>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />}

                <div className="grid grid-cols-2 gap-4">
                  {!isCustomGiftCard && <FormField
                    control={form.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Inventory Quantity (Leave blank for unlimited)")}</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />}
                  
                  <FormField
                    control={form.control}
                    name="locationRestriction"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Location Restriction (Optional)")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("e.g. Plant 1 Only")} {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex gap-6 py-4 border-y border-border">
                  <FormField
                    control={form.control}
                    name="active"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2 space-y-0">
                        <FormControl>
                          <input 
                            type="checkbox" 
                            className="h-4 w-4"
                            checked={field.value} 
                            onChange={field.onChange} 
                          />
                        </FormControl>
                        <FormLabel className="cursor-pointer">{t("Active in Catalog")}</FormLabel>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="approvalRequired"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2 space-y-0">
                        <FormControl>
                          <input 
                            type="checkbox" 
                            className="h-4 w-4"
                            checked={field.value} 
                            onChange={field.onChange} 
                          />
                        </FormControl>
                        <FormLabel className="cursor-pointer">{t("Requires Admin Approval")}</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>

                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => setOpenCreate(false)}>{t("Cancel")}</Button>
                  <Button type="submit" disabled={createMut.isPending || updateMut.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    {(createMut.isPending || updateMut.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingId ? t("Save Changes") : t("Create Reward")}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>{t("Reward")}</TableHead>
                <TableHead>{t("Category")}</TableHead>
                <TableHead>{t("Cost")}</TableHead>
                <TableHead>{t("CAD Value")}</TableHead>
                <TableHead>{t("Inventory")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead className="text-right">{t("Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t("Loading catalog...")}</TableCell>
                </TableRow>
              ) : rewards?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t("Catalog is empty.")}</TableCell>
                </TableRow>
              ) : (
                rewards?.map((reward) => (
                  <TableRow key={reward.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        {reward.imageUrl || fallbackImages[reward.category || ""] ? (
                          <img src={reward.imageUrl || fallbackImages[reward.category || ""]} alt="" className="w-10 h-10 rounded object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs">{t("No Img")}</div>
                        )}
                        <div>
                          {reward.name}
                           {reward.approvalRequired && <Badge variant="outline" className="ml-2 text-[10px] uppercase">{t("Approval Req")}</Badge>}
                           {reward.isCustomGiftCard && <Badge className="ml-2 text-[10px] uppercase">{t("Custom Value")}</Badge>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{reward.category && label(reward.category)}</TableCell>
                     <TableCell className="font-bold text-primary">
                       {reward.isCustomGiftCard ? t("Custom · {amount} LB increments", { amount: number(reward.giftCardIncrementLb ?? 100) }) : t("{amount} LB", { amount: number(reward.buckCost) })}
                     </TableCell>
                    <TableCell className="text-muted-foreground">
                      {reward.cadValueCents != null ? currency(reward.cadValueCents / 100) : '—'}
                    </TableCell>
                    <TableCell>
                      {reward.sizes && reward.sizes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {reward.sizes.map((s) => (
                            <Badge
                              key={s.label}
                              variant={s.quantity === 0 ? "destructive" : "outline"}
                              className="text-[10px]"
                            >
                              {s.label}: {s.quantity === null ? "∞" : number(s.quantity)}
                            </Badge>
                          ))}
                        </div>
                      ) : reward.quantity !== null ? (
                        reward.quantity !== undefined ? number(reward.quantity) : null
                      ) : (
                        t("Unlimited")
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={reward.active ? "success" : "secondary"}>
                        {reward.active ? t("Active") : t("Inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button aria-label={t("Edit {name}", { name: reward.name })} variant="ghost" size="icon" onClick={() => handleEdit(reward)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button aria-label={t("Delete {name}", { name: reward.name })} variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(reward.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
