import Container from "@/components/Container";
import Navbar from "@/components/Navbar";
import { Toaster } from "@/components/ui/sonner";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Navbar />
      <Container>{children}</Container>
      <Toaster />
    </>
  );
}
