import React from "react";

interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className, size = 32 }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
    >
      <defs>
        {/* Shape 1: Top-Left Stem Gradient (Peach to Purple) */}
        <linearGradient id="logo-grad1" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FED3A8" />
          <stop offset="100%" stopColor="#5C60E6" />
        </linearGradient>

        {/* Shape 2: Rising Diagonal Gradient (Blue to Violet to Peach) */}
        <linearGradient id="logo-grad2" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FED3A8" />
          <stop offset="50%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#3F49E6" />
        </linearGradient>

        {/* Shape 3: Falling Diagonal Gradient (Violet to Peach) */}
        <linearGradient id="logo-grad3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8A7CF0" />
          <stop offset="100%" stopColor="#FED3A8" />
        </linearGradient>
      </defs>

      {/* Shape 3: Falling Diagonal (drawn first so it's in the background) */}
      <path
        d="M 220 260 L 300 260 L 380 430 H 330 C 305 430, 290.7 410, 281.2 390 Z"
        fill="url(#logo-grad3)"
      />

      {/* Shape 2: Rising Diagonal */}
      <path
        d="M 130 250 V 390 C 130 412.1, 210 412.1, 210 390 V 360 C 210 330, 240 310, 270 290 L 370 116 C 370 99.43, 356.57 86, 340 86 H 290 L 190 260 C 170 280, 140 290, 130 310 V 250 Z"
        fill="url(#logo-grad2)"
      />

      {/* Shape 1: Top-Left Stem (drawn last on top) */}
      <path
        d="M 130 86 H 180 C 196.57 86, 210 99.43, 210 116 V 244 C 210 266.1, 130 266.1, 130 244 Z"
        fill="url(#logo-grad1)"
      />
    </svg>
  );
}
