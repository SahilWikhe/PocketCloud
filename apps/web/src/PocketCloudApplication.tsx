import { ClerkProvider, Show, SignIn, SignUp } from "@clerk/react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";

import { DashboardPage } from "./pages/DashboardPage";
import { LandingPage } from "./pages/LandingPage";

function AuthenticationPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <div className="auth-page">
      <Link className="brand" to=""><span className="brand-mark">P</span><span>PocketCloud</span></Link>
      {mode === "sign-in" ? (
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/dashboard" />
      ) : (
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/dashboard" />
      )}
      <Link className="back-home" to="/">← Back to PocketCloud</Link>
    </div>
  );
}

function ProtectedDashboard() {
  return (
    <Show when="signed-in" fallback={<Navigate to="/sign-in" replace />}>
      <DashboardPage />
    </Show>
  );
}

function SetupRequiredPage() {
  return (
    <div className="setup-page">
      <Link className="brand" to="/"><span className="brand-mark">P</span><span>PocketCloud</span></Link>
      <div><p className="eyebrow">Account setup</p><h1>PocketCloud accounts are almost ready.</h1><p>The application owner still needs to connect Clerk before customer sign-in can open.</p><Link className="hero-secondary" to="/">Return home</Link></div>
    </div>
  );
}

function ConfiguredRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage authConfigured />} />
      <Route path="/sign-in/*" element={<AuthenticationPage mode="sign-in" />} />
      <Route path="/sign-up/*" element={<AuthenticationPage mode="sign-up" />} />
      <Route path="/dashboard" element={<ProtectedDashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export interface PocketCloudApplicationProps {
  publishableKey?: string;
}

export function PocketCloudApplication({ publishableKey }: PocketCloudApplicationProps) {
  return (
    <BrowserRouter>
      {publishableKey ? (
        <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
          <ConfiguredRoutes />
        </ClerkProvider>
      ) : (
        <Routes>
          <Route path="/" element={<LandingPage authConfigured={false} />} />
          <Route path="*" element={<SetupRequiredPage />} />
        </Routes>
      )}
      <Analytics />
    </BrowserRouter>
  );
}
