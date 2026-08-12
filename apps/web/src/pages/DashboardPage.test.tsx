import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomerDashboardV1 } from "@pocketcloud/core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { DashboardPage } from "./DashboardPage";

vi.mock("@clerk/react", () => ({
  useUser: () => ({
    user: {
      firstName: "Ada",
      primaryEmailAddress: { emailAddress: "ada@example.com" },
    },
  }),
  UserButton: () => <button type="button">Account menu</button>,
}));

const dashboard: CustomerDashboardV1 = {
  schemaVersion: 1,
  session: {
    schemaVersion: 1,
    user: { userId: "usr_1", primaryEmail: "ada@example.com", displayName: "Ada Owner" },
    workspace: {
      workspaceId: "wsp_1",
      name: "Ada's workspace",
      slug: "personal-ada",
      role: "OWNER",
      planCode: "FREE",
    },
  },
  apps: [
    {
      appId: "app_1",
      name: "Launch site",
      slug: "launch-site",
      status: "ACTIVE",
      suspensionSource: null,
      recoverableUntil: null,
      availableActions: { redeploy: true, suspend: true, restore: false, delete: true },
      activeVersionId: "ver_1",
      liveUrl: "https://launch-site.vercel.app",
      latestDeployment: {
        deploymentId: "dep_1",
        versionId: "ver_1",
        status: "READY",
        publicUrl: "https://launch-site.vercel.app",
        createdAt: "2026-08-12T06:00:00.000Z",
        updatedAt: "2026-08-12T06:01:00.000Z",
      },
      createdAt: "2026-08-12T05:59:00.000Z",
      updatedAt: "2026-08-12T06:01:00.000Z",
    },
  ],
  deployments: [
    {
      deploymentId: "dep_1",
      appId: "app_1",
      appName: "Launch site",
      versionId: "ver_1",
      status: "READY",
      publicUrl: "https://launch-site.vercel.app",
      errorMessage: null,
      createdAt: "2026-08-12T06:00:00.000Z",
      updatedAt: "2026-08-12T06:01:00.000Z",
    },
  ],
  actions: [],
};

describe("customer dashboard", () => {
  it("shows the signed-in customer's projects and deployment history", async () => {
    const getDashboard = vi.fn(async () => dashboard);
    const manageApp = vi.fn();
    render(
      <MemoryRouter>
        <DashboardPage client={{ getDashboard, manageApp }} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Welcome back, Ada." }))
      .toBeInTheDocument();
    expect(screen.getAllByText("Launch site")).toHaveLength(2);
    expect(screen.getAllByText("Live")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Open ↗" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Open ↗" })[0]).toHaveAttribute(
      "href", "https://launch-site.vercel.app",
    );
    expect(getDashboard).toHaveBeenCalledOnce();
  });

  it("runs modular project actions and confirms destructive deletes", async () => {
    const getDashboard = vi.fn(async () => dashboard);
    const manageApp = vi.fn(async () => ({
      schemaVersion: 1 as const,
      actionId: "caa_1",
      appId: "app_1",
      action: "REDEPLOY" as const,
      status: "COMPLETED" as const,
      appStatus: "ACTIVE" as const,
      deploymentId: "dep_2",
      recoverableUntil: null,
      createdAt: "2026-08-12T07:00:00.000Z",
      completedAt: "2026-08-12T07:00:01.000Z",
    }));
    render(
      <MemoryRouter>
        <DashboardPage client={{ getDashboard, manageApp }} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Redeploy" }));
    await waitFor(() => expect(manageApp).toHaveBeenCalledWith(
      "app_1",
      "REDEPLOY",
      expect.any(String),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
    expect(manageApp).toHaveBeenCalledTimes(1);
  });
});
