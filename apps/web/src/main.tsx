import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { resolveClerkPublishableKey } from "./clerk-configuration";
import { PocketCloudApplication } from "./PocketCloudApplication";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
const clerkPublishableKey = resolveClerkPublishableKey({
  NEXT_PUBLIC_gopocketcloud_CLERK_PUBLISHABLE_KEY:
    import.meta.env.NEXT_PUBLIC_gopocketcloud_CLERK_PUBLISHABLE_KEY,
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});

if (!root) {
  throw new Error("PocketCloud root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <PocketCloudApplication
      {...(clerkPublishableKey === undefined ? {} : { publishableKey: clerkPublishableKey })}
    />
  </StrictMode>,
);
