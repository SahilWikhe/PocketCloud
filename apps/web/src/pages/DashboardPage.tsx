import { UserButton, useUser } from "@clerk/react";
import type { CustomerDashboardV1, DeploymentState } from "@pocketcloud/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { App } from "../App";
import {
  PocketCloudCustomerClient,
  type CustomerDashboardClient,
} from "../lib/customer-client";

function friendlyStatus(status: DeploymentState): string {
  if (status === "READY") return "Live";
  if (status === "FAILED") return "Needs attention";
  if (status === "SUSPENDED") return "Suspended";
  if (["DEPLOYING", "VERIFYING"].includes(status)) return "Publishing";
  if (["CREATED", "UPLOADING", "QUARANTINED", "QUEUED"].includes(status)) return "Waiting";
  return "Preparing";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export interface DashboardPageProps {
  client?: CustomerDashboardClient;
}

export function DashboardPage({ client }: DashboardPageProps) {
  const dashboardClient = useMemo(() => client ?? new PocketCloudCustomerClient(), [client]);
  const { user } = useUser();
  const [dashboard, setDashboard] = useState<CustomerDashboardV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const nextDashboard = await dashboardClient.getDashboard();
      setDashboard(nextDashboard);
    } catch {
      setError("Your dashboard could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [dashboardClient]);

  useEffect(() => { void refresh(); }, [refresh]);

  const liveCount = dashboard?.apps.filter((app) => app.latestDeployment?.status === "READY").length ?? 0;
  const firstName = user?.firstName ?? dashboard?.session.user.displayName?.split(" ")[0] ?? "there";

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <Link className="brand" to="/" aria-label="PocketCloud home">
          <span className="brand-mark" aria-hidden="true">P</span><span>PocketCloud</span>
        </Link>
        <div className="dashboard-account">
          <span>{user?.primaryEmailAddress?.emailAddress}</span>
          <UserButton />
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-welcome">
          <div><p className="eyebrow">Customer dashboard</p><h1>Welcome back, {firstName}.</h1><p>Publish a new project or see what is happening with your existing sites.</p></div>
          <span className="plan-badge">{dashboard?.session.workspace.planCode ?? "FREE"} plan</span>
        </section>

        {error && <div className="dashboard-error" role="alert"><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}

        <section className="dashboard-stats" aria-label="Workspace summary">
          <article><span>Projects</span><strong>{dashboard?.apps.length ?? "—"}</strong></article>
          <article><span>Live websites</span><strong>{loading ? "—" : liveCount}</strong></article>
          <article><span>Deployments</span><strong>{dashboard?.deployments.length ?? "—"}</strong></article>
          <article><span>Current plan</span><strong>{dashboard?.session.workspace.planCode ?? "—"}</strong></article>
        </section>

        <div className="dashboard-grid">
          <section className="dashboard-panel upload-panel">
            <div className="panel-heading"><div><p className="eyebrow">New project</p><h2>Publish a website</h2></div></div>
            <App embedded onDeploymentComplete={() => void refresh()} />
          </section>

          <section className="dashboard-panel project-panel">
            <div className="panel-heading"><div><p className="eyebrow">Your workspace</p><h2>Projects</h2></div><span>{dashboard?.session.workspace.name}</span></div>
            {loading ? <p className="empty-state">Loading your projects…</p> : dashboard?.apps.length ? (
              <div className="project-list">
                {dashboard.apps.map((app) => (
                  <article key={app.appId}>
                    <div className="project-avatar">{app.name.slice(0, 1).toUpperCase()}</div>
                    <div><strong>{app.name}</strong><span>{app.latestDeployment ? friendlyStatus(app.latestDeployment.status) : "Not published yet"}</span></div>
                    {app.latestDeployment?.publicUrl ? <a href={app.latestDeployment.publicUrl} target="_blank" rel="noreferrer">Open ↗</a> : <span className="muted-action">—</span>}
                  </article>
                ))}
              </div>
            ) : <p className="empty-state">Your first published website will appear here.</p>}
          </section>
        </div>

        <section className="dashboard-panel history-panel">
          <div className="panel-heading"><div><p className="eyebrow">Activity</p><h2>Deployment history</h2></div><button className="text-button" onClick={() => void refresh()}>Refresh</button></div>
          {loading ? <p className="empty-state">Loading deployment history…</p> : dashboard?.deployments.length ? (
            <div className="history-table" role="table" aria-label="Deployment history">
              <div className="history-row history-head" role="row"><span>Project</span><span>Status</span><span>Started</span><span>Link</span></div>
              {dashboard.deployments.map((deployment) => (
                <div className="history-row" role="row" key={deployment.deploymentId}>
                  <strong>{deployment.appName}</strong>
                  <span><i className={`history-dot status-${deployment.status.toLowerCase()}`} />{friendlyStatus(deployment.status)}</span>
                  <span>{formatDate(deployment.createdAt)}</span>
                  <span>{deployment.publicUrl ? <a href={deployment.publicUrl} target="_blank" rel="noreferrer">Open ↗</a> : "—"}</span>
                </div>
              ))}
            </div>
          ) : <p className="empty-state">No deployments yet. Upload a project to start.</p>}
        </section>
      </main>
    </div>
  );
}
