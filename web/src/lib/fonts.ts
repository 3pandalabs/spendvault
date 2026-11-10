import { Inter } from "next/font/google";

// AdVault declares Inter as its face; loading it here makes SpendVault render
// the same family on every device instead of whatever system font is present.
export const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
