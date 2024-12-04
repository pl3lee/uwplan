"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { renameTemplateAction } from "@/server/actions";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const renameTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string(),
});

type FormValues = z.infer<typeof renameTemplateSchema>;

export function RenameTemplateButton({
  templateId,
  initialName,
  initialDescription,
}: {
  templateId: string;
  initialName: string;
  initialDescription: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(renameTemplateSchema),
    defaultValues: {
      name: initialName,
      description: initialDescription ?? "",
    },
  });

  const onSubmit = async (data: FormValues) => {
    if (data.name === initialName && data.description === initialDescription) {
      toast.error("No changes to save");
      return;
    }

    setIsRenaming(true);
    try {
      await renameTemplateAction(templateId, data.name, data.description);
      toast.success("Template renamed");
      setOpen(false);
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Failed to rename template");
      }
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="mr-2">
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Template</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 pt-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter template name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter template description"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isRenaming} className="w-full">
              {isRenaming ? "Renaming..." : "Save Changes"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
