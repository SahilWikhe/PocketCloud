import { UserButton, useUser } from "@clerk/react";
import type {
  CustomerDashboardV1,
  CustomerLifecycleAction,
  DeploymentState,
} from "@pocketcloud/core";
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

function friendlyAction(action: CustomerLifecycleAction): string {
  return ({
    REDEPLOY: "Redeployed",
    SUSPEND: "Suspended",
    RESTORE: "Restored",
    DELETE: "Moved to recovery",
  } as const)[action];
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

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

  const manage = useCallback(async (appId: string, action: CustomerLifecycleAction) => {
    try {
      setActionError(null);
      setBusyAppId(appId);
      await dashboardClient.manageApp(appId, action, crypto.randomUUID());
      setConfirmingDelete(null);
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "PocketCloud could not update this project.");
    } finally {
      setBusyAppId(null);
    }
  }, [dashboardClient, refresh]);

  const activeApps = dashboard?.apps.filter((app) => app.status !== "DELETED") ?? [];
  const liveCount = activeApps.filter((app) => app.liveUrl !== null).length;
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
        {actionError && <div className="dashboard-error" role="alert"><span>{actionError}</span><button onClick={() => setActionError(null)}>Dismiss</button></div>}

        <section className="dashboard-stats" aria-label="Workspace summary">
          <article><span>Projects</span><strong>{dashboard ? activeApps.length : "—"}</strong></article>
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
                  <article className={`project-item project-${app.status.toLowerCase()}`} key={app.appId}>
                    <div className="project-avatar">{app.name.slice(0, 1).toUpperCase()}</div>
                    <div className="project-copy">
                      <strong>{app.name}</strong>
                      <span>
                        {app.status === "DELETED"
                          ? `Recoverable until ${formatDate(app.recoverableUntil!)}`
                          : app.suspensionSource === "OPERATOR"
                            ? "Suspended by PocketCloud"
                            : app.status === "SUSPENDED"
                              ? "Suspended by you"
                              : app.latestDeployment
                                ? friendlyStatus(app.latestDeployment.status)
                                : "Not published yet"}
                      </span>
                    </div>
                    <div className="project-actions">
                      {app.liveUrl && app.status === "ACTIVE" && (
                        <a href={app.liveUrl} target="_blank" rel="noreferrer">Open ↗</a>
                      )}
                      {app.availableActions.redeploy && <button disabled={busyAppId === app.appId} onClick={() => void manage(app.appId, "REDEPLOY")}>Redeploy</button>}
                      {app.availableActions.suspend && <button disabled={busyAppId === app.appId} onClick={() => void manage(app.appId, "SUSPEND")}>Suspend</button>}
                      {app.availableActions.restore && <button disabled={busyAppId === app.appId} onClick={() => void manage(app.appId, "RESTORE")}>Restore</button>}
                      {app.availableActions.delete && confirmingDelete !== app.appId && (
                        <button className="danger-action" disabled={busyAppId === app.appId} onClick={() => setConfirmingDelete(app.appId)}>Delete</button>
                      )}
                      {app.availableActions.delete && confirmingDelete === app.appId && (
                        <span className="delete-confirmation">
                          <button className="danger-action" disabled={busyAppId === app.appId} onClick={() => void manage(app.appId, "DELETE")}>Confirm delete</button>
                          <button disabled={busyAppId === app.appId} onClick={() => setConfirmingDelete(null)}>Cancel</button>
                        </span>
                      )}
                      {!Object.values(app.availableActions).some(Boolean) && app.status !== "ACTIVE" && <span className="muted-action">Contact support</span>}
                    </div>
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
          {dashboard?.actions.length ? (
            <div className="management-history">
              <h3>Project changes</h3>
              {dashboard.actions.slice(0, 6).map((action) => (
                <div key={action.actionId}>
                  <strong>{dashboard.apps.find((app) => app.appId === action.appId)?.name ?? "Project"}</strong>
                  <span>{friendlyAction(action.action)}</span>
                  <span>{action.status === "FAILED" ? "Needs attention" : "Complete"}</span>
                  <time dateTime={action.createdAt}>{formatDate(action.createdAt)}</time>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
