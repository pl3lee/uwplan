"use client";

import { useState, useEffect } from "react";
import { ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ScrollToTopButton() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      if (window.scrollY > 300) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener("scroll", toggleVisibility);
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  return (
    <Button
      className={`fixed bottom-20 right-10 transition-opacity duration-200 md:bottom-12 md:right-12 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      size="icon"
      onClick={scrollToTop}
      aria-label="Scroll to top"
    >
      <ChevronUp className="h-4 w-4" />
    </Button>
  );
}
