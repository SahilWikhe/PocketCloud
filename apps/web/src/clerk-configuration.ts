export interface ClerkBrowserEnvironment {
  NEXT_PUBLIC_gopocketcloud_CLERK_PUBLISHABLE_KEY?: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
}

export function resolveClerkPublishableKey(
  environment: ClerkBrowserEnvironment,
): string | undefined {
  return (
    environment.NEXT_PUBLIC_gopocketcloud_CLERK_PUBLISHABLE_KEY ??
    environment.VITE_CLERK_PUBLISHABLE_KEY ??
    environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  );
}
