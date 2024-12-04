"use client";

import { Button } from "@/components/ui/button";
import { deleteTemplateAction } from "@/server/actions";
import { useState } from "react";
import { toast } from "sonner";

export function DeleteTemplateButton({ templateId }: { templateId: string }) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this template?")) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteTemplateAction(templateId);
      toast.success("Template deleted");
    } catch (error) {
      console.error("Error deleting template:", error);
      toast.error("Error deleting template");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
      {isDeleting ? "Deleting..." : "Delete"}
    </Button>
  );
}
