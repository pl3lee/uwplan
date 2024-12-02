export function PatternBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <svg
        className="absolute h-[400%] w-[200%] -translate-x-1/2 -translate-y-1/4"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="waves"
            x="0"
            y="0"
            width="50"
            height="30"
            patternUnits="userSpaceOnUse"
          >
            {/* First wave line */}
            <path
              d="M0 15 Q12.5 0, 25 15 Q37.5 30, 50 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-background/[0.15]"
            />
            {/* Second wave line (offset) */}
            <path
              d="M0 20 Q12.5 5, 25 20 Q37.5 35, 50 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-background/10"
            />
            {/* Third wave line (offset) */}
            <path
              d="M0 10 Q12.5 -5, 25 10 Q37.5 25, 50 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-background/[0.07]"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#waves)" />
      </svg>
    </div>
  );
}
