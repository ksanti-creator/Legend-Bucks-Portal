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
import { ImageUpload } from "@/components/image-upload";

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

const rewardSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  description: z.string().optional(),
  category: z.string().optional(),
  buckCost: z.coerce.number().min(1, "Cost must be at least 1 LB"),
  // Blank input must map to null (not 0), so a missing CAD value stays unset.
  cadValue: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().min(0, "Value cannot be negative").nullable(),
  ),
  imageUrl: z.string().optional(),
  productCode: z.string().optional(),
  serialNumber: z.string().optional(),
  quantity: z.coerce.number().optional().nullable(),
  locationRestriction: z.string().optional().nullable(),
  active: z.boolean().default(true),
  approvalRequired: z.boolean().default(false),
});

export default function ManageRewards() {
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

  const form = useForm<z.infer<typeof rewardSchema>>({
    resolver: zodResolver(rewardSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      buckCost: 100,
      cadValue: null,
      imageUrl: "",
      productCode: "",
      serialNumber: "",
      quantity: null,
      locationRestriction: "",
      active: true,
      approvalRequired: false,
    },
  });

  if (!isAdmin && user) {
    return <div className="p-8 text-center text-destructive">Unauthorized. Admins only.</div>;
  }

  const onSubmit = (data: z.infer<typeof rewardSchema>) => {
    // Transform empty strings to null for optional API fields.
    // CAD value is entered in dollars but stored as integer cents.
    const { cadValue, ...rest } = data;
    const payload = {
      ...rest,
      quantity: data.quantity === 0 || isNaN(data.quantity as any) ? null : data.quantity,
      locationRestriction: data.locationRestriction === "" ? null : data.locationRestriction,
      productCode: data.productCode?.trim() ? data.productCode.trim() : null,
      serialNumber: data.serialNumber?.trim() ? data.serialNumber.trim() : null,
      cadValueCents:
        cadValue === null || cadValue === undefined || isNaN(cadValue as any)
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
            toast({ title: "Reward updated successfully" });
            queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
            form.reset();
          },
          onError: () => toast({ title: "Failed to update reward", variant: "destructive" })
        }
      );
    } else {
      createMut.mutate(
        { data: payload },
        {
          onSuccess: () => {
            setOpenCreate(false);
            toast({ title: "Reward created successfully" });
            queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
            form.reset();
          },
          onError: () => toast({ title: "Failed to create reward", variant: "destructive" })
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
      imageUrl: reward.imageUrl || "",
      productCode: reward.productCode || "",
      serialNumber: reward.serialNumber || "",
      quantity: reward.quantity,
      locationRestriction: reward.locationRestriction || "",
      active: reward.active,
      approvalRequired: reward.approvalRequired,
    });
    setEditingId(reward.id);
    setOpenCreate(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this reward? This cannot be undone.")) {
      deleteMut.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Reward deleted" });
          queryClient.invalidateQueries({ queryKey: ["/api/rewards"] });
        },
        onError: () => toast({ title: "Failed to delete reward", variant: "destructive" })
      });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
        <Link href="/rewards">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Catalog
        </Link>
      </Button>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Manage Catalog</h1>
          <p className="text-muted-foreground mt-1">Add, edit, or remove rewards from the catalog.</p>
        </div>
        
        <Dialog open={openCreate} onOpenChange={(open) => {
          setOpenCreate(open);
          if (!open) {
            setEditingId(null);
            form.reset();
          }
        }}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="h-4 w-4 mr-2" />
              New Reward
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Reward" : "Add New Reward"}</DialogTitle>
              <DialogDescription>
                Configure item details, cost, and availability.
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
                        <FormLabel>Reward Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Legend Hoodie" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="buckCost"
                    render={({ field }) => (
                      <FormItem className="col-span-2 md:col-span-1">
                        <FormLabel>Cost (LB)</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="cadValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CAD Value ($) — Accounting only</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="e.g. 49.99"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormDescription>
                        The real dollar cost of this reward. Visible only to admins on accounting ledgers — never shown to employees.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">Product Identifiers — Admin only</h3>
                    <p className="text-xs text-muted-foreground">
                      Optional internal tracking details. Visible only to admins — never shown to employees.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="productCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Product Code (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. SKU-12345" {...field} value={field.value ?? ""} />
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
                          <FormLabel>Serial Number (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. SN-000123" {...field} value={field.value ?? ""} />
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
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Item details..." {...field} />
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
                        <FormLabel>Category</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Gear">Gear</SelectItem>
                            <SelectItem value="Experience">Experience</SelectItem>
                            <SelectItem value="Time Off">Time Off</SelectItem>
                            <SelectItem value="Gift Card">Gift Card</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="imageUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Image (Optional)</FormLabel>
                        <FormControl>
                          <ImageUpload
                            value={field.value}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Inventory Quantity (Leave blank for unlimited)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="locationRestriction"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location Restriction (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Plant 1 Only" {...field} value={field.value || ""} />
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
                        <FormLabel className="cursor-pointer">Active in Catalog</FormLabel>
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
                        <FormLabel className="cursor-pointer">Requires Admin Approval</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>

                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => setOpenCreate(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMut.isPending || updateMut.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    {(createMut.isPending || updateMut.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingId ? "Save Changes" : "Create Reward"}
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
                <TableHead>Reward</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>CAD Value</TableHead>
                <TableHead>Inventory</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading catalog...</TableCell>
                </TableRow>
              ) : rewards?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Catalog is empty.</TableCell>
                </TableRow>
              ) : (
                rewards?.map((reward) => (
                  <TableRow key={reward.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        {reward.imageUrl || fallbackImages[reward.category || ""] ? (
                          <img src={reward.imageUrl || fallbackImages[reward.category || ""]} alt="" className="w-10 h-10 rounded object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs">No Img</div>
                        )}
                        <div>
                          {reward.name}
                          {reward.approvalRequired && <Badge variant="outline" className="ml-2 text-[10px] uppercase">Approval Req</Badge>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{reward.category}</TableCell>
                    <TableCell className="font-bold text-primary">{reward.buckCost} LB</TableCell>
                    <TableCell className="text-muted-foreground">
                      {reward.cadValueCents != null ? `${(reward.cadValueCents / 100).toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell>{reward.quantity !== null ? reward.quantity : 'Unlimited'}</TableCell>
                    <TableCell>
                      <Badge variant={reward.active ? "success" : "secondary"}>
                        {reward.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(reward)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(reward.id)}>
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
