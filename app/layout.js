import "./globals.css";
import { APP_NAME } from "../lib/config.js";

export const metadata = {
  title: APP_NAME,
  description: "A personal AI assistant for learning digital marketing.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}