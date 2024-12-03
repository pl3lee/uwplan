"use client";

import { Button } from "@/components/ui/button";
import { exportScheduleToCSV } from "@/server/actions";
import { Download } from "lucide-react";
import { useState } from "react";

export function ExportButton({ scheduleId }: { scheduleId: string }) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const csvContent = await exportScheduleToCSV(scheduleId);

      // Create blob from CSV content
      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `schedule-${scheduleId}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error("Failed to export schedule:", error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button onClick={handleExport} variant="outline" disabled={isExporting}>
      <Download className="mr-2 h-4 w-4" />
      {isExporting ? "Exporting..." : "Export to CSV"}
    </Button>
  );
}
