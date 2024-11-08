"use client";
import { Button } from "./ui/button";
import { useState } from "react";

export default function Navbar() {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <nav className="bg-primary text-primary-foreground p-4">
      <div className="container mx-auto flex items-center justify-between">
        <div className="text-lg font-bold">MyApp</div>
        <div className="relative">
          <Button
            variant="default"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            Sign in
          </Button>
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-md bg-white shadow-lg">
              <a
                href="/auth/google"
                className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
              >
                Sign in with Google
              </a>
              <a
                href="/auth/github"
                className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
              >
                Sign in with GitHub
              </a>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
