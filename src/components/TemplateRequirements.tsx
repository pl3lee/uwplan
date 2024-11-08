import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Course = {
  id: number;
  code: string;
  name: string;
  rating: number | null;
  difficulty: number | null;
  workload: number | null;
};

type TemplateItem = {
  id: number;
  type: "requirement" | "instruction" | "separator";
  description: string;
  orderIndex: number;
  templateName: string;
  courses: {
    course: Course;
  }[];
};

export function TemplateRequirements({ items }: { items: TemplateItem[] }) {
  return (
    <div className="space-y-8">
      {items.map((item) => (
        <div key={`${item.templateName}-${item.id}`} className="space-y-4">
          <h3 className="text-xl font-semibold">
            <span className="text-muted-foreground">{item.templateName}: </span>
            {item.description}
          </h3>
          {item.type === "requirement" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Select</TableHead>
                  <TableHead className="w-[100px]">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[100px]">Rating</TableHead>
                  <TableHead className="w-[100px]">Difficulty</TableHead>
                  <TableHead className="w-[100px]">Workload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.courses.map(({ course }) => (
                  <TableRow key={course.id}>
                    <TableCell>
                      <Checkbox />
                    </TableCell>
                    <TableCell>{course.code}</TableCell>
                    <TableCell>{course.name}</TableCell>
                    <TableCell>{course.rating ?? "N/A"}</TableCell>
                    <TableCell>{course.difficulty ?? "N/A"}</TableCell>
                    <TableCell>{course.workload ?? "N/A"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {item.type === "instruction" && (
            <p className="text-muted-foreground">{item.description}</p>
          )}
          {item.type === "separator" && <hr />}
        </div>
      ))}
    </div>
  );
}
