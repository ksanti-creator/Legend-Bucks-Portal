import { useRef, useState } from "react";
import { useRequestUploadUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, X, ImageIcon, ArrowLeft, ArrowRight } from "lucide-react";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PHOTOS = 6;

interface ImageUploadProps {
  value?: string | null;
  onChange: (url: string) => void;
  disabled?: boolean;
}

export function ImageUpload({ value, onChange, disabled }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const requestUrl = useRequestUploadUrl();

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Unsupported file",
        description: "Please choose an image file.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({
        title: "File too large",
        description: "Images must be 5 MB or smaller.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      // 1. Ask the API server for a presigned upload URL.
      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });

      // 2. Upload the bytes straight to storage (not through our API).
      const put = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) {
        throw new Error(`Upload failed (${put.status})`);
      }

      // 3. Store the path our server serves the image from.
      onChange(`/api/storage${objectPath}`);
    } catch (err) {
      toast({
        title: "Upload failed",
        description:
          err instanceof Error ? err.message : "Could not upload the image.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {value ? (
            <img
              src={value}
              alt="Reward"
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {value ? "Replace image" : "Upload image"}
            </Button>
            {value && !uploading && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onChange("")}
              >
                <X className="mr-1 h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">PNG or JPG, up to 5 MB.</p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}

interface MultiImageUploadProps {
  value: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}

/**
 * Upload up to MAX_PHOTOS images. The first photo is the cover image shown on
 * catalog cards; photos can be reordered with the arrow buttons.
 */
export function MultiImageUpload({ value, onChange, disabled }: MultiImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const requestUrl = useRequestUploadUrl();

  const photos = value ?? [];
  const atCap = photos.length >= MAX_PHOTOS;

  async function uploadOne(file: File): Promise<string | null> {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Unsupported file", description: `${file.name} is not an image.`, variant: "destructive" });
      return null;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: `${file.name} is over 5 MB.`, variant: "destructive" });
      return null;
    }
    const { uploadURL, objectPath } = await requestUrl.mutateAsync({
      data: { name: file.name, size: file.size, contentType: file.type },
    });
    const put = await fetch(uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    return `/api/storage${objectPath}`;
  }

  async function handleFiles(files: File[]) {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    const toUpload = files.slice(0, room);
    if (files.length > room) {
      toast({ title: `Photo limit is ${MAX_PHOTOS}`, description: `Only the first ${room} file(s) were added.` });
    }
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of toUpload) {
        const url = await uploadOne(file);
        if (url) added.push(url);
      }
      if (added.length) onChange([...photos, ...added]);
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Could not upload the image.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function move(index: number, delta: number) {
    const next = [...photos];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(photos.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((url, i) => (
            <div key={`${url}-${i}`} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
              <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground shadow">
                  Cover
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/50 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  type="button" variant="ghost" size="icon"
                  className="h-6 w-6 text-white hover:bg-white/20 hover:text-white"
                  disabled={disabled || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label="Move photo earlier"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" variant="ghost" size="icon"
                  className="h-6 w-6 text-white hover:bg-white/20 hover:text-white"
                  disabled={disabled || i === photos.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Move photo later"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" variant="ghost" size="icon"
                  className="h-6 w-6 text-white hover:bg-white/20 hover:text-white"
                  disabled={disabled}
                  onClick={() => remove(i)}
                  aria-label="Remove photo"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || uploading || atCap}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {atCap ? `Limit of ${MAX_PHOTOS} reached` : photos.length ? "Add photos" : "Upload photos"}
        </Button>
        <p className="text-xs text-muted-foreground">
          PNG or JPG, up to 5 MB each. First photo is the cover.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void handleFiles(files);
        }}
      />
    </div>
  );
}
