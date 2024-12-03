import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ScheduleLoading() {
  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-7 w-[180px]" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-24" />
                      <Skeleton className="h-8 w-8 rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-40" />
                  </div>
                  <Skeleton className="h-10 w-32" />
                </div>
              </CardHeader>
            </Card>
          ))}
        </CardContent>
      </Card>

      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-7 w-[120px]" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 2 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between py-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-8 w-8 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
